import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../packages/backend/src/app.js';
import { pool } from '../../packages/backend/src/db/index.js';
import {
  submitFeedback,
  refreshEventMetrics,
  getPublicEventRatings,
  getOrganizerFeedback,
  getOrganizerAnalytics,
  createExportJob,
  getExportDownloadByToken,
  sanitizeCsvCell,
} from '../../packages/backend/src/services/feedback-analytics.js';

describe('Phase 7 Quality Gate: Feedback, Reviews, Organizer Insights & Exports (FR-FEED, FR-INSIGHT)', () => {
  let app: any;
  let collegeId: string;
  let organizerAId: string;
  let organizerBId: string;
  let orgAUserId: string;
  let orgBUserId: string;
  let checkedInStudentId: string;
  let notCheckedInStudentId: string;
  let eventAId: string;
  let eventBId: string;

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

  async function createTestStudent(displayName: string = 'Test Attendee'): Promise<string> {
    const client = await pool.connect();
    try {
      const email = `student.${Date.now()}.${Math.random().toString(36).substring(2, 7)}@campus.edu`;
      const res = await client.query(
        `INSERT INTO users (college_id, email, password_hash, display_name, global_role, status, email_verified_at)
         VALUES ($1, $2, 'hash', $3, 'student', 'active', NOW())
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

      // 2. Create users with known seed password
      const { hashPassword } = await import('../../packages/backend/src/services/auth.js');
      const passHash = await hashPassword(seedPassword);

      const uRes = await client.query(
        `INSERT INTO users (college_id, email, password_hash, display_name, global_role, status, email_verified_at)
         VALUES
           ($1, $2, $6, 'Organizer A Lead', 'student', 'active', NOW()),
           ($1, $3, $6, 'Organizer B Lead', 'student', 'active', NOW()),
           ($1, $4, $6, 'Aarav Sharma', 'student', 'active', NOW()),
           ($1, $5, $6, 'Priya Patel', 'student', 'active', NOW())
         RETURNING id;`,
        [
          collegeId,
          `org.a.${Date.now()}@campus.edu`,
          `org.b.${Date.now()}@campus.edu`,
          `aarav.sharma.${Date.now()}@campus.edu`,
          `priya.patel.${Date.now()}@campus.edu`,
          passHash,
        ]
      );

      orgAUserId = uRes.rows[0].id;
      orgBUserId = uRes.rows[1].id;
      checkedInStudentId = uRes.rows[2].id;
      notCheckedInStudentId = uRes.rows[3].id;

      createdUserIds.push(orgAUserId, orgBUserId, checkedInStudentId, notCheckedInStudentId);

      // 3. Create Organizer Profiles & Memberships
      const orgARes = await client.query(
        `INSERT INTO organizer_profiles (college_id, display_name, status, created_by)
         VALUES ($1, 'Organizer Society A', 'verified', $2)
         RETURNING id;`,
        [collegeId, orgAUserId]
      );
      organizerAId = orgARes.rows[0].id;

      const orgBRes = await client.query(
        `INSERT INTO organizer_profiles (college_id, display_name, status, created_by)
         VALUES ($1, 'Organizer Society B', 'verified', $2)
         RETURNING id;`,
        [collegeId, orgBUserId]
      );
      organizerBId = orgBRes.rows[0].id;

      await client.query(
        `INSERT INTO organizer_members (organizer_id, user_id, role, status)
         VALUES
           ($1, $2, 'owner', 'active'),
           ($3, $4, 'owner', 'active');`,
        [organizerAId, orgAUserId, organizerBId, orgBUserId]
      );

      // 4. Create Event A (owned by Org A) & Event B (owned by Org B)
      // Slug starts with gate- to prevent interference with event-lifecycle tests
      const eResA = await client.query(
        `INSERT INTO events (
           organizer_id, college_id, title, slug, description, category, department, format,
           starts_at, ends_at, capacity, visibility, status, contact_email, created_by
         ) VALUES (
           $1, $2, 'AI Insights Masterclass', $3, 'Description', 'Tech', 'CS', 'in_person',
           NOW() - INTERVAL '1 day', NOW() - INTERVAL '2 hours', 100, 'public', 'published', 'contact@campus.edu', $4
         ) RETURNING id;`,
        [organizerAId, collegeId, `gate-feedback-event-a-${Date.now()}`, orgAUserId]
      );
      eventAId = eResA.rows[0].id;
      createdEventIds.push(eventAId);

      const eResB = await client.query(
        `INSERT INTO events (
           organizer_id, college_id, title, slug, description, category, department, format,
           starts_at, ends_at, capacity, visibility, status, contact_email, created_by
         ) VALUES (
           $1, $2, 'Autonomous Robotics Workshop', $3, 'Description', 'Tech', 'CS', 'in_person',
           NOW() - INTERVAL '1 day', NOW() - INTERVAL '2 hours', 100, 'public', 'published', 'contact@campus.edu', $4
         ) RETURNING id;`,
        [organizerBId, collegeId, `gate-feedback-event-b-${Date.now()}`, orgBUserId]
      );
      eventBId = eResB.rows[0].id;
      createdEventIds.push(eventBId);

      // 5. Create Ticket Types for Event A
      const ttA = await client.query(
        `INSERT INTO ticket_types (event_id, name, price_paise, capacity, sold, held)
         VALUES ($1, 'Standard Admission', 5000, 100, 10, 0)
         RETURNING id;`,
        [eventAId]
      );
      const ticketTypeAId = ttA.rows[0].id;

      // 6. Create booking & checked-in ticket for checkedInStudentId
      const bRes1 = await client.query(
        `INSERT INTO bookings (user_id, event_id, status, total_paise, idempotency_key)
         VALUES ($1, $2, 'CONFIRMED', 5000, $3)
         RETURNING id;`,
        [checkedInStudentId, eventAId, `idem-chk-${Date.now()}`]
      );
      const booking1Id = bRes1.rows[0].id;

      await client.query(
        `INSERT INTO tickets (
           booking_id, ticket_type_id, user_id, owner_user_id, event_id, ticket_code, qr_payload_hash, status, checked_in_at
         ) VALUES ($1, $2, $3, $3, $4, $5, $6, 'CHECKED_IN', NOW() - INTERVAL '3 hours');`,
        [booking1Id, ticketTypeAId, checkedInStudentId, eventAId, `TCK-CHK-${Date.now()}`, Buffer.from('dummy_qr_hash_1')]
      );

      // 7. Create booking with VALID (not checked in) ticket for notCheckedInStudentId
      const bRes2 = await client.query(
        `INSERT INTO bookings (user_id, event_id, status, total_paise, idempotency_key)
         VALUES ($1, $2, 'CONFIRMED', 5000, $3)
         RETURNING id;`,
        [notCheckedInStudentId, eventAId, `idem-notchk-${Date.now()}`]
      );
      const booking2Id = bRes2.rows[0].id;

      await client.query(
        `INSERT INTO tickets (
           booking_id, ticket_type_id, user_id, owner_user_id, event_id, ticket_code, qr_payload_hash, status
         ) VALUES ($1, $2, $3, $3, $4, $5, $6, 'VALID');`,
        [booking2Id, ticketTypeAId, notCheckedInStudentId, eventAId, `TCK-NOTCHK-${Date.now()}`, Buffer.from('dummy_qr_hash_2')]
      );
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    const client = await pool.connect();
    try {
      if (createdEventIds.length > 0) {
        await client.query(`DELETE FROM feedback_reports WHERE feedback_id IN (SELECT id FROM event_feedback WHERE event_id = ANY($1));`, [createdEventIds]);
        await client.query(`DELETE FROM feedback_invitations WHERE event_id = ANY($1);`, [createdEventIds]);
        await client.query(`DELETE FROM event_feedback WHERE event_id = ANY($1);`, [createdEventIds]);
        await client.query(`DELETE FROM feedback_questions WHERE event_id = ANY($1);`, [createdEventIds]);
        await client.query(`DELETE FROM export_jobs WHERE event_id = ANY($1);`, [createdEventIds]);
        await client.query(`DELETE FROM event_metrics WHERE event_id = ANY($1);`, [createdEventIds]);
        await client.query(`DELETE FROM tickets WHERE event_id = ANY($1);`, [createdEventIds]);
        await client.query(`DELETE FROM booking_items WHERE booking_id IN (SELECT id FROM bookings WHERE event_id = ANY($1));`, [createdEventIds]);
        await client.query(`DELETE FROM bookings WHERE event_id = ANY($1);`, [createdEventIds]);
        await client.query(`DELETE FROM ticket_types WHERE event_id = ANY($1);`, [createdEventIds]);
        await client.query(`DELETE FROM events WHERE id = ANY($1);`, [createdEventIds]);
      }
      if (createdUserIds.length > 0) {
        await client.query(`DELETE FROM organizer_members WHERE user_id = ANY($1);`, [createdUserIds]);
        await client.query(`DELETE FROM organizer_profiles WHERE id IN ($1, $2);`, [organizerAId, organizerBId]);
        await client.query(`DELETE FROM sessions WHERE user_id = ANY($1);`, [createdUserIds]);
        await client.query(`DELETE FROM users WHERE id = ANY($1);`, [createdUserIds]);
      }
    } finally {
      client.release();
    }
    await app.close();
  });

  // Gate Test 1: Non-attendee 403 (Only checked-in attendees are eligible)
  it('(1) non-attendee receives 403 Forbidden with INELIGIBLE_NOT_ATTENDED error', async () => {
    // notCheckedInStudentId has registered but has NOT checked in
    await expect(
      submitFeedback({
        eventId: eventAId,
        userId: notCheckedInStudentId,
        rating: 5,
        comment: 'Great event!',
      })
    ).rejects.toThrow(/Only checked-in attendees are eligible/);
  });

  // Gate Test 2: Checked-in attendee can submit feedback successfully
  it('(2) checked-in attendee successfully submits feedback (rating 1..5)', async () => {
    const feedback = await submitFeedback({
      eventId: eventAId,
      userId: checkedInStudentId,
      rating: 5,
      comment: 'Exceptional keynote speaker and great hands-on session.',
      answers: { pace: 'Just right', venue: 'Clean and accessible' },
    });

    expect(feedback).toBeDefined();
    expect(feedback.rating).toBe(5);
    expect(feedback.comment).toContain('Exceptional keynote');
    expect(feedback.moderation_status).toBe('visible');
    expect(feedback.edited_at).toBeNull();
  });

  // Gate Test 3: Edit within 48h edit window updates existing record (edited_at set)
  it('(3) second submission within 48h edit window updates review and sets edited_at timestamp', async () => {
    const updated = await submitFeedback({
      eventId: eventAId,
      userId: checkedInStudentId,
      rating: 4,
      comment: 'Updated: overall 4/5 because sound was slightly low in back row.',
    });

    expect(updated).toBeDefined();
    expect(updated.rating).toBe(4);
    expect(updated.comment).toContain('Updated: overall 4/5');
    expect(updated.edited_at).not.toBeNull();

    // Verify only ONE record exists in database
    const client = await pool.connect();
    try {
      const fbRes = await client.query(
        `SELECT COUNT(*)::int as count FROM event_feedback WHERE event_id = $1 AND user_id = $2;`,
        [eventAId, checkedInStudentId]
      );
      expect(fbRes.rows[0].count).toBe(1);
    } finally {
      client.release();
    }
  });

  // Gate Test 4: Edit after 48h window is rejected with 409 FEEDBACK_LOCKED
  it('(4) editing feedback after 48-hour window returns 409 Conflict (FEEDBACK_LOCKED)', async () => {
    // Manually artificially age the submitted_at timestamp by 49 hours
    const client = await pool.connect();
    try {
      await client.query(
        `UPDATE event_feedback
         SET submitted_at = NOW() - INTERVAL '49 hours'
         WHERE event_id = $1 AND user_id = $2;`,
        [eventAId, checkedInStudentId]
      );
    } finally {
      client.release();
    }

    await expect(
      submitFeedback({
        eventId: eventAId,
        userId: checkedInStudentId,
        rating: 3,
        comment: 'Attempting to edit after window expired',
      })
    ).rejects.toThrow(/Feedback editing window has expired/);
  });

  // Gate Test 5: Low-data rule: n < 5 hides numeric average; n >= 5 displays average with response rate
  it('(5) low-data rule: hides numeric average when n < 5; displays average and response rate when n >= 5', async () => {
    // Currently only 1 feedback submitted (n = 1 < 5)
    const initialRatings = await getPublicEventRatings(eventAId);
    expect(initialRatings.feedbackCount).toBe(1);
    expect(initialRatings.hasEnoughResponses).toBe(false);
    expect(initialRatings.ratingAvg).toBeNull();
    expect(initialRatings.displayRating).toBe('Not enough responses yet');

    // Add 4 more checked-in students with feedback to reach n = 5
    // Ratings: 5, 4, 4, 3 + existing 4 -> Sum = 20 / 5 = 4.00
    const ratingsToAdd = [5, 4, 4, 3];
    const client = await pool.connect();
    try {
      const ttRes = await client.query(
        'SELECT id FROM ticket_types WHERE event_id = $1 LIMIT 1;',
        [eventAId]
      );
      const ticketTypeId = ttRes.rows[0].id;

      for (const r of ratingsToAdd) {
        const studentId = await createTestStudent(`Student ${r}`);
        const bRes = await client.query(
          `INSERT INTO bookings (user_id, event_id, status, total_paise, idempotency_key)
           VALUES ($1, $2, 'CONFIRMED', 5000, $3)
           RETURNING id;`,
          [studentId, eventAId, `idem-seed-${Date.now()}-${Math.random()}`]
        );
        const bId = bRes.rows[0].id;

        await client.query(
          `INSERT INTO tickets (
             booking_id, ticket_type_id, user_id, owner_user_id, event_id, ticket_code, qr_payload_hash, status, checked_in_at
           ) VALUES ($1, $2, $3, $3, $4, $5, $6, 'CHECKED_IN', NOW());`,
          [bId, ticketTypeId, studentId, eventAId, `TCK-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, Buffer.from(`qr_${Math.random()}`)]
        );

        await submitFeedback({
          eventId: eventAId,
          userId: studentId,
          rating: r,
          comment: `Constructive comment rating ${r}`,
        });
      }
    } finally {
      client.release();
    }

    // Now n = 5 -> numeric average must be revealed!
    const matureRatings = await getPublicEventRatings(eventAId);
    expect(matureRatings.feedbackCount).toBe(5);
    expect(matureRatings.hasEnoughResponses).toBe(true);
    expect(matureRatings.ratingAvg).toBe(4);
    expect(matureRatings.displayRating).toBe('4.0 ★');
    expect(matureRatings.formattedSummary).toContain('4.0 ★ (5 of 5 attended · 100% responded)');
  });

  // Gate Test 6: Aggregates equal hand-computed fixtures in event_metrics
  it('(6) event_metrics aggregates equal exact hand-computed values', async () => {
    const metrics = await refreshEventMetrics(eventAId);

    // Hand-computed expectations:
    // Confirmed bookings: 1 (checkedIn) + 1 (notCheckedIn) + 4 (additional seeded) = 6
    // Checkins: 1 + 4 = 5
    // No-shows: 1 (notCheckedIn)
    // Feedback count: 5
    // Rating avg: 4.00
    expect(metrics.confirmed).toBe(6);
    expect(metrics.checkins).toBe(5);
    expect(metrics.no_shows).toBe(1);
    expect(metrics.feedback_count).toBe(5);
    expect(Number(metrics.rating_avg)).toBe(4);
  });

  // Gate Test 7: Organizer B receives 403 Forbidden attempting to access Organizer A feedback or analytics
  it('(7) organizer B receives 403 Forbidden accessing organizer A feedback or analytics (analytics:view:owned)', async () => {
    const client = await pool.connect();
    let orgBEmail: string;
    try {
      const u = await client.query(`SELECT email FROM users WHERE id = $1;`, [orgBUserId]);
      orgBEmail = u.rows[0].email;
    } finally {
      client.release();
    }

    const { sessionCookie, csrfCookie } = await loginUser(orgBEmail);

    // 1. Attempt to view Organizer A analytics
    const analyticsRes = await app.inject({
      method: 'GET',
      url: `/api/v1/organizer/events/${eventAId}/analytics`,
      headers: {
        cookie: `eventora_session=${sessionCookie}; eventora_csrf=${csrfCookie}`,
        'x-csrf-token': csrfCookie,
      },
    });

    expect(analyticsRes.statusCode).toBe(403);
    const analyticsBody = JSON.parse(analyticsRes.body);
    expect(analyticsBody.error.code).toBe('FORBIDDEN');

    // 2. Attempt to view Organizer A feedback comments
    const feedbackRes = await app.inject({
      method: 'GET',
      url: `/api/v1/organizer/events/${eventAId}/feedback`,
      headers: {
        cookie: `eventora_session=${sessionCookie}; eventora_csrf=${csrfCookie}`,
        'x-csrf-token': csrfCookie,
      },
    });

    expect(feedbackRes.statusCode).toBe(403);
    const feedbackBody = JSON.parse(feedbackRes.body);
    expect(feedbackBody.error.code).toBe('FORBIDDEN');
  });

  // Gate Test 8: CSV Injection Neutralization (CWE-1236)
  it('(8) neutralizes CSV formula injection characters (=, +, -, @) with leading apostrophe', () => {
    const maliciousFormulas = [
      "=cmd|'/C calc'!A0",
      '+1234567890',
      '-2+3+cmd|',
      '@SUM(A1:A10)',
      '\t=calc',
    ];

    for (const formula of maliciousFormulas) {
      const sanitized = sanitizeCsvCell(formula);
      // Must be prefixed with a single quote to prevent spreadsheet execution
      expect(sanitized.startsWith("'")).toBe(true);
    }

    // Normal safe strings should remain un-prefixed
    expect(sanitizeCsvCell('Robotics Workshop')).toBe('Robotics Workshop');
    expect(sanitizeCsvCell(42)).toBe('42');
  });

  // Gate Test 9: Data export excludes email/phone for roles lacking export:pii
  it('(9) attendee export excludes raw emails for standard organizer role, includes only initials', async () => {
    // 1. Standard Organizer A export (lacks export:pii)
    const exportResult = await createExportJob({
      eventId: eventAId,
      requesterId: orgAUserId,
      format: 'csv',
      kind: 'attendees',
      hasPiiExportRole: false,
    });

    expect(exportResult.status).toBe('COMPLETED');
    expect(exportResult.downloadUrl).toBeDefined();

    // Verify CSV content via download token
    const token = exportResult.downloadUrl.split('/').pop()!;
    const download = getExportDownloadByToken(token);
    expect(download).not.toBeNull();
    const csvContent = download!.content;

    // Header must NOT contain "College Email"
    expect(csvContent).not.toContain('College Email');
    expect(csvContent).toContain('Attendee Initials');

    // Content must NOT leak student emails
    expect(csvContent).not.toContain('@campus.edu');

    // 2. Admin export (has elevated export:pii)
    const adminExport = await createExportJob({
      eventId: eventAId,
      requesterId: orgAUserId,
      format: 'csv',
      kind: 'attendees',
      hasPiiExportRole: true,
    });

    const adminToken = adminExport.downloadUrl.split('/').pop()!;
    const adminDownload = getExportDownloadByToken(adminToken);
    expect(adminDownload!.content).toContain('College Email');
  });
});
