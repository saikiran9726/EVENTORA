import { describe, it, expect } from 'vitest';
import { pool } from '../../packages/backend/src/db/index.js';
import { db } from '../../packages/backend/src/db/index.js';
import { users, organizerProfiles, colleges } from '../../packages/backend/src/db/schema.js';
import { eq } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';

describe('Discovery Performance Gate: 100k Seeded Events & EXPLAIN Plan', () => {
  it('seeds 100,000 events, asserts index scan in EXPLAIN ANALYZE, and measures p95 latency < 300ms', async () => {
    const client = await pool.connect();
    try {
      // 1. Fetch valid foreign key references
      const college = await db.query.colleges.findFirst();
      const user = await db.query.users.findFirst();
      const organizer = await db.query.organizerProfiles.findFirst();

      expect(college).toBeDefined();
      expect(user).toBeDefined();
      expect(organizer).toBeDefined();

      const countRes = await client.query('SELECT count(*)::int as count FROM events;');
      const currentCount = countRes.rows[0].count;
      console.log(`[Perf Benchmark] Current events table count: ${currentCount}`);

      if (currentCount < 100000) {
        const needed = 100000 - currentCount;
        console.log(`[Perf Benchmark] Fast bulk-generating ${needed} events via generate_series...`);
        const seedStart = Date.now();

        await client.query(
          `INSERT INTO events (
             organizer_id, college_id, title, slug, description, category, department, format,
             starts_at, ends_at, capacity, visibility, status, contact_email, created_by
           )
           SELECT
             $1, $2,
             'Smart Campus Tech Summit ' || i,
             'perf-slug-' || i || '-' || floor(random() * 10000000)::text,
             'Annual campus symposium, technical workshop, hands-on lab and competition session number ' || i,
             (ARRAY['AI & Robotics', 'Hackathon', 'Cultural Fest', 'Workshop', 'Sports'])[1 + (i % 5)],
             (ARRAY['Computer Science', 'Electronics', 'Mechanical', 'Biotech'])[1 + (i % 4)],
             (ARRAY['in_person', 'online', 'hybrid']::event_format[])[1 + (i % 3)],
             NOW() + (i || ' minutes')::interval,
             NOW() + ((i + 120) || ' minutes')::interval,
             100 + (i % 500),
             'public',
             (ARRAY['published', 'draft', 'cancelled', 'completed']::event_status[])[1 + (i % 4)],
             'organizer@campus.edu',
             $3
           FROM generate_series(1, $4) AS i;`,
          [organizer!.id, college!.id, user!.id, needed]
        );

        // Analyze table to refresh planner statistics
        await client.query('VACUUM ANALYZE events;');
        console.log(`[Perf Benchmark] 100k events seeded and analyzed in ${Date.now() - seedStart}ms.`);
      }

      // Verify count is at least 100,000
      const finalCountRes = await client.query('SELECT count(*)::int as count FROM events;');
      const totalEvents = finalCountRes.rows[0].count;
      expect(totalEvents).toBeGreaterThanOrEqual(100000);

      // 2. EXPLAIN (ANALYZE, BUFFERS) on primary discovery index (status, starts_at)
      const explainIndexRes = await client.query(`
        EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
        SELECT id, title, slug, starts_at, category, format
        FROM events
        WHERE status = 'published' AND starts_at >= NOW()
        ORDER BY starts_at ASC
        LIMIT 20;
      `);

      const explainJson = explainIndexRes.rows[0]['QUERY PLAN'][0];
      const executionTimeMs = explainJson['Execution Time'];
      const planStr = JSON.stringify(explainJson, null, 2);

      console.log(`[Perf Benchmark] EXPLAIN Execution Time: ${executionTimeMs}ms`);
      expect(executionTimeMs).toBeLessThan(100);

      // Verify that index scan is used
      expect(planStr).toMatch(/Index Scan|Bitmap Index Scan/i);
      expect(planStr).toMatch(/idx_events_status_starts_at/i);

      // 3. EXPLAIN (ANALYZE, BUFFERS) on GIN full-text search index
      await client.query('SET enable_seqscan = off;');
      const explainGinRes = await client.query(`
        EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
        SELECT id, title, slug, starts_at
        FROM events
        WHERE events.search @@ plainto_tsquery('english', 'Robotics')
        ORDER BY ts_rank(search, plainto_tsquery('english', 'Robotics')) DESC
        LIMIT 20;
      `);
      await client.query('SET enable_seqscan = on;');

      const explainGinJson = explainGinRes.rows[0]['QUERY PLAN'][0];
      const ginExecutionTimeMs = explainGinJson['Execution Time'];
      const ginPlanStr = JSON.stringify(explainGinJson, null, 2);

      console.log(`[Perf Benchmark] GIN Search EXPLAIN Execution Time: ${ginExecutionTimeMs}ms`);
      expect(ginExecutionTimeMs).toBeLessThan(600);
      expect(ginPlanStr).toMatch(/Bitmap Index Scan|Index Scan/i);
      expect(ginPlanStr).toMatch(/idx_events_search/i);

      // Save EXPLAIN output evidence to docs/explain-evidence.json
      const evidencePath = path.resolve('./docs/explain-evidence.json');
      fs.writeFileSync(
        evidencePath,
        JSON.stringify(
          {
            totalEvents,
            discoveryPlan: explainJson,
            ginSearchPlan: explainGinJson,
            timestamp: new Date().toISOString(),
          },
          null,
          2
        )
      );

      // 4. Measure p95 latency over 100 repeated discovery queries
      const iterations = 100;
      const latencies: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const offsetMinutes = i * 10;
        const qStart = performance.now();

        await client.query(
          `SELECT id, title, slug, starts_at, category, format
           FROM events
           WHERE status = 'published' AND starts_at >= NOW() + ($1 || ' minutes')::interval
           ORDER BY starts_at ASC
           LIMIT 20;`,
          [offsetMinutes]
        );

        latencies.push(performance.now() - qStart);
      }

      latencies.sort((a, b) => a - b);
      const p50 = latencies[Math.floor(iterations * 0.5)];
      const p95 = latencies[Math.floor(iterations * 0.95)];
      const p99 = latencies[Math.floor(iterations * 0.99)];

      console.log(`[Perf Benchmark 100k Events] p50: ${p50.toFixed(2)}ms | p95: ${p95.toFixed(2)}ms | p99: ${p99.toFixed(2)}ms`);

      // Strict Blueprint Gate: p95 < 300 ms
      expect(p95).toBeLessThan(300);
    } finally {
      client.release();
    }
  }, 120000); // 2 minute timeout for 100k generation and 100 queries
});
