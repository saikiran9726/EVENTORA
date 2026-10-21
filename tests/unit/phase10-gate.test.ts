import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { pool } from '../../packages/backend/src/db/index.js';
import { buildApp } from '../../packages/backend/src/app.js';
import {
  getPublicCrossCollegeEvents,
  checkRegistrationEligibility,
  getOrCreatePassportSettings,
  updatePassportSettings,
  getPublicPassport,
  recordServerAchievement,
  revokeServerAchievement,
  getStudentAchievements,
  verifyCollege,
  verifyOrganizer,
} from '../../packages/backend/src/services/passport-crosscollege.js';

describe('Phase 10 Quality Gate: Cross-College Discovery & Student Event Passport (FR-XCOL, FR-PASS)', () => {
  let app: any;
  let collegeAId: string;
  let collegeBId: string;
  let adminUserId: string;
  let adminSessionToken: string;
  let studentAUserId: string;
  let studentASessionToken: string;
  let studentBUserId: string;
  let studentBSessionToken: string;
  let verifiedOrganizerId: string;
  let unverifiedOrganizerId: string;
  let publicVerifiedEventId: string;
  let collegePrivateEventId: string;
  let unverifiedOrgEventId: string;
  let nonParticipatingColEventId: string;

  const csrfToken = 'test-csrf-token-phase10';

  const cleanGateData = async () => {
    await pool.query(`DELETE FROM student_achievements WHERE source_event_id IN (SELECT id FROM events WHERE slug LIKE 'gate-p10-%');`);
    await pool.query(`DELETE FROM passport_settings WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@phase10.test');`);
    await pool.query(`DELETE FROM checkins WHERE event_id IN (SELECT id FROM events WHERE slug LIKE 'gate-p10-%');`);
    await pool.query(`DELETE FROM certificates WHERE event_id IN (SELECT id FROM events WHERE slug LIKE 'gate-p10-%');`);
    await pool.query(`DELETE FROM tickets WHERE event_id IN (SELECT id FROM events WHERE slug LIKE 'gate-p10-%');`);
    await pool.query(`DELETE FROM booking_items WHERE booking_id IN (SELECT id FROM bookings WHERE event_id IN (SELECT id FROM events WHERE slug LIKE 'gate-p10-%'));`);
    await pool.query(`DELETE FROM bookings WHERE event_id IN (SELECT id FROM events WHERE slug LIKE 'gate-p10-%');`);
    await pool.query(`DELETE FROM ticket_types WHERE event_id IN (SELECT id FROM events WHERE slug LIKE 'gate-p10-%');`);
    await pool.query(`DELETE FROM events WHERE slug LIKE 'gate-p10-%';`);
    await pool.query(`DELETE FROM organizer_verifications WHERE organizer_id IN (SELECT id FROM organizer_profiles WHERE display_name LIKE 'P10 %');`);
    await pool.query(`DELETE FROM organizer_members WHERE organizer_id IN (SELECT id FROM organizer_profiles WHERE display_name LIKE 'P10 %');`);
    await pool.query(`DELETE FROM organizer_profiles WHERE display_name LIKE 'P10 %';`);
    await pool.query(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@phase10.test');`);
    await pool.query(`DELETE FROM users WHERE email LIKE '%@phase10.test';`);
    await pool.query(`DELETE FROM colleges WHERE domain LIKE '%phase10.test';`);
  };

  const createSessionForUser = async (userId: string): Promise<string> => {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest();
    await pool.query(
      `INSERT INTO sessions (id_hash, user_id, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '1 day');`,
      [tokenHash, userId]
    );
    return rawToken;
  };

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
    await cleanGateData();

    // 1. Create Participating College A
    const colARes = await pool.query(
      `INSERT INTO colleges (name, domain, status, public_discovery, participation_status, verified_at)
       VALUES ('Tech University A', 'techa.phase10.test', 'active', TRUE, 'participating', NOW())
       RETURNING id;`
    );
    collegeAId = colARes.rows[0].id;

    // 2. Create Non-Participating College B
    const colBRes = await pool.query(
      `INSERT INTO colleges (name, domain, status, public_discovery, participation_status)
       VALUES ('Polytechnic Institute B', 'polyb.phase10.test', 'active', FALSE, 'none')
       RETURNING id;`
    );
    collegeBId = colBRes.rows[0].id;

    // 3. Create Admin
    const adminRes = await pool.query(
      `INSERT INTO users (college_id, email, password_hash, display_name, global_role, status)
       VALUES ($1, 'admin@phase10.test', 'hash', 'Platform Admin', 'admin', 'active')
       RETURNING id;`,
      [collegeAId]
    );
    adminUserId = adminRes.rows[0].id;
    adminSessionToken = await createSessionForUser(adminUserId);

    // 4. Create Student from College A
    const studentARes = await pool.query(
      `INSERT INTO users (college_id, email, password_hash, display_name, global_role, status)
       VALUES ($1, 'studenta@phase10.test', 'hash', 'Aarav Patel', 'student', 'active')
       RETURNING id;`,
      [collegeAId]
    );
    studentAUserId = studentARes.rows[0].id;
    studentASessionToken = await createSessionForUser(studentAUserId);

    // 5. Create Student from College B
    const studentBRes = await pool.query(
      `INSERT INTO users (college_id, email, password_hash, display_name, global_role, status)
       VALUES ($1, 'studentb@phase10.test', 'hash', 'Bhavna Sharma', 'student', 'active')
       RETURNING id;`,
      [collegeBId]
    );
    studentBUserId = studentBRes.rows[0].id;
    studentBSessionToken = await createSessionForUser(studentBUserId);

    // 6. Create Verified Organizer under College A
    const org1Res = await pool.query(
      `INSERT INTO organizer_profiles (college_id, display_name, status, created_by)
       VALUES ($1, 'P10 Robotics Society', 'verified', $2)
       RETURNING id;`,
      [collegeAId, adminUserId]
    );
    verifiedOrganizerId = org1Res.rows[0].id;

    await pool.query(
      `INSERT INTO organizer_verifications (organizer_id, status, evidence_ref, reviewed_by, reviewed_at)
       VALUES ($1, 'VERIFIED', 'Official chartered student society', $2, NOW());`,
      [verifiedOrganizerId, adminUserId]
    );

    // 7. Create Unverified Organizer under College A
    const org2Res = await pool.query(
      `INSERT INTO organizer_profiles (college_id, display_name, status, created_by)
       VALUES ($1, 'P10 Unverified Club', 'pending', $2)
       RETURNING id;`,
      [collegeAId, adminUserId]
    );
    unverifiedOrganizerId = org2Res.rows[0].id;

    await pool.query(
      `INSERT INTO organizer_verifications (organizer_id, status, evidence_ref)
       VALUES ($1, 'PENDING', 'Awaiting review');`,
      [unverifiedOrganizerId]
    );

    // 8. Event 1: Public + Verified Organizer + Participating College
    const ev1Res = await pool.query(
      `INSERT INTO events (
        organizer_id, college_id, title, slug, description, category,
        format, starts_at, ends_at, capacity, visibility, status, contact_email, created_by,
        eligibility
       ) VALUES (
        $1, $2, 'AI Grand Hackathon 2026', 'gate-p10-hackathon-public', 'Inter-college autonomous challenge',
        'Technical', 'in_person', NOW() + INTERVAL '5 days', NOW() + INTERVAL '6 days', 200, 'public',
        'published', 'lead@p10robotics.test', $3,
        $4
       ) RETURNING id;`,
      [verifiedOrganizerId, collegeAId, adminUserId, JSON.stringify({ colleges: [collegeAId] })]
    );
    publicVerifiedEventId = ev1Res.rows[0].id;

    // Add Ticket Type for Event 1
    await pool.query(
      `INSERT INTO ticket_types (event_id, name, price_paise, capacity)
       VALUES ($1, 'General Admission', 0, 200);`,
      [publicVerifiedEventId]
    );

    // 9. Event 2: College-Internal Visibility ('college')
    const ev2Res = await pool.query(
      `INSERT INTO events (
        organizer_id, college_id, title, slug, description, category,
        format, starts_at, ends_at, capacity, visibility, status, contact_email, created_by
       ) VALUES (
        $1, $2, 'Internal College A Assembly', 'gate-p10-internal-assembly', 'Private departmental symposium',
        'Academic', 'in_person', NOW() + INTERVAL '3 days', NOW() + INTERVAL '4 days', 100, 'college',
        'published', 'assembly@techa.phase10.test', $3
       ) RETURNING id;`,
      [verifiedOrganizerId, collegeAId, adminUserId]
    );
    collegePrivateEventId = ev2Res.rows[0].id;

    // 10. Event 3: Public, but organizer is UNVERIFIED
    const ev3Res = await pool.query(
      `INSERT INTO events (
        organizer_id, college_id, title, slug, description, category,
        format, starts_at, ends_at, capacity, visibility, status, contact_email, created_by
       ) VALUES (
        $1, $2, 'Unverified Club Meetup', 'gate-p10-unverified-meetup', 'Informal gathering',
        'Social', 'in_person', NOW() + INTERVAL '2 days', NOW() + INTERVAL '2 days 2 hours', 50, 'public',
        'published', 'meet@unverified.test', $3
       ) RETURNING id;`,
      [unverifiedOrganizerId, collegeAId, adminUserId]
    );
    unverifiedOrgEventId = ev3Res.rows[0].id;

    // 11. Event 4: Public, but college is NON-PARTICIPATING (College B)
    const orgBRes = await pool.query(
      `INSERT INTO organizer_profiles (college_id, display_name, status, created_by)
       VALUES ($1, 'P10 College B Club', 'verified', $2)
       RETURNING id;`,
      [collegeBId, adminUserId]
    );
    await pool.query(
      `INSERT INTO organizer_verifications (organizer_id, status, evidence_ref, reviewed_by, reviewed_at)
       VALUES ($1, 'VERIFIED', 'Charter verified', $2, NOW());`,
      [orgBRes.rows[0].id, adminUserId]
    );

    const ev4Res = await pool.query(
      `INSERT INTO events (
        organizer_id, college_id, title, slug, description, category,
        format, starts_at, ends_at, capacity, visibility, status, contact_email, created_by
       ) VALUES (
        $1, $2, 'Non-Participating Campus Meet', 'gate-p10-nonpart-meet', 'College B exclusive',
        'Academic', 'in_person', NOW() + INTERVAL '7 days', NOW() + INTERVAL '8 days', 80, 'public',
        'published', 'club@polyb.phase10.test', $3
       ) RETURNING id;`,
      [orgBRes.rows[0].id, collegeBId, adminUserId]
    );
    nonParticipatingColEventId = ev4Res.rows[0].id;
  });

  afterAll(async () => {
    await cleanGateData();
    if (app) await app.close();
  });

  // ------------------------------------------------------------------------
  // GATE TEST 1: Cross-College Anonymous Public Discovery (FR-XCOL)
  // ------------------------------------------------------------------------
  it('(1) Public Discovery: strictly filters in SQL WHERE (public + verified organizer + participating college)', async () => {
    const publicEvents = await getPublicCrossCollegeEvents({});

    // Verify only publicVerifiedEventId is returned
    const returnedIds = publicEvents.map((e) => e.id);
    expect(returnedIds).toContain(publicVerifiedEventId);
    expect(returnedIds).not.toContain(collegePrivateEventId); // Excluded: visibility='college'
    expect(returnedIds).not.toContain(unverifiedOrgEventId); // Excluded: organizer status='PENDING'
    expect(returnedIds).not.toContain(nonParticipatingColEventId); // Excluded: college participation_status='none'

    // Verify HTTP endpoint behavior
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/public/events',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(Array.isArray(body.events)).toBe(true);

    const apiIds = body.events.map((e: any) => e.id);
    expect(apiIds).toContain(publicVerifiedEventId);
    expect(apiIds).not.toContain(collegePrivateEventId);
    expect(apiIds).not.toContain(unverifiedOrgEventId);
    expect(apiIds).not.toContain(nonParticipatingColEventId);
  });

  // ------------------------------------------------------------------------
  // GATE TEST 2: Data Scrubbing & Anti-IDOR in Public Discovery
  // ------------------------------------------------------------------------
  it('(2) Public Discovery: strips raw attendee counts to coarse buckets and conceals contact email', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/public/events',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    const ev = body.events.find((e: any) => e.id === publicVerifiedEventId);

    expect(ev).toBeDefined();
    // Coarse bucket present
    expect(ev.attendeeBucket).toMatch(/New Event|< 25 attendees|25\+ attendees/);
    // Raw count stripped
    expect((ev as any).raw_count).toBeUndefined();
    // Contact email stripped
    expect((ev as any).contactEmail).toBeUndefined();
    expect((ev as any).contact_email).toBeUndefined();
    // Verified organizer badge
    expect(ev.isOrganizerVerified).toBe(true);
  });

  // ------------------------------------------------------------------------
  // GATE TEST 3: Cross-College Registration Eligibility Enforcement
  // ------------------------------------------------------------------------
  it('(3) Cross-college registration: ineligible student receives 403 Forbidden', async () => {
    // Event 1 eligibility restricts to College A: { colleges: [collegeAId] }
    // Student B belongs to College B
    const ticketTypeRes = await pool.query(
      `SELECT id FROM ticket_types WHERE event_id = $1 LIMIT 1;`,
      [publicVerifiedEventId]
    );
    const ticketTypeId = ticketTypeRes.rows[0].id;

    // Student B attempts to book
    const failRes = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${publicVerifiedEventId}/bookings`,
      headers: {
        authorization: `Bearer ${studentBSessionToken}`,
        cookie: `eventora_session=${studentBSessionToken}; eventora_csrf=${csrfToken}`,
        'x-csrf-token': csrfToken,
        'idempotency-key': `gate-idem-b-${Date.now()}`,
      },
      payload: {
        items: [{ ticketTypeId, quantity: 1 }],
      },
    });

    expect(failRes.statusCode).toBe(403);
    const failBody = JSON.parse(failRes.payload);
    expect(failBody.error.code).toBe('COLLEGE_INELIGIBLE');
    expect(failBody.error.message).toMatch(/restricted to students of specific participating institutions/i);

    // Student A (from College A) is eligible
    const eligibleCheck = await checkRegistrationEligibility(publicVerifiedEventId, {
      collegeId: collegeAId,
    });
    expect(eligibleCheck.eligible).toBe(true);
  });

  // ------------------------------------------------------------------------
  // GATE TEST 4: Student Passport Settings & Immediate Cache Bypass
  // ------------------------------------------------------------------------
  it('(4) Passport Settings: private passport returns 404 with Cache-Control: no-store', async () => {
    // 1. Initial settings for Student A (default is_public = false)
    const settings = await getOrCreatePassportSettings(studentAUserId);
    expect(settings.isPublic).toBe(false);
    expect(settings.slug).toBeDefined();

    // 2. Querying private passport returns 404 (indistinguishable from nonexistent)
    const privRes = await app.inject({
      method: 'GET',
      url: `/p/${settings.slug}`,
    });

    expect(privRes.statusCode).toBe(404);
    expect(privRes.headers['cache-control']).toMatch(/no-store/i);

    // Also verify /api/v1/p/:slug
    const apiPrivRes = await app.inject({
      method: 'GET',
      url: `/api/v1/p/${settings.slug}`,
    });
    expect(apiPrivRes.statusCode).toBe(404);
    expect(apiPrivRes.headers['cache-control']).toMatch(/no-store/i);
  });

  // ------------------------------------------------------------------------
  // GATE TEST 5: Public Passport Resolver & Zero PII Protection
  // ------------------------------------------------------------------------
  it('(5) Public Passport: when toggled public, displays name and verified badges with ZERO PII', async () => {
    const settings = await getOrCreatePassportSettings(studentAUserId);

    // 1. Record verified achievements
    await recordServerAchievement({
      userId: studentAUserId,
      type: 'ATTENDANCE',
      sourceEventId: publicVerifiedEventId,
      sourceRefId: crypto.randomUUID(),
      verificationStatus: 'VERIFIED',
      visibility: 'public',
    });

    await recordServerAchievement({
      userId: studentAUserId,
      type: 'CERTIFICATE',
      sourceEventId: publicVerifiedEventId,
      sourceRefId: crypto.randomUUID(),
      verificationStatus: 'VERIFIED',
      visibility: 'public',
    });

    // 2. Toggle public visibility to true via API
    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me/passport/visibility',
      headers: {
        authorization: `Bearer ${studentASessionToken}`,
        cookie: `eventora_session=${studentASessionToken}; eventora_csrf=${csrfToken}`,
        'x-csrf-token': csrfToken,
      },
      payload: {
        isPublic: true,
      },
    });

    expect(patchRes.statusCode).toBe(200);

    // 3. Query public passport
    const pubRes = await app.inject({
      method: 'GET',
      url: `/p/${settings.slug}`,
    });

    expect(pubRes.statusCode).toBe(200);
    expect(pubRes.headers['cache-control']).toMatch(/no-store/i);

    const pubBody = JSON.parse(pubRes.payload);
    expect(pubBody.displayName).toBe('Aarav Patel');
    expect(pubBody.collegeName).toBe('Tech University A');
    expect(pubBody.verifiedStudent).toBe(true);
    expect(pubBody.achievements.length).toBeGreaterThanOrEqual(2);

    // ZERO PII Verification:
    expect((pubBody as any).email).toBeUndefined();
    expect((pubBody as any).phone).toBeUndefined();
    expect((pubBody as any).rollNumber).toBeUndefined();

    // 4. Instant Toggle Off (Cache-Control: no-store immediately takes effect)
    await updatePassportSettings(studentAUserId, { isPublic: false });

    const turnedOffRes = await app.inject({
      method: 'GET',
      url: `/p/${settings.slug}`,
    });
    expect(turnedOffRes.statusCode).toBe(404);
  });

  // ------------------------------------------------------------------------
  // GATE TEST 6: Rejection of Self-Entered Achievements (405/404)
  // ------------------------------------------------------------------------
  it('(6) Anti-tamper: self-entered achievement attempts are strictly rejected with 405 Method Not Allowed', async () => {
    // Attempt 1: POST /api/v1/me/achievements
    const attempt1 = await app.inject({
      method: 'POST',
      url: '/api/v1/me/achievements',
      headers: {
        authorization: `Bearer ${studentASessionToken}`,
        cookie: `eventora_session=${studentASessionToken}; eventora_csrf=${csrfToken}`,
        'x-csrf-token': csrfToken,
      },
      payload: {
        type: 'CERTIFICATE',
        sourceEventId: publicVerifiedEventId,
      },
    });

    expect(attempt1.statusCode).toBe(405);
    const body1 = JSON.parse(attempt1.payload);
    expect(body1.error.code).toBe('METHOD_NOT_ALLOWED');
    expect(body1.error.message).toMatch(/cannot be self-entered/i);

    // Attempt 2: POST /api/v1/student_achievements
    const attempt2 = await app.inject({
      method: 'POST',
      url: '/api/v1/student_achievements',
      payload: {
        title: 'Fake achievement',
      },
    });

    expect(attempt2.statusCode).toBe(405);
  });

  // ------------------------------------------------------------------------
  // GATE TEST 7: Source Revocation Automatically Propagates to Achievements
  // ------------------------------------------------------------------------
  it('(7) Revocation propagation: revoking source certificate sets achievement verification_status = REVOKED', async () => {
    const certRefId = crypto.randomUUID();

    // 1. Create achievement for a certificate
    await recordServerAchievement({
      userId: studentAUserId,
      type: 'CERTIFICATE',
      sourceEventId: publicVerifiedEventId,
      sourceRefId: certRefId,
      verificationStatus: 'VERIFIED',
      visibility: 'public',
    });

    const activeAchievements = await getStudentAchievements(studentAUserId);
    const certAch = activeAchievements.find((a) => a.sourceRefId === certRefId);
    expect(certAch).toBeDefined();
    expect(certAch?.verificationStatus).toBe('VERIFIED');

    // 2. Revoke the achievement via source revocation trigger
    const revoked = await revokeServerAchievement('CERTIFICATE', certRefId);
    expect(revoked).toBe(true);

    // 3. Verify achievement verificationStatus is now REVOKED
    const postRevoke = await getStudentAchievements(studentAUserId);
    const updatedAch = postRevoke.find((a) => a.sourceRefId === certRefId);
    expect(updatedAch?.verificationStatus).toBe('REVOKED');
  });

  // ------------------------------------------------------------------------
  // GATE TEST 8: Admin Verification of Colleges and Organizers
  // ------------------------------------------------------------------------
  it('(8) Admin Governance: Admin verifies college and organizer; non-admin is blocked with 403', async () => {
    // 1. Non-admin student attempts to verify college -> 403
    const studentAttempt = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/colleges/${collegeBId}/verify`,
      headers: {
        authorization: `Bearer ${studentASessionToken}`,
        cookie: `eventora_session=${studentASessionToken}; eventora_csrf=${csrfToken}`,
        'x-csrf-token': csrfToken,
      },
      payload: {
        participationStatus: 'participating',
      },
    });
    expect(studentAttempt.statusCode).toBe(403);

    // 2. Admin verifies College B
    const adminCollegeVerify = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/colleges/${collegeBId}/verify`,
      headers: {
        authorization: `Bearer ${adminSessionToken}`,
        cookie: `eventora_session=${adminSessionToken}; eventora_csrf=${csrfToken}`,
        'x-csrf-token': csrfToken,
      },
      payload: {
        participationStatus: 'participating',
      },
    });
    if (adminCollegeVerify.statusCode !== 200) {
      console.error('adminCollegeVerify error:', adminCollegeVerify.payload);
    }
    expect(adminCollegeVerify.statusCode).toBe(200);

    const updatedCol = JSON.parse(adminCollegeVerify.payload);
    expect(updatedCol.college.participationStatus).toBe('participating');
    expect(updatedCol.college.verifiedAt).toBeDefined();

    // 3. Admin verifies Unverified Organizer
    const adminOrgVerify = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizers/${unverifiedOrganizerId}/verify`,
      headers: {
        authorization: `Bearer ${adminSessionToken}`,
        cookie: `eventora_session=${adminSessionToken}; eventora_csrf=${csrfToken}`,
        'x-csrf-token': csrfToken,
      },
      payload: {
        status: 'VERIFIED',
        evidenceRef: 'Dean official approval letter',
      },
    });
    expect(adminOrgVerify.statusCode).toBe(200);
    const updatedOrg = JSON.parse(adminOrgVerify.payload);
    expect(updatedOrg.verification.status).toBe('VERIFIED');
  });
});
