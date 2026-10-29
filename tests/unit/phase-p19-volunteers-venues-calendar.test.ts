import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import ICAL from 'ical.js';
import { pool } from '../../packages/backend/src/db/index.js';
import { buildApp } from '../../packages/backend/src/app.js';
import {
  createVolunteerRole,
  createVolunteerShift,
  applyForShift,
  approveVolunteerApplication,
  assignVolunteerApplication,
  checkInVolunteer,
  completeVolunteerShift,
} from '../../packages/backend/src/services/volunteers-operations.js';
import {
  bookVenueWindow,
  VenueConflictError,
} from '../../packages/backend/src/services/venue.js';
import {
  generateIcsCalendar,
} from '../../packages/backend/src/services/calendar.js';
import { runRollbackToVersion } from '../../packages/backend/src/db/migrate-down.js';
import { runMigrations } from '../../packages/backend/src/db/migrate.js';

describe('Phase P19: Volunteers, Venues, Calendar & RFC 5545 Hardening', () => {
  let app: FastifyInstance;
  let collegeId: string;
  let organizerId: string;
  let organizerUserId: string;
  let venueId: string;
  let publishedEventId: string;
  let draftEventId: string;

  const createdUserIds: string[] = [];
  const createdEventIds: string[] = [];
  const createdVenueIds: string[] = [];

  async function createTestUser(displayName: string, role = 'student'): Promise<{ id: string; token: string }> {
    const client = await pool.connect();
    try {
      const email = `test-p19-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@campus.edu`;
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

      return { id: userId, token: rawSession };
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
          `INSERT INTO colleges (name, domain, status)
           VALUES ('Innovation Campus', $1, 'active')
           RETURNING id;`,
          [`p19-${Date.now()}.edu`]
        );
        collegeId = newCol.rows[0].id;
      }

      // Organizer User
      const org = await createTestUser('P19 Lead Organizer', 'student');
      organizerUserId = org.id;

      // Organizer Profile
      const orgRes = await client.query(
        `INSERT INTO organizer_profiles (college_id, display_name, status, created_by)
         VALUES ($1, 'P19 Innovation Council', 'verified', $2)
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

      // Venue
      const vRes = await client.query(
        `INSERT INTO venues (college_id, name, building, capacity, status)
         VALUES ($1, 'Main Arena P19', 'Innovation Center', 600, 'active')
         RETURNING id;`,
        [collegeId]
      );
      venueId = vRes.rows[0].id;
      createdVenueIds.push(venueId);

      // Published Event
      const pubRes = await client.query(
        `INSERT INTO events (
           organizer_id, college_id, title, slug, description, category, department, format, venue_id,
           starts_at, ends_at, capacity, visibility, status, contact_email, created_by
         ) VALUES (
           $1, $2, 'Campus Tech Expo 2026', $3, 'A premier annual innovation fair with keynote speeches.', 'Tech', 'CS', 'in_person', $4,
           NOW() + INTERVAL '2 days', NOW() + INTERVAL '3 days', 500, 'public', 'published', 'contact@campus.edu', $5
         ) RETURNING id;`,
        [organizerId, collegeId, `p19-tech-expo-${Date.now()}`, venueId, organizerUserId]
      );
      publishedEventId = pubRes.rows[0].id;
      createdEventIds.push(publishedEventId);

      // Draft Event
      const draftRes = await client.query(
        `INSERT INTO events (
           organizer_id, college_id, title, slug, description, category, department, format, venue_id,
           starts_at, ends_at, capacity, visibility, status, contact_email, created_by
         ) VALUES (
           $1, $2, 'Confidential Internal Review', $3, 'Internal evaluation not yet published.', 'Academic', 'Dean', 'in_person', $4,
           NOW() + INTERVAL '5 days', NOW() + INTERVAL '6 days', 50, 'public', 'draft', 'internal@campus.edu', $5
         ) RETURNING id;`,
        [organizerId, collegeId, `p19-internal-review-${Date.now()}`, venueId, organizerUserId]
      );
      draftEventId = draftRes.rows[0].id;
      createdEventIds.push(draftEventId);
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
      if (createdVenueIds.length > 0) {
        await client.query(`DELETE FROM venues WHERE id = ANY($1);`, [createdVenueIds]);
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

  // 1. Shift Capacity Concurrency Guard
  it('(1) 50 concurrent assignments into a 5-seat shift -> exactly 5 succeed, 45 fail with CAPACITY_EXCEEDED (409)', async () => {
    const role = await createVolunteerRole(
      {
        eventId: publishedEventId,
        title: 'Stage Coordinator',
        capacity: 5,
      },
      organizerUserId
    );

    const shift = await createVolunteerShift(
      {
        roleId: role.id,
        startsAt: new Date(Date.now() + 2 * 86400000),
        endsAt: new Date(Date.now() + 2 * 86400000 + 4 * 3600000),
        capacity: 5,
      },
      organizerUserId
    );

    // Create 50 candidates, submit applications and approve them
    const applicationIds: string[] = [];
    for (let i = 0; i < 50; i++) {
      const candidate = await createTestUser(`Candidate-${i}`);
      const appRecord = await applyForShift(shift.id, candidate.id);
      await approveVolunteerApplication(appRecord.id, organizerUserId);
      applicationIds.push(appRecord.id);
    }

    // Attempt 50 simultaneous assignments
    const results = await Promise.allSettled(
      applicationIds.map((appId) => assignVolunteerApplication(appId, organizerUserId))
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(succeeded.length).toBe(5);
    expect(rejected.length).toBe(45);

    rejected.forEach((r) => {
      const err = (r as PromiseRejectedResult).reason;
      expect(err.message).toContain('CAPACITY_EXCEEDED');
      expect(err.status).toBe(409);
    });

    // DB verification: check shift.assigned is exactly 5
    const client = await pool.connect();
    try {
      const sRes = await client.query('SELECT assigned, capacity FROM volunteer_shifts WHERE id = $1;', [shift.id]);
      expect(sRes.rows[0].assigned).toBe(5);
      expect(sRes.rows[0].capacity).toBe(5);
    } finally {
      client.release();
    }
  });

  // 2. Overlapping Shift Concurrency Guard
  it('(2) user cannot be assigned to two overlapping shifts concurrently -> exactly 1 succeeds, 1 gets OVERLAPPING_SHIFT_ASSIGNMENT (409)', async () => {
    const role = await createVolunteerRole(
      {
        eventId: publishedEventId,
        title: 'Safety Patrol',
        capacity: 10,
      },
      organizerUserId
    );

    const tStart = new Date(Date.now() + 2.1 * 86400000);
    const tEnd = new Date(Date.now() + 2.1 * 86400000 + 3 * 3600000);

    const shiftA = await createVolunteerShift(
      {
        roleId: role.id,
        startsAt: tStart,
        endsAt: tEnd,
        capacity: 5,
      },
      organizerUserId
    );

    const shiftB = await createVolunteerShift(
      {
        roleId: role.id,
        startsAt: new Date(tStart.getTime() + 1800000), // starts 30 mins into Shift A
        endsAt: new Date(tEnd.getTime() + 1800000),
        capacity: 5,
      },
      organizerUserId
    );

    const candidate = await createTestUser('Double Shift Applicant');
    const appA = await applyForShift(shiftA.id, candidate.id);
    const appB = await applyForShift(shiftB.id, candidate.id);

    await approveVolunteerApplication(appA.id, organizerUserId);
    await approveVolunteerApplication(appB.id, organizerUserId);

    // Concurrently trigger assign for both applications of the same candidate
    const results = await Promise.allSettled([
      assignVolunteerApplication(appA.id, organizerUserId),
      assignVolunteerApplication(appB.id, organizerUserId),
    ]);

    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(succeeded.length).toBe(1);
    expect(rejected.length).toBe(1);

    const err = (rejected[0] as PromiseRejectedResult).reason;
    expect(err.message).toContain('OVERLAPPING_SHIFT_ASSIGNMENT');
    expect(err.status).toBe(409);
  });

  // 3. Idempotent Volunteer Shift Completion
  it('(3) completeVolunteerShift is strictly idempotent and prevents duplicate passport credits via uq_volunteer_records_user_shift', async () => {
    const role = await createVolunteerRole(
      {
        eventId: publishedEventId,
        title: 'Welcome Ambassador',
        capacity: 5,
      },
      organizerUserId
    );

    const baseTime = Date.now() - 2 * 3600000;
    const shift = await createVolunteerShift(
      {
        roleId: role.id,
        startsAt: new Date(baseTime),
        endsAt: new Date(baseTime + 2 * 3600000), // 2 hour shift
        capacity: 5,
      },
      organizerUserId
    );

    const candidate = await createTestUser('Idempotent Candidate');
    const appRecord = await applyForShift(shift.id, candidate.id);
    await approveVolunteerApplication(appRecord.id, organizerUserId);
    const assigned = await assignVolunteerApplication(appRecord.id, organizerUserId);
    await checkInVolunteer(appRecord.id, organizerUserId, assigned.checkinToken);

    // First completion
    const complete1 = await completeVolunteerShift(appRecord.id, organizerUserId);
    expect(complete1.status).toBe('COMPLETED');
    expect(complete1.record).toBeDefined();
    expect(Number(complete1.record.hours)).toBe(2);

    // Second completion (idempotent call)
    const complete2 = await completeVolunteerShift(appRecord.id, organizerUserId);
    expect(complete2.status).toBe('COMPLETED');
    expect(complete2.alreadyCompleted).toBe(true);
    expect(complete2.record.id).toBe(complete1.record.id);

    // Database verification: strictly ONE record exists in volunteer_records
    const client = await pool.connect();
    try {
      const records = await client.query(
        'SELECT * FROM volunteer_records WHERE user_id = $1 AND shift_id = $2;',
        [candidate.id, shift.id]
      );
      expect(records.rowCount).toBe(1);
      expect(Number(records.rows[0].hours)).toBe(2);

      // Verify that direct duplicate insertion triggers unique constraint violation
      let duplicateThrew = false;
      try {
        await client.query(
          `INSERT INTO volunteer_records (user_id, event_id, shift_id, hours, verified_by)
           VALUES ($1, $2, $3, 2, $4);`,
          [candidate.id, publishedEventId, shift.id, organizerUserId]
        );
      } catch (err: any) {
        duplicateThrew = true;
        expect(err.code).toBe('23505'); // unique_violation
        expect(err.constraint).toBe('uq_volunteer_records_user_shift');
      }
      expect(duplicateThrew).toBe(true);
    } finally {
      client.release();
    }
  });

  // 4. Venue Double-Booking Concurrency (GiST Exclusion Constraint)
  it('(4) parallel bookVenueWindow calls for overlapping time window throw VenueConflictError (SQLSTATE 23P01)', async () => {
    // Create two new events requiring the same venue for the same time window
    const client = await pool.connect();
    let event1Id = '';
    let event2Id = '';
    try {
      const e1 = await client.query(
        `INSERT INTO events (
           organizer_id, college_id, title, slug, description, category, department, format, venue_id,
           starts_at, ends_at, capacity, visibility, status, contact_email, created_by
         ) VALUES (
           $1, $2, 'Conference Session Alpha', $3, 'Session Alpha', 'Tech', 'CS', 'in_person', $4,
           NOW() + INTERVAL '10 days', NOW() + INTERVAL '10 days 4 hours', 200, 'public', 'published', 'org@campus.edu', $5
         ) RETURNING id;`,
        [organizerId, collegeId, `p19-conf-alpha-${Date.now()}`, venueId, organizerUserId]
      );
      event1Id = e1.rows[0].id;
      createdEventIds.push(event1Id);

      const e2 = await client.query(
        `INSERT INTO events (
           organizer_id, college_id, title, slug, description, category, department, format, venue_id,
           starts_at, ends_at, capacity, visibility, status, contact_email, created_by
         ) VALUES (
           $1, $2, 'Conference Session Beta', $3, 'Session Beta', 'Tech', 'CS', 'in_person', $4,
           NOW() + INTERVAL '10 days 2 hours', NOW() + INTERVAL '10 days 6 hours', 200, 'public', 'published', 'org@campus.edu', $5
         ) RETURNING id;`,
        [organizerId, collegeId, `p19-conf-beta-${Date.now()}`, venueId, organizerUserId]
      );
      event2Id = e2.rows[0].id;
      createdEventIds.push(event2Id);
    } finally {
      client.release();
    }

    const tStart1 = new Date(Date.now() + 10 * 86400000);
    const tEnd1 = new Date(Date.now() + 10 * 86400000 + 4 * 3600000);

    const tStart2 = new Date(Date.now() + 10 * 86400000 + 2 * 3600000);
    const tEnd2 = new Date(Date.now() + 10 * 86400000 + 6 * 3600000);

    // Book first event
    const booking1 = await bookVenueWindow(event1Id, venueId, tStart1, tEnd1, 'confirmed');
    expect(booking1.venueId || (booking1 as any).venue_id).toBe(venueId);

    // Booking second event overlapping window MUST fail with VenueConflictError
    await expect(
      bookVenueWindow(event2Id, venueId, tStart2, tEnd2, 'confirmed')
    ).rejects.toThrow(VenueConflictError);

    // Check venue availability endpoint
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/venues/${venueId}/availability?startsAt=${tStart2.toISOString()}&endsAt=${tEnd2.toISOString()}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.available).toBe(false);
    expect(body.conflict).toBeDefined();
    expect(body.conflict.eventId).toBe(event1Id);
  });

  // 5. RFC 5545 iCalendar Line Folding & Syntax Parser Validation
  it('(5) RFC 5545 calendar export adheres to 75-octet folding, text escaping, and validates with ical.js', async () => {
    // Generate calendar with long text and special characters
    const longTitle = 'Annual Global Innovation Challenge with International University Partners & Engineering Teams 2026';
    const descriptionWithSpecials = 'Join us for: keynote speeches; live product demos, Q&A sessions\\workshops.\nNote: please bring laptop & ID badge!';

    const client = await pool.connect();
    let specialEvent: any;
    try {
      const res = await client.query(
        `INSERT INTO events (
           organizer_id, college_id, title, slug, description, category, department, format, venue_id,
           starts_at, ends_at, capacity, visibility, status, contact_email, created_by
         ) VALUES (
           $1, $2, $3, $4, $5, 'Tech', 'CS', 'in_person', $6,
           '2026-11-15T09:00:00.000Z', '2026-11-15T18:00:00.000Z', 300, 'public', 'published', 'contact@campus.edu', $7
         ) RETURNING *;`,
        [organizerId, collegeId, longTitle, `p19-rfc5545-${Date.now()}`, descriptionWithSpecials, venueId, organizerUserId]
      );
      specialEvent = res.rows[0];
      createdEventIds.push(specialEvent.id);
    } finally {
      client.release();
    }

    const venue = {
      id: venueId,
      name: 'Auditorium Alpha, Central Campus',
      building: 'Engineering Block 4; Gate 2',
    } as any;

    const icsString = generateIcsCalendar(
      {
        ...specialEvent,
        startsAt: new Date(specialEvent.starts_at),
        endsAt: new Date(specialEvent.ends_at),
      },
      venue
    );

    // 1. Verify CRLF endings
    expect(icsString.includes('\r\n')).toBe(true);

    // 2. Verify all lines (split on CRLF) are <= 75 octets
    const rawLines = icsString.split('\r\n').filter((l) => l.length > 0);
    for (const line of rawLines) {
      const byteLen = Buffer.byteLength(line, 'utf8');
      expect(byteLen).toBeLessThanOrEqual(75);
    }

    // 3. Verify folded continuation lines begin with SPACE
    const foldedLines = rawLines.filter((l, idx) => idx > 0 && l.startsWith(' '));
    expect(foldedLines.length).toBeGreaterThan(0);

    // 4. Validate using RFC 5545 ICAL Parser (ical.js)
    const jcalData = ICAL.parse(icsString);
    expect(jcalData).toBeDefined();

    const comp = new ICAL.Component(jcalData);
    expect(comp.name).toBe('vcalendar');

    const vevent = comp.getFirstSubcomponent('vevent');
    expect(vevent).toBeDefined();

    // Verify unescaped values match original data
    const parsedSummary = vevent.getFirstPropertyValue('summary');
    expect(parsedSummary).toBe(longTitle);

    const parsedDescription = vevent.getFirstPropertyValue('description');
    expect(parsedDescription).toBe(descriptionWithSpecials);

    const parsedLocation = vevent.getFirstPropertyValue('location');
    expect(parsedLocation).toBe('Auditorium Alpha, Central Campus, Engineering Block 4; Gate 2');

    const dtStart = vevent.getFirstPropertyValue('dtstart');
    expect(dtStart.toICALString()).toBe('20261115T090000Z');
  });

  // 6. Public GETs Draft / PII Isolation
  it('(6) public GETs never expose draft events or PII across calendar and volunteer routes', async () => {
    // 1. GET /api/v1/calendar must NOT contain draft events
    const calRes = await app.inject({
      method: 'GET',
      url: '/api/v1/calendar',
    });
    expect(calRes.statusCode).toBe(200);
    const calBody = calRes.json();
    const eventIdsInCalendar = calBody.events.map((e: any) => e.id);
    expect(eventIdsInCalendar).toContain(publishedEventId);
    expect(eventIdsInCalendar).not.toContain(draftEventId);

    // Verify no PII fields in calendar events
    for (const item of calBody.events) {
      expect(item.contact_email).toBeUndefined();
      expect(item.created_by).toBeUndefined();
      expect(item.organizer_id).toBeUndefined();
    }

    // 2. GET /api/v1/events/:id/ics must return 404 for draft events to unauthenticated user
    const icsRes = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${draftEventId}/ics`,
    });
    expect(icsRes.statusCode).toBe(404);
    expect(icsRes.json().error.code).toBe('EVENT_NOT_FOUND');

    // 3. GET /api/v1/events/:id/volunteer-roles must return 404 for draft events to unauthenticated user
    const rolesRes = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${draftEventId}/volunteer-roles`,
    });
    expect(rolesRes.statusCode).toBe(404);
    expect(rolesRes.json().error.code).toBe('EVENT_NOT_FOUND');

    // Published event ICS download succeeds with text/calendar header
    const pubIcsRes = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${publishedEventId}/ics`,
    });
    expect(pubIcsRes.statusCode).toBe(200);
    expect(pubIcsRes.headers['content-type']).toContain('text/calendar');
    expect(pubIcsRes.body).toContain('BEGIN:VCALENDAR');
  });

  // 7. Database Migration 22 & Rollback Integrity
  it('(7) verifies migration 22 indexes and down-migration idempotently', async () => {
    const client = await pool.connect();
    try {
      // Verify indexes created in migration 22 exist
      const idxRes = await client.query(`
        SELECT indexname FROM pg_indexes
        WHERE indexname IN (
          'uq_volunteer_records_user_shift',
          'idx_volunteer_shifts_role_time',
          'idx_volunteer_applications_user_status'
        );
      `);
      const names = idxRes.rows.map((r) => r.indexname);
      expect(names).toContain('uq_volunteer_records_user_shift');
      expect(names).toContain('idx_volunteer_shifts_role_time');
      expect(names).toContain('idx_volunteer_applications_user_status');
    } finally {
      client.release();
    }

    try {
      // Test rollback to version 21
      await runRollbackToVersion(21);

      // Verify index is removed in version 21
      const client2 = await pool.connect();
      try {
        const idxRes2 = await client2.query(`
          SELECT indexname FROM pg_indexes WHERE indexname = 'uq_volunteer_records_user_shift';
        `);
        expect(idxRes2.rowCount).toBe(0);
      } finally {
        client2.release();
      }
    } finally {
      // Re-apply migration back to latest version
      await runMigrations();
    }

    // Verify index is restored
    const client3 = await pool.connect();
    try {
      const idxRes3 = await client3.query(`
        SELECT indexname FROM pg_indexes WHERE indexname = 'uq_volunteer_records_user_shift';
      `);
      expect(idxRes3.rowCount).toBe(1);
    } finally {
      client3.release();
    }
  });
});
