import { pool } from '../db/index.js';
import crypto from 'crypto';
import { BookingError } from './booking.js';

export class TeamError extends BookingError {}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isValidUuid(id: unknown): boolean {
  return typeof id === 'string' && UUID_REGEX.test(id);
}

export interface CreateTeamParams {
  name: string;
  description?: string;
  visibility?: 'private' | 'discoverable';
  maxSize?: number;
  userId: string;
  skillsOffered?: string[];
  skillsNeeded?: string[];
}

export interface InviteMemberParams {
  teamId: string;
  inviterId: string;
  inviteeId?: string;
  email?: string;
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

  if (!isValidUuid(userId)) {
    throw new TeamError('INVALID_ID', 'Invalid UUID identifier provided', 400);
  }

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
 * Fetches team details.
 * - Private team: non-members receive 404 (not 403) to prevent team enumeration.
 * - Members: NEVER returns member emails, passwords, or PII. Public teams show display name + role only.
 */
export async function getTeam(teamId: string, requesterUserId?: string) {
  if (!isValidUuid(teamId)) {
    throw new TeamError('INVALID_ID', 'Invalid UUID identifier provided', 400);
  }

  const client = await pool.connect();
  try {
    const teamRes = await client.query(`SELECT * FROM teams WHERE id = $1;`, [teamId]);
    if (teamRes.rows.length === 0) {
      throw new TeamError('TEAM_NOT_FOUND', 'Team not found', 404);
    }

    const team = teamRes.rows[0];

    // Fetch active members — strictly omit email or PII
    const membersRes = await client.query(
      `SELECT tm.user_id, tm.role, tm.status, tm.joined_at, u.display_name
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

    // Sanitize member objects: display name + role only (no emails or sensitive credentials)
    const sanitizedMembers = membersRes.rows.map((m) => ({
      userId: m.user_id,
      role: m.role,
      displayName: m.display_name,
      status: m.status,
      joinedAt: m.joined_at,
    }));

    return {
      team: {
        id: team.id,
        name: team.name,
        description: team.description,
        visibility: team.visibility,
        maxSize: team.max_size,
        status: team.status,
        createdBy: team.created_by,
        skillsOffered: team.skills_offered,
        skillsNeeded: team.skills_needed,
        createdAt: team.created_at,
        updatedAt: team.updated_at,
      },
      members: sanitizedMembers,
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
  if (!isValidUuid(teamId) || !isValidUuid(userId)) {
    throw new TeamError('INVALID_ID', 'Invalid UUID identifier provided', 400);
  }

  const client = await pool.connect();
  try {
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
 * Enforces named-invitee only: requires either inviteeId or email.
 */
export async function inviteMember(
  firstArg: string | InviteMemberParams,
  secondArg?: string,
  thirdArg?: string
) {
  let params: InviteMemberParams;
  if (typeof firstArg === 'object') {
    params = firstArg;
  } else {
    params = {
      teamId: firstArg,
      inviterId: secondArg!,
      inviteeId: thirdArg,
    };
  }

  const { teamId, inviterId, inviteeId, email } = params;

  if (!isValidUuid(teamId) || !isValidUuid(inviterId)) {
    throw new TeamError('INVALID_ID', 'Invalid UUID identifier provided', 400);
  }

  const client = await pool.connect();
  try {
    // 1. Verify inviter is active leader or co-leader
    const memberRes = await client.query(
      `SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2 AND status = 'ACTIVE';`,
      [teamId, inviterId]
    );

    if (memberRes.rows.length === 0 || !['leader', 'co_leader'].includes(memberRes.rows[0].role)) {
      throw new TeamError('FORBIDDEN', 'Only team leaders or co-leaders can invite members', 403);
    }

    // 2. Named-invitee enforcement: must specify either valid inviteeId or registered email
    let targetInviteeId: string;
    if (inviteeId && isValidUuid(inviteeId)) {
      const uRes = await client.query(`SELECT id FROM users WHERE id = $1;`, [inviteeId]);
      if (uRes.rows.length === 0) {
        throw new TeamError('USER_NOT_FOUND', 'Invited user not found', 404);
      }
      targetInviteeId = uRes.rows[0].id;
    } else if (email && email.trim()) {
      const uRes = await client.query(
        `SELECT id FROM users WHERE LOWER(email) = LOWER($1);`,
        [email.trim()]
      );
      if (uRes.rows.length === 0) {
        throw new TeamError('USER_NOT_FOUND', 'Invited user not found', 404);
      }
      targetInviteeId = uRes.rows[0].id;
    } else {
      throw new TeamError(
        'NAMED_INVITEE_REQUIRED',
        'Invitations must specify a named invitee (inviteeId or email)',
        400
      );
    }

    // 3. Verify target user is not already an active member of this team
    const existingMemRes = await client.query(
      `SELECT status FROM team_members WHERE team_id = $1 AND user_id = $2 AND status = 'ACTIVE';`,
      [teamId, targetInviteeId]
    );
    if (existingMemRes.rows.length > 0) {
      throw new TeamError('ALREADY_MEMBER', 'User is already an active member of this team', 409);
    }

    // 4. Generate cryptographically secure random token and SHA-256 hash
    const rawToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const invRes = await client.query(
      `INSERT INTO team_invitations (team_id, inviter_id, invitee_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, NOW() + INTERVAL '7 days')
       RETURNING *;`,
      [teamId, inviterId, targetInviteeId, tokenHash]
    );

    return {
      invitation: { ...invRes.rows[0], token: rawToken },
      invitationToken: rawToken,
    };
  } finally {
    client.release();
  }
}

/**
 * Accepts an invitation and adds user to team as ACTIVE member.
 * Enforces:
 * 1. Requires valid raw token matching stored token_hash.
 * 2. Checks token expiration.
 * 3. Enforces named-invitee only (rejects if invitation was addressed to a different user).
 * 4. Checks team capacity.
 */
export async function acceptInvitation(invitationId: string, userId: string, token?: string) {
  if (!isValidUuid(invitationId) || !isValidUuid(userId)) {
    throw new TeamError('INVALID_ID', 'Invalid UUID identifier provided', 400);
  }

  if (!token || typeof token !== 'string' || !token.trim()) {
    throw new TeamError('MISSING_INVITATION_TOKEN', 'Invitation token is required to accept team invitation', 400);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const invRes = await client.query(
      `SELECT * FROM team_invitations WHERE id = $1 FOR UPDATE;`,
      [invitationId]
    );

    if (invRes.rows.length === 0) {
      throw new TeamError('INVITATION_NOT_FOUND', 'Invitation not found', 404);
    }

    const inv = invRes.rows[0];

    // Status check
    if (inv.status !== 'PENDING') {
      throw new TeamError('INVITATION_INVALID', 'Invitation is no longer pending', 400);
    }

    // Expiry check
    if (new Date(inv.expires_at) <= new Date()) {
      await client.query(`UPDATE team_invitations SET status = 'EXPIRED' WHERE id = $1;`, [invitationId]);
      throw new TeamError('INVITATION_EXPIRED', 'Invitation has expired', 400);
    }

    // Token verification
    const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');
    if (inv.token_hash !== tokenHash) {
      throw new TeamError('INVITATION_INVALID', 'Invalid invitation token', 400);
    }

    // Named-invitee verification
    if (!inv.invitee_id || inv.invitee_id !== userId) {
      throw new TeamError('NAMED_INVITEE_MISMATCH', 'This invitation was addressed to a different user', 403);
    }

    // Check team capacity
    const teamRes = await client.query(
      `SELECT max_size FROM teams WHERE id = $1 FOR UPDATE;`,
      [inv.team_id]
    );
    if (teamRes.rows.length === 0) {
      throw new TeamError('TEAM_NOT_FOUND', 'Team not found', 404);
    }
    const maxSize = teamRes.rows[0].max_size;

    const countRes = await client.query(
      `SELECT COUNT(*)::int as count
       FROM team_members
       WHERE team_id = $1 AND status = 'ACTIVE';`,
      [inv.team_id]
    );

    if (countRes.rows[0].count >= maxSize) {
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
 * Eventora Team Seat & Registration Model:
 * -------------------------------------------------------------
 * In Eventora hackathons and team competitions, the capacity on ticket_types
 * represents TEAM SLOTS (i.e., 1 registration unit per competing team).
 *
 * 1. SEAT ALLOCATION:
 *    - Registering a team decrements available capacity by 1 unit on the ticket tier.
 *    - For FREE tiers (price_paise === 0):
 *        `sold` is incremented by 1, and the booking is immediately CONFIRMED.
 *    - For PAID tiers (price_paise > 0):
 *        `held` is incremented by 1 (15-minute hold window for payment completion).
 *        The booking is created in PENDING_PAYMENT status and linked to the team_event_registrations row.
 *        Payment confirmation (via YouPI webhook or verification poll) converts held -> sold.
 *
 * 2. MEMBERSHIP & ROSTER INTEGRITY:
 *    - The active member count must satisfy event bounds: [team_min, team_max].
 *    - Every active member is verified inside the transaction: no member may already
 *      hold an active booking (CONFIRMED or PENDING_PAYMENT) or be enrolled in another
 *      registered team for the same event.
 *    - An immutable `member_snapshot` is stored at registration time containing
 *      sanitized member records (userId, role, displayName, joinedAt).
 */
export async function registerTeamForEvent(params: RegisterTeamParams) {
  const { teamId, eventId, requesterId, ticketTypeId, idempotencyKey } = params;

  if (!isValidUuid(teamId) || !isValidUuid(eventId) || !isValidUuid(requesterId) || !isValidUuid(ticketTypeId)) {
    throw new TeamError('INVALID_ID', 'Invalid UUID identifier provided', 400);
  }

  if (!idempotencyKey || !idempotencyKey.trim()) {
    throw new TeamError('MISSING_IDEMPOTENCY_KEY', 'Header "Idempotency-Key" is required for team registration', 400);
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 0. Idempotency check: replay original response if already registered with this key
    const idemRes = await client.query(
      `SELECT b.*, ter.id as reg_id, ter.member_snapshot, ter.status as reg_status
       FROM bookings b
       JOIN team_event_registrations ter ON b.team_registration_id = ter.id
       WHERE b.idempotency_key = $1 AND b.user_id = $2;`,
      [idempotencyKey.trim(), requesterId]
    );

    if (idemRes.rows.length > 0) {
      await client.query('COMMIT');
      const b = idemRes.rows[0];
      return {
        registration: {
          id: b.reg_id,
          teamId,
          eventId,
          status: b.reg_status,
          bookingId: b.id,
        },
        booking: b,
        memberSnapshot: b.member_snapshot,
        checkoutRequired: b.status === 'PENDING_PAYMENT',
        requiresPayment: b.status === 'PENDING_PAYMENT',
        idempotentReplay: true,
      };
    }

    // 1. Lock team row
    const teamRes = await client.query(
      `SELECT * FROM teams WHERE id = $1 FOR UPDATE;`,
      [teamId]
    );
    if (teamRes.rows.length === 0) {
      throw new TeamError('TEAM_NOT_FOUND', 'Team not found', 404);
    }

    // 2. Verify requester leadership
    const reqMemberRes = await client.query(
      `SELECT role, status FROM team_members WHERE team_id = $1 AND user_id = $2 FOR UPDATE;`,
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
    if (event.team_mode === 'none') {
      throw new TeamError('TEAM_REGISTRATION_NOT_ALLOWED', 'This event does not allow team registrations', 400);
    }

    const now = new Date();
    if (event.registration_opens_at && now < new Date(event.registration_opens_at)) {
      throw new TeamError('REGISTRATION_NOT_OPEN', 'Event registration has not opened yet', 400);
    }
    if (event.registration_closes_at && now > new Date(event.registration_closes_at)) {
      throw new TeamError('REGISTRATION_CLOSED', 'Event registration has closed', 400);
    }

    // 4. Fetch active team members
    const membersRes = await client.query(
      `SELECT tm.user_id, tm.role, tm.joined_at, u.display_name
       FROM team_members tm
       JOIN users u ON tm.user_id = u.id
       WHERE tm.team_id = $1 AND tm.status = 'ACTIVE'
       ORDER BY tm.joined_at ASC;`,
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

    // 5. Per-member duplicate-booking check
    const memberIds = activeMembers.map((m) => m.user_id);

    // 5a. Check active solo bookings for any member
    const soloBookingCheck = await client.query(
      `SELECT b.user_id, u.display_name
       FROM bookings b
       JOIN users u ON b.user_id = u.id
       WHERE b.event_id = $1
         AND b.status IN ('CONFIRMED', 'PENDING_PAYMENT')
         AND b.user_id = ANY($2::uuid[]);`,
      [eventId, memberIds]
    );
    if (soloBookingCheck.rows.length > 0) {
      const already = soloBookingCheck.rows[0];
      throw new TeamError(
        'MEMBER_ALREADY_REGISTERED',
        `Member ${already.display_name} is already registered for this event`,
        409
      );
    }

    // 5b. Check other teams registered for this event
    const otherTeamsRegRes = await client.query(
      `SELECT ter.id, ter.team_id, ter.member_snapshot
       FROM team_event_registrations ter
       WHERE ter.event_id = $1
         AND ter.status IN ('registered', 'pending_payment')
         AND ter.team_id != $2;`,
      [eventId, teamId]
    );
    for (const otherReg of otherTeamsRegRes.rows) {
      const snap = Array.isArray(otherReg.member_snapshot) ? otherReg.member_snapshot : [];
      for (const m of activeMembers) {
        if (snap.some((s: any) => (s.user_id || s.userId) === m.user_id)) {
          throw new TeamError(
            'MEMBER_ALREADY_REGISTERED',
            `Member ${m.display_name} is already registered for this event in another team`,
            409
          );
        }
      }
    }

    // 6. Check existing team registration for this event
    const existingTeamReg = await client.query(
      `SELECT id FROM team_event_registrations WHERE team_id = $1 AND event_id = $2 AND status IN ('registered', 'pending_payment');`,
      [teamId, eventId]
    );
    if (existingTeamReg.rows.length > 0) {
      throw new TeamError('TEAM_ALREADY_REGISTERED', 'This team is already registered for this event', 409);
    }

    // 7. Lock ticket_types row and verify capacity (1 team slot = 1 booking unit)
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
    const available = tt.capacity - (tt.sold + tt.held);
    if (available < 1) {
      throw new TeamError('SOLD_OUT', 'Event capacity reached for this tier', 409, { waitlistAvailable: true });
    }

    // 8. Sanitized member snapshot (no emails, no credentials)
    const sanitizedSnapshot = activeMembers.map((m) => ({
      userId: m.user_id,
      user_id: m.user_id,
      role: m.role,
      displayName: m.display_name,
      display_name: m.display_name,
      joinedAt: m.joined_at,
      joined_at: m.joined_at,
    }));
    const memberSnapshotJson = JSON.stringify(sanitizedSnapshot);

    // 9. Branch Paid vs Free
    if (tt.price_paise > 0) {
      // Reserve seat in held
      await client.query(`UPDATE ticket_types SET held = held + 1 WHERE id = $1;`, [ticketTypeId]);

      // Insert booking in PENDING_PAYMENT status with 15-minute hold expiration
      const bookingRes = await client.query(
        `INSERT INTO bookings (
           user_id, event_id, status, total_paise, idempotency_key, expires_at
         ) VALUES ($1, $2, 'PENDING_PAYMENT', $3, $4, NOW() + INTERVAL '15 minutes')
         RETURNING *;`,
        [requesterId, eventId, tt.price_paise, idempotencyKey.trim()]
      );
      const booking = bookingRes.rows[0];

      // Insert team event registration in pending_payment status
      const regRes = await client.query(
        `INSERT INTO team_event_registrations (
           team_id, event_id, status, member_snapshot, booking_id
         ) VALUES ($1, $2, 'pending_payment', $3, $4)
         RETURNING *;`,
        [teamId, eventId, memberSnapshotJson, booking.id]
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

      await client.query(
        `INSERT INTO outbox (event_type, payload, dedupe_key)
         VALUES ($1, $2, $3);`,
        [
          'team.pending_payment',
          JSON.stringify({
            teamId,
            eventId,
            teamRegistrationId: registration.id,
            bookingId: booking.id,
            amountPaise: tt.price_paise,
          }),
          `team-reg-${registration.id}`,
        ]
      );

      await client.query('COMMIT');

      return {
        registration,
        booking,
        teamRegistrationId: registration.id,
        bookingId: booking.id,
        status: registration.status,
        totalPaise: Number(booking.total_paise),
        memberSnapshot: sanitizedSnapshot,
        checkoutRequired: true,
        requiresPayment: true,
      };
    } else {
      // Free registration: direct confirmation
      await client.query(`UPDATE ticket_types SET sold = sold + 1 WHERE id = $1;`, [ticketTypeId]);

      const bookingRes = await client.query(
        `INSERT INTO bookings (
           user_id, event_id, status, total_paise, idempotency_key
         ) VALUES ($1, $2, 'CONFIRMED', 0, $3)
         RETURNING *;`,
        [requesterId, eventId, idempotencyKey.trim()]
      );
      const booking = bookingRes.rows[0];

      const regRes = await client.query(
        `INSERT INTO team_event_registrations (
           team_id, event_id, status, member_snapshot, booking_id
         ) VALUES ($1, $2, 'registered', $3, $4)
         RETURNING *;`,
        [teamId, eventId, memberSnapshotJson, booking.id]
      );
      const registration = regRes.rows[0];

      await client.query(
        `UPDATE bookings SET team_registration_id = $1 WHERE id = $2;`,
        [registration.id, booking.id]
      );

      await client.query(
        `INSERT INTO booking_items (booking_id, ticket_type_id, quantity, unit_price_paise)
         VALUES ($1, $2, 1, 0);`,
        [booking.id, tt.id]
      );

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
        teamRegistrationId: registration.id,
        bookingId: booking.id,
        status: registration.status,
        totalPaise: 0,
        memberSnapshot: sanitizedSnapshot,
        checkoutRequired: false,
        requiresPayment: false,
      };
    }
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

  if (!isValidUuid(teamRegistrationId) || !isValidUuid(userId)) {
    throw new TeamError('INVALID_ID', 'Invalid UUID identifier provided', 400);
  }

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
 * Atomically transfers team leadership from current leader to an active team member.
 * Row-locks team and members to prevent concurrent race conditions.
 */
export async function transferLeadership(teamId: string, currentLeaderId: string, targetUserId: string) {
  if (!isValidUuid(teamId) || !isValidUuid(currentLeaderId) || !isValidUuid(targetUserId)) {
    throw new TeamError('INVALID_ID', 'Invalid UUID identifier provided', 400);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock team row
    const teamRes = await client.query(`SELECT id FROM teams WHERE id = $1 FOR UPDATE;`, [teamId]);
    if (teamRes.rows.length === 0) {
      throw new TeamError('TEAM_NOT_FOUND', 'Team not found', 404);
    }

    // Lock current leader row
    const leadCheck = await client.query(
      `SELECT role, status FROM team_members WHERE team_id = $1 AND user_id = $2 FOR UPDATE;`,
      [teamId, currentLeaderId]
    );
    if (leadCheck.rows.length === 0 || leadCheck.rows[0].role !== 'leader' || leadCheck.rows[0].status !== 'ACTIVE') {
      throw new TeamError('FORBIDDEN', 'Only current active leader can transfer leadership', 403);
    }

    // Lock target member row
    const targetCheck = await client.query(
      `SELECT role, status FROM team_members WHERE team_id = $1 AND user_id = $2 FOR UPDATE;`,
      [teamId, targetUserId]
    );
    if (targetCheck.rows.length === 0 || targetCheck.rows[0].status !== 'ACTIVE') {
      throw new TeamError('MEMBER_NOT_FOUND', 'Target user is not an active team member', 404);
    }

    // Atomic leadership swap
    await client.query(`UPDATE team_members SET role = 'member' WHERE team_id = $1 AND user_id = $2;`, [teamId, currentLeaderId]);
    await client.query(`UPDATE team_members SET role = 'leader' WHERE team_id = $1 AND user_id = $2;`, [teamId, targetUserId]);

    await client.query('COMMIT');
    return { success: true, newLeaderId: targetUserId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Removes an active user from a team within an atomic transaction.
 * - If last leader leaves:
 *     - If other members exist: atomically auto-promotes designated successor or oldest active member.
 *     - If no other members remain: archives the team.
 * - Row locks team and members to guarantee no race condition leaves a team leaderless.
 */
export async function leaveTeam(teamId: string, userId: string, successorUserId?: string) {
  if (!isValidUuid(teamId) || !isValidUuid(userId)) {
    throw new TeamError('INVALID_ID', 'Invalid UUID identifier provided', 400);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Lock team row
    const teamRes = await client.query(`SELECT id, status FROM teams WHERE id = $1 FOR UPDATE;`, [teamId]);
    if (teamRes.rows.length === 0) {
      throw new TeamError('TEAM_NOT_FOUND', 'Team not found', 404);
    }

    // 2. Lock leaving member row
    const memRes = await client.query(
      `SELECT role, status FROM team_members WHERE team_id = $1 AND user_id = $2 FOR UPDATE;`,
      [teamId, userId]
    );
    if (memRes.rows.length === 0 || memRes.rows[0].status !== 'ACTIVE') {
      throw new TeamError('NOT_A_MEMBER', 'User is not an active member of this team', 400);
    }

    const isLeader = memRes.rows[0].role === 'leader';

    // 3. Lock all other active members in the team
    const otherMembersRes = await client.query<{ user_id: string; role: string; joined_at: string }>(
      `SELECT user_id, role, joined_at
       FROM team_members
       WHERE team_id = $1 AND user_id != $2 AND status = 'ACTIVE'
       ORDER BY joined_at ASC
       FOR UPDATE;`,
      [teamId, userId]
    );

    const otherMembers = otherMembersRes.rows;
    let newLeaderId: string | null = null;

    // First mark leaving member as REMOVED (and demote role to member to clear active leader constraint)
    await client.query(
      `UPDATE team_members SET status = 'REMOVED', role = 'member' WHERE team_id = $1 AND user_id = $2;`,
      [teamId, userId]
    );

    if (otherMembers.length === 0) {
      // Last member of team leaving: archive team
      await client.query(`UPDATE teams SET status = 'archived' WHERE id = $1;`, [teamId]);
    } else if (isLeader) {
      // Leader leaving: atomically promote successor
      if (successorUserId) {
        const found = otherMembers.find((m) => m.user_id === successorUserId);
        if (!found) {
          throw new TeamError('INVALID_SUCCESSOR', 'Designated successor is not an active team member', 400);
        }
        newLeaderId = successorUserId;
      } else {
        const nextLeader = otherMembers.find((m) => m.role === 'co_leader') || otherMembers[0];
        newLeaderId = nextLeader.user_id;
      }
      await client.query(`UPDATE team_members SET role = 'leader' WHERE team_id = $1 AND user_id = $2;`, [teamId, newLeaderId]);
    }

    await client.query('COMMIT');
    return {
      success: true,
      archived: otherMembers.length === 0,
      teamArchived: otherMembers.length === 0,
      newLeaderId,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
