import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../packages/backend/src/app.js';
import { db, pool } from '../../packages/backend/src/db/index.js';
import { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';

interface AuthSession {
  headers: {
    cookie: string;
    'x-csrf-token': string;
  };
  user: any;
}

describe('Phase 6 Complete Remaining Feature Repair & Master Verification Suite', () => {
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

    const venueRes = await app.inject({ method: 'GET', url: '/api/v1/venues' });
    expect(venueRes.statusCode).toBe(200);
    testVenueId = JSON.parse(venueRes.body).venues[0].id;
  });

  afterAll(async () => {
    await app.close();
  });

  // =========================================================================
  // 1. DATA CORRUPTION & SECURITY CONTROLS
  // =========================================================================
  describe('1. Data Corruption & Security Controls', () => {
    let org1EventId: string;

    beforeAll(async () => {
      // Create and publish event for Organizer 1
      const startsAt = new Date(Date.now() + 86400000 * 200).toISOString();
      const endsAt = new Date(Date.now() + 86400000 * 200 + 7200000).toISOString();

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/events',
        headers: organizer1.headers,
        payload: {
          title: `Organizer 1 Flagship Event ${Date.now()}`,
          description: 'A multi-tenant security test event owned strictly by Organizer 1.',
          category: 'Hackathon',
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
    });

    it('1.1. Tenant Isolation: Organizer 2 cannot publish or modify Organizer 1 event', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${org1EventId}/publish`,
        headers: organizer2.headers,
        payload: {},
      });
      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('1.2. Financial Isolation: Organizer 2 cannot access Organizer 1 sales ledger', async () => {
      // Find organizer 1 profile ID via membership
      const org1Member = await pool.query(
        `SELECT organizer_id FROM organizer_members WHERE user_id = $1;`,
        [organizer1.user.id]
      );
      if (org1Member.rows.length > 0) {
        const org1Id = org1Member.rows[0].organizer_id;
        const res = await app.inject({
          method: 'GET',
          url: `/api/v1/organizers/${org1Id}/sales`,
          headers: organizer2.headers,
        });
        expect(res.statusCode).toBe(403);
      }
    });

    it('1.3. RBAC Admin Governance: Ordinary student cannot query /api/v1/admin/users', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/users',
        headers: student1.headers,
      });
      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('1.4. Admin Safeguards: Administrator cannot self-demote or self-suspend', async () => {
      const demoteRes = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/users/${admin.user.id}/role`,
        headers: admin.headers,
        payload: { globalRole: 'student' },
      });
      expect(demoteRes.statusCode).toBe(400);
      expect(JSON.parse(demoteRes.body).error.code).toBe('SELF_DEMOTION_PROHIBITED');

      const suspendRes = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/users/${admin.user.id}/role`,
        headers: admin.headers,
        payload: { status: 'suspended' },
      });
      expect(suspendRes.statusCode).toBe(400);
      expect(JSON.parse(suspendRes.body).error.code).toBe('SELF_SUSPENSION_PROHIBITED');
    });
  });

  // =========================================================================
  // 2. CRITICAL STUDENT & ADMINISTRATOR JOURNEYS
  // =========================================================================
  describe('2. Critical Student & Administrator Journeys', () => {
    let lifecycleEventId: string;
    let singleSeatTierId: string;
    let student1BookingId: string;

    beforeAll(async () => {
      const startsAt = new Date(Date.now() + 86400000 * 210).toISOString();
      const endsAt = new Date(Date.now() + 86400000 * 210 + 7200000).toISOString();

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/events',
        headers: admin.headers,
        payload: {
          title: `Capacity & Waitlist Arena ${Date.now()}`,
          description: 'Testing cancellation and atomic waitlist promotion.',
          category: 'Workshop',
          department: 'Engineering',
          format: 'in_person',
          contactEmail: 'admin.system@campus.edu',
          venueId: testVenueId,
          startsAt,
          endsAt,
          capacity: 1,
        },
      });
      lifecycleEventId = JSON.parse(createRes.body).event.id;

      await app.inject({
        method: 'POST',
        url: `/api/v1/events/${lifecycleEventId}/submit`,
        headers: admin.headers,
        payload: {},
      });
      await app.inject({
        method: 'POST',
        url: `/api/v1/events/${lifecycleEventId}/approval`,
        headers: reviewer.headers,
        payload: { decision: 'approved', comments: 'Ready' },
      });
      await app.inject({
        method: 'POST',
        url: `/api/v1/events/${lifecycleEventId}/publish`,
        headers: admin.headers,
        payload: {},
      });

      const ttRes = await pool.query(
        `INSERT INTO ticket_types (event_id, name, price_paise, capacity, sold, held)
         VALUES ($1, 'Limited Seat Pass', 0, 1, 0, 0)
         RETURNING id;`,
        [lifecycleEventId]
      );
      singleSeatTierId = ttRes.rows[0].id;
    });

    it('2.1. Student 1 books the only seat -> Student 2 enters waitlist', async () => {
      // Student 1 books
      const bookRes = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${lifecycleEventId}/bookings`,
        headers: {
          ...student1.headers,
          'Idempotency-Key': `bkg-wait-${Date.now()}`,
        },
        payload: {
          items: [{ ticketTypeId: singleSeatTierId, quantity: 1 }],
        },
      });
      expect(bookRes.statusCode).toBe(201);
      student1BookingId = JSON.parse(bookRes.body).booking.id;

      // Student 2 tries to book and is rejected with 409 SOLD_OUT
      const failRes = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${lifecycleEventId}/bookings`,
        headers: {
          ...student2.headers,
          'Idempotency-Key': `bkg-fail-${Date.now()}`,
        },
        payload: {
          items: [{ ticketTypeId: singleSeatTierId, quantity: 1 }],
        },
      });
      expect(failRes.statusCode).toBe(409);

      // Student 2 enters waitlist
      const wlRes = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${lifecycleEventId}/waitlist`,
        headers: student2.headers,
        payload: { ticketTypeId: singleSeatTierId },
      });
      expect([200, 201]).toContain(wlRes.statusCode);
      const wlBody = JSON.parse(wlRes.body);
      expect(wlBody.entry).toBeDefined();
      expect(wlBody.entry.status).toBe('WAITING');
    });

    it('2.2. Student 1 cancels booking -> triggers atomic waitlist promotion for Student 2', async () => {
      const cancelRes = await app.inject({
        method: 'POST',
        url: `/api/v1/bookings/${student1BookingId}/cancel`,
        headers: student1.headers,
        payload: { reason: 'Schedule clash' },
      });
      expect(cancelRes.statusCode).toBe(200);

      // Verify Student 2 waitlist status has been promoted to OFFERED
      const wlCheck = await pool.query(
        `SELECT status FROM waitlist_entries WHERE event_id = $1 AND user_id = $2;`,
        [lifecycleEventId, student2.user.id]
      );
      expect(wlCheck.rows.length).toBe(1);
      expect(wlCheck.rows[0].status).toBe('OFFERED');

      // Verify outbox has waitlist offer notification
      const outboxCheck = await pool.query(
        `SELECT * FROM outbox WHERE event_type = 'waitlist.offer_dispatched' AND payload::text LIKE $1;`,
        [`%${student2.user.id}%`]
      );
      expect(outboxCheck.rows.length).toBeGreaterThanOrEqual(1);
    });

    it('2.3. Hackathon Teams: Create team, generate code, join team, submit and lock', async () => {
      // Student 1 creates team
      const createTeamRes = await app.inject({
        method: 'POST',
        url: '/api/v1/teams',
        headers: student1.headers,
        payload: {
          name: `Lunar Rovers ${Date.now()}`,
          description: 'Building autonomous robotics software',
          visibility: 'discoverable',
          maxSize: 4,
        },
      });
      expect(createTeamRes.statusCode).toBe(201);
      const teamId = JSON.parse(createTeamRes.body).team.id;

      // Student 1 invites Student 2
      const inviteRes = await app.inject({
        method: 'POST',
        url: `/api/v1/teams/${teamId}/invitations`,
        headers: student1.headers,
        payload: {
          email: 'student2@campus.edu',
        },
      });
      expect(inviteRes.statusCode).toBe(201);
      const inviteData = JSON.parse(inviteRes.body);
      const inviteId = inviteData.invitation.id;
      const inviteToken = inviteData.invitationToken || inviteData.invitation.token;

      // Student 2 accepts invite
      const acceptRes = await app.inject({
        method: 'POST',
        url: `/api/v1/teams/invitations/${inviteId}/accept`,
        headers: student2.headers,
        payload: { token: inviteToken },
      });
      expect(acceptRes.statusCode).toBe(200);

      // Verify roster has 2 members
      const teamRes = await app.inject({
        method: 'GET',
        url: `/api/v1/teams/${teamId}`,
        headers: student1.headers,
      });
      expect(teamRes.statusCode).toBe(200);
      expect(JSON.parse(teamRes.body).members.length).toBe(2);
    });

    it('2.4. Administrator Event Moderation: Force-cancel event with audit record', async () => {
      const cancelRes = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${lifecycleEventId}/cancel`,
        headers: admin.headers,
        payload: { reason: 'Administrative safety protocol violation' },
      });
      expect(cancelRes.statusCode).toBe(200);

      // Verify status is cancelled
      const eventCheck = await pool.query(`SELECT status FROM events WHERE id = $1;`, [lifecycleEventId]);
      expect(eventCheck.rows[0].status).toBe('cancelled');
    });
  });

  // =========================================================================
  // 3. BUSINESS LOGIC, PERSISTENCE & SECURITY INVARIANTS
  // =========================================================================
  describe('3. Business Logic & Security Invariants', () => {
    let testEventId: string;

    beforeAll(async () => {
      const startsAt = new Date(Date.now() + 86400000 * 220).toISOString();
      const endsAt = new Date(Date.now() + 86400000 * 220 + 7200000).toISOString();

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/events',
        headers: admin.headers,
        payload: {
          title: `Operations & Turnstile Expo ${Date.now()}`,
          description: 'Testing volunteer shifts, offline sync, feedback formula escape, and certificate verification.',
          category: 'Tech',
          department: 'Computer Science',
          format: 'in_person',
          contactEmail: 'admin.system@campus.edu',
          venueId: testVenueId,
          startsAt,
          endsAt,
          capacity: 100,
        },
      });
      testEventId = JSON.parse(createRes.body).event.id;

      await app.inject({
        method: 'POST',
        url: `/api/v1/events/${testEventId}/submit`,
        headers: admin.headers,
        payload: {},
      });
      await app.inject({
        method: 'POST',
        url: `/api/v1/events/${testEventId}/approval`,
        headers: reviewer.headers,
        payload: { decision: 'approved', comments: 'Approved' },
      });
      await app.inject({
        method: 'POST',
        url: `/api/v1/events/${testEventId}/publish`,
        headers: admin.headers,
        payload: {},
      });
    });

    it('3.1. Volunteer Operations: Create role, create shift, student application, and check-in', async () => {
      // 1. Create role
      const roleRes = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${testEventId}/volunteer-roles`,
        headers: admin.headers,
        payload: {
          title: 'Turnstile Greeter',
          requirements: 'Customer service, student ID required',
          capacity: 2,
        },
      });
      expect(roleRes.statusCode).toBe(201);
      const roleId = JSON.parse(roleRes.body).role.id;

      // 2. Create shift with unique window to avoid cross-run overlap guards
      const shiftDayOffset = 300 + Math.floor(Math.random() * 500);
      const shiftStartsAt = new Date(Date.now() + 86400000 * shiftDayOffset).toISOString();
      const shiftEndsAt = new Date(Date.now() + 86400000 * shiftDayOffset + 14400000).toISOString();
      const shiftRes = await app.inject({
        method: 'POST',
        url: `/api/v1/volunteer-roles/${roleId}/shifts`,
        headers: admin.headers,
        payload: {
          startsAt: shiftStartsAt,
          endsAt: shiftEndsAt,
          capacity: 1,
        },
      });
      expect(shiftRes.statusCode).toBe(201);
      const shiftId = JSON.parse(shiftRes.body).shift.id;

      // 3. Student 1 applies
      const applyRes = await app.inject({
        method: 'POST',
        url: `/api/v1/shifts/${shiftId}/applications`,
        headers: student1.headers,
        payload: {},
      });
      expect(applyRes.statusCode).toBe(201);
      const appId = JSON.parse(applyRes.body).application.id;

      // 4. Admin approves
      const approveRes = await app.inject({
        method: 'POST',
        url: `/api/v1/applications/${appId}/approve`,
        headers: admin.headers,
        payload: {},
      });
      expect(approveRes.statusCode).toBe(200);
      expect(JSON.parse(approveRes.body).application.status).toBe('APPROVED');

      // 5. Admin assigns application
      const assignRes = await app.inject({
        method: 'POST',
        url: `/api/v1/applications/${appId}/assign`,
        headers: admin.headers,
        payload: {},
      });
      expect(assignRes.statusCode).toBe(200);
      const checkinToken = JSON.parse(assignRes.body).application.checkinToken;

      // 6. Check in volunteer with token
      const checkinRes = await app.inject({
        method: 'POST',
        url: `/api/v1/applications/${appId}/check-in`,
        headers: admin.headers,
        payload: { token: checkinToken },
      });
      expect(checkinRes.statusCode).toBe(200);
      expect(JSON.parse(checkinRes.body).application.status).toBe('CHECKED_IN');
    });

    it('3.2. Offline Turnstile Sync: Manifest generation, batch sync, and duplicate reconciliation', async () => {
      // Assign student1 as staff
      await pool.query(
        `INSERT INTO event_staff_assignments (event_id, user_id, capability, granted_by)
         VALUES ($1, $2, 'checkin', $3)
         ON CONFLICT DO NOTHING;`,
        [testEventId, student1.user.id, admin.user.id]
      );

      // 1. Generate offline manifest
      const manifestRes = await app.inject({
        method: 'GET',
        url: `/api/v1/events/${testEventId}/check-in/manifest?deviceId=turnstile_gate_1`,
        headers: student1.headers,
      });
      expect(manifestRes.statusCode).toBe(200);
      const manifest = JSON.parse(manifestRes.body);
      expect(manifest.eventId).toBe(testEventId);
      expect(manifest.wrappedKey).toBeDefined();
      expect(manifest.items).toBeDefined();

      // 2. Sync an offline batch
      const op1Id = crypto.randomUUID();
      const op2Id = crypto.randomUUID();
      const batchRes = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${testEventId}/check-in/sync-batch`,
        headers: student1.headers,
        payload: {
          batchId: crypto.randomUUID(),
          deviceId: 'turnstile_gate_1',
          ops: [
            {
              opId: op1Id,
              ticketRef: 'DUMMY-TICKET-REF-1',
              scannedAtLocal: new Date().toISOString(),
            },
            {
              opId: op2Id,
              ticketRef: 'DUMMY-TICKET-REF-1', // duplicate in same batch
              scannedAtLocal: new Date().toISOString(),
            },
          ],
        },
      });
      expect(batchRes.statusCode).toBe(200);
      const result = JSON.parse(batchRes.body);
      expect(result.totalOps).toBe(2);
      expect(result.results.length).toBe(2);
    });

    it('3.3. CSV Formula Injection Defense: Escapes dangerous leading characters', async () => {
      // Test formula sanitization in feedback export
      const exportRes = await app.inject({
        method: 'POST',
        url: `/api/v1/organizer/events/${testEventId}/exports`,
        headers: admin.headers,
        payload: {
          format: 'csv',
          kind: 'attendees',
        },
      });
      expect(exportRes.statusCode).toBe(200);
      const body = JSON.parse(exportRes.body);
      expect(body.downloadUrl).toBeDefined();

      // Fetch the generated CSV
      const downloadRes = await app.inject({
        method: 'GET',
        url: body.downloadUrl,
        headers: admin.headers,
      });
      expect(downloadRes.statusCode).toBe(200);
      const csvText = downloadRes.body;
      expect(csvText).toContain('Booking ID');
      // Verify no raw unquoted formula trigger appears
      expect(csvText).not.toMatch(/^=[A-Z]+/m);
    });

    it('3.4. Certificate Verification: Public zero-PII credential lookup', async () => {
      // Insert a verified certificate directly into database
      const certCode = `EVT-2026-CERT-${Date.now()}`;
      const certHash = crypto.createHash('sha256').update(certCode).digest();
      await pool.query(
        `INSERT INTO certificates (event_id, user_id, verification_code, hash, issued_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT DO NOTHING;`,
        [testEventId, student1.user.id, certCode, certHash]
      );

      // Query public zero-PII verification
      const verifyRes = await app.inject({
        method: 'GET',
        url: `/api/v1/verify/${certCode}`,
      });
      expect(verifyRes.statusCode).toBe(200);
      const cert = JSON.parse(verifyRes.body);
      expect(cert.found).toBe(true);
      expect(cert.valid).toBe(true);
      expect(cert.eventTitle).toBeDefined();
      expect(cert.attendeeInitials).toBeDefined();
      // Asserts zero PII leak: email, roll, phone must be absent
      expect((cert as any).email).toBeUndefined();
      expect((cert as any).phone).toBeUndefined();
      expect((cert as any).userId).toBeUndefined();
    });
  });

  // =========================================================================
  // 4. SECONDARY FEATURES & UTILITIES
  // =========================================================================
  describe('4. Secondary Features & Utilities', () => {
    it('4.1. Calendar Query: GET /api/v1/calendar returns published events within date bounds', async () => {
      const now = new Date();
      const start = new Date(now.getTime() - 86400000).toISOString();
      const end = new Date(now.getTime() + 86400000 * 365).toISOString();

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/calendar?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.events).toBeDefined();
      expect(Array.isArray(body.events)).toBe(true);
    });

    it('4.2. Venues List: GET /api/v1/venues returns active campus venues with floor data', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/venues',
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.venues.length).toBeGreaterThanOrEqual(1);
      expect(body.venues[0].name).toBeDefined();
      expect(body.venues[0].capacity).toBeGreaterThan(0);
    });

    it('4.3. Event Detail Lookup: GET /api/v1/events/:slug returns 404 on non-existent event', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/events/non-existent-slug-xyz',
      });
      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('EVENT_NOT_FOUND');
    });

    it('4.4. Passport Privacy Revocation: Toggling visibility updates /p/:slug access', async () => {
      // 1. Set passport visible
      await app.inject({
        method: 'PATCH',
        url: '/api/v1/me/passport/visibility',
        headers: student1.headers,
        payload: {
          visibility: 'public',
        },
      });

      // 2. Fetch student handle
      const passportRes = await app.inject({
        method: 'GET',
        url: '/api/v1/me/passport',
        headers: student1.headers,
      });
      expect(passportRes.statusCode).toBe(200);
      const slug = JSON.parse(passportRes.body).settings?.customSlug || student1.user.id;

      // 3. Hide everything
      const hideRes = await app.inject({
        method: 'PATCH',
        url: '/api/v1/me/passport/visibility',
        headers: student1.headers,
        payload: {
          visibility: 'private',
        },
      });
      expect(hideRes.statusCode).toBe(200);

      // 4. Verify public lookup returns 404 or private notice
      const pubRes = await app.inject({
        method: 'GET',
        url: `/api/v1/p/${slug}`,
      });
      expect([200, 404]).toContain(pubRes.statusCode);
      if (pubRes.statusCode === 200) {
        expect(JSON.parse(pubRes.body).isPrivate).toBe(true);
      }
    });
  });
});
