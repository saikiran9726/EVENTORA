import { pool } from '../db/index.js';
import crypto from 'crypto';
import { BookingError } from './booking.js';

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
 */
export async function joinWaitlist(params: JoinWaitlistParams) {
  const { userId, eventId, ticketTypeId } = params;
  const client = await pool.connect();

  try {
    // 1. Verify event status and ticket type
    const eventRes = await client.query(
      `SELECT id, status FROM events WHERE id = $1;`,
      [eventId]
    );
    if (eventRes.rows.length === 0 || eventRes.rows[0].status !== 'published') {
      throw new WaitlistError('EVENT_NOT_AVAILABLE', 'Waitlist is only available for published events', 400);
    }

    const ttRes = await client.query(
      `SELECT id, capacity, sold, held FROM ticket_types WHERE id = $1 AND event_id = $2;`,
      [ticketTypeId, eventId]
    );
    if (ttRes.rows.length === 0) {
      throw new WaitlistError('TICKET_TYPE_NOT_FOUND', 'Ticket tier not found for this event', 404);
    }

    // 2. Check if already waiting or offered
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

    // 3. Insert into waitlist
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
  } finally {
    client.release();
  }
}

/**
 * Removes user from active waitlist queue.
 */
export async function leaveWaitlist(userId: string, eventId: string) {
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
 */
export async function promoteNext(
  ticketTypeId: string,
  externalClient?: any,
  offerWindowMinutes = 30
) {
  const client = externalClient || (await pool.connect());
  const isInternalTx = !externalClient;

  try {
    if (isInternalTx) await client.query('BEGIN');

    // 1. Lock ticket_types row
    const ttRes = await client.query(
      `SELECT id, event_id, capacity, sold, held
       FROM ticket_types
       WHERE id = $1
       FOR UPDATE;`,
      [ticketTypeId]
    );

    if (ttRes.rows.length === 0) {
      if (isInternalTx) await client.query('ROLLBACK');
      return null;
    }

    const tt = ttRes.rows[0];
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
 * Exactly one winner per offer: concurrency safe, converts held -> sold.
 */
export async function claimOffer(params: ClaimOfferParams) {
  const { entryId, userId, claimToken, idempotencyKey } = params;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Validate token hash if claimToken provided
    let tokenHashCondition = '';
    const queryParams: any[] = [entryId, userId];

    if (claimToken) {
      const tokenHash = crypto.createHash('sha256').update(claimToken).digest('hex');
      queryParams.push(tokenHash);
      tokenHashCondition = `AND claim_token_hash = $3`;
    }

    // 2. Atomic claim transition
    const claimRes = await client.query(
      `UPDATE waitlist_entries
       SET status = 'CLAIMED'
       WHERE id = $1
         AND user_id = $2
         AND status = 'OFFERED'
         AND offer_expires_at > NOW()
         ${tokenHashCondition}
       RETURNING *;`,
      queryParams
    );

    if (claimRes.rows.length === 0) {
      throw new WaitlistError(
        'OFFER_INVALID_OR_EXPIRED',
        'Waitlist offer is invalid, has expired, or has already been claimed',
        409
      );
    }

    const claimedEntry = claimRes.rows[0];

    // 3. Lock ticket_types row and convert held -> sold
    const ttRes = await client.query(
      `SELECT id, price_paise, capacity, sold, held
       FROM ticket_types
       WHERE id = $1
       FOR UPDATE;`,
      [claimedEntry.ticket_type_id]
    );

    const tt = ttRes.rows[0];
    await client.query(
      `UPDATE ticket_types
       SET held = GREATEST(0, held - 1),
           sold = sold + 1
       WHERE id = $1;`,
      [claimedEntry.ticket_type_id]
    );

    // 4. Create confirmed booking
    const bookingRes = await client.query(
      `INSERT INTO bookings (
         user_id, event_id, status, total_paise, idempotency_key
       ) VALUES ($1, $2, 'CONFIRMED', $3, $4)
       RETURNING *;`,
      [userId, claimedEntry.event_id, tt.price_paise, idempotencyKey]
    );

    const booking = bookingRes.rows[0];

    // 5. Create booking item
    await client.query(
      `INSERT INTO booking_items (booking_id, ticket_type_id, quantity, unit_price_paise)
       VALUES ($1, $2, 1, $3);`,
      [booking.id, tt.id, tt.price_paise]
    );

    // 6. Generate digital ticket
    const rawToken = crypto.randomBytes(32).toString('base64url');
    const qrHash = crypto.createHash('sha256').update(rawToken).digest();
    const ticketCode = `TCK-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    const ticketRes = await client.query(
      `INSERT INTO tickets (
         booking_id, ticket_type_id, user_id, owner_user_id, event_id, ticket_code, qr_payload_hash, qr_token_hash, status
       ) VALUES ($1, $2, $3, $3, $4, $5, $6, $6, 'VALID')
       RETURNING id, ticket_code, status, created_at;`,
      [booking.id, tt.id, userId, claimedEntry.event_id, ticketCode, qrHash]
    );

    // 7. Write outbox
    await client.query(
      `INSERT INTO outbox (event_type, payload, dedupe_key)
       VALUES ($1, $2, $3);`,
      [
        'booking.confirmed',
        JSON.stringify({
          bookingId: booking.id,
          userId,
          eventId: claimedEntry.event_id,
          fromWaitlist: true,
        }),
        `booking-waitlist-${booking.id}`,
      ]
    );

    await client.query('COMMIT');

    return {
      booking,
      ticket: {
        ...ticketRes.rows[0],
        qrTokenPreview: rawToken,
      },
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
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

        // Promote next waiting attendee
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
