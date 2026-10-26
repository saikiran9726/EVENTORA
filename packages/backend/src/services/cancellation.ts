import { pool } from '../db/index.js';
import { BookingError } from './booking.js';
import { promoteNext } from './waitlist.js';

export async function cancelBooking(bookingId: string, actorId: string, reason = 'Attendee requested cancellation') {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Lock booking row
    const bookingRes = await client.query(
      `SELECT b.id, b.user_id, b.event_id, b.status, b.team_registration_id, e.starts_at
       FROM bookings b
       JOIN events e ON b.event_id = e.id
       WHERE b.id = $1
       FOR UPDATE OF b;`,
      [bookingId]
    );

    if (bookingRes.rows.length === 0) {
      throw new BookingError('BOOKING_NOT_FOUND', 'Booking not found', 404);
    }

    const booking = bookingRes.rows[0];

    // 2. Ownership / permission check
    if (booking.user_id !== actorId) {
      // Check if actor is an admin
      const userRes = await client.query(`SELECT global_role FROM users WHERE id = $1;`, [actorId]);
      if (userRes.rows.length === 0 || userRes.rows[0].global_role !== 'admin') {
        throw new BookingError('FORBIDDEN', 'You are not authorized to cancel this booking', 403);
      }
    }

    // 3. Status guard
    if (booking.status === 'CANCELLED') {
      throw new BookingError('ALREADY_CANCELLED', 'This booking has already been cancelled', 400);
    }

    // 4. Update booking status
    await client.query(
      `UPDATE bookings SET status = 'CANCELLED' WHERE id = $1;`,
      [bookingId]
    );

    // 5. Insert cancellation log
    await client.query(
      `INSERT INTO cancellations (booking_id, reason, actor_id)
       VALUES ($1, $2, $3);`,
      [bookingId, reason, actorId]
    );

    // 6. Invalidate tickets
    await client.query(
      `UPDATE tickets SET status = 'CANCELLED' WHERE booking_id = $1;`,
      [bookingId]
    );

    // 7. Lock ticket_types rows in sorted ascending order to prevent deadlocks under concurrency
    const itemsRes = await client.query(
      `SELECT ticket_type_id, quantity FROM booking_items WHERE booking_id = $1 ORDER BY ticket_type_id ASC;`,
      [bookingId]
    );

    const ticketTypeIds = itemsRes.rows.map((i: any) => i.ticket_type_id).sort();
    if (ticketTypeIds.length > 0) {
      await client.query(
        `SELECT id, capacity, sold, held FROM ticket_types WHERE id = ANY($1::uuid[]) ORDER BY id ASC FOR UPDATE;`,
        [ticketTypeIds]
      );
    }

    // 8. Release inventory:
    // - PENDING_PAYMENT: release held capacity (held -= q)
    // - CONFIRMED: release sold capacity (sold -= q) and trigger waitlist promotion
    const wasPendingPayment = booking.status === 'PENDING_PAYMENT';
    const wasConfirmed = booking.status === 'CONFIRMED';

    for (const item of itemsRes.rows) {
      if (wasPendingPayment) {
        await client.query(
          `UPDATE ticket_types
           SET held = GREATEST(0, held - $1)
           WHERE id = $2;`,
          [item.quantity, item.ticket_type_id]
        );
      } else if (wasConfirmed) {
        await client.query(
          `UPDATE ticket_types
           SET sold = GREATEST(0, sold - $1)
           WHERE id = $2;`,
          [item.quantity, item.ticket_type_id]
        );

        // In the same transaction: promote next waiting attendee
        await promoteNext(booking.event_id, item.ticket_type_id, client);
      }
    }

    // 8. Write to outbox
    await client.query(
      `INSERT INTO outbox (event_type, payload, dedupe_key)
       VALUES ($1, $2, $3);`,
      [
        'booking.cancelled',
        JSON.stringify({
          bookingId,
          userId: booking.user_id,
          eventId: booking.event_id,
          reason,
        }),
        `booking-cancelled-${bookingId}`,
      ]
    );

    await client.query('COMMIT');

    return {
      success: true,
      bookingId,
      status: 'CANCELLED',
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
