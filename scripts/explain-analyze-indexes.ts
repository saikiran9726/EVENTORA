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
