import { pool } from '../packages/backend/src/db/index.js';

interface ExplainResult {
  queryName: string;
  sql: string;
  plan: string[];
  executionTimeMs: number;
}

export async function runExplainAnalyzeIndexReview(): Promise<ExplainResult[]> {
  const client = await pool.connect();
  const results: ExplainResult[] = [];

  try {
    const queries = [
      {
        name: 'Discovery Query (FR-DISC, FR-XCOL)',
        sql: `EXPLAIN (ANALYZE, BUFFERS) 
              SELECT e.id, e.title, e.starts_at, e.category, e.capacity
              FROM events e
              WHERE e.visibility = 'public' 
                AND e.status IN ('published', 'completed')
                AND e.starts_at >= NOW() - INTERVAL '30 days'
              ORDER BY e.starts_at ASC
              LIMIT 20;`,
      },
      {
        name: 'Booking Lookup Query (FR-REG, FR-PAY)',
        sql: `EXPLAIN (ANALYZE, BUFFERS)
              SELECT b.id, b.status, b.total_paise, b.expires_at
              FROM bookings b
              WHERE b.user_id = '00000000-0000-0000-0000-000000000001'::uuid
                AND b.event_id = '00000000-0000-0000-0000-000000000002'::uuid;`,
      },
      {
        name: 'Opaque QR Scan Query (FR-CHECKIN)',
        sql: `EXPLAIN (ANALYZE, BUFFERS)
              SELECT t.id, t.owner_user_id, t.event_id, t.status
              FROM tickets t
              WHERE t.qr_token_hash = decode('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex');`,
      },
      {
        name: 'Checkin Deduplication Query (FR-CHECKIN)',
        sql: `EXPLAIN (ANALYZE, BUFFERS)
              SELECT c.id, c.scanned_at
              FROM checkins c
              WHERE c.ticket_id = '00000000-0000-0000-0000-000000000003'::uuid
                AND c.session_id IS NULL;`,
      },
      {
        name: 'Organizer Ledger & Analytics Query (FR-INSIGHT, FR-PAY)',
        sql: `EXPLAIN (ANALYZE, BUFFERS)
              SELECT ole.organizer_id, ole.entry_type, SUM(ole.amount_paise) as total_paise, COUNT(*) as entries_count
              FROM organizer_ledger_entries ole
              WHERE ole.organizer_id = '00000000-0000-0000-0000-000000000004'::uuid
              GROUP BY ole.organizer_id, ole.entry_type;`,
      },
      {
        name: 'Partitioned Audit Logs Query (NFR-SEC)',
        sql: `EXPLAIN (ANALYZE, BUFFERS)
              SELECT al.id, al.action, al.resource_type, al.created_at
              FROM audit_logs al
              WHERE al.created_at >= '2026-10-01'::timestamptz 
                AND al.created_at < '2026-11-01'::timestamptz
              ORDER BY al.created_at DESC
              LIMIT 50;`,
      },
      {
        name: 'P22 Event Ledger Revenue Query (FR-INSIGHT, FR-PAY)',
        sql: `EXPLAIN (ANALYZE, BUFFERS)
              SELECT ole.entry_type, COALESCE(SUM(ole.amount_paise), 0)::bigint AS total_paise, COUNT(*)::int AS count
              FROM organizer_ledger_entries ole
              JOIN bookings b ON ole.booking_id = b.id
              WHERE b.event_id = '00000000-0000-0000-0000-000000000002'::uuid
              GROUP BY ole.entry_type;`,
      },
      {
        name: 'P22 Sales Velocity Hourly in Asia/Kolkata (FR-INSIGHT)',
        sql: `EXPLAIN (ANALYZE, BUFFERS)
              SELECT to_char(date_trunc('hour', created_at AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD"T"HH24:00:00') AS bucket,
                     COUNT(*)::int AS bookings_count,
                     COALESCE(SUM(total_paise), 0)::bigint AS gross_paise
              FROM bookings
              WHERE event_id = '00000000-0000-0000-0000-000000000002'::uuid AND status != 'CANCELLED'
              GROUP BY date_trunc('hour', created_at AT TIME ZONE 'Asia/Kolkata');`,
      },
      {
        name: 'P22 Real-time Check-In Turnout Query (FR-INSIGHT, FR-CHECKIN)',
        sql: `EXPLAIN (ANALYZE, BUFFERS)
              SELECT COUNT(*)::int AS total_tickets,
                     COUNT(*) FILTER (WHERE status = 'CHECKED_IN')::int AS checked_in_tickets,
                     MAX(checked_in_at) AS last_scanned_at
              FROM tickets
              WHERE event_id = '00000000-0000-0000-0000-000000000002'::uuid AND status IN ('VALID', 'CHECKED_IN');`,
      },
      {
        name: 'P22 Demographics Answer Aggregation Query (FR-INSIGHT)',
        sql: `EXPLAIN (ANALYZE, BUFFERS)
              SELECT eff.id, eff.label, ra.value
              FROM event_form_fields eff
              JOIN registration_answers ra ON eff.id = ra.field_id
              WHERE eff.event_id = '00000000-0000-0000-0000-000000000002'::uuid;`,
      },
      {
        name: 'P22 Waitlist Status Breakdown Query (FR-INSIGHT, FR-WAIT)',
        sql: `EXPLAIN (ANALYZE, BUFFERS)
              SELECT COUNT(*)::int AS total,
                     COUNT(*) FILTER (WHERE status = 'WAITING')::int AS waiting,
                     COUNT(*) FILTER (WHERE status = 'CLAIMED')::int AS claimed
              FROM waitlist_entries
              WHERE event_id = '00000000-0000-0000-0000-000000000002'::uuid;`,
      },
    ];

    for (const q of queries) {
      const res = await client.query(q.sql);
      const planLines = res.rows.map((r: any) => r['QUERY PLAN']);
      let execTime = 0;
      for (const line of planLines) {
        if (line.includes('Execution Time:')) {
          const match = line.match(/Execution Time:\s*([0-9.]+)\s*ms/);
          if (match) execTime = parseFloat(match[1]);
        }
      }

      results.push({
        queryName: q.name,
        sql: q.sql,
        plan: planLines,
        executionTimeMs: execTime,
      });
    }

    return results;
  } finally {
    client.release();
  }
}

if (process.argv[1]?.endsWith('explain-analyze-indexes.ts')) {
  runExplainAnalyzeIndexReview()
    .then((results) => {
      console.log('\n======================================================');
      console.log('  EXPLAIN (ANALYZE, BUFFERS) INDEX & QUERY REVIEW');
      console.log('======================================================\n');
      for (const r of results) {
        console.log(`[QUERY] ${r.queryName}`);
        console.log(`Execution Time: ${r.executionTimeMs} ms`);
        console.log(r.plan.slice(0, 5).join('\n'));
        console.log('------------------------------------------------------\n');
      }
      return pool.end();
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
