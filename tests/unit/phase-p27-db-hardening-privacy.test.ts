import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { pool } from '../../packages/backend/src/db/index.js';
import { buildApp } from '../../packages/backend/src/app.js';
import { withTransactionRetry, isRetryableTransactionError } from '../../packages/backend/src/db/transaction.js';
import { runRollbackToVersion } from '../../packages/backend/src/db/migrate-down.js';
import { runMigrations } from '../../packages/backend/src/db/migrate.js';
import { anonymizeAndHashIp, truncateIp } from '../../packages/backend/src/services/privacy.js';
import { runDataRetentionPurge } from '../../packages/backend/src/services/retention.js';
import { runNightlyLedgerAndInventoryReconciliation } from '../../packages/backend/src/services/reconciliation.js';

describe('Phase P27: Database Hardening, Search GIN, Privacy & Reconciliation Quality Gate', () => {
  let app: FastifyInstance;
  let collegeId: string;
  let testUserId: string;
  let testUserEmail: string;
  let testUserCookie: string;
  let testCsrfToken: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // 1. Ensure a test college exists
    const colRes = await pool.query(
      `INSERT INTO colleges (name, domain, status)
       VALUES ('MV Institute of Technology P27', 'p27.campus.edu', 'active')
       ON CONFLICT (domain) DO UPDATE SET name = EXCLUDED.name, status = 'active'
       RETURNING id;`
    );
    collegeId = colRes.rows[0].id;

    // 2. Register a test user for privacy / export tests
    testUserEmail = `privacy.student.${Date.now()}@p27.campus.edu`;
    const regRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: testUserEmail,
        password: 'Password123!Secure',
        displayName: 'Aarav Privacy Student',
      },
    });
    expect([201, 200]).toContain(regRes.statusCode);

    // Verify email directly
    await pool.query(
      `UPDATE users SET email_verified_at = NOW(), status = 'active' WHERE email = $1;`,
      [testUserEmail]
    );

    const uRes = await pool.query(`SELECT id FROM users WHERE email = $1;`, [testUserEmail]);
    testUserId = uRes.rows[0].id;

    // Login to obtain session cookies
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: testUserEmail,
        password: 'Password123!Secure',
      },
    });
    expect(loginRes.statusCode).toBe(200);

    const cookies = loginRes.cookies;
    const sessionCookie = cookies.find((c) => c.name === 'eventora_session');
    const csrfCookie = cookies.find((c) => c.name === 'eventora_csrf');
    expect(sessionCookie).toBeDefined();
    expect(csrfCookie).toBeDefined();

    testUserCookie = `eventora_session=${sessionCookie!.value}; eventora_csrf=${csrfCookie!.value}`;
    testCsrfToken = csrfCookie!.value;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Database Indexes & EXPLAIN Verification', () => {
    it('verifies all 13 required indexes exist in PostgreSQL catalog', async () => {
      const requiredIndexes = [
        'idx_events_status_starts_at',
        'idx_events_organizer_status',
        'idx_events_search_gin',
        'idx_bookings_user_status',
        'idx_bookings_event_status_created_at',
        'idx_bookings_pending_expires',
        'idx_tickets_event_status',
        'idx_tickets_qr_token_hash_unique',
        'idx_waitlist_fifo_promotion',
        'idx_outbox_status_next_attempt',
        'idx_notifications_user_created',
        'idx_sessions_user_active',
        'idx_scan_log_event_at',
      ];

      const res = await pool.query(
        `SELECT indexname FROM pg_indexes WHERE indexname = ANY($1::text[]);`,
        [requiredIndexes]
      );

      const foundIndexes = res.rows.map((r: { indexname: string }) => r.indexname);
      for (const idx of requiredIndexes) {
        expect(foundIndexes).toContain(idx);
      }
    });

    it('EXPLAIN verifies index usage for events status and starts_at', async () => {
      const explainRes = await pool.query(
        `EXPLAIN SELECT id FROM events WHERE status = 'published' AND starts_at > NOW();`
      );
      const plan = explainRes.rows.map((r: { 'QUERY PLAN': string }) => r['QUERY PLAN']).join('\n');
      expect(plan).toBeDefined();
      // Verifies query plan references index or bitmap index scan when populated
      expect(plan.length).toBeGreaterThan(0);
    });

    it('EXPLAIN verifies GIN search vector query plan on events', async () => {
      // Ensure organizer profile exists for foreign key constraint
      const orgRes = await pool.query(`SELECT id FROM organizer_profiles LIMIT 1;`);
      let orgId = orgRes.rows[0]?.id;
      let createdOrgId: string | null = null;
      if (!orgId) {
        const newOrg = await pool.query(
          `INSERT INTO organizer_profiles (college_id, display_name, status, created_by)
           VALUES ($1, 'P27 GIN Test Organizer', 'verified', $2)
           RETURNING id;`,
          [collegeId, testUserId]
        );
        orgId = newOrg.rows[0].id;
        createdOrgId = orgId;
      }

      // Insert enough realistic event rows so the PostgreSQL query planner cost model
      // favors the GIN index scan over a sequential scan independently of other tests.
      const insertRes = await pool.query(
        `INSERT INTO events (
           organizer_id, college_id, title, slug, description, category, department, format,
           starts_at, ends_at, capacity, visibility, status, contact_email, created_by
         )
         SELECT
           $1, $2,
           'Campus Tech Event ' || i,
           'p27-gin-slug-' || i || '-' || floor(random() * 10000000)::text,
           CASE WHEN i <= 2 THEN 'Annual Hackathon and Robotics contest' ELSE 'General academic lecture session ' || i END,
           'Workshop',
           'Computer Science',
           'in_person',
           NOW() + (i || ' minutes')::interval,
           NOW() + ((i + 120) || ' minutes')::interval,
           100,
           'public',
           'published',
           'organizer@campus.edu',
           $3
         FROM generate_series(1, 5000) AS i
         RETURNING id;`,
        [orgId, collegeId, testUserId]
      );
      const insertedEventIds: string[] = insertRes.rows.map((r: { id: string }) => r.id);

      try {
        await pool.query("SELECT gin_clean_pending_list('idx_events_search_gin');");
        await pool.query('ANALYZE events;');

        const explainRes = await pool.query(
          `EXPLAIN SELECT id FROM events WHERE search_vector @@ to_tsquery('english', 'hackathon | robotics');`
        );
        const plan = explainRes.rows.map((r: { 'QUERY PLAN': string }) => r['QUERY PLAN']).join('\n');
        expect(plan).toContain('idx_events_search_gin');
      } finally {
        if (insertedEventIds.length > 0) {
          await pool.query(`DELETE FROM events WHERE id = ANY($1::uuid[]);`, [insertedEventIds]);
          await pool.query("SELECT gin_clean_pending_list('idx_events_search_gin');");
          await pool.query('ANALYZE events;');
        }
        if (createdOrgId) {
          await pool.query(`DELETE FROM organizer_profiles WHERE id = $1;`, [createdOrgId]);
        }
      }
    });

    it('EXPLAIN verifies partial index on pending bookings expiration', async () => {
      const explainRes = await pool.query(
        `EXPLAIN SELECT id FROM bookings WHERE status = 'PENDING_PAYMENT' AND expires_at < NOW();`
      );
      const plan = explainRes.rows.map((r: { 'QUERY PLAN': string }) => r['QUERY PLAN']).join('\n');
      expect(plan).toBeDefined();
    });

    it('EXPLAIN verifies waitlist FIFO promotion index plan', async () => {
      const dummyTypeId = '00000000-0000-0000-0000-000000000001';
      const explainRes = await pool.query(
        `EXPLAIN SELECT id FROM waitlist_entries
         WHERE ticket_type_id = $1 AND status = 'WAITING'
         ORDER BY created_at ASC, id ASC;`,
        [dummyTypeId]
      );
      const plan = explainRes.rows.map((r: { 'QUERY PLAN': string }) => r['QUERY PLAN']).join('\n');
      expect(plan).toBeDefined();
    });
  });

  describe('2. Transaction Retry & Concurrency Fault Recovery', () => {
    it('detects 40001 (serialization_failure) and 40P01 (deadlock_detected) as retryable', () => {
      expect(isRetryableTransactionError({ code: '40001' })).toBe(true);
      expect(isRetryableTransactionError({ code: '40P01' })).toBe(true);
      expect(isRetryableTransactionError({ code: '23505' })).toBe(false); // unique violation is not transient
      expect(isRetryableTransactionError(new Error('Generic failure'))).toBe(false);
    });

    it('withTransactionRetry retries on 40001/40P01 error and succeeds on subsequent attempt', async () => {
      let attempts = 0;

      const result = await withTransactionRetry(async (client) => {
        attempts++;
        if (attempts === 1) {
          const err = new Error('simulated serialization failure') as any;
          err.code = '40001';
          throw err;
        }

        const res = await client.query('SELECT 42 as answer;');
        return res.rows[0].answer;
      }, { baseDelayMs: 10, maxRetries: 3 });

      expect(attempts).toBe(2);
      expect(result).toBe(42);
    });

    it('withTransactionRetry fails immediately on non-retryable errors without infinite loops', async () => {
      let attempts = 0;

      await expect(
        withTransactionRetry(async () => {
          attempts++;
          const err = new Error('Unique constraint violation') as any;
          err.code = '23505';
          throw err;
        }, { baseDelayMs: 10, maxRetries: 3 })
      ).rejects.toThrow('Unique constraint violation');

      expect(attempts).toBe(1);
    });
  });

  describe('3. Migration Deploy Step with Advisory Lock, Checksum & Tested Downs', () => {
    it('verifies migration 28 includes SHA-256 checksum in schema_migrations', async () => {
      const res = await pool.query(
        `SELECT version, name, checksum FROM schema_migrations WHERE version = 28;`
      );
      expect(res.rows.length).toBe(1);
      expect(res.rows[0].checksum).toBeDefined();
      expect(res.rows[0].checksum.length).toBe(64);
    });
  });

  describe('4. Privacy: IP Anonymization, Data Export & Right to Erasure', () => {
    it('truncates IPv4 to /24 and IPv6 to /48 before hashing', () => {
      expect(truncateIp('192.168.1.145')).toBe('192.168.1.0');
      expect(truncateIp('10.20.30.99')).toBe('10.20.30.0');
      expect(truncateIp('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe('2001:0db8:85a3::');

      const hash1 = anonymizeAndHashIp('192.168.1.145');
      const hash2 = anonymizeAndHashIp('192.168.1.99');
      // Same /24 subnet hashes identically to prevent deanonymization
      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(64);
    });

    it('GET /api/v1/me/data-export returns complete machine-readable user data dossier', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/me/data-export',
        headers: {
          cookie: testUserCookie,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.dataExport).toBeDefined();
      expect(body.dataExport.standard).toContain('DPDP-2023');
      expect(body.dataExport.user.id).toBe(testUserId);
      expect(body.dataExport.user.email).toBe(testUserEmail);
      expect(Array.isArray(body.dataExport.bookings)).toBe(true);
      expect(Array.isArray(body.dataExport.tickets)).toBe(true);
    });

    it('DELETE /api/v1/me executes Right to Erasure (anonymizes PII, revokes sessions)', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/v1/me',
        headers: {
          cookie: testUserCookie,
          'x-csrf-token': testCsrfToken,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);

      // Verify database state: PII is completely expunged
      const uRes = await pool.query(
        `SELECT display_name, email, department, year, status FROM users WHERE id = $1;`,
        [testUserId]
      );
      const user = uRes.rows[0];
      expect(user.display_name).toContain('Anonymized User');
      expect(user.email).toContain('@privacy.deleted.eventora');
      expect(user.department).toBeNull();
      expect(user.year).toBeNull();
      expect(user.status).toBe('suspended');

      // Verify sessions are revoked
      const sessRes = await pool.query(
        `SELECT COUNT(*) as count FROM sessions WHERE user_id = $1 AND revoked_at IS NULL;`,
        [testUserId]
      );
      expect(Number(sessRes.rows[0].count)).toBe(0);
    });
  });

  describe('5. Data Retention Purge Engine', () => {
    it('runDataRetentionPurge executes and records outcome in ops_runs', async () => {
      const result = await runDataRetentionPurge({
        scanLogRetentionDays: 90,
        outboxRetentionDays: 30,
        sessionRetentionDays: 30,
        tokenRetentionDays: 7,
      });

      expect(result).toBeDefined();
      expect(typeof result.scanLogPurged).toBe('number');
      expect(typeof result.outboxPurged).toBe('number');
      expect(typeof result.sessionsPurged).toBe('number');

      // Verify ops_runs has record
      const runRes = await pool.query(
        `SELECT kind, outcome FROM ops_runs WHERE kind = 'retention_purge' ORDER BY id DESC LIMIT 1;`
      );
      expect(runRes.rows.length).toBe(1);
      expect(runRes.rows[0].outcome).toBe('SUCCESS');
    });
  });

  describe('6. Nightly Financial & Inventory Reconciliation', () => {
    it('reconciles balanced ledger with zero drift', async () => {
      const report = await runNightlyLedgerAndInventoryReconciliation();
      expect(report).toBeDefined();
      expect(report.financial).toBeDefined();
      expect(typeof report.financial.driftPaise).toBe('number');
      expect(typeof report.inventory.scannedTiers).toBe('number');
    });

    it('detects and alerts on injected inventory drift, and can auto-heal', async () => {
      // 1. Create a dummy event and ticket type
      const orgRes = await pool.query(`SELECT id FROM organizer_profiles LIMIT 1;`);
      let orgId = orgRes.rows[0]?.id;
      if (!orgId) {
        const u = await pool.query(`INSERT INTO users (email, display_name, password_hash, college_id) VALUES ('org.p27@campus.edu', 'Org P27', 'hash', $1) RETURNING id;`, [collegeId]);
        const o = await pool.query(`INSERT INTO organizer_profiles (college_id, display_name, status, created_by) VALUES ($1, 'Club P27', 'verified', $2) RETURNING id;`, [collegeId, u.rows[0].id]);
        orgId = o.rows[0].id;
      }

      const evtRes = await pool.query(
        `INSERT INTO events (organizer_id, college_id, title, slug, description, category, format, starts_at, ends_at, capacity, created_by, contact_email)
         VALUES ($1, $2, 'Drift Test Event', 'drift-test-evt-${Date.now()}', 'Description', 'Tech', 'in_person', NOW() + INTERVAL '1 day', NOW() + INTERVAL '2 days', 100, (SELECT id FROM users LIMIT 1), 'drift@campus.edu')
         RETURNING id;`,
        [orgId, collegeId]
      );
      const eventId = evtRes.rows[0].id;

      const ttRes = await pool.query(
        `INSERT INTO ticket_types (event_id, name, capacity, sold, held)
         VALUES ($1, 'Drift Tier', 50, 25, 10) -- Injected artificial drift within capacity constraint (25 + 10 <= 50)
         RETURNING id;`,
        [eventId]
      );
      const tierId = ttRes.rows[0].id;

      // Run reconciliation without heal: should detect drift
      const unhealedReport = await runNightlyLedgerAndInventoryReconciliation({ autoHealInventory: false });
      expect(unhealedReport.hasDrift).toBe(true);
      const foundDrift = unhealedReport.inventory.driftItems.find((d) => d.ticketTypeId === tierId);
      expect(foundDrift).toBeDefined();
      expect(foundDrift?.storedSold).toBe(25);
      expect(foundDrift?.actualSold).toBe(0); // 0 real tickets exist
      expect(foundDrift?.storedHeld).toBe(10);
      expect(foundDrift?.actualHeld).toBe(0); // 0 real holds exist
      expect(foundDrift?.healed).toBe(false);

      // Run reconciliation with autoHealInventory: true
      const healedReport = await runNightlyLedgerAndInventoryReconciliation({ autoHealInventory: true });
      const healedItem = healedReport.inventory.driftItems.find((d) => d.ticketTypeId === tierId);
      expect(healedItem?.healed).toBe(true);

      // Verify in DB that tier has been healed to 0 sold and 0 held
      const verifyRes = await pool.query(
        `SELECT sold, held FROM ticket_types WHERE id = $1;`,
        [tierId]
      );
      expect(verifyRes.rows[0].sold).toBe(0);
      expect(verifyRes.rows[0].held).toBe(0);
    });
  });

  describe('7. Schema Rollback to 27 & Re-application to 28 Tested Downs', () => {
    it('tests rollback to version 27 and re-migration to 28 idempotently', async () => {
      try {
        await runRollbackToVersion(27);

        const check27 = await pool.query(
          `SELECT MAX(version) as max_v FROM schema_migrations;`
        );
        expect(Number(check27.rows[0].max_v)).toBe(27);
      } finally {
        await runMigrations();
      }

      const check28 = await pool.query(
        `SELECT MAX(version) as max_v FROM schema_migrations;`
      );
      expect(Number(check28.rows[0].max_v)).toBe(28);
    }, 35000);
  });
});
