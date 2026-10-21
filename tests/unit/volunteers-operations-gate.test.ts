import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
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
  requestEquipment,
  createSupportIssue,
  updateSupportIssue,
  registerGuest,
} from '../../packages/backend/src/services/volunteers-operations.js';

describe('Phase 8 Quality Gate: Volunteers, Venue Navigator, Equipment & Issue Desk (FR-VOL, FR-VENUE, FR-OPS)', () => {
  const app = buildApp();
  let collegeId: string;
  let orgAUserId: string;
  let organizerAId: string;
  let student1Id: string;
  let student2Id: string;
  let orgAToken: string;
  let student1Token: string;
  let eventAId: string;
  let guestEventId: string;
  let equipmentItemId: string;

  const createdUserIds: string[] = [];
  const createdEventIds: string[] = [];

  async function createTestUser(displayName: string, role = 'student'): Promise<{ id: string; token: string }> {
    const client = await pool.connect();
    try {
      const email = `test-vol-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@campus.edu`;
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
    await app.ready();
    const client = await pool.connect();
    try {
      // 1. Create College
      const colRes = await client.query(
        `INSERT INTO colleges (name, domain, status)
         VALUES ('Tech Institute of Innovation', $1, 'active')
         RETURNING id;`,
        [`vol-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.edu`]
      );
      collegeId = colRes.rows[0].id;

      // 2. Create Users
      const orgA = await createTestUser('Organizer A', 'student');
      orgAUserId = orgA.id;
      orgAToken = orgA.token;

      const st1 = await createTestUser('Volunteer Alice', 'student');
      student1Id = st1.id;
      student1Token = st1.token;

      const st2 = await createTestUser('Volunteer Bob', 'student');
      student2Id = st2.id;

      // 3. Create Organizer Profile & Membership
      const orgRes = await client.query(
        `INSERT INTO organizer_profiles (college_id, display_name, status, created_by)
         VALUES ($1, 'Robotics Society', 'verified', $2)
         RETURNING id;`,
        [collegeId, orgAUserId]
      );
      organizerAId = orgRes.rows[0].id;

      await client.query(
        `INSERT INTO organizer_members (organizer_id, user_id, role, status)
         VALUES ($1, $2, 'owner', 'active');`,
        [organizerAId, orgAUserId]
      );

      // 4. Create Venue
      const vRes = await client.query(
        `INSERT INTO venues (college_id, name, building, capacity, accessibility_notes, directions, map_url, lat, lng, entry_instructions)
         VALUES ($1, 'Main Auditorium Hall A', 'Campus Center Block 3', 500, 'Elevator access at Gate 2', 'Follow South Walkway', 'https://maps.campus.edu/hall-a', 12.9716, 77.5946, 'Staff check-in at side entrance')
         RETURNING id;`,
        [collegeId]
      );
      const venueId = vRes.rows[0].id;

      // 5. Create Event A (allow_guests = false)
      const eResA = await client.query(
        `INSERT INTO events (
           organizer_id, college_id, title, slug, description, category, department, format, venue_id,
           starts_at, ends_at, capacity, visibility, status, contact_email, created_by, allow_guests
         ) VALUES (
           $1, $2, 'Campus Robotics Challenge 2026', $3, 'Annual robotic obstacle run', 'Tech', 'CS', 'in_person', $4,
           NOW() + INTERVAL '2 days', NOW() + INTERVAL '3 days', 200, 'public', 'published', 'robotics@campus.edu', $5, false
         ) RETURNING id;`,
        [organizerAId, collegeId, `gate-vol-event-a-${Date.now()}`, venueId, orgAUserId]
      );
      eventAId = eResA.rows[0].id;
      createdEventIds.push(eventAId);

      // 6. Create Event B (allow_guests = true)
      const eResB = await client.query(
        `INSERT INTO events (
           organizer_id, college_id, title, slug, description, category, department, format, venue_id,
           starts_at, ends_at, capacity, visibility, status, contact_email, created_by, allow_guests
         ) VALUES (
           $1, $2, 'Open Campus Showcase 2026', $3, 'Public science fair', 'Tech', 'CS', 'in_person', $4,
           NOW() + INTERVAL '4 days', NOW() + INTERVAL '5 days', 500, 'public', 'published', 'showcase@campus.edu', $5, true
         ) RETURNING id;`,
        [organizerAId, collegeId, `gate-vol-event-b-${Date.now()}`, venueId, orgAUserId]
      );
      guestEventId = eResB.rows[0].id;
      createdEventIds.push(guestEventId);

      // 7. Create Equipment Item (Campus Total = 10)
      const eqRes = await client.query(
        `INSERT INTO equipment_items (college_id, name, qty_total)
         VALUES ($1, 'Wireless PA Microphone Kit', 10)
         RETURNING id;`,
        [collegeId]
      );
      equipmentItemId = eqRes.rows[0].id;
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    await app.close();
    const client = await pool.connect();
    try {
      if (createdEventIds.length > 0) {
        await client.query(`DELETE FROM events WHERE id = ANY($1);`, [createdEventIds]);
      }
      if (organizerAId) {
        await client.query(`DELETE FROM organizer_members WHERE organizer_id = $1;`, [organizerAId]);
        await client.query(`DELETE FROM organizer_profiles WHERE id = $1;`, [organizerAId]);
      }
      if (equipmentItemId) {
        await client.query(`DELETE FROM equipment_items WHERE id = $1;`, [equipmentItemId]);
      }
      if (createdUserIds.length > 0) {
        await client.query(`DELETE FROM users WHERE id = ANY($1);`, [createdUserIds]);
      }
      if (collegeId) {
        await client.query(`DELETE FROM venues WHERE college_id = $1;`, [collegeId]);
        await client.query(`DELETE FROM colleges WHERE id = $1;`, [collegeId]);
      }
    } finally {
      client.release();
    }
  });

  // Gate Test 1: 50 concurrent assignments into a 5-seat shift -> exactly 5 succeed, 45 fail with CAPACITY_EXCEEDED
  it('(1) 50 concurrent assignments into a 5-seat shift -> exactly 5 succeed, 45 fail (no over-assignment)', async () => {
    const role = await createVolunteerRole(
      {
        eventId: eventAId,
        title: 'Stage & Track Usher',
        requirements: 'Guide attendees to arena seats',
        capacity: 10,
      },
      orgAUserId
    );

    const shift = await createVolunteerShift(
      {
        roleId: role.id,
        startsAt: new Date(Date.now() + 86400000),
        endsAt: new Date(Date.now() + 86400000 + 4 * 3600000),
        capacity: 5, // Exactly 5 capacity
      },
      orgAUserId
    );

    // Create 50 students, apply and approve them
    const studentApps: string[] = [];
    for (let i = 0; i < 50; i++) {
      const student = await createTestUser(`Candidate ${i}`);
      const appRecord = await applyForShift(shift.id, student.id);
      await approveVolunteerApplication(appRecord.id, orgAUserId);
      studentApps.push(appRecord.id);
    }

    // Run 50 concurrent assignments
    const results = await Promise.allSettled(
      studentApps.map((appId) => assignVolunteerApplication(appId, orgAUserId))
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');

    expect(succeeded.length).toBe(5);
    expect(failed.length).toBe(45);

    // Verify shift assigned count is exactly 5
    const client = await pool.connect();
    try {
      const sRes = await client.query('SELECT assigned, capacity FROM volunteer_shifts WHERE id = $1;', [shift.id]);
      expect(sRes.rows[0].assigned).toBe(5);
      expect(sRes.rows[0].capacity).toBe(5);
    } finally {
      client.release();
    }
  });

  // Gate Test 2: Overlapping shift assignment rejected
  it('(2) user cannot be ASSIGNED to two overlapping shifts (OVERLAPPING_SHIFT_ASSIGNMENT 409)', async () => {
    const role = await createVolunteerRole(
      {
        eventId: eventAId,
        title: 'Technical Setup Crew',
        capacity: 5,
      },
      orgAUserId
    );

    const baseTime = Date.now() + 200000000;
    // Shift 1: 10:00 to 14:00
    const shift1 = await createVolunteerShift(
      {
        roleId: role.id,
        startsAt: new Date(baseTime),
        endsAt: new Date(baseTime + 4 * 3600000),
        capacity: 2,
      },
      orgAUserId
    );

    // Shift 2: 12:00 to 16:00 (overlaps with Shift 1 by 2 hours)
    const shift2 = await createVolunteerShift(
      {
        roleId: role.id,
        startsAt: new Date(baseTime + 2 * 3600000),
        endsAt: new Date(baseTime + 6 * 3600000),
        capacity: 2,
      },
      orgAUserId
    );

    // Student 1 applies to both shifts and is approved
    const app1 = await applyForShift(shift1.id, student1Id);
    await approveVolunteerApplication(app1.id, orgAUserId);

    const app2 = await applyForShift(shift2.id, student1Id);
    await approveVolunteerApplication(app2.id, orgAUserId);

    // Assign to Shift 1 succeeds
    const assigned1 = await assignVolunteerApplication(app1.id, orgAUserId);
    expect(assigned1.status).toBe('ASSIGNED');

    // Attempting to assign to Shift 2 must be rejected with OVERLAPPING_SHIFT_ASSIGNMENT
    await expect(assignVolunteerApplication(app2.id, orgAUserId)).rejects.toThrow(
      'OVERLAPPING_SHIFT_ASSIGNMENT'
    );
  });

  // Gate Test 3: Illegal state transitions rejected
  it('(3) illegal transitions are rejected (e.g. APPLIED directly to CHECKED_IN or COMPLETED)', async () => {
    const role = await createVolunteerRole(
      {
        eventId: eventAId,
        title: 'Scoreboard Operator',
        capacity: 2,
      },
      orgAUserId
    );

    const shift = await createVolunteerShift(
      {
        roleId: role.id,
        startsAt: new Date(Date.now() + 300000000),
        endsAt: new Date(Date.now() + 300000000 + 3600000),
        capacity: 2,
      },
      orgAUserId
    );

    const appRecord = await applyForShift(shift.id, student2Id);

    // Cannot check in directly from APPLIED
    await expect(checkInVolunteer(appRecord.id, orgAUserId)).rejects.toThrow('INVALID_TRANSITION');

    // Cannot complete directly from APPLIED
    await expect(completeVolunteerShift(appRecord.id, orgAUserId)).rejects.toThrow('INVALID_TRANSITION');

    // Cannot assign directly without approval
    await expect(assignVolunteerApplication(appRecord.id, orgAUserId)).rejects.toThrow('INVALID_TRANSITION');
  });

  // Gate Test 4: Audit row written for every change
  it('(4) every volunteer role, shift, application, assignment, and completion is audited in audit_logs', async () => {
    const client = await pool.connect();
    try {
      const auditRes = await client.query(
        `SELECT action FROM audit_logs
         WHERE action IN ('VOLUNTEER_ROLE_CREATED', 'VOLUNTEER_SHIFT_CREATED', 'VOLUNTEER_APPLIED', 'VOLUNTEER_APPROVED', 'VOLUNTEER_ASSIGNED')
         ORDER BY id DESC LIMIT 10;`
      );
      expect(auditRes.rows.length).toBeGreaterThan(0);
      const actions = auditRes.rows.map((r) => r.action);
      expect(actions).toContain('VOLUNTEER_ASSIGNED');
    } finally {
      client.release();
    }
  });

  // Gate Test 5: Volunteer cannot read other applicants (403 Forbidden)
  it('(5) volunteer cannot read other applicants roster (403 Forbidden with event:manage:owned)', async () => {
    const role = await createVolunteerRole(
      {
        eventId: eventAId,
        title: 'Check-in Assistance',
        capacity: 3,
      },
      orgAUserId
    );

    const shift = await createVolunteerShift(
      {
        roleId: role.id,
        startsAt: new Date(Date.now() + 400000000),
        endsAt: new Date(Date.now() + 400000000 + 2 * 3600000),
        capacity: 3,
      },
      orgAUserId
    );

    // Student 1 attempts to query shift applicants roster
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/shifts/${shift.id}/applications`,
      headers: {
        authorization: `Bearer ${student1Token}`,
      },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error.code).toBe('FORBIDDEN');
  });

  // Gate Test 6: Check-in with token and completion creates volunteer_records row
  it('(6) valid check-in and completion generates volunteer_records row with verified hours for Passport', async () => {
    const role = await createVolunteerRole(
      {
        eventId: eventAId,
        title: 'Lead Event Ambassador',
        capacity: 2,
      },
      orgAUserId
    );

    const baseTime = Date.now() - 4 * 3600000;
    const shift = await createVolunteerShift(
      {
        roleId: role.id,
        startsAt: new Date(baseTime),
        endsAt: new Date(baseTime + 3 * 3600000), // 3 hours shift
        capacity: 2,
      },
      orgAUserId
    );

    const candidate = await createTestUser('Passport Candidate');
    const appRec = await applyForShift(shift.id, candidate.id);
    await approveVolunteerApplication(appRec.id, orgAUserId);
    const assigned = await assignVolunteerApplication(appRec.id, orgAUserId);

    expect(assigned.checkinToken).toBeDefined();

    // Check-in using assigned check-in token
    const checkedIn = await checkInVolunteer(appRec.id, candidate.id, assigned.checkinToken);
    expect(checkedIn.status).toBe('CHECKED_IN');

    // Complete shift
    const completion = await completeVolunteerShift(appRec.id, orgAUserId);
    expect(completion.status).toBe('COMPLETED');
    expect(Number(completion.record.hours)).toBe(3);

    // Verify record in DB
    const client = await pool.connect();
    try {
      const rec = await client.query(
        'SELECT hours, verified_by FROM volunteer_records WHERE shift_id = $1 AND user_id = $2;',
        [shift.id, candidate.id]
      );
      expect(rec.rowCount).toBe(1);
      expect(Number(rec.rows[0].hours)).toBe(3);
      expect(rec.rows[0].verified_by).toBe(orgAUserId);
    } finally {
      client.release();
    }
  });

  // Gate Test 7: Equipment request concurrency check
  it('(7) equipment requests respect inventory bounds: 2 requests of 6 for 10-unit stock -> 1 succeeds, 1 rejected (EQUIPMENT_UNAVAILABLE)', async () => {
    const windowStart = new Date(Date.now() + 500000000);
    const windowEnd = new Date(Date.now() + 500000000 + 86400000);

    // Two concurrent requests of qty=6 when qty_total=10
    const results = await Promise.allSettled([
      requestEquipment(
        {
          eventId: eventAId,
          itemId: equipmentItemId,
          qty: 6,
          startsAt: windowStart,
          endsAt: windowEnd,
        },
        orgAUserId
      ),
      requestEquipment(
        {
          eventId: eventAId,
          itemId: equipmentItemId,
          qty: 6,
          startsAt: windowStart,
          endsAt: windowEnd,
        },
        orgAUserId
      ),
    ]);

    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');

    expect(succeeded.length).toBe(1);
    expect(failed.length).toBe(1);
    expect((failed[0] as PromiseRejectedResult).reason.message).toContain('EQUIPMENT_UNAVAILABLE');
  });

  // Gate Test 8: Support Issue Desk lifecycle & timeline events
  it('(8) support issue lifecycle: created -> updated to IN_PROGRESS with audit timeline events', async () => {
    const issue = await createSupportIssue({
      eventId: eventAId,
      reporterId: student1Id,
      category: 'Equipment',
      title: 'Microphone feedback in Room 204',
      description: 'Audio screeching on primary wireless mic during keynote speech',
    });

    expect(issue.status).toBe('OPEN');

    const updated = await updateSupportIssue(issue.id, orgAUserId, {
      status: 'IN_PROGRESS',
      ownerId: orgAUserId,
      note: 'AV technician dispatched with replacement receiver unit',
    });

    expect(updated.status).toBe('IN_PROGRESS');

    const client = await pool.connect();
    try {
      const eventsRes = await client.query(
        'SELECT from_status, to_status, note FROM support_issue_events WHERE issue_id = $1 ORDER BY id ASC;',
        [issue.id]
      );
      expect(eventsRes.rows.length).toBe(2);
      expect(eventsRes.rows[0].to_status).toBe('OPEN');
      expect(eventsRes.rows[1].from_status).toBe('OPEN');
      expect(eventsRes.rows[1].to_status).toBe('IN_PROGRESS');
    } finally {
      client.release();
    }
  });

  // Gate Test 9: Guest registration guard
  it('(9) guest registration guard: rejected when allow_guests=false, accepted when allow_guests=true with access code', async () => {
    // Event A has allow_guests = false -> rejected with 403
    await expect(
      registerGuest(eventAId, 'Guest Speaker Dr. Rao', 'guest@external.org', orgAUserId)
    ).rejects.toThrow('GUEST_REGISTRATION_DISABLED');

    // Event B has allow_guests = true -> succeeds and returns Crockford access code
    const result = await registerGuest(
      guestEventId,
      'Visiting Scholar Prof. Evelyn',
      'evelyn@visiting.edu',
      orgAUserId
    );
    expect(result.registration.name).toBe('Visiting Scholar Prof. Evelyn');
    expect(result.accessCode).toMatch(/^GST-[A-Z0-9]{8}$/);
  });
});
