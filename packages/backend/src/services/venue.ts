import { pool } from '../db/index.js';
import { db } from '../db/index.js';
import { venues, venueBookings, type VenueBooking } from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';

export class VenueConflictError extends Error {
  public readonly code = 'VENUE_CONFLICT';
  public readonly venueId: string;
  public readonly startsAt: string;
  public readonly endsAt: string;

  constructor(venueId: string, startsAt: string, endsAt: string, message?: string) {
    super(
      message ||
        `Venue scheduling conflict: Venue ${venueId} is already booked during the requested window (${startsAt} - ${endsAt}).`
    );
    this.name = 'VenueConflictError';
    this.venueId = venueId;
    this.startsAt = startsAt;
    this.endsAt = endsAt;
  }
}

/**
 * Creates or updates a venue booking with GiST exclusion constraint check.
 * PostgreSQL GiST exclusion constraint enforces non-overlapping tstzrange windows.
 * Any collision throws SQLSTATE 23P01 (exclusion_violation).
 */
export async function bookVenueWindow(
  eventId: string,
  venueId: string,
  startsAt: Date,
  endsAt: Date,
  status: 'hold' | 'confirmed' = 'hold'
): Promise<VenueBooking> {
  const duringRange = `[${startsAt.toISOString()}, ${endsAt.toISOString()})`;

  // Use raw client or sql to ensure tstzrange is cast accurately for GiST index
  const client = await pool.connect();
  try {
    // Check if there is an existing booking for this event
    const existingResult = await client.query(
      `SELECT id FROM venue_bookings WHERE event_id = $1 LIMIT 1`,
      [eventId]
    );

    let res;
    if (existingResult.rows.length > 0) {
      // Update existing booking
      res = await client.query(
        `UPDATE venue_bookings
         SET venue_id = $2,
             during = $3::tstzrange,
             status = $4
         WHERE id = $1
         RETURNING *;`,
        [existingResult.rows[0].id, venueId, duringRange, status]
      );
    } else {
      // Insert new booking
      res = await client.query(
        `INSERT INTO venue_bookings (event_id, venue_id, during, status)
         VALUES ($1, $2, $3::tstzrange, $4)
         RETURNING *;`,
        [eventId, venueId, duringRange, status]
      );
    }

    return res.rows[0] as VenueBooking;
  } catch (err: any) {
    // Catch PostgreSQL SQLSTATE 23P01 (exclusion_violation)
    if (err.code === '23P01' || err.message?.includes('uq_venue_booking_overlap')) {
      throw new VenueConflictError(
        venueId,
        startsAt.toISOString(),
        endsAt.toISOString(),
        `Venue scheduling conflict: The venue is already booked for another event during ${startsAt.toISOString()} to ${endsAt.toISOString()}.`
      );
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Checks if a venue is available for a requested window without creating a booking.
 */
export async function checkVenueAvailability(
  venueId: string,
  startsAt: Date,
  endsAt: Date,
  excludeEventId?: string
): Promise<{ available: boolean; conflict?: { eventId: string; during: string } }> {
  const duringRange = `[${startsAt.toISOString()}, ${endsAt.toISOString()})`;

  const client = await pool.connect();
  try {
    let query = `
      SELECT id, event_id, during
      FROM venue_bookings
      WHERE venue_id = $1
        AND status IN ('hold', 'confirmed')
        AND during && $2::tstzrange
    `;
    const params: any[] = [venueId, duringRange];

    if (excludeEventId) {
      query += ` AND event_id != $3`;
      params.push(excludeEventId);
    }

    query += ` LIMIT 1`;

    const res = await client.query(query, params);
    if (res.rows.length > 0) {
      return {
        available: false,
        conflict: {
          eventId: res.rows[0].event_id,
          during: res.rows[0].during,
        },
      };
    }

    return { available: true };
  } finally {
    client.release();
  }
}
