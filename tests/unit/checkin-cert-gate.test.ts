import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../packages/backend/src/app.js';
import { pool } from '../../packages/backend/src/db/index.js';
import {
  generateQrToken,
  generateCrockfordCode,
  normalizeCrockfordCode,
  scanTicket,
  revokeTicket,
  issueCertificateIfEligible,
  verifyCertificateByCode,
  getInitials,
} from '../../packages/backend/src/services/qr-ticket.js';
import crypto from 'crypto';

describe('Phase 6 Quality Gate: QR Tickets, Check-in, Attendance & Certificates', () => {
  let app: any;
  let collegeId: string;
  let organizerId: string;
  let organizerUserId: string;
  let assignedStaffUserId: string;
  let unassignedStaffUserId: string;
  let eventAId: string;
  let eventBId: string;
  let ticketTypeAId: string;
  let ticketTypeBId: string;

  const createdUserIds: string[] = [];
  const createdEventIds: string[] = [];
  const seedPassword = process.env.SEED_PASSWORD || 'Eventora#Test2026!';

  async function loginUser(email: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: seedPassword },
    });
    expect(res.statusCode).toBe(200);
    const sessionCookie = res.cookies.find((c: any) => c.name === 'eventora_session')?.value;
    const csrfCookie = res.cookies.find((c: any) => c.name === 'eventora_csrf')?.value;
    return { sessionCookie, csrfCookie, body: JSON.parse(res.body) };
  }

  async function createTestStudent(displayName: string = 'Test Student'): Promise<string> {
    const client = await pool.connect();
    try {
      const email = `student.${Date.now()}.${Math.random().toString(36).substring(2, 7)}@campus.edu`;
      const res = await client.query(
        `INSERT INTO users (college_id, email, password_hash, display_name, global_role, status)
         VALUES ($1, $2, 'hash', $3, 'student', 'active')
         RETURNING id;`,
        [collegeId, email, displayName]
      );
      const id = res.rows[0].id;
      createdUserIds.push(id);
      return id;
    } finally {
      client.release();
    }
  }

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    const client = await pool.connect();
    try {
      // 1. Fetch college
      const cRes = await client.query('SELECT id FROM colleges LIMIT 1;');
      collegeId = cRes.rows[0].id;

      // 2. Create users with known password
      const { hashPassword } = await import('../../packages/backend/src/services/auth.js');
      const passHash = await hashPassword(seedPassword);

      const uRes = await client.query(
        `INSERT INTO users (college_id, email, password_hash, display_name, global_role, status, email_verified_at)
         VALUES
           ($1, $2, $5, 'Organizer Lead', 'student', 'active', NOW()),
           ($1, $3, $5, 'Assigned Checkin Volunteer', 'student', 'active', NOW()),
           ($1, $4, $5, 'Unassigned Volunteer', 'student', 'active', NOW())
         RETURNING id;`,
        [
          collegeId,
          `org.lead.${Date.now()}@campus.edu`,
          `assigned.staff.${Date.now()}@campus.edu`,
          `unassigned.staff.${Date.now()}@campus.edu`,
          passHash,
        ]
      );

      organizerUserId = uRes.rows[0].id;
      assignedStaffUserId = uRes.rows[1].id;
      unassignedStaffUserId = uRes.rows[2].id;

      createdUserIds.push(organizerUserId, assignedStaffUserId, unassignedStaffUserId);

      // 3. Create Organizer Profile & Membership
      const orgRes = await client.query(
        `INSERT INTO organizer_profiles (college_id, display_name, status, created_by)
         VALUES ($1, 'Robotics & AI Society', 'verified', $2)
         RETURNING id;`,
        [collegeId, organizerUserId]
      );
      organizerId = orgRes.rows[0].id;

      await client.query(
        `INSERT INTO organizer_members (organizer_id, user_id, role, status)
         VALUES ($1, $2, 'owner', 'active');`,
        [organizerId, organizerUserId]
      );

      // 4. Create Event A & Event B
      const eResA = await client.query(
        `INSERT INTO events (
           organizer_id, college_id, title, slug, description, category, department, format,
           starts_at, ends_at, capacity, visibility, status, contact_email, created_by
         ) VALUES (
           $1, $2, 'Campus Hackathon 2026', $3, 'Annual premier hackathon', 'Tech', 'CS', 'in_person',
           NOW() + INTERVAL '1 day', NOW() + INTERVAL '2 days', 200, 'public', 'published', 'hackathon@campus.edu', $4
         ) RETURNING id;`,
        [organizerId, collegeId, `gate-checkin-a-${Date.now()}`, organizerUserId]
      );
      eventAId = eResA.rows[0].id;
      createdEventIds.push(eventAId);

      const eResB = await client.query(
        `INSERT INTO events (
           organizer_id, college_id, title, slug, description, category, department, format,
           starts_at, ends_at, capacity, visibility, status, contact_email, created_by
         ) VALUES (
           $1, $2, 'Annual AI Symposium', $3, 'AI Frontiers Symposium', 'Tech', 'CS', 'in_person',
           NOW() + INTERVAL '3 days', NOW() + INTERVAL '4 days', 200, 'public', 'published', 'ai@campus.edu', $4
         ) RETURNING id;`,
        [organizerId, collegeId, `gate-checkin-b-${Date.now()}`, organizerUserId]
      );
      eventBId = eResB.rows[0].id;
      createdEventIds.push(eventBId);

      // 5. Staff assignment: assignedStaffUserId has capability 'checkin' on Event A
      await client.query(
        `INSERT INTO event_staff_assignments (event_id, user_id, capability, granted_by)
         VALUES ($1, $2, 'checkin', $3);`,
        [eventAId, assignedStaffUserId, organizerUserId]
      );

      // 6. Ticket tiers
      const ttA = await client.query(
        `INSERT INTO ticket_types (event_id, name, price_paise, capacity, sold, held)
         VALUES ($1, 'General Admission', 0, 100, 10, 0)
         RETURNING id;`,
        [eventAId]
      );
      ticketTypeAId = ttA.rows[0].id;

      const ttB = await client.query(
        `INSERT INTO ticket_types (event_id, name, price_paise, capacity, sold, held)
         VALUES ($1, 'Symposium Pass', 0, 100, 5, 0)
         RETURNING id;`,
        [eventBId]
      );
      ticketTypeBId = ttB.rows[0].id;

      // 7. Certificate Policy on Event A
      await client.query(
        `INSERT INTO certificate_policies (event_id, min_sessions, requires_checkin)
         VALUES ($1, 1, true)
         ON CONFLICT (event_id) DO NOTHING;`,
        [eventAId]
      );
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    const client = await pool.connect();
    try {
      if (createdEventIds.length > 0) {
        await client.query(`DELETE FROM scan_log WHERE event_id = ANY($1);`, [createdEventIds]);
        await client.query(`DELETE FROM checkins WHERE event_id = ANY($1);`, [createdEventIds]);
        await client.query(`DELETE FROM certificates WHERE event_id = ANY($1);`, [createdEventIds]);
        await client.query(`DELETE FROM tickets WHERE event_id = ANY($1);`, [createdEventIds]);
        await client.query(`DELETE FROM booking_items WHERE booking_id IN (SELECT id FROM bookings WHERE event_id = ANY($1));`, [createdEventIds]);
        await client.query(`DELETE FROM bookings WHERE event_id = ANY($1);`, [createdEventIds]);
        await client.query(`DELETE FROM ticket_types WHERE event_id = ANY($1);`, [createdEventIds]);
        await client.query(`DELETE FROM event_staff_assignments WHERE event_id = ANY($1);`, [createdEventIds]);
        await client.query(`DELETE FROM attendance_sessions WHERE event_id = ANY($1);`, [createdEventIds]);
        await client.query(`DELETE FROM certificate_policies WHERE event_id = ANY($1);`, [createdEventIds]);
        await client.query(`DELETE FROM events WHERE id = ANY($1);`, [createdEventIds]);
      }
      if (createdUserIds.length > 0) {
        await client.query(`DELETE FROM organizer_members WHERE user_id = ANY($1);`, [createdUserIds]);
        await client.query(`DELETE FROM organizer_profiles WHERE created_by = ANY($1);`, [createdUserIds]);
        await client.query(`DELETE FROM sessions WHERE user_id = ANY($1);`, [createdUserIds]);
        await client.query(`DELETE FROM users WHERE id = ANY($1);`, [createdUserIds]);
      }
    } finally {
      client.release();
    }
    await app.close();
  });

  async function createTicketForUser(eventId: string, ticketTypeId: string, userId: string) {
    const client = await pool.connect();
    try {
      const bRes = await client.query(
        `INSERT INTO bookings (user_id, event_id, status, total_paise, idempotency_key)
         VALUES ($1, $2, 'CONFIRMED', 0, $3)
         RETURNING id;`,
        [userId, eventId, `idem-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`]
      );
      const bookingId = bRes.rows[0].id;

      const biRes = await client.query(
        `INSERT INTO booking_items (booking_id, ticket_type_id, quantity, unit_price_paise)
         VALUES ($1, $2, 1, 0)
         RETURNING id;`,
        [bookingId, ticketTypeId]
      );
      const bookingItemId = biRes.rows[0].id;

      const { token, tokenHash, qrUrl } = generateQrToken();
      const ticketCode = `TCK-${Date.now().toString().slice(-6)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

      const tRes = await client.query(
        `INSERT INTO tickets (
           booking_id, booking_item_id, ticket_type_id, user_id, owner_user_id, event_id,
           ticket_code, qr_payload_hash, qr_token_hash, status
         ) VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $7, 'VALID')
         RETURNING id, ticket_code;`,
        [bookingId, bookingItemId, ticketTypeId, userId, eventId, ticketCode, tokenHash]
      );

      return {
        ticketId: tRes.rows[0].id,
        ticketCode: tRes.rows[0].ticket_code,
        token,
        tokenHash,
        qrUrl,
      };
    } finally {
      client.release();
    }
  }

  // Gate Test 1: Concurrency - 20 concurrent scans -> exactly 1 ACCEPTED, 19 DUPLICATE, 1 checkins row
  it('(1) scans same token 20 times concurrently -> exactly 1 ACCEPTED, 19 DUPLICATE, exactly 1 checkins row', async () => {
    const studentId = await createTestStudent('Aarav Sharma');
    const { token, ticketId } = await createTicketForUser(eventAId, ticketTypeAId, studentId);

    // Launch 20 concurrent scanTicket executions
    const scanPromises = Array.from({ length: 20 }, () =>
      scanTicket({
        tokenOrUrl: token,
        eventId: eventAId,
        staffId: assignedStaffUserId,
      })
    );

    const results = await Promise.all(scanPromises);

    const accepted = results.filter((r) => r.outcome === 'ACCEPTED');
    const duplicate = results.filter((r) => r.outcome === 'DUPLICATE');

    expect(accepted.length).toBe(1);
    expect(duplicate.length).toBe(19);

    // Verify first scan details are included in duplicate outcome
    expect(duplicate[0].message).toContain('Already checked in');

    // Verify database state: exactly 1 checkin row
    const client = await pool.connect();
    try {
      const chkRes = await client.query(`SELECT count(*)::int as count FROM checkins WHERE ticket_id = $1;`, [ticketId]);
      expect(chkRes.rows[0].count).toBe(1);

      // Verify ticket status is CHECKED_IN
      const tRes = await client.query(`SELECT status FROM tickets WHERE id = $1;`, [ticketId]);
      expect(tRes.rows[0].status).toBe('CHECKED_IN');
    } finally {
      client.release();
    }
  });

  // Gate Test 2: Token for other event -> WRONG_EVENT
  it('(2) scanning token belonging to other event returns WRONG_EVENT', async () => {
    const studentId = await createTestStudent('Event B Attendee');
    const { token } = await createTicketForUser(eventBId, ticketTypeBId, studentId);

    // Scan ticket for Event B at Event A check-in station
    const result = await scanTicket({
      tokenOrUrl: token,
      eventId: eventAId,
      staffId: assignedStaffUserId,
    });

    expect(result.outcome).toBe('WRONG_EVENT');
    expect(result.message).toContain('Wrong Event');
  });

  // Gate Test 3: Unassigned staff receives 403 Forbidden (NOT_ASSIGNED)
  it('(3) unassigned staff receives 403 Forbidden with attendance:checkin:assigned policy failure', async () => {
    const studentId = await createTestStudent('Test Attendee');
    const { token } = await createTicketForUser(eventAId, ticketTypeAId, studentId);

    // Unassigned staff logs in
    const client = await pool.connect();
    let unassignedEmail: string;
    try {
      const u = await client.query(`SELECT email FROM users WHERE id = $1;`, [unassignedStaffUserId]);
      unassignedEmail = u.rows[0].email;
    } finally {
      client.release();
    }

    const { sessionCookie, csrfCookie } = await loginUser(unassignedEmail);

    const scanRes = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${eventAId}/check-in/scan`,
      headers: {
        cookie: `eventora_session=${sessionCookie}; eventora_csrf=${csrfCookie}`,
        'x-csrf-token': csrfCookie,
      },
      payload: { token },
    });

    expect(scanRes.statusCode).toBe(403);
    const body = JSON.parse(scanRes.body);
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toContain('You are not assigned as check-in staff for this event');
  });

  // Gate Test 4: Revoked ticket -> REVOKED
  it('(4) scanning a revoked ticket returns REVOKED outcome', async () => {
    const studentId = await createTestStudent('Revoked Student');
    const { token, ticketId } = await createTicketForUser(eventAId, ticketTypeAId, studentId);

    // Revoke the ticket
    await revokeTicket({
      ticketId,
      actorId: organizerUserId,
      reason: 'Attendee requested withdrawal and refund',
    });

    // Staff attempts to scan the revoked ticket
    const result = await scanTicket({
      tokenOrUrl: token,
      eventId: eventAId,
      staffId: assignedStaffUserId,
    });

    expect(result.outcome).toBe('REVOKED');
    expect(result.message).toContain('Revoked Ticket');
  });

  // Gate Test 5: QR payload regex test proves Zero PII
  it('(5) QR payload is strictly opaque 43-character base64url and never contains PII or ticket UUID', () => {
    const { token, qrUrl } = generateQrToken('eventora.campus.edu');

    // 1. Token must be exactly 43 URL-safe base64 characters (32 random bytes)
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // 2. Full URL must follow https://host/t/<43-char-token>
    expect(qrUrl).toMatch(/^https:\/\/eventora\.campus\.edu\/t\/[A-Za-z0-9_-]{43}$/);

    // 3. Must NEVER contain email syntax
    expect(token).not.toMatch(/@/);

    // 4. Must NEVER contain UUID format (e.g. 8-4-4-4-12)
    expect(token).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);

    // 5. Must NOT be an integer ID
    expect(Number.isInteger(Number(token))).toBe(false);
  });

  // Gate Test 6: Ineligible attendee cannot issue/fetch certificate
  it('(6) attendee who has not checked in cannot be issued a certificate (requires_checkin)', async () => {
    const ineligibleStudentId = await createTestStudent('Ineligible Student');
    // Ineligible student has not checked in to Event A
    await expect(issueCertificateIfEligible(ineligibleStudentId, eventAId)).rejects.toThrow(
      /Attendee has not checked in/
    );
  });

  // Gate Test 7: Repeat certificate issuance is strictly idempotent and returns identical code
  it('(7) repeat certificate issuance returns identical verification code (idempotent)', async () => {
    const certStudentId = await createTestStudent('Eligible Cert Student');
    // 1. Issue and check in ticket for student
    const { token } = await createTicketForUser(eventAId, ticketTypeAId, certStudentId);
    const scanRes = await scanTicket({
      tokenOrUrl: token,
      eventId: eventAId,
      staffId: assignedStaffUserId,
    });
    expect(scanRes.outcome).toBe('ACCEPTED');

    // 2. Issue certificate first time
    const cert1 = await issueCertificateIfEligible(certStudentId, eventAId);
    expect(cert1).toBeDefined();
    expect(cert1.verification_code).toBeDefined();

    // 3. Issue certificate second time
    const cert2 = await issueCertificateIfEligible(certStudentId, eventAId);
    expect(cert2).toBeDefined();

    // Both verification codes must match exactly
    expect(cert2.verification_code).toBe(cert1.verification_code);
  });

  // Gate Test 8: Scan outside session check-in window -> OUTSIDE_WINDOW
  it('(8) scanning ticket outside session checkin window returns OUTSIDE_WINDOW', async () => {
    const client = await pool.connect();
    let sessionId: string;
    try {
      // Create session with check-in window in the past
      const sRes = await client.query(
        `INSERT INTO attendance_sessions (
           event_id, name, starts_at, ends_at, checkin_opens_at, checkin_closes_at
         ) VALUES (
           $1, 'Morning Keynote', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour',
           NOW() - INTERVAL '2 hours', NOW() - INTERVAL '90 minutes'
         ) RETURNING id;`,
        [eventAId]
      );
      sessionId = sRes.rows[0].id;
    } finally {
      client.release();
    }

    const windowStudentId = await createTestStudent('Window Test Student');
    const { token } = await createTicketForUser(eventAId, ticketTypeAId, windowStudentId);

    const result = await scanTicket({
      tokenOrUrl: token,
      eventId: eventAId,
      staffId: assignedStaffUserId,
      sessionId,
    });

    expect(result.outcome).toBe('OUTSIDE_WINDOW');
    expect(result.message).toContain('window is currently closed');
  });

  // Gate Test 9: Public verify endpoint returns name initials only and reflects REVOKED state
  it('(9) public verification endpoint returns name initials only and reflects REVOKED state', async () => {
    const studentName = 'Priya Patel';
    const priyaStudentId = await createTestStudent(studentName);

    // 1. Issue and check in ticket so certificate policy check passes
    const { token } = await createTicketForUser(eventAId, ticketTypeAId, priyaStudentId);
    const scanRes = await scanTicket({
      tokenOrUrl: token,
      eventId: eventAId,
      staffId: assignedStaffUserId,
    });
    expect(scanRes.outcome).toBe('ACCEPTED');

    // 2. Issue certificate
    const cert = await issueCertificateIfEligible(priyaStudentId, eventAId);
    const code = cert.verification_code;

    // 3. Query public verification endpoint
    const verifyRes = await app.inject({
      method: 'GET',
      url: `/api/v1/verify/${code}`,
    });

    expect(verifyRes.statusCode).toBe(200);
    const verifyBody = JSON.parse(verifyRes.body);

    expect(verifyBody.found).toBe(true);
    expect(verifyBody.valid).toBe(true);
    expect(verifyBody.status).toBe('VALID');

    // CRITICAL Zero PII Verification:
    // Name is "Priya Patel" -> Initials must be "P. P."
    expect(verifyBody.attendeeInitials).toBe('P. P.');
    // Must NOT contain full name or email
    expect(verifyBody.attendeeName).toBeUndefined();
    expect(verifyBody.email).toBeUndefined();
    expect(verifyBody.userId).toBeUndefined();

    // 4. Revoke ticket / certificate and verify state update
    const client = await pool.connect();
    try {
      await client.query(
        `UPDATE certificates SET revoked_at = NOW(), revoke_reason = 'Academic honor code violation' WHERE id = $1;`,
        [cert.id]
      );
    } finally {
      client.release();
    }

    const revokedVerifyRes = await app.inject({
      method: 'GET',
      url: `/api/v1/verify/${code}`,
    });

    expect(revokedVerifyRes.statusCode).toBe(200);
    const revokedBody = JSON.parse(revokedVerifyRes.body);
    expect(revokedBody.valid).toBe(false);
    expect(revokedBody.status).toBe('REVOKED');
    expect(revokedBody.revokeReason).toContain('Academic honor code violation');
    expect(revokedBody.attendeeInitials).toBe('P. P.');
  });
});
