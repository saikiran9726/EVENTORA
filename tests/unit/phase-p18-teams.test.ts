import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { pool } from '../../packages/backend/src/db/index.js';
import { buildApp } from '../../packages/backend/src/app.js';
import {
  createTeam,
  inviteMember,
  transferLeadership,
  leaveTeam,
  registerTeamForEvent,
  TeamError,
} from '../../packages/backend/src/services/team.js';
import {
  initiateCheckout,
  executePaymentConfirmationTransaction,
} from '../../packages/backend/src/services/payment.js';
import { runRollbackToVersion } from '../../packages/backend/src/db/migrate-down.js';
import { runMigrations } from '../../packages/backend/src/db/migrate.js';

describe('Phase P18: Teams Hardening, Paid Checkout, PII Removal, Invitations & Atomic Leadership', () => {
  let app: FastifyInstance;
  let collegeId: string;
  let organizerId: string;
  let organizerUserId: string;

  const createdUserIds: string[] = [];
  const createdTeamIds: string[] = [];
  const createdEventIds: string[] = [];

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    const client = await pool.connect();
    try {
      const cRes = await client.query('SELECT id FROM colleges LIMIT 1;');
      collegeId = cRes.rows[0].id;

      const userRes = await client.query(
        `INSERT INTO users (college_id, email, password_hash, display_name, global_role, status)
         VALUES ($1, $2, 'hash', 'P18 Organizer User', 'student', 'active')
         RETURNING id;`,
        [collegeId, `p18.org.${Date.now()}.${crypto.randomBytes(4).toString('hex')}@campus.edu`]
      );
      organizerUserId = userRes.rows[0].id;
      createdUserIds.push(organizerUserId);

      const orgRes = await client.query(
        `INSERT INTO organizer_profiles (college_id, display_name, status, created_by)
         VALUES ($1, 'P18 Tech Club', 'verified', $2)
         RETURNING id;`,
        [collegeId, organizerUserId]
      );
      organizerId = orgRes.rows[0].id;
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    const client = await pool.connect();
    try {
      if (createdEventIds.length > 0) {
        await client.query(`DELETE FROM waitlist_entries WHERE event_id = ANY($1::uuid[]);`, [createdEventIds]);
        await client.query(`DELETE FROM team_event_registrations WHERE event_id = ANY($1::uuid[]);`, [createdEventIds]);
        await client.query(`DELETE FROM tickets WHERE event_id = ANY($1::uuid[]);`, [createdEventIds]);
        await client.query(
          `DELETE FROM booking_items WHERE booking_id IN (SELECT id FROM bookings WHERE event_id = ANY($1::uuid[]));`,
          [createdEventIds]
        );
        await client.query(`DELETE FROM organizer_ledger_entries WHERE booking_id IN (SELECT id FROM bookings WHERE event_id = ANY($1::uuid[]));`, [createdEventIds]);
        await client.query(`DELETE FROM receipts WHERE booking_id IN (SELECT id FROM bookings WHERE event_id = ANY($1::uuid[]));`, [createdEventIds]);
        await client.query(`DELETE FROM payment_attempts WHERE payment_id IN (SELECT id FROM payments WHERE booking_id IN (SELECT id FROM bookings WHERE event_id = ANY($1::uuid[])));`, [createdEventIds]);
        await client.query(`DELETE FROM payments WHERE booking_id IN (SELECT id FROM bookings WHERE event_id = ANY($1::uuid[]));`, [createdEventIds]);
        await client.query(`DELETE FROM bookings WHERE event_id = ANY($1::uuid[]);`, [createdEventIds]);
        await client.query(`DELETE FROM ticket_types WHERE event_id = ANY($1::uuid[]);`, [createdEventIds]);
        await client.query(`DELETE FROM events WHERE id = ANY($1::uuid[]);`, [createdEventIds]);
      }

      if (createdTeamIds.length > 0) {
        await client.query(`DELETE FROM team_event_registrations WHERE team_id = ANY($1::uuid[]);`, [createdTeamIds]);
        await client.query(`DELETE FROM team_invitations WHERE team_id = ANY($1::uuid[]);`, [createdTeamIds]);
        await client.query(`DELETE FROM team_members WHERE team_id = ANY($1::uuid[]);`, [createdTeamIds]);
        await client.query(`DELETE FROM teams WHERE id = ANY($1::uuid[]);`, [createdTeamIds]);
      }

      if (organizerId) {
        await client.query(`DELETE FROM organizer_profiles WHERE id = $1;`, [organizerId]);
      }

      if (createdUserIds.length > 0) {
        await client.query(`DELETE FROM sessions WHERE user_id = ANY($1::uuid[]);`, [createdUserIds]);
        await client.query(`DELETE FROM users WHERE id = ANY($1::uuid[]);`, [createdUserIds]);
      }
    } finally {
      client.release();
    }
  });

  async function createTestUser(tag: string, emailCustom?: string) {
    const client = await pool.connect();
    try {
      const email = emailCustom || `p18.${tag}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}@campus.edu`;
      const res = await client.query(
        `INSERT INTO users (college_id, email, password_hash, display_name, global_role, status)
         VALUES ($1, $2, 'hash', $3, 'student', 'active')
         RETURNING id;`,
        [collegeId, email, `User ${tag}`]
      );
      const uid = res.rows[0].id;
      createdUserIds.push(uid);
      return { id: uid, email, displayName: `User ${tag}` };
    } finally {
      client.release();
    }
  }

  async function createSession(userId: string) {
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const csrfToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(sessionToken).digest();

    await pool.query(
      `INSERT INTO sessions (id_hash, user_id, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '1 day');`,
      [tokenHash, userId]
    );

    return {
      headers: {
        cookie: `eventora_session=${sessionToken}; eventora_csrf=${csrfToken}`,
        'x-csrf-token': csrfToken,
      },
    };
  }

  async function createTestEvent(overrides: {
    pricePaise?: number;
    capacity?: number;
    teamMin?: number;
    teamMax?: number;
  } = {}) {
    const client = await pool.connect();
    try {
      const pricePaise = overrides.pricePaise ?? 0;
      const capacity = overrides.capacity ?? 10;
      const teamMin = overrides.teamMin ?? 2;
      const teamMax = overrides.teamMax ?? 4;
      const slug = `p18-evt-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

      const evtRes = await client.query(
        `INSERT INTO events (
           organizer_id, college_id, title, slug, description, category, department, format,
           starts_at, ends_at, capacity, visibility, status, contact_email, created_by,
           team_mode, team_min, team_max
         ) VALUES (
           $1, $2, 'P18 Hackathon', $3, 'P18 Event Desc', 'Technology', 'CS', 'in_person',
           NOW() + INTERVAL '5 days', NOW() + INTERVAL '6 days', $4, 'public', 'published',
           'p18@campus.edu', $5, 'required', $6, $7
         ) RETURNING id;`,
        [organizerId, collegeId, slug, capacity, organizerUserId, teamMin, teamMax]
      );
      const eventId = evtRes.rows[0].id;
      createdEventIds.push(eventId);

      const ttRes = await client.query(
        `INSERT INTO ticket_types (
           event_id, name, price_paise, capacity, sold, held
         ) VALUES ($1, 'Team Pass', $2, $3, 0, 0)
         RETURNING id;`,
        [eventId, pricePaise, capacity]
      );
      const ticketTypeId = ttRes.rows[0].id;

      return { eventId, ticketTypeId };
    } finally {
      client.release();
    }
  }

  // =========================================================================
  // 1. PII Protection & Member Email Omission Test
  // =========================================================================
  describe('1. PII Protection: GET /teams/:id Never Returns Member Emails', () => {
    it('public / discoverable team returns member display_name and role, but NO emails or sensitive credentials', async () => {
      const leader = await createTestUser('leader_pii');
      const member = await createTestUser('member_pii');

      const teamData = await createTeam({
        name: `PII Protection Team ${Date.now()}`,
        visibility: 'discoverable',
        maxSize: 4,
        userId: leader.id,
      });
      const teamId = teamData.team.id;
      createdTeamIds.push(teamId);

      // Add member
      await pool.query(
        `INSERT INTO team_members (team_id, user_id, role, status) VALUES ($1, $2, 'member', 'ACTIVE');`,
        [teamId, member.id]
      );

      // Fetch via HTTP GET /api/v1/teams/:id
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/teams/${teamId}`,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      expect(body.team).toBeDefined();
      expect(body.members).toBeDefined();
      expect(body.members.length).toBe(2);

      // Strict PII checks: no member emails, no passwords
      for (const m of body.members) {
        expect(m.email).toBeUndefined();
        expect(m.password).toBeUndefined();
        expect(m.password_hash).toBeUndefined();
        expect(m.display_name || m.displayName).toBeDefined();
        expect(m.role).toBeDefined();
      }

      // Snapshot string check: verify raw JSON payload has no '@campus.edu' or member email strings
      expect(res.body).not.toContain(leader.email);
      expect(res.body).not.toContain(member.email);
    });

    it('private team returns 404 (not 403) to anonymous or non-member authenticated users', async () => {
      const leader = await createTestUser('priv_leader');
      const outsider = await createTestUser('priv_outsider');
      const outsiderSession = await createSession(outsider.id);

      const teamData = await createTeam({
        name: `Confidential Squad ${Date.now()}`,
        visibility: 'private',
        maxSize: 3,
        userId: leader.id,
      });
      const teamId = teamData.team.id;
      createdTeamIds.push(teamId);

      // 1. Anonymous request -> 404 TEAM_NOT_FOUND
      const anonRes = await app.inject({
        method: 'GET',
        url: `/api/v1/teams/${teamId}`,
      });
      expect(anonRes.statusCode).toBe(404);
      const anonBody = JSON.parse(anonRes.body);
      expect(anonBody.error.code).toBe('TEAM_NOT_FOUND');

      // 2. Non-member authenticated request -> 404 TEAM_NOT_FOUND
      const outsiderRes = await app.inject({
        method: 'GET',
        url: `/api/v1/teams/${teamId}`,
        headers: outsiderSession.headers,
      });
      expect(outsiderRes.statusCode).toBe(404);
      const outsiderBody = JSON.parse(outsiderRes.body);
      expect(outsiderBody.error.code).toBe('TEAM_NOT_FOUND');

      // 3. Active member request -> 200 OK
      const leaderSession = await createSession(leader.id);
      const leaderRes = await app.inject({
        method: 'GET',
        url: `/api/v1/teams/${teamId}`,
        headers: leaderSession.headers,
      });
      expect(leaderRes.statusCode).toBe(200);
      const leaderBody = JSON.parse(leaderRes.body);
      expect(leaderBody.team.id).toBe(teamId);
    });
  });

  // =========================================================================
  // 2. Invitation Security & Misuse Tests
  // =========================================================================
  describe('2. Team Invitations Security & Hardening', () => {
    it('rejects invitation creation without named invitee with 400 NAMED_INVITEE_REQUIRED', async () => {
      const leader = await createTestUser('inv_lead1');
      const leaderSession = await createSession(leader.id);

      const teamData = await createTeam({
        name: `Invited Squad ${Date.now()}`,
        visibility: 'discoverable',
        maxSize: 4,
        userId: leader.id,
      });
      const teamId = teamData.team.id;
      createdTeamIds.push(teamId);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/teams/${teamId}/invitations`,
        headers: leaderSession.headers,
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('NAMED_INVITEE_REQUIRED');
    });

    it('rejects invitation acceptance without token with 400 MISSING_INVITATION_TOKEN', async () => {
      const leader = await createTestUser('inv_lead2');
      const invitee = await createTestUser('inv_target2');
      const inviteeSession = await createSession(invitee.id);

      const teamData = await createTeam({
        name: `Squad Alpha ${Date.now()}`,
        visibility: 'discoverable',
        maxSize: 4,
        userId: leader.id,
      });
      const teamId = teamData.team.id;
      createdTeamIds.push(teamId);

      const invRes = await inviteMember({
        teamId,
        inviterId: leader.id,
        inviteeId: invitee.id,
      });
      const invId = invRes.invitation.id;

      const acceptRes = await app.inject({
        method: 'POST',
        url: `/api/v1/teams/invitations/${invId}/accept`,
        headers: inviteeSession.headers,
        payload: {},
      });

      expect(acceptRes.statusCode).toBe(400);
      const body = JSON.parse(acceptRes.body);
      expect(body.error.code).toBe('MISSING_INVITATION_TOKEN');
    });

    it('rejects invitation acceptance with invalid token hash with 400 INVITATION_INVALID', async () => {
      const leader = await createTestUser('inv_lead3');
      const invitee = await createTestUser('inv_target3');
      const inviteeSession = await createSession(invitee.id);

      const teamData = await createTeam({
        name: `Squad Beta ${Date.now()}`,
        visibility: 'discoverable',
        maxSize: 4,
        userId: leader.id,
      });
      const teamId = teamData.team.id;
      createdTeamIds.push(teamId);

      const invRes = await inviteMember({
        teamId,
        inviterId: leader.id,
        inviteeId: invitee.id,
      });
      const invId = invRes.invitation.id;

      const acceptRes = await app.inject({
        method: 'POST',
        url: `/api/v1/teams/invitations/${invId}/accept`,
        headers: inviteeSession.headers,
        payload: { token: 'tampered-or-invalid-token' },
      });

      expect(acceptRes.statusCode).toBe(400);
      const body = JSON.parse(acceptRes.body);
      expect(body.error.code).toBe('INVITATION_INVALID');
    });

    it('rejects invitation acceptance by non-named user with 403 NAMED_INVITEE_MISMATCH', async () => {
      const leader = await createTestUser('inv_lead4');
      const intendedInvitee = await createTestUser('inv_intended4');
      const unauthorizedUser = await createTestUser('inv_unauth4');
      const unauthSession = await createSession(unauthorizedUser.id);

      const teamData = await createTeam({
        name: `Squad Gamma ${Date.now()}`,
        visibility: 'discoverable',
        maxSize: 4,
        userId: leader.id,
      });
      const teamId = teamData.team.id;
      createdTeamIds.push(teamId);

      const invRes = await inviteMember({
        teamId,
        inviterId: leader.id,
        inviteeId: intendedInvitee.id,
      });
      const invId = invRes.invitation.id;
      const rawToken = invRes.invitationToken;

      const acceptRes = await app.inject({
        method: 'POST',
        url: `/api/v1/teams/invitations/${invId}/accept`,
        headers: unauthSession.headers,
        payload: { token: rawToken },
      });

      expect(acceptRes.statusCode).toBe(403);
      const body = JSON.parse(acceptRes.body);
      expect(body.error.code).toBe('NAMED_INVITEE_MISMATCH');
    });

    it('rejects expired invitation acceptance with 400 INVITATION_EXPIRED', async () => {
      const leader = await createTestUser('inv_lead5');
      const invitee = await createTestUser('inv_target5');
      const inviteeSession = await createSession(invitee.id);

      const teamData = await createTeam({
        name: `Squad Delta ${Date.now()}`,
        visibility: 'discoverable',
        maxSize: 4,
        userId: leader.id,
      });
      const teamId = teamData.team.id;
      createdTeamIds.push(teamId);

      const invRes = await inviteMember({
        teamId,
        inviterId: leader.id,
        inviteeId: invitee.id,
      });
      const invId = invRes.invitation.id;
      const rawToken = invRes.invitationToken;

      // Force expired in past
      await pool.query(
        `UPDATE team_invitations SET expires_at = NOW() - INTERVAL '1 hour' WHERE id = $1;`,
        [invId]
      );

      const acceptRes = await app.inject({
        method: 'POST',
        url: `/api/v1/teams/invitations/${invId}/accept`,
        headers: inviteeSession.headers,
        payload: { token: rawToken },
      });

      expect(acceptRes.statusCode).toBe(400);
      const body = JSON.parse(acceptRes.body);
      expect(body.error.code).toBe('INVITATION_EXPIRED');
    });

    it('rate limits invitation creation to max 20 per hour', async () => {
      const leader = await createTestUser('inv_rate_leader');
      const leaderSession = await createSession(leader.id);

      const teamData = await createTeam({
        name: `Squad RateLimit ${Date.now()}`,
        visibility: 'discoverable',
        maxSize: 10,
        userId: leader.id,
      });
      const teamId = teamData.team.id;
      createdTeamIds.push(teamId);

      // Rapidly submit invitations
      let hit429 = false;
      for (let i = 0; i < 22; i++) {
        const dummyEmail = `rate.${i}.${Date.now()}@campus.edu`;
        const res = await app.inject({
          method: 'POST',
          url: `/api/v1/teams/${teamId}/invitations`,
          headers: leaderSession.headers,
          payload: { email: dummyEmail },
        });

        if (res.statusCode === 429) {
          hit429 = true;
          const body = JSON.parse(res.body);
          expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');
          break;
        }
      }

      expect(hit429).toBe(true);
    });
  });

  // =========================================================================
  // 3. Paid Team Registration Pending-to-Payment Lifecycle & Seat Model
  // =========================================================================
  describe('3. Paid Team Registration Flow & Seat Model Invariants', () => {
    it('seat model: 1 team slot reserves 1 unit, creates PENDING_PAYMENT booking, and completes on payment confirmation', async () => {
      const leader = await createTestUser('paid_lead');
      const member = await createTestUser('paid_mem');

      const teamData = await createTeam({
        name: `Paid Hackers ${Date.now()}`,
        visibility: 'discoverable',
        maxSize: 4,
        userId: leader.id,
      });
      const teamId = teamData.team.id;
      createdTeamIds.push(teamId);

      // Add member to fulfill team_min = 2
      await pool.query(
        `INSERT INTO team_members (team_id, user_id, role, status) VALUES ($1, $2, 'member', 'ACTIVE');`,
        [teamId, member.id]
      );

      // Paid event with 50000 paise (500 INR)
      const { eventId, ticketTypeId } = await createTestEvent({
        pricePaise: 50000,
        capacity: 5,
        teamMin: 2,
        teamMax: 4,
      });

      // 1. Leader initiates registration
      const regRes = await registerTeamForEvent({
        teamId,
        eventId,
        requesterId: leader.id,
        ticketTypeId,
        idempotencyKey: `team-pay-${Date.now()}`,
      });

      expect(regRes.status).toBe('pending_payment');
      expect(regRes.bookingId).toBeDefined();
      expect(regRes.totalPaise).toBe(50000);

      // 2. Verify held capacity incremented by 1 (1 slot per team)
      const ttCheck1 = await pool.query(`SELECT sold, held, capacity FROM ticket_types WHERE id = $1;`, [ticketTypeId]);
      expect(ttCheck1.rows[0].held).toBe(1);
      expect(ttCheck1.rows[0].sold).toBe(0);

      // 3. Verify booking is PENDING_PAYMENT
      const bookingCheck = await pool.query(`SELECT status, expires_at FROM bookings WHERE id = $1;`, [regRes.bookingId]);
      expect(bookingCheck.rows[0].status).toBe('PENDING_PAYMENT');
      expect(new Date(bookingCheck.rows[0].expires_at).getTime()).toBeGreaterThan(Date.now());

      // 4. Verify no tickets issued yet
      const tixPrePay = await pool.query(`SELECT count(*)::int as count FROM tickets WHERE booking_id = $1;`, [regRes.bookingId]);
      expect(tixPrePay.rows[0].count).toBe(0);

      // 5. Simulate checkout & payment confirmation via initiateCheckout & executePaymentConfirmationTransaction
      const checkout = await initiateCheckout({ bookingId: regRes.bookingId, userId: leader.id });

      const confirmRes = await executePaymentConfirmationTransaction({
        orderId: checkout.orderId,
        paymentId: `youpi-test-${Date.now()}`,
        adapterSuccess: true,
        amountPaise: 50000,
      });
      expect(confirmRes.confirmed).toBe(true);

      // 6. Verify booking confirmed & team_event_registrations status = 'registered'
      const postBooking = await pool.query(`SELECT status FROM bookings WHERE id = $1;`, [regRes.bookingId]);
      expect(postBooking.rows[0].status).toBe('CONFIRMED');

      const postTeamReg = await pool.query(
        `SELECT status, member_snapshot FROM team_event_registrations WHERE id = $1;`,
        [regRes.teamRegistrationId]
      );
      expect(postTeamReg.rows[0].status).toBe('registered');

      // Verify memberSnapshot does not contain member emails
      const snap = postTeamReg.rows[0].member_snapshot;
      expect(snap.length).toBe(2);
      expect(JSON.stringify(snap)).not.toContain('@campus.edu');

      // 7. Verify capacity: held released (0), sold incremented (1)
      const ttCheck2 = await pool.query(`SELECT sold, held FROM ticket_types WHERE id = $1;`, [ticketTypeId]);
      expect(ttCheck2.rows[0].held).toBe(0);
      expect(ttCheck2.rows[0].sold).toBe(1);

      // 8. Verify ticket issued post-payment
      const tixPostPay = await pool.query(`SELECT count(*)::int as count FROM tickets WHERE booking_id = $1;`, [regRes.bookingId]);
      expect(tixPostPay.rows[0].count).toBe(1);
    });

    it('enforces capacity gate: rejects team registration when tier is sold out with 409 SOLD_OUT', async () => {
      const leader = await createTestUser('soldout_lead');
      const member = await createTestUser('soldout_mem');

      const teamData = await createTeam({
        name: `Soldout Squad ${Date.now()}`,
        visibility: 'discoverable',
        maxSize: 4,
        userId: leader.id,
      });
      const teamId = teamData.team.id;
      createdTeamIds.push(teamId);

      await pool.query(
        `INSERT INTO team_members (team_id, user_id, role, status) VALUES ($1, $2, 'member', 'ACTIVE');`,
        [teamId, member.id]
      );

      // Event with capacity = 1, sold = 1
      const { eventId, ticketTypeId } = await createTestEvent({
        capacity: 1,
        teamMin: 2,
        teamMax: 4,
      });
      await pool.query(`UPDATE ticket_types SET sold = 1 WHERE id = $1;`, [ticketTypeId]);

      let error: any;
      try {
        await registerTeamForEvent({
          teamId,
          eventId,
          requesterId: leader.id,
          ticketTypeId,
          idempotencyKey: `soldout-key-${Date.now()}`,
        });
      } catch (err) {
        error = err;
      }

      expect(error).toBeInstanceOf(TeamError);
      expect(error.code).toBe('SOLD_OUT');
      expect(error.status).toBe(409);
      expect(error.details?.waitlistAvailable).toBe(true);
    });
  });

  // =========================================================================
  // 4. Team Min/Max & Per-Member Duplicate Booking Validation
  // =========================================================================
  describe('4. Team Size & Per-Member Duplicate Booking Checks', () => {
    it('enforces teamMin: rejects if team size < event.team_min with 400 TEAM_TOO_SMALL', async () => {
      const leader = await createTestUser('small_lead');
      const teamData = await createTeam({
        name: `Solo Squad ${Date.now()}`,
        visibility: 'discoverable',
        maxSize: 4,
        userId: leader.id,
      });
      const teamId = teamData.team.id;
      createdTeamIds.push(teamId);

      const { eventId, ticketTypeId } = await createTestEvent({ teamMin: 3, teamMax: 5 });

      let error: any;
      try {
        await registerTeamForEvent({
          teamId,
          eventId,
          requesterId: leader.id,
          ticketTypeId,
          idempotencyKey: `too-small-${Date.now()}`,
        });
      } catch (err) {
        error = err;
      }

      expect(error).toBeInstanceOf(TeamError);
      expect(error.code).toBe('TEAM_TOO_SMALL');
      expect(error.status).toBe(400);
    });

    it('enforces teamMax: rejects if team size > event.team_max with 400 TEAM_TOO_LARGE', async () => {
      const leader = await createTestUser('large_lead');
      const m1 = await createTestUser('large_m1');
      const m2 = await createTestUser('large_m2');

      const teamData = await createTeam({
        name: `Trio Squad ${Date.now()}`,
        visibility: 'discoverable',
        maxSize: 5,
        userId: leader.id,
      });
      const teamId = teamData.team.id;
      createdTeamIds.push(teamId);

      await pool.query(
        `INSERT INTO team_members (team_id, user_id, role, status) VALUES ($1, $2, 'member', 'ACTIVE'), ($1, $3, 'member', 'ACTIVE');`,
        [teamId, m1.id, m2.id]
      );

      // Event allows at most 2 members
      const { eventId, ticketTypeId } = await createTestEvent({ teamMin: 1, teamMax: 2 });

      let error: any;
      try {
        await registerTeamForEvent({
          teamId,
          eventId,
          requesterId: leader.id,
          ticketTypeId,
          idempotencyKey: `too-large-${Date.now()}`,
        });
      } catch (err) {
        error = err;
      }

      expect(error).toBeInstanceOf(TeamError);
      expect(error.code).toBe('TEAM_TOO_LARGE');
      expect(error.status).toBe(400);
    });

    it('rejects if a team member already has an active solo booking with 409 MEMBER_ALREADY_REGISTERED', async () => {
      const leader = await createTestUser('dupe_lead1');
      const member = await createTestUser('dupe_mem1');

      const teamData = await createTeam({
        name: `Dupe Solo Team ${Date.now()}`,
        visibility: 'discoverable',
        maxSize: 4,
        userId: leader.id,
      });
      const teamId = teamData.team.id;
      createdTeamIds.push(teamId);

      await pool.query(
        `INSERT INTO team_members (team_id, user_id, role, status) VALUES ($1, $2, 'member', 'ACTIVE');`,
        [teamId, member.id]
      );

      const { eventId, ticketTypeId } = await createTestEvent({ teamMin: 2, teamMax: 4 });

      // Create confirmed solo booking for member
      await pool.query(
        `INSERT INTO bookings (user_id, event_id, status, total_paise, idempotency_key)
         VALUES ($1, $2, 'CONFIRMED', 0, $3);`,
        [member.id, eventId, `solo-booking-${Date.now()}`]
      );

      let error: any;
      try {
        await registerTeamForEvent({
          teamId,
          eventId,
          requesterId: leader.id,
          ticketTypeId,
          idempotencyKey: `dupe-key-${Date.now()}`,
        });
      } catch (err) {
        error = err;
      }

      expect(error).toBeInstanceOf(TeamError);
      expect(error.code).toBe('MEMBER_ALREADY_REGISTERED');
      expect(error.status).toBe(409);
    });

    it('rejects if a team member is already registered in another team with 409 MEMBER_ALREADY_REGISTERED', async () => {
      const sharedMember = await createTestUser('shared_mem');
      const lead1 = await createTestUser('lead1_dupe');
      const lead2 = await createTestUser('lead2_dupe');

      // Team 1
      const team1 = await createTeam({
        name: `Squad One ${Date.now()}`,
        visibility: 'discoverable',
        maxSize: 4,
        userId: lead1.id,
      });
      createdTeamIds.push(team1.team.id);
      await pool.query(
        `INSERT INTO team_members (team_id, user_id, role, status) VALUES ($1, $2, 'member', 'ACTIVE');`,
        [team1.team.id, sharedMember.id]
      );

      // Team 2
      const team2 = await createTeam({
        name: `Squad Two ${Date.now()}`,
        visibility: 'discoverable',
        maxSize: 4,
        userId: lead2.id,
      });
      createdTeamIds.push(team2.team.id);
      await pool.query(
        `INSERT INTO team_members (team_id, user_id, role, status) VALUES ($1, $2, 'member', 'ACTIVE');`,
        [team2.team.id, sharedMember.id]
      );

      const { eventId, ticketTypeId } = await createTestEvent({ teamMin: 2, teamMax: 4 });

      // Register Team 1 successfully
      await registerTeamForEvent({
        teamId: team1.team.id,
        eventId,
        requesterId: lead1.id,
        ticketTypeId,
        idempotencyKey: `t1-reg-${Date.now()}`,
      });

      // Attempt to register Team 2 (which shares sharedMember)
      let error: any;
      try {
        await registerTeamForEvent({
          teamId: team2.team.id,
          eventId,
          requesterId: lead2.id,
          ticketTypeId,
          idempotencyKey: `t2-reg-${Date.now()}`,
        });
      } catch (err) {
        error = err;
      }

      expect(error).toBeInstanceOf(TeamError);
      expect(error.code).toBe('MEMBER_ALREADY_REGISTERED');
      expect(error.status).toBe(409);
    });
  });

  // =========================================================================
  // 5. Last-Leader Leave & Atomic Leadership Concurrency
  // =========================================================================
  describe('5. Atomic Leadership Transfer & Last-Leader Leave', () => {
    it('transfers leadership atomically: leader becomes member and target becomes leader', async () => {
      const leader = await createTestUser('lead_xfer');
      const member = await createTestUser('mem_xfer');

      const teamData = await createTeam({
        name: `Transfer Squad ${Date.now()}`,
        visibility: 'discoverable',
        maxSize: 4,
        userId: leader.id,
      });
      const teamId = teamData.team.id;
      createdTeamIds.push(teamId);

      await pool.query(
        `INSERT INTO team_members (team_id, user_id, role, status) VALUES ($1, $2, 'member', 'ACTIVE');`,
        [teamId, member.id]
      );

      const transferRes = await transferLeadership(teamId, leader.id, member.id);
      expect(transferRes.success).toBe(true);
      expect(transferRes.newLeaderId).toBe(member.id);

      // Verify DB state
      const rolesRes = await pool.query(
        `SELECT user_id, role FROM team_members WHERE team_id = $1 AND status = 'ACTIVE' ORDER BY role ASC;`,
        [teamId]
      );
      const newLeaderRow = rolesRes.rows.find((r) => r.user_id === member.id);
      const oldLeaderRow = rolesRes.rows.find((r) => r.user_id === leader.id);

      expect(newLeaderRow?.role).toBe('leader');
      expect(oldLeaderRow?.role).toBe('member');
    });

    it('leader leave with explicit successor atomically promotes successor and removes leaver', async () => {
      const leader = await createTestUser('leave_lead1');
      const successor = await createTestUser('leave_succ1');

      const teamData = await createTeam({
        name: `Successor Squad ${Date.now()}`,
        visibility: 'discoverable',
        maxSize: 4,
        userId: leader.id,
      });
      const teamId = teamData.team.id;
      createdTeamIds.push(teamId);

      await pool.query(
        `INSERT INTO team_members (team_id, user_id, role, status) VALUES ($1, $2, 'member', 'ACTIVE');`,
        [teamId, successor.id]
      );

      const leaveRes = await leaveTeam(teamId, leader.id, successor.id);
      expect(leaveRes.success).toBe(true);
      expect(leaveRes.newLeaderId).toBe(successor.id);

      // Verify successor is now leader
      const succCheck = await pool.query(
        `SELECT role, status FROM team_members WHERE team_id = $1 AND user_id = $2;`,
        [teamId, successor.id]
      );
      expect(succCheck.rows[0].role).toBe('leader');
      expect(succCheck.rows[0].status).toBe('ACTIVE');

      // Verify leaver is marked REMOVED
      const leaverCheck = await pool.query(
        `SELECT status FROM team_members WHERE team_id = $1 AND user_id = $2;`,
        [teamId, leader.id]
      );
      expect(leaverCheck.rows[0].status).toBe('REMOVED');
    });

    it('leader leave without specified successor auto-promotes remaining member so team is never leaderless', async () => {
      const leader = await createTestUser('auto_lead2');
      const member = await createTestUser('auto_mem2');

      const teamData = await createTeam({
        name: `Auto-Promote Squad ${Date.now()}`,
        visibility: 'discoverable',
        maxSize: 4,
        userId: leader.id,
      });
      const teamId = teamData.team.id;
      createdTeamIds.push(teamId);

      await pool.query(
        `INSERT INTO team_members (team_id, user_id, role, status) VALUES ($1, $2, 'member', 'ACTIVE');`,
        [teamId, member.id]
      );

      const leaveRes = await leaveTeam(teamId, leader.id);
      expect(leaveRes.success).toBe(true);
      expect(leaveRes.newLeaderId).toBe(member.id);

      const memberCheck = await pool.query(
        `SELECT role, status FROM team_members WHERE team_id = $1 AND user_id = $2;`,
        [teamId, member.id]
      );
      expect(memberCheck.rows[0].role).toBe('leader');
      expect(memberCheck.rows[0].status).toBe('ACTIVE');
    });

    it('last member leaves archives the team atomically', async () => {
      const soloUser = await createTestUser('solo_archive');

      const teamData = await createTeam({
        name: `To-Be-Archived Squad ${Date.now()}`,
        visibility: 'discoverable',
        maxSize: 4,
        userId: soloUser.id,
      });
      const teamId = teamData.team.id;
      createdTeamIds.push(teamId);

      const leaveRes = await leaveTeam(teamId, soloUser.id);
      expect(leaveRes.success).toBe(true);
      expect(leaveRes.archived).toBe(true);

      const teamCheck = await pool.query(`SELECT status FROM teams WHERE id = $1;`, [teamId]);
      expect(teamCheck.rows[0].status).toBe('archived');
    });

    it('concurrency: concurrent leave and transfer operations serialize cleanly without deadlock', async () => {
      const leader = await createTestUser('cc_leader');
      const m1 = await createTestUser('cc_m1');
      const m2 = await createTestUser('cc_m2');

      const teamData = await createTeam({
        name: `Concurrent Squad ${Date.now()}`,
        visibility: 'discoverable',
        maxSize: 4,
        userId: leader.id,
      });
      const teamId = teamData.team.id;
      createdTeamIds.push(teamId);

      await pool.query(
        `INSERT INTO team_members (team_id, user_id, role, status)
         VALUES ($1, $2, 'member', 'ACTIVE'), ($1, $3, 'member', 'ACTIVE');`,
        [teamId, m1.id, m2.id]
      );

      // Concurrently run transfer to m1 and leave
      const results = await Promise.allSettled([
        transferLeadership(teamId, leader.id, m1.id),
        leaveTeam(teamId, m2.id),
      ]);

      // At least one (and usually both) operations must succeed without deadlock
      const succeeded = results.filter((r) => r.status === 'fulfilled');
      expect(succeeded.length).toBeGreaterThanOrEqual(1);

      // Verify invariant: team must have exactly 1 active leader
      const activeLeaders = await pool.query(
        `SELECT user_id FROM team_members WHERE team_id = $1 AND role = 'leader' AND status = 'ACTIVE';`,
        [teamId]
      );
      expect(activeLeaders.rows.length).toBe(1);
    });
  });

  // =========================================================================
  // 6. Migration 21 Integrity Test
  // =========================================================================
  describe('6. Database Migration 21 Rollback & Re-application', () => {
    it('migration 21 down-migration to 20 and re-application to 21 preserves database integrity', async () => {
      // 1. Rollback to version 20
      await runRollbackToVersion(20);

      const client1 = await pool.connect();
      try {
        const v20 = await client1.query('SELECT MAX(version) as version FROM schema_migrations;');
        expect(Number(v20.rows[0].version)).toBe(20);

        // Verify index dropped
        const idxCheck = await client1.query(
          `SELECT indexname FROM pg_indexes WHERE indexname = 'idx_team_invitations_token_hash';`
        );
        expect(idxCheck.rows.length).toBe(0);
      } finally {
        client1.release();
      }

      // 2. Re-apply to 21
      await runMigrations();

      const client2 = await pool.connect();
      try {
        const v21 = await client2.query('SELECT MAX(version) as version FROM schema_migrations;');
        expect(Number(v21.rows[0].version)).toBeGreaterThanOrEqual(21);

        // Verify index recreated
        const idxCheck = await client2.query(
          `SELECT indexname FROM pg_indexes WHERE indexname = 'idx_team_invitations_token_hash';`
        );
        expect(idxCheck.rows.length).toBe(1);
      } finally {
        client2.release();
      }
    });
  });
});
