import crypto from 'crypto';
import { pool } from '../db/index.js';
import { getPaymentAdapter } from './payment-adapter.js';

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
