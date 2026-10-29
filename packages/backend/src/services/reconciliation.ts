import crypto from 'crypto';
import { pool } from '../db/index.js';
import { getPaymentAdapter } from './payment-adapter.js';
import { triggerDriftAlert } from '../lib/sentry.js';

export interface BankStatementRow {
  date: string;
  utr: string;
  amountPaise: number;
  description?: string;
}

export interface ReconSummary {
  batchId: string;
  filename: string;
  totalRows: number;
  matchedCount: number;
  matchedRows?: number;
  unmatchedCount: number;
  unmatchedRows?: number;
  discrepanciesCount: number;
  status: string;
}

/**
 * Parses simple CSV bank statement content into structured rows.
 * Accepts headers like "Date, UTR, Amount, Description" or raw CSV rows.
 */
export function parseBankStatementCsv(csvContent: string): BankStatementRow[] {
  if (!csvContent || typeof csvContent !== 'string') return [];
  const lines = csvContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return [];

  const rows: BankStatementRow[] = [];
  const header = lines[0].toLowerCase();
  const isHeaderPresent = header.includes('date') || header.includes('utr') || header.includes('amount');
  const dataLines = isHeaderPresent ? lines.slice(1) : lines;

  let dateIdx = 0;
  let utrIdx = 1;
  let amountIdx = 2;
  let descIdx = 3;

  if (isHeaderPresent) {
    const headerCols = lines[0].split(',').map((c) => c.replace(/^"|"$/g, '').trim().toLowerCase());
    const dIdx = headerCols.findIndex((c) => c.includes('date'));
    const uIdx = headerCols.findIndex((c) => c.includes('utr') || c.includes('ref'));
    const aIdx = headerCols.findIndex((c) => c.includes('amount'));
    const desc = headerCols.findIndex((c) => c.includes('desc') || c.includes('particular') || c.includes('narr'));
    if (dIdx !== -1) dateIdx = dIdx;
    if (uIdx !== -1) utrIdx = uIdx;
    if (aIdx !== -1) amountIdx = aIdx;
    if (desc !== -1) descIdx = desc;
  }

  for (const line of dataLines) {
    // Basic comma separation supporting quotes
    const parts = line.split(',').map((p) => p.replace(/^"|"$/g, '').trim());
    if (parts.length < 3) continue;

    const dateStr = parts[dateIdx] || new Date().toISOString();
    const utr = parts[utrIdx]?.replace(/[^a-zA-Z0-9]/g, '') || '';
    const rawAmt = parseFloat(parts[amountIdx]?.replace(/[^0-9.-]/g, '') || '0');
    if (isNaN(rawAmt) || !utr) continue;

    // Convert INR to integer paise
    const amountPaise = Math.round(rawAmt * 100);
    const description = parts[descIdx] || '';

    rows.push({
      date: dateStr,
      utr,
      amountPaise,
      description,
    });
  }

  return rows;
}

/**
 * Ingests an admin-imported bank statement CSV, matches against payments table,
 * and flags any discrepancies or unmatched amounts in the Verification Queue.
 */
export async function importBankStatementCsv(params: {
  csvContent: string;
  adminUserId?: string;
  filename?: string;
}): Promise<ReconSummary> {
  const { csvContent, adminUserId, filename = 'bank_statement.csv' } = params;
  const rows = parseBankStatementCsv(csvContent);
  const client = await pool.connect();
  const batchId = `recon_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

  try {
    await client.query('BEGIN');

    // 1. Create reconciliation record header
    const rRes = await client.query(
      `INSERT INTO reconciliation_records (
         batch_id, imported_by, filename, total_rows, matched_count, unmatched_count, status
       ) VALUES ($1, $2, $3, $4, 0, 0, 'PROCESSING')
       RETURNING id;`,
      [batchId, adminUserId || null, filename, rows.length]
    );
    const recordId = rRes.rows[0].id;

    let matchedCount = 0;
    let unmatchedCount = 0;
    let discrepanciesCount = 0;

    // 2. Iterate each row and match against payments
    for (const row of rows) {
      // Look up payment by UTR
      const pRes = await client.query(
        `SELECT id, booking_id, amount_paise, status, utr FROM payments WHERE utr = $1 FOR UPDATE;`,
        [row.utr]
      );

      let itemStatus: 'MATCHED' | 'UNMATCHED' | 'DISCREPANCY' = 'UNMATCHED';
      let matchedPaymentId: string | null = null;
      let discrepancyReason = '';

      if (pRes.rows.length > 0) {
        const payment = pRes.rows[0];
        matchedPaymentId = payment.id;

        if (payment.amount_paise === row.amountPaise && (payment.status === 'SUCCESS' || payment.status === 'SUCCEEDED')) {
          itemStatus = 'MATCHED';
          matchedCount++;
        } else {
          itemStatus = 'DISCREPANCY';
          discrepanciesCount++;
          discrepancyReason = `Amount mismatch (expected ${payment.amount_paise} paise, statement shows ${row.amountPaise} paise) or status ${payment.status}`;

          // Move to VERIFICATION_QUEUE
          await client.query(
            `UPDATE payments
             SET status = 'VERIFICATION_QUEUE',
                 verification_queue_reason = $1,
                 updated_at = NOW()
             WHERE id = $2;`,
            [`Reconciliation discrepancy: ${discrepancyReason}`, payment.id]
          );

          await client.query(
            `INSERT INTO payment_events (payment_id, event_type, from_status, to_status, payload)
             VALUES ($1, 'RECONCILIATION_DISCREPANCY', $2, 'VERIFICATION_QUEUE', $3);`,
            [
              payment.id,
              payment.status,
              JSON.stringify({ batchId, statementAmount: row.amountPaise, expectedAmount: payment.amount_paise }),
            ]
          );
        }
      } else {
        itemStatus = 'UNMATCHED';
        unmatchedCount++;
      }

      let parsedTxnDate = new Date(row.date);
      if (isNaN(parsedTxnDate.getTime())) {
        parsedTxnDate = new Date();
      }

      await client.query(
        `INSERT INTO reconciliation_items (
           record_id, utr, amount_paise, txn_date, matched_payment_id, status, details
         ) VALUES ($1, $2, $3, $4, $5, $6, $7);`,
        [
          recordId,
          row.utr,
          row.amountPaise,
          parsedTxnDate,
          matchedPaymentId,
          itemStatus,
          JSON.stringify({ description: row.description, reason: discrepancyReason }),
        ]
      );
    }

    // 3. Update summary
    await client.query(
      `UPDATE reconciliation_records
       SET matched_count = $1, unmatched_count = $2, status = 'COMPLETED'
       WHERE id = $3;`,
      [matchedCount, unmatchedCount + discrepanciesCount, recordId]
    );

    await client.query('COMMIT');

    return {
      batchId,
      filename,
      totalRows: rows.length,
      matchedCount,
      matchedRows: matchedCount,
      unmatchedCount,
      unmatchedRows: unmatchedCount,
      discrepanciesCount,
      status: 'COMPLETED',
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Daily automated reconciliation comparing our recorded payments against YouPI gateway records.
 */
export async function runDailyYouPiReconciliation(date = new Date()): Promise<{
  scanned: number;
  matched: number;
  discrepancies: number;
}> {
  const adapter = getPaymentAdapter();
  const client = await pool.connect();

  try {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const res = await client.query(
      `SELECT id, provider_order_id, provider_payment_id, amount_paise, status, utr
       FROM payments
       WHERE provider = 'youpi'
         AND created_at >= $1 AND created_at <= $2
         AND status IN ('SUCCESS', 'SUCCEEDED', 'PENDING', 'QUEUED');`,
      [startOfDay, endOfDay]
    );

    let matched = 0;
    let discrepancies = 0;

    for (const payment of res.rows) {
      try {
        const remoteStatus = await adapter.getStatus(payment.provider_payment_id || payment.id);

        if (payment.status === 'SUCCESS' && remoteStatus.status === 'SUCCESS' && payment.amount_paise === remoteStatus.amountPaise) {
          matched++;
        } else if (remoteStatus.status === 'SUCCESS' && payment.status !== 'SUCCESS') {
          // Late payment or dropped webhook detected! Move to VERIFICATION_QUEUE
          discrepancies++;
          await client.query(
            `UPDATE payments
             SET status = 'VERIFICATION_QUEUE',
                 verification_queue_reason = $1,
                 updated_at = NOW()
             WHERE id = $2;`,
            [`Reconciliation alert: Gateway reports SUCCESS but internal status was ${payment.status}`, payment.id]
          );
        }
      } catch {
        // Gateway unreachable or not found
      }
    }

    return {
      scanned: res.rows.length,
      matched,
      discrepancies,
    };
  } finally {
    client.release();
  }
}

export interface InventoryDriftItem {
  ticketTypeId: string;
  ticketTypeName: string;
  eventId: string;
  storedSold: number;
  actualSold: number;
  soldDrift: number;
  storedHeld: number;
  actualHeld: number;
  heldDrift: number;
  healed: boolean;
}

export interface NightlyReconciliationReport {
  timestamp: string;
  financial: {
    ledgerSalesPaise: number;
    ledgerRefundsPaise: number;
    netLedgerPaise: number;
    paymentsSettledPaise: number;
    refundsSettledPaise: number;
    netSettledPaise: number;
    driftPaise: number;
    hasFinancialDrift: boolean;
  };
  inventory: {
    scannedTiers: number;
    driftTiersCount: number;
    hasInventoryDrift: boolean;
    driftItems: InventoryDriftItem[];
  };
  hasDrift: boolean;
}

/**
 * Nightly automated financial & inventory reconciliation:
 * 1. Financial: verifies ledger = payments − refunds (zero discrepancy).
 * 2. Inventory: recomputes actual sold and held tickets from bookings/tickets and detects drift.
 */
export async function runNightlyLedgerAndInventoryReconciliation(options: {
  autoHealInventory?: boolean;
} = {}): Promise<NightlyReconciliationReport> {
  const { autoHealInventory = false } = options;
  const client = await pool.connect();
  const timestamp = new Date().toISOString();

  try {
    await client.query('BEGIN');

    // 1. Financial Ledger vs Settled Payments/Refunds
    const ledgerRes = await client.query(`
      SELECT
        COALESCE(SUM(CASE WHEN entry_type = 'SALE' THEN amount_paise ELSE 0 END), 0)::BIGINT AS sales_paise,
        COALESCE(SUM(CASE WHEN entry_type = 'REFUND' THEN amount_paise ELSE 0 END), 0)::BIGINT AS refunds_paise
      FROM organizer_ledger_entries;
    `);
    const ledgerSalesPaise = Number(ledgerRes.rows[0]?.sales_paise || 0);
    const ledgerRefundsPaise = Number(ledgerRes.rows[0]?.refunds_paise || 0);
    const netLedgerPaise = ledgerSalesPaise - ledgerRefundsPaise;

    const settledPaymentsRes = await client.query(`
      SELECT COALESCE(SUM(amount_paise), 0)::BIGINT AS total_payments
      FROM payments
      WHERE status IN ('SUCCESS', 'SUCCEEDED');
    `);
    const paymentsSettledPaise = Number(settledPaymentsRes.rows[0]?.total_payments || 0);

    const settledRefundsRes = await client.query(`
      SELECT COALESCE(SUM(amount_paise), 0)::BIGINT AS total_refunds
      FROM refunds
      WHERE status = 'SUCCEEDED';
    `);
    const refundsSettledPaise = Number(settledRefundsRes.rows[0]?.total_refunds || 0);
    const netSettledPaise = paymentsSettledPaise - refundsSettledPaise;

    const financialDriftPaise = netLedgerPaise - netSettledPaise;
    const hasFinancialDrift = financialDriftPaise !== 0;

    // 2. Inventory: recompute actual sold and held per ticket type
    const tiersRes = await client.query(`
      SELECT
        tt.id,
        tt.name,
        tt.event_id,
        tt.sold AS stored_sold,
        tt.held AS stored_held,
        COALESCE(actual_t.actual_sold, 0)::INT AS actual_sold,
        COALESCE(actual_b.actual_held, 0)::INT AS actual_held
      FROM ticket_types tt
      LEFT JOIN (
        SELECT ticket_type_id, COUNT(*)::INT AS actual_sold
        FROM tickets
        WHERE status IN ('VALID', 'CHECKED_IN')
        GROUP BY ticket_type_id
      ) actual_t ON actual_t.ticket_type_id = tt.id
      LEFT JOIN (
        SELECT bi.ticket_type_id, SUM(bi.quantity)::INT AS actual_held
        FROM booking_items bi
        INNER JOIN bookings b ON b.id = bi.booking_id
        WHERE b.status = 'PENDING_PAYMENT'
          AND (b.expires_at IS NULL OR b.expires_at > NOW())
        GROUP BY bi.ticket_type_id
      ) actual_b ON actual_b.ticket_type_id = tt.id;
    `);

    const driftItems: InventoryDriftItem[] = [];

    for (const row of tiersRes.rows) {
      const storedSold = Number(row.stored_sold || 0);
      const actualSold = Number(row.actual_sold || 0);
      const storedHeld = Number(row.stored_held || 0);
      const actualHeld = Number(row.actual_held || 0);

      const soldDrift = storedSold - actualSold;
      const heldDrift = storedHeld - actualHeld;

      if (soldDrift !== 0 || heldDrift !== 0) {
        let healed = false;
        if (autoHealInventory) {
          await client.query(
            `UPDATE ticket_types
             SET sold = $1, held = $2
             WHERE id = $3;`,
            [actualSold, actualHeld, row.id]
          );
          healed = true;
        }

        driftItems.push({
          ticketTypeId: row.id,
          ticketTypeName: row.name,
          eventId: row.event_id,
          storedSold,
          actualSold,
          soldDrift,
          storedHeld,
          actualHeld,
          heldDrift,
          healed,
        });
      }
    }

    const hasInventoryDrift = driftItems.length > 0;
    const hasDrift = hasFinancialDrift || hasInventoryDrift;

    if (hasDrift) {
      triggerDriftAlert({
        financialDriftPaise,
        inventoryDriftCount: driftItems.length,
        driftItems,
      });
    }

    // Record ops_runs audit entry
    await client.query(
      `INSERT INTO ops_runs (kind, started_at, finished_at, outcome, evidence_ref)
       VALUES ('nightly_reconciliation', $1, NOW(), $2, $3);`,
      [
        timestamp,
        hasDrift ? 'DRIFT_ALERT' : 'SUCCESS',
        JSON.stringify({
          financial: {
            netLedgerPaise,
            netSettledPaise,
            financialDriftPaise,
          },
          inventoryDriftCount: driftItems.length,
          driftItems: driftItems.map((d) => ({
            ticketTypeId: d.ticketTypeId,
            soldDrift: d.soldDrift,
            heldDrift: d.heldDrift,
            healed: d.healed,
          })),
        }),
      ]
    );

    await client.query('COMMIT');

    return {
      timestamp,
      financial: {
        ledgerSalesPaise,
        ledgerRefundsPaise,
        netLedgerPaise,
        paymentsSettledPaise,
        refundsSettledPaise,
        netSettledPaise,
        driftPaise: financialDriftPaise,
        hasFinancialDrift,
      },
      inventory: {
        scannedTiers: tiersRes.rows.length,
        driftTiersCount: driftItems.length,
        hasInventoryDrift,
        driftItems,
      },
      hasDrift,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
