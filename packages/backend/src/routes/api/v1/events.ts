import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { db } from '../../../db/index.js';
import {
  events,
  venues,
  organizerProfiles,
  organizerMembers,
  eventApprovals,
  eventStatusHistory,
  eventFaqs,
  eventAnnouncements,
  outbox,
  type Event,
  type EventStatus,
} from '../../../db/schema.js';
import { eq, and, sql, desc, asc, gte, lte, or } from 'drizzle-orm';
import {
  transitionEventStatus,
  assertReviewerEligibility,
  ReviewerConflictError,
  InvalidTransitionError,
} from '../../../services/event-lifecycle.js';
import { bookVenueWindow, VenueConflictError } from '../../../services/venue.js';
import { generateIcsCalendar } from '../../../services/calendar.js';
import { logAuditEvent } from '../../../services/audit.js';

const listEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
  category: z.string().optional(),
  department: z.string().optional(),
  format: z.enum(['in_person', 'online', 'hybrid']).optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  search: z.string().optional(),
  availability: z.enum(['available', 'all']).optional(),
  sort: z.enum(['date_asc', 'date_desc', 'popularity']).default('date_asc'),
  status: z.string().optional(),
  organizer_id: z.string().uuid().optional(),
});

const createEventSchema = z.object({
  organizerId: z.string().uuid(),
  title: z.string().min(3).max(255),
  description: z.string().min(10),
  category: z.string().min(2).max(100),
  tags: z.array(z.string()).default([]),
  department: z.string().max(100).optional(),
  format: z.enum(['in_person', 'online', 'hybrid']),
  venueId: z.string().uuid().optional().nullable(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  registrationOpensAt: z.string().datetime().optional().nullable(),
  registrationClosesAt: z.string().datetime().optional().nullable(),
  capacity: z.number().int().min(0),
  eligibility: z.record(z.any()).default({}),
  visibility: z.enum(['college', 'public']).default('college'),
  teamMode: z.enum(['none', 'optional', 'required']).default('none'),
  teamMin: z.number().int().min(1).optional().nullable(),
  teamMax: z.number().int().min(1).optional().nullable(),
  contactEmail: z.string().email(),
});

const updateEventSchema = createEventSchema.partial().extend({
  version: z.number().int().optional(),
});

const approvalSchema = z.object({
  decision: z.enum(['approved', 'rejected', 'changes_requested']),
  comments: z.string().min(3, 'Reviewer comments are required'),
});

const statusActionSchema = z.object({
  note: z.string().optional(),
});

const createFaqSchema = z.object({
  question: z.string().min(3),
  answer: z.string().min(3),
  displayOrder: z.number().int().default(0),
});

const createAnnouncementSchema = z.object({
  body: z.string().min(3),
});

function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const suffix = Math.random().toString(36).substring(2, 7);
  return `${base}-${suffix}`;
}

export const eventRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // 1. GET /api/v1/events
  fastify.get(
    '/',
    {
      config: {
        auth: false,
        policy: 'public',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const parseResult = listEventsQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid events query parameters',
            details: parseResult.error.flatten(),
            requestId: req.id,
          },
        });
      }

      const q = parseResult.data;
      const user = req.user;
      const isAdmin = user?.globalRole === 'admin';
      const isReviewer = user?.globalRole === 'reviewer';

      // Status visibility guard: Anonymous & Students see ONLY 'published'
      let allowedStatuses: EventStatus[] = ['published'];

      if (q.status && (isAdmin || isReviewer)) {
        allowedStatuses = [q.status as EventStatus];
      } else if (q.status && user) {
        // Organizer checking owned events
        allowedStatuses = [q.status as EventStatus];
      }

      // Build query conditions
      const conditions: any[] = [];

      // Status filter
      if (allowedStatuses.length === 1) {
        conditions.push(eq(events.status, allowedStatuses[0]));
      } else {
        conditions.push(sql`${events.status} IN ${allowedStatuses}`);
      }

      // Organizer filter
      if (q.organizer_id) {
        conditions.push(eq(events.organizerId, q.organizer_id));
      }

      // Category filter
      if (q.category) {
        conditions.push(eq(events.category, q.category));
      }

      // Department filter
      if (q.department) {
        conditions.push(eq(events.department, q.department));
      }

      // Format filter
      if (q.format) {
        conditions.push(eq(events.format, q.format));
      }

      // Date range filter
      if (q.date_from) {
        conditions.push(gte(events.startsAt, new Date(q.date_from)));
      }
      if (q.date_to) {
        conditions.push(lte(events.startsAt, new Date(q.date_to)));
      }

      // Full-text search using PostgreSQL TSVECTOR
      if (q.search) {
        conditions.push(
          sql`events.search @@ plainto_tsquery('english', ${q.search})`
        );
      }

      // Cursor pagination
      if (q.cursor) {
        conditions.push(gte(events.startsAt, new Date(q.cursor)));
      }

      // Order by
      const orderBy = q.sort === 'date_desc' ? desc(events.startsAt) : asc(events.startsAt);

      const items = await db
        .select({
          id: events.id,
          organizerId: events.organizerId,
          collegeId: events.collegeId,
          title: events.title,
          slug: events.slug,
          description: events.description,
          category: events.category,
          tags: events.tags,
          department: events.department,
          format: events.format,
          venueId: events.venueId,
          startsAt: events.startsAt,
          endsAt: events.endsAt,
          registrationOpensAt: events.registrationOpensAt,
          registrationClosesAt: events.registrationClosesAt,
          capacity: events.capacity,
          visibility: events.visibility,
          status: events.status,
          teamMode: events.teamMode,
          teamMin: events.teamMin,
          teamMax: events.teamMax,
          contactEmail: events.contactEmail,
          version: events.version,
          createdAt: events.createdAt,
          venueName: venues.name,
          venueBuilding: venues.building,
          organizerName: organizerProfiles.displayName,
        })
        .from(events)
        .leftJoin(venues, eq(events.venueId, venues.id))
        .leftJoin(organizerProfiles, eq(events.organizerId, organizerProfiles.id))
        .where(and(...conditions))
        .orderBy(orderBy)
        .limit(q.limit + 1);

      let nextCursor: string | null = null;
      if (items.length > q.limit) {
        const nextItem = items.pop()!;
        nextCursor = nextItem.startsAt.toISOString();
      }

      return reply.code(200).send({
        items,
        nextCursor,
        limit: q.limit,
      });
    }
  );

  // 2. GET /api/v1/events/:slug (by slug or uuid)
  fastify.get(
    '/:slug',
    {
      config: {
        auth: false,
        policy: 'public',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { slug } = req.params as { slug: string };

      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug);

      const event = await db.query.events.findFirst({
        where: isUuid ? eq(events.id, slug) : eq(events.slug, slug),
        with: {
          venue: true,
          organizer: true,
          faqs: {
            orderBy: (f, { asc }) => [asc(f.displayOrder)],
          },
          announcements: {
            orderBy: (a, { desc }) => [desc(a.createdAt)],
          },
        },
      });

      if (!event) {
        return reply.code(404).send({
          error: {
            code: 'EVENT_NOT_FOUND',
            message: `Event '${slug}' was not found`,
            details: { slug },
            requestId: req.id,
          },
        });
      }

      // Check visibility guard if not published
      if (event.status !== 'published') {
        const user = req.user;
        const isAdmin = user?.globalRole === 'admin';
        const isReviewer = user?.globalRole === 'reviewer';
        const isCreator = user?.id === event.createdBy;

        let isOrganizerMember = false;
        if (user) {
          const membership = await db.query.organizerMembers.findFirst({
            where: and(
              eq(organizerMembers.organizerId, event.organizerId),
              eq(organizerMembers.userId, user.id),
              eq(organizerMembers.status, 'active')
            ),
          });
          isOrganizerMember = !!membership;
        }

        if (!isAdmin && !isReviewer && !isCreator && !isOrganizerMember) {
          return reply.code(404).send({
            error: {
              code: 'EVENT_NOT_FOUND',
              message: `Event '${slug}' is not published`,
              details: { status: event.status },
              requestId: req.id,
            },
          });
        }
      }

      return reply.code(200).send({ event });
    }
  );

  // 3. POST /api/v1/events (Create draft event)
  fastify.post(
    '/',
    {
      config: {
        auth: true,
        policy: 'event:create',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const parseResult = createEventSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid event payload',
            details: parseResult.error.flatten(),
            requestId: req.id,
          },
        });
      }

      const data = parseResult.data;
      const user = req.user!;

      // Validate startsAt < endsAt
      const startsAt = new Date(data.startsAt);
      const endsAt = new Date(data.endsAt);
      if (endsAt <= startsAt) {
        return reply.code(400).send({
          error: {
            code: 'INVALID_EVENT_WINDOW',
            message: 'Event end time must be strictly after start time.',
            details: { startsAt: data.startsAt, endsAt: data.endsAt },
            requestId: req.id,
          },
        });
      }

      // Verify user has membership in the organizer profile (unless admin)
      if (user.globalRole !== 'admin') {
        const membership = await db.query.organizerMembers.findFirst({
          where: and(
            eq(organizerMembers.organizerId, data.organizerId),
            eq(organizerMembers.userId, user.id),
            eq(organizerMembers.status, 'active')
          ),
        });

        if (!membership) {
          return reply.code(403).send({
            error: {
              code: 'FORBIDDEN',
              message: 'You are not an active member of this organizer profile.',
              details: { organizerId: data.organizerId },
              requestId: req.id,
            },
          });
        }
      }

      const slug = slugify(data.title);

      const [newEvent] = await db
        .insert(events)
        .values({
          organizerId: data.organizerId,
          collegeId: user.collegeId,
          title: data.title,
          slug,
          description: data.description,
          category: data.category,
          tags: data.tags,
          department: data.department || null,
          format: data.format,
          venueId: data.venueId || null,
          startsAt,
          endsAt,
          registrationOpensAt: data.registrationOpensAt ? new Date(data.registrationOpensAt) : null,
          registrationClosesAt: data.registrationClosesAt ? new Date(data.registrationClosesAt) : null,
          capacity: data.capacity,
          eligibility: data.eligibility,
          visibility: data.visibility,
          status: 'draft',
          teamMode: data.teamMode,
          teamMin: data.teamMin || null,
          teamMax: data.teamMax || null,
          contactEmail: data.contactEmail,
          version: 1,
          createdBy: user.id,
        })
        .returning();

      // Write initial status history
      await db.insert(eventStatusHistory).values({
        eventId: newEvent.id,
        fromStatus: 'draft',
        toStatus: 'draft',
        actorId: user.id,
        note: 'Initial event proposal drafted',
      });

      await logAuditEvent({
        actorId: user.id,
        action: 'event.draft_created',
        resourceType: 'event',
        resourceId: newEvent.id,
        collegeId: user.collegeId,
        ip: req.ip,
      });

      return reply.code(201).send({
        event: newEvent,
        message: 'Event draft created successfully',
      });
    }
  );

  // 4. PATCH /api/v1/events/:id (Optimistic locking via If-Match: version)
  fastify.patch(
    '/:id',
    {
      config: {
        auth: true,
        policy: 'event:manage:owned',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };

      const parseResult = updateEventSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid event update data',
            details: parseResult.error.flatten(),
            requestId: req.id,
          },
        });
      }

      const currentEvent = await db.query.events.findFirst({
        where: eq(events.id, id),
      });

      if (!currentEvent) {
        return reply.code(404).send({
          error: {
            code: 'EVENT_NOT_FOUND',
            message: `Event ${id} not found`,
            details: {},
            requestId: req.id,
          },
        });
      }

      // Optimistic concurrency control: check If-Match header or version property
      const ifMatchHeader = req.headers['if-match'];
      const expectedVersion = ifMatchHeader ? parseInt(ifMatchHeader, 10) : parseResult.data.version;

      if (expectedVersion !== undefined && currentEvent.version !== expectedVersion) {
        return reply.code(409).send({
          error: {
            code: 'VERSION_CONFLICT',
            message: `Event has been modified concurrently. Current version is ${currentEvent.version}, expected ${expectedVersion}.`,
            details: { currentVersion: currentEvent.version, expectedVersion },
            requestId: req.id,
          },
        });
      }

      const updates: any = { ...parseResult.data };
      delete updates.version;

      if (updates.startsAt) updates.startsAt = new Date(updates.startsAt);
      if (updates.endsAt) updates.endsAt = new Date(updates.endsAt);
      if (updates.registrationOpensAt) updates.registrationOpensAt = new Date(updates.registrationOpensAt);
      if (updates.registrationClosesAt) updates.registrationClosesAt = new Date(updates.registrationClosesAt);

      updates.version = currentEvent.version + 1;
      updates.updatedAt = new Date();

      const [updated] = await db
        .update(events)
        .set(updates)
        .where(and(eq(events.id, id), eq(events.version, currentEvent.version)))
        .returning();

      if (!updated) {
        return reply.code(409).send({
          error: {
            code: 'VERSION_CONFLICT',
            message: 'Event was modified concurrently during update execution.',
            details: {},
            requestId: req.id,
          },
        });
      }

      // Material edit on PUBLISHED event: write history & queue outbox notice
      if (currentEvent.status === 'published') {
        const isMaterial =
          updates.venueId !== undefined ||
          updates.startsAt !== undefined ||
          updates.endsAt !== undefined;

        if (isMaterial) {
          await db.insert(outbox).values({
            eventType: 'event.changed',
            payload: {
              eventId: id,
              version: updated.version,
              updatedAt: updated.updatedAt,
              materialChanges: updates,
            },
            status: 'pending',
            dedupeKey: `event_changed_${id}_${updated.version}`,
          });
        }
      }

      return reply.code(200).send({
        event: updated,
        message: 'Event successfully updated.',
      });
    }
  );

  // 5. POST /api/v1/events/:id/submit (Organizer submits proposal for review)
  fastify.post(
    '/:id/submit',
    {
      config: {
        auth: true,
        policy: 'event:manage:owned',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };

      const event = await db.query.events.findFirst({
        where: eq(events.id, id),
      });

      if (!event) {
        return reply.code(404).send({
          error: { code: 'EVENT_NOT_FOUND', message: 'Event not found', details: {}, requestId: req.id },
        });
      }

      // If venueId is assigned, hold venue window
      if (event.venueId) {
        try {
          await bookVenueWindow(event.id, event.venueId, event.startsAt, event.endsAt, 'hold');
        } catch (err: any) {
          if (err instanceof VenueConflictError) {
            return reply.code(409).send({
              error: {
                code: 'VENUE_CONFLICT',
                message: err.message,
                details: {
                  venueId: err.venueId,
                  startsAt: err.startsAt,
                  endsAt: err.endsAt,
                },
                requestId: req.id,
              },
            });
          }
          throw err;
        }
      }

      try {
        const updated = await transitionEventStatus(
          event.id,
          event.status,
          'pending_approval',
          {
            actorId: req.user!.id,
            actorRole: req.user!.globalRole,
            note: 'Proposal submitted for faculty review',
          }
        );

        return reply.code(200).send({
          event: updated,
          message: 'Event proposal submitted for faculty review',
        });
      } catch (err: any) {
        if (err instanceof InvalidTransitionError) {
          return reply.code(409).send({
            error: {
              code: 'INVALID_TRANSITION',
              message: err.message,
              details: { fromStatus: err.fromStatus, toStatus: err.toStatus },
              requestId: req.id,
            },
          });
        }
        throw err;
      }
    }
  );

  // 6. POST /api/v1/events/:id/approval (Faculty Reviewer decision)
  fastify.post(
    '/:id/approval',
    {
      config: {
        auth: true,
        policy: 'event:review',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };

      const parseResult = approvalSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid approval payload',
            details: parseResult.error.flatten(),
            requestId: req.id,
          },
        });
      }

      const event = await db.query.events.findFirst({
        where: eq(events.id, id),
      });

      if (!event) {
        return reply.code(404).send({
          error: { code: 'EVENT_NOT_FOUND', message: 'Event not found', details: {}, requestId: req.id },
        });
      }

      const { decision, comments } = parseResult.data;

      // Enforce Reviewer ≠ Creator & Reviewer not in organizer rule
      try {
        await assertReviewerEligibility(req.user!.id, event);
      } catch (err: any) {
        if (err instanceof ReviewerConflictError) {
          await logAuditEvent({
            actorId: req.user!.id,
            action: 'reviewer_conflict_rejected',
            resourceType: 'event',
            resourceId: event.id,
            collegeId: event.collegeId,
            meta: { error: err.message },
            ip: req.ip,
          });

          return reply.code(403).send({
            error: {
              code: 'REVIEWER_CONFLICT',
              message: err.message,
              details: { reviewerId: req.user!.id, creatorId: event.createdBy },
              requestId: req.id,
            },
          });
        }
        throw err;
      }

      // Map decision to target event status
      let targetStatus: EventStatus;
      if (decision === 'approved') targetStatus = 'approved';
      else if (decision === 'changes_requested') targetStatus = 'changes_requested';
      else targetStatus = 'rejected';

      try {
        const updated = await transitionEventStatus(
          event.id,
          event.status,
          targetStatus,
          {
            actorId: req.user!.id,
            actorRole: req.user!.globalRole,
            reviewerComments: comments,
          }
        );

        // Record approval review decision
        await db.insert(eventApprovals).values({
          eventId: event.id,
          reviewerId: req.user!.id,
          decision,
          comments,
        });

        return reply.code(200).send({
          event: updated,
          approval: {
            decision,
            comments,
            reviewerId: req.user!.id,
          },
          message: `Event proposal successfully marked as ${decision}.`,
        });
      } catch (err: any) {
        if (err instanceof InvalidTransitionError) {
          return reply.code(409).send({
            error: {
              code: 'INVALID_TRANSITION',
              message: err.message,
              details: { fromStatus: err.fromStatus, toStatus: err.toStatus },
              requestId: req.id,
            },
          });
        }
        throw err;
      }
    }
  );

  // 7. POST /api/v1/events/:id/publish (Organizer publishes approved event)
  fastify.post(
    '/:id/publish',
    {
      config: {
        auth: true,
        policy: 'event:manage:owned',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };

      const event = await db.query.events.findFirst({
        where: eq(events.id, id),
      });

      if (!event) {
        return reply.code(404).send({
          error: { code: 'EVENT_NOT_FOUND', message: 'Event not found', details: {}, requestId: req.id },
        });
      }

      try {
        const updated = await transitionEventStatus(
          event.id,
          event.status,
          'published',
          {
            actorId: req.user!.id,
            actorRole: req.user!.globalRole,
            note: 'Event published to campus catalogue',
          }
        );

        return reply.code(200).send({
          event: updated,
          message: 'Event is now published and publicly discoverable.',
        });
      } catch (err: any) {
        if (err instanceof InvalidTransitionError) {
          return reply.code(409).send({
            error: {
              code: 'INVALID_TRANSITION',
              message: err.message,
              details: { fromStatus: err.fromStatus, toStatus: err.toStatus },
              requestId: req.id,
            },
          });
        }
        throw err;
      }
    }
  );

  // 8. POST /api/v1/events/:id/postpone
  fastify.post(
    '/:id/postpone',
    {
      config: {
        auth: true,
        policy: 'event:manage:owned',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = statusActionSchema.parse(req.body || {});

      const event = await db.query.events.findFirst({
        where: eq(events.id, id),
      });

      if (!event) {
        return reply.code(404).send({
          error: { code: 'EVENT_NOT_FOUND', message: 'Event not found', details: {}, requestId: req.id },
        });
      }

      try {
        const updated = await transitionEventStatus(
          event.id,
          event.status,
          'postponed',
          {
            actorId: req.user!.id,
            actorRole: req.user!.globalRole,
            note: body.note || 'Event postponed by organizer',
          }
        );

        return reply.code(200).send({
          event: updated,
          message: 'Event has been postponed.',
        });
      } catch (err: any) {
        if (err instanceof InvalidTransitionError) {
          return reply.code(409).send({
            error: {
              code: 'INVALID_TRANSITION',
              message: err.message,
              details: { fromStatus: err.fromStatus, toStatus: err.toStatus },
              requestId: req.id,
            },
          });
        }
        throw err;
      }
    }
  );

  // 9. POST /api/v1/events/:id/cancel
  fastify.post(
    '/:id/cancel',
    {
      config: {
        auth: true,
        policy: 'event:manage:owned',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = statusActionSchema.parse(req.body || {});

      const event = await db.query.events.findFirst({
        where: eq(events.id, id),
      });

      if (!event) {
        return reply.code(404).send({
          error: { code: 'EVENT_NOT_FOUND', message: 'Event not found', details: {}, requestId: req.id },
        });
      }

      try {
        const updated = await transitionEventStatus(
          event.id,
          event.status,
          'cancelled',
          {
            actorId: req.user!.id,
            actorRole: req.user!.globalRole,
            note: body.note || 'Event cancelled by organizer',
          }
        );

        return reply.code(200).send({
          event: updated,
          message: 'Event has been cancelled and associated bookings released.',
        });
      } catch (err: any) {
        if (err instanceof InvalidTransitionError) {
          return reply.code(409).send({
            error: {
              code: 'INVALID_TRANSITION',
              message: err.message,
              details: { fromStatus: err.fromStatus, toStatus: err.toStatus },
              requestId: req.id,
            },
          });
        }
        throw err;
      }
    }
  );

  // 10. GET /api/v1/events/:id/ics (RFC 5545 iCalendar download)
  fastify.get(
    '/:id/ics',
    {
      config: {
        auth: false,
        policy: 'public',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };

      const event = await db.query.events.findFirst({
        where: eq(events.id, id),
        with: {
          venue: true,
        },
      });

      if (!event) {
        return reply.code(404).send({
          error: { code: 'EVENT_NOT_FOUND', message: 'Event not found', details: {}, requestId: req.id },
        });
      }

      const icsData = generateIcsCalendar(event, event.venue);

      reply
        .header('Content-Type', 'text/calendar; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${event.slug}.ics"`)
        .send(icsData);
    }
  );

  // 11. FAQ CRUD
  fastify.get(
    '/:id/faqs',
    {
      config: {
        auth: false,
        policy: 'public',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const items = await db
        .select()
        .from(eventFaqs)
        .where(eq(eventFaqs.eventId, id))
        .orderBy(asc(eventFaqs.displayOrder));

      return reply.code(200).send({ faqs: items });
    }
  );

  fastify.post(
    '/:id/faqs',
    {
      config: {
        auth: true,
        policy: 'event:manage:owned',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parseResult = createFaqSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid FAQ data',
            details: parseResult.error.flatten(),
            requestId: req.id,
          },
        });
      }

      const [newFaq] = await db
        .insert(eventFaqs)
        .values({
          eventId: id,
          question: parseResult.data.question,
          answer: parseResult.data.answer,
          displayOrder: parseResult.data.displayOrder,
        })
        .returning();

      return reply.code(201).send({ faq: newFaq });
    }
  );

  // 12. Announcements CRUD
  fastify.get(
    '/:id/announcements',
    {
      config: {
        auth: false,
        policy: 'public',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const items = await db
        .select()
        .from(eventAnnouncements)
        .where(eq(eventAnnouncements.eventId, id))
        .orderBy(desc(eventAnnouncements.createdAt));

      return reply.code(200).send({ announcements: items });
    }
  );

  fastify.post(
    '/:id/announcements',
    {
      config: {
        auth: true,
        policy: 'event:manage:owned',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parseResult = createAnnouncementSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid announcement data',
            details: parseResult.error.flatten(),
            requestId: req.id,
          },
        });
      }

      const [newAnnouncement] = await db
        .insert(eventAnnouncements)
        .values({
          eventId: id,
          body: parseResult.data.body,
          createdBy: req.user!.id,
        })
        .returning();

      return reply.code(201).send({ announcement: newAnnouncement });
    }
  );
};
