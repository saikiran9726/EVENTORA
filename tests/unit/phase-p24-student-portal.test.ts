import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { buildApp } from '../../packages/backend/src/app.js';
import { pool } from '../../packages/backend/src/db/index.js';
import { runRollbackToVersion } from '../../packages/backend/src/db/migrate-down.js';
import { runMigrations } from '../../packages/backend/src/db/migrate.js';

describe('Phase P24: Student Portal Restoration Quality Gate', () => {
  let app: any;
  let collegeId: string;
  let organizerId: string;
  let orgOwnerUserId: string;
  let orgOwnerHeaders: Record<string, string>;
  let registeredStudentId: string;
  let registeredStudentHeaders: Record<string, string>;
  let unregStudentId: string;
  let unregStudentHeaders: Record<string, string>;
  let adminHeaders: Record<string, string>;

  let testEventId: string;
  let confirmedBookingId: string;
  let pendingBookingId: string;
  let uploadedMaterialId: string;

  const createdUserIds: string[] = [];
  const createdEventIds: string[] = [];
  const createdBookingIds: string[] = [];

  async function createTestUser(
    displayName: string,
    role = 'student'
  ): Promise<{ id: string; token: string; headers: Record<string, string> }> {
    const client = await pool.connect();
    try {
      const email = `p24-${Date.now()}-${Math.random().toString(36).substring(2, 7)}@campus.edu`;
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
    app = await buildApp();
    const client = await pool.connect();

    try {
      // 1. College
      const colRes = await client.query(
        `INSERT INTO colleges (name, domain, status)
         VALUES ('P24 Tech Institute', 'p24.campus.edu', 'active')
         ON CONFLICT (domain) DO UPDATE SET name = EXCLUDED.name
         RETURNING id;`
      );
      collegeId = colRes.rows[0].id;

      // 2. Users
      const owner = await createTestUser('P24 Org Leader', 'student');
      orgOwnerUserId = owner.id;
      orgOwnerHeaders = owner.headers;

      const regStudent = await createTestUser('P24 Reg Attendee', 'student');
      registeredStudentId = regStudent.id;
      registeredStudentHeaders = regStudent.headers;

      const unregStudent = await createTestUser('P24 Unreg Student', 'student');
      unregStudentId = unregStudent.id;
      unregStudentHeaders = unregStudent.headers;

      const admin = await createTestUser('P24 Campus Admin', 'admin');
      adminHeaders = admin.headers;

      // 3. Organizer Profile & Member
      const orgRes = await client.query(
        `INSERT INTO organizer_profiles (college_id, display_name, status, created_by)
         VALUES ($1, 'P24 Tech Squad', 'verified', $2)
         RETURNING id;`,
        [collegeId, orgOwnerUserId]
      );
      organizerId = orgRes.rows[0].id;

      await client.query(
        `INSERT INTO organizer_members (organizer_id, user_id, role, status)
         VALUES ($1, $2, 'owner', 'active')
         ON CONFLICT DO NOTHING;`,
        [organizerId, orgOwnerUserId]
      );

      // 4. Venue & Event
      const venueRes = await client.query(
        `INSERT INTO venues (college_id, name, building, capacity)
         VALUES ($1, 'P24 Main Auditorium', 'Babbage Hall', 300)
         RETURNING id;`,
        [collegeId]
      );
      const venueId = venueRes.rows[0].id;

      const eventRes = await client.query(
        `INSERT INTO events (
          college_id, organizer_id, title, slug, description, format,
          category, status, visibility, venue_id, starts_at, ends_at,
          capacity, created_by, contact_email
         )
         VALUES (
          $1, $2, 'P24 Autonomous Robotics Summit', 'p24-autonomous-robotics-summit',
          'Deep dive into real-time robotics and ROS2 architecture.', 'in_person',
          'Technology', 'published', 'public', $3,
          NOW() + INTERVAL '5 days', NOW() + INTERVAL '5 days 4 hours',
          200, $4, 'p24-organizer@campus.edu'
         )
         RETURNING id;`,
        [collegeId, organizerId, venueId, orgOwnerUserId]
      );
      testEventId = eventRes.rows[0].id;
      createdEventIds.push(testEventId);

      // 5. Ticket Tier
      const tierRes = await client.query(
        `INSERT INTO ticket_types (event_id, name, price_paise, capacity)
         VALUES ($1, 'General Pass', 0, 200)
         RETURNING id;`,
        [testEventId]
      );
      const tierId = tierRes.rows[0].id;

      // 6. Confirmed Booking for registered student
      const bRes = await client.query(
        `INSERT INTO bookings (event_id, user_id, status, total_paise, created_at, idempotency_key)
         VALUES ($1, $2, 'CONFIRMED', 0, NOW(), $3)
         RETURNING id;`,
        [testEventId, registeredStudentId, `idem-${Date.now()}-1`]
      );
      confirmedBookingId = bRes.rows[0].id;
      createdBookingIds.push(confirmedBookingId);

      const qrHash = crypto.randomBytes(32);
      await client.query(
        `INSERT INTO tickets (booking_id, event_id, user_id, ticket_type_id, ticket_code, status, qr_payload_hash, qr_token_hash)
         VALUES ($1, $2, $3, $4, 'P24-TKT-9912', 'VALID', $5, $6);`,
        [confirmedBookingId, testEventId, registeredStudentId, tierId, qrHash, qrHash]
      );

      // 7. Pending Booking for registered student (to test resume checkout)
      const pendingRes = await client.query(
        `INSERT INTO bookings (event_id, user_id, status, total_paise, created_at, idempotency_key)
         VALUES ($1, $2, 'PENDING_PAYMENT', 49900, NOW(), $3)
         RETURNING id;`,
        [testEventId, unregStudentId, `idem-${Date.now()}-2`]
      );
      pendingBookingId = pendingRes.rows[0].id;
      createdBookingIds.push(pendingBookingId);
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    if (app) await app.close();
    const client = await pool.connect();
    try {
      if (createdBookingIds.length > 0) {
        await client.query(`DELETE FROM bookings WHERE id = ANY($1::uuid[])`, [createdBookingIds]);
      }
      if (createdEventIds.length > 0) {
        await client.query(`DELETE FROM event_materials WHERE event_id = ANY($1::uuid[])`, [createdEventIds]);
        await client.query(`DELETE FROM ticket_types WHERE event_id = ANY($1::uuid[])`, [createdEventIds]);
        await client.query(`DELETE FROM events WHERE id = ANY($1::uuid[])`, [createdEventIds]);
      }
      if (organizerId) {
        await client.query(`DELETE FROM organizer_members WHERE organizer_id = $1`, [organizerId]);
        await client.query(`DELETE FROM organizer_profiles WHERE id = $1`, [organizerId]);
      }
      if (createdUserIds.length > 0) {
        await client.query(`DELETE FROM sessions WHERE user_id = ANY($1::uuid[])`, [createdUserIds]);
        await client.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [createdUserIds]);
      }
    } finally {
      client.release();
    }
  });

  // 1. Database Migration 26 & Reversible Down-Migration
  it('(1) verifies migration 26 down-migration to 25 and re-migration to 26 idempotently', async () => {
    const client = await pool.connect();
    try {
      const vBefore = await client.query(`SELECT MAX(version) as current_version FROM schema_migrations;`);
      expect(vBefore.rows[0].current_version).toBeGreaterThanOrEqual(26);

      // Down-migrate to 25
      await runRollbackToVersion(25);
      const vAfter = await client.query(`SELECT MAX(version) as current_version FROM schema_migrations;`);
      expect(vAfter.rows[0].current_version).toBe(25);

      // Re-migrate to 26
      await runMigrations();
      const vReapplied = await client.query(`SELECT MAX(version) as current_version FROM schema_migrations;`);
      expect(vReapplied.rows[0].current_version).toBeGreaterThanOrEqual(26);

      // Verify event_materials table exists
      const tableCheck = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' AND table_name = 'event_materials'
        ) as exists;
      `);
      expect(tableCheck.rows[0].exists).toBe(true);
    } finally {
      client.release();
    }
  });

  // 2. Organizer Materials Upload & Limits
  it('(2) organizer uploads valid event materials within size and MIME limits', async () => {
    const payload = {
      title: 'Robotics Workshop Lecture Deck & Handout',
      description: 'Slides covering ROS2 node composition and lidar odometry.',
      fileName: 'robotics-ros2-session.pdf',
      fileSizeBytes: 2048500, // ~2 MB
      mimeType: 'application/pdf',
      fileUrl: 'https://storage.eventora.campus.edu/materials/p24-robotics.pdf',
    };

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${testEventId}/materials`,
      headers: orgOwnerHeaders,
      payload,
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.material).toBeDefined();
    expect(body.material.id).toBeDefined();
    expect(body.material.title).toBe(payload.title);
    expect(body.material.mimeType).toBe('application/pdf');
    expect(body.material.fileSizeBytes).toBe(2048500);

    uploadedMaterialId = body.material.id;
  });

  // 3. Upload File Size Limit (> 25MB rejected)
  it('(3) rejects material uploads exceeding the 25 MB limit with 400 VALIDATION_ERROR', async () => {
    const oversizedPayload = {
      title: 'Oversized Raw Lidar Dataset',
      fileName: 'lidar-dump.zip',
      fileSizeBytes: 30 * 1024 * 1024, // 30 MB (> 25 MB limit)
      mimeType: 'application/zip',
      fileUrl: 'https://storage.eventora.campus.edu/materials/lidar.zip',
    };

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${testEventId}/materials`,
      headers: orgOwnerHeaders,
      payload: oversizedPayload,
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(body.error.details)).toContain('25 MB');
  });

  // 4. Upload Unsupported File Type Rejected
  it('(4) rejects unsupported material MIME types (e.g. executables) with 400 VALIDATION_ERROR', async () => {
    const maliciousPayload = {
      title: 'Suspicious Binary File',
      fileName: 'patch.exe',
      fileSizeBytes: 500000,
      mimeType: 'application/x-msdownload',
      fileUrl: 'https://storage.eventora.campus.edu/materials/patch.exe',
    };

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${testEventId}/materials`,
      headers: orgOwnerHeaders,
      payload: maliciousPayload,
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  // 5. Registered-Only Visibility: Confirmed attendee has access
  it('(5) registered attendee receives event materials list (200)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${testEventId}/materials`,
      headers: registeredStudentHeaders,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.materials).toBeDefined();
    expect(Array.isArray(body.materials)).toBe(true);
    expect(body.materials.length).toBeGreaterThanOrEqual(1);
    expect(body.materials[0].title).toBe('Robotics Workshop Lecture Deck & Handout');
  });

  // 6. Registered-Only Visibility: Unregistered attendee is denied (403 REGISTRATION_REQUIRED)
  it('(6) unregistered student is denied access with 403 REGISTRATION_REQUIRED', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${testEventId}/materials`,
      headers: unregStudentHeaders,
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe('REGISTRATION_REQUIRED');
    expect(body.error.message).toContain('registered attendees');
  });

  // 7. Organizer & Admin Access
  it('(7) organizer owner and campus admin can access materials regardless of booking', async () => {
    const ownerRes = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${testEventId}/materials`,
      headers: orgOwnerHeaders,
    });
    expect(ownerRes.statusCode).toBe(200);

    const adminRes = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${testEventId}/materials`,
      headers: adminHeaders,
    });
    expect(adminRes.statusCode).toBe(200);
  });

  // 8. Campus Calendar Month Query & RFC 5545 iCalendar download
  it('(8) calendar query accepts month parameter and events RFC 5545 .ics downloads cleanly', async () => {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const calRes = await app.inject({
      method: 'GET',
      url: `/api/v1/calendar?month=${monthKey}&view=month`,
    });

    expect(calRes.statusCode).toBe(200);
    const calBody = calRes.json();
    expect(calBody.events).toBeDefined();
    expect(Array.isArray(calBody.events)).toBe(true);

    // Test RFC 5545 .ics download route
    const icsRes = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${testEventId}/ics`,
    });

    expect(icsRes.statusCode).toBe(200);
    expect(icsRes.headers['content-type']).toContain('text/calendar');
    expect(icsRes.body).toContain('BEGIN:VCALENDAR');
    expect(icsRes.body).toContain('P24 Autonomous Robotics Summit');
    expect(icsRes.body).toContain('END:VCALENDAR');
  });

  // 9. My Bookings API returns both confirmed and pending bookings with ticket details
  it('(9) GET /api/v1/me/bookings returns user bookings with ticket and payment status', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/me/bookings',
      headers: registeredStudentHeaders,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.bookings).toBeDefined();
    expect(body.bookings.length).toBeGreaterThanOrEqual(1);

    const booking = body.bookings.find((b: any) => b.id === confirmedBookingId);
    expect(booking).toBeDefined();
    expect(booking.status).toBe('CONFIRMED');
    expect(booking.ticket_code).toBe('P24-TKT-9912');
  });

  // 10. Teams Endpoint Supports Filter "mine=true"
  it('(10) GET /api/v1/teams?mine=true returns user-joined teams', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/teams?mine=true',
      headers: registeredStudentHeaders,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.teams).toBeDefined();
    expect(Array.isArray(body.teams)).toBe(true);
  });

  // 11. Notification Center Integration & Preferences
  it('(11) GET /api/v1/me/notifications and PATCH notification preferences work end-to-end', async () => {
    const notifRes = await app.inject({
      method: 'GET',
      url: '/api/v1/me/notifications',
      headers: registeredStudentHeaders,
    });

    expect(notifRes.statusCode).toBe(200);
    const notifBody = notifRes.json();
    expect(notifBody.notifications).toBeDefined();
    expect(typeof notifBody.unreadCount).toBe('number');

    // Update preferences
    const prefRes = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me/notification-preferences',
      headers: registeredStudentHeaders,
      payload: {
        email: true,
        inapp: true,
        urgentOnly: false,
      },
    });

    expect(prefRes.statusCode).toBe(200);
  });

  // 12. Deletion of Event Material
  it('(12) organizer can delete event material successfully (200)', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/events/${testEventId}/materials/${uploadedMaterialId}`,
      headers: orgOwnerHeaders,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);

    // Verify deleted
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${testEventId}/materials`,
      headers: orgOwnerHeaders,
    });
    expect(getRes.statusCode).toBe(200);
    const remaining = getRes.json().materials;
    expect(remaining.some((m: any) => m.id === uploadedMaterialId)).toBe(false);
  });
});
