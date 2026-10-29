import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../../packages/backend/src/db/index.js';
import { joinWaitlist, claimOffer, declineOffer, promoteNext } from '../../packages/backend/src/services/waitlist.js';
import { runRollbackToVersion } from '../../packages/backend/src/db/migrate-down.js';
import { runMigrations } from '../../packages/backend/src/db/migrate.js';
import crypto from 'crypto';

describe('Phase P17: Waitlist & Offer Claim Lifecycle', () => {
  let collegeId: string;
  let organizerId: string;
  let leadUserId: string;
  const createdUserIds: string[] = [];
  const createdEventIds: string[] = [];

  beforeAll(async () => {
    const client = await pool.connect();
    try {
      const cRes = await client.query('SELECT id FROM colleges LIMIT 1;');
      collegeId = cRes.rows[0].id;

      const userRes = await client.query(
        `INSERT INTO users (college_id, email, password_hash, display_name, global_role, status)
         VALUES ($1, $2, 'hash', 'Waitlist Lead Organizer', 'student', 'active')
         RETURNING id;`,
        [collegeId, `waitlist.lead.${Date.now()}@campus.edu`]
      );
      leadUserId = userRes.rows[0].id;
      createdUserIds.push(leadUserId);

      const orgRes = await client.query(
        `INSERT INTO organizer_profiles (college_id, display_name, status, created_by)
         VALUES ($1, 'Waitlist Club', 'verified', $2)
         RETURNING id;`,
        [collegeId, leadUserId]
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
        await client.query(`DELETE FROM tickets WHERE event_id = ANY($1::uuid[]);`, [createdEventIds]);
        await client.query(`DELETE FROM booking_items WHERE booking_id IN (SELECT id FROM bookings WHERE event_id = ANY($1::uuid[]));`, [createdEventIds]);
        await client.query(`DELETE FROM bookings WHERE event_id = ANY($1::uuid[]);`, [createdEventIds]);
        await client.query(`DELETE FROM ticket_types WHERE event_id = ANY($1::uuid[]);`, [createdEventIds]);
        await client.query(`DELETE FROM events WHERE id = ANY($1::uuid[]);`, [createdEventIds]);
      }
      if (organizerId) {
        await client.query(`DELETE FROM organizer_profiles WHERE id = $1;`, [organizerId]);
      }
      if (createdUserIds.length > 0) {
        await client.query(`DELETE FROM users WHERE id = ANY($1::uuid[]);`, [createdUserIds]);
      }
    } finally {
      client.release();
    }
  });

  async function createTestUser(tag: string) {
    const client = await pool.connect();
    try {
      const res = await client.query(
        `INSERT INTO users (college_id, email, password_hash, display_name, global_role, status)
         VALUES ($1, $2, 'hash', $3, 'student', 'active')
         RETURNING id;`,
        [collegeId, `wl.${tag}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}@campus.edu`, `User ${tag}`]
      );
      const uid = res.rows[0].id;
      createdUserIds.push(uid);
      return uid;
    } finally {
      client.release();
    }
  }

  async function createTestEvent(overrides: Record<string, any> = {}) {
    const client = await pool.connect();
    try {
      const title = overrides.title || `Waitlist Event ${Date.now()}`;
      const slug = overrides.slug || `wl-evt-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      const status = overrides.status || 'published';
      const registrationClosesAt = overrides.registrationClosesAt || null;

      const res = await client.query(
        `INSERT INTO events (
           organizer_id, college_id, title, slug, description, category, department, format,
           starts_at, ends_at, capacity, visibility, status, contact_email, created_by,
           registration_opens_at, registration_closes_at
         ) VALUES (
           $1, $2, $3, $4, 'Test Desc', 'Technology', 'Computer Science', 'in_person',
           NOW() + INTERVAL '5 days', NOW() + INTERVAL '6 days', 5, 'public', $5, 'contact@campus.edu', $6,
           NOW() - INTERVAL '1 day', $7
         ) RETURNING id;`,
        [organizerId, collegeId, title, slug, status, leadUserId, registrationClosesAt]
      );
      const eid = res.rows[0].id;
      createdEventIds.push(eid);
      return eid;
    } finally {
      client.release();
    }
  }

  // 1. Database Migration 20 integrity
  it('schema version is 20 with booking_id column and DECLINED enum', async () => {
    const client = await pool.connect();
    try {
      const vRes = await client.query('SELECT MAX(version) as version FROM schema_migrations;');
      expect(Number(vRes.rows[0].version)).toBeGreaterThanOrEqual(20);

      const colRes = await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'waitlist_entries' AND column_name = 'booking_id';`
      );
      expect(colRes.rows.length).toBe(1);

      const enumRes = await client.query(
        `SELECT enumlabel FROM pg_enum
         JOIN pg_type ON pg_enum.enumtypid = pg_type.oid
         WHERE pg_type.typname = 'waitlist_status' AND enumlabel = 'DECLINED';`
      );
      expect(enumRes.rows.length).toBe(1);
    } finally {
      client.release();
    }
  });

  // 2. joinWaitlist: Reject if tier is not sold out (capacity available)
  it('joinWaitlist: rejects with 400 TIER_NOT_SOLD_OUT when tier has available seats', async () => {
    const eventId = await createTestEvent();
    const client = await pool.connect();
    let tierId: string;
    try {
      const ttRes = await client.query(
        `INSERT INTO ticket_types (event_id, name, price_paise, capacity, sold, held)
         VALUES ($1, 'Available Tier', 0, 10, 2, 1) RETURNING id;`,
        [eventId]
      );
      tierId = ttRes.rows[0].id;
    } finally {
      client.release();
    }

    const userId = await createTestUser('avail');
    await expect(
      joinWaitlist({ userId, eventId, ticketTypeId: tierId })
    ).rejects.toThrowError(
      expect.objectContaining({
        code: 'TIER_NOT_SOLD_OUT',
        status: 400,
      })
    );
  });

  // 3. joinWaitlist: Reject if user already has an active booking for this event (ALREADY_REGISTERED)
  it('joinWaitlist: rejects with 409 ALREADY_REGISTERED if user is already booked for this event', async () => {
    const eventId = await createTestEvent();
    const client = await pool.connect();
    let soldOutTierId: string;
    const userId = await createTestUser('already-booked');

    try {
      const ttRes = await client.query(
        `INSERT INTO ticket_types (event_id, name, price_paise, capacity, sold, held)
         VALUES ($1, 'Sold Out Tier', 0, 5, 5, 0) RETURNING id;`,
        [eventId]
      );
      soldOutTierId = ttRes.rows[0].id;

      // Create confirmed booking for user on this event
      await client.query(
        `INSERT INTO bookings (user_id, event_id, status, total_paise, idempotency_key)
         VALUES ($1, $2, 'CONFIRMED', 0, $3);`,
        [userId, eventId, `idem-prebook-${Date.now()}`]
      );
    } finally {
      client.release();
    }

    await expect(
      joinWaitlist({ userId, eventId, ticketTypeId: soldOutTierId })
    ).rejects.toThrowError(
      expect.objectContaining({
        code: 'ALREADY_REGISTERED',
        status: 409,
      })
    );
  });

  // 4. joinWaitlist: Reject if event registration has closed
  it('joinWaitlist: rejects with 400 REGISTRATION_CLOSED if registration window closed', async () => {
    const eventId = await createTestEvent({
      registrationClosesAt: new Date(Date.now() - 60000).toISOString(),
    });
    const client = await pool.connect();
    let soldOutTierId: string;
    const userId = await createTestUser('closed-reg');

    try {
      const ttRes = await client.query(
        `INSERT INTO ticket_types (event_id, name, price_paise, capacity, sold, held)
         VALUES ($1, 'Sold Out Tier', 0, 5, 5, 0) RETURNING id;`,
        [eventId]
      );
      soldOutTierId = ttRes.rows[0].id;
    } finally {
      client.release();
    }

    await expect(
      joinWaitlist({ userId, eventId, ticketTypeId: soldOutTierId })
    ).rejects.toThrowError(
      expect.objectContaining({
        code: 'REGISTRATION_CLOSED',
        status: 400,
      })
    );
  });

  // 5. joinWaitlist: Concurrent join handles unique constraint and returns alreadyQueued: true
  it('joinWaitlist: successful join and duplicate returns alreadyQueued: true', async () => {
    const eventId = await createTestEvent();
    const client = await pool.connect();
    let soldOutTierId: string;
    const userId = await createTestUser('dedup');

    try {
      const ttRes = await client.query(
        `INSERT INTO ticket_types (event_id, name, price_paise, capacity, sold, held)
         VALUES ($1, 'Sold Out Tier', 0, 5, 5, 0) RETURNING id;`,
        [eventId]
      );
      soldOutTierId = ttRes.rows[0].id;
    } finally {
      client.release();
    }

    const firstJoin = await joinWaitlist({ userId, eventId, ticketTypeId: soldOutTierId });
    expect(firstJoin.alreadyQueued).toBe(false);
    expect(firstJoin.position).toBe(1);

    const secondJoin = await joinWaitlist({ userId, eventId, ticketTypeId: soldOutTierId });
    expect(secondJoin.alreadyQueued).toBe(true);
    expect(secondJoin.entry.id).toBe(firstJoin.entry.id);
  });

  // 6. promoteNext: Does NOT promote for unpublished events
  it('promoteNext: skips promotion if event is not published', async () => {
    const draftEventId = await createTestEvent({ status: 'draft' });
    const client = await pool.connect();
    let draftTierId: string;
    const waitingUser = await createTestUser('waiting-draft');

    try {
      const ttRes = await client.query(
        `INSERT INTO ticket_types (event_id, name, price_paise, capacity, sold, held)
         VALUES ($1, 'Draft Tier', 0, 5, 0, 0) RETURNING id;`,
        [draftEventId]
      );
      draftTierId = ttRes.rows[0].id;

      await client.query(
        `INSERT INTO waitlist_entries (event_id, ticket_type_id, user_id, status)
         VALUES ($1, $2, $3, 'WAITING');`,
        [draftEventId, draftTierId, waitingUser]
      );
    } finally {
      client.release();
    }

    const promoResult = await promoteNext(draftTierId);
    expect(promoResult).toBeNull();

    // Verify entry is still WAITING
    const verifyClient = await pool.connect();
    try {
      const checkRes = await verifyClient.query(
        `SELECT status FROM waitlist_entries WHERE ticket_type_id = $1 AND user_id = $2;`,
        [draftTierId, waitingUser]
      );
      expect(checkRes.rows[0].status).toBe('WAITING');
    } finally {
      verifyClient.release();
    }
  });

  // 7. claimOffer: Missing claim token rejected with 400 MISSING_CLAIM_TOKEN
  it('claimOffer: rejects missing or empty claimToken with 400 MISSING_CLAIM_TOKEN', async () => {
    const eventId = await createTestEvent();
    const client = await pool.connect();
    let tierId: string;
    const user = await createTestUser('token-check');

    try {
      const ttRes = await client.query(
        `INSERT INTO ticket_types (event_id, name, price_paise, capacity, sold, held)
         VALUES ($1, 'Token Tier', 0, 1, 1, 0) RETURNING id;`,
        [eventId]
      );
      tierId = ttRes.rows[0].id;

      await client.query(
        `INSERT INTO waitlist_entries (event_id, ticket_type_id, user_id, status)
         VALUES ($1, $2, $3, 'WAITING');`,
        [eventId, tierId, user]
      );

      // Free up capacity so promoteNext creates an offer with claim_token_hash
      await client.query(`UPDATE ticket_types SET sold = 0 WHERE id = $1;`, [tierId]);
    } finally {
      client.release();
    }

    const promo = await promoteNext(tierId);
    expect(promo).not.toBeNull();
    const entryId = promo!.offeredEntry.id;

    // Missing claimToken (undefined or empty)
    await expect(
      claimOffer({
        entryId,
        userId: user,
        idempotencyKey: `idem-missing-token-${Date.now()}`,
      })
    ).rejects.toThrowError(
      expect.objectContaining({
        code: 'MISSING_CLAIM_TOKEN',
        status: 400,
      })
    );

    await expect(
      claimOffer({
        entryId,
        userId: user,
        claimToken: '   ',
        idempotencyKey: `idem-empty-token-${Date.now()}`,
      })
    ).rejects.toThrowError(
      expect.objectContaining({
        code: 'MISSING_CLAIM_TOKEN',
        status: 400,
      })
    );
  });

  // 8. claimOffer: Paid tier creates PENDING_PAYMENT booking, retains held seat, no ticket
  it('claimOffer on PAID tier: creates PENDING_PAYMENT booking, retains held seat, generates NO ticket', async () => {
    const eventId = await createTestEvent();
    const client = await pool.connect();
    let paidTierId: string;
    const user = await createTestUser('paid-claim');

    try {
      const ttRes = await client.query(
        `INSERT INTO ticket_types (event_id, name, price_paise, capacity, sold, held)
         VALUES ($1, 'VIP Pass', 150000, 1, 1, 0) RETURNING id;`,
        [eventId]
      );
      paidTierId = ttRes.rows[0].id;

      await client.query(
        `INSERT INTO waitlist_entries (event_id, ticket_type_id, user_id, status)
         VALUES ($1, $2, $3, 'WAITING');`,
        [eventId, paidTierId, user]
      );

      // Release sold so promoteNext can offer
      await client.query(`UPDATE ticket_types SET sold = 0 WHERE id = $1;`, [paidTierId]);
    } finally {
      client.release();
    }

    const promo = await promoteNext(paidTierId);
    expect(promo).not.toBeNull();
    const entryId = promo!.offeredEntry.id;
    const claimToken = promo!.claimToken;

    // Claim paid offer
    const claimResult = await claimOffer({
      entryId,
      userId: user,
      claimToken,
      idempotencyKey: `idem-paid-claim-${Date.now()}`,
    });

    expect(claimResult.booking.status).toBe('PENDING_PAYMENT');
    expect(claimResult.booking.total_paise).toBe(150000);
    expect(claimResult.checkoutRequired).toBe(true);
    expect(claimResult.requiresPayment).toBe(true);
    expect((claimResult as any).ticket).toBeUndefined();

    // Verify database invariants:
    // Seat must REMAIN in held (held = 1, sold = 0)
    const checkClient = await pool.connect();
    try {
      const ttCheck = await checkClient.query(`SELECT sold, held FROM ticket_types WHERE id = $1;`, [paidTierId]);
      expect(ttCheck.rows[0].held).toBe(1);
      expect(ttCheck.rows[0].sold).toBe(0);

      // booking_id on waitlist_entries must be populated
      const wlCheck = await checkClient.query(`SELECT status, booking_id FROM waitlist_entries WHERE id = $1;`, [entryId]);
      expect(wlCheck.rows[0].status).toBe('CLAIMED');
      expect(wlCheck.rows[0].booking_id).toBe(claimResult.booking.id);

      // NO ticket row should exist for this booking
      const tCheck = await checkClient.query(`SELECT COUNT(*)::int as count FROM tickets WHERE booking_id = $1;`, [claimResult.booking.id]);
      expect(tCheck.rows[0].count).toBe(0);
    } finally {
      checkClient.release();
    }
  });

  // 9. claimOffer: Free tier creates CONFIRMED booking, converts held -> sold, generates ticket
  it('claimOffer on FREE tier: creates CONFIRMED booking, converts held to sold, generates ticket', async () => {
    const eventId = await createTestEvent();
    const client = await pool.connect();
    let freeTierId: string;
    const user = await createTestUser('free-claim');

    try {
      const ttRes = await client.query(
        `INSERT INTO ticket_types (event_id, name, price_paise, capacity, sold, held)
         VALUES ($1, 'Free Pass', 0, 1, 1, 0) RETURNING id;`,
        [eventId]
      );
      freeTierId = ttRes.rows[0].id;

      await client.query(
        `INSERT INTO waitlist_entries (event_id, ticket_type_id, user_id, status)
         VALUES ($1, $2, $3, 'WAITING');`,
        [eventId, freeTierId, user]
      );

      await client.query(`UPDATE ticket_types SET sold = 0 WHERE id = $1;`, [freeTierId]);
    } finally {
      client.release();
    }

    const promo = await promoteNext(freeTierId);
    expect(promo).not.toBeNull();
    const entryId = promo!.offeredEntry.id;
    const claimToken = promo!.claimToken;

    const claimResult = await claimOffer({
      entryId,
      userId: user,
      claimToken,
      idempotencyKey: `idem-free-claim-${Date.now()}`,
    });

    expect(claimResult.booking.status).toBe('CONFIRMED');
    expect(claimResult.ticket).toBeDefined();
    expect(claimResult.ticket?.ticket_code).toBeDefined();

    // Verify database state: held = 0, sold = 1
    const checkClient = await pool.connect();
    try {
      const ttCheck = await checkClient.query(`SELECT sold, held FROM ticket_types WHERE id = $1;`, [freeTierId]);
      expect(ttCheck.rows[0].held).toBe(0);
      expect(ttCheck.rows[0].sold).toBe(1);

      const wlCheck = await checkClient.query(`SELECT status, booking_id FROM waitlist_entries WHERE id = $1;`, [entryId]);
      expect(wlCheck.rows[0].status).toBe('CLAIMED');
      expect(wlCheck.rows[0].booking_id).toBe(claimResult.booking.id);
    } finally {
      checkClient.release();
    }
  });

  // 10. claimOffer: Idempotency replay returns identical booking
  it('claimOffer: idempotency replay returns original booking and ticket', async () => {
    const eventId = await createTestEvent();
    const client = await pool.connect();
    let freeTierId: string;
    const user = await createTestUser('replay');

    try {
      const ttRes = await client.query(
        `INSERT INTO ticket_types (event_id, name, price_paise, capacity, sold, held)
         VALUES ($1, 'Replay Tier', 0, 1, 0, 0) RETURNING id;`,
        [eventId]
      );
      freeTierId = ttRes.rows[0].id;

      await client.query(
        `INSERT INTO waitlist_entries (event_id, ticket_type_id, user_id, status)
         VALUES ($1, $2, $3, 'WAITING');`,
        [eventId, freeTierId, user]
      );
    } finally {
      client.release();
    }

    const promo = await promoteNext(freeTierId);
    const entryId = promo!.offeredEntry.id;
    const claimToken = promo!.claimToken;
    const idempotencyKey = `idem-replay-${Date.now()}`;

    const res1 = await claimOffer({ entryId, userId: user, claimToken, idempotencyKey });
    const res2 = await claimOffer({ entryId, userId: user, claimToken, idempotencyKey });

    expect(res2.booking.id).toBe(res1.booking.id);
    expect(res2.idempotentReplay).toBe(true);
    expect(res2.ticket?.ticket_code).toBe(res1.ticket?.ticket_code);
  });

  // 11. declineOffer: Declining releases held capacity and promotes next in queue
  it('declineOffer: releases held capacity and promotes next waiting attendee', async () => {
    const eventId = await createTestEvent();
    const client = await pool.connect();
    let tierId: string;
    const user1 = await createTestUser('decliner');
    const user2 = await createTestUser('next-in-line');

    try {
      const ttRes = await client.query(
        `INSERT INTO ticket_types (event_id, name, price_paise, capacity, sold, held)
         VALUES ($1, 'Decline Flow Tier', 0, 1, 0, 0) RETURNING id;`,
        [eventId]
      );
      tierId = ttRes.rows[0].id;

      // user1 first
      await client.query(
        `INSERT INTO waitlist_entries (event_id, ticket_type_id, user_id, status, created_at)
         VALUES ($1, $2, $3, 'WAITING', NOW() - INTERVAL '10 minutes');`,
        [eventId, tierId, user1]
      );
      // user2 second
      await client.query(
        `INSERT INTO waitlist_entries (event_id, ticket_type_id, user_id, status, created_at)
         VALUES ($1, $2, $3, 'WAITING', NOW() - INTERVAL '5 minutes');`,
        [eventId, tierId, user2]
      );
    } finally {
      client.release();
    }

    // Promote user1
    const promo1 = await promoteNext(tierId);
    expect(promo1).not.toBeNull();
    expect(promo1!.offeredEntry.user_id).toBe(user1);

    // Decline offer for user1
    const declineRes = await declineOffer(promo1!.offeredEntry.id, user1);
    expect(declineRes.success).toBe(true);

    // Verify user1 entry is DECLINED
    const verifyClient = await pool.connect();
    try {
      const u1Check = await verifyClient.query(
        `SELECT status FROM waitlist_entries WHERE id = $1;`,
        [promo1!.offeredEntry.id]
      );
      expect(u1Check.rows[0].status).toBe('DECLINED');

      // user2 must now be OFFERED automatically by promoteNext
      const u2Check = await verifyClient.query(
        `SELECT status, claim_token_hash FROM waitlist_entries WHERE user_id = $1 AND ticket_type_id = $2;`,
        [user2, tierId]
      );
      expect(u2Check.rows[0].status).toBe('OFFERED');
      expect(u2Check.rows[0].claim_token_hash).toBeTruthy();

      // Held seats should still be 1 (now held for user2)
      const ttCheck = await verifyClient.query(`SELECT held, sold FROM ticket_types WHERE id = $1;`, [tierId]);
      expect(ttCheck.rows[0].held).toBe(1);
      expect(ttCheck.rows[0].sold).toBe(0);
    } finally {
      verifyClient.release();
    }
  });

  // 12. Migration rollback and re-apply test
  it('migration 20 down-migration to 19 and re-application to 20 preserves database integrity', async () => {
    try {
      // Down to 19
      await runRollbackToVersion(19);

      const client1 = await pool.connect();
      try {
        const v19 = await client1.query('SELECT MAX(version) as version FROM schema_migrations;');
        expect(Number(v19.rows[0].version)).toBe(19);

        const colCheck = await client1.query(
          `SELECT column_name FROM information_schema.columns
           WHERE table_name = 'waitlist_entries' AND column_name = 'booking_id';`
        );
        expect(colCheck.rows.length).toBe(0);
      } finally {
        client1.release();
      }
    } finally {
      // Re-apply to latest
      await runMigrations();
    }

    const client2 = await pool.connect();
    try {
      const v20 = await client2.query('SELECT MAX(version) as version FROM schema_migrations;');
      expect(Number(v20.rows[0].version)).toBeGreaterThanOrEqual(20);

      const colCheck = await client2.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'waitlist_entries' AND column_name = 'booking_id';`
      );
      expect(colCheck.rows.length).toBe(1);
    } finally {
      client2.release();
    }
  });
});
