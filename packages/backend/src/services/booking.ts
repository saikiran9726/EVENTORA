import { pool } from '../db/index.js';
import crypto from 'crypto';

export class BookingError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details?: Record<string, any>;

  constructor(code: string, message: string, status = 400, details?: Record<string, any>) {
    super(message);
    this.name = 'BookingError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class SoldOutError extends BookingError {
  constructor(message = 'Selected ticket tier is sold out', waitlistAvailable = true) {
    super('SOLD_OUT', message, 409, { waitlistAvailable });
  }
}

export interface CreateBookingParams {
  userId: string;
  eventId: string;
  items: {
    ticketTypeId: string;
    quantity: number;
  }[];
  idempotencyKey: string;
  teamRegistrationId?: string | null;
  answers?: {
    questionId: string;
    answer?: any;
  }[];
}

export interface BookingResult {
  booking: any;
  items: any[];
  tickets: any[];
  warnings: { code: string; eventId?: string; message: string }[];
  isIdempotentReplay?: boolean;
}

/**
 * Creates a capacity-safe event booking within a single atomic PostgreSQL transaction.
 * Non-negotiables enforced:
 * 1. SELECT ... FOR UPDATE on ticket_types row(s) in ascending order to prevent deadlocks.
 * 2. sold + held + quantity <= capacity check strictly on stored state.
 * 3. Idempotency-Key deduplication returning original booking response.
 * 4. Free bookings set status = 'CONFIRMED' with total_paise = 0 (no payment screen).
 * 5. Outbox record written atomically with booking.
 * 6. Non-blocking student schedule overlap check returned as warnings.
 */
export async function createBooking(params: CreateBookingParams): Promise<BookingResult> {
  const { userId, eventId, items, idempotencyKey, teamRegistrationId, answers } = params;

  if (!items || items.length === 0) {
    throw new BookingError('INVALID_ITEMS', 'At least one ticket item is required');
  }

  const client = await pool.connect();
  try {
    // 1. Idempotency Check (before or in transaction)
    const existingRes = await client.query(
      `SELECT * FROM bookings WHERE user_id = $1 AND idempotency_key = $2;`,
      [userId, idempotencyKey]
    );

    if (existingRes.rows.length > 0) {
      const existingBooking = existingRes.rows[0];
      const itemsRes = await client.query(
        `SELECT * FROM booking_items WHERE booking_id = $1;`,
        [existingBooking.id]
      );
      const ticketsRes = await client.query(
        `SELECT id, ticket_code, status, checked_in_at, created_at FROM tickets WHERE booking_id = $1;`,
        [existingBooking.id]
      );
      return {
        booking: existingBooking,
        items: itemsRes.rows,
        tickets: ticketsRes.rows,
        warnings: [],
        isIdempotentReplay: true,
      };
    }

    await client.query('BEGIN');

    // 2. Validate Event state and registration window
    const eventRes = await client.query(
      `SELECT id, title, status, starts_at, ends_at, registration_opens_at, registration_closes_at, capacity, team_mode
       FROM events WHERE id = $1 FOR SHARE;`,
      [eventId]
    );

    if (eventRes.rows.length === 0) {
      throw new BookingError('EVENT_NOT_FOUND', 'Event not found', 404);
    }

    const event = eventRes.rows[0];
    if (event.status !== 'published') {
      throw new BookingError('EVENT_NOT_PUBLISHED', 'Registrations are only open for published events', 400);
    }

    const now = new Date();
    if (event.registration_opens_at && new Date(event.registration_opens_at) > now) {
      throw new BookingError('REGISTRATION_NOT_OPEN', 'Registration window has not opened yet', 400);
    }
    if (event.registration_closes_at && new Date(event.registration_closes_at) < now) {
      throw new BookingError('REGISTRATION_CLOSED', 'Registration window has closed', 400);
    }

    // 3. Check existing non-cancelled booking for solo registrations
    if (!teamRegistrationId) {
      const activeBookingCheck = await client.query(
        `SELECT id FROM bookings
         WHERE user_id = $1 AND event_id = $2 AND status != 'CANCELLED' AND team_registration_id IS NULL;`,
        [userId, eventId]
      );
      if (activeBookingCheck.rows.length > 0) {
        throw new BookingError(
          'ALREADY_REGISTERED',
          'You already have an active registration for this event',
          409
        );
      }
    }

    // 4. Sort ticketTypeIds in ascending order to prevent deadlocks across concurrent requests
    const sortedItems = [...items].sort((a, b) => a.ticketTypeId.localeCompare(b.ticketTypeId));
    const ticketTypeIds = sortedItems.map((i) => i.ticketTypeId);

    // 5. Lock ticket_types rows with SELECT ... FOR UPDATE
    const lockedTypesRes = await client.query(
      `SELECT id, event_id, name, price_paise, capacity, sold, held, per_user_limit, sales_start, sales_end
       FROM ticket_types
       WHERE id = ANY($1::uuid[])
       ORDER BY id ASC
       FOR UPDATE;`,
      [ticketTypeIds]
    );

    const lockedTypesMap = new Map<string, any>();
    for (const row of lockedTypesRes.rows) {
      lockedTypesMap.set(row.id, row);
    }

    let calculatedTotalPaise = 0;
    const bookingItemsToInsert: { ticketTypeId: string; quantity: number; unitPricePaise: number }[] = [];

    for (const item of sortedItems) {
      const tt = lockedTypesMap.get(item.ticketTypeId);
      if (!tt) {
        throw new BookingError('TICKET_TYPE_NOT_FOUND', `Ticket tier ${item.ticketTypeId} not found`, 404);
      }
      if (tt.event_id !== eventId) {
        throw new BookingError('MISMATCHED_EVENT', `Ticket tier does not belong to this event`, 400);
      }
      if (item.quantity <= 0) {
        throw new BookingError('INVALID_QUANTITY', 'Ticket quantity must be greater than zero', 400);
      }
      if (item.quantity > tt.per_user_limit) {
        throw new BookingError('LIMIT_EXCEEDED', `Quantity exceeds per-user limit of ${tt.per_user_limit}`, 400);
      }
      if (tt.sales_start && new Date(tt.sales_start) > now) {
        throw new BookingError('SALES_NOT_OPEN', `Sales for ${tt.name} have not started`, 400);
      }
      if (tt.sales_end && new Date(tt.sales_end) < now) {
        throw new BookingError('SALES_ENDED', `Sales for ${tt.name} have ended`, 400);
      }

      // Invariant: sold + held + quantity <= capacity
      if (tt.sold + tt.held + item.quantity > tt.capacity) {
        throw new SoldOutError(`Tier "${tt.name}" is sold out`, true);
      }

      calculatedTotalPaise += tt.price_paise * item.quantity;
      bookingItemsToInsert.push({
        ticketTypeId: tt.id,
        quantity: item.quantity,
        unitPricePaise: tt.price_paise,
      });
    }

    // 6. Update sold counts on ticket_types rows
    for (const item of bookingItemsToInsert) {
      await client.query(
        `UPDATE ticket_types
         SET sold = sold + $1
         WHERE id = $2;`,
        [item.quantity, item.ticketTypeId]
      );
    }

    // 7. Insert Booking (Status: CONFIRMED for free bookings)
    const bookingStatus = calculatedTotalPaise === 0 ? 'CONFIRMED' : 'PENDING_PAYMENT';
    let booking: any;
    try {
      const bookingRes = await client.query(
        `INSERT INTO bookings (
           user_id, event_id, team_registration_id, status, total_paise, idempotency_key
         ) VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *;`,
        [userId, eventId, teamRegistrationId || null, bookingStatus, calculatedTotalPaise, idempotencyKey]
      );
      booking = bookingRes.rows[0];
    } catch (insertErr: any) {
      if (insertErr.code === '23505' && insertErr.constraint === 'uq_booking_user_idempotency') {
        await client.query('ROLLBACK');
        // Small delay to ensure the winning concurrent transaction has committed
        await new Promise((r) => setTimeout(r, 50));
        const retryRes = await pool.query(
          `SELECT * FROM bookings WHERE user_id = $1 AND idempotency_key = $2;`,
          [userId, idempotencyKey]
        );
        if (retryRes.rows.length > 0) {
          const existingBooking = retryRes.rows[0];
          const itemsRes = await pool.query(
            `SELECT * FROM booking_items WHERE booking_id = $1;`,
            [existingBooking.id]
          );
          const ticketsRes = await pool.query(
            `SELECT id, ticket_code, status, checked_in_at, created_at FROM tickets WHERE booking_id = $1;`,
            [existingBooking.id]
          );
          return {
            booking: existingBooking,
            items: itemsRes.rows,
            tickets: ticketsRes.rows,
            warnings: [],
            isIdempotentReplay: true,
          };
        }
      }
      throw insertErr;
    }

    // 8. Insert Booking Items (price snapshot)
    const insertedItems: any[] = [];
    for (const item of bookingItemsToInsert) {
      const itemRes = await client.query(
        `INSERT INTO booking_items (booking_id, ticket_type_id, quantity, unit_price_paise)
         VALUES ($1, $2, $3, $4)
         RETURNING *;`,
        [booking.id, item.ticketTypeId, item.quantity, item.unitPricePaise]
      );
      insertedItems.push(itemRes.rows[0]);
    }

    // 9. Save Registration Answers if provided
    if (answers && answers.length > 0) {
      for (const ans of answers) {
        await client.query(
          `INSERT INTO registration_answers (booking_id, question_id, answer)
           VALUES ($1, $2, $3);`,
          [booking.id, ans.questionId, JSON.stringify(ans.answer)]
        );
      }
    }

    // 10. Generate Tickets if booking is CONFIRMED
    const insertedTickets: any[] = [];
    if (bookingStatus === 'CONFIRMED') {
      for (const item of bookingItemsToInsert) {
        for (let q = 0; q < item.quantity; q++) {
          const rawToken = crypto.randomBytes(32).toString('base64url');
          const tokenHash = crypto.createHash('sha256').update(rawToken).digest();
          const ticketCode = `TCK-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

          const ticketRes = await client.query(
            `INSERT INTO tickets (
               booking_id, ticket_type_id, user_id, owner_user_id, event_id, ticket_code, qr_payload_hash, qr_token_hash, status
             ) VALUES ($1, $2, $3, $3, $4, $5, $6, $6, 'VALID')
             RETURNING id, ticket_code, status, created_at;`,
            [booking.id, item.ticketTypeId, userId, eventId, ticketCode, tokenHash]
          );

          insertedTickets.push({
            ...ticketRes.rows[0],
            qrTokenPreview: rawToken, // ephemeral for client display
          });
        }
      }

      // 11. Write outbox event atomically
      await client.query(
        `INSERT INTO outbox (event_type, payload, dedupe_key)
         VALUES ($1, $2, $3);`,
        [
          'booking.confirmed',
          JSON.stringify({
            bookingId: booking.id,
            userId,
            eventId,
            ticketCount: insertedTickets.length,
            totalPaise: calculatedTotalPaise,
          }),
          `booking-confirmed-${booking.id}`,
        ]
      );
    }

    // 12. Non-blocking schedule overlap check
    const warnings: { code: string; eventId?: string; message: string }[] = [];
    const overlapRes = await client.query(
      `SELECT e.id, e.title
       FROM bookings b
       JOIN events e ON b.event_id = e.id
       WHERE b.user_id = $1
         AND b.status = 'CONFIRMED'
         AND b.event_id != $2
         AND e.starts_at < $3
         AND e.ends_at > $4;`,
      [userId, eventId, event.ends_at, event.starts_at]
    );

    for (const ov of overlapRes.rows) {
      warnings.push({
        code: 'OVERLAP',
        eventId: ov.id,
        message: `Schedule conflict: You have a confirmed registration for overlapping event "${ov.title}".`,
      });
    }

    await client.query('COMMIT');

    return {
      booking,
      items: insertedItems,
      tickets: insertedTickets,
      warnings,
      isIdempotentReplay: false,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
