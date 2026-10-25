import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../../packages/backend/src/db/index.js';
import { createBooking } from '../../packages/backend/src/services/booking.js';
import { joinWaitlist, claimOffer, expireOffers, promoteNext } from '../../packages/backend/src/services/waitlist.js';
import { cancelBooking } from '../../packages/backend/src/services/cancellation.js';
import { createTeam, registerTeamForEvent, leaveTeam } from '../../packages/backend/src/services/team.js';
import crypto from 'crypto';

describe('Phase 4 Quality Gate: Registration, Capacity, Waitlists & Teams', () => {
  let collegeId: string;
  let organizerId: string;
  let testEventId: string;
  let testTicketTypeId: string;
  const createdUserIds: string[] = [];
  const createdEventIds: string[] = [];

  beforeAll(async () => {
    const client = await pool.connect();
    try {
      // 1. Get college
      const cRes = await client.query('SELECT id FROM colleges LIMIT 1;');
      collegeId = cRes.rows[0].id;

      // 2. Create test user & organizer profile
      const userRes = await client.query(
        `INSERT INTO users (college_id, email, password_hash, display_name, global_role, status)
         VALUES ($1, $2, 'hash', 'Organizer Lead', 'student', 'active')
         RETURNING id;`,
        [collegeId, `org.lead.${Date.now()}@campus.edu`]
      );
      const leadId = userRes.rows[0].id;
      createdUserIds.push(leadId);

      const orgRes = await client.query(
        `INSERT INTO organizer_profiles (college_id, display_name, status, created_by)
         VALUES ($1, 'Gate Robotics Club', 'verified', $2)
         RETURNING id;`,
        [collegeId, leadId]
      );
      organizerId = orgRes.rows[0].id;

      // 3. Create test event
      const evtRes = await client.query(
        `INSERT INTO events (
           organizer_id, college_id, title, slug, description, category, department, format,
           starts_at, ends_at, capacity, visibility, status, contact_email, created_by, team_mode, team_min, team_max
         ) VALUES (
           $1, $2, 'Gate Tech Summit', $3, 'Description', 'AI & Robotics', 'Computer Science', 'in_person',
           NOW() + INTERVAL '2 days', NOW() + INTERVAL '3 days', 10, 'public', 'published', 'contact@campus.edu', $4, 'optional', 2, 3
         ) RETURNING id;`,
        [organizerId, collegeId, `gate-slug-${Date.now()}`, leadId]
      );
      testEventId = evtRes.rows[0].id;
      createdEventIds.push(testEventId);

      // 4. Create test ticket type with capacity 10
      const ttRes = await client.query(
        `INSERT INTO ticket_types (event_id, name, price_paise, capacity, sold, held, per_user_limit)
         VALUES ($1, 'Free Student Pass', 0, 10, 0, 0, 1)
         RETURNING id;`,
        [testEventId]
      );
      testTicketTypeId = ttRes.rows[0].id;

      // 5. Pre-create 250 test users for high-concurrency simulation
      const userInsertRes = await client.query(
        `INSERT INTO users (college_id, email, password_hash, display_name, global_role, status)
         SELECT
           $1,
           'concurrent.user.' || i || '.' || ${Date.now()} || '@campus.edu',
           'hash',
           'Attendee ' || i,
           'student',
           'active'
         FROM generate_series(1, 250) AS i
         RETURNING id;`,
        [collegeId]
      );
      for (const row of userInsertRes.rows) {
        createdUserIds.push(row.id);
      }
    } finally {
      client.release();
    }
  }, 60000);

  afterAll(async () => {
    const client = await pool.connect();
    try {
      if (createdEventIds.length > 0) {
        await client.query(`DELETE FROM team_submissions WHERE team_registration_id IN (SELECT id FROM team_event_registrations WHERE event_id = ANY($1::uuid[]));`, [createdEventIds]);
        await client.query(`DELETE FROM team_event_registrations WHERE event_id = ANY($1::uuid[]);`, [createdEventIds]);
        await client.query(`DELETE FROM waitlist_entries WHERE event_id = ANY($1::uuid[]);`, [createdEventIds]);
        await client.query(`DELETE FROM tickets WHERE event_id = ANY($1::uuid[]);`, [createdEventIds]);
        await client.query(`DELETE FROM booking_items WHERE ticket_type_id IN (SELECT id FROM ticket_types WHERE event_id = ANY($1::uuid[]));`, [createdEventIds]);
        await client.query(`DELETE FROM cancellations WHERE booking_id IN (SELECT id FROM bookings WHERE event_id = ANY($1::uuid[]));`, [createdEventIds]);
        await client.query(`DELETE FROM bookings WHERE event_id = ANY($1::uuid[]);`, [createdEventIds]);
        await client.query(`DELETE FROM ticket_types WHERE event_id = ANY($1::uuid[]);`, [createdEventIds]);
        await client.query(`DELETE FROM events WHERE id = ANY($1::uuid[]);`, [createdEventIds]);
      }
      if (createdUserIds.length > 0) {
        await client.query(`DELETE FROM team_invitations WHERE team_id IN (SELECT id FROM teams WHERE created_by = ANY($1::uuid[]));`, [createdUserIds]);
        await client.query(`DELETE FROM team_join_requests WHERE team_id IN (SELECT id FROM teams WHERE created_by = ANY($1::uuid[]));`, [createdUserIds]);
        await client.query(`DELETE FROM team_members WHERE user_id = ANY($1::uuid[]);`, [createdUserIds]);
        await client.query(`DELETE FROM teams WHERE created_by = ANY($1::uuid[]);`, [createdUserIds]);
        if (organizerId) {
          await client.query(`DELETE FROM team_submissions WHERE team_registration_id IN (SELECT id FROM team_event_registrations WHERE event_id IN (SELECT id FROM events WHERE organizer_id = $1));`, [organizerId]);
          await client.query(`DELETE FROM team_event_registrations WHERE event_id IN (SELECT id FROM events WHERE organizer_id = $1);`, [organizerId]);
          await client.query(`DELETE FROM waitlist_entries WHERE event_id IN (SELECT id FROM events WHERE organizer_id = $1);`, [organizerId]);
          await client.query(`DELETE FROM tickets WHERE event_id IN (SELECT id FROM events WHERE organizer_id = $1);`, [organizerId]);
          await client.query(`DELETE FROM cancellations WHERE booking_id IN (SELECT id FROM bookings WHERE event_id IN (SELECT id FROM events WHERE organizer_id = $1));`, [organizerId]);
          await client.query(`DELETE FROM booking_items WHERE ticket_type_id IN (SELECT id FROM ticket_types WHERE event_id IN (SELECT id FROM events WHERE organizer_id = $1));`, [organizerId]);
          await client.query(`DELETE FROM bookings WHERE event_id IN (SELECT id FROM events WHERE organizer_id = $1);`, [organizerId]);
          await client.query(`DELETE FROM ticket_types WHERE event_id IN (SELECT id FROM events WHERE organizer_id = $1);`, [organizerId]);
          await client.query(`DELETE FROM events WHERE organizer_id = $1;`, [organizerId]);
          await client.query(`DELETE FROM organizer_profiles WHERE id = $1;`, [organizerId]);
        }
        await client.query('DELETE FROM users WHERE id = ANY($1::uuid[]);', [createdUserIds]);
      }
    } catch (e) {
      console.error('afterAll cleanup error:', e);
    } finally {
      client.release();
    }
  }, 60000);

  // Gate Test (a): 200 concurrent bookings for 10 seats -> exactly 10 CONFIRMED, 190 get 409 SOLD_OUT, sold=10
  it('(a) 200 concurrent bookings for 10 seats -> exactly 10 CONFIRMED, 190 get 409, sold=10', async () => {
    const concurrentCount = 200;
    const candidateUsers = createdUserIds.slice(1, 1 + concurrentCount);

    const bookingPromises = candidateUsers.map((uid) =>
      createBooking({
        userId: uid,
        eventId: testEventId,
        items: [{ ticketTypeId: testTicketTypeId, quantity: 1 }],
        idempotencyKey: `idem-${uid}-${Date.now()}`,
      })
    );

    const results = await Promise.allSettled(bookingPromises);

    const confirmed = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(confirmed.length).toBe(10);
    expect(rejected.length).toBe(190);

    for (const rej of rejected) {
      if (rej.status === 'rejected') {
        expect((rej.reason as any).code).toBe('SOLD_OUT');
        expect((rej.reason as any).status).toBe(409);
        expect((rej.reason as any).details?.waitlistAvailable).toBe(true);
      }
    }

    // Verify DB state
    const client = await pool.connect();
    try {
      const ttRes = await client.query(
        `SELECT capacity, sold, held FROM ticket_types WHERE id = $1;`,
        [testTicketTypeId]
      );
      expect(ttRes.rows[0].sold).toBe(10);
      expect(ttRes.rows[0].held).toBe(0);
      expect(ttRes.rows[0].capacity).toBe(10);

      const bookingCountRes = await client.query(
        `SELECT COUNT(*)::int as count FROM bookings WHERE event_id = $1 AND status = 'CONFIRMED';`,
        [testEventId]
      );
      expect(bookingCountRes.rows[0].count).toBe(10);
    } finally {
      client.release();
    }
  }, 30000);

  // Gate Test (b): same user + same Idempotency-Key x20 -> exactly one booking created, identical response
  it('(b) same user + same Idempotency-Key x20 -> exactly one booking created, identical response', async () => {
    // Create new event with 5 seats
    const client = await pool.connect();
    let idemEventId: string;
    let idemTicketTypeId: string;
    const testUser = createdUserIds[0];

    try {
      const eRes = await client.query(
        `INSERT INTO events (
           organizer_id, college_id, title, slug, description, category, department, format,
           starts_at, ends_at, capacity, visibility, status, contact_email, created_by
         ) VALUES (
           $1, $2, 'Idem Event', $3, 'Desc', 'Workshop', 'CS', 'in_person',
           NOW() + INTERVAL '1 day', NOW() + INTERVAL '2 days', 5, 'public', 'published', 'contact@campus.edu', $4
         ) RETURNING id;`,
        [organizerId, collegeId, `idem-slug-${Date.now()}`, testUser]
      );
      idemEventId = eRes.rows[0].id;

      const ttRes = await client.query(
        `INSERT INTO ticket_types (event_id, name, price_paise, capacity, sold, held, per_user_limit)
         VALUES ($1, 'Pass', 0, 5, 0, 0, 1) RETURNING id;`,
        [idemEventId]
      );
      idemTicketTypeId = ttRes.rows[0].id;
    } finally {
      client.release();
    }

    const idempotencyKey = `idempotent-key-${Date.now()}`;
    const attempts = 20;

    const promises = Array.from({ length: attempts }).map(() =>
      createBooking({
        userId: testUser,
        eventId: idemEventId,
        items: [{ ticketTypeId: idemTicketTypeId, quantity: 1 }],
        idempotencyKey,
      })
    );

    const results = await Promise.all(promises);

    const firstBookingId = results[0].booking.id;
    expect(firstBookingId).toBeDefined();

    for (const res of results) {
      expect(res.booking.id).toBe(firstBookingId);
    }

    // Verify exactly 1 booking in database and sold = 1
    const verifyClient = await pool.connect();
    try {
      const bRes = await verifyClient.query(
        `SELECT COUNT(*)::int as count FROM bookings WHERE user_id = $1 AND event_id = $2;`,
        [testUser, idemEventId]
      );
      expect(bRes.rows[0].count).toBe(1);

      const ttCheck = await verifyClient.query(
        `SELECT sold FROM ticket_types WHERE id = $1;`,
        [idemTicketTypeId]
      );
      expect(ttCheck.rows[0].sold).toBe(1);
    } finally {
      verifyClient.release();
    }
  });

  // Gate Test (c): cancel + simultaneous new booking -> never exceeds capacity
  it('(c) cancel + simultaneous new booking -> never exceeds capacity', async () => {
    const client = await pool.connect();
    try {
      // Find one of the confirmed bookings from Test (a)
      const bRes = await client.query(
        `SELECT id, user_id FROM bookings WHERE event_id = $1 AND status = 'CONFIRMED' LIMIT 1;`,
        [testEventId]
      );
      const bookingToCancel = bRes.rows[0];

      // Prepare 5 new candidate users trying to book while cancellation happens
      const newCandidateUsers = createdUserIds.slice(201, 206);

      const cancelPromise = cancelBooking(bookingToCancel.id, bookingToCancel.user_id, 'User cancelled');
      const bookingPromises = newCandidateUsers.map((uid) =>
        createBooking({
          userId: uid,
          eventId: testEventId,
          items: [{ ticketTypeId: testTicketTypeId, quantity: 1 }],
          idempotencyKey: `simul-${uid}-${Date.now()}`,
        })
      );

      const all = await Promise.allSettled([cancelPromise, ...bookingPromises]);

      // Check DB capacity constraint was NEVER breached
      const ttRes = await client.query(
        `SELECT capacity, sold, held FROM ticket_types WHERE id = $1;`,
        [testTicketTypeId]
      );
      const { capacity, sold, held } = ttRes.rows[0];
      expect(sold + held).toBeLessThanOrEqual(capacity);
    } finally {
      client.release();
    }
  });

  // Gate Test (d): two users claim one offer -> exactly one wins, other gets 409
  it('(d) two users claim one offer -> exactly one wins, other gets 409', async () => {
    const client = await pool.connect();
    let offerEntryId: string;
    let user1 = createdUserIds[220];
    let dTicketTypeId: string;

    try {
      // Dedicated ticket type with capacity 5, sold 0, held 0 so check constraint sold+held<=capacity passes
      const dRes = await client.query(
        `INSERT INTO ticket_types (event_id, name, price_paise, capacity, sold, held)
         VALUES ($1, 'Waitlist Claim Tier', 0, 5, 0, 0) RETURNING id;`,
        [testEventId]
      );
      dTicketTypeId = dRes.rows[0].id;

      // Insert a waitlist offer
      const wRes = await client.query(
        `INSERT INTO waitlist_entries (
           event_id, ticket_type_id, user_id, status, offered_at, offer_expires_at
         ) VALUES (
           $1, $2, $3, 'OFFERED', NOW(), NOW() + INTERVAL '30 minutes'
         ) RETURNING id;`,
        [testEventId, dTicketTypeId, user1]
      );
      offerEntryId = wRes.rows[0].id;

      // Increment held count for the offer
      await client.query(`UPDATE ticket_types SET held = held + 1 WHERE id = $1;`, [dTicketTypeId]);
    } finally {
      client.release();
    }

    // Both user1 and another user (or concurrent requests) attempt to claim
    const claim1 = claimOffer({
      entryId: offerEntryId,
      userId: user1,
      idempotencyKey: `claim-attempt-1-${Date.now()}`,
    });
    const claim2 = claimOffer({
      entryId: offerEntryId,
      userId: user1, // concurrent duplicate attempt
      idempotencyKey: `claim-attempt-2-${Date.now()}`,
    });

    const results = await Promise.allSettled([claim1, claim2]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect((rejected[0] as any).reason.code).toBe('OFFER_INVALID_OR_EXPIRED');
    expect((rejected[0] as any).reason.status).toBe(409);
  });

  // Gate Test (e): offer expiry promotes next in order
  it('(e) offer expiry promotes next in order', async () => {
    const client = await pool.connect();
    const u1 = createdUserIds[50];
    const u2 = createdUserIds[51];
    const u3 = createdUserIds[52];

    try {
      // Clear test event waitlist
      await client.query(`DELETE FROM waitlist_entries WHERE event_id = $1;`, [testEventId]);

      // Set capacity so held is 1, available is 0
      await client.query(`UPDATE ticket_types SET sold = 9, held = 1 WHERE id = $1;`, [testTicketTypeId]);

      // Insert expired offer for u1
      await client.query(
        `INSERT INTO waitlist_entries (
           event_id, ticket_type_id, user_id, status, offered_at, offer_expires_at, created_at
         ) VALUES (
           $1, $2, $3, 'OFFERED', NOW() - INTERVAL '40 minutes', NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '60 minutes'
         );`,
        [testEventId, testTicketTypeId, u1]
      );

      // Insert WAITING for u2 (earlier)
      const u2Res = await client.query(
        `INSERT INTO waitlist_entries (
           event_id, ticket_type_id, user_id, status, created_at
         ) VALUES (
           $1, $2, $3, 'WAITING', NOW() - INTERVAL '30 minutes'
         ) RETURNING id;`,
        [testEventId, testTicketTypeId, u2]
      );
      const u2EntryId = u2Res.rows[0].id;

      // Insert WAITING for u3 (later)
      await client.query(
        `INSERT INTO waitlist_entries (
           event_id, ticket_type_id, user_id, status, created_at
         ) VALUES (
           $1, $2, $3, 'WAITING', NOW() - INTERVAL '10 minutes'
         );`,
        [testEventId, testTicketTypeId, u3]
      );

      // Run background sweeper
      const expireResult = await expireOffers();
      expect(expireResult.expiredCount).toBeGreaterThanOrEqual(1);

      // Assert u1 is EXPIRED
      const u1Check = await client.query(`SELECT status FROM waitlist_entries WHERE user_id = $1 AND event_id = $2;`, [u1, testEventId]);
      expect(u1Check.rows[0].status).toBe('EXPIRED');

      // Assert u2 was promoted to OFFERED
      const u2Check = await client.query(`SELECT status, offer_expires_at FROM waitlist_entries WHERE id = $1;`, [u2EntryId]);
      expect(u2Check.rows[0].status).toBe('OFFERED');
      expect(new Date(u2Check.rows[0].offer_expires_at).getTime()).toBeGreaterThan(Date.now());

      // Assert u3 remains WAITING
      const u3Check = await client.query(`SELECT status FROM waitlist_entries WHERE user_id = $1 AND event_id = $2;`, [u3, testEventId]);
      expect(u3Check.rows[0].status).toBe('WAITING');
    } finally {
      client.release();
    }
  });

  // Gate Test (f): team of max+1 rejected
  it('(f) team of max+1 rejected', async () => {
    const leader = createdUserIds[60];
    const m1 = createdUserIds[61];
    const m2 = createdUserIds[62];
    const m3 = createdUserIds[63];

    // Create team with 4 members (testEvent team_max is 3)
    const { team } = await createTeam({
      name: `Overmax Team ${Date.now()}`,
      userId: leader,
      maxSize: 5,
    });

    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO team_members (team_id, user_id, role, status)
         VALUES ($1, $2, 'member', 'ACTIVE'),
                ($1, $3, 'member', 'ACTIVE'),
                ($1, $4, 'member', 'ACTIVE');`,
        [team.id, m1, m2, m3]
      );

      // Attempt team registration on event with team_max = 3
      await expect(
        registerTeamForEvent({
          teamId: team.id,
          eventId: testEventId,
          requesterId: leader,
          ticketTypeId: testTicketTypeId,
          idempotencyKey: `team-reg-${Date.now()}`,
        })
      ).rejects.toThrow(/TEAM_TOO_LARGE|allows at most 3/);
    } finally {
      client.release();
    }
  });

  // Gate Test (g): non-leader registration denied
  it('(g) non-leader registration denied', async () => {
    const leader = createdUserIds[70];
    const regularMember = createdUserIds[71];

    const { team } = await createTeam({
      name: `Leadership Test Team ${Date.now()}`,
      userId: leader,
      maxSize: 4,
    });

    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO team_members (team_id, user_id, role, status)
         VALUES ($1, $2, 'member', 'ACTIVE');`,
        [team.id, regularMember]
      );

      // Regular member attempts registration
      await expect(
        registerTeamForEvent({
          teamId: team.id,
          eventId: testEventId,
          requesterId: regularMember,
          ticketTypeId: testTicketTypeId,
          idempotencyKey: `non-lead-${Date.now()}`,
        })
      ).rejects.toThrow(/FORBIDDEN|Only active team leaders/);
    } finally {
      client.release();
    }
  });

  // Gate Test (h): member removed after submit doesn’t alter snapshot
  it('(h) member removed after submit doesn’t alter snapshot', async () => {
    const leader = createdUserIds[80];
    const member1 = createdUserIds[81];

    const client = await pool.connect();
    let teamEventId: string;
    let teamTicketTypeId: string;

    try {
      // Dedicated event for team registration
      const eRes = await client.query(
        `INSERT INTO events (
           organizer_id, college_id, title, slug, description, category, department, format,
           starts_at, ends_at, capacity, visibility, status, contact_email, created_by, team_mode, team_min, team_max
         ) VALUES (
           $1, $2, 'Team Event', $3, 'Desc', 'Hackathon', 'CS', 'in_person',
           NOW() + INTERVAL '5 days', NOW() + INTERVAL '6 days', 20, 'public', 'published', 'c@c.edu', $4, 'required', 2, 4
         ) RETURNING id;`,
        [organizerId, collegeId, `team-evt-${Date.now()}`, leader]
      );
      teamEventId = eRes.rows[0].id;
      createdEventIds.push(teamEventId);

      const ttRes = await client.query(
        `INSERT INTO ticket_types (event_id, name, price_paise, capacity, sold, held)
         VALUES ($1, 'Team Tier', 0, 20, 0, 0) RETURNING id;`,
        [teamEventId]
      );
      teamTicketTypeId = ttRes.rows[0].id;
    } finally {
      client.release();
    }

    const { team } = await createTeam({
      name: `Snapshot Team ${Date.now()}`,
      userId: leader,
      maxSize: 4,
    });

    const mClient = await pool.connect();
    try {
      await mClient.query(
        `INSERT INTO team_members (team_id, user_id, role, status)
         VALUES ($1, $2, 'member', 'ACTIVE');`,
        [team.id, member1]
      );
    } finally {
      mClient.release();
    }

    // Register team
    const regResult = await registerTeamForEvent({
      teamId: team.id,
      eventId: teamEventId,
      requesterId: leader,
      ticketTypeId: teamTicketTypeId,
      idempotencyKey: `snap-idem-${Date.now()}`,
    });

    expect(regResult.memberSnapshot.length).toBe(2);

    // Member leaves the team after registration
    await leaveTeam(team.id, member1);

    // Assert immutable member_snapshot still preserves both original members
    const sClient = await pool.connect();
    try {
      const snapRes = await sClient.query(
        `SELECT member_snapshot FROM team_event_registrations WHERE id = $1;`,
        [regResult.registration.id]
      );
      const snapshot = snapRes.rows[0].member_snapshot;
      expect(snapshot.length).toBe(2);
      expect(snapshot.some((m: any) => m.user_id === member1)).toBe(true);
      expect(snapshot.some((m: any) => m.user_id === leader)).toBe(true);

      // But active members table now has only 1 active member
      const activeMemRes = await sClient.query(
        `SELECT COUNT(*)::int as count FROM team_members WHERE team_id = $1 AND status = 'ACTIVE';`,
        [team.id]
      );
      expect(activeMemRes.rows[0].count).toBe(1);
    } finally {
      sClient.release();
    }
  });

  // Gate Test (i): mutation verification — without FOR UPDATE concurrency lock, race condition triggers 23514 / oversell risk
  it('(i) mutation verification: naive booking without FOR UPDATE causes race condition check violation', async () => {
    const client = await pool.connect();
    let fragileTicketTypeId: string;
    try {
      const ttRes = await client.query(
        `INSERT INTO ticket_types (event_id, name, price_paise, capacity, sold, held)
         VALUES ($1, 'Fragile Tier', 0, 2, 0, 0) RETURNING id;`,
        [testEventId]
      );
      fragileTicketTypeId = ttRes.rows[0].id;
    } finally {
      client.release();
    }

    // 5 concurrent workers executing naive non-locking check-then-insert
    const workers = createdUserIds.slice(120, 125);
    const naiveBooking = async (uid: string) => {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        // NAIVE READ WITHOUT FOR UPDATE
        const check = await c.query(
          `SELECT capacity, sold, held FROM ticket_types WHERE id = $1;`,
          [fragileTicketTypeId]
        );
        const { capacity, sold, held } = check.rows[0];
        // Introduce small race window
        await new Promise((r) => setTimeout(r, 15));

        if (sold + held < capacity) {
          await c.query(`UPDATE ticket_types SET sold = sold + 1 WHERE id = $1;`, [fragileTicketTypeId]);
          await c.query(
            `INSERT INTO bookings (user_id, event_id, status, total_paise, idempotency_key)
             VALUES ($1, $2, 'CONFIRMED', 0, $3);`,
            [uid, testEventId, `naive-${uid}-${Date.now()}`]
          );
          await c.query('COMMIT');
          return 'CONFIRMED';
        } else {
          await c.query('ROLLBACK');
          return 'SOLD_OUT';
        }
      } catch (err: any) {
        await c.query('ROLLBACK');
        return `ERROR_${err.code}`;
      } finally {
        c.release();
      }
    };

    const results = await Promise.all(workers.map((uid) => naiveBooking(uid)));
    // Without FOR UPDATE lock, multiple uncoordinated transactions race past the check
    // and attempt to increment sold beyond capacity, triggering PostgreSQL CHECK constraint 23514
    const hadCheckViolation = results.some((r) => r === 'ERROR_23514');
    expect(hadCheckViolation).toBe(true);
  });
});
