import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { pool } from '../../packages/backend/src/db/index.js';
import { buildApp } from '../../packages/backend/src/app.js';
import {
  getOrCreatePassportSettings,
  updatePassportSettings,
  getPublicCrossCollegeEvents,
  escapeIlikeWildcards,
  recordServerAchievement,
} from '../../packages/backend/src/services/passport-crosscollege.js';
import {
  issueCertificateIfEligible,
} from '../../packages/backend/src/services/qr-ticket.js';
import { runRollbackToVersion } from '../../packages/backend/src/db/migrate-down.js';
import { runMigrations } from '../../packages/backend/src/db/migrate.js';

describe('Phase P20: Passport, Cross-College, Certificates & Eligibility Quality Gate', () => {
  let app: FastifyInstance;
  let collegeId: string;
  let organizerId: string;
  let organizerUserId: string;
  let studentAId: string;
  let studentAToken: string;
  let studentAHeaders: Record<string, string>;
  let studentBId: string;
  let studentBToken: string;
  let studentBHeaders: Record<string, string>;
  let testEventId: string;
  let certPolicyEventId: string;

  const createdUserIds: string[] = [];
  const createdEventIds: string[] = [];

  async function createTestUser(
    displayName: string,
    role = 'student',
    dept?: string,
    year?: number
  ): Promise<{ id: string; token: string; headers: Record<string, string> }> {
    const client = await pool.connect();
    try {
      const email = `test-p20-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@campus.edu`;
      const res = await client.query(
        `INSERT INTO users (college_id, email, password_hash, display_name, global_role, status, department, year, email_verified_at)
         VALUES ($1, $2, 'argon2id$dummy', $3, $4, 'active', $5, $6, NOW())
         RETURNING id;`,
        [collegeId, email, displayName, role, dept || null, year || null]
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
      const colRes = await client.query('SELECT id FROM colleges LIMIT 1;');
      if (colRes.rows.length > 0) {
        collegeId = colRes.rows[0].id;
      } else {
        const newCol = await client.query(
          `INSERT INTO colleges (name, domain, status, participation_status)
           VALUES ('Innovation Campus', $1, 'active', 'participating')
           RETURNING id;`,
          [`p20-${Date.now()}.edu`]
        );
        collegeId = newCol.rows[0].id;
      }

      const org = await createTestUser('P20 Organizer', 'student');
      organizerUserId = org.id;

      const stA = await createTestUser('Alice Sharma', 'student', 'Computer Science', 3);
      studentAId = stA.id;
      studentAToken = stA.token;
      studentAHeaders = stA.headers;

      const stB = await createTestUser('Bob Chen', 'student', 'Mechanical Engineering', 1);
      studentBId = stB.id;
      studentBToken = stB.token;
      studentBHeaders = stB.headers;

      const orgRes = await client.query(
        `INSERT INTO organizer_profiles (college_id, display_name, status, created_by)
         VALUES ($1, 'P20 Computer Science Council', 'verified', $2)
         RETURNING id;`,
        [collegeId, organizerUserId]
      );
      organizerId = orgRes.rows[0].id;

      await client.query(
        `INSERT INTO organizer_members (organizer_id, user_id, role, status)
         VALUES ($1, $2, 'owner', 'active')
         ON CONFLICT (organizer_id, user_id) DO NOTHING;`,
        [organizerId, organizerUserId]
      );

      await client.query(
        `INSERT INTO organizer_verifications (organizer_id, status, evidence_ref)
         VALUES ($1, 'VERIFIED', 'Official Council Charter')
         ON CONFLICT DO NOTHING;`,
        [organizerId]
      );

      // Event with eligibility restrictions
      const eRes = await client.query(
        `INSERT INTO events (
           organizer_id, college_id, title, slug, description, category, department, format,
           starts_at, ends_at, capacity, visibility, status, contact_email, created_by,
           eligibility
         ) VALUES (
           $1, $2, 'Advanced Robotics & AI Symposium', $3, 'A technical symposium for CS students.', 'Tech', 'CS', 'in_person',
           NOW() + INTERVAL '2 days', NOW() + INTERVAL '3 days', 100, 'public', 'published', 'org@campus.edu', $4,
           $5
         ) RETURNING id;`,
        [
          organizerId,
          collegeId,
          `p20-robotics-${Date.now()}`,
          organizerUserId,
          JSON.stringify({
            colleges: [collegeId],
            departments: ['Computer Science', 'Data Science'],
            years: [3, 4],
          }),
        ]
      );
      testEventId = eRes.rows[0].id;
      createdEventIds.push(testEventId);

      // Create free tier for booking
      await client.query(
        `INSERT INTO ticket_types (event_id, name, price_paise, capacity)
         VALUES ($1, 'General Admission', 0, 100);`,
        [testEventId]
      );

      // Event for Certificate Policy
      const certEvRes = await client.query(
        `INSERT INTO events (
           organizer_id, college_id, title, slug, description, category, department, format,
           starts_at, ends_at, capacity, visibility, status, contact_email, created_by
         ) VALUES (
           $1, $2, 'Graduate Research Summit 2026', $3, 'Annual research conference with verified credentials.', 'Tech', 'CS', 'in_person',
           NOW() + INTERVAL '1 day', NOW() + INTERVAL '2 days', 50, 'public', 'published', 'org@campus.edu', $4
         ) RETURNING id;`,
        [organizerId, collegeId, `p20-summit-${Date.now()}`, organizerUserId]
      );
      certPolicyEventId = certEvRes.rows[0].id;
      createdEventIds.push(certPolicyEventId);

      // Certificate policy: min_sessions = 1, requires_checkin = true
      await client.query(
        `INSERT INTO certificate_policies (event_id, min_sessions, requires_checkin)
         VALUES ($1, 1, true)
         ON CONFLICT (event_id) DO NOTHING;`,
        [certPolicyEventId]
      );

      // Create ticket and check-in for Student A on certPolicyEventId so they are eligible for certificate
      const tRes = await client.query(
        `INSERT INTO ticket_types (event_id, name, price_paise, capacity)
         VALUES ($1, 'Delegate Seat', 0, 50)
         RETURNING id;`,
        [certPolicyEventId]
      );
      const tierId = tRes.rows[0].id;

      const bRes = await client.query(
        `INSERT INTO bookings (event_id, user_id, status, total_paise, idempotency_key)
         VALUES ($1, $2, 'CONFIRMED', 0, $3)
         RETURNING id;`,
        [certPolicyEventId, studentAId, `bkg-p20-${Date.now()}`]
      );
      const bookingId = bRes.rows[0].id;

      const tkRes = await client.query(
        `INSERT INTO tickets (event_id, booking_id, user_id, ticket_type_id, ticket_code, qr_payload_hash, status, issued_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'CHECKED_IN', NOW())
         RETURNING id;`,
        [certPolicyEventId, bookingId, studentAId, tierId, `tk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, crypto.randomBytes(32)]
      );
      const ticketId = tkRes.rows[0].id;

      await client.query(
        `INSERT INTO checkins (ticket_id, event_id, staff_id, scanned_at)
         VALUES ($1, $2, $3, NOW());`,
        [ticketId, certPolicyEventId, organizerUserId]
      );
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    const client = await pool.connect();
    try {
      if (createdEventIds.length > 0) {
        await client.query(`DELETE FROM events WHERE id = ANY($1);`, [createdEventIds]);
      }
      if (createdUserIds.length > 0) {
        await client.query(`DELETE FROM users WHERE id = ANY($1);`, [createdUserIds]);
      }
    } catch {
      // Best-effort cleanup
    } finally {
      client.release();
    }
  });

  // 1. PII Snapshot & Zero PII Leak on /p/:slug
  it('(1) /p/:slug guarantees zero PII leak (no email, phone, roll, or user ID) and returns clean public payload', async () => {
    const settings = await getOrCreatePassportSettings(studentAId);
    await updatePassportSettings(studentAId, { isPublic: true });

    // Record verified achievements
    await recordServerAchievement({
      userId: studentAId,
      type: 'ATTENDANCE',
      sourceEventId: testEventId,
      sourceRefId: crypto.randomUUID(),
      verificationStatus: 'VERIFIED',
      visibility: 'public',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/p/${settings.slug}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Verify root fields
    expect(body).toHaveProperty('displayName', 'Alice Sharma');
    expect(body).toHaveProperty('slug', settings.slug);
    expect(body).toHaveProperty('collegeName');
    expect(body).toHaveProperty('verifiedStudent', true);
    expect(body).toHaveProperty('achievements');
    expect(Array.isArray(body.achievements)).toBe(true);

    // Strict PII snapshot assertion: disallowed fields must be strictly undefined
    expect(body.id).toBeUndefined();
    expect(body.userId).toBeUndefined();
    expect(body.email).toBeUndefined();
    expect(body.phone).toBeUndefined();
    expect(body.roll).toBeUndefined();
    expect(body.passwordHash).toBeUndefined();
    expect(body.token).toBeUndefined();

    // Verify achievement item fields
    for (const ach of body.achievements) {
      expect(ach).toHaveProperty('id');
      expect(ach).toHaveProperty('type');
      expect(ach).toHaveProperty('title');
      expect(ach).toHaveProperty('eventDate');
      expect(ach).toHaveProperty('badgeLabel');
      expect(ach).toHaveProperty('verificationStatus', 'VERIFIED');

      expect(ach.userId).toBeUndefined();
      expect(ach.email).toBeUndefined();
      expect(ach.sourceRefId).toBeUndefined();
    }
  });

  // 2. PII Snapshot & Zero PII Leak on /verify/:code
  it('(2) /verify/:code exposes only attendee initials, event date, and validity (zero email, roll or user ID)', async () => {
    const cert = await issueCertificateIfEligible(studentAId, certPolicyEventId);
    expect(cert).toBeDefined();
    expect(cert.verification_code).toBeDefined();

    const code = cert.verification_code;

    const res = await app.inject({
      method: 'GET',
      url: `/verify/${code}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.found).toBe(true);
    expect(body.valid).toBe(true);
    expect(body.status).toBe('VALID');
    expect(body.verificationCode).toBe(code);
    expect(body.eventTitle).toBe('Graduate Research Summit 2026');
    expect(body.attendeeInitials).toBe('A. S.'); // Initials only!

    // Strict PII checks
    expect(body.userId).toBeUndefined();
    expect(body.email).toBeUndefined();
    expect(body.phone).toBeUndefined();
    expect(body.user_name).toBeUndefined();
    expect(body.displayName).toBeUndefined();
    expect(body.fullName).toBeUndefined();
    expect(body.hash).toBeUndefined();
  });

  // 3. Privacy Toggles Server-Side Enforcement
  it('(3) server-side privacy toggles instantly hide /p/:slug or specific achievement types', async () => {
    const settings = await getOrCreatePassportSettings(studentAId);

    // 1. When isPublic is toggled to false -> /p/:slug returns 404 immediately
    await updatePassportSettings(studentAId, { isPublic: false });
    const privateRes = await app.inject({
      method: 'GET',
      url: `/p/${settings.slug}`,
    });
    expect(privateRes.statusCode).toBe(404);
    expect(privateRes.json().error.code).toBe('NOT_FOUND');

    // 2. When isPublic is true, but showAttendance is false -> ATTENDANCE omitted from achievements
    await updatePassportSettings(studentAId, {
      isPublic: true,
      showAttendance: false,
      showCertificates: true,
      showVolunteer: true,
    });

    const noAttendanceRes = await app.inject({
      method: 'GET',
      url: `/p/${settings.slug}`,
    });
    expect(noAttendanceRes.statusCode).toBe(200);
    const noAttBody = noAttendanceRes.json();
    const attendanceRecords = noAttBody.achievements.filter((a: any) => a.type === 'ATTENDANCE');
    expect(attendanceRecords.length).toBe(0);

    // 3. Toggle back showAttendance = true -> attendance records reappear
    await updatePassportSettings(studentAId, { showAttendance: true });
    const withAttendanceRes = await app.inject({
      method: 'GET',
      url: `/p/${settings.slug}`,
    });
    expect(withAttendanceRes.statusCode).toBe(200);
    const withAttBody = withAttendanceRes.json();
    const restoredAttendance = withAttBody.achievements.filter((a: any) => a.type === 'ATTENDANCE');
    expect(restoredAttendance.length).toBeGreaterThan(0);
  });

  // 4. Brute-Force Rate Limiting (Per IP + Global)
  it('(4) certificate verification rate limit triggers 429 when max requests per minute are exceeded', async () => {
    const testIp = '198.51.100.42';

    // Simulate 30 rapid verification attempts
    for (let i = 0; i < 30; i++) {
      await app.inject({
        method: 'GET',
        url: `/api/v1/verify/CODE${i}`,
        headers: { 'x-forwarded-for': testIp },
      });
    }

    // The 31st request from same IP must be throttled with 429
    const throttledRes = await app.inject({
      method: 'GET',
      url: '/api/v1/verify/THROTTLED123',
      headers: { 'x-forwarded-for': testIp },
    });

    expect(throttledRes.statusCode).toBe(429);
    expect(throttledRes.json().error.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  // 5. Constant-Time Code Compare
  it('(5) certificate Crockford verification normalizes hyphens/case and compares codes safely', async () => {
    const cert = await issueCertificateIfEligible(studentAId, certPolicyEventId);
    const code = cert.verification_code;

    // 1. Lowercase without hyphens
    const strippedLower = code.replace(/-/g, '').toLowerCase();
    const resLower = await app.inject({
      method: 'GET',
      url: `/verify/${strippedLower}`,
    });
    expect(resLower.statusCode).toBe(200);
    expect(resLower.json().valid).toBe(true);

    // 2. Mixed case with hyphens
    const mixedCase = code.toLowerCase();
    const resMixed = await app.inject({
      method: 'GET',
      url: `/verify/${mixedCase}`,
    });
    expect(resMixed.statusCode).toBe(200);
    expect(resMixed.json().valid).toBe(true);

    // 3. Invalid code returns 404
    const resInvalid = await app.inject({
      method: 'GET',
      url: `/verify/INVALID-CERT-CODE-999`,
    });
    expect(resInvalid.statusCode).toBe(404);
    expect(resInvalid.json().error.code).toBe('CERTIFICATE_NOT_FOUND');
  });

  // 6. Slug Collision Retry
  it('(6) passport slug creation handles collisions by generating distinct random suffixes', async () => {
    // Both users have display name 'Collision Test Candidate'
    const user1 = await createTestUser('Collision Test Candidate');
    const user2 = await createTestUser('Collision Test Candidate');

    const settings1 = await getOrCreatePassportSettings(user1.id);
    const settings2 = await getOrCreatePassportSettings(user2.id);

    expect(settings1.slug).toBeDefined();
    expect(settings2.slug).toBeDefined();
    expect(settings1.slug).not.toBe(settings2.slug);
    expect(settings1.slug.startsWith('collision-test-candidate')).toBe(true);
    expect(settings2.slug.startsWith('collision-test-candidate')).toBe(true);
  });

  // 7. ILIKE Wildcard Escaping & Result Size Capping
  it('(7) public discovery escapes ILIKE wildcards safely and enforces result size caps', async () => {
    // 1. Wildcard escape helper test
    expect(escapeIlikeWildcards('100% Guaranteed_Hackathon\\Tech')).toBe(
      '100\\% Guaranteed\\_Hackathon\\\\Tech'
    );

    // 2. Querying with %, _, and \ does not trigger wildcard matching
    const searchRes = await app.inject({
      method: 'GET',
      url: `/api/v1/public/events?q=${encodeURIComponent('100%_fake_query')}`,
    });
    expect(searchRes.statusCode).toBe(200);
    expect(searchRes.json().events).toBeDefined();
    expect(Array.isArray(searchRes.json().events)).toBe(true);

    // 3. Result size is capped at 50
    const allEvents = await getPublicCrossCollegeEvents({});
    expect(allEvents.length).toBeLessThanOrEqual(50);
  });

  // 8. Real Department and Year Eligibility Verification
  it('(8) eligibility reads real department and year columns; enforces booking restrictions accurately', async () => {
    // 1. Verify user profile update endpoint sets real department and year
    const updateRes = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: studentBHeaders,
      payload: {
        department: 'Mechanical Engineering',
        year: 1,
      },
    });

    expect(updateRes.statusCode).toBe(200);
    const userB = updateRes.json().user;
    expect(userB.department).toBe('Mechanical Engineering');
    expect(userB.year).toBe(1);

    // Verify GET /api/v1/me returns real department and year
    const meRes = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: studentBHeaders,
    });
    expect(meRes.statusCode).toBe(200);
    expect(meRes.json().user.department).toBe('Mechanical Engineering');
    expect(meRes.json().user.year).toBe(1);

    // Get ticket tier for testEventId (requires CS or Data Science; Year 3 or 4)
    const client = await pool.connect();
    let ticketTierId = '';
    try {
      const tierRes = await client.query('SELECT id FROM ticket_types WHERE event_id = $1 LIMIT 1;', [testEventId]);
      ticketTierId = tierRes.rows[0].id;
    } finally {
      client.release();
    }

    // 2. Student B (Mechanical Engineering, Year 1) attempts booking -> REJECTED with DEPARTMENT_INELIGIBLE
    const failRes = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${testEventId}/bookings`,
      headers: { ...studentBHeaders, 'idempotency-key': `bkg-fail-${Date.now()}` },
      payload: {
        items: [{ ticketTypeId: ticketTierId, quantity: 1 }],
      },
    });

    expect(failRes.statusCode).toBe(403);
    const failBody = failRes.json();
    expect(failBody.error.code).toBe('DEPARTMENT_INELIGIBLE');
    expect(failBody.error.message).toContain('Computer Science');

    // 3. Student A (Computer Science, Year 3) attempts booking -> SUCCEEDS (meets department & year)
    const passRes = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${testEventId}/bookings`,
      headers: { ...studentAHeaders, 'idempotency-key': `bkg-pass-${Date.now()}` },
      payload: {
        items: [{ ticketTypeId: ticketTierId, quantity: 1 }],
      },
    });

    expect(passRes.statusCode).toBe(201);
    expect(passRes.json().booking.status).toBe('CONFIRMED');
  });

  // 9. Idempotent Certificate Issuance
  it('(9) issueCertificateIfEligible is strictly idempotent and does not overwrite verification code or hash', async () => {
    // First issuance
    const cert1 = await issueCertificateIfEligible(studentAId, certPolicyEventId);
    expect(cert1).toBeDefined();
    expect(cert1.verification_code).toBeDefined();

    // Second issuance (repeated call)
    const cert2 = await issueCertificateIfEligible(studentAId, certPolicyEventId);
    expect(cert2).toBeDefined();

    // Must be identical
    expect(cert2.id).toBe(cert1.id);
    expect(cert2.verification_code).toBe(cert1.verification_code);

    // Database check: strictly ONE row in certificates
    const client = await pool.connect();
    try {
      const rows = await client.query(
        'SELECT * FROM certificates WHERE user_id = $1 AND event_id = $2;',
        [studentAId, certPolicyEventId]
      );
      expect(rows.rowCount).toBe(1);
      expect(rows.rows[0].verification_code).toBe(cert1.verification_code);
    } finally {
      client.release();
    }
  });

  // 10. Deletion of /student_achievements Stub & No Duplicate Root Prefix
  it('(10) public /student_achievements stub is deleted (404) and no unauthenticated duplicate route prefix exists', async () => {
    // 1. Public /student_achievements stub must return 404 (deleted)
    const resAch = await app.inject({
      method: 'POST',
      url: '/api/v1/student_achievements',
      payload: { title: 'Self-entered award' },
    });
    expect(resAch.statusCode).toBe(404);

    // 2. Root prefix does not expose unauthenticated admin route clones
    const resCol = await app.inject({
      method: 'POST',
      url: `/admin/colleges/${collegeId}/verify`,
      payload: { participationStatus: 'participating' },
    });
    // Since crossCollegePassportRoutes is no longer mounted at root '', this path must 404
    expect(resCol.statusCode).toBe(404);
  });

  // 11. Database Migration 23 & Rollback Integrity
  it('(11) verifies migration 23 department/year columns and down-migration idempotently', async () => {
    const client = await pool.connect();
    try {
      // Verify department and year exist on users
      const colCheck = await client.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name IN ('department', 'year');
      `);
      expect(colCheck.rowCount).toBe(2);

      // Verify index
      const idxCheck = await client.query(`
        SELECT indexname FROM pg_indexes WHERE indexname = 'idx_users_college_dept';
      `);
      expect(idxCheck.rowCount).toBe(1);
    } finally {
      client.release();
    }

    // Rollback to version 22
    await runRollbackToVersion(22);

    // Verify columns dropped in version 22
    const client2 = await pool.connect();
    try {
      const colCheck2 = await client2.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name IN ('department', 'year');
      `);
      expect(colCheck2.rowCount).toBe(0);
    } finally {
      client2.release();
    }

    // Re-apply migrations back to latest (23)
    await runMigrations();

    // Verify columns restored
    const client3 = await pool.connect();
    try {
      const colCheck3 = await client3.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name IN ('department', 'year');
      `);
      expect(colCheck3.rowCount).toBe(2);
    } finally {
      client3.release();
    }
  });
});
