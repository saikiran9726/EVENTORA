import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../packages/backend/src/app.js';
import { pool } from '../../packages/backend/src/db/index.js';
import { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';

describe('Phase 11 Security Gate: Automated IDOR & Route Authorization Matrix (OWASP ASVS L2)', () => {
  let app: FastifyInstance;

  // Colleges
  let college1Id: string;
  let college2Id: string;

  // User IDs
  let studentAId: string;
  let studentBId: string;
  let otherCollegeStudentId: string;
  let organizerAUserId: string;
  let organizerBUserId: string;
  let checkinStaffUserId: string;
  let reviewerUserId: string;
  let adminUserId: string;

  // Organizer Profiles
  let organizerProfileAId: string;
  let organizerProfileBId: string;

  // Events & Objects
  let eventAId: string;
  let pendingApprovalEventId: string;
  let studentABookingId: string;
  let studentATicketId: string;
  let certificateAId: string;
  let conflictAId: string;

  // Role Session Headers
  type RoleName =
    | 'anon'
    | 'student'
    | 'other-college student'
    | 'organizer-A'
    | 'organizer-B'
    | 'check-in staff'
    | 'reviewer'
    | 'admin';

  const roleHeaders: Record<RoleName, Record<string, string>> = {
    anon: {},
    student: {},
    'other-college student': {},
    'organizer-A': {},
    'organizer-B': {},
    'check-in staff': {},
    reviewer: {},
    admin: {},
  };

  async function createSessionForUser(userId: string): Promise<Record<string, string>> {
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const csrfToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(sessionToken).digest();

    await pool.query(
      `INSERT INTO sessions (id_hash, user_id, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '1 day');`,
      [tokenHash, userId]
    );

    return {
      cookie: `eventora_session=${sessionToken}; eventora_csrf=${csrfToken}`,
      'x-csrf-token': csrfToken,
    };
  }

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    const client = await pool.connect();
    try {
      // 1. Colleges
      const c1Res = await client.query(
        `INSERT INTO colleges (name, domain, status, participation_status)
         VALUES ('Matrix College 1', 'college1-matrix.edu', 'active', 'participating')
         ON CONFLICT (domain) DO UPDATE SET name = EXCLUDED.name
         RETURNING id;`
      );
      college1Id = c1Res.rows[0].id;

      const c2Res = await client.query(
        `INSERT INTO colleges (name, domain, status, participation_status)
         VALUES ('Matrix College 2', 'college2-matrix.edu', 'active', 'participating')
         ON CONFLICT (domain) DO UPDATE SET name = EXCLUDED.name
         RETURNING id;`
      );
      college2Id = c2Res.rows[0].id;

      // 2. Users for all roles
      // Student A (College 1)
      const uStudentA = await client.query(
        `INSERT INTO users (email, password_hash, display_name, college_id, global_role, status)
         VALUES ('student_a_${Date.now()}@college1-matrix.edu', 'hash', 'Student A', $1, 'student', 'active')
         RETURNING id;`,
        [college1Id]
      );
      studentAId = uStudentA.rows[0].id;

      // Student B (College 1)
      const uStudentB = await client.query(
        `INSERT INTO users (email, password_hash, display_name, college_id, global_role, status)
         VALUES ('student_b_${Date.now()}@college1-matrix.edu', 'hash', 'Student B', $1, 'student', 'active')
         RETURNING id;`,
        [college1Id]
      );
      studentBId = uStudentB.rows[0].id;

      // Other College Student (College 2)
      const uOtherStudent = await client.query(
        `INSERT INTO users (email, password_hash, display_name, college_id, global_role, status)
         VALUES ('other_student_${Date.now()}@college2-matrix.edu', 'hash', 'Other College Student', $1, 'student', 'active')
         RETURNING id;`,
        [college2Id]
      );
      otherCollegeStudentId = uOtherStudent.rows[0].id;

      // Organizer A User (College 1)
      const uOrgA = await client.query(
        `INSERT INTO users (email, password_hash, display_name, college_id, global_role, status)
         VALUES ('org_a_${Date.now()}@college1-matrix.edu', 'hash', 'Org A User', $1, 'student', 'active')
         RETURNING id;`,
        [college1Id]
      );
      organizerAUserId = uOrgA.rows[0].id;

      // Organizer B User (College 1)
      const uOrgB = await client.query(
        `INSERT INTO users (email, password_hash, display_name, college_id, global_role, status)
         VALUES ('org_b_${Date.now()}@college1-matrix.edu', 'hash', 'Org B User', $1, 'student', 'active')
         RETURNING id;`,
        [college1Id]
      );
      organizerBUserId = uOrgB.rows[0].id;

      // Check-in Staff User (College 1)
      const uCheckin = await client.query(
        `INSERT INTO users (email, password_hash, display_name, college_id, global_role, status)
         VALUES ('staff_${Date.now()}@college1-matrix.edu', 'hash', 'Checkin Staff', $1, 'student', 'active')
         RETURNING id;`,
        [college1Id]
      );
      checkinStaffUserId = uCheckin.rows[0].id;

      // Reviewer User (College 1)
      const uReviewer = await client.query(
        `INSERT INTO users (email, password_hash, display_name, college_id, global_role, status)
         VALUES ('reviewer_${Date.now()}@college1-matrix.edu', 'hash', 'Reviewer', $1, 'reviewer', 'active')
         RETURNING id;`,
        [college1Id]
      );
      reviewerUserId = uReviewer.rows[0].id;

      // Admin User (College 1)
      const uAdmin = await client.query(
        `INSERT INTO users (email, password_hash, display_name, college_id, global_role, status)
         VALUES ('admin_${Date.now()}@college1-matrix.edu', 'hash', 'Matrix Admin', $1, 'admin', 'active')
         RETURNING id;`,
        [college1Id]
      );
      adminUserId = uAdmin.rows[0].id;

      // 3. Organizer Profiles & Memberships
      const opA = await client.query(
        `INSERT INTO organizer_profiles (college_id, display_name, status, created_by)
         VALUES ($1, 'Matrix Club A', 'verified', $2)
         RETURNING id;`,
        [college1Id, organizerAUserId]
      );
      organizerProfileAId = opA.rows[0].id;
      await client.query(
        `INSERT INTO organizer_members (organizer_id, user_id, role, status)
         VALUES ($1, $2, 'owner', 'active');`,
        [organizerProfileAId, organizerAUserId]
      );

      const opB = await client.query(
        `INSERT INTO organizer_profiles (college_id, display_name, status, created_by)
         VALUES ($1, 'Matrix Club B', 'verified', $2)
         RETURNING id;`,
        [college1Id, organizerBUserId]
      );
      organizerProfileBId = opB.rows[0].id;
      await client.query(
        `INSERT INTO organizer_members (organizer_id, user_id, role, status)
         VALUES ($1, $2, 'owner', 'active');`,
        [organizerProfileBId, organizerBUserId]
      );

      // 4. Events
      // Event A (published, college visibility)
      const evA = await client.query(
        `INSERT INTO events (title, slug, description, format, contact_email, created_by, organizer_id, college_id, category, starts_at, ends_at, capacity, status, visibility, version)
         VALUES ('Matrix Event A', 'matrix-event-a-${Date.now()}', 'Description for Event A', 'in_person', 'org.a@college1-matrix.edu', $1, $2, $3, 'Tech', NOW() + INTERVAL '1 day', NOW() + INTERVAL '2 days', 100, 'published', 'college', 1)
         RETURNING id;`,
        [organizerAUserId, organizerProfileAId, college1Id]
      );
      eventAId = evA.rows[0].id;

      // Ticket Type A
      const ttA = await client.query(
        `INSERT INTO ticket_types (event_id, name, price_paise, capacity, sold, held)
         VALUES ($1, 'Matrix Standard Admission', 0, 100, 1, 0)
         RETURNING id;`,
        [eventAId]
      );
      const ticketTypeAId = ttA.rows[0].id;

      // Pending Approval Event (draft submitted for review)
      const evPending = await client.query(
        `INSERT INTO events (title, slug, description, format, contact_email, created_by, organizer_id, college_id, category, starts_at, ends_at, capacity, status, visibility, version)
         VALUES ('Matrix Pending Event', 'matrix-pending-${Date.now()}', 'Pending review description', 'in_person', 'org.a@college1-matrix.edu', $1, $2, $3, 'Tech', NOW() + INTERVAL '3 days', NOW() + INTERVAL '4 days', 50, 'pending_approval', 'college', 1)
         RETURNING id;`,
        [organizerAUserId, organizerProfileAId, college1Id]
      );
      pendingApprovalEventId = evPending.rows[0].id;

      // 5. Staff assignment for Check-in Staff on Event A
      await client.query(
        `INSERT INTO event_staff_assignments (event_id, user_id, capability, granted_by)
         VALUES ($1, $2, 'checkin', $3);`,
        [eventAId, checkinStaffUserId, organizerAUserId]
      );

      // 6. Booking & Ticket for Student A
      const bkA = await client.query(
        `INSERT INTO bookings (user_id, event_id, status, total_paise, idempotency_key)
         VALUES ($1, $2, 'CONFIRMED', 0, 'idemp-matrix-${Date.now()}')
         RETURNING id;`,
        [studentAId, eventAId]
      );
      studentABookingId = bkA.rows[0].id;

      const qrPayloadHashHex = crypto.randomBytes(32).toString('hex');
      const tkA = await client.query(
        `INSERT INTO tickets (booking_id, user_id, owner_user_id, event_id, ticket_type_id, ticket_code, qr_payload_hash, status)
         VALUES ($1, $2, $2, $3, $4, 'TC-MATRIX-${Date.now()}', decode($5, 'hex'), 'VALID')
         RETURNING id;`,
        [studentABookingId, studentAId, eventAId, ticketTypeAId, qrPayloadHashHex]
      );
      studentATicketId = tkA.rows[0].id;

      // 7. Certificate for Student A
      const certA = await client.query(
        `INSERT INTO certificates (user_id, event_id, verification_code, hash)
         VALUES ($1, $2, 'CERT-${Date.now()}', decode('11223344', 'hex'))
         RETURNING id;`,
        [studentAId, eventAId]
      );
      certificateAId = certA.rows[0].id;

      // 8. Scan Conflict on Event A
      const confA = await client.query(
        `INSERT INTO scan_conflicts (event_id, ticket_id, op_ids, status)
         VALUES ($1, $2, ARRAY[gen_random_uuid(), gen_random_uuid()]::uuid[], 'OPEN')
         RETURNING id;`,
        [eventAId, studentATicketId]
      );
      conflictAId = confA.rows[0].id;

      // 9. Generate sessions for all authenticated roles
      roleHeaders.student = await createSessionForUser(studentAId);
      roleHeaders['other-college student'] = await createSessionForUser(otherCollegeStudentId);
      roleHeaders['organizer-A'] = await createSessionForUser(organizerAUserId);
      roleHeaders['organizer-B'] = await createSessionForUser(organizerBUserId);
      roleHeaders['check-in staff'] = await createSessionForUser(checkinStaffUserId);
      roleHeaders.reviewer = await createSessionForUser(reviewerUserId);
      roleHeaders.admin = await createSessionForUser(adminUserId);
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    const client = await pool.connect();
    try {
      if (eventAId) {
        await client.query(`DELETE FROM scan_conflicts WHERE event_id = $1;`, [eventAId]);
        await client.query(`DELETE FROM certificates WHERE event_id = $1;`, [eventAId]);
        await client.query(`DELETE FROM refunds WHERE payment_id IN (SELECT p.id FROM payments p JOIN bookings b ON p.booking_id = b.id WHERE b.event_id = $1);`, [eventAId]);
        await client.query(`DELETE FROM payments WHERE booking_id IN (SELECT id FROM bookings WHERE event_id = $1);`, [eventAId]);
        await client.query(`DELETE FROM tickets WHERE event_id = $1;`, [eventAId]);
        await client.query(`DELETE FROM bookings WHERE event_id = $1;`, [eventAId]);
        await client.query(`DELETE FROM ticket_types WHERE event_id = $1;`, [eventAId]);
        await client.query(`DELETE FROM event_staff_assignments WHERE event_id = $1;`, [eventAId]);
        await client.query(`DELETE FROM events WHERE id = $1;`, [eventAId]);
      }
      if (pendingApprovalEventId) {
        await client.query(`DELETE FROM events WHERE id = $1;`, [pendingApprovalEventId]);
      }
    } catch {} finally {
      client.release();
    }
    await app.close();
  });

  describe('1. Global PreValidation Hook (UUID Parameter Guards)', () => {
    it('returns 400 INVALID_ID when route parameter :id is not a valid UUID', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/bookings/not-a-valid-uuid',
        headers: roleHeaders.student,
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('INVALID_ID');
      expect(body.error.message).toContain('must be a valid UUID');
    });

    it('returns 400 INVALID_ID when sub-resource parameter ending in Id is not a UUID', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/waitlist/invalid-entry-uuid/claim',
        headers: roleHeaders.student,
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('INVALID_ID');
    });
  });

  describe('2. Student Private Objects & IDOR Prevention Matrix', () => {
    it('GET /api/v1/bookings/:id - only owner and platform admin can view booking', async () => {
      // 1. Owner (Student A) -> 200
      const ownerRes = await app.inject({
        method: 'GET',
        url: `/api/v1/bookings/${studentABookingId}`,
        headers: roleHeaders.student,
      });
      expect(ownerRes.statusCode).toBe(200);

      // 2. Admin -> 200
      const adminRes = await app.inject({
        method: 'GET',
        url: `/api/v1/bookings/${studentABookingId}`,
        headers: roleHeaders.admin,
      });
      expect(adminRes.statusCode).toBe(200);

      // 3. Anonymous -> 401
      const anonRes = await app.inject({
        method: 'GET',
        url: `/api/v1/bookings/${studentABookingId}`,
      });
      expect(anonRes.statusCode).toBe(401);

      // 4. Other College Student -> 403 (Blocked by Object Check)
      const otherRes = await app.inject({
        method: 'GET',
        url: `/api/v1/bookings/${studentABookingId}`,
        headers: roleHeaders['other-college student'],
      });
      expect(otherRes.statusCode).toBe(403);
      expect(JSON.parse(otherRes.body).error.code).toBe('FORBIDDEN');

      // 5. Organizer B -> 403
      const orgBRes = await app.inject({
        method: 'GET',
        url: `/api/v1/bookings/${studentABookingId}`,
        headers: roleHeaders['organizer-B'],
      });
      expect(orgBRes.statusCode).toBe(403);
    });

    it('GET /api/v1/certificates/:id/download - only recipient and platform admin can download', async () => {
      // 1. Owner (Student A) -> 200
      const ownerRes = await app.inject({
        method: 'GET',
        url: `/api/v1/certificates/${certificateAId}/download`,
        headers: roleHeaders.student,
      });
      expect(ownerRes.statusCode).toBe(200);

      // 2. Admin -> 200
      const adminRes = await app.inject({
        method: 'GET',
        url: `/api/v1/certificates/${certificateAId}/download`,
        headers: roleHeaders.admin,
      });
      expect(adminRes.statusCode).toBe(200);

      // 3. Other Student -> 403
      const otherRes = await app.inject({
        method: 'GET',
        url: `/api/v1/certificates/${certificateAId}/download`,
        headers: roleHeaders['other-college student'],
      });
      expect(otherRes.statusCode).toBe(403);
      expect(JSON.parse(otherRes.body).error.code).toBe('FORBIDDEN');
    });
  });

  describe('3. Event Lifecycle, Management & Tenant Isolation Matrix', () => {
    it('POST /api/v1/events/:id/postpone - only owning organizer or admin can postpone', async () => {
      // 1. Organizer A (Owner) -> 200
      const orgARes = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${eventAId}/postpone`,
        headers: roleHeaders['organizer-A'],
        payload: { note: 'Weather postponement' },
      });
      expect(orgARes.statusCode).toBe(200);

      // Restore to published for subsequent tests
      await pool.query(`UPDATE events SET status = 'published' WHERE id = $1;`, [eventAId]);

      // 2. Organizer B -> 403 (Multi-tenant boundary)
      const orgBRes = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${eventAId}/postpone`,
        headers: roleHeaders['organizer-B'],
        payload: { note: 'Unauthorized attempt' },
      });
      expect(orgBRes.statusCode).toBe(403);
      expect(JSON.parse(orgBRes.body).error.code).toBe('FORBIDDEN');

      // 3. Student -> 403
      const studentRes = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${eventAId}/postpone`,
        headers: roleHeaders.student,
        payload: { note: 'Student attempt' },
      });
      expect(studentRes.statusCode).toBe(403);
    });

    it('GET /api/v1/organizers/:id/ledger - only owning organizer or admin can view financial ledger', async () => {
      // 1. Organizer A (Owner) -> 200
      const orgARes = await app.inject({
        method: 'GET',
        url: `/api/v1/organizers/${organizerProfileAId}/ledger`,
        headers: roleHeaders['organizer-A'],
      });
      expect(orgARes.statusCode).toBe(200);

      // 2. Organizer B -> 403
      const orgBRes = await app.inject({
        method: 'GET',
        url: `/api/v1/organizers/${organizerProfileAId}/ledger`,
        headers: roleHeaders['organizer-B'],
      });
      expect(orgBRes.statusCode).toBe(403);

      // 3. Student -> 403
      const studentRes = await app.inject({
        method: 'GET',
        url: `/api/v1/organizers/${organizerProfileAId}/ledger`,
        headers: roleHeaders.student,
      });
      expect(studentRes.statusCode).toBe(403);
    });

    it('PATCH /api/v1/events/:id - enforces status & capacity constraints', async () => {
      // 1. Cannot modify material params while pending_approval
      const materialRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/events/${pendingApprovalEventId}`,
        headers: roleHeaders['organizer-A'],
        payload: { capacity: 200 },
      });
      expect(materialRes.statusCode).toBe(400);
      expect(JSON.parse(materialRes.body).error.code).toBe('MATERIAL_EDIT_RESTRICTED');

      // 2. Cannot reduce capacity below already allocated (sold=1, held=0)
      const capRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/events/${eventAId}`,
        headers: roleHeaders['organizer-A'],
        payload: { capacity: 0 },
      });
      expect(capRes.statusCode).toBe(400);
      // Validated by zod min(1) or CAPACITY_BELOW_ALLOCATED
      expect([400]).toContain(capRes.statusCode);

      // 3. Rejects invalid registration window (closes before opens)
      const windowRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/events/${eventAId}`,
        headers: roleHeaders['organizer-A'],
        payload: {
          registrationOpensAt: new Date(Date.now() + 86400000).toISOString(),
          registrationClosesAt: new Date(Date.now() + 3600000).toISOString(),
        },
      });
      expect(windowRes.statusCode).toBe(400);
      expect(JSON.parse(windowRes.body).error.code).toBe('INVALID_REGISTRATION_WINDOW');
    });
  });

  describe('4. Check-In & Attendance Operations Matrix', () => {
    it('POST /api/v1/events/:id/check-in/scan - requires checkin capability or organizer owner/admin', async () => {
      const scanPayload = { token: 'https://eventora.campus.edu/t/simulated-opaque-qr-token' };

      // 1. Check-in staff -> Authorized (fails scan resolution, not 403)
      const staffRes = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${eventAId}/check-in/scan`,
        headers: roleHeaders['check-in staff'],
        payload: scanPayload,
      });
      expect(staffRes.statusCode).not.toBe(403);
      expect(staffRes.statusCode).not.toBe(401);

      // 2. Organizer A -> Authorized (owner/manager has check-in capability)
      const orgARes = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${eventAId}/check-in/scan`,
        headers: roleHeaders['organizer-A'],
        payload: scanPayload,
      });
      expect(orgARes.statusCode).not.toBe(403);

      // 3. Organizer B -> 403 (unassigned to Event A)
      const orgBRes = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${eventAId}/check-in/scan`,
        headers: roleHeaders['organizer-B'],
        payload: scanPayload,
      });
      expect(orgBRes.statusCode).toBe(403);

      // 4. Student -> 403
      const studentRes = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${eventAId}/check-in/scan`,
        headers: roleHeaders.student,
        payload: scanPayload,
      });
      expect(studentRes.statusCode).toBe(403);
    });

    it('POST /api/v1/conflicts/:id/resolve - resolveEventId correctly scopes policy check', async () => {
      const resolvePayload = { resolutionNote: 'Resolved manually by turnstile staff' };

      // 1. Check-in staff -> 200 (or resolved state)
      const staffRes = await app.inject({
        method: 'POST',
        url: `/api/v1/conflicts/${conflictAId}/resolve`,
        headers: roleHeaders['check-in staff'],
        payload: resolvePayload,
      });
      expect(staffRes.statusCode).toBe(200);

      // 2. Student -> 403
      const studentRes = await app.inject({
        method: 'POST',
        url: `/api/v1/conflicts/${conflictAId}/resolve`,
        headers: roleHeaders.student,
        payload: resolvePayload,
      });
      expect(studentRes.statusCode).toBe(403);
      expect(JSON.parse(studentRes.body).error.code).toBe('FORBIDDEN');
    });
  });

  describe('5. Faculty Review & Administrative Protection Matrix', () => {
    it('POST /api/v1/events/:id/approval - only reviewer and admin can approve; creator cannot approve own proposal', async () => {
      // 1. Creator (Organizer A) -> 403 (Conflict of Interest prevention)
      const orgARes = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${pendingApprovalEventId}/approval`,
        headers: roleHeaders['organizer-A'],
        payload: { decision: 'approved', comments: 'Self approval' },
      });
      expect(orgARes.statusCode).toBe(403);

      // 2. Student -> 403
      const studentRes = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${pendingApprovalEventId}/approval`,
        headers: roleHeaders.student,
        payload: { decision: 'approved', comments: 'Student approval' },
      });
      expect(studentRes.statusCode).toBe(403);

      // 3. Faculty Reviewer -> 200
      const reviewerRes = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${pendingApprovalEventId}/approval`,
        headers: roleHeaders.reviewer,
        payload: { decision: 'approved', comments: 'Approved by faculty reviewer' },
      });
      expect(reviewerRes.statusCode).toBe(200);
    });

    it('POST /api/v1/admin/users/:id/role - protects against self-demotion and last active admin demotion', async () => {
      // 1. Admin demoting self -> 400 SELF_DEMOTION_PROHIBITED
      const selfDemoteRes = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/users/${adminUserId}/role`,
        headers: roleHeaders.admin,
        payload: { globalRole: 'student' },
      });
      expect(selfDemoteRes.statusCode).toBe(400);
      expect(JSON.parse(selfDemoteRes.body).error.code).toBe('SELF_DEMOTION_PROHIBITED');

      // 2. Non-admin attempting admin role update -> 403
      const studentRes = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/users/${studentAId}/role`,
        headers: roleHeaders.student,
        payload: { globalRole: 'admin' },
      });
      expect(studentRes.statusCode).toBe(403);
    });
  });

  describe('6. Refund Anti-Self-Dealing Guard', () => {
    it('decideRefund refuses requests where the deciding organizer is also the requester', async () => {
      // Create a paid booking + payment + refund request where organizerA is the requester
      const client = await pool.connect();
      let selfRefundId: string;
      try {
        const bk = await client.query(
          `INSERT INTO bookings (user_id, event_id, status, total_paise, idempotency_key)
           VALUES ($1, $2, 'CONFIRMED', 10000, 'idemp-self-ref-${Date.now()}')
           RETURNING id;`,
          [organizerAUserId, eventAId]
        );
        const bookingId = bk.rows[0].id;

        const pm = await client.query(
          `INSERT INTO payments (booking_id, amount_paise, currency, provider, status, provider_order_id, provider_payment_id)
           VALUES ($1, 10000, 'INR', 'simulator', 'SUCCEEDED', 'order_sim_${Date.now()}', 'pay_sim_${Date.now()}')
           RETURNING id;`,
          [bookingId]
        );
        const paymentId = pm.rows[0].id;

        const rf = await client.query(
          `INSERT INTO refunds (payment_id, amount_paise, reason, status, requested_by, idempotency_key)
           VALUES ($1, 10000, 'Buyer remorse', 'REQUESTED', $2, 'idemp-rf-${Date.now()}')
           RETURNING id;`,
          [paymentId, organizerAUserId]
        );
        selfRefundId = rf.rows[0].id;
      } finally {
        client.release();
      }

      // Organizer A attempts to decide their own refund -> 403 FORBIDDEN (Self-dealing guard)
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/refunds/${selfRefundId}/decision`,
        headers: roleHeaders['organizer-A'],
        payload: { decision: 'APPROVED' },
      });

      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('FORBIDDEN');
      expect(body.error.message).toContain('Requester cannot decide their own refund');
    });
  });
});
