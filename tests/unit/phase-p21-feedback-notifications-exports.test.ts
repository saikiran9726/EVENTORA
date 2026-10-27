import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../packages/backend/src/app.js';
import { pool } from '../../packages/backend/src/db/index.js';
import crypto from 'crypto';
import ExcelJS from 'exceljs';
import {
  createExportJob,
  getExportDownloadByToken,
  sanitizeCellValue,
  sanitizeCsvCell,
} from '../../packages/backend/src/services/feedback-analytics.js';
import {
  createEventAlert,
} from '../../packages/backend/src/services/notifications-alerts.js';
import { runRollbackToVersion } from '../../packages/backend/src/db/migrate-down.js';
import { runMigrations } from '../../packages/backend/src/db/migrate.js';

describe('Phase P21: Feedback, Notifications & Exports Quality Gate', () => {
  let app: any;
  let collegeId: string;
  let organizerId: string;
  let orgUserId: string;
  let orgHeaders: Record<string, string>;
  let attendeeAId: string;
  let attendeeAHeaders: Record<string, string>;
  let attendeeBHeaders: Record<string, string>;
  let publishedEventId: string;
  let draftEventId: string;
  let ticketTypePubId: string;
  let ticketTypeDraftId: string;

  const createdUserIds: string[] = [];
  const createdEventIds: string[] = [];

  async function createTestUser(
    displayName: string,
    role = 'student'
  ): Promise<{ id: string; token: string; headers: Record<string, string> }> {
    const client = await pool.connect();
    try {
      const email = `p21-${Date.now()}-${Math.random().toString(36).substring(2, 7)}@campus.edu`;
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
      const cRes = await client.query('SELECT id FROM colleges LIMIT 1;');
      if (cRes.rows.length > 0) {
        collegeId = cRes.rows[0].id;
      } else {
        const nc = await client.query(
          `INSERT INTO colleges (name, domain, status, participation_status)
           VALUES ('P21 Tech Institute', $1, 'active', 'participating')
           RETURNING id;`,
          [`p21-${Date.now()}.edu`]
        );
        collegeId = nc.rows[0].id;
      }

      const orgUser = await createTestUser('P21 Lead Organizer', 'student');
      orgUserId = orgUser.id;
      orgHeaders = orgUser.headers;

      const attA = await createTestUser('Attendee Alice', 'student');
      attendeeAId = attA.id;
      attendeeAHeaders = attA.headers;

      const attB = await createTestUser('Attendee Bob', 'student');
      attendeeBHeaders = attB.headers;

      // Organizer Profile
      const opRes = await client.query(
        `INSERT INTO organizer_profiles (college_id, display_name, status, created_by)
         VALUES ($1, 'P21 Student Activities Board', 'verified', $2)
         RETURNING id;`,
        [collegeId, orgUserId]
      );
      organizerId = opRes.rows[0].id;

      await client.query(
        `INSERT INTO organizer_members (organizer_id, user_id, role, status)
         VALUES ($1, $2, 'owner', 'active')
         ON CONFLICT (organizer_id, user_id) DO NOTHING;`,
        [organizerId, orgUserId]
      );

      // Published Event
      const epRes = await client.query(
        `INSERT INTO events (
           organizer_id, college_id, title, slug, description, category, format,
           starts_at, ends_at, capacity, visibility, status, contact_email, created_by
         ) VALUES (
           $1, $2, 'P21 Annual Tech Symposium', $3, 'Description', 'Tech', 'in_person',
           NOW() - INTERVAL '1 day', NOW() - INTERVAL '2 hours', 100, 'public', 'published', 'org@campus.edu', $4
         ) RETURNING id;`,
        [organizerId, collegeId, `p21-pub-${Date.now()}`, orgUserId]
      );
      publishedEventId = epRes.rows[0].id;
      createdEventIds.push(publishedEventId);

      // Draft Event
      const edRes = await client.query(
        `INSERT INTO events (
           organizer_id, college_id, title, slug, description, category, format,
           starts_at, ends_at, capacity, visibility, status, contact_email, created_by
         ) VALUES (
           $1, $2, 'P21 Closed Planning Workshop', $3, 'Description', 'Planning', 'in_person',
           NOW() + INTERVAL '5 days', NOW() + INTERVAL '6 days', 50, 'college', 'draft', 'org@campus.edu', $4
         ) RETURNING id;`,
        [organizerId, collegeId, `p21-draft-${Date.now()}`, orgUserId]
      );
      draftEventId = edRes.rows[0].id;
      createdEventIds.push(draftEventId);

      // Ticket tiers
      const ttPubRes = await client.query(
        `INSERT INTO ticket_types (event_id, name, price_paise, capacity, sold, held)
         VALUES ($1, 'General Pass', 0, 100, 1, 0)
         RETURNING id;`,
        [publishedEventId]
      );
      ticketTypePubId = ttPubRes.rows[0].id;

      const ttDraftRes = await client.query(
        `INSERT INTO ticket_types (event_id, name, price_paise, capacity, sold, held)
         VALUES ($1, 'Delegate Seat', 0, 50, 1, 0)
         RETURNING id;`,
        [draftEventId]
      );
      ticketTypeDraftId = ttDraftRes.rows[0].id;

      // Seed Attendee A with multiple tickets for Published Event (both checked in) to test DISTINCT ON
      const bRes1 = await client.query(
        `INSERT INTO bookings (user_id, event_id, status, total_paise, idempotency_key)
         VALUES ($1, $2, 'CONFIRMED', 0, $3)
         RETURNING id;`,
        [attendeeAId, publishedEventId, `idem-p21-1-${Date.now()}`]
      );
      const booking1Id = bRes1.rows[0].id;

      await client.query(
        `INSERT INTO tickets (booking_id, ticket_type_id, user_id, owner_user_id, event_id, ticket_code, qr_payload_hash, status, checked_in_at)
         VALUES
           ($1, $2, $3, $3, $4, $5, $7, 'CHECKED_IN', NOW() - INTERVAL '3 hours'),
           ($1, $2, $3, $3, $4, $6, $8, 'CHECKED_IN', NOW() - INTERVAL '2 hours');`,
        [
          booking1Id,
          ticketTypePubId,
          attendeeAId,
          publishedEventId,
          `TCK-A1-${Date.now()}`,
          `TCK-A2-${Date.now()}`,
          crypto.randomBytes(32),
          crypto.randomBytes(32),
        ]
      );

      // Seed Attendee A with ticket for Draft Event (to test ticket holder access on draft)
      const bRes2 = await client.query(
        `INSERT INTO bookings (user_id, event_id, status, total_paise, idempotency_key)
         VALUES ($1, $2, 'CONFIRMED', 0, $3)
         RETURNING id;`,
        [attendeeAId, draftEventId, `idem-p21-2-${Date.now()}`]
      );
      await client.query(
        `INSERT INTO tickets (booking_id, ticket_type_id, user_id, owner_user_id, event_id, ticket_code, qr_payload_hash, status)
         VALUES ($1, $2, $3, $3, $4, $5, $6, 'VALID');`,
        [bRes2.rows[0].id, ticketTypeDraftId, attendeeAId, draftEventId, `TCK-A3-${Date.now()}`, crypto.randomBytes(32)]
      );
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    if (app) await app.close();
    const client = await pool.connect();
    try {
      if (createdEventIds.length > 0) {
        await client.query('DELETE FROM events WHERE id = ANY($1);', [createdEventIds]);
      }
      if (organizerId) {
        await client.query('DELETE FROM organizer_members WHERE organizer_id = $1;', [organizerId]);
        await client.query('DELETE FROM organizer_profiles WHERE id = $1;', [organizerId]);
      }
      if (createdUserIds.length > 0) {
        await client.query('DELETE FROM users WHERE id = ANY($1);', [createdUserIds]);
      }
    } finally {
      client.release();
    }
  });

  // 1. DISTINCT ON (event_id) in feedback invitations
  it('(1) GET /api/v1/me/feedback-invitations deduplicates multiple tickets with DISTINCT ON (event_id)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/me/feedback-invitations',
      headers: attendeeAHeaders,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.invitations).toBeDefined();

    // Attendee A has 2 checked-in tickets for publishedEventId, but exactly 1 invitation must be returned
    const pubInvitations = body.invitations.filter((inv: any) => inv.event_id === publishedEventId);
    expect(pubInvitations.length).toBe(1);
    expect(pubInvitations[0].event_title).toBe('P21 Annual Tech Symposium');
    expect(pubInvitations[0].status).toBe('PENDING');
  });

  // 2. Feedback only from checked-in attendees
  it('(2) enforces that only checked-in attendees can submit feedback (403 INELIGIBLE_NOT_ATTENDED)', async () => {
    // Attendee B has not checked in to publishedEventId
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${publishedEventId}/feedback`,
      headers: attendeeBHeaders,
      payload: { rating: 5, comment: 'Great event!' },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('INELIGIBLE_NOT_ATTENDED');
    expect(body.error.message).toContain('Only checked-in attendees');

    // Attendee A is checked in -> submission succeeds
    const successRes = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${publishedEventId}/feedback`,
      headers: attendeeAHeaders,
      payload: { rating: 5, comment: 'Incredible keynote sessions!' },
    });

    expect(successRes.statusCode).toBe(200);
    const successBody = JSON.parse(successRes.body);
    expect(successBody.feedback.rating).toBe(5);
    expect(successBody.feedback.comment).toBe('Incredible keynote sessions!');
  });

  // 3. Feedback edit window (48 hours)
  it('(3) allows edits within 48h and rejects edits after 48h with 409 FEEDBACK_LOCKED', async () => {
    // 3.1 Edit within 48h succeeds and updates edited_at
    const editRes = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${publishedEventId}/feedback`,
      headers: attendeeAHeaders,
      payload: { rating: 4, comment: 'Updated review: great talks, lunch line was long.' },
    });

    expect(editRes.statusCode).toBe(200);
    const editBody = JSON.parse(editRes.body);
    expect(editBody.feedback.rating).toBe(4);
    expect(editBody.feedback.edited_at).toBeDefined();

    // 3.2 Artificially backdate submitted_at to 49 hours ago
    const client = await pool.connect();
    try {
      await client.query(
        `UPDATE event_feedback
         SET submitted_at = NOW() - INTERVAL '49 hours'
         WHERE event_id = $1 AND user_id = $2;`,
        [publishedEventId, attendeeAId]
      );
    } finally {
      client.release();
    }

    // 3.3 Attempting to edit after window expires fails with 409
    const expiredRes = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${publishedEventId}/feedback`,
      headers: attendeeAHeaders,
      payload: { rating: 1, comment: 'Too late to change!' },
    });

    expect(expiredRes.statusCode).toBe(409);
    const expiredBody = JSON.parse(expiredRes.body);
    expect(expiredBody.error.code).toBe('FEEDBACK_LOCKED');
    expect(expiredBody.error.message).toContain('48 hours');
  });

  // 4. Alerts authorization on published vs unpublished events
  it('(4) GET /events/:id/alerts only allows public access on published events; requires ticket holder or organizer on draft', async () => {
    // 4.1 Create an alert on published event
    await createEventAlert({
      eventId: publishedEventId,
      createdBy: orgUserId,
      kind: 'venue',
      message: 'Published Event Notice: Hall A updated',
      severity: 'info',
    });

    // Public / unauthenticated call on published event succeeds
    const pubRes = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${publishedEventId}/alerts`,
    });
    expect(pubRes.statusCode).toBe(200);
    const pubBody = JSON.parse(pubRes.body);
    expect(pubBody.alerts.length).toBeGreaterThan(0);

    // 4.2 Create an alert on draft event
    await createEventAlert({
      eventId: draftEventId,
      createdBy: orgUserId,
      kind: 'time',
      message: 'Draft Event Internal Notice',
      severity: 'urgent',
    });

    // Unauthenticated call on draft event returns 401
    const unauthDraftRes = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${draftEventId}/alerts`,
    });
    expect(unauthDraftRes.statusCode).toBe(401);
    expect(JSON.parse(unauthDraftRes.body).error.code).toBe('UNAUTHORIZED');

    // Unrelated user (Attendee B, no ticket for draft) returns 403
    const unrelatedDraftRes = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${draftEventId}/alerts`,
      headers: attendeeBHeaders,
    });
    expect(unrelatedDraftRes.statusCode).toBe(403);
    expect(JSON.parse(unrelatedDraftRes.body).error.code).toBe('FORBIDDEN');

    // Ticket holder (Attendee A) can view draft alerts
    const holderDraftRes = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${draftEventId}/alerts`,
      headers: attendeeAHeaders,
    });
    expect(holderDraftRes.statusCode).toBe(200);
    expect(JSON.parse(holderDraftRes.body).alerts.length).toBeGreaterThan(0);

    // Organizer can view draft alerts
    const orgDraftRes = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${draftEventId}/alerts`,
      headers: orgHeaders,
    });
    expect(orgDraftRes.statusCode).toBe(200);
  });

  // 5. Bound all limit params via Zod (1-100, NaN-safe)
  it('(5) bounds all limit parameters via Zod (1-100, NaN-safe) and rejects invalid values with 400', async () => {
    // 5.1 NaN limit on /events/:id/alerts
    const nanAlertRes = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${publishedEventId}/alerts?limit=notanumber`,
    });
    expect(nanAlertRes.statusCode).toBe(400);
    expect(JSON.parse(nanAlertRes.body).error.code).toBe('VALIDATION_ERROR');

    // 5.2 limit=0 on /events/:id/alerts
    const zeroAlertRes = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${publishedEventId}/alerts?limit=0`,
    });
    expect(zeroAlertRes.statusCode).toBe(400);

    // 5.3 limit=101 on /events/:id/alerts
    const overAlertRes = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${publishedEventId}/alerts?limit=101`,
    });
    expect(overAlertRes.statusCode).toBe(400);

    // 5.4 Valid bounded limit=5 succeeds
    const validAlertRes = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${publishedEventId}/alerts?limit=5`,
    });
    expect(validAlertRes.statusCode).toBe(200);

    // 5.5 Notifications limit bounds
    const invalidNotifRes = await app.inject({
      method: 'GET',
      url: `/api/v1/me/notifications?limit=abc`,
      headers: attendeeAHeaders,
    });
    expect(invalidNotifRes.statusCode).toBe(400);
    expect(JSON.parse(invalidNotifRes.body).error.code).toBe('VALIDATION_ERROR');

    // 5.6 Feedback limit bounds
    const invalidFeedbackRes = await app.inject({
      method: 'GET',
      url: `/api/v1/organizer/events/${publishedEventId}/feedback?limit=999`,
      headers: orgHeaders,
    });
    expect(invalidFeedbackRes.statusCode).toBe(400);
    expect(JSON.parse(invalidFeedbackRes.body).error.code).toBe('VALIDATION_ERROR');
  });

  // 6. Per-event alert rate limiting
  it('(6) throttles per-event alert creation with 429 RATE_LIMIT_EXCEEDED when exceeding 5 alerts in 10 minutes', async () => {
    // We already created 1 alert on publishedEventId above. Create 4 more -> total 5
    for (let i = 0; i < 4; i++) {
      await createEventAlert({
        eventId: publishedEventId,
        createdBy: orgUserId,
        kind: 'speaker',
        message: `Rapid alert sequence #${i + 2}`,
        severity: 'info',
      });
    }

    // Attempting 6th alert must fail with 429 RATE_LIMIT_EXCEEDED
    await expect(
      createEventAlert({
        eventId: publishedEventId,
        createdBy: orgUserId,
        kind: 'safety',
        message: 'Spam alert attempt beyond limit',
        severity: 'urgent',
      })
    ).rejects.toThrow('Alert creation rate limit exceeded');
  });

  // 7. Alert route uses global error handler
  it('(7) alert route uses global error handler and returns standard error envelope without leaking internal details', async () => {
    const nonExistentEventId = crypto.randomUUID();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${nonExistentEventId}/alerts`,
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe('EVENT_NOT_FOUND');
    expect(body.error.requestId).toBeDefined();
    expect(body.error.message).toBe('Event not found');
  });

  // 8. Formula injection neutralization (=, +, -, @, \t, \r)
  it('(8) neutralizes CSV and Excel formula injection characters (=, +, -, @, \\t, \\r) with leading single quote', () => {
    const malicious = [
      "=cmd|'/C calc'!A0",
      '+1234567890',
      '-2+3+cmd|',
      '@SUM(A1:A10)',
      '\t=calc',
      '\r=2+2',
    ];

    for (const payload of malicious) {
      // CSV cell neutralization
      const csvSanitized = sanitizeCsvCell(payload);
      expect(csvSanitized.startsWith("'") || csvSanitized.startsWith("\"'")).toBe(true);

      // Cell value neutralization for ExcelJS
      const cellSanitized = sanitizeCellValue(payload);
      expect(String(cellSanitized).startsWith("'")).toBe(true);
    }

    // Normal safe values are not modified
    expect(sanitizeCsvCell('Normal Text')).toBe('Normal Text');
    expect(sanitizeCellValue('Regular Title')).toBe('Regular Title');
    expect(sanitizeCellValue(100)).toBe(100);
    expect(sanitizeCellValue(true)).toBe(true);
  });

  // 9. UTF-8 BOM on CSV exports
  it('(9) generates CSV exports with standard UTF-8 BOM (\\uFEFF) for spreadsheet compatibility', async () => {
    const job = await createExportJob({
      eventId: publishedEventId,
      requesterId: orgUserId,
      format: 'csv',
      kind: 'attendees',
      hasPiiExportRole: true,
    });

    const token = job.downloadUrl.split('/').pop()!;
    const download = await getExportDownloadByToken(token, { id: orgUserId, globalRole: 'student' });
    expect(download.mimeType).toBe('text/csv; charset=utf-8');

    // First bytes must be UTF-8 BOM (0xEF, 0xBB, 0xBF)
    expect(download.fileData[0]).toBe(0xef);
    expect(download.fileData[1]).toBe(0xbb);
    expect(download.fileData[2]).toBe(0xbf);
  });

  // 10. Real .xlsx export generation with ExcelJS and proper MIME type
  it('(10) generates real .xlsx spreadsheet with ExcelJS and verified OpenXML MIME type', async () => {
    const job = await createExportJob({
      eventId: publishedEventId,
      requesterId: orgUserId,
      format: 'xlsx',
      kind: 'attendees',
      hasPiiExportRole: true,
    });

    expect(job.mimeType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const token = job.downloadUrl.split('/').pop()!;
    const download = await getExportDownloadByToken(token, { id: orgUserId, globalRole: 'student' });

    expect(download.mimeType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(download.fileData.length).toBeGreaterThan(1000);

    // Verify valid OpenXML zip header (PK\x03\x04)
    expect(download.fileData[0]).toBe(0x50); // P
    expect(download.fileData[1]).toBe(0x4b); // K
    expect(download.fileData[2]).toBe(0x03);
    expect(download.fileData[3]).toBe(0x04);

    // Read back workbook with ExcelJS to prove complete file integrity
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(download.fileData);
    expect(workbook.worksheets.length).toBe(1);
    const sheet = workbook.worksheets[0];
    expect(sheet.name).toBe('Attendees');
    expect(sheet.rowCount).toBeGreaterThan(0);
  });

  // 11. Durable export store, authenticated owner download & audit entries
  it('(11) persists export in export_jobs table and enforces authenticated owner download with audit log', async () => {
    const job = await createExportJob({
      eventId: publishedEventId,
      requesterId: orgUserId,
      format: 'csv',
      kind: 'feedback',
    });

    const token = job.downloadUrl.split('/').pop()!;

    // 11.1 Unauthenticated download fails with 401
    const unauthRes = await app.inject({
      method: 'GET',
      url: `/api/v1/exports/download/${token}`,
    });
    expect(unauthRes.statusCode).toBe(401);

    // 11.2 Authenticated non-owner download fails with 403
    const nonOwnerRes = await app.inject({
      method: 'GET',
      url: `/api/v1/exports/download/${token}`,
      headers: attendeeBHeaders,
    });
    expect(nonOwnerRes.statusCode).toBe(403);
    expect(JSON.parse(nonOwnerRes.body).error.code).toBe('FORBIDDEN');

    // 11.3 Authenticated owner download succeeds
    const ownerRes = await app.inject({
      method: 'GET',
      url: `/api/v1/exports/download/${token}`,
      headers: orgHeaders,
    });
    expect(ownerRes.statusCode).toBe(200);
    expect(ownerRes.headers['content-type']).toBe('text/csv; charset=utf-8');

    // 11.4 Verify audit logs exist for export:generate and export:download
    const client = await pool.connect();
    try {
      const auditRes = await client.query(
        `SELECT action FROM audit_logs WHERE actor_id = $1 AND action IN ('export:generate', 'export:download');`,
        [orgUserId]
      );
      const actions = auditRes.rows.map((r) => r.action);
      expect(actions).toContain('export:generate');
      expect(actions).toContain('export:download');
    } finally {
      client.release();
    }
  });

  // 12. Export 15-minute expiry and NEVER echo token in errors
  it('(12) enforces 15-minute export expiry and NEVER echoes download token in error messages or details', async () => {
    const job = await createExportJob({
      eventId: publishedEventId,
      requesterId: orgUserId,
      format: 'csv',
      kind: 'analytics',
    });

    const token = job.downloadUrl.split('/').pop()!;

    // Artificially expire the export
    const client = await pool.connect();
    try {
      await client.query(
        `UPDATE export_jobs SET expires_at = NOW() - INTERVAL '1 minute' WHERE download_token = $1;`,
        [token]
      );
    } finally {
      client.release();
    }

    // Clear in-memory token to force database expiration check
    const expiredRes = await app.inject({
      method: 'GET',
      url: `/api/v1/exports/download/${token}`,
      headers: orgHeaders,
    });

    expect(expiredRes.statusCode).toBe(404);
    const expiredBody = JSON.parse(expiredRes.body);
    expect(expiredBody.error.code).toBe('EXPORT_EXPIRED');

    // Security Non-negotiable: NEVER echo token in errors!
    expect(expiredBody.error.message).not.toContain(token);
    expect(JSON.stringify(expiredBody.error.details)).not.toContain(token);

    // Random non-existent token must also not be echoed
    const bogusToken = 'bogus-download-token-12345';
    const notFoundRes = await app.inject({
      method: 'GET',
      url: `/api/v1/exports/download/${bogusToken}`,
      headers: orgHeaders,
    });

    expect(notFoundRes.statusCode).toBe(404);
    const notFoundBody = JSON.parse(notFoundRes.body);
    expect(notFoundBody.error.code).toBe('EXPORT_NOT_FOUND');
    expect(notFoundBody.error.message).not.toContain(bogusToken);
    expect(JSON.stringify(notFoundBody.error.details)).not.toContain(bogusToken);
  });

  // 13. Database Migration 24 Rollback & Re-application
  it('(13) verifies migration 24 durable export columns and down-migration idempotently', async () => {
    // Rollback to version 23
    await runRollbackToVersion(23);

    const client = await pool.connect();
    try {
      // Verify download_token and file_data columns are removed
      const colCheck = await client.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'export_jobs' AND column_name IN ('file_data', 'download_token');
      `);
      expect(colCheck.rows.length).toBe(0);

      // Verify schema_migrations record 24 is deleted
      const verCheck = await client.query(`
        SELECT version FROM schema_migrations WHERE version = 24;
      `);
      expect(verCheck.rows.length).toBe(0);
    } finally {
      client.release();
    }

    // Re-apply migration 24
    await runMigrations();

    const clientAfter = await pool.connect();
    try {
      const colCheckAfter = await clientAfter.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'export_jobs' AND column_name IN ('file_data', 'download_token');
      `);
      expect(colCheckAfter.rows.length).toBe(2);

      const verCheckAfter = await clientAfter.query(`
        SELECT version FROM schema_migrations WHERE version = 24;
      `);
      expect(verCheckAfter.rows.length).toBe(1);
    } finally {
      clientAfter.release();
    }
  });
});
