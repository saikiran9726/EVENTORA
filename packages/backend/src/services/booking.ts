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
  payloadHash?: string;
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
 * 3. Idempotency-Key deduplication returning original booking response, bound to SHA-256 payload hash.
 * 4. Free bookings set status = 'CONFIRMED' with total_paise = 0 (no payment screen).
 * 5. Outbox record written atomically with booking.
 * 6. Non-blocking student schedule overlap check returned as warnings.
 * 7. Active solo booking duplicate guard: counts only PENDING_PAYMENT or CONFIRMED.
 * 8. Registration question validation against event registration_form_questions.
 */
export async function createBooking(params: CreateBookingParams): Promise<BookingResult> {
  const { userId, eventId, items, idempotencyKey, payloadHash, teamRegistrationId, answers } = params;

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

      // Verify payload hash matches if present
      if (payloadHash && existingBooking.payload_hash && existingBooking.payload_hash !== payloadHash) {
        throw new BookingError(
          'IDEMPOTENCY_PAYLOAD_MISMATCH',
          'Idempotency key reused with different request payload',
          422
        );
      }

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

    // 2. Validate Event state and registration window (lock event row to serialize total capacity checks)
    const eventRes = await client.query(
      `SELECT id, title, status, starts_at, ends_at, registration_opens_at, registration_closes_at, capacity, team_mode
       FROM events WHERE id = $1 FOR UPDATE;`,
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
    if (event.ends_at && new Date(event.ends_at) <= now) {
      throw new BookingError('EVENT_ALREADY_ENDED', 'Cannot book tickets for an event that has already ended', 400);
    }

    // 3. Validate Team Registration or Check active solo booking (only PENDING_PAYMENT or CONFIRMED)
    if (teamRegistrationId) {
      const trRes = await client.query(
        `SELECT tr.id, tr.event_id, tm.status
         FROM team_event_registrations tr
         JOIN team_members tm ON tr.team_id = tm.team_id AND tm.user_id = $1 AND tm.status = 'ACTIVE'
         WHERE tr.id = $2;`,
        [userId, teamRegistrationId]
      );
      if (trRes.rows.length === 0) {
        throw new BookingError(
          'INVALID_TEAM_REGISTRATION',
          'Team registration not found or you are not an active member of this team',
          403
        );
      }
      if (trRes.rows[0].event_id !== eventId) {
        throw new BookingError('MISMATCHED_EVENT', 'Team registration belongs to a different event', 400);
      }
    } else {
      const activeBookingCheck = await client.query(
        `SELECT id, idempotency_key, payload_hash FROM bookings
         WHERE user_id = $1 AND event_id = $2 AND status IN ('PENDING_PAYMENT', 'CONFIRMED') AND team_registration_id IS NULL;`,
        [userId, eventId]
      );
      if (activeBookingCheck.rows.length > 0) {
        // If the active booking has the same idempotency_key, this is a concurrent or repeated replay of the same booking
        const matchingIdem = activeBookingCheck.rows.find((r) => r.idempotency_key === idempotencyKey);
        if (matchingIdem) {
          if (payloadHash && matchingIdem.payload_hash && matchingIdem.payload_hash !== payloadHash) {
            throw new BookingError(
              'IDEMPOTENCY_PAYLOAD_MISMATCH',
              'Idempotency key reused with different request payload',
              422
            );
          }
          await client.query('COMMIT');
          const itemsRes = await pool.query(
            `SELECT * FROM booking_items WHERE booking_id = $1;`,
            [matchingIdem.id]
          );
          const ticketsRes = await pool.query(
            `SELECT id, ticket_code, status, checked_in_at, created_at FROM tickets WHERE booking_id = $1;`,
            [matchingIdem.id]
          );
          return {
            booking: matchingIdem,
            items: itemsRes.rows,
            tickets: ticketsRes.rows,
            warnings: [],
            isIdempotentReplay: true,
          };
        }

        throw new BookingError(
          'ALREADY_REGISTERED',
          'You already have an active registration for this event',
          409
        );
      }
    }

    // 4. Validate Custom Registration Form Questions
    const questionsRes = await client.query(
      `SELECT id, label, type, required, options
       FROM registration_form_questions
       WHERE event_id = $1
       ORDER BY sort ASC, id ASC;`,
      [eventId]
    );

    if (questionsRes.rows.length > 0) {
      const questionMap = new Map<string, any>(
        questionsRes.rows.map((q) => [q.id, q])
      );

      // Verify answers only refer to questions of this event
      if (answers && answers.length > 0) {
        for (const ans of answers) {
          if (!questionMap.has(ans.questionId)) {
            throw new BookingError(
              'INVALID_QUESTION',
              `Question ${ans.questionId} does not belong to this event`,
              400
            );
          }
        }
      }

      // Check required questions and valid option choices
      const answersMap = new Map<string, any>(
        (answers || []).map((a) => [a.questionId, a.answer])
      );

      for (const q of questionsRes.rows) {
        const ansVal = answersMap.get(q.id);
        const isEmpty =
          ansVal === undefined ||
          ansVal === null ||
          (typeof ansVal === 'string' && ansVal.trim() === '');

        if (q.required && isEmpty) {
          throw new BookingError(
            'MISSING_REQUIRED_QUESTION',
            `Answer is required for question: "${q.label}"`,
            400,
            { questionId: q.id }
          );
        }

        if (!isEmpty && (q.type === 'select' || q.type === 'radio') && Array.isArray(q.options)) {
          if (!q.options.includes(ansVal)) {
            throw new BookingError(
              'INVALID_QUESTION_OPTION',
              `Selected option is invalid for question: "${q.label}"`,
              400,
              { questionId: q.id, allowedOptions: q.options }
            );
          }
        }
      }
    }

    // 5. Normalize duplicate ticket tier lines and sort in ascending order to prevent deadlocks
    const normalizedMap = new Map<string, number>();
    for (const it of items) {
      if (it.quantity <= 0) {
        throw new BookingError('INVALID_QUANTITY', 'Ticket quantity must be greater than zero', 400);
      }
      normalizedMap.set(it.ticketTypeId, (normalizedMap.get(it.ticketTypeId) || 0) + it.quantity);
    }

    const sortedItems = Array.from(normalizedMap.entries())
      .map(([ticketTypeId, quantity]) => ({ ticketTypeId, quantity }))
      .sort((a, b) => a.ticketTypeId.localeCompare(b.ticketTypeId));

    const ticketTypeIds = sortedItems.map((i) => i.ticketTypeId);

    // 6. Lock ticket_types rows with SELECT ... FOR UPDATE in ascending order
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

    // 7. Check overall event capacity limit across all tiers
    if (event.capacity) {
      const bookedRes = await client.query(
        `SELECT COALESCE(SUM(sold + held), 0) as total_booked FROM ticket_types WHERE event_id = $1;`,
        [eventId]
      );
      const totalBooked = parseInt(bookedRes.rows[0]?.total_booked || '0', 10);
      const requestedCount = sortedItems.reduce((acc, it) => acc + it.quantity, 0);
      if (totalBooked + requestedCount > event.capacity) {
        throw new SoldOutError(`Event "${event.title}" has reached overall capacity limit`, true);
      }
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

    // 8. Update inventory counts:
    // Free bookings immediately occupy 'sold'.
    // Paid bookings reserve seats in 'held' until payment confirmation; expires in 15 mins.
    const isFree = calculatedTotalPaise === 0;
    const bookingStatus = isFree ? 'CONFIRMED' : 'PENDING_PAYMENT';
    const expiresAt = isFree ? null : new Date(Date.now() + 15 * 60 * 1000);

    for (const item of bookingItemsToInsert) {
      if (isFree) {
        await client.query(
          `UPDATE ticket_types SET sold = sold + $1 WHERE id = $2;`,
          [item.quantity, item.ticketTypeId]
        );
      } else {
        await client.query(
          `UPDATE ticket_types SET held = held + $1 WHERE id = $2;`,
          [item.quantity, item.ticketTypeId]
        );
      }
    }

    // 9. Insert Booking (Status: CONFIRMED for free, PENDING_PAYMENT for paid with expires_at)
    let booking: any;
    try {
      const bookingRes = await client.query(
        `INSERT INTO bookings (
           user_id, event_id, team_registration_id, status, total_paise, idempotency_key, expires_at, payload_hash
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *;`,
        [userId, eventId, teamRegistrationId || null, bookingStatus, calculatedTotalPaise, idempotencyKey, expiresAt, payloadHash || null]
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
          if (payloadHash && existingBooking.payload_hash && existingBooking.payload_hash !== payloadHash) {
            throw new BookingError(
              'IDEMPOTENCY_PAYLOAD_MISMATCH',
              'Idempotency key reused with different request payload',
              422
            );
          }
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
      if (
        insertErr.code === '23505' &&
        (insertErr.constraint === 'bookings_active_user_event_solo_idx' ||
          insertErr.constraint === 'uq_booking_user_event_active')
      ) {
        await client.query('ROLLBACK');
        // Check if the conflicting active booking has the same idempotency key (concurrent race of same request)
        await new Promise((r) => setTimeout(r, 50));
        const retryRes = await pool.query(
          `SELECT * FROM bookings WHERE user_id = $1 AND idempotency_key = $2;`,
          [userId, idempotencyKey]
        );
        if (retryRes.rows.length > 0) {
          const existingBooking = retryRes.rows[0];
          if (payloadHash && existingBooking.payload_hash && existingBooking.payload_hash !== payloadHash) {
            throw new BookingError(
              'IDEMPOTENCY_PAYLOAD_MISMATCH',
              'Idempotency key reused with different request payload',
              422
            );
          }
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

        throw new BookingError(
          'ALREADY_REGISTERED',
          'You already have an active registration for this event',
          409
        );
      }
      throw insertErr;
    }

    // 10. Insert Booking Items (price snapshot)
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

    // 11. Save Registration Answers if provided
    if (answers && answers.length > 0) {
      for (const ans of answers) {
        await client.query(
          `INSERT INTO registration_answers (booking_id, question_id, answer)
           VALUES ($1, $2, $3);`,
          [booking.id, ans.questionId, JSON.stringify(ans.answer)]
        );
      }
    }

    // 12. Generate Tickets if booking is CONFIRMED (free bookings)
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

      // 13. Write outbox event atomically
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

    // 14. Non-blocking schedule overlap check
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
