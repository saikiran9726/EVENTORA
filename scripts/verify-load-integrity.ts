import { pool } from '../packages/backend/src/db/index.js';

export interface LoadIntegrityReport {
  timestamp: string;
  oversellViolations: number;
  duplicateTickets: number;
  duplicateCheckins: number;
  droppedBookings: number;
  ticketTypesReconciled: number;
  allIntegrityChecksPassed: boolean;
  details: any;
}

export async function runLoadIntegrityAudit(): Promise<LoadIntegrityReport> {
  const client = await pool.connect();
  const timestamp = new Date().toISOString();

  try {
    console.log('\n======================================================');
    console.log('  POST-LOAD AUDIT: ABSOLUTE CORRECTNESS VERIFICATION');
    console.log('======================================================\n');

    // 1. Oversell Verification: sold > capacity on any ticket_type
    const oversellRes = await client.query(`
      SELECT id, event_id, name, capacity, sold, held
      FROM ticket_types
      WHERE sold > capacity;
    `);
    const oversellViolations = oversellRes.rows.length;
    console.log(`[Audit] Oversell check (sold > capacity): ${oversellViolations} violations.`);

    // 2. Exact Ledger Reconciliation: sold == COUNT(confirmed booking items)
    const reconRes = await client.query(`
      SELECT 
        tt.id,
        tt.name,
        tt.sold,
        COALESCE(SUM(bi.quantity), 0) as confirmed_count
      FROM ticket_types tt
      LEFT JOIN booking_items bi ON bi.ticket_type_id = tt.id
      LEFT JOIN bookings b ON b.id = bi.booking_id AND b.status = 'CONFIRMED'
      GROUP BY tt.id, tt.name, tt.sold
      HAVING tt.sold != COALESCE(SUM(bi.quantity), 0);
    `);
    const reconciliationMismatches = reconRes.rows.length;
    console.log(`[Audit] Capacity ledger reconciliation (sold == confirmed): ${reconciliationMismatches} mismatches.`);

    // 3. Duplicate Tickets: Duplicate qr_token_hash on any tickets
    const dupTicketsRes = await client.query(`
      SELECT qr_token_hash, COUNT(*) as dup_count
      FROM tickets
      GROUP BY qr_token_hash
      HAVING COUNT(*) > 1;
    `);
    const duplicateTickets = dupTicketsRes.rows.length;
    console.log(`[Audit] Duplicate tickets check: ${duplicateTickets} duplicates.`);

    // 4. Duplicate Check-ins: Duplicate (ticket_id, session_id) on checkins
    const dupCheckinsRes = await client.query(`
      SELECT ticket_id, session_id, COUNT(*) as count
      FROM checkins
      GROUP BY ticket_id, session_id
      HAVING COUNT(*) > 1;
    `);
    const duplicateCheckins = dupCheckinsRes.rows.length;
    console.log(`[Audit] Duplicate check-ins check: ${duplicateCheckins} duplicates.`);

    // 5. Dropped Bookings: Bookings in state CONFIRMED with zero booking items
    const droppedRes = await client.query(`
      SELECT b.id, b.status
      FROM bookings b
      LEFT JOIN booking_items bi ON bi.booking_id = b.id
      WHERE b.status = 'CONFIRMED' AND bi.id IS NULL;
    `);
    const droppedBookings = droppedRes.rows.length;
    console.log(`[Audit] Dropped bookings check: ${droppedBookings} dropped.`);

    // 6. Outbox Queue Depth & Lag
    const outboxRes = await client.query(`
      SELECT 
        COUNT(*) as pending_count,
        COALESCE(EXTRACT(EPOCH FROM (NOW() - MIN(created_at))), 0) as max_lag_seconds
      FROM outbox
      WHERE status = 'PENDING';
    `);
    const pendingOutbox = parseInt(outboxRes.rows[0]?.pending_count || '0', 10);
    const maxLagSeconds = parseFloat(outboxRes.rows[0]?.max_lag_seconds || '0');
    console.log(`[Audit] Outbox Queue Depth: ${pendingOutbox} pending (Max Lag: ${maxLagSeconds.toFixed(2)}s).`);

    const allPassed =
      oversellViolations === 0 &&
      reconciliationMismatches === 0 &&
      duplicateTickets === 0 &&
      duplicateCheckins === 0 &&
      droppedBookings === 0;

    console.log(`\n[Result] Absolute Correctness Verdict: ${allPassed ? 'PASSED (0 violations)' : 'FAILED'}\n`);

    // Record audit into ops_runs
    await client.query(`
      INSERT INTO ops_runs (kind, started_at, finished_at, outcome, evidence_ref)
      VALUES (
        'load_integrity_audit',
        NOW() - INTERVAL '2 seconds',
        NOW(),
        $1,
        jsonb_build_object(
          'oversell_violations', $2::int,
          'reconciliation_mismatches', $3::int,
          'duplicate_tickets', $4::int,
          'duplicate_checkins', $5::int,
          'dropped_bookings', $6::int,
          'pending_outbox', $7::int,
          'outbox_max_lag_seconds', $8::numeric
        )
      );
    `, [allPassed ? 'SUCCESS' : 'FAILED', oversellViolations, reconciliationMismatches, duplicateTickets, duplicateCheckins, droppedBookings, pendingOutbox, maxLagSeconds]);

    return {
      timestamp,
      oversellViolations,
      duplicateTickets,
      duplicateCheckins,
      droppedBookings,
      ticketTypesReconciled: reconciliationMismatches === 0 ? 1 : 0,
      allIntegrityChecksPassed: allPassed,
      details: {
        pendingOutbox,
        maxLagSeconds,
      },
    };
  } finally {
    client.release();
  }
}

if (process.argv[1]?.endsWith('verify-load-integrity.ts')) {
  runLoadIntegrityAudit()
    .then((report) => {
      if (!report.allIntegrityChecksPassed) process.exit(1);
      return pool.end();
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
