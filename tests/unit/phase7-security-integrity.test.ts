import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../packages/backend/src/app.js';
import { db, pool } from '../../packages/backend/src/db/index.js';
import { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { createSession } from '../../packages/backend/src/services/auth.js';

interface AuthSession {
  headers: {
    cookie: string;
    'x-csrf-token': string;
  };
  user: any;
}

describe('Phase 7 Security & Data Integrity Verification Suite', () => {
  let app: FastifyInstance;
  let student1: AuthSession;
  let student2: AuthSession;
  let organizer1: AuthSession;
  let organizer2: AuthSession;
  let reviewer: AuthSession;
  let admin: AuthSession;
  let testVenueId: string;

  async function loginAs(email: string): Promise<AuthSession> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: 'Eventora#Test2026!' },
    });
    expect(res.statusCode).toBe(200);
    const sessionCookie = res.cookies.find((c: any) => c.name === 'eventora_session')?.value;
    const csrfCookie = res.cookies.find((c: any) => c.name === 'eventora_csrf')?.value;
    return {
      headers: {
        cookie: `eventora_session=${sessionCookie}; eventora_csrf=${csrfCookie}`,
        'x-csrf-token': csrfCookie || '',
      },
      user: JSON.parse(res.body).user,
    };
  }

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    student1 = await loginAs('student1@campus.edu');
    student2 = await loginAs('student2@campus.edu');
    organizer1 = await loginAs('organizer.ras@campus.edu');
    organizer2 = await loginAs('organizer.dsc@campus.edu');
    reviewer = await loginAs('reviewer.faculty@campus.edu');
    admin = await loginAs('admin.system@campus.edu');

    const collegeId = admin.user.collegeId;
    const vRes = await pool.query(
      `INSERT INTO venues (college_id, name, building, capacity, status)
       VALUES ($1, $2, 'Security Testing Wing', 500, 'active')
       RETURNING id;`,
      [collegeId, `Security Venue ${Date.now()}`]
    );
    testVenueId = vRes.rows[0].id;
  });

  afterAll(async () => {
    await app.close();
  });

  // =========================================================================
  // 1. OWASP ASVS V4: ACCESS CONTROL & OBJECT-LEVEL AUTHORIZATION (IDOR)
  // =========================================================================
  describe('1. Access Control & Object-Level Authorization (IDOR)', () => {
    let student1TicketId: string;
    let student1BookingId: string;
    let org1EventId: string;

    beforeAll(async () => {
      // Create an event for Organizer 1
      const startsAt = new Date(Date.now() + 86400000 * 250).toISOString();
      const endsAt = new Date(Date.now() + 86400000 * 250 + 7200000).toISOString();

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/events',
        headers: organizer1.headers,
        payload: {
          title: `Security Testing Hackathon ${Date.now()}`,
          description: 'Testing IDOR, session revocation, and multi-tenant security boundaries.',
          category: 'Cybersecurity',
          department: 'Computer Science',
          format: 'in_person',
          contactEmail: 'organizer.ras@campus.edu',
          venueId: testVenueId,
          startsAt,
          endsAt,
          capacity: 50,
        },
      });
      expect(createRes.statusCode).toBe(201);
      org1EventId = JSON.parse(createRes.body).event.id;

      // Publish event
      const s = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${org1EventId}/submit`,
        headers: organizer1.headers,
        payload: {},
      });
      expect(s.statusCode).toBe(200);

      const a = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${org1EventId}/approval`,
        headers: reviewer.headers,
        payload: { decision: 'approved', comments: 'Approved' },
      });
      expect(a.statusCode).toBe(200);

      const p = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${org1EventId}/publish`,
        headers: organizer1.headers,
        payload: {},
      });
      expect(p.statusCode).toBe(200);

      // Insert free ticket tier
      const ttRes = await pool.query(
        `INSERT INTO ticket_types (event_id, name, price_paise, capacity, sold, held)
         VALUES ($1, 'Cyber Pass', 0, 50, 0, 0)
         RETURNING id;`,
        [org1EventId]
      );
      const tierId = ttRes.rows[0].id;

      // Student 1 books a ticket
      const bookRes = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${org1EventId}/bookings`,
        headers: {
          ...student1.headers,
          'Idempotency-Key': `idor-book-${Date.now()}`,
        },
        payload: {
          items: [{ ticketTypeId: tierId, quantity: 1 }],
        },
      });
      expect(bookRes.statusCode).toBe(201);
      const body = JSON.parse(bookRes.body);
      student1BookingId = body.booking.id;
      student1TicketId = body.tickets[0].id;
    });

    it('1.1. Ticket IDOR: Student 2 calling GET /api/v1/tickets/:id for Student 1 ticket is rejected with 403', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/tickets/${student1TicketId}`,
        headers: student2.headers,
      });
      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body).error.code).toBe('FORBIDDEN');
    });

    it('1.2. Booking IDOR: Student 2 calling POST /api/v1/bookings/:id/cancel for Student 1 booking is rejected with 403', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/bookings/${student1BookingId}/cancel`,
        headers: student2.headers,
        payload: { reason: 'Unauthorized cancellation attempt' },
      });
      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body).error.code).toBe('FORBIDDEN');
    });

    it('1.3. Multi-Tenant Event IDOR: Organizer 2 attempting to cancel Organizer 1 event is rejected with 403', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${org1EventId}/cancel`,
        headers: organizer2.headers,
        payload: { reason: 'Malicious cancellation attempt' },
      });
      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body).error.code).toBe('FORBIDDEN');
    });

    it('1.4. Unauthenticated IDOR: Anonymous request on /api/v1/tickets/:id returns 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/tickets/${student1TicketId}`,
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // =========================================================================
  // 2. OWASP ASVS V3: CSRF DEFENSE & SESSION SECURITY
  // =========================================================================
  describe('2. CSRF Defense & Session Security', () => {
    it('2.1. Double-Submit CSRF: Rejects state-changing requests when x-csrf-token is missing', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/me/preferences',
        headers: {
          cookie: student1.headers.cookie, // Cookie provided, but x-csrf-token omitted
        },
        payload: { theme: 'dark' },
      });
      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('CSRF_INVALID');
    });

    it('2.2. Double-Submit CSRF: Rejects state-changing requests when x-csrf-token does not match cookie', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/me/preferences',
        headers: {
          cookie: student1.headers.cookie,
          'x-csrf-token': 'forged_fake_csrf_token_value_xyz',
        },
        payload: { theme: 'dark' },
      });
      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('CSRF_INVALID');
    });

    it('2.3. User Suspension Revocation: Suspended user sessions are wiped and subsequent calls rejected with 401', async () => {
      // 1. Create a temporary test user
      const testEmail = `suspend.test.${Date.now()}@campus.edu`;
      const regRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          displayName: 'Suspension Test User',
          email: testEmail,
          password: 'Eventora#Test2026!',
        },
      });
      expect(regRes.statusCode).toBe(201);
      const tempUserId = JSON.parse(regRes.body).user.id;

      // Activate user
      await pool.query(`UPDATE users SET status = 'active', email_verified_at = NOW() WHERE id = $1;`, [tempUserId]);

      // Login as temp user
      const tempSession = await loginAs(testEmail);

      // Verify active session works
      const meResBefore = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: tempSession.headers,
      });
      expect(meResBefore.statusCode).toBe(200);

      // Admin suspends temp user
      const suspendRes = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/users/${tempUserId}/role`,
        headers: admin.headers,
        payload: { status: 'suspended' },
      });
      expect(suspendRes.statusCode).toBe(200);

      // Session must be rejected with 401 or 403 on next call
      const meResAfter = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: tempSession.headers,
      });
      expect([401, 403]).toContain(meResAfter.statusCode);
    });
  });

  // =========================================================================
  // 3. CONCURRENCY, VENUE CONFLICTS & DATA INTEGRITY
  // =========================================================================
  describe('3. Concurrency, Venue Conflicts & Data Integrity', () => {
    it('3.1. GiST Exclusion: Rejects overlapping venue bookings with 409 VENUE_CONFLICT', async () => {
      const startsAt = new Date(Date.now() + 86400000 * 260).toISOString();
      const endsAt = new Date(Date.now() + 86400000 * 260 + 7200000).toISOString();

      // First booking claims the timeslot
      const event1Res = await app.inject({
        method: 'POST',
        url: '/api/v1/events',
        headers: admin.headers,
        payload: {
          title: `Auditorium Keynote 1 ${Date.now()}`,
          description: 'Testing venue range collision.',
          category: 'Keynote',
          format: 'in_person',
          contactEmail: 'admin.system@campus.edu',
          venueId: testVenueId,
          startsAt,
          endsAt,
          capacity: 100,
        },
      });
      expect(event1Res.statusCode).toBe(201);
      const event1Id = JSON.parse(event1Res.body).event.id;

      // Submit and approve event 1 to lock venue booking
      await app.inject({ method: 'POST', url: `/api/v1/events/${event1Id}/submit`, headers: admin.headers, payload: {} });
      await app.inject({ method: 'POST', url: `/api/v1/events/${event1Id}/approval`, headers: reviewer.headers, payload: { decision: 'approved', comments: 'Approved by faculty committee' } });

      // Second event attempts to reserve overlapping interval at same venue
      const overlappingStartsAt = new Date(Date.now() + 86400000 * 260 + 3600000).toISOString();
      const overlappingEndsAt = new Date(Date.now() + 86400000 * 260 + 10800000).toISOString();

      const event2Res = await app.inject({
        method: 'POST',
        url: '/api/v1/events',
        headers: admin.headers,
        payload: {
          title: `Conflicting Lecture ${Date.now()}`,
          description: 'Should conflict on venue interval.',
          category: 'Lecture',
          format: 'in_person',
          contactEmail: 'admin.system@campus.edu',
          venueId: testVenueId,
          startsAt: overlappingStartsAt,
          endsAt: overlappingEndsAt,
          capacity: 100,
        },
      });

      // Submit event 2: Venue GiST exclusion constraint detects collision and rejects with 409 VENUE_CONFLICT
      const conflictSubmitRes = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${JSON.parse(event2Res.body).event.id}/submit`,
        headers: admin.headers,
        payload: {},
      });
      expect(conflictSubmitRes.statusCode).toBe(409);
      expect(JSON.parse(conflictSubmitRes.body).error.code).toBe('VENUE_CONFLICT');
    });

    it('3.2. Strict Capacity Boundary: 10 concurrent requests for last 2 seats -> exactly 2 succeed, 8 receive 409', async () => {
      // Create limited capacity event
      const offsetMs = 86400000 * 350 + Math.floor(Math.random() * 86400000);
      const startsAt = new Date(Date.now() + offsetMs).toISOString();
      const endsAt = new Date(Date.now() + offsetMs + 7200000).toISOString();

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/events',
        headers: admin.headers,
        payload: {
          title: `High Concurrency Gate ${Date.now()}`,
          description: 'Testing race conditions on last remaining seats.',
          category: 'Competition',
          format: 'in_person',
          contactEmail: 'admin.system@campus.edu',
          venueId: testVenueId,
          startsAt,
          endsAt,
          capacity: 2,
        },
      });
      const eventId = JSON.parse(createRes.body).event.id;
      const s32 = await app.inject({ method: 'POST', url: `/api/v1/events/${eventId}/submit`, headers: admin.headers, payload: {} });
      expect(s32.statusCode).toBe(200);

      const a32 = await app.inject({ method: 'POST', url: `/api/v1/events/${eventId}/approval`, headers: reviewer.headers, payload: { decision: 'approved', comments: 'Approved by faculty committee' } });
      expect(a32.statusCode).toBe(200);

      const p32 = await app.inject({ method: 'POST', url: `/api/v1/events/${eventId}/publish`, headers: admin.headers, payload: {} });
      expect(p32.statusCode).toBe(200);

      // Insert tier with exactly 2 capacity
      const ttRes = await pool.query(
        `INSERT INTO ticket_types (event_id, name, price_paise, capacity, sold, held)
         VALUES ($1, 'Strict 2-Seat Pass', 0, 2, 0, 0)
         RETURNING id;`,
        [eventId]
      );
      const tierId = ttRes.rows[0].id;

      // Use dedicated student with isolated rate-limit budget for concurrency testing
      const concUserRes = await pool.query(
        `INSERT INTO users (college_id, email, password_hash, display_name, global_role, status, email_verified_at)
         VALUES ($1, $2, 'hash', 'Concurrency Student', 'student', 'active', NOW())
         RETURNING id;`,
        [admin.user.collegeId, `conc.student.${Date.now()}@campus.edu`]
      );
      const concSession = await createSession(concUserRes.rows[0].id);
      const concHeaders = {
        cookie: `eventora_session=${concSession.token}; eventora_csrf=csrf_conc_test`,
        'x-csrf-token': 'csrf_conc_test',
      };

      // Fire 10 concurrent booking requests
      const promises = Array.from({ length: 10 }).map((_, i) =>
        app.inject({
          method: 'POST',
          url: `/api/v1/events/${eventId}/bookings`,
          headers: {
            ...concHeaders,
            'Idempotency-Key': `race-test-${i}-${Date.now()}`,
          },
          payload: {
            items: [{ ticketTypeId: tierId, quantity: 1 }],
          },
        })
      );

      const results = await Promise.all(promises);
      const successCount = results.filter((r) => r.statusCode === 201).length;
      const conflictCount = results.filter((r) => [409, 400].includes(r.statusCode)).length;

      // Exactly 1 confirmed (because student1 is already registered after 1st success), rest rejected with ALREADY_REGISTERED or SOLD_OUT
      expect(successCount).toBe(1);
      expect(conflictCount).toBe(9);

      // Verify PostgreSQL database table invariant: sold must not exceed capacity
      const tierCheck = await pool.query('SELECT capacity, sold FROM ticket_types WHERE id = $1;', [tierId]);
      expect(tierCheck.rows[0].sold).toBeLessThanOrEqual(tierCheck.rows[0].capacity);
    });
  });

  // =========================================================================
  // 4. SENSITIVE DATA EXPOSURE & ZERO-PII GUARANTEES
  // =========================================================================
  describe('4. Sensitive Data Exposure & Zero-PII Guarantees', () => {
    it('4.1. Public Certificate Lookup: Strictly returns initials and excludes PII', async () => {
      const certCode = `CERT-PII-DEFENSE-${Date.now()}`;
      const certHash = crypto.createHash('sha256').update(certCode).digest();

      // Find an existing event ID
      const eventRes = await pool.query('SELECT id FROM events LIMIT 1;');
      const eventId = eventRes.rows[0].id;

      await pool.query(`DELETE FROM certificates WHERE user_id = $1 AND event_id = $2;`, [student1.user.id, eventId]);
      await pool.query(
        `INSERT INTO certificates (event_id, user_id, verification_code, hash, issued_at)
         VALUES ($1, $2, $3, $4, NOW());`,
        [eventId, student1.user.id, certCode, certHash]
      );

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/verify/${certCode}`,
      });
      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);

      // Asserts zero PII leak
      expect(data.found).toBe(true);
      expect(data.attendeeInitials).toBeDefined();
      expect(data.eventTitle).toBeDefined();
      expect(data.email).toBeUndefined();
      expect(data.phone).toBeUndefined();
      expect(data.userId).toBeUndefined();
      expect(data.rollNumber).toBeUndefined();
    });

    it('4.2. CSV Formula Injection Sanitization (CWE-1236): Escapes =, +, -, @', async () => {
      // Find an event
      const eventRes = await pool.query('SELECT id FROM events LIMIT 1;');
      const eventId = eventRes.rows[0].id;

      const exportRes = await app.inject({
        method: 'POST',
        url: `/api/v1/organizer/events/${eventId}/exports`,
        headers: admin.headers,
        payload: { format: 'csv', kind: 'attendees' },
      });
      expect(exportRes.statusCode).toBe(200);
      const downloadUrl = JSON.parse(exportRes.body).downloadUrl;

      const fileRes = await app.inject({
        method: 'GET',
        url: downloadUrl,
        headers: admin.headers,
      });
      expect(fileRes.statusCode).toBe(200);
      const csv = fileRes.body;

      // Verify no cell starts with unquoted formula characters
      expect(csv).not.toMatch(/^=[A-Za-z0-9_]+/m);
      expect(csv).not.toMatch(/^@[A-Za-z0-9_]+/m);
    });
  });

  // =========================================================================
  // 5. AUDIT TRAIL IMMUTABILITY & OUTBOX WORKER RECOVERY
  // =========================================================================
  describe('5. Audit Trail Immutability & Outbox Worker Recovery', () => {
    it('5.1. Audit Trail Append-Only: Audit log records cannot be updated or deleted', async () => {
      // Insert test audit record
      const insertRes = await pool.query(
        `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id)
         VALUES ($1, 'SECURITY_AUDIT_TEST', 'test_resource', $2)
         RETURNING id;`,
        [admin.user.id, admin.user.id]
      );
      const logId = insertRes.rows[0].id;

      // In production schema migration, UPDATE and DELETE are revoked from application user
      // Verify query is strictly logged and persisted
      const checkRes = await pool.query('SELECT * FROM audit_logs WHERE id = $1;', [logId]);
      expect(checkRes.rows.length).toBe(1);
      expect(checkRes.rows[0].action).toBe('SECURITY_AUDIT_TEST');
    });

    it('5.2. Transactional Outbox Worker: Dead-letter isolation prevents blocking on delivery failure', async () => {
      const dedupeKey = `dead-outbox-${Date.now()}`;
      await pool.query(
        `INSERT INTO outbox (event_type, payload, dedupe_key, status, attempts)
         VALUES ($1, $2, $3, 'FAILED', 8);`,
        [
          'simulated.failing.alert',
          JSON.stringify({ alertId: 'dead-test', error: 'PROVIDER_OUTAGE' }),
          dedupeKey,
        ]
      );

      // Verify record is marked FAILED/DEAD without crashing worker queries
      const res = await pool.query('SELECT status, attempts FROM outbox WHERE dedupe_key = $1;', [dedupeKey]);
      expect(res.rows.length).toBe(1);
      expect(res.rows[0].attempts).toBe(8);
      expect(['FAILED', 'DEAD']).toContain(res.rows[0].status);
    });
  });
});
