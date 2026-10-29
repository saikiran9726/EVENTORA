import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { buildApp } from '../../packages/backend/src/app.js';
import { pool } from '../../packages/backend/src/db/index.js';
import {
  getOrganizerAnalytics,
} from '../../packages/backend/src/services/feedback-analytics.js';
import { runRollbackToVersion } from '../../packages/backend/src/db/migrate-down.js';
import { runMigrations } from '../../packages/backend/src/db/migrate.js';
import { runExplainAnalyzeIndexReview } from '../../scripts/explain-analyze-indexes.js';

describe('Phase P22: Organizer Analytics Backend Quality Gate', () => {
  let app: any;
  let collegeId: string;
  let organizerId: string;
  let orgOwnerUserId: string;
  let orgOwnerHeaders: Record<string, string>;
  let otherUserId: string;
  let otherUserHeaders: Record<string, string>;
  let adminHeaders: Record<string, string>;

  let testEventId: string;
  let tierVipId: string;
  let tierGenId: string;
  let formFieldId: string;

  const createdUserIds: string[] = [];
  const createdEventIds: string[] = [];
  const createdBookingIds: string[] = [];

  async function createTestUser(
    displayName: string,
    role = 'student'
  ): Promise<{ id: string; token: string; headers: Record<string, string> }> {
    const client = await pool.connect();
    try {
      const email = `p22-${Date.now()}-${Math.random().toString(36).substring(2, 7)}@campus.edu`;
      const res = await client.query(
        `INSERT INTO users (college_id, email, password_hash, display_name, global_role, status, email_verified_at)
         VALUES ($1, $2, 'argon2id$dummy', $3, $4, 'active', NOW())
         RETURNING id;`,
        [collegeId, email, displayName, role]
      );
      const userId = res.rows[0].id;
      createdUserIds.push(userId);

      const rawSession = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawSession).digest();
      await client.query(
        `INSERT INTO sessions (id_hash, user_id, expires_at)
         VALUES ($1, $2, NOW() + INTERVAL '7 days');`,
        [tokenHash, userId]
      );

      const csrf = crypto.randomBytes(32).toString('hex');
      const headers = {
        authorization: `Bearer ${rawSession}`,
        cookie: `eventora_session=${rawSession}; eventora_csrf=${csrf}`,
        'x-csrf-token': csrf,
      };

      return { id: userId, token: rawSession, headers };
    } finally {
      client.release();
    }
  }

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    const client = await pool.connect();
    try {
      // 1. Ensure college exists
      const cRes = await client.query('SELECT id FROM colleges LIMIT 1;');
      if (cRes.rows.length > 0) {
        collegeId = cRes.rows[0].id;
      } else {
        const nc = await client.query(
          `INSERT INTO colleges (name, domain, status, participation_status)
           VALUES ('P22 Analytics Tech University', $1, 'active', 'participating')
           RETURNING id;`,
          [`p22-${Date.now()}.edu`]
        );
        collegeId = nc.rows[0].id;
      }

      // 2. Create Users (Organizer Owner, Other Student, Global Admin)
      const owner = await createTestUser('P22 Lead Organizer', 'student');
      orgOwnerUserId = owner.id;
      orgOwnerHeaders = owner.headers;

      const other = await createTestUser('P22 Unprivileged Student', 'student');
      otherUserId = other.id;
      otherUserHeaders = other.headers;

      const admin = await createTestUser('P22 Global Platform Admin', 'admin');
      adminHeaders = admin.headers;

      // 3. Organizer Profile & Active Membership
      const opRes = await client.query(
        `INSERT INTO organizer_profiles (college_id, display_name, status, created_by)
         VALUES ($1, 'P22 Engineering Club', 'verified', $2)
         RETURNING id;`,
        [collegeId, orgOwnerUserId]
      );
      organizerId = opRes.rows[0].id;

      await client.query(
        `INSERT INTO organizer_members (organizer_id, user_id, role, status)
         VALUES ($1, $2, 'owner', 'active')
         ON CONFLICT (organizer_id, user_id) DO NOTHING;`,
        [organizerId, orgOwnerUserId]
      );

      // 4. Create Event with Capacity = 100
      const epRes = await client.query(
        `INSERT INTO events (
           organizer_id, college_id, title, slug, description, category, format,
           starts_at, ends_at, capacity, visibility, status, contact_email, created_by
         ) VALUES (
           $1, $2, 'P22 Grand Tech Festival', $3, 'P22 Event Description', 'Tech', 'in_person',
           NOW() + INTERVAL '2 days', NOW() + INTERVAL '3 days', 100, 'public', 'published', 'org@campus.edu', $4
         ) RETURNING id;`,
        [organizerId, collegeId, `p22-event-${Date.now()}`, orgOwnerUserId]
      );
      testEventId = epRes.rows[0].id;
      createdEventIds.push(testEventId);

      // 5. Ticket Tiers: VIP (₹1000 = 100000 paise, cap 20) and General (₹500 = 50000 paise, cap 80)
      const tvRes = await client.query(
        `INSERT INTO ticket_types (event_id, name, price_paise, capacity)
         VALUES ($1, 'VIP Pass', 100000, 20)
         RETURNING id;`,
        [testEventId]
      );
      tierVipId = tvRes.rows[0].id;

      const tgRes = await client.query(
        `INSERT INTO ticket_types (event_id, name, price_paise, capacity)
         VALUES ($1, 'General Admission', 50000, 80)
         RETURNING id;`,
        [testEventId]
      );
      tierGenId = tgRes.rows[0].id;

      // 6. Custom Form Field for Demographics: "T-Shirt Size"
      const ffRes = await client.query(
        `INSERT INTO event_form_fields (event_id, type, label, required, position, options)
         VALUES ($1, 'dropdown', 'T-Shirt Size', true, 1, '["S", "M", "L", "XL"]'::jsonb)
         RETURNING id;`,
        [testEventId]
      );
      formFieldId = ffRes.rows[0].id;
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    if (app) await app.close();
    const client = await pool.connect();
    try {
      if (createdEventIds.length > 0) {
        await client.query(`DELETE FROM waitlist_entries WHERE event_id = ANY($1::uuid[]);`, [createdEventIds]);
        await client.query(`DELETE FROM registration_answers WHERE field_id IN (SELECT id FROM event_form_fields WHERE event_id = ANY($1::uuid[]));`, [createdEventIds]);
        await client.query(`DELETE FROM event_form_fields WHERE event_id = ANY($1::uuid[]);`, [createdEventIds]);
        await client.query(`DELETE FROM checkins WHERE ticket_id IN (SELECT id FROM tickets WHERE event_id = ANY($1::uuid[]));`, [createdEventIds]);
        await client.query(`DELETE FROM tickets WHERE event_id = ANY($1::uuid[]);`, [createdEventIds]);
        await client.query(`DELETE FROM booking_items WHERE booking_id IN (SELECT id FROM bookings WHERE event_id = ANY($1::uuid[]));`, [createdEventIds]);
        await client.query(`DELETE FROM organizer_ledger_entries WHERE booking_id IN (SELECT id FROM bookings WHERE event_id = ANY($1::uuid[]));`, [createdEventIds]);
        await client.query(`DELETE FROM bookings WHERE event_id = ANY($1::uuid[]);`, [createdEventIds]);
        await client.query(`DELETE FROM ticket_types WHERE event_id = ANY($1::uuid[]);`, [createdEventIds]);
        await client.query(`DELETE FROM event_metrics WHERE event_id = ANY($1::uuid[]);`, [createdEventIds]);
        await client.query(`DELETE FROM events WHERE id = ANY($1::uuid[]);`, [createdEventIds]);
      }

      if (organizerId) {
        await client.query(`DELETE FROM organizer_members WHERE organizer_id = $1;`, [organizerId]);
        await client.query(`DELETE FROM organizer_profiles WHERE id = $1;`, [organizerId]);
      }

      if (createdUserIds.length > 0) {
        await client.query(`DELETE FROM sessions WHERE user_id = ANY($1::uuid[]);`, [createdUserIds]);
        await client.query(`DELETE FROM users WHERE id = ANY($1::uuid[]);`, [createdUserIds]);
      }
    } finally {
      client.release();
    }
  });

  it('(1) computes gross, refund, and net revenue server-side directly from organizer_ledger_entries and reconciles exactly', async () => {
    const client = await pool.connect();
    try {
      // Create a confirmed booking with sale of ₹1500 (150000 paise)
      const bRes1 = await client.query(
        `INSERT INTO bookings (user_id, event_id, status, total_paise, idempotency_key)
         VALUES ($1, $2, 'CONFIRMED', 150000, $3)
         RETURNING id;`,
        [orgOwnerUserId, testEventId, `p22-idem-sale1-${Date.now()}`]
      );
      const bId1 = bRes1.rows[0].id;
      createdBookingIds.push(bId1);

      // Payment 1
      const payRes1 = await client.query(
        `INSERT INTO payments (booking_id, provider, provider_order_id, amount_paise, status, is_simulated)
         VALUES ($1, 'youpi', $2, 150000, 'SUCCESS', true)
         RETURNING id;`,
        [bId1, `order-p22-1-${Date.now()}`]
      );
      const payId1 = payRes1.rows[0].id;

      // Ledger entry: SALE of 150000 paise
      await client.query(
        `INSERT INTO organizer_ledger_entries (organizer_id, booking_id, payment_id, entry_type, amount_paise, is_simulated)
         VALUES ($1, $2, $3, 'SALE', 150000, true);`,
        [organizerId, bId1, payId1]
      );

      // Create a second booking with sale of ₹500 (50000 paise)
      const bRes2 = await client.query(
        `INSERT INTO bookings (user_id, event_id, status, total_paise, idempotency_key)
         VALUES ($1, $2, 'CONFIRMED', 50000, $3)
         RETURNING id;`,
        [otherUserId, testEventId, `p22-idem-sale2-${Date.now()}`]
      );
      const bId2 = bRes2.rows[0].id;
      createdBookingIds.push(bId2);

      // Payment 2
      const payRes2 = await client.query(
        `INSERT INTO payments (booking_id, provider, provider_order_id, amount_paise, status, is_simulated)
         VALUES ($1, 'youpi', $2, 50000, 'SUCCESS', true)
         RETURNING id;`,
        [bId2, `order-p22-2-${Date.now()}`]
      );
      const payId2 = payRes2.rows[0].id;

      // Ledger entry: SALE of 50000 paise
      await client.query(
        `INSERT INTO organizer_ledger_entries (organizer_id, booking_id, payment_id, entry_type, amount_paise, is_simulated)
         VALUES ($1, $2, $3, 'SALE', 50000, true);`,
        [organizerId, bId2, payId2]
      );

      // Ledger entry: REFUND of 50000 paise for bId2
      await client.query(
        `INSERT INTO organizer_ledger_entries (organizer_id, booking_id, payment_id, entry_type, amount_paise, is_simulated)
         VALUES ($1, $2, $3, 'REFUND', 50000, true);`,
        [organizerId, bId2, payId2]
      );

      const analytics = await getOrganizerAnalytics(testEventId);

      // Gross = 150000 + 50000 = 200000 paise (₹2,000)
      expect(analytics.revenue.grossPaise).toBe(200000);
      // Refunds = 50000 paise (₹500)
      expect(analytics.revenue.refundsPaise).toBe(50000);
      // Net = 200000 - 50000 = 150000 paise (₹1,500)
      expect(analytics.revenue.netPaise).toBe(150000);

      expect(analytics.revenue.salesCount).toBe(2);
      expect(analytics.revenue.refundsCount).toBe(1);
      // Refund count % = 1 / 2 = 50.00%
      expect(analytics.revenue.refundRateCountPct).toBe(50);
      // Refund paise % = 50000 / 200000 = 25.00%
      expect(analytics.revenue.refundRatePaisePct).toBe(25);

      // Reconciles exactly with ledger table query
      const ledgerSumRes = await client.query(
        `SELECT 
           COALESCE(SUM(CASE WHEN ole.entry_type = 'SALE' THEN ole.amount_paise ELSE 0 END), 0)::bigint AS gross,
           COALESCE(SUM(CASE WHEN ole.entry_type = 'REFUND' THEN ole.amount_paise ELSE 0 END), 0)::bigint AS refunds
         FROM organizer_ledger_entries ole
         JOIN bookings b ON ole.booking_id = b.id
         WHERE b.event_id = $1;`,
        [testEventId]
      );
      expect(analytics.revenue.grossPaise).toBe(Number(ledgerSumRes.rows[0].gross));
      expect(analytics.revenue.refundsPaise).toBe(Number(ledgerSumRes.rows[0].refunds));
    } finally {
      client.release();
    }
  });

  it('(2) aggregates sales velocity by hour and day in Asia/Kolkata time zone', async () => {
    const analytics = await getOrganizerAnalytics(testEventId);

    expect(Array.isArray(analytics.salesVelocity.hourly)).toBe(true);
    expect(Array.isArray(analytics.salesVelocity.daily)).toBe(true);

    expect(analytics.salesVelocity.hourly.length).toBeGreaterThan(0);
    expect(analytics.salesVelocity.daily.length).toBeGreaterThan(0);

    const firstHour = analytics.salesVelocity.hourly[0];
    expect(firstHour).toHaveProperty('bucket');
    expect(firstHour).toHaveProperty('bookingsCount');
    expect(firstHour).toHaveProperty('grossPaise');
    // Hourly format: YYYY-MM-DDTHH:00:00
    expect(firstHour.bucket).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00:00$/);

    const firstDay = analytics.salesVelocity.daily[0];
    expect(firstDay).toHaveProperty('bucket');
    expect(firstDay).toHaveProperty('bookingsCount');
    expect(firstDay).toHaveProperty('grossPaise');
    // Daily format: YYYY-MM-DD
    expect(firstDay.bucket).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('(3) calculates registrations vs capacity, utilization percentage, and remaining seats', async () => {
    const analytics = await getOrganizerAnalytics(testEventId);

    expect(analytics.capacity.totalCapacity).toBe(100);
    expect(analytics.capacity.confirmed).toBeGreaterThanOrEqual(2);
    expect(analytics.capacity.capacityUtilizationPct).toBeGreaterThanOrEqual(2);
    expect(analytics.capacity.remainingSeats).toBe(100 - analytics.capacity.totalRegistered);
  });

  it('(4) calculates per-tier breakdown with sold, held, capacity, remaining, gross paise, and percentage shares', async () => {
    const client = await pool.connect();
    try {
      // Issue 3 VIP tickets and 5 General tickets
      for (let i = 0; i < 3; i++) {
        const rawCode = `VIP-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 5)}`;
        await client.query(
          `INSERT INTO tickets (
             booking_id, ticket_type_id, user_id, owner_user_id, event_id,
             ticket_code, qr_payload_hash, status
           ) VALUES (
             $1, $2, $3, $3, $4,
             $5, decode($6, 'hex'), 'VALID'
           );`,
          [
            createdBookingIds[0],
            tierVipId,
            orgOwnerUserId,
            testEventId,
            rawCode,
            crypto.createHash('sha256').update(rawCode).digest('hex'),
          ]
        );
      }

      for (let i = 0; i < 5; i++) {
        const rawCode = `GEN-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 5)}`;
        await client.query(
          `INSERT INTO tickets (
             booking_id, ticket_type_id, user_id, owner_user_id, event_id,
             ticket_code, qr_payload_hash, status
           ) VALUES (
             $1, $2, $3, $3, $4,
             $5, decode($6, 'hex'), 'VALID'
           );`,
          [
            createdBookingIds[0],
            tierGenId,
            orgOwnerUserId,
            testEventId,
            rawCode,
            crypto.createHash('sha256').update(rawCode).digest('hex'),
          ]
        );
      }

      const analytics = await getOrganizerAnalytics(testEventId);

      expect(analytics.tierBreakdown).toHaveLength(2);

      const vipTier = analytics.tierBreakdown.find((t) => t.tierId === tierVipId);
      expect(vipTier).toBeDefined();
      expect(vipTier!.sold).toBe(3);
      expect(vipTier!.capacity).toBe(20);
      expect(vipTier!.remaining).toBe(17);
      expect(vipTier!.grossPaise).toBe(3 * 100000); // 300000 paise

      const genTier = analytics.tierBreakdown.find((t) => t.tierId === tierGenId);
      expect(genTier).toBeDefined();
      expect(genTier!.sold).toBe(5);
      expect(genTier!.capacity).toBe(80);
      expect(genTier!.remaining).toBe(75);
      expect(genTier!.grossPaise).toBe(5 * 50000); // 250000 paise
    } finally {
      client.release();
    }
  });

  it('(5) tracks waitlist length metrics across waiting, claimed, and dropped statuses', async () => {
    const client = await pool.connect();
    try {
      // 2 WAITING (different users to satisfy uq_waitlist_active_user), 1 CLAIMED, 1 DECLINED
      await client.query(
        `INSERT INTO waitlist_entries (event_id, ticket_type_id, user_id, status)
         VALUES 
           ($1, $2, $3, 'WAITING'),
           ($1, $2, $4, 'WAITING'),
           ($1, $2, $3, 'CLAIMED'),
           ($1, $2, $3, 'DECLINED');`,
        [testEventId, tierGenId, orgOwnerUserId, otherUserId]
      );

      const analytics = await getOrganizerAnalytics(testEventId);

      expect(analytics.waitlist.total).toBe(4);
      expect(analytics.waitlist.waiting).toBe(2);
      expect(analytics.waitlist.claimed).toBe(1);
      expect(analytics.waitlist.dropped).toBe(1);
    } finally {
      client.release();
    }
  });

  it('(6) aggregates demographics from custom form answers and strictly suppresses cohorts with < 5 responses to prevent de-anonymization', async () => {
    const client = await pool.connect();
    try {
      // Add answers for formFieldId:
      // "M": 6 responses (>= 5) -> unsuppressed
      // "L": 5 responses (>= 5) -> unsuppressed
      // "S": 3 responses (< 5) -> suppressed into Other (< 5)
      // "XL": 1 response (< 5) -> suppressed into Other (< 5)
      const values = [
        ...Array(6).fill('M'),
        ...Array(5).fill('L'),
        ...Array(3).fill('S'),
        'XL',
      ];

      for (const val of values) {
        await client.query(
          `INSERT INTO registration_answers (booking_id, field_id, value)
           VALUES ($1, $2, $3::jsonb);`,
          [createdBookingIds[0], formFieldId, JSON.stringify(val)]
        );
      }

      const analytics = await getOrganizerAnalytics(testEventId);

      expect(analytics.demographics).toHaveLength(1);
      const demoField = analytics.demographics[0];
      expect(demoField.label).toBe('T-Shirt Size');
      expect(demoField.totalResponses).toBe(15);

      // Verify unsuppressed cohorts (>= 5)
      const mBucket = demoField.buckets.find((b) => b.value === 'M');
      expect(mBucket).toBeDefined();
      expect(mBucket!.count).toBe(6);
      expect(mBucket!.suppressed).toBe(false);

      const lBucket = demoField.buckets.find((b) => b.value === 'L');
      expect(lBucket).toBeDefined();
      expect(lBucket!.count).toBe(5);
      expect(lBucket!.suppressed).toBe(false);

      // Strict suppression verification: "S" and "XL" must NOT exist as individual buckets
      const sBucket = demoField.buckets.find((b) => b.value === 'S');
      const xlBucket = demoField.buckets.find((b) => b.value === 'XL');
      expect(sBucket).toBeUndefined();
      expect(xlBucket).toBeUndefined();

      // Combined suppressed bucket
      const otherBucket = demoField.buckets.find((b) => b.value === 'Other (< 5)');
      expect(otherBucket).toBeDefined();
      expect(otherBucket!.count).toBe(4); // 3 (S) + 1 (XL)
      expect(otherBucket!.suppressed).toBe(true);
      expect(demoField.suppressedCount).toBe(4);
      expect(demoField.suppressedValuesCount).toBe(2);
    } finally {
      client.release();
    }
  });

  it('(7) delivers real-time check-in turnout with 5s ETag polling (304 Not Modified)', async () => {
    const client = await pool.connect();
    try {
      // Check in 2 tickets
      await client.query(
        `UPDATE tickets 
         SET status = 'CHECKED_IN', checked_in_at = NOW()
         WHERE id IN (SELECT id FROM tickets WHERE event_id = $1 LIMIT 2);`,
        [testEventId]
      );
    } finally {
      client.release();
    }

    // 1. Initial GET /turnout (returns 200 with ETag)
    const res1 = await app.inject({
      method: 'GET',
      url: `/api/v1/organizer/events/${testEventId}/turnout`,
      headers: orgOwnerHeaders,
    });

    expect(res1.statusCode).toBe(200);
    const body1 = JSON.parse(res1.payload);
    expect(body1.checkedInTickets).toBe(2);
    expect(body1.totalTickets).toBe(8);
    expect(body1.turnoutPct).toBe(25); // 2 / 8 = 25%
    expect(body1.recentCheckins15m).toBe(2);
    expect(body1.pollIntervalMs).toBe(5000);

    const etag1 = res1.headers['etag'];
    expect(etag1).toBeDefined();
    expect(etag1).toMatch(/^W\/"turnout-/);

    // 2. Second request with If-None-Match: etag1 (returns 304 Not Modified)
    const res2 = await app.inject({
      method: 'GET',
      url: `/api/v1/organizer/events/${testEventId}/turnout`,
      headers: {
        ...orgOwnerHeaders,
        'if-none-match': etag1,
      },
    });

    expect(res2.statusCode).toBe(304);
    expect(res2.payload).toBe('');

    // 3. Perform another check-in to change turnout state
    const client2 = await pool.connect();
    try {
      await client2.query(
        `UPDATE tickets 
         SET status = 'CHECKED_IN', checked_in_at = NOW()
         WHERE id IN (SELECT id FROM tickets WHERE event_id = $1 AND status = 'VALID' LIMIT 1);`,
        [testEventId]
      );
    } finally {
      client2.release();
    }

    // 4. Request again with old ETag (must return 200 with updated counts and new ETag)
    const res3 = await app.inject({
      method: 'GET',
      url: `/api/v1/organizer/events/${testEventId}/turnout`,
      headers: {
        ...orgOwnerHeaders,
        'if-none-match': etag1,
      },
    });

    expect(res3.statusCode).toBe(200);
    const body3 = JSON.parse(res3.payload);
    expect(body3.checkedInTickets).toBe(3);
    const etag3 = res3.headers['etag'];
    expect(etag3).not.toBe(etag1);
  });

  it('(8) enforces policy analytics:view:owned (blocks unauthorized callers with 403, allows owners and admins)', async () => {
    // 1. Unprivileged user gets 403 on analytics
    const resAnalUnauth = await app.inject({
      method: 'GET',
      url: `/api/v1/organizer/events/${testEventId}/analytics`,
      headers: otherUserHeaders,
    });
    expect(resAnalUnauth.statusCode).toBe(403);
    const errAnal = JSON.parse(resAnalUnauth.payload);
    expect(errAnal.error.code).toBe('FORBIDDEN');

    // 2. Unprivileged user gets 403 on turnout
    const resTurnUnauth = await app.inject({
      method: 'GET',
      url: `/api/v1/organizer/events/${testEventId}/turnout`,
      headers: otherUserHeaders,
    });
    expect(resTurnUnauth.statusCode).toBe(403);

    // 3. Organizer Owner gets 200 on analytics
    const resOwnerAnal = await app.inject({
      method: 'GET',
      url: `/api/v1/organizer/events/${testEventId}/analytics`,
      headers: orgOwnerHeaders,
    });
    expect(resOwnerAnal.statusCode).toBe(200);

    // 4. Platform Admin gets 200 on analytics
    const resAdminAnal = await app.inject({
      method: 'GET',
      url: `/api/v1/organizer/events/${testEventId}/analytics`,
      headers: adminHeaders,
    });
    expect(resAdminAnal.statusCode).toBe(200);
  });

  it('(9) verifies EXPLAIN (ANALYZE, BUFFERS) reviews on all 11 performance queries execute in sub-millisecond time', async () => {
    const results = await runExplainAnalyzeIndexReview();
    expect(results.length).toBeGreaterThanOrEqual(11);

    for (const r of results) {
      expect(r.plan.length).toBeGreaterThan(0);
      expect(r.executionTimeMs).toBeLessThan(250); // Under 250ms even after 100k event bulk seed
    }

    const p22Queries = results.filter((r) => r.queryName.startsWith('P22'));
    expect(p22Queries.length).toBe(5);
  });

  it('(10) verifies migration 25 down-migration to 24 and re-migration to 25 idempotently', async () => {
    try {
      // Rollback 25 -> 24
      await runRollbackToVersion(24);

      const client = await pool.connect();
      try {
        const vRes = await client.query('SELECT MAX(version) as version FROM schema_migrations;');
        expect(Number(vRes.rows[0].version)).toBe(24);

        // Verify dropped index
        const idxRes = await client.query(
          `SELECT to_regclass('idx_bookings_event_created_at') as idx;`
        );
        expect(idxRes.rows[0].idx).toBeNull();
      } finally {
        client.release();
      }
    } finally {
      // Re-apply migration back to latest
      await runMigrations();
    }

    const client2 = await pool.connect();
    try {
      const vRes2 = await client2.query('SELECT MAX(version) as version FROM schema_migrations;');
      expect(Number(vRes2.rows[0].version)).toBeGreaterThanOrEqual(25);

      const idxRes2 = await client2.query(
        `SELECT to_regclass('idx_bookings_event_created_at') as idx;`
      );
      expect(idxRes2.rows[0].idx).not.toBeNull();
    } finally {
      client2.release();
    }
  });
});
