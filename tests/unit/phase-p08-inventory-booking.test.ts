import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { buildApp } from '../../packages/backend/src/app.js';
import { pool } from '../../packages/backend/src/db/index.js';
import { createBooking, BookingError } from '../../packages/backend/src/services/booking.js';
import { cancelBooking } from '../../packages/backend/src/services/cancellation.js';
import {
  initiateCheckout,
  verifyPayment,
} from '../../packages/backend/src/services/payment.js';
import {
  runHoldReconciliationLeaderJob,
  HOLD_RECONCILER_ADVISORY_LOCK_ID,
} from '../../packages/backend/src/services/hold-reconciler.js';

describe('Phase P08: Inventory & Booking Correctness Quality Gate', () => {
  let app: any;
  let collegeId: string;
  let organizerId: string;
  let orgUserId: string;
  const createdUserIds: string[] = [];
  const createdEventIds: string[] = [];

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    const client = await pool.connect();
    try {
      const cRes = await client.query('SELECT id FROM colleges LIMIT 1;');
      collegeId = cRes.rows[0].id;

      const uRes = await client.query(
        `INSERT INTO users (college_id, email, password_hash, display_name, global_role, status)
         VALUES ($1, $2, 'hash', 'Organizer P08 Lead', 'student', 'active')
         RETURNING id;`,
        [collegeId, `org.p08.${Date.now()}@campus.edu`]
      );
      orgUserId = uRes.rows[0].id;
      createdUserIds.push(orgUserId);

      const pRes = await client.query(
        `INSERT INTO organizer_profiles (college_id, display_name, status, created_by)
         VALUES ($1, 'P08 Robotics Org', 'verified', $2)
         RETURNING id;`,
        [collegeId, orgUserId]
      );
      organizerId = pRes.rows[0].id;

      await client.query(
        `INSERT INTO organizer_members (organizer_id, user_id, role, status)
         VALUES ($1, $2, 'owner', 'active');`,
        [organizerId, orgUserId]
      );
    } finally {
      client.release();
    }
  }, 30000);

  afterAll(async () => {
    const client = await pool.connect();
    try {
      if (createdEventIds.length > 0) {
        await client.query(`DELETE FROM registration_answers WHERE booking_id IN (SELECT id FROM bookings WHERE event_id = ANY($1::uuid[]));`, [createdEventIds]);
        await client.query(`DELETE FROM registration_form_questions WHERE event_id = ANY($1::uuid[]);`, [createdEventIds]);
        await client.query(`DELETE FROM receipts WHERE booking_id IN (SELECT id FROM bookings WHERE event_id = ANY($1::uuid[]));`, [createdEventIds]);
        await client.query(`DELETE FROM organizer_ledger_entries WHERE booking_id IN (SELECT id FROM bookings WHERE event_id = ANY($1::uuid[]));`, [createdEventIds]);
        await client.query(`DELETE FROM payment_attempts WHERE payment_id IN (SELECT id FROM payments WHERE booking_id IN (SELECT id FROM bookings WHERE event_id = ANY($1::uuid[])));`, [createdEventIds]);
        await client.query(`DELETE FROM payments WHERE booking_id IN (SELECT id FROM bookings WHERE event_id = ANY($1::uuid[]));`, [createdEventIds]);
        await client.query(`DELETE FROM tickets WHERE event_id = ANY($1::uuid[]);`, [createdEventIds]);
        await client.query(`DELETE FROM cancellations WHERE booking_id IN (SELECT id FROM bookings WHERE event_id = ANY($1::uuid[]));`, [createdEventIds]);
        await client.query(`DELETE FROM booking_items WHERE booking_id IN (SELECT id FROM bookings WHERE event_id = ANY($1::uuid[]));`, [createdEventIds]);
        await client.query(`DELETE FROM bookings WHERE event_id = ANY($1::uuid[]);`, [createdEventIds]);
        await client.query(`DELETE FROM ticket_types WHERE event_id = ANY($1::uuid[]);`, [createdEventIds]);
        await client.query(`DELETE FROM events WHERE id = ANY($1::uuid[]);`, [createdEventIds]);
      }
      if (organizerId) {
        await client.query(`DELETE FROM organizer_members WHERE organizer_id = $1;`, [organizerId]);
        await client.query(`DELETE FROM organizer_profiles WHERE id = $1;`, [organizerId]);
      }
      if (createdUserIds.length > 0) {
        await client.query(`DELETE FROM users WHERE id = ANY($1::uuid[]);`, [createdUserIds]);
      }
    } catch (e) {
      console.warn('afterAll cleanup error:', e);
    } finally {
      client.release();
    }
  }, 30000);

  // Helper: create user
  async function createUser(emailPrefix: string) {
    const client = await pool.connect();
    try {
      const res = await client.query(
        `INSERT INTO users (college_id, email, password_hash, display_name, global_role, status)
         VALUES ($1, $2, 'hash', 'Test Attendee', 'student', 'active')
         RETURNING id;`,
        [collegeId, `${emailPrefix}.${Date.now()}.${Math.random().toString(36).substring(7)}@campus.edu`]
      );
      const id = res.rows[0].id;
      createdUserIds.push(id);
      return id;
    } finally {
      client.release();
    }
  }

  // Helper: create session headers for user
  async function createSessionForUser(userId: string): Promise<Record<string, string>> {
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const csrfToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(sessionToken).digest();

    await pool.query(
      `INSERT INTO sessions (id_hash, user_id, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '1 day');`,
      [tokenHash, userId]
    );

    return {
      cookie: `eventora_session=${sessionToken}; eventora_csrf=${csrfToken}`,
      'x-csrf-token': csrfToken,
    };
  }

  // Helper: create event and ticket types
  async function createEventWithTiers(opts: {
    capacity?: number;
    startsAt?: Date;
    endsAt?: Date;
    tiers: { name: string; pricePaise: number; capacity: number; perUserLimit?: number }[];
  }) {
    const client = await pool.connect();
    try {
      const endsAt = opts.endsAt || new Date(Date.now() + 7 * 86400000);
      const startsAt = opts.startsAt || new Date(endsAt.getTime() - 24 * 3600000);
      const eRes = await client.query(
        `INSERT INTO events (
           organizer_id, college_id, title, slug, description, category, department, format,
           starts_at, ends_at, capacity, visibility, status, contact_email, created_by
         ) VALUES (
           $1, $2, $3, $4, 'P08 Test Event', 'Tech', 'CS', 'in_person',
           $5, $6, $7, 'public', 'published', 'contact@campus.edu', $8
         ) RETURNING id;`,
        [organizerId, collegeId, `P08 Event ${Date.now()}`, `p08-${Date.now()}-${Math.random().toString(36).substring(7)}`, startsAt, endsAt, opts.capacity || 100, orgUserId]
      );
      const eventId = eRes.rows[0].id;
      createdEventIds.push(eventId);

      const ticketTypes: any[] = [];
      for (const t of opts.tiers) {
        const ttRes = await client.query(
          `INSERT INTO ticket_types (event_id, name, price_paise, capacity, sold, held, per_user_limit)
           VALUES ($1, $2, $3, $4, 0, 0, $5)
           RETURNING *;`,
          [eventId, t.name, t.pricePaise, t.capacity, t.perUserLimit || 5]
        );
        ticketTypes.push(ttRes.rows[0]);
      }
      return { eventId, ticketTypes };
    } finally {
      client.release();
    }
  }

  // 1. Free vs. Paid Inventory State Machine
  describe('1. Free vs. Paid Inventory State Machine', () => {
    it('(a) Free booking -> sold += q, CONFIRMED, tickets generated in transaction, expires_at null', async () => {
      const { eventId, ticketTypes } = await createEventWithTiers({
        tiers: [{ name: 'Free Pass', pricePaise: 0, capacity: 10, perUserLimit: 2 }],
      });
      const userId = await createUser('free.buyer');

      const result = await createBooking({
        userId,
        eventId,
        items: [{ ticketTypeId: ticketTypes[0].id, quantity: 2 }],
        idempotencyKey: `idem-free-${Date.now()}`,
      });

      expect(result.booking.status).toBe('CONFIRMED');
      expect(result.booking.total_paise).toBe(0);
      expect(result.booking.expires_at).toBeNull();
      expect(result.tickets.length).toBe(2);
      expect(result.tickets[0].status).toBe('VALID');

      // Verify DB counters
      const client = await pool.connect();
      try {
        const ttRes = await client.query('SELECT sold, held FROM ticket_types WHERE id = $1;', [ticketTypes[0].id]);
        expect(ttRes.rows[0].sold).toBe(2);
        expect(ttRes.rows[0].held).toBe(0);
      } finally {
        client.release();
      }
    });

    it('(b) Paid booking -> held += q, PENDING_PAYMENT, expires_at = now() + 15m, zero tickets yet', async () => {
      const { eventId, ticketTypes } = await createEventWithTiers({
        tiers: [{ name: 'VIP Pass', pricePaise: 5000, capacity: 10, perUserLimit: 1 }],
      });
      const userId = await createUser('paid.buyer');

      const before = Date.now();
      const result = await createBooking({
        userId,
        eventId,
        items: [{ ticketTypeId: ticketTypes[0].id, quantity: 1 }],
        idempotencyKey: `idem-paid-${Date.now()}`,
      });

      expect(result.booking.status).toBe('PENDING_PAYMENT');
      expect(result.booking.total_paise).toBe(5000);
      expect(result.tickets.length).toBe(0); // Zero valid tickets yet
      expect(result.booking.expires_at).toBeDefined();

      const expiresMs = new Date(result.booking.expires_at).getTime();
      expect(expiresMs).toBeGreaterThanOrEqual(before + 14 * 60 * 1000);
      expect(expiresMs).toBeLessThanOrEqual(before + 16 * 60 * 1000);

      // Verify DB counters: held=1, sold=0
      const client = await pool.connect();
      try {
        const ttRes = await client.query('SELECT sold, held FROM ticket_types WHERE id = $1;', [ticketTypes[0].id]);
        expect(ttRes.rows[0].sold).toBe(0);
        expect(ttRes.rows[0].held).toBe(1);
      } finally {
        client.release();
      }
    });

    it('(c) Payment success -> held -= q, sold += q, status CONFIRMED, tickets issued', async () => {
      const { eventId, ticketTypes } = await createEventWithTiers({
        tiers: [{ name: 'Paid Tier', pricePaise: 2500, capacity: 5 }],
      });
      const userId = await createUser('pay.success');

      const bResult = await createBooking({
        userId,
        eventId,
        items: [{ ticketTypeId: ticketTypes[0].id, quantity: 1 }],
        idempotencyKey: `idem-paysucc-${Date.now()}`,
      });

      const checkout = await initiateCheckout({ bookingId: bResult.booking.id, userId });
      const verifyRes = await verifyPayment({
        orderId: checkout.orderId,
        paymentId: `pay_sim_${Date.now()}`,
        userId,
      });

      expect(verifyRes.confirmed).toBe(true);
      expect(verifyRes.status).toBe('SUCCEEDED');

      // Verify DB state
      const client = await pool.connect();
      try {
        const ttRes = await client.query('SELECT sold, held FROM ticket_types WHERE id = $1;', [ticketTypes[0].id]);
        expect(ttRes.rows[0].held).toBe(0);
        expect(ttRes.rows[0].sold).toBe(1);

        const tRes = await client.query('SELECT count(*)::int as count FROM tickets WHERE booking_id = $1;', [bResult.booking.id]);
        expect(tRes.rows[0].count).toBe(1);
      } finally {
        client.release();
      }
    });

    it('(d) Payment failure -> held -= q, zero valid tickets, held restored to 0', async () => {
      const { eventId, ticketTypes } = await createEventWithTiers({
        tiers: [{ name: 'Paid Tier Fail', pricePaise: 3000, capacity: 5 }],
      });
      const userId = await createUser('pay.fail');

      const bResult = await createBooking({
        userId,
        eventId,
        items: [{ ticketTypeId: ticketTypes[0].id, quantity: 1 }],
        idempotencyKey: `idem-payfail-${Date.now()}`,
      });

      const checkout = await initiateCheckout({ bookingId: bResult.booking.id, userId });

      // Verify failure handling via verifyPayment with failure adapter simulation
      const failRes = await verifyPayment({
        orderId: checkout.orderId,
        paymentId: 'pay_fail_decline',
        userId,
      });

      expect(failRes.confirmed).toBe(false);

      // Verify DB state: held restored to 0, sold is 0, zero tickets
      const client = await pool.connect();
      try {
        const ttRes = await client.query('SELECT sold, held FROM ticket_types WHERE id = $1;', [ticketTypes[0].id]);
        expect(ttRes.rows[0].held).toBe(0);
        expect(ttRes.rows[0].sold).toBe(0);

        const tRes = await client.query('SELECT count(*)::int as count FROM tickets WHERE booking_id = $1;', [bResult.booking.id]);
        expect(tRes.rows[0].count).toBe(0);
      } finally {
        client.release();
      }
    });
  });

  // 2. Cancellation Correctness & Row Locking
  describe('2. Cancellation Correctness & Row Locking', () => {
    it('(a) Cancel PENDING_PAYMENT booking -> held -= q, sold untouched', async () => {
      const { eventId, ticketTypes } = await createEventWithTiers({
        tiers: [{ name: 'Pending Cancel Tier', pricePaise: 4000, capacity: 5 }],
      });
      const userId = await createUser('cancel.pending');

      const bResult = await createBooking({
        userId,
        eventId,
        items: [{ ticketTypeId: ticketTypes[0].id, quantity: 1 }],
        idempotencyKey: `idem-cancelpend-${Date.now()}`,
      });

      const cancelRes = await cancelBooking(bResult.booking.id, userId, 'Changed mind');
      expect(cancelRes.status).toBe('CANCELLED');

      const client = await pool.connect();
      try {
        const ttRes = await client.query('SELECT sold, held FROM ticket_types WHERE id = $1;', [ticketTypes[0].id]);
        expect(ttRes.rows[0].held).toBe(0);
        expect(ttRes.rows[0].sold).toBe(0);
      } finally {
        client.release();
      }
    });

    it('(b) Cancel CONFIRMED booking -> sold -= q, tickets marked CANCELLED', async () => {
      const { eventId, ticketTypes } = await createEventWithTiers({
        tiers: [{ name: 'Confirmed Cancel Tier', pricePaise: 0, capacity: 5 }],
      });
      const userId = await createUser('cancel.conf');

      const bResult = await createBooking({
        userId,
        eventId,
        items: [{ ticketTypeId: ticketTypes[0].id, quantity: 1 }],
        idempotencyKey: `idem-cancelconf-${Date.now()}`,
      });

      const cancelRes = await cancelBooking(bResult.booking.id, userId, 'Cannot attend');
      expect(cancelRes.status).toBe('CANCELLED');

      const client = await pool.connect();
      try {
        const ttRes = await client.query('SELECT sold, held FROM ticket_types WHERE id = $1;', [ticketTypes[0].id]);
        expect(ttRes.rows[0].sold).toBe(0);

        const tRes = await client.query('SELECT status FROM tickets WHERE booking_id = $1;', [bResult.booking.id]);
        expect(tRes.rows[0].status).toBe('CANCELLED');
      } finally {
        client.release();
      }
    });
  });

  // 3. Duplicate Registration Guard & Partial Unique Index
  describe('3. Duplicate Registration Guard & Partial Unique Index', () => {
    it('(a) Duplicate active booking rejected with 409 ALREADY_REGISTERED', async () => {
      const { eventId, ticketTypes } = await createEventWithTiers({
        tiers: [{ name: 'Solo Tier', pricePaise: 0, capacity: 10 }],
      });
      const userId = await createUser('solo.dup');

      // First booking succeeds
      await createBooking({
        userId,
        eventId,
        items: [{ ticketTypeId: ticketTypes[0].id, quantity: 1 }],
        idempotencyKey: `idem-solo-1-${Date.now()}`,
      });

      // Second booking with different idempotency key rejected
      try {
        await createBooking({
          userId,
          eventId,
          items: [{ ticketTypeId: ticketTypes[0].id, quantity: 1 }],
          idempotencyKey: `idem-solo-2-${Date.now()}`,
        });
        expect.unreachable('Should have thrown ALREADY_REGISTERED');
      } catch (err: any) {
        expect(err.code).toBe('ALREADY_REGISTERED');
        expect(err.status).toBe(409);
      }
    });

    it('(b) After previous booking is CANCELLED, user CAN register again', async () => {
      const { eventId, ticketTypes } = await createEventWithTiers({
        tiers: [{ name: 'Solo Rebooking Tier', pricePaise: 0, capacity: 10 }],
      });
      const userId = await createUser('solo.rebook');

      const b1 = await createBooking({
        userId,
        eventId,
        items: [{ ticketTypeId: ticketTypes[0].id, quantity: 1 }],
        idempotencyKey: `idem-solo-b1-${Date.now()}`,
      });

      await cancelBooking(b1.booking.id, userId, 'Cancelling first');

      // Second booking should succeed now that first is CANCELLED
      const b2 = await createBooking({
        userId,
        eventId,
        items: [{ ticketTypeId: ticketTypes[0].id, quantity: 1 }],
        idempotencyKey: `idem-solo-b2-${Date.now()}`,
      });

      expect(b2.booking.status).toBe('CONFIRMED');
    });

    it('(c) Partial unique index prevents concurrent duplicate active booking insert', async () => {
      const { eventId } = await createEventWithTiers({
        tiers: [{ name: 'Solo Race Tier', pricePaise: 0, capacity: 10 }],
      });
      const userId = await createUser('solo.race');

      const client = await pool.connect();
      try {
        await client.query(
          `INSERT INTO bookings (user_id, event_id, status, total_paise, idempotency_key)
           VALUES ($1, $2, 'CONFIRMED', 0, $3);`,
          [userId, eventId, `manual-1-${Date.now()}`]
        );

        // Attempt direct insert violating partial unique index bookings_active_user_event_solo_idx
        await expect(
          client.query(
            `INSERT INTO bookings (user_id, event_id, status, total_paise, idempotency_key)
             VALUES ($1, $2, 'PENDING_PAYMENT', 100, $3);`,
            [userId, eventId, `manual-2-${Date.now()}`]
          )
        ).rejects.toThrow();
      } finally {
        client.release();
      }
    });
  });

  // 4. Booking Validations & Safeguards
  describe('4. Booking Validations & Safeguards', () => {
    it('(a) Merges duplicate ticketTypeId lines and validates against per_user_limit', async () => {
      const { eventId, ticketTypes } = await createEventWithTiers({
        tiers: [{ name: 'Merged Tier', pricePaise: 0, capacity: 10, perUserLimit: 2 }],
      });
      const userId = await createUser('merge.limit');

      // Request has duplicate ticketTypeId: 2 + 1 = 3 > per_user_limit 2
      try {
        await createBooking({
          userId,
          eventId,
          items: [
            { ticketTypeId: ticketTypes[0].id, quantity: 2 },
            { ticketTypeId: ticketTypes[0].id, quantity: 1 },
          ],
          idempotencyKey: `idem-merge-limit-${Date.now()}`,
        });
        expect.unreachable('Should have thrown LIMIT_EXCEEDED');
      } catch (err: any) {
        expect(err.code).toBe('LIMIT_EXCEEDED');
        expect(err.status).toBe(400);
      }
    });

    it('(b) Merges duplicate ticketTypeId lines within limit and reserves correct count', async () => {
      const { eventId, ticketTypes } = await createEventWithTiers({
        tiers: [{ name: 'Merged Tier OK', pricePaise: 0, capacity: 10, perUserLimit: 4 }],
      });
      const userId = await createUser('merge.ok');

      const res = await createBooking({
        userId,
        eventId,
        items: [
          { ticketTypeId: ticketTypes[0].id, quantity: 1 },
          { ticketTypeId: ticketTypes[0].id, quantity: 2 },
        ],
        idempotencyKey: `idem-merge-ok-${Date.now()}`,
      });

      expect(res.booking.status).toBe('CONFIRMED');
      expect(res.items.length).toBe(1);
      expect(res.items[0].quantity).toBe(3);
    });

    it('(c) Rejects booking after event ends (now() > endsAt) with EVENT_ALREADY_ENDED', async () => {
      const pastEnd = new Date(Date.now() - 3600000);
      const { eventId, ticketTypes } = await createEventWithTiers({
        startsAt: new Date(pastEnd.getTime() - 7200000),
        endsAt: pastEnd,
        tiers: [{ name: 'Past Tier', pricePaise: 0, capacity: 10 }],
      });
      const userId = await createUser('past.buyer');

      try {
        await createBooking({
          userId,
          eventId,
          items: [{ ticketTypeId: ticketTypes[0].id, quantity: 1 }],
          idempotencyKey: `idem-past-${Date.now()}`,
        });
        expect.unreachable('Should have thrown EVENT_ALREADY_ENDED');
      } catch (err: any) {
        expect(err.code).toBe('EVENT_ALREADY_ENDED');
        expect(err.status).toBe(400);
      }
    });

    it('(d) Enforces events.capacity across multiple tiers', async () => {
      // Event total capacity: 3, but Tier A has capacity 3 and Tier B has capacity 3
      const { eventId, ticketTypes } = await createEventWithTiers({
        capacity: 3,
        tiers: [
          { name: 'Tier A', pricePaise: 0, capacity: 3, perUserLimit: 3 },
          { name: 'Tier B', pricePaise: 0, capacity: 3, perUserLimit: 3 },
        ],
      });
      const user1 = await createUser('cap.u1');
      const user2 = await createUser('cap.u2');

      // User 1 takes 2 seats from Tier A
      await createBooking({
        userId: user1,
        eventId,
        items: [{ ticketTypeId: ticketTypes[0].id, quantity: 2 }],
        idempotencyKey: `idem-cap-1-${Date.now()}`,
      });

      // User 2 requests 2 seats from Tier B -> total would be 4 > 3 -> rejected with SOLD_OUT
      try {
        await createBooking({
          userId: user2,
          eventId,
          items: [{ ticketTypeId: ticketTypes[1].id, quantity: 2 }],
          idempotencyKey: `idem-cap-2-${Date.now()}`,
        });
        expect.unreachable('Should have thrown SOLD_OUT');
      } catch (err: any) {
        expect(err.code).toBe('SOLD_OUT');
        expect(err.status).toBe(409);
      }
    });

    it('(e) Validates custom event form questions (required, invalid question, choice options)', async () => {
      const { eventId, ticketTypes } = await createEventWithTiers({
        tiers: [{ name: 'Q Tier', pricePaise: 0, capacity: 10 }],
      });
      const userId = await createUser('form.buyer');

      const client = await pool.connect();
      let q1Id: string;
      let q2Id: string;
      try {
        const q1 = await client.query(
          `INSERT INTO registration_form_questions (event_id, label, type, required)
           VALUES ($1, 'T-Shirt Size', 'text', true) RETURNING id;`,
          [eventId]
        );
        q1Id = q1.rows[0].id;

        const q2 = await client.query(
          `INSERT INTO registration_form_questions (event_id, label, type, required, options)
           VALUES ($1, 'Dietary Preference', 'select', false, '["Veg", "Non-Veg", "Jain"]'::jsonb) RETURNING id;`,
          [eventId]
        );
        q2Id = q2.rows[0].id;
      } finally {
        client.release();
      }

      // 1. Missing required question q1
      try {
        await createBooking({
          userId,
          eventId,
          items: [{ ticketTypeId: ticketTypes[0].id, quantity: 1 }],
          idempotencyKey: `idem-q-missing-${Date.now()}`,
          answers: [],
        });
        expect.unreachable('Should have thrown MISSING_REQUIRED_QUESTION');
      } catch (err: any) {
        expect(err.code).toBe('MISSING_REQUIRED_QUESTION');
        expect(err.status).toBe(400);
      }

      // 2. Invalid option for q2
      try {
        await createBooking({
          userId,
          eventId,
          items: [{ ticketTypeId: ticketTypes[0].id, quantity: 1 }],
          idempotencyKey: `idem-q-opt-${Date.now()}`,
          answers: [
            { questionId: q1Id, answer: 'L' },
            { questionId: q2Id, answer: 'Keto-Carnivore' }, // Not in ["Veg", "Non-Veg", "Jain"]
          ],
        });
        expect.unreachable('Should have thrown INVALID_QUESTION_OPTION');
      } catch (err: any) {
        expect(err.code).toBe('INVALID_QUESTION_OPTION');
        expect(err.status).toBe(400);
      }

      // 3. Valid answers -> succeeds
      const validRes = await createBooking({
        userId,
        eventId,
        items: [{ ticketTypeId: ticketTypes[0].id, quantity: 1 }],
        idempotencyKey: `idem-q-ok-${Date.now()}`,
        answers: [
          { questionId: q1Id, answer: 'L' },
          { questionId: q2Id, answer: 'Veg' },
        ],
      });

      expect(validRes.booking.status).toBe('CONFIRMED');
    });

    it('(f) Rejects invalid teamRegistrationId', async () => {
      const { eventId, ticketTypes } = await createEventWithTiers({
        tiers: [{ name: 'Team Tier', pricePaise: 0, capacity: 10 }],
      });
      const userId = await createUser('team.buyer');
      const fakeTeamRegId = crypto.randomUUID();

      try {
        await createBooking({
          userId,
          eventId,
          items: [{ ticketTypeId: ticketTypes[0].id, quantity: 1 }],
          idempotencyKey: `idem-fake-team-${Date.now()}`,
          teamRegistrationId: fakeTeamRegId,
        });
        expect.unreachable('Should have thrown INVALID_TEAM_REGISTRATION');
      } catch (err: any) {
        expect(err.code).toBe('INVALID_TEAM_REGISTRATION');
        expect(err.status).toBe(403);
      }
    });
  });

  // 5. Idempotency Key Validation & SHA-256 Payload Hash Binding
  describe('5. Idempotency Key Validation & SHA-256 Payload Hash Binding', () => {
    it('(a) Rejects Idempotency-Key > 128 characters via HTTP API with 400', async () => {
      const { eventId, ticketTypes } = await createEventWithTiers({
        tiers: [{ name: 'Api Tier', pricePaise: 0, capacity: 10 }],
      });
      const userId = await createUser('api.longkey');
      const sessionHeaders = await createSessionForUser(userId);

      const longKey = 'A'.repeat(129);
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${eventId}/bookings`,
        headers: {
          ...sessionHeaders,
          'idempotency-key': longKey,
        },
        payload: {
          items: [{ ticketTypeId: ticketTypes[0].id, quantity: 1 }],
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.error.code).toBe('INVALID_IDEMPOTENCY_KEY');
    });

    it('(b) Returns 422 IDEMPOTENCY_PAYLOAD_MISMATCH if idempotency key reused with different body', async () => {
      const { eventId, ticketTypes } = await createEventWithTiers({
        tiers: [
          { name: 'Hash Tier 1', pricePaise: 0, capacity: 10, perUserLimit: 5 },
          { name: 'Hash Tier 2', pricePaise: 0, capacity: 10, perUserLimit: 5 },
        ],
      });
      const userId = await createUser('hash.mismatch');
      const idempotencyKey = `idem-hash-test-${Date.now()}`;

      // First call with payload A
      const res1 = await createBooking({
        userId,
        eventId,
        items: [{ ticketTypeId: ticketTypes[0].id, quantity: 1 }],
        idempotencyKey,
        payloadHash: crypto.createHash('sha256').update('payloadA').digest('hex'),
      });
      expect(res1.isIdempotentReplay).toBe(false);

      // Second call with same idempotencyKey but different payloadHash
      try {
        await createBooking({
          userId,
          eventId,
          items: [{ ticketTypeId: ticketTypes[0].id, quantity: 2 }],
          idempotencyKey,
          payloadHash: crypto.createHash('sha256').update('payloadB').digest('hex'),
        });
        expect.unreachable('Should have thrown IDEMPOTENCY_PAYLOAD_MISMATCH');
      } catch (err: any) {
        expect(err.code).toBe('IDEMPOTENCY_PAYLOAD_MISMATCH');
        expect(err.status).toBe(422);
      }

      // Third call with identical payloadHash returns original booking replay
      const res3 = await createBooking({
        userId,
        eventId,
        items: [{ ticketTypeId: ticketTypes[0].id, quantity: 1 }],
        idempotencyKey,
        payloadHash: crypto.createHash('sha256').update('payloadA').digest('hex'),
      });
      expect(res3.isIdempotentReplay).toBe(true);
      expect(res3.booking.id).toBe(res1.booking.id);
    });
  });

  // 6. Advisory Lock Hold Reconciler
  describe('6. Advisory Lock Hold Reconciler', () => {
    it('(a) runHoldReconciliationLeaderJob acquires advisory lock and executes', async () => {
      const result = await runHoldReconciliationLeaderJob();
      expect(result.acquired).toBe(true);
      expect(result.executed).toBe(true);
    });

    it('(b) Concurrent hold reconciler attempt detects leader lock and skips', async () => {
      const client = await pool.connect();
      try {
        // Manually acquire advisory lock
        const lockRes = await client.query(
          `SELECT pg_try_advisory_lock($1) as acquired;`,
          [HOLD_RECONCILER_ADVISORY_LOCK_ID]
        );
        expect(lockRes.rows[0].acquired).toBe(true);

        // Job running concurrently should detect lock is already taken and return acquired: false
        const jobResult = await runHoldReconciliationLeaderJob();
        expect(jobResult.acquired).toBe(false);
        expect(jobResult.executed).toBe(false);
        expect(jobResult.reason).toBe('LOCKED_BY_ANOTHER_LEADER');

        // Release manual lock
        await client.query(`SELECT pg_advisory_unlock($1);`, [HOLD_RECONCILER_ADVISORY_LOCK_ID]);
      } finally {
        client.release();
      }
    });

    it('(c) Abandoned checkout frees seats after expiry via reconciliation', async () => {
      const { eventId, ticketTypes } = await createEventWithTiers({
        tiers: [{ name: 'Abandoned Tier', pricePaise: 5000, capacity: 5 }],
      });
      const userId = await createUser('abandoned.buyer');

      // Create expired pending hold (expires_at in past)
      const client = await pool.connect();
      let bookingId: string;
      try {
        const bRes = await client.query(
          `INSERT INTO bookings (user_id, event_id, status, total_paise, idempotency_key, expires_at)
           VALUES ($1, $2, 'PENDING_PAYMENT', 5000, $3, NOW() - INTERVAL '5 minutes')
           RETURNING id;`,
          [userId, eventId, `idem-abandon-${Date.now()}`]
        );
        bookingId = bRes.rows[0].id;

        await client.query(
          `INSERT INTO booking_items (booking_id, ticket_type_id, quantity, unit_price_paise)
           VALUES ($1, $2, 1, 5000);`,
          [bookingId, ticketTypes[0].id]
        );
        await client.query('UPDATE ticket_types SET held = held + 1 WHERE id = $1;', [ticketTypes[0].id]);
      } finally {
        client.release();
      }

      // Run reconciliation
      const recResult = await runHoldReconciliationLeaderJob();
      expect(recResult.executed).toBe(true);
      expect(recResult.reconciledCount).toBeGreaterThanOrEqual(1);

      // Verify booking is EXPIRED and held count returned to 0
      const vClient = await pool.connect();
      try {
        const bCheck = await vClient.query('SELECT status FROM bookings WHERE id = $1;', [bookingId]);
        expect(bCheck.rows[0].status).toBe('EXPIRED');

        const ttCheck = await vClient.query('SELECT held FROM ticket_types WHERE id = $1;', [ticketTypes[0].id]);
        expect(ttCheck.rows[0].held).toBe(0);
      } finally {
        vClient.release();
      }
    });
  });

  // 7. Concurrency Verification Gate: 200 parallel bookings for 10 seats
  describe('7. Concurrency Verification Gate', () => {
    it('200 parallel bookings for 10 seats -> exactly 10 succeed, 190 fail, sold+held == 10', async () => {
      const { eventId, ticketTypes } = await createEventWithTiers({
        tiers: [{ name: 'High-Demand Pass', pricePaise: 0, capacity: 10, perUserLimit: 1 }],
      });

      // Pre-create 200 distinct test users
      const client = await pool.connect();
      const concurrentUsers: string[] = [];
      try {
        const uRes = await client.query(
          `INSERT INTO users (college_id, email, password_hash, display_name, global_role, status)
           SELECT
             $1,
             'p08.concurrent.' || i || '.' || ${Date.now()} || '@campus.edu',
             'hash',
             'Attendee ' || i,
             'student',
             'active'
           FROM generate_series(1, 200) AS i
           RETURNING id;`,
          [collegeId]
        );
        for (const row of uRes.rows) {
          concurrentUsers.push(row.id);
          createdUserIds.push(row.id);
        }
      } finally {
        client.release();
      }

      // Fire 200 parallel booking requests
      const bookingPromises = concurrentUsers.map((uid) =>
        createBooking({
          userId: uid,
          eventId,
          items: [{ ticketTypeId: ticketTypes[0].id, quantity: 1 }],
          idempotencyKey: `idem-conc-${uid}-${Date.now()}`,
        })
      );

      const settled = await Promise.allSettled(bookingPromises);

      const confirmed = settled.filter((r) => r.status === 'fulfilled');
      const rejected = settled.filter((r) => r.status === 'rejected');

      expect(confirmed.length).toBe(10);
      expect(rejected.length).toBe(190);

      // Verify all rejected attempts failed with SOLD_OUT / 409
      for (const rej of rejected) {
        if (rej.status === 'rejected') {
          const err = rej.reason as BookingError;
          expect(err.code).toBe('SOLD_OUT');
          expect(err.status).toBe(409);
        }
      }

      // Verify exact DB state
      const vClient = await pool.connect();
      try {
        const ttRes = await vClient.query(
          'SELECT capacity, sold, held FROM ticket_types WHERE id = $1;',
          [ticketTypes[0].id]
        );
        expect(ttRes.rows[0].sold).toBe(10);
        expect(ttRes.rows[0].held).toBe(0);
        expect(ttRes.rows[0].capacity).toBe(10);

        const countRes = await vClient.query(
          `SELECT COUNT(*)::int as count FROM bookings WHERE event_id = $1 AND status = 'CONFIRMED';`,
          [eventId]
        );
        expect(countRes.rows[0].count).toBe(10);

        const ticketCountRes = await vClient.query(
          `SELECT COUNT(*)::int as count FROM tickets WHERE event_id = $1 AND status = 'VALID';`,
          [eventId]
        );
        expect(ticketCountRes.rows[0].count).toBe(10);
      } finally {
        vClient.release();
      }
    }, 60000);
  });
});
