import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../packages/backend/src/app.js';
import { db, pool } from '../../packages/backend/src/db/index.js';
import { events, organizerProfiles, organizerVerifications, auditLogs } from '../../packages/backend/src/db/schema.js';
import { eq, desc, and } from 'drizzle-orm';
import { FastifyInstance } from 'fastify';

interface AuthSession {
  headers: {
    cookie: string;
    'x-csrf-token': string;
  };
  user: any;
}

describe('Phase 3 Identity & Authorization Verification Suite', () => {
  let app: FastifyInstance;
  let student: AuthSession;
  let reviewer: AuthSession;
  let admin: AuthSession;

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

    student = await loginAs('student1@campus.edu');
    reviewer = await loginAs('reviewer.faculty@campus.edu');
    admin = await loginAs('admin.system@campus.edu');
  });

  afterAll(async () => {
    await app.close();
  });

  // =========================================================================
  // 1. FACULTY REVIEW AUTHORIZATION & STATE TRANSITIONS
  // =========================================================================
  describe('1. Faculty Review Authorization & Lifecycle Integrity', () => {
    let testEventId: string;

    beforeAll(async () => {
      // Create a test event proposal submitted for approval
      const venuesRes = await app.inject({ method: 'GET', url: '/api/v1/venues' });
      const validVenueId = JSON.parse(venuesRes.body).venues[0].id;

      const randomDayOffset = 50 + Math.floor(Math.random() * 500);
      const startsAt = new Date(Date.now() + 86400000 * randomDayOffset).toISOString();
      const endsAt = new Date(Date.now() + 86400000 * randomDayOffset + 7200000).toISOString();

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/events',
        headers: admin.headers,
        payload: {
          title: `Governance Test Proposal ${Date.now()}`,
          description: 'A formal faculty review audit test verifying state machine transitions.',
          category: 'Symposium',
          department: 'Computer Science',
          format: 'in_person',
          contactEmail: 'organizer@campus.edu',
          venueId: validVenueId,
          startsAt,
          endsAt,
          capacity: 100,
        },
      });
      expect(createRes.statusCode).toBe(201);
      testEventId = JSON.parse(createRes.body).event.id;

      // Submit proposal for review
      const submitRes = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${testEventId}/submit`,
        headers: admin.headers,
        payload: {},
      });
      expect(submitRes.statusCode).toBe(200);
      expect(JSON.parse(submitRes.body).event.status).toBe('pending_approval');
    });

    it('1.1. Unauthorized student attempting approval receives exact 403 "Reviewer or admin role required for event:review"', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${testEventId}/approval`,
        headers: student.headers,
        payload: {
          decision: 'approved',
          comments: 'Attempted approval by student role',
        },
      });

      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('FORBIDDEN');
      expect(body.error.message).toBe('Reviewer or admin role required for event:review');
    });

    it('1.2. Anonymous user attempting approval receives 401 Unauthorized', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${testEventId}/approval`,
        payload: {
          decision: 'approved',
          comments: 'Attempted approval without session',
        },
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('1.3. Authorized faculty reviewer successfully approves the event proposal', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${testEventId}/approval`,
        headers: reviewer.headers,
        payload: {
          decision: 'approved',
          comments: 'Complies with campus safety regulations and venue capacity.',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.event).toBeDefined();
      expect(body.event.status).toBe('approved');

      // Verify DB persistence: event status is approved
      const dbEvent = await db.query.events.findFirst({
        where: eq(events.id, testEventId),
      });
      expect(dbEvent?.status).toBe('approved');
    });

    it('1.4. Repeated approval request on already approved event rejects with 409 INVALID_TRANSITION (no corruption)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${testEventId}/approval`,
        headers: reviewer.headers,
        payload: {
          decision: 'approved',
          comments: 'Duplicate approval attempt',
        },
      });

      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('INVALID_TRANSITION');
    });

    it('1.5. Audit trail records the official faculty approval action with actor identity', async () => {
      const auditRes = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.resourceId, testEventId),
            eq(auditLogs.action, 'event.status_changed.approved')
          )
        )
        .orderBy(desc(auditLogs.createdAt))
        .limit(1);

      expect(auditRes.length).toBe(1);
      expect(auditRes[0].actorId).toBe(reviewer.user.id);
      expect(auditRes[0].resourceType).toBe('event');
    });
  });

  // =========================================================================
  // 2. CLUB CHARTER VERIFICATION REPAIR & ALIASES
  // =========================================================================
  describe('2. Club Charter Verification Repair', () => {
    let organizerId: string;

    beforeAll(async () => {
      const seededOrganizer = await db.query.organizerProfiles.findFirst();
      expect(seededOrganizer).toBeDefined();
      organizerId = seededOrganizer!.id;
    });

    it('2.1. Canonical admin verification route POST /api/v1/admin/organizers/:id/verify succeeds for admin', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/organizers/${organizerId}/verify`,
        headers: admin.headers,
        payload: {
          status: 'VERIFIED',
          evidenceRef: 'Official Dean Charter 2026 Canonical Route',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.verification).toBeDefined();
      expect(body.verification.status).toBe('VERIFIED');
    });

    it('2.2. Compatibility alias POST /api/v1/organizers/:id/verification succeeds and delegates to verifyOrganizer', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/organizers/${organizerId}/verification`,
        headers: admin.headers,
        payload: {
          status: 'VERIFIED',
          evidenceRef: 'Official Dean Charter 2026 Compatibility Alias',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.verification).toBeDefined();
      expect(body.verification.status).toBe('VERIFIED');

      // Verify persistent record in organizer_verifications
      const verRecord = await db.query.organizerVerifications.findFirst({
        where: eq(organizerVerifications.organizerId, organizerId),
      });
      expect(verRecord?.status).toBe('VERIFIED');
    });

    it('2.3. Student attempting club verification receives 403 Forbidden on both routes', async () => {
      const res1 = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/organizers/${organizerId}/verify`,
        headers: student.headers,
        payload: { status: 'VERIFIED' },
      });
      expect(res1.statusCode).toBe(403);
      expect(JSON.parse(res1.body).error.code).toBe('FORBIDDEN');

      const res2 = await app.inject({
        method: 'POST',
        url: `/api/v1/organizers/${organizerId}/verification`,
        headers: student.headers,
        payload: { status: 'VERIFIED' },
      });
      expect(res2.statusCode).toBe(403);
      expect(JSON.parse(res2.body).error.code).toBe('FORBIDDEN');
    });
  });

  // =========================================================================
  // 3. ADMIN USER GOVERNANCE & PRIVILEGED ACTIONS
  // =========================================================================
  describe('3. Admin User Governance & Session Revocation', () => {
    it('3.1. Admin updating user status to suspended immediately revokes all active user sessions', async () => {
      // 1. Create and verify a transient student user
      const uniqueEmail = `transient.student.${Date.now()}@campus.edu`;
      const regRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          displayName: 'Transient Student',
          email: uniqueEmail,
          password: 'Eventora#Test2026!',
        },
      });
      expect(regRes.statusCode).toBe(201);
      const transientUserId = JSON.parse(regRes.body).user.id;

      // Verify email so user status is active
      await pool.query(`UPDATE users SET status = 'active', email_verified_at = NOW() WHERE id = $1`, [transientUserId]);

      // 2. Login as the transient student
      const transientSession = await loginAs(uniqueEmail);

      // 3. Confirm transient student can access /api/v1/me
      const meBefore = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: transientSession.headers,
      });
      expect(meBefore.statusCode).toBe(200);

      // 4. Admin suspends transient student
      const suspendRes = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/users/${transientUserId}/role`,
        headers: admin.headers,
        payload: { status: 'suspended' },
      });
      expect(suspendRes.statusCode).toBe(200);

      // 5. Confirm transient student session is immediately revoked on next request
      const meAfter = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: transientSession.headers,
      });
      expect(meAfter.statusCode).toBe(401);
      expect(JSON.parse(meAfter.body).error.code).toBe('UNAUTHORIZED');
    });

    it('3.2. Administrator self-demotion is prevented with 400 SELF_DEMOTION_PROHIBITED', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/users/${admin.user.id}/role`,
        headers: admin.headers,
        payload: { globalRole: 'student' },
      });

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe('SELF_DEMOTION_PROHIBITED');
    });

    it('3.3. Administrator self-suspension is prevented with 400 SELF_SUSPENSION_PROHIBITED', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/users/${admin.user.id}/role`,
        headers: admin.headers,
        payload: { status: 'suspended' },
      });

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe('SELF_SUSPENSION_PROHIBITED');
    });
  });

  // =========================================================================
  // 4. CSRF DOUBLE-SUBMIT PROTECTION ENFORCEMENT
  // =========================================================================
  describe('4. CSRF Double-Submit Protection Enforcement', () => {
    it('4.1. Mutating PATCH request without X-CSRF-Token is rejected with 403 CSRF_INVALID', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/me/preferences',
        headers: {
          cookie: admin.headers.cookie, // Cookie present, but no X-CSRF-Token header
        },
        payload: { theme: 'dark' },
      });

      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body).error.code).toBe('CSRF_INVALID');
    });

    it('4.2. Mutating PATCH request with forged X-CSRF-Token is rejected with 403 CSRF_INVALID', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/me/preferences',
        headers: {
          cookie: admin.headers.cookie,
          'x-csrf-token': 'forged-csrf-token-12345',
        },
        payload: { theme: 'dark' },
      });

      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body).error.code).toBe('CSRF_INVALID');
    });

    it('4.3. Mutating POST request with matching double-submit CSRF token succeeds with 200', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/me/preferences',
        headers: admin.headers,
        payload: { theme: 'dark' },
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).preferences.theme).toBe('dark');
    });
  });
});
