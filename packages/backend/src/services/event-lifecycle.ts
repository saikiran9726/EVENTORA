import { db } from '../db/index.js';
import {
  events,
  eventStatusHistory,
  eventApprovals,
  venueBookings,
  organizerMembers,
  outbox,
  type Event,
  type EventStatus,
} from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import { logAuditEvent } from './audit.js';

export interface TransitionGuardContext {
  actorId: string;
  actorRole: string;
  reviewerComments?: string;
  note?: string;
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
 * Executes an atomic event state transition:
 * UPDATE events SET status = $toStatus, version = version + 1, updated_at = NOW()
 * WHERE id = $eventId AND status = $fromStatus RETURNING *;
 *
 * Appends to event_status_history and executes cascading side effects.
 */
export async function transitionEventStatus(
  eventId: string,
  fromStatus: EventStatus,
  toStatus: EventStatus,
  ctx: TransitionGuardContext
): Promise<Event> {
  if (!isValidTransition(fromStatus, toStatus)) {
    throw new InvalidTransitionError(fromStatus, toStatus);
  }

  // Atomic state change with optimistic version increment
  const [updated] = await db
    .update(events)
    .set({
      status: toStatus,
      version: sql`${events.version} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(events.id, eventId), eq(events.status, fromStatus)))
    .returning();

  if (!updated) {
    // 0 rows returned means the event was concurrently modified or status changed
    throw new InvalidTransitionError(
      fromStatus,
      toStatus,
      `State transition conflict: Event ${eventId} is no longer in '${fromStatus}' status.`
    );
  }

  // Record in event_status_history
  await db.insert(eventStatusHistory).values({
    eventId,
    fromStatus,
    toStatus,
    actorId: ctx.actorId,
    note: ctx.note || ctx.reviewerComments || null,
  });

  // Execute side-effects according to target status
  if (toStatus === 'approved') {
    // Confirm venue booking if on hold
    await db
      .update(venueBookings)
      .set({ status: 'confirmed' })
      .where(and(eq(venueBookings.eventId, eventId), eq(venueBookings.status, 'hold')));
  } else if (toStatus === 'rejected') {
    // Release held venue booking
    await db
      .update(venueBookings)
      .set({ status: 'released' })
      .where(and(eq(venueBookings.eventId, eventId), eq(venueBookings.status, 'hold')));
  } else if (toStatus === 'cancelled') {
    // Release confirmed or held venue booking
    await db
      .update(venueBookings)
      .set({ status: 'released' })
      .where(eq(venueBookings.eventId, eventId));

    // Cascade cancellation hook:
    // In Phase 3: wire cascade stub and outbox event
    // In Phases 4-5: bookings -> CANCELLED, tickets -> REVOKED, waitlist closed
    await db.insert(outbox).values({
      eventType: 'event.cancelled',
      payload: {
        eventId,
        cancelledAt: new Date().toISOString(),
        actorId: ctx.actorId,
        note: ctx.note,
      },
      status: 'pending',
      dedupeKey: `event_cancelled_${eventId}_${Date.now()}`,
    });
  }

  await logAuditEvent({
    actorId: ctx.actorId,
    action: `event.status_changed.${toStatus}`,
    resourceType: 'event',
    resourceId: eventId,
    collegeId: updated.collegeId,
    meta: {
      fromStatus,
      toStatus,
      note: ctx.note || ctx.reviewerComments,
    },
  });

  return updated;
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
