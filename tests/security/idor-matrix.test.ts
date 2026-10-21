import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../packages/backend/src/app.js';
import { pool } from '../../packages/backend/src/db/index.js';
import { FastifyInstance } from 'fastify';

describe('Phase 11 Security Gate: Automated IDOR & Route Authorization Matrix (OWASP ASVS L2)', () => {
  let app: FastifyInstance;
  let studentAId: string;
  let studentBId: string;
  let organizerAId: string;
  let organizerBId: string;
  let organizerProfileAId: string;
  let studentAToken: string;
  let studentACsrf: string;
  let studentBToken: string;
  let studentBCsrf: string;
  let testEventId: string;
  let studentABookingId: string;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    // Seed test users & events
    const client = await pool.connect();
    try {
      const colRes = await client.query('SELECT id FROM colleges LIMIT 1;');
      const collegeId = colRes.rows[0].id;

      // Student A
      const sa = await client.query(`
        INSERT INTO users (email, password_hash, display_name, college_id, global_role, status)
        VALUES ('student_a_idor@test.edu', 'hash', 'Student A', $1, 'student', 'active')
        ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
        RETURNING id;
      `, [collegeId]);
      studentAId = sa.rows[0].id;

      // Student B
      const sb = await client.query(`
        INSERT INTO users (email, password_hash, display_name, college_id, global_role, status)
        VALUES ('student_b_idor@test.edu', 'hash', 'Student B', $1, 'student', 'active')
        ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
        RETURNING id;
      `, [collegeId]);
      studentBId = sb.rows[0].id;

      // Organizer A
      const oa = await client.query(`
        INSERT INTO users (email, password_hash, display_name, college_id, global_role, status)
        VALUES ('organizer_a_idor@test.edu', 'hash', 'Org A', $1, 'student', 'active')
        ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
        RETURNING id;
      `, [collegeId]);
      organizerAId = oa.rows[0].id;

      // Organizer B
      const ob = await client.query(`
        INSERT INTO users (email, password_hash, display_name, college_id, global_role, status)
        VALUES ('organizer_b_idor@test.edu', 'hash', 'Org B', $1, 'student', 'active')
        ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
        RETURNING id;
      `, [collegeId]);
      organizerBId = ob.rows[0].id;

      // Organizer Profiles A & B
      const orgAProf = await client.query(`
        INSERT INTO organizer_profiles (college_id, display_name, status, created_by)
        VALUES ($1, 'IDOR Org A', 'verified', $2)
        RETURNING id;
      `, [collegeId, organizerAId]);
      organizerProfileAId = orgAProf.rows[0].id;

      const orgBProf = await client.query(`
        INSERT INTO organizer_profiles (college_id, display_name, status, created_by)
        VALUES ($1, 'IDOR Org B', 'verified', $2)
        RETURNING id;
      `, [collegeId, organizerBId]);
      const organizerProfileBId = orgBProf.rows[0].id;

      // Test Event
      const ev = await client.query(`
        INSERT INTO events (title, slug, description, format, contact_email, created_by, organizer_id, college_id, category, starts_at, ends_at, capacity, status, visibility)
        VALUES ('IDOR Event', 'idor-event-${Date.now()}', 'IDOR Test Event Description', 'in_person', 'contact@campus.edu', $1, $2, $3, 'Tech', NOW() + INTERVAL '1 day', NOW() + INTERVAL '2 days', 50, 'published', 'public')
        RETURNING id;
      `, [organizerAId, organizerProfileAId, collegeId]);
      testEventId = ev.rows[0].id;

      // Booking belonging to Student A
      const bk = await client.query(`
        INSERT INTO bookings (user_id, event_id, status, total_paise, idempotency_key)
        VALUES ($1, $2, 'CONFIRMED', 0, 'idemp-idor-${Date.now()}')
        RETURNING id;
      `, [studentAId, testEventId]);
      studentABookingId = bk.rows[0].id;

      // Create valid sessions
      const crypto = await import('crypto');
      studentAToken = crypto.randomBytes(32).toString('hex');
      studentACsrf = crypto.randomBytes(32).toString('hex');
      const hashA = crypto.createHash('sha256').update(studentAToken).digest();

      await client.query(`
        INSERT INTO sessions (id_hash, user_id, expires_at)
        VALUES ($1, $2, NOW() + INTERVAL '1 day');
      `, [hashA, studentAId]);

      studentBToken = crypto.randomBytes(32).toString('hex');
      studentBCsrf = crypto.randomBytes(32).toString('hex');
      const hashB = crypto.createHash('sha256').update(studentBToken).digest();

      await client.query(`
        INSERT INTO sessions (id_hash, user_id, expires_at)
        VALUES ($1, $2, NOW() + INTERVAL '1 day');
      `, [hashB, studentBId]);
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    await app.close();
  });

  // Test 1: Student B attempting to access Student A's booking
  it('1. IDOR Prevention: Student B cannot access Student A booking', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/bookings/${studentABookingId}`,
      headers: {
        cookie: `eventora_session=${studentBToken}; eventora_csrf=${studentBCsrf}`,
      },
    });

    // Must be 403 Forbidden or 404 Not Found (no cross-tenant leakage)
    expect([403, 404]).toContain(res.statusCode);
  });

  // Test 2: Student attempting to approve an event (requires reviewer/admin)
  it('2. Privilege Escalation: Student cannot approve events (requires event:review)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${testEventId}/approval`,
      headers: {
        cookie: `eventora_session=${studentAToken}; eventora_csrf=${studentACsrf}`,
        'x-csrf-token': studentACsrf,
      },
      payload: { decision: 'approved', comments: 'Self approval attempt' },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  // Test 3: Student attempting check-in scan (requires checkin staff capability)
  it('3. Capability Gate: Unauthorized student cannot scan ticket QR', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${testEventId}/check-in/scan`,
      headers: {
        cookie: `eventora_session=${studentAToken}; eventora_csrf=${studentACsrf}`,
        'x-csrf-token': studentACsrf,
      },
      payload: { token: 'https://eventora.campus.edu/t/simulated-opaque-qr-token-string' },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  // Test 4: Organizer B accessing Organizer A analytics
  it('4. Multi-Tenant Isolation: Organizer B cannot view Organizer A private ledger/metrics', async () => {
    // Generate token for Organizer B
    const crypto = await import('crypto');
    const tokenB = crypto.randomBytes(32).toString('hex');
    const hashB = crypto.createHash('sha256').update(tokenB).digest();
    const csrfB = crypto.randomBytes(32).toString('hex');

    await pool.query(`
      INSERT INTO sessions (id_hash, user_id, expires_at)
      VALUES ($1, $2, NOW() + INTERVAL '1 day');
    `, [hashB, organizerBId]);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/organizers/${organizerProfileAId}/ledger`,
      headers: {
        cookie: `eventora_session=${tokenB}; eventora_csrf=${csrfB}`,
      },
    });

    expect([403, 404]).toContain(res.statusCode);
  });

  // Test 5: Anonymous unauthenticated event proposal rejection
  it('5. Deny-by-default: Anonymous user cannot create an event', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      payload: { title: 'Unauthorized Event' },
    });

    expect(res.statusCode).toBe(401);
  });
});
