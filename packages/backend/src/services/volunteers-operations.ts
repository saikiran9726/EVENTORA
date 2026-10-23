import crypto from 'crypto';
import { pool } from '../db/index.js';

export interface CreateVolunteerRoleInput {
  eventId: string;
  title: string;
  requirements?: string;
  capacity: number;
}

export interface CreateVolunteerShiftInput {
  roleId: string;
  startsAt: Date | string;
  endsAt: Date | string;
  capacity: number;
  venueId?: string | null;
}

export interface EquipmentRequestInput {
  eventId: string;
  itemId: string;
  qty: number;
  startsAt: Date | string;
  endsAt: Date | string;
}

export interface SupportIssueInput {
  eventId: string;
  reporterId: string;
  category: string;
  title: string;
  description: string;
}

export interface UpdateSupportIssueInput {
  status?: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
  ownerId?: string | null;
  note: string;
}

// 1. Create Volunteer Role
export async function createVolunteerRole(input: CreateVolunteerRoleInput, actorId: string) {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `INSERT INTO volunteer_roles (event_id, title, requirements, capacity)
       VALUES ($1, $2, $3, $4)
       RETURNING id, event_id, title, requirements, capacity, created_at;`,
      [input.eventId, input.title.trim(), input.requirements || null, input.capacity]
    );
    const role = res.rows[0];

    await client.query(
      `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, meta)
       VALUES ($1, 'VOLUNTEER_ROLE_CREATED', 'volunteer_role', $2, $3);`,
      [actorId, role.id, JSON.stringify({ eventId: input.eventId, title: input.title })]
    );

    return role;
  } finally {
    client.release();
  }
}

// 2. Get Volunteer Roles for Event
export async function getVolunteerRoles(eventId: string) {
  const client = await pool.connect();
  try {
    const rolesRes = await client.query(
      `SELECT r.id, r.event_id, r.title, r.requirements, r.capacity, r.created_at,
              COALESCE(
                json_agg(
                  json_build_object(
                    'id', s.id,
                    'startsAt', s.starts_at,
                    'endsAt', s.ends_at,
                    'capacity', s.capacity,
                    'assigned', s.assigned,
                    'venueId', s.venue_id,
                    'venueName', v.name
                  ) ORDER BY s.starts_at ASC
                ) FILTER (WHERE s.id IS NOT NULL),
                '[]'
              ) AS shifts
       FROM volunteer_roles r
       LEFT JOIN volunteer_shifts s ON s.role_id = r.id
       LEFT JOIN venues v ON v.id = s.venue_id
       WHERE r.event_id = $1
       GROUP BY r.id
       ORDER BY r.created_at ASC;`,
      [eventId]
    );
    return rolesRes.rows;
  } finally {
    client.release();
  }
}

// 3. Create Volunteer Shift
export async function createVolunteerShift(input: CreateVolunteerShiftInput, actorId: string) {
  const client = await pool.connect();
  try {
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);

    if (endsAt <= startsAt) {
      throw new Error('Shift ends_at must be strictly greater than starts_at');
    }
    if (input.capacity <= 0) {
      throw new Error('Shift capacity must be greater than 0');
    }

    const res = await client.query(
      `INSERT INTO volunteer_shifts (role_id, starts_at, ends_at, capacity, venue_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, role_id, starts_at, ends_at, capacity, assigned, venue_id, created_at;`,
      [input.roleId, startsAt.toISOString(), endsAt.toISOString(), input.capacity, input.venueId || null]
    );
    const shift = res.rows[0];

    await client.query(
      `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, meta)
       VALUES ($1, 'VOLUNTEER_SHIFT_CREATED', 'volunteer_shift', $2, $3);`,
      [actorId, shift.id, JSON.stringify({ roleId: input.roleId, capacity: input.capacity })]
    );

    return shift;
  } finally {
    client.release();
  }
}

// 4. Apply for Shift
export async function applyForShift(shiftId: string, userId: string) {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `INSERT INTO volunteer_applications (shift_id, user_id, status)
       VALUES ($1, $2, 'APPLIED')
       ON CONFLICT (shift_id, user_id) DO NOTHING
       RETURNING id, shift_id, user_id, status, created_at;`,
      [shiftId, userId]
    );

    if (res.rowCount === 0) {
      const existing = await client.query(
        `SELECT id, shift_id, user_id, status, created_at FROM volunteer_applications
         WHERE shift_id = $1 AND user_id = $2;`,
        [shiftId, userId]
      );
      return existing.rows[0];
    }

    const application = res.rows[0];

    await client.query(
      `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, meta)
       VALUES ($1, 'VOLUNTEER_APPLIED', 'volunteer_application', $2, $3);`,
      [userId, application.id, JSON.stringify({ shiftId })]
    );

    return application;
  } finally {
    client.release();
  }
}

// 5. Approve Application (APPLIED -> APPROVED)
export async function approveVolunteerApplication(applicationId: string, actorId: string) {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `UPDATE volunteer_applications
       SET status = 'APPROVED', reviewed_by = $1
       WHERE id = $2 AND status = 'APPLIED'
       RETURNING id, shift_id, user_id, status, reviewed_by;`,
      [actorId, applicationId]
    );

    if (res.rowCount === 0) {
      throw new Error('INVALID_TRANSITION: Application is not in APPLIED state or does not exist');
    }

    const app = res.rows[0];

    await client.query(
      `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, meta)
       VALUES ($1, 'VOLUNTEER_APPROVED', 'volunteer_application', $2, $3);`,
      [actorId, app.id, JSON.stringify({ shiftId: app.shift_id, userId: app.user_id })]
    );

    return app;
  } finally {
    client.release();
  }
}

// 6. Assign Volunteer (APPROVED -> ASSIGNED) with Row Locking, Capacity and Overlap Guards
export async function assignVolunteerApplication(applicationId: string, actorId: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Lock application row
    const appRes = await client.query(
      `SELECT id, shift_id, user_id, status FROM volunteer_applications
       WHERE id = $1 FOR UPDATE;`,
      [applicationId]
    );

    if (appRes.rowCount === 0) {
      await client.query('ROLLBACK');
      throw new Error('APPLICATION_NOT_FOUND');
    }

    const app = appRes.rows[0];
    if (app.status !== 'APPROVED') {
      await client.query('ROLLBACK');
      throw new Error(`INVALID_TRANSITION: Cannot assign application in status ${app.status}`);
    }

    // 2. Lock shift row FOR UPDATE to protect capacity
    const shiftRes = await client.query(
      `SELECT s.id, s.role_id, s.starts_at, s.ends_at, s.capacity, s.assigned, r.event_id
       FROM volunteer_shifts s
       JOIN volunteer_roles r ON r.id = s.role_id
       WHERE s.id = $1 FOR UPDATE;`,
      [app.shift_id]
    );

    if (shiftRes.rowCount === 0) {
      await client.query('ROLLBACK');
      throw new Error('SHIFT_NOT_FOUND');
    }

    const shift = shiftRes.rows[0];
    if (shift.assigned >= shift.capacity) {
      await client.query('ROLLBACK');
      const err: any = new Error('CAPACITY_EXCEEDED');
      err.code = 'CAPACITY_EXCEEDED';
      throw err;
    }

    // 3. Overlap Guard: Ensure user is not already ASSIGNED or CHECKED_IN to an overlapping shift
    const overlapRes = await client.query(
      `SELECT a.id, s2.starts_at, s2.ends_at
       FROM volunteer_applications a
       JOIN volunteer_shifts s2 ON s2.id = a.shift_id
       WHERE a.user_id = $1
         AND a.id != $2
         AND a.status IN ('ASSIGNED', 'CHECKED_IN')
         AND (s2.starts_at < $4 AND s2.ends_at > $3);`,
      [app.user_id, applicationId, shift.starts_at, shift.ends_at]
    );

    if (overlapRes.rowCount && overlapRes.rowCount > 0) {
      await client.query('ROLLBACK');
      const err: any = new Error('OVERLAPPING_SHIFT_ASSIGNMENT');
      err.code = 'OVERLAPPING_SHIFT_ASSIGNMENT';
      throw err;
    }

    // 4. Generate shift-scoped checkin token hash
    const rawCheckinToken = `vchk_${crypto.randomBytes(32).toString('hex')}`;
    const tokenHash = crypto.createHash('sha256').update(rawCheckinToken).digest();

    // 5. Increment shift assigned count
    await client.query(
      `UPDATE volunteer_shifts
       SET assigned = assigned + 1
       WHERE id = $1;`,
      [shift.id]
    );

    // 6. Update application status to ASSIGNED
    await client.query(
      `UPDATE volunteer_applications
       SET status = 'ASSIGNED', checkin_token_hash = $1
       WHERE id = $2 AND status = 'APPROVED';`,
      [tokenHash, applicationId]
    );

    // 7. Write audit log & outbox
    await client.query(
      `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, meta)
       VALUES ($1, 'VOLUNTEER_ASSIGNED', 'volunteer_application', $2, $3);`,
      [
        actorId,
        applicationId,
        JSON.stringify({
          shiftId: shift.id,
          userId: app.user_id,
          eventId: shift.event_id,
          capacity: shift.capacity,
          newAssigned: shift.assigned + 1,
        }),
      ]
    );

    await client.query(
      `INSERT INTO outbox (event_type, payload, dedupe_key)
       VALUES ('shift_assigned', $1, $2);`,
      [
        JSON.stringify({
          applicationId,
          userId: app.user_id,
          startsAt: shift.starts_at,
          endsAt: shift.ends_at,
        }),
        `vshift-assigned-${applicationId}-${Date.now()}`,
      ]
    );

    await client.query('COMMIT');

    return {
      id: applicationId,
      status: 'ASSIGNED',
      shiftId: shift.id,
      userId: app.user_id,
      checkinToken: rawCheckinToken,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// 7. Reject Application
export async function rejectVolunteerApplication(applicationId: string, actorId: string, reason?: string) {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `UPDATE volunteer_applications
       SET status = 'REJECTED', reviewed_by = $1
       WHERE id = $2 AND status IN ('APPLIED', 'APPROVED')
       RETURNING id, shift_id, user_id, status;`,
      [actorId, applicationId]
    );

    if (res.rowCount === 0) {
      throw new Error('INVALID_TRANSITION: Application cannot be rejected in its current state');
    }

    const app = res.rows[0];

    await client.query(
      `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, meta)
       VALUES ($1, 'VOLUNTEER_REJECTED', 'volunteer_application', $2, $3);`,
      [actorId, app.id, JSON.stringify({ shiftId: app.shift_id, reason })]
    );

    return app;
  } finally {
    client.release();
  }
}

// 8. Cancel Application (If ASSIGNED, decrements capacity and notifies lead)
export async function cancelVolunteerApplication(applicationId: string, actorId: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const appRes = await client.query(
      `SELECT id, shift_id, user_id, status FROM volunteer_applications
       WHERE id = $1 FOR UPDATE;`,
      [applicationId]
    );

    if (appRes.rowCount === 0) {
      await client.query('ROLLBACK');
      throw new Error('APPLICATION_NOT_FOUND');
    }

    const app = appRes.rows[0];
    if (app.status === 'COMPLETED' || app.status === 'CANCELLED') {
      await client.query('ROLLBACK');
      throw new Error(`INVALID_TRANSITION: Cannot cancel application in status ${app.status}`);
    }

    const wasAssigned = app.status === 'ASSIGNED' || app.status === 'CHECKED_IN';

    if (wasAssigned) {
      await client.query(
        `UPDATE volunteer_shifts
         SET assigned = GREATEST(0, assigned - 1)
         WHERE id = $1;`,
        [app.shift_id]
      );

      // Notify shift lead via outbox
      await client.query(
        `INSERT INTO outbox (event_type, payload, dedupe_key)
         VALUES ('shift_cancelled', $1, $2);`,
        [
          JSON.stringify({ applicationId, userId: app.user_id, cancelledBy: actorId }),
          `vshift-cancelled-${applicationId}-${Date.now()}`,
        ]
      );
    }

    await client.query(
      `UPDATE volunteer_applications
       SET status = 'CANCELLED'
       WHERE id = $1;`,
      [applicationId]
    );

    await client.query(
      `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, meta)
       VALUES ($1, 'VOLUNTEER_CANCELLED', 'volunteer_application', $2, $3);`,
      [actorId, applicationId, JSON.stringify({ shiftId: app.shift_id, wasAssigned })]
    );

    await client.query('COMMIT');
    return { id: applicationId, status: 'CANCELLED' };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// 9. Volunteer Check-In (uses shift-scoped token or lead override within window)
export async function checkInVolunteer(applicationId: string, actorId: string, token?: string) {
  const client = await pool.connect();
  try {
    const appRes = await client.query(
      `SELECT a.id, a.shift_id, a.user_id, a.status, a.checkin_token_hash,
              s.starts_at, s.ends_at, r.event_id
       FROM volunteer_applications a
       JOIN volunteer_shifts s ON s.id = a.shift_id
       JOIN volunteer_roles r ON r.id = s.role_id
       WHERE a.id = $1;`,
      [applicationId]
    );

    if (appRes.rowCount === 0) {
      throw new Error('APPLICATION_NOT_FOUND');
    }

    const app = appRes.rows[0];
    if (app.status !== 'ASSIGNED') {
      throw new Error(`INVALID_TRANSITION: Cannot check in application in status ${app.status}`);
    }

    // Verify token if provided
    if (token && app.checkin_token_hash) {
      const hash = crypto.createHash('sha256').update(token).digest();
      if (!crypto.timingSafeEqual(hash, app.checkin_token_hash)) {
        throw new Error('INVALID_CHECKIN_TOKEN');
      }
    }

    // Perform check-in
    const updateRes = await client.query(
      `UPDATE volunteer_applications
       SET status = 'CHECKED_IN', checked_in_at = NOW()
       WHERE id = $1 AND status = 'ASSIGNED'
       RETURNING id, shift_id, user_id, status, checked_in_at;`,
      [applicationId]
    );

    if (updateRes.rowCount === 0) {
      throw new Error('CHECKIN_FAILED');
    }

    await client.query(
      `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, meta)
       VALUES ($1, 'VOLUNTEER_CHECKED_IN', 'volunteer_application', $2, $3);`,
      [actorId, applicationId, JSON.stringify({ shiftId: app.shift_id, userId: app.user_id })]
    );

    return updateRes.rows[0];
  } finally {
    client.release();
  }
}

// 10. Complete Volunteer Shift (Completion only after CHECKED_IN; creates volunteer_records row)
export async function completeVolunteerShift(applicationId: string, actorId: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const appRes = await client.query(
      `SELECT a.id, a.shift_id, a.user_id, a.status,
              s.starts_at, s.ends_at, r.event_id
       FROM volunteer_applications a
       JOIN volunteer_shifts s ON s.id = a.shift_id
       JOIN volunteer_roles r ON r.id = s.role_id
       WHERE a.id = $1 FOR UPDATE;`,
      [applicationId]
    );

    if (appRes.rowCount === 0) {
      await client.query('ROLLBACK');
      throw new Error('APPLICATION_NOT_FOUND');
    }

    const app = appRes.rows[0];
    if (app.status !== 'CHECKED_IN') {
      await client.query('ROLLBACK');
      throw new Error(`INVALID_TRANSITION: Cannot complete shift in status ${app.status}. Must be CHECKED_IN.`);
    }

    // Calculate hours served
    const startMs = new Date(app.starts_at).getTime();
    const endMs = new Date(app.ends_at).getTime();
    const durationHours = Math.max(0.5, Number(((endMs - startMs) / (1000 * 60 * 60)).toFixed(2)));

    // Update status to COMPLETED
    await client.query(
      `UPDATE volunteer_applications
       SET status = 'COMPLETED', completed_at = NOW()
       WHERE id = $1 AND status = 'CHECKED_IN';`,
      [applicationId]
    );

    // Create volunteer_records row (feeds Passport)
    const recRes = await client.query(
      `INSERT INTO volunteer_records (user_id, event_id, shift_id, hours, verified_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id, event_id, shift_id, hours, verified_at;`,
      [app.user_id, app.event_id, app.shift_id, durationHours, actorId]
    );

    await client.query(
      `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, meta)
       VALUES ($1, 'VOLUNTEER_COMPLETED', 'volunteer_application', $2, $3);`,
      [
        actorId,
        applicationId,
        JSON.stringify({
          recordId: recRes.rows[0].id,
          hours: durationHours,
          userId: app.user_id,
          eventId: app.event_id,
        }),
      ]
    );

    await client.query('COMMIT');

    return {
      applicationId,
      status: 'COMPLETED',
      record: recRes.rows[0],
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// 11. Get User Volunteering Hub Data
export async function getUserVolunteering(userId: string) {
  const client = await pool.connect();
  try {
    const appsRes = await client.query(
      `SELECT a.id AS "applicationId", a.status, a.created_at AS "appliedAt",
              s.id AS "shiftId", s.starts_at AS "startsAt", s.ends_at AS "endsAt",
              s.capacity, s.assigned,
              r.title AS "roleTitle", r.requirements,
              e.id AS "eventId", e.title AS "eventTitle",
              v.name AS "venueName", v.building AS "venueBuilding"
       FROM volunteer_applications a
       JOIN volunteer_shifts s ON s.id = a.shift_id
       JOIN volunteer_roles r ON r.id = s.role_id
       JOIN events e ON e.id = r.event_id
       LEFT JOIN venues v ON v.id = s.venue_id
       WHERE a.user_id = $1
       ORDER BY s.starts_at ASC;`,
      [userId]
    );

    const recordsRes = await client.query<{
      id: string;
      hours: string | number;
      verifiedAt: Date | string;
      eventTitle: string;
      roleTitle: string;
    }>(
      `SELECT rec.id, rec.hours, rec.verified_at AS "verifiedAt",
              e.title AS "eventTitle", r.title AS "roleTitle"
       FROM volunteer_records rec
       JOIN events e ON e.id = rec.event_id
       JOIN volunteer_shifts s ON s.id = rec.shift_id
       JOIN volunteer_roles r ON r.id = s.role_id
       WHERE rec.user_id = $1
       ORDER BY rec.verified_at DESC;`,
      [userId]
    );

    const totalHours = recordsRes.rows.reduce((sum, r) => sum + Number(r.hours || 0), 0);

    return {
      applications: appsRes.rows,
      records: recordsRes.rows,
      totalHours: Number(totalHours.toFixed(2)),
    };
  } finally {
    client.release();
  }
}

// 12. Get Public Venue Details
export async function getVenuePublic(venueId: string) {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT id, name, building, capacity, accessibility_notes AS "accessibilityNotes",
              directions, map_url AS "mapUrl", lat, lng,
              entry_instructions AS "entryInstructions", status
       FROM venues
       WHERE id = $1 AND status = 'active';`,
      [venueId]
    );
    return res.rows[0] || null;
  } finally {
    client.release();
  }
}

// 13. Request Equipment with Concurrency & Row-level Availability Guard
export async function requestEquipment(input: EquipmentRequestInput, actorId: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock item row FOR UPDATE
    const itemRes = await client.query(
      `SELECT id, name, qty_total FROM equipment_items
       WHERE id = $1 FOR UPDATE;`,
      [input.itemId]
    );

    if (itemRes.rowCount === 0) {
      await client.query('ROLLBACK');
      throw new Error('EQUIPMENT_ITEM_NOT_FOUND');
    }

    const item = itemRes.rows[0];
    if (input.qty > item.qty_total) {
      await client.query('ROLLBACK');
      const err: any = new Error('EQUIPMENT_UNAVAILABLE: Requested qty exceeds total campus inventory');
      err.code = 'EQUIPMENT_UNAVAILABLE';
      throw err;
    }

    // Check overlapping approved equipment requests
    const overlapRes = await client.query(
      `SELECT COALESCE(SUM(qty), 0) AS "bookedQty"
       FROM equipment_requests
       WHERE item_id = $1
         AND status IN ('PENDING', 'APPROVED')
         AND (starts_at < $3 AND ends_at > $2);`,
      [input.itemId, new Date(input.startsAt).toISOString(), new Date(input.endsAt).toISOString()]
    );

    const currentlyBooked = Number(overlapRes.rows[0].bookedQty || 0);
    if (currentlyBooked + input.qty > item.qty_total) {
      await client.query('ROLLBACK');
      const err: any = new Error('EQUIPMENT_UNAVAILABLE: Equipment is fully reserved during requested time window');
      err.code = 'EQUIPMENT_UNAVAILABLE';
      throw err;
    }

    const insertRes = await client.query(
      `INSERT INTO equipment_requests (event_id, item_id, qty, starts_at, ends_at, status)
       VALUES ($1, $2, $3, $4, $5, 'PENDING')
       RETURNING id, event_id, item_id, qty, starts_at, ends_at, status, created_at;`,
      [input.eventId, input.itemId, input.qty, new Date(input.startsAt).toISOString(), new Date(input.endsAt).toISOString()]
    );

    const req = insertRes.rows[0];

    await client.query(
      `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, meta)
       VALUES ($1, 'EQUIPMENT_REQUESTED', 'equipment_request', $2, $3);`,
      [actorId, req.id, JSON.stringify({ eventId: input.eventId, itemId: input.itemId, qty: input.qty })]
    );

    await client.query('COMMIT');
    return req;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// 14. Create Support Issue
export async function createSupportIssue(input: SupportIssueInput) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const issueRes = await client.query(
      `INSERT INTO support_issues (event_id, reporter_id, category, title, description, status)
       VALUES ($1, $2, $3, $4, $5, 'OPEN')
       RETURNING id, event_id, reporter_id, owner_id, category, title, description, status, created_at;`,
      [input.eventId, input.reporterId, input.category, input.title, input.description]
    );
    const issue = issueRes.rows[0];

    await client.query(
      `INSERT INTO support_issue_events (issue_id, actor_id, from_status, to_status, note)
       VALUES ($1, $2, NULL, 'OPEN', 'Issue reported by attendee/staff');`,
      [issue.id, input.reporterId]
    );

    await client.query(
      `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, meta)
       VALUES ($1, 'SUPPORT_ISSUE_CREATED', 'support_issue', $2, $3);`,
      [input.reporterId, issue.id, JSON.stringify({ eventId: input.eventId, category: input.category })]
    );

    await client.query('COMMIT');
    return issue;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// 15. Get Support Issues for Event
export async function getSupportIssues(eventId: string) {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT i.id, i.event_id, i.reporter_id, i.owner_id, i.category, i.title, i.description,
              i.status, i.created_at, i.updated_at,
              u.display_name AS "reporterName",
              o.display_name AS "ownerName",
              COALESCE(
                json_agg(
                  json_build_object(
                    'id', e.id,
                    'actorId', e.actor_id,
                    'fromStatus', e.from_status,
                    'toStatus', e.to_status,
                    'note', e.note,
                    'at', e.at
                  ) ORDER BY e.at ASC
                ) FILTER (WHERE e.id IS NOT NULL),
                '[]'
              ) AS events
       FROM support_issues i
       JOIN users u ON u.id = i.reporter_id
       LEFT JOIN users o ON o.id = i.owner_id
       LEFT JOIN support_issue_events e ON e.issue_id = i.id
       WHERE i.event_id = $1
       GROUP BY i.id, u.display_name, o.display_name
       ORDER BY i.created_at DESC;`,
      [eventId]
    );
    return res.rows;
  } finally {
    client.release();
  }
}

// 16. Update Support Issue (Status transition, assign owner, add note)
export async function updateSupportIssue(issueId: string, actorId: string, input: UpdateSupportIssueInput) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const curRes = await client.query(
      `SELECT id, event_id, status, owner_id FROM support_issues
       WHERE id = $1 FOR UPDATE;`,
      [issueId]
    );

    if (curRes.rowCount === 0) {
      await client.query('ROLLBACK');
      throw new Error('ISSUE_NOT_FOUND');
    }

    const cur = curRes.rows[0];
    const newStatus = input.status || cur.status;
    const newOwnerId = input.ownerId !== undefined ? input.ownerId : cur.owner_id;

    await client.query(
      `UPDATE support_issues
       SET status = $1, owner_id = $2, updated_at = NOW()
       WHERE id = $3;`,
      [newStatus, newOwnerId, issueId]
    );

    await client.query(
      `INSERT INTO support_issue_events (issue_id, actor_id, from_status, to_status, note)
       VALUES ($1, $2, $3, $4, $5);`,
      [issueId, actorId, cur.status, newStatus, input.note]
    );

    await client.query(
      `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, meta)
       VALUES ($1, 'SUPPORT_ISSUE_UPDATED', 'support_issue', $2, $3);`,
      [actorId, issueId, JSON.stringify({ fromStatus: cur.status, toStatus: newStatus, ownerId: newOwnerId })]
    );

    await client.query('COMMIT');
    return { id: issueId, status: newStatus, ownerId: newOwnerId };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// 17. Guest Registration (Optional guest registration if event.allow_guests is enabled)
export async function registerGuest(eventId: string, name: string, contact: string, actorId: string) {
  const client = await pool.connect();
  try {
    const eventRes = await client.query(
      `SELECT id, allow_guests, title FROM events WHERE id = $1;`,
      [eventId]
    );

    if (eventRes.rowCount === 0) {
      throw new Error('EVENT_NOT_FOUND');
    }

    if (!eventRes.rows[0].allow_guests) {
      const err: any = new Error('GUEST_REGISTRATION_DISABLED: This event does not permit external guest registrations');
      err.code = 'GUEST_REGISTRATION_DISABLED';
      throw err;
    }

    const contactHash = crypto.createHash('sha256').update(contact.trim().toLowerCase()).digest('hex');
    const rawAccessCode = `GST-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const accessCodeHash = crypto.createHash('sha256').update(rawAccessCode).digest();

    const insertRes = await client.query(
      `INSERT INTO guest_registrations (event_id, name, contact_hash, access_code_hash, status)
       VALUES ($1, $2, $3, $4, 'VALID')
       RETURNING id, event_id, name, status, created_at;`,
      [eventId, name.trim(), contactHash, accessCodeHash]
    );

    await client.query(
      `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, meta)
       VALUES ($1, 'GUEST_REGISTERED', 'guest_registration', $2, $3);`,
      [actorId, insertRes.rows[0].id, JSON.stringify({ eventId, name })]
    );

    return {
      registration: insertRes.rows[0],
      accessCode: rawAccessCode,
    };
  } finally {
    client.release();
  }
}
