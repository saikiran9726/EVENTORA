import { pool } from '../db/index.js';
import crypto from 'crypto';
import { BookingError } from './booking.js';
import { createTicketWithRetry } from './qr-ticket.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isValidUuid(id: unknown): boolean {
  return typeof id === 'string' && UUID_REGEX.test(id);
}

export interface JoinWaitlistParams {
  userId: string;
  eventId: string;
  ticketTypeId: string;
}

export interface ClaimOfferParams {
  entryId: string;
  userId: string;
  claimToken?: string;
  idempotencyKey: string;
}

export class WaitlistError extends BookingError {}

/**
 * Adds an attendee to the FIFO waitlist queue.
 * Partial unique constraint enforces one active waitlist entry per (ticket_type_id, user_id).
 *
 * Invariants:
 * - Allowed ONLY when tier is sold out (capacity - (sold + held) <= 0).
 * - Rejects if user already has an active booking for this event (ALREADY_REGISTERED).
 * - Catches Postgres 23505 unique violation cleanly returning { entry, position, alreadyQueued: true }.
 */
export async function joinWaitlist(params: JoinWaitlistParams) {
  const { userId, eventId, ticketTypeId } = params;

  if (!isValidUuid(userId) || !isValidUuid(eventId) || !isValidUuid(ticketTypeId)) {
    throw new WaitlistError('INVALID_ID', 'Invalid UUID identifier provided', 400);
  }

  const client = await pool.connect();

  try {
    // 1. Verify event status and registration window
    const eventRes = await client.query(
      `SELECT id, status, registration_opens_at, registration_closes_at FROM events WHERE id = $1;`,
      [eventId]
    );
    if (eventRes.rows.length === 0 || eventRes.rows[0].status !== 'published') {
      throw new WaitlistError('EVENT_NOT_AVAILABLE', 'Waitlist is only available for published events', 400);
    }
    const event = eventRes.rows[0];
    const now = new Date();
    if (event.registration_closes_at && now > new Date(event.registration_closes_at)) {
      throw new WaitlistError('REGISTRATION_CLOSED', 'Event registration has closed', 400);
    }

    // 2. Verify ticket type and capacity
    const ttRes = await client.query(
      `SELECT id, capacity, sold, held FROM ticket_types WHERE id = $1 AND event_id = $2;`,
      [ticketTypeId, eventId]
    );
    if (ttRes.rows.length === 0) {
      throw new WaitlistError('TICKET_TYPE_NOT_FOUND', 'Ticket tier not found for this event', 404);
    }

    const tt = ttRes.rows[0];
    const available = tt.capacity - (tt.sold + tt.held);
    if (available > 0) {
      throw new WaitlistError('TIER_NOT_SOLD_OUT', 'Waitlist is only available when the ticket tier is sold out', 400);
    }

    // 3. Reject if user already has an active booking for this event
    const activeBookingRes = await client.query(
      `SELECT id FROM bookings
       WHERE user_id = $1 AND event_id = $2 AND status IN ('CONFIRMED', 'PENDING_PAYMENT');`,
      [userId, eventId]
    );
    if (activeBookingRes.rows.length > 0) {
      throw new WaitlistError('ALREADY_REGISTERED', 'User already has an active booking for this event', 409);
    }

    // 4. Check if already waiting or offered
    const existingRes = await client.query(
      `SELECT id, status, created_at FROM waitlist_entries
       WHERE ticket_type_id = $1 AND user_id = $2 AND status IN ('WAITING', 'OFFERED');`,
      [ticketTypeId, userId]
    );

    if (existingRes.rows.length > 0) {
      const entry = existingRes.rows[0];
      const posRes = await client.query(
        `SELECT COUNT(*)::int as position
         FROM waitlist_entries
         WHERE ticket_type_id = $1 AND status = 'WAITING'
           AND (created_at < $2 OR (created_at = $2 AND id <= $3));`,
        [ticketTypeId, entry.created_at, entry.id]
      );
      return {
        entry,
        position: posRes.rows[0].position || 1,
        alreadyQueued: true,
      };
    }

    // 5. Insert into waitlist (with concurrent unique violation safety for Postgres 23505)
    try {
      const insertRes = await client.query(
        `INSERT INTO waitlist_entries (event_id, ticket_type_id, user_id, status)
         VALUES ($1, $2, $3, 'WAITING')
         RETURNING *;`,
        [eventId, ticketTypeId, userId]
      );

      const newEntry = insertRes.rows[0];

      // Compute queue position
      const posRes = await client.query(
        `SELECT COUNT(*)::int as position
         FROM waitlist_entries
         WHERE ticket_type_id = $1 AND status = 'WAITING'
           AND (created_at < $2 OR (created_at = $2 AND id <= $3));`,
        [ticketTypeId, newEntry.created_at, newEntry.id]
      );

      return {
        entry: newEntry,
        position: posRes.rows[0].position || 1,
        alreadyQueued: false,
      };
    } catch (insertErr: any) {
      if (insertErr?.code === '23505') {
        const raceRes = await client.query(
          `SELECT id, status, created_at FROM waitlist_entries
           WHERE ticket_type_id = $1 AND user_id = $2 AND status IN ('WAITING', 'OFFERED');`,
          [ticketTypeId, userId]
        );
        if (raceRes.rows.length > 0) {
          const entry = raceRes.rows[0];
          const posRes = await client.query(
            `SELECT COUNT(*)::int as position
             FROM waitlist_entries
             WHERE ticket_type_id = $1 AND status = 'WAITING'
               AND (created_at < $2 OR (created_at = $2 AND id <= $3));`,
            [ticketTypeId, entry.created_at, entry.id]
          );
          return {
            entry,
            position: posRes.rows[0].position || 1,
            alreadyQueued: true,
          };
        }
      }
      throw insertErr;
    }
  } finally {
    client.release();
  }
}

/**
 * Removes user from active waitlist queue.
 */
export async function leaveWaitlist(userId: string, eventId: string) {
  if (!isValidUuid(userId) || !isValidUuid(eventId)) {
    throw new WaitlistError('INVALID_ID', 'Invalid UUID identifier provided', 400);
  }

  const client = await pool.connect();
  try {
    const res = await client.query(
      `UPDATE waitlist_entries
       SET status = 'LEFT'
       WHERE user_id = $1 AND event_id = $2 AND status = 'WAITING'
       RETURNING *;`,
      [userId, eventId]
    );
    return { success: true, count: res.rowCount };
  } finally {
    client.release();
  }
}

/**
 * Promotes the FIFO head waitlist entry to OFFERED state.
 * Atomically reserves the seat by setting held += 1 on the ticket_types row.
 * Can be run within an external transaction client or initiates its own transaction.
 * Skips promotion if the event is not in 'published' status.
 */
export async function promoteNext(
  firstArg: string,
  secondArg?: any,
  thirdArg?: any
) {
  let ticketTypeId: string;
  let externalClient: any;
  let offerWindowMinutes = 30;

  if (typeof secondArg === 'string') {
    // Called as promoteNext(eventId, ticketTypeId, externalClient)
    ticketTypeId = secondArg;
    externalClient = thirdArg;
  } else {
    // Called as promoteNext(ticketTypeId, externalClient, offerWindowMinutes)
    ticketTypeId = firstArg;
    externalClient = secondArg;
    if (typeof thirdArg === 'number') {
      offerWindowMinutes = thirdArg;
    }
  }

  if (!isValidUuid(ticketTypeId)) {
    return null;
  }

  const client = externalClient || (await pool.connect());
  const isInternalTx = !externalClient;

  try {
    if (isInternalTx) await client.query('BEGIN');

    // 1. Lock ticket_types row and verify event is published
    const ttRes = await client.query(
      `SELECT tt.id, tt.event_id, tt.capacity, tt.sold, tt.held, e.status as event_status
       FROM ticket_types tt
       JOIN events e ON tt.event_id = e.id
       WHERE tt.id = $1
       FOR UPDATE OF tt;`,
      [ticketTypeId]
    );

    if (ttRes.rows.length === 0) {
      if (isInternalTx) await client.query('ROLLBACK');
      return null;
    }

    const tt = ttRes.rows[0];

    // Do NOT promote for non-published events
    if (tt.event_status !== 'published') {
      if (isInternalTx) await client.query('COMMIT');
      return null;
    }

    const available = tt.capacity - (tt.sold + tt.held);
    if (available <= 0) {
      if (isInternalTx) await client.query('COMMIT');
      return null;
    }

    // 2. Select head entry in FIFO order
    const headRes = await client.query(
      `SELECT id, user_id, event_id, ticket_type_id, created_at
       FROM waitlist_entries
       WHERE ticket_type_id = $1 AND status = 'WAITING'
       ORDER BY created_at ASC, id ASC
       LIMIT 1
       FOR UPDATE;`,
      [ticketTypeId]
    );

    if (headRes.rows.length === 0) {
      if (isInternalTx) await client.query('COMMIT');
      return null;
    }

    const head = headRes.rows[0];

    // 3. Generate claim token & set offer expiry
    const rawClaimToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(rawClaimToken).digest('hex');

    const offerRes = await client.query(
      `UPDATE waitlist_entries
       SET status = 'OFFERED',
           offered_at = NOW(),
           offer_expires_at = NOW() + ($1 || ' minutes')::interval,
           claim_token_hash = $2
       WHERE id = $3
       RETURNING *;`,
      [offerWindowMinutes, tokenHash, head.id]
    );

    // 4. Increment held seats count
    await client.query(
      `UPDATE ticket_types
       SET held = held + 1
       WHERE id = $1;`,
      [ticketTypeId]
    );

    // 5. Write to transactional outbox
    await client.query(
      `INSERT INTO outbox (event_type, payload, dedupe_key)
       VALUES ($1, $2, $3);`,
      [
        'waitlist.offer_dispatched',
        JSON.stringify({
          entryId: head.id,
          userId: head.user_id,
          eventId: head.event_id,
          ticketTypeId: head.ticket_type_id,
          claimToken: rawClaimToken,
          offerExpiresAt: offerRes.rows[0].offer_expires_at,
        }),
        `waitlist-offer-${head.id}`,
      ]
    );

    if (isInternalTx) await client.query('COMMIT');

    return {
      offeredEntry: offerRes.rows[0],
      claimToken: rawClaimToken,
    };
  } catch (err) {
    if (isInternalTx) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (isInternalTx) client.release();
  }
}

/**
 * Claims an active waitlist offer.
 * Atomic transition: status 'OFFERED' -> 'CLAIMED' iff offer_expires_at > now().
 *
 * Invariants:
 * - Paid claim: Keeps seat in held with fresh 15-min expires_at, sets booking status to PENDING_PAYMENT,
 *   DOES NOT generate a ticket (tickets are issued only post-payment).
 * - Free claim: Direct confirmation, decrements held, increments sold, issues digital ticket immediately.
 * - Idempotency replay returns original booking (and ticket if free).
 * - Parallel claims on same offer: exactly one winner, losers receive 409 OFFER_INVALID_OR_EXPIRED.
 */
export async function claimOffer(params: ClaimOfferParams) {
  const { entryId, userId, claimToken, idempotencyKey } = params;

  if (!isValidUuid(entryId) || !isValidUuid(userId)) {
    throw new WaitlistError('INVALID_ID', 'Invalid UUID identifier provided', 400);
  }

  if (claimToken !== undefined && !claimToken?.trim()) {
    throw new WaitlistError('MISSING_CLAIM_TOKEN', 'Claim token is required to claim a waitlist offer', 400);
  }

  if (!idempotencyKey || !idempotencyKey.trim()) {
    throw new WaitlistError('MISSING_IDEMPOTENCY_KEY', 'Header "Idempotency-Key" is required to claim a waitlist offer', 400);
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Idempotency check: replay original response if already claimed with this key
    const idemRes = await client.query(
      `SELECT b.*, t.id as ticket_id, t.ticket_code, t.status as ticket_status, t.created_at as ticket_created_at
       FROM bookings b
       LEFT JOIN tickets t ON t.booking_id = b.id
       WHERE b.idempotency_key = $1 AND b.user_id = $2;`,
      [idempotencyKey.trim(), userId]
    );

    if (idemRes.rows.length > 0) {
      await client.query('COMMIT');
      const b = idemRes.rows[0];
      if (b.status === 'CONFIRMED' && b.ticket_id) {
        return {
          booking: b,
          ticket: {
            id: b.ticket_id,
            ticket_code: b.ticket_code,
            status: b.ticket_status,
            created_at: b.ticket_created_at,
          },
          idempotentReplay: true,
        };
      }
      return {
        booking: b,
        checkoutRequired: b.status === 'PENDING_PAYMENT',
        requiresPayment: b.status === 'PENDING_PAYMENT',
        idempotentReplay: true,
      };
    }

    // 2. Fetch offer with event and tier information
    const offerQueryRes = await client.query(
      `SELECT w.id, w.user_id, w.event_id, w.ticket_type_id, w.status, w.offer_expires_at, w.claim_token_hash,
              e.status as event_status, e.registration_opens_at, e.registration_closes_at,
              tt.price_paise, tt.capacity, tt.sold, tt.held
       FROM waitlist_entries w
       JOIN events e ON w.event_id = e.id
       JOIN ticket_types tt ON w.ticket_type_id = tt.id
       WHERE w.id = $1 AND w.user_id = $2
       FOR UPDATE OF w;`,
      [entryId, userId]
    );

    if (offerQueryRes.rows.length === 0) {
      throw new WaitlistError(
        'OFFER_INVALID_OR_EXPIRED',
        'Waitlist offer is invalid, has expired, or has already been claimed',
        409
      );
    }

    const offer = offerQueryRes.rows[0];

    // Status & expiry validation
    if (offer.status !== 'OFFERED' || new Date(offer.offer_expires_at) <= new Date()) {
      throw new WaitlistError(
        'OFFER_INVALID_OR_EXPIRED',
        'Waitlist offer is invalid, has expired, or has already been claimed',
        409
      );
    }

    // Claim token verification: if offer has claim_token_hash, token is mandatory and must match
    if (offer.claim_token_hash) {
      if (!claimToken || !claimToken.trim()) {
        throw new WaitlistError('MISSING_CLAIM_TOKEN', 'Claim token is required to claim a waitlist offer', 400);
      }
      const tokenHash = crypto.createHash('sha256').update(claimToken.trim()).digest('hex');
      if (offer.claim_token_hash !== tokenHash) {
        throw new WaitlistError(
          'OFFER_INVALID_OR_EXPIRED',
          'Waitlist offer is invalid, has expired, or has already been claimed',
          409
        );
      }
    }

    // Event status validation
    if (offer.event_status !== 'published') {
      throw new WaitlistError('EVENT_NOT_AVAILABLE', 'Waitlist offer cannot be claimed for unpublished events', 400);
    }

    // Registration window validation
    const now = new Date();
    if (offer.registration_opens_at && now < new Date(offer.registration_opens_at)) {
      throw new WaitlistError('REGISTRATION_NOT_OPEN', 'Event registration has not opened yet', 400);
    }
    if (offer.registration_closes_at && now > new Date(offer.registration_closes_at)) {
      throw new WaitlistError('REGISTRATION_CLOSED', 'Event registration has closed', 400);
    }

    // Reject if user already has an active registration for this event
    const userBookedRes = await client.query(
      `SELECT id FROM bookings
       WHERE user_id = $1 AND event_id = $2 AND status IN ('CONFIRMED', 'PENDING_PAYMENT');`,
      [userId, offer.event_id]
    );
    if (userBookedRes.rows.length > 0) {
      throw new WaitlistError('ALREADY_REGISTERED', 'User already has an active booking for this event', 409);
    }

    // 3. Atomic claim transition on waitlist_entries
    const claimRes = await client.query(
      `UPDATE waitlist_entries
       SET status = 'CLAIMED'
       WHERE id = $1
         AND user_id = $2
         AND status = 'OFFERED'
         AND offer_expires_at > NOW()
       RETURNING *;`,
      [entryId, userId]
    );

    if (claimRes.rows.length === 0) {
      throw new WaitlistError(
        'OFFER_INVALID_OR_EXPIRED',
        'Waitlist offer is invalid, has expired, or has already been claimed',
        409
      );
    }

    // 4. Lock ticket_types row
    const ttRes = await client.query(
      `SELECT id, price_paise, capacity, sold, held
       FROM ticket_types
       WHERE id = $1
       FOR UPDATE;`,
      [offer.ticket_type_id]
    );
    const tt = ttRes.rows[0];

    // 5. Branch based on paid vs free tier
    if (tt.price_paise > 0) {
      // Paid claim: Seat remains in 'held' capacity reserved by promoteNext.
      // Create PENDING_PAYMENT booking with 15-minute expiration. NO ticket created yet.
      const bookingRes = await client.query(
        `INSERT INTO bookings (
           user_id, event_id, status, total_paise, idempotency_key, expires_at
         ) VALUES ($1, $2, 'PENDING_PAYMENT', $3, $4, NOW() + INTERVAL '15 minutes')
         RETURNING *;`,
        [userId, offer.event_id, tt.price_paise, idempotencyKey.trim()]
      );
      const booking = bookingRes.rows[0];

      await client.query(
        `INSERT INTO booking_items (booking_id, ticket_type_id, quantity, unit_price_paise)
         VALUES ($1, $2, 1, $3);`,
        [booking.id, tt.id, tt.price_paise]
      );

      await client.query(
        `UPDATE waitlist_entries SET booking_id = $1 WHERE id = $2;`,
        [booking.id, entryId]
      );

      await client.query(
        `INSERT INTO outbox (event_type, payload, dedupe_key)
         VALUES ($1, $2, $3);`,
        [
          'booking.created',
          JSON.stringify({
            bookingId: booking.id,
            userId,
            eventId: offer.event_id,
            fromWaitlist: true,
            status: 'PENDING_PAYMENT',
          }),
          `booking-waitlist-${booking.id}`,
        ]
      );

      await client.query('COMMIT');

      return {
        booking,
        checkoutRequired: true,
        requiresPayment: true,
      };
    } else {
      // Free claim: convert held -> sold directly and issue digital ticket
      await client.query(
        `UPDATE ticket_types
         SET held = GREATEST(0, held - 1),
             sold = sold + 1
         WHERE id = $1;`,
        [offer.ticket_type_id]
      );

      const bookingRes = await client.query(
        `INSERT INTO bookings (
           user_id, event_id, status, total_paise, idempotency_key
         ) VALUES ($1, $2, 'CONFIRMED', 0, $3)
         RETURNING *;`,
        [userId, offer.event_id, idempotencyKey.trim()]
      );
      const booking = bookingRes.rows[0];

      await client.query(
        `INSERT INTO booking_items (booking_id, ticket_type_id, quantity, unit_price_paise)
         VALUES ($1, $2, 1, 0);`,
        [booking.id, tt.id]
      );

      await client.query(
        `UPDATE waitlist_entries SET booking_id = $1 WHERE id = $2;`,
        [booking.id, entryId]
      );

      const ticketRes = await createTicketWithRetry(client, {
        bookingId: booking.id,
        ticketTypeId: tt.id,
        userId,
        ownerUserId: userId,
        eventId: offer.event_id,
      });

      await client.query(
        `INSERT INTO outbox (event_type, payload, dedupe_key)
         VALUES ($1, $2, $3);`,
        [
          'booking.confirmed',
          JSON.stringify({
            bookingId: booking.id,
            userId,
            eventId: offer.event_id,
            fromWaitlist: true,
          }),
          `booking-waitlist-${booking.id}`,
        ]
      );

      await client.query('COMMIT');

      return {
        booking,
        ticket: {
          id: ticketRes.id,
          ticket_code: ticketRes.ticket_code,
          status: ticketRes.status,
          created_at: ticketRes.created_at,
          qrTokenPreview: ticketRes.rawToken,
        },
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
 * Declines an active waitlist offer.
 * Transitions OFFERED -> DECLINED, decrements held capacity on the tier,
 * and promotes the next waiting attendee if the event is published.
 */
export async function declineOffer(entryId: string, userId: string) {
  if (!isValidUuid(entryId) || !isValidUuid(userId)) {
    throw new WaitlistError('INVALID_ID', 'Invalid UUID identifier provided', 400);
  }

  const client = await pool.connect();
  let ticketTypeId: string | null = null;
  let isPublished = false;

  try {
    await client.query('BEGIN');

    const offerRes = await client.query(
      `SELECT w.id, w.ticket_type_id, w.status, e.status as event_status
       FROM waitlist_entries w
       JOIN events e ON w.event_id = e.id
       WHERE w.id = $1 AND w.user_id = $2
       FOR UPDATE OF w;`,
      [entryId, userId]
    );

    if (offerRes.rows.length === 0) {
      throw new WaitlistError('OFFER_NOT_FOUND', 'Waitlist offer not found', 404);
    }

    const offer = offerRes.rows[0];
    if (offer.status !== 'OFFERED') {
      throw new WaitlistError('OFFER_NOT_ACTIVE', 'Only offered waitlist entries can be declined', 400);
    }

    ticketTypeId = offer.ticket_type_id;
    isPublished = offer.event_status === 'published';

    // Transition to DECLINED
    await client.query(
      `UPDATE waitlist_entries
       SET status = 'DECLINED'
       WHERE id = $1;`,
      [entryId]
    );

    // Release held seat
    await client.query(
      `UPDATE ticket_types
       SET held = GREATEST(0, held - 1)
       WHERE id = $1;`,
      [ticketTypeId]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Promote next attendee in queue if event is published
  if (ticketTypeId && isPublished) {
    await promoteNext(ticketTypeId);
  }

  return { success: true, message: 'Waitlist offer declined successfully' };
}

/**
 * Background sweeper: scans for expired offers, releases held capacity,
 * and calls promoteNext() for each affected ticket tier.
 */
export async function expireOffers() {
  const client = await pool.connect();
  let expiredCount = 0;

  try {
    await client.query('BEGIN');

    // Find all expired offered entries
    const expiredRes = await client.query(
      `SELECT id, ticket_type_id, user_id
       FROM waitlist_entries
       WHERE status = 'OFFERED' AND offer_expires_at <= NOW()
       FOR UPDATE SKIP LOCKED;`
    );

    for (const entry of expiredRes.rows) {
      const updateRes = await client.query(
        `UPDATE waitlist_entries
         SET status = 'EXPIRED'
         WHERE id = $1 AND status = 'OFFERED'
         RETURNING *;`,
        [entry.id]
      );

      if (updateRes.rows.length > 0) {
        expiredCount++;
        // Release held seat
        await client.query(
          `UPDATE ticket_types
           SET held = GREATEST(0, held - 1)
           WHERE id = $1;`,
          [entry.ticket_type_id]
        );

        // Promote next waiting attendee (promoteNext internally verifies event is published)
        await promoteNext(entry.ticket_type_id, client);
      }
    }

    await client.query('COMMIT');
    return { expiredCount };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
