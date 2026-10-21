import { pool } from '../db/index.js';
import crypto from 'crypto';
import { BookingError } from './booking.js';

export class TeamError extends BookingError {}

export interface CreateTeamParams {
  name: string;
  description?: string;
  visibility?: 'private' | 'discoverable';
  maxSize?: number;
  userId: string;
  skillsOffered?: string[];
  skillsNeeded?: string[];
}

export interface RegisterTeamParams {
  teamId: string;
  eventId: string;
  requesterId: string;
  ticketTypeId: string;
  idempotencyKey: string;
}

export interface SubmitProjectParams {
  teamRegistrationId: string;
  userId: string;
  title: string;
  abstract: string;
  repoUrl?: string;
  demoUrl?: string;
}

/**
 * Creates a student competition/hackathon team and makes the creator the initial ACTIVE leader.
 */
export async function createTeam(params: CreateTeamParams) {
  const { name, description, visibility = 'private', maxSize = 4, userId, skillsOffered = [], skillsNeeded = [] } = params;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const teamRes = await client.query(
      `INSERT INTO teams (
         name, description, visibility, max_size, status, created_by, skills_offered, skills_needed
       ) VALUES ($1, $2, $3, $4, 'active', $5, $6, $7)
       RETURNING *;`,
      [name, description || null, visibility, maxSize, userId, skillsOffered, skillsNeeded]
    );

    const team = teamRes.rows[0];

    // Insert creator as active leader
    await client.query(
      `INSERT INTO team_members (team_id, user_id, role, status)
       VALUES ($1, $2, 'leader', 'ACTIVE');`,
      [team.id, userId]
    );

    await client.query('COMMIT');

    return {
      team,
      role: 'leader',
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Fetches team details. If private, non-members receive 404 (not 403) as required by specification.
 */
export async function getTeam(teamId: string, requesterUserId?: string) {
  const client = await pool.connect();
  try {
    const teamRes = await client.query(`SELECT * FROM teams WHERE id = $1;`, [teamId]);
    if (teamRes.rows.length === 0) {
      throw new TeamError('TEAM_NOT_FOUND', 'Team not found', 404);
    }

    const team = teamRes.rows[0];

    // Fetch active members
    const membersRes = await client.query(
      `SELECT tm.user_id, tm.role, tm.status, tm.joined_at, u.display_name, u.email
       FROM team_members tm
       JOIN users u ON tm.user_id = u.id
       WHERE tm.team_id = $1 AND tm.status = 'ACTIVE'
       ORDER BY tm.joined_at ASC;`,
      [teamId]
    );

    const isMember = requesterUserId && membersRes.rows.some((m) => m.user_id === requesterUserId);

    // Private team non-member guard: return 404
    if (team.visibility === 'private' && !isMember) {
      throw new TeamError('TEAM_NOT_FOUND', 'Team not found', 404);
    }

    return {
      team,
      members: membersRes.rows,
      isMember: !!isMember,
    };
  } finally {
    client.release();
  }
}

/**
 * Updates team settings (allowed by leader or co_leader).
 */
export async function updateTeam(teamId: string, userId: string, data: { name?: string; description?: string; visibility?: 'private' | 'discoverable'; maxSize?: number }) {
  const client = await pool.connect();
  try {
    // Verify leader / co_leader
    const memberRes = await client.query(
      `SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2 AND status = 'ACTIVE';`,
      [teamId, userId]
    );

    if (memberRes.rows.length === 0 || !['leader', 'co_leader'].includes(memberRes.rows[0].role)) {
      throw new TeamError('FORBIDDEN', 'Only team leaders or co-leaders can update team profile', 403);
    }

    const updates: string[] = [];
    const values: any[] = [teamId];
    let idx = 2;

    if (data.name !== undefined) {
      updates.push(`name = $${idx++}`);
      values.push(data.name);
    }
    if (data.description !== undefined) {
      updates.push(`description = $${idx++}`);
      values.push(data.description);
    }
    if (data.visibility !== undefined) {
      updates.push(`visibility = $${idx++}`);
      values.push(data.visibility);
    }
    if (data.maxSize !== undefined) {
      updates.push(`max_size = $${idx++}`);
      values.push(data.maxSize);
    }

    updates.push(`updated_at = NOW()`);

    const updateRes = await client.query(
      `UPDATE teams SET ${updates.join(', ')} WHERE id = $1 RETURNING *;`,
      values
    );

    return updateRes.rows[0];
  } finally {
    client.release();
  }
}

/**
 * Creates an expiring invitation to join the team.
 */
export async function inviteMember(teamId: string, inviterId: string, inviteeId?: string) {
  const client = await pool.connect();
  try {
    const memberRes = await client.query(
      `SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2 AND status = 'ACTIVE';`,
      [teamId, inviterId]
    );

    if (memberRes.rows.length === 0 || !['leader', 'co_leader'].includes(memberRes.rows[0].role)) {
      throw new TeamError('FORBIDDEN', 'Only team leaders or co-leaders can invite members', 403);
    }

    const rawToken = crypto.randomBytes(24).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const invRes = await client.query(
      `INSERT INTO team_invitations (team_id, inviter_id, invitee_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, NOW() + INTERVAL '7 days')
       RETURNING *;`,
      [teamId, inviterId, inviteeId || null, tokenHash]
    );

    return {
      invitation: invRes.rows[0],
      invitationToken: rawToken,
    };
  } finally {
    client.release();
  }
}

/**
 * Accepts an invitation and adds user to team as ACTIVE member.
 */
export async function acceptInvitation(invitationId: string, userId: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const invRes = await client.query(
      `SELECT * FROM team_invitations WHERE id = $1 AND status = 'PENDING' AND expires_at > NOW() FOR UPDATE;`,
      [invitationId]
    );

    if (invRes.rows.length === 0) {
      throw new TeamError('INVITATION_INVALID', 'Invitation is invalid or has expired', 400);
    }

    const inv = invRes.rows[0];
    if (inv.invitee_id && inv.invitee_id !== userId) {
      throw new TeamError('FORBIDDEN', 'This invitation was addressed to a different user', 403);
    }

    // Check team capacity
    const countRes = await client.query(
      `SELECT COUNT(*)::int as count, t.max_size
       FROM team_members tm
       JOIN teams t ON tm.team_id = t.id
       WHERE tm.team_id = $1 AND tm.status = 'ACTIVE'
       GROUP BY t.max_size;`,
      [inv.team_id]
    );

    if (countRes.rows.length > 0 && countRes.rows[0].count >= countRes.rows[0].max_size) {
      throw new TeamError('TEAM_FULL', 'Team has reached its maximum size limit', 409);
    }

    // Insert or update member
    await client.query(
      `INSERT INTO team_members (team_id, user_id, role, status)
       VALUES ($1, $2, 'member', 'ACTIVE')
       ON CONFLICT (team_id, user_id)
       DO UPDATE SET status = 'ACTIVE', role = 'member', joined_at = NOW();`,
      [inv.team_id, userId]
    );

    await client.query(
      `UPDATE team_invitations SET status = 'ACCEPTED' WHERE id = $1;`,
      [invitationId]
    );

    await client.query('COMMIT');

    return { success: true, teamId: inv.team_id };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Registers an entire team for an event within an atomic transaction.
 * Enforces:
 * 1. Requester must be ACTIVE leader or co_leader.
 * 2. Active member count must satisfy event [team_min, team_max].
 * 3. None of the active members may already be registered for the event.
 * 4. Free flow creates CONFIRMED booking and takes an immutable member_snapshot.
 */
export async function registerTeamForEvent(params: RegisterTeamParams) {
  const { teamId, eventId, requesterId, ticketTypeId, idempotencyKey } = params;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Lock team row
    const teamRes = await client.query(
      `SELECT * FROM teams WHERE id = $1 FOR UPDATE;`,
      [teamId]
    );
    if (teamRes.rows.length === 0) {
      throw new TeamError('TEAM_NOT_FOUND', 'Team not found', 404);
    }
    const team = teamRes.rows[0];

    // 2. Verify requester leadership
    const reqMemberRes = await client.query(
      `SELECT role, status FROM team_members WHERE team_id = $1 AND user_id = $2;`,
      [teamId, requesterId]
    );
    if (
      reqMemberRes.rows.length === 0 ||
      reqMemberRes.rows[0].status !== 'ACTIVE' ||
      !['leader', 'co_leader'].includes(reqMemberRes.rows[0].role)
    ) {
      throw new TeamError('FORBIDDEN', 'Only active team leaders or co-leaders can register the team for an event', 403);
    }

    // 3. Verify event
    const eventRes = await client.query(
      `SELECT id, title, status, team_mode, team_min, team_max, registration_opens_at, registration_closes_at
       FROM events WHERE id = $1 FOR SHARE;`,
      [eventId]
    );
    if (eventRes.rows.length === 0) {
      throw new TeamError('EVENT_NOT_FOUND', 'Event not found', 404);
    }
    const event = eventRes.rows[0];
    if (event.status !== 'published') {
      throw new TeamError('EVENT_NOT_PUBLISHED', 'Registrations are only open for published events', 400);
    }

    // 4. Fetch active team members
    const membersRes = await client.query(
      `SELECT tm.user_id, tm.role, u.display_name, u.email
       FROM team_members tm
       JOIN users u ON tm.user_id = u.id
       WHERE tm.team_id = $1 AND tm.status = 'ACTIVE';`,
      [teamId]
    );

    const activeMembers = membersRes.rows;
    const memberCount = activeMembers.length;
    const minMembers = event.team_min || 1;
    const maxMembers = event.team_max || 10;

    if (memberCount < minMembers) {
      throw new TeamError(
        'TEAM_TOO_SMALL',
        `Team has ${memberCount} members, but event requires at least ${minMembers}`,
        400
      );
    }
    if (memberCount > maxMembers) {
      throw new TeamError(
        'TEAM_TOO_LARGE',
        `Team has ${memberCount} members, but event allows at most ${maxMembers}`,
        400
      );
    }

    // 5. Verify no member is already registered for this event
    const memberIds = activeMembers.map((m) => m.user_id);
    const registeredCheck = await client.query(
      `SELECT b.user_id, u.display_name
       FROM bookings b
       JOIN users u ON b.user_id = u.id
       WHERE b.event_id = $1 AND b.status = 'CONFIRMED' AND b.user_id = ANY($2::uuid[]);`,
      [eventId, memberIds]
    );

    if (registeredCheck.rows.length > 0) {
      const already = registeredCheck.rows[0];
      throw new TeamError(
        'MEMBER_ALREADY_REGISTERED',
        `Member ${already.display_name} is already registered for this event`,
        409
      );
    }

    // 6. Check existing team registration for this event
    const existingTeamReg = await client.query(
      `SELECT id FROM team_event_registrations WHERE team_id = $1 AND event_id = $2;`,
      [teamId, eventId]
    );
    if (existingTeamReg.rows.length > 0) {
      throw new TeamError('TEAM_ALREADY_REGISTERED', 'This team is already registered for this event', 409);
    }

    // 7. Lock ticket_types row and verify capacity
    const ttRes = await client.query(
      `SELECT id, capacity, sold, held, price_paise
       FROM ticket_types
       WHERE id = $1 AND event_id = $2
       FOR UPDATE;`,
      [ticketTypeId, eventId]
    );

    if (ttRes.rows.length === 0) {
      throw new TeamError('TICKET_TYPE_NOT_FOUND', 'Ticket tier not found', 404);
    }

    const tt = ttRes.rows[0];
    if (tt.sold + tt.held + 1 > tt.capacity) {
      throw new TeamError('SOLD_OUT', 'Event capacity reached for this tier', 409, { waitlistAvailable: true });
    }

    // Increment sold seats by 1 team booking
    await client.query(
      `UPDATE ticket_types SET sold = sold + 1 WHERE id = $1;`,
      [ticketTypeId]
    );

    // 8. Immutable snapshot of active members at registration time
    const memberSnapshot = JSON.stringify(activeMembers);

    // 9. Insert Booking
    const bookingRes = await client.query(
      `INSERT INTO bookings (
         user_id, event_id, status, total_paise, idempotency_key
       ) VALUES ($1, $2, 'CONFIRMED', $3, $4)
       RETURNING *;`,
      [requesterId, eventId, tt.price_paise, idempotencyKey]
    );
    const booking = bookingRes.rows[0];

    // 10. Insert Team Event Registration
    const regRes = await client.query(
      `INSERT INTO team_event_registrations (
         team_id, event_id, status, member_snapshot, booking_id
       ) VALUES ($1, $2, 'registered', $3, $4)
       RETURNING *;`,
      [teamId, eventId, memberSnapshot, booking.id]
    );
    const registration = regRes.rows[0];

    // Link booking to team registration
    await client.query(
      `UPDATE bookings SET team_registration_id = $1 WHERE id = $2;`,
      [registration.id, booking.id]
    );

    // Insert booking item
    await client.query(
      `INSERT INTO booking_items (booking_id, ticket_type_id, quantity, unit_price_paise)
       VALUES ($1, $2, 1, $3);`,
      [booking.id, tt.id, tt.price_paise]
    );

    // Write outbox
    await client.query(
      `INSERT INTO outbox (event_type, payload, dedupe_key)
       VALUES ($1, $2, $3);`,
      [
        'team.registered',
        JSON.stringify({
          teamId,
          eventId,
          teamRegistrationId: registration.id,
          memberCount,
        }),
        `team-reg-${registration.id}`,
      ]
    );

    await client.query('COMMIT');

    return {
      registration,
      booking,
      memberSnapshot: activeMembers,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Submits or updates a team hackathon / competition project.
 * Membership edits and project modifications are locked if past deadline.
 */
export async function submitProject(params: SubmitProjectParams) {
  const { teamRegistrationId, userId, title, abstract, repoUrl, demoUrl } = params;
  const client = await pool.connect();

  try {
    const regRes = await client.query(
      `SELECT r.id, r.team_id, r.event_id, s.locked_at
       FROM team_event_registrations r
       LEFT JOIN team_submissions s ON r.id = s.team_registration_id
       WHERE r.id = $1;`,
      [teamRegistrationId]
    );

    if (regRes.rows.length === 0) {
      throw new TeamError('REGISTRATION_NOT_FOUND', 'Team event registration not found', 404);
    }

    const reg = regRes.rows[0];

    // Check membership
    const memberRes = await client.query(
      `SELECT status FROM team_members WHERE team_id = $1 AND user_id = $2 AND status = 'ACTIVE';`,
      [reg.team_id, userId]
    );
    if (memberRes.rows.length === 0) {
      throw new TeamError('FORBIDDEN', 'Only active team members can submit project deliverables', 403);
    }

    if (reg.locked_at && new Date(reg.locked_at) <= new Date()) {
      throw new TeamError('TEAM_LOCKED', 'Project submission deadline has passed and entries are locked', 409);
    }

    const subRes = await client.query(
      `INSERT INTO team_submissions (
         team_registration_id, title, abstract, repo_url, demo_url
       ) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING
       RETURNING *;`,
      [teamRegistrationId, title, abstract, repoUrl || null, demoUrl || null]
    );

    return subRes.rows[0];
  } finally {
    client.release();
  }
}

/**
 * Removes an active user from a team.
 * If leader leaves, auto-promotes oldest active member.
 * If last member leaves, archives team.
 */
export async function leaveTeam(teamId: string, userId: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const memRes = await client.query(
      `SELECT role, status FROM team_members WHERE team_id = $1 AND user_id = $2 AND status = 'ACTIVE';`,
      [teamId, userId]
    );
    if (memRes.rows.length === 0) {
      throw new TeamError('NOT_A_MEMBER', 'User is not an active member of this team', 400);
    }

    const isLeader = memRes.rows[0].role === 'leader';
    const otherMembersRes = await client.query(
      `SELECT user_id, role FROM team_members WHERE team_id = $1 AND user_id != $2 AND status = 'ACTIVE' ORDER BY joined_at ASC;`,
      [teamId, userId]
    );

    if (otherMembersRes.rows.length === 0) {
      await client.query(`UPDATE teams SET status = 'archived' WHERE id = $1;`, [teamId]);
    } else if (isLeader) {
      const nextLeader = otherMembersRes.rows.find((m) => m.role === 'co_leader') || otherMembersRes.rows[0];
      await client.query(`UPDATE team_members SET role = 'leader' WHERE team_id = $1 AND user_id = $2;`, [teamId, nextLeader.user_id]);
    }

    await client.query(`UPDATE team_members SET status = 'REMOVED' WHERE team_id = $1 AND user_id = $2;`, [teamId, userId]);

    await client.query('COMMIT');
    return { success: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

