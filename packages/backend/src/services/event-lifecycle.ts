import { db, pool } from '../db/index.js';
import {
  organizerMembers,
  type Event,
  type EventStatus,
} from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { logAuditEvent } from './audit.js';

export interface TransitionGuardContext {
  actorId: string;
  actorRole: string;
  reviewerComments?: string;
  note?: string;
}

export interface CancelCascadeSummary {
  cancelledBookingsCount: number;
  ticketsRevokedCount: number;
  refundsQueuedCount: number;
  waitlistClosedCount: number;
  outboxQueuedCount: number;
  releasedVenueBookingsCount: number;
}

function mapEventRow(row: any): Event {
  return {
    id: row.id,
    organizerId: row.organizer_id,
    collegeId: row.college_id,
    title: row.title,
    slug: row.slug,
    description: row.description,
    category: row.category,
    tags: row.tags || [],
    department: row.department,
    format: row.format,
    venueId: row.venue_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    registrationOpensAt: row.registration_opens_at,
    registrationClosesAt: row.registration_closes_at,
    capacity: row.capacity,
    pricingType: row.pricing_type || 'free',
    currency: row.currency || 'INR',
    eligibility: row.eligibility || {},
    visibility: row.visibility,
    status: row.status,
    teamMode: row.team_mode || 'none',
    teamMin: row.team_min,
    teamMax: row.team_max,
    contactEmail: row.contact_email,
    allowGuests: row.allow_guests ?? false,
    version: row.version,
    createdBy: row.created_by,
    searchVector: row.search_vector || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const VALID_TRANSITIONS: Record<EventStatus, EventStatus[]> = {
  draft: ['pending_approval'],
  pending_approval: ['approved', 'changes_requested', 'rejected'],
  changes_requested: ['pending_approval'],
  approved: ['published', 'cancelled'],
  rejected: ['draft'], // Can be reset to draft to rework
  published: ['postponed', 'cancelled', 'completed'],
  postponed: ['published', 'cancelled'],
  cancelled: [],
  completed: [],
};

export class InvalidTransitionError extends Error {
  public readonly fromStatus: string;
  public readonly toStatus: string;

  constructor(fromStatus: string, toStatus: string, message?: string) {
    super(message || `Cannot transition event from ${fromStatus} to ${toStatus}.`);
    this.name = 'InvalidTransitionError';
    this.fromStatus = fromStatus;
    this.toStatus = toStatus;
  }
}

export class ReviewerConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewerConflictError';
  }
}

/**
 * Checks if a transition from -> to is structurally valid in the state machine
 */
export function isValidTransition(from: EventStatus, to: EventStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Executes an atomic event state transition within a SINGLE database transaction:
 * - UPDATE events SET status = $toStatus, version = version + 1, updated_at = NOW()
 * - INSERT into event_status_history
 * - Side effects (venue release/confirm, ticket revoke, booking cancel, tier reset, waitlist close, refund queue, outbox notices)
 * - INSERT into audit_logs
 *
 * If ANY part fails, the entire transaction rolls back atomically.
 */
export async function transitionEventStatus(
  eventId: string,
  fromStatus: EventStatus,
  toStatus: EventStatus,
  ctx: TransitionGuardContext
): Promise<Event & { cascadeSummary?: CancelCascadeSummary }> {
  if (!isValidTransition(fromStatus, toStatus)) {
    throw new InvalidTransitionError(fromStatus, toStatus);
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Atomic state change with optimistic version increment
    const eventUpdateRes = await client.query(
      `UPDATE events
       SET status = $1, version = version + 1, updated_at = NOW()
       WHERE id = $2 AND status = $3
       RETURNING *;`,
      [toStatus, eventId, fromStatus]
    );

    if (eventUpdateRes.rows.length === 0) {
      throw new InvalidTransitionError(
        fromStatus,
        toStatus,
        `State transition conflict: Event ${eventId} is no longer in '${fromStatus}' status.`
      );
    }

    const rawUpdated = eventUpdateRes.rows[0];
    const updated = mapEventRow(rawUpdated);

    // 2. Record in event_status_history (actor_id nullable for system actions)
    const historyActorId = ctx.actorId && ctx.actorId !== 'system' ? ctx.actorId : null;
    await client.query(
      `INSERT INTO event_status_history (event_id, from_status, to_status, actor_id, note, at)
       VALUES ($1, $2, $3, $4, $5, NOW());`,
      [eventId, fromStatus, toStatus, historyActorId, ctx.note || ctx.reviewerComments || null]
    );

    let cascadeSummary: CancelCascadeSummary | undefined;

    // 3. Execute side-effects according to target status
    if (toStatus === 'approved') {
      // Confirm venue booking if on hold
      await client.query(
        `UPDATE venue_bookings
         SET status = 'confirmed'
         WHERE event_id = $1 AND status = 'hold';`,
        [eventId]
      );
    } else if (toStatus === 'rejected') {
      // Release held venue booking
      await client.query(
        `UPDATE venue_bookings
         SET status = 'released'
         WHERE event_id = $1 AND status = 'hold';`,
        [eventId]
      );
    } else if (toStatus === 'cancelled') {
      // 1. Release confirmed or held venue booking
      const vbRes = await client.query(
        `UPDATE venue_bookings
         SET status = 'released'
         WHERE event_id = $1 AND status IN ('hold', 'confirmed');`,
        [eventId]
      );
      const releasedVenueBookingsCount = vbRes.rowCount || 0;

      // 2. Revoke all active tickets for this event
      const tRes = await client.query(
        `UPDATE tickets
         SET status = 'REVOKED'
         WHERE event_id = $1 AND status != 'REVOKED';`,
        [eventId]
      );
      const ticketsRevokedCount = tRes.rowCount || 0;

      // 3. Reset inventory on ticket tiers (sold = 0, held = 0)
      await client.query(
        `UPDATE ticket_types
         SET sold = 0, held = 0
         WHERE event_id = $1;`,
        [eventId]
      );

      // 4. Cancel all active bookings
      const bRes = await client.query(
        `UPDATE bookings
         SET status = 'CANCELLED'
         WHERE event_id = $1 AND status != 'CANCELLED'
         RETURNING id, user_id, total_paise;`,
        [eventId]
      );
      const cancelledBookingsCount = bRes.rowCount || 0;

      // 5. Expire pending waitlist offers & waiting entries
      const wlRes = await client.query(
        `UPDATE waitlist_entries
         SET status = 'EXPIRED'
         WHERE event_id = $1 AND status IN ('WAITING', 'OFFERED');`,
        [eventId]
      );
      const waitlistClosedCount = wlRes.rowCount || 0;

      // 6. Automatically queue refund requests for paid bookings with succeeded payment
      const pRes = await client.query(
        `SELECT p.id as payment_id, p.amount_paise, p.booking_id, b.user_id
         FROM payments p
         JOIN bookings b ON p.booking_id = b.id
         WHERE b.event_id = $1 AND p.status = 'SUCCEEDED';`,
        [eventId]
      );

      let refundsQueuedCount = 0;
      for (const p of pRes.rows) {
        const idempotencyKey = `cancel_refund_${p.booking_id}_${p.payment_id}`;
        const refRes = await client.query(
          `INSERT INTO refunds (
             payment_id, amount_paise, reason, status, requested_by, idempotency_key, created_at
           ) VALUES ($1, $2, $3, 'REQUESTED', $4, $5, NOW())
           ON CONFLICT (idempotency_key) DO NOTHING
           RETURNING id;`,
          [
            p.payment_id,
            p.amount_paise,
            ctx.note || `Event cancelled: ${updated.title}`,
            historyActorId,
            idempotencyKey,
          ]
        );
        if (refRes.rows.length > 0) {
          refundsQueuedCount++;
        }
        await client.query(
          `UPDATE payments SET status = 'REFUND_PENDING', updated_at = NOW() WHERE id = $1;`,
          [p.payment_id]
        );
      }

      // 7. Queue outbox notice for all affected attendees + general event notice
      const attendeesRes = await client.query(
        `SELECT DISTINCT user_id
         FROM bookings
         WHERE event_id = $1 AND user_id IS NOT NULL;`,
        [eventId]
      );

      let attendeeNotifsCount = 0;
      for (const att of attendeesRes.rows) {
        const notifDedupe = `notif_event_cancelled_${eventId}_${att.user_id}_${updated.version}`;
        await client.query(
          `INSERT INTO outbox (event_type, payload, status, dedupe_key, created_at)
           VALUES ($1, $2, 'pending', $3, NOW())
           ON CONFLICT (dedupe_key) DO NOTHING;`,
          [
            'notification.event_cancelled',
            JSON.stringify({
              eventId,
              eventTitle: updated.title,
              userId: att.user_id,
              note: ctx.note || 'Event cancelled by organizer',
              cancelledAt: new Date().toISOString(),
            }),
            notifDedupe,
          ]
        );
        attendeeNotifsCount++;
      }

      // General event cancellation outbox row
      await client.query(
        `INSERT INTO outbox (event_type, payload, status, dedupe_key, created_at)
         VALUES ($1, $2, 'pending', $3, NOW())
         ON CONFLICT (dedupe_key) DO NOTHING;`,
        [
          'event.cancelled',
          JSON.stringify({
            eventId,
            eventTitle: updated.title,
            cancelledAt: new Date().toISOString(),
            actorId: ctx.actorId,
            note: ctx.note,
            cancelledBookingsCount,
            ticketsRevokedCount,
            refundsQueuedCount,
            waitlistClosedCount,
          }),
          `event_cancelled_${eventId}_${updated.version}`,
        ]
      );

      cascadeSummary = {
        cancelledBookingsCount,
        ticketsRevokedCount,
        refundsQueuedCount,
        waitlistClosedCount,
        outboxQueuedCount: attendeeNotifsCount + 1,
        releasedVenueBookingsCount,
      };
    }

    // 4. Audit logging within the SAME transaction
    await logAuditEvent(
      {
        actorId: ctx.actorId,
        action: `event.status_changed.${toStatus}`,
        resourceType: 'event',
        resourceId: eventId,
        collegeId: updated.collegeId,
        meta: {
          fromStatus,
          toStatus,
          note: ctx.note || ctx.reviewerComments,
          cascadeSummary,
        },
      },
      client
    );

    await client.query('COMMIT');

    return {
      ...updated,
      cascadeSummary,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Validates that a faculty reviewer is eligible to review the event:
 * Must NOT be the event creator, and must NOT be a member of the event's organizer.
 */
export async function assertReviewerEligibility(
  reviewerId: string,
  event: Event
): Promise<void> {
  // 1. Cannot be creator
  if (event.createdBy === reviewerId) {
    throw new ReviewerConflictError(
      'Conflict of interest: Event creator cannot act as faculty reviewer for their own proposal.'
    );
  }

  // 2. Cannot be an organizer member
  const membership = await db.query.organizerMembers.findFirst({
    where: and(
      eq(organizerMembers.organizerId, event.organizerId),
      eq(organizerMembers.userId, reviewerId),
      eq(organizerMembers.status, 'active')
    ),
  });

  if (membership) {
    throw new ReviewerConflictError(
      'Conflict of interest: Member of the organizing club cannot act as faculty reviewer.'
    );
  }
}
