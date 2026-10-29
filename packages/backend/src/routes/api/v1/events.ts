import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { db, pool } from '../../../db/index.js';
import {
  events,
  venues,
  organizerProfiles,
  organizerMembers,
  eventApprovals,
  eventStatusHistory,
  eventFaqs,
  eventAnnouncements,
  ticketTypes,
  tickets,
  bookings,
  eventMaterials,
  outbox,
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
import { generateUniqueSlug } from '../../../services/slug.js';
import {
  getEventForm,
  saveEventForm,
  getEventFormSubmissions,
  FormBuilderError,
} from '../../../services/form-builder.js';
import { ALLOWED_CURRENCIES } from '@eventora/shared';

const listEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
  category: z.string().optional(),
  department: z.string().optional(),
  format: z.enum(['in_person', 'online', 'hybrid']).optional(),
  date_from: z.string().refine((val) => !isNaN(Date.parse(val)), { message: 'Invalid date_from format' }).optional(),
  date_to: z.string().refine((val) => !isNaN(Date.parse(val)), { message: 'Invalid date_to format' }).optional(),
  search: z.string().optional(),
  availability: z.enum(['available', 'all']).optional(),
  sort: z.enum(['date_asc', 'date_desc', 'popularity']).default('date_asc'),
  status: z.enum(['draft', 'pending_approval', 'approved', 'published', 'postponed', 'cancelled', 'completed']).optional(),
  pricing_type: z.enum(['free', 'paid', 'all']).optional(),
  organizer_id: z.string().uuid().optional(),
});

const ticketTierInputSchema = z.object({
  name: z.string().min(1, 'Tier name is required').max(100),
  pricePaise: z.number().int().min(0, 'Price must be non-negative'),
  capacity: z.number().int().min(1, 'Capacity must be at least 1'),
  perUserLimit: z.number().int().min(1).max(50).default(5),
});

const baseCreateEventSchema = z.object({
  organizerId: z.string().uuid().optional(),
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
  capacity: z.number().int().min(1, 'Capacity must be at least 1'),
  pricingType: z.enum(['free', 'paid']).default('free'),
  currency: z.string().default('INR'),
  ticketTiers: z.array(ticketTierInputSchema).optional(),
  eligibility: z.record(z.any()).default({}),
  visibility: z.enum(['college', 'public']).default('college'),
  teamMode: z.enum(['none', 'optional', 'required']).default('none'),
  teamMin: z.number().int().min(1).optional().nullable(),
  teamMax: z.number().int().min(1).optional().nullable(),
  contactEmail: z.string().email(),
});

const createEventSchema = baseCreateEventSchema.superRefine((data, ctx) => {
  // 1. Currency allow-list
  if (!ALLOWED_CURRENCIES.includes(data.currency as any)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['currency'],
      message: `Currency '${data.currency}' is not supported. Allowed currencies: ${ALLOWED_CURRENCIES.join(', ')}.`,
    });
  }

  // 2. Paid events validation: paid => >= 1 tier, price>0, sum(tier.capacity) <= event.capacity
  if (data.pricingType === 'paid') {
    const tiers = data.ticketTiers || [];
    if (tiers.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ticketTiers'],
        message: 'Paid events must have at least one ticket tier.',
      });
    }

    for (let i = 0; i < tiers.length; i++) {
      if (tiers[i].pricePaise <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['ticketTiers', i, 'pricePaise'],
          message: 'Paid ticket tiers must have price greater than 0 paise.',
        });
      }
    }

    const totalTierCapacity = tiers.reduce((sum, t) => sum + t.capacity, 0);
    if (totalTierCapacity > data.capacity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ticketTiers'],
        message: `Sum of tier capacities (${totalTierCapacity}) cannot exceed overall event capacity (${data.capacity}).`,
      });
    }
  }

  // 3. Free events validation: free => price_paise = 0
  if (data.pricingType === 'free') {
    const tiers = data.ticketTiers || [];
    for (let i = 0; i < tiers.length; i++) {
      if (tiers[i].pricePaise !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['ticketTiers', i, 'pricePaise'],
          message: 'Free event ticket tiers must have price_paise = 0.',
        });
      }
    }

    const totalTierCapacity = tiers.reduce((sum, t) => sum + t.capacity, 0);
    if (totalTierCapacity > data.capacity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ticketTiers'],
        message: `Sum of tier capacities (${totalTierCapacity}) cannot exceed overall event capacity (${data.capacity}).`,
      });
    }
  }
});

const updateEventSchema = baseCreateEventSchema
  .omit({ organizerId: true })
  .partial()
  .extend({
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

      // Build query conditions
      const conditions: any[] = [];

      // Status authorization guard:
      // Anonymous -> published only
      // Admin / Reviewer -> any status
      // Others -> only their organizers' events
      let allowedStatuses: EventStatus[] = ['published'];

      if (!user) {
        allowedStatuses = ['published'];
      } else if (isAdmin || isReviewer) {
        allowedStatuses = q.status ? [q.status as EventStatus] : ['published'];
      } else {
        // Authenticated student / organizer member
        if (q.status && q.status !== 'published') {
          const memberships = await db.query.organizerMembers.findMany({
            where: and(
              eq(organizerMembers.userId, user.id),
              eq(organizerMembers.status, 'active')
            ),
          });
          const userOrgIds = memberships.map((m) => m.organizerId);

          if (userOrgIds.length === 0) {
            allowedStatuses = ['published'];
          } else if (q.organizer_id && !userOrgIds.includes(q.organizer_id)) {
            return reply.code(403).send({
              error: {
                code: 'FORBIDDEN',
                message: 'You are not an active member of the specified organizer',
                details: { organizerId: q.organizer_id },
                requestId: req.id,
              },
            });
          } else {
            allowedStatuses = [q.status as EventStatus];
            if (!q.organizer_id) {
              conditions.push(sql`${events.organizerId} IN ${userOrgIds}`);
            }
          }
        } else {
          allowedStatuses = ['published'];
        }
      }

      // Status filter
      if (allowedStatuses.length === 1) {
        conditions.push(eq(events.status, allowedStatuses[0]));
      } else {
        conditions.push(sql`${events.status} IN ${allowedStatuses}`);
      }

      // Scope visibility='college' events by college_id
      if (isAdmin) {
        // Platform admin can inspect events across all colleges
      } else if (user?.collegeId) {
        conditions.push(
          or(
            eq(events.visibility, 'public'),
            and(eq(events.visibility, 'college'), eq(events.collegeId, user.collegeId))
          )
        );
      } else {
        // Anonymous users or users without college context: public events only
        conditions.push(eq(events.visibility, 'public'));
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

      // Pricing type filter (free vs paid)
      if (q.pricing_type && q.pricing_type !== 'all') {
        conditions.push(eq(events.pricingType, q.pricing_type));
      }

      // Full-text search using PostgreSQL TSVECTOR
      if (q.search) {
        conditions.push(
          sql`events.search @@ plainto_tsquery('english', ${q.search})`
        );
      }

      // Cursor pagination: cursor is a (startsAt, id) tuple honoring sort direction
      let cursorStartsAt: Date | null = null;
      let cursorId: string | null = null;

      if (q.cursor) {
        try {
          const decoded = JSON.parse(Buffer.from(q.cursor, 'base64url').toString('utf8'));
          if (Array.isArray(decoded) && decoded.length === 2) {
            cursorStartsAt = new Date(decoded[0]);
            cursorId = String(decoded[1]);
          } else {
            cursorStartsAt = new Date(q.cursor);
          }
        } catch {
          const d = new Date(q.cursor);
          if (!isNaN(d.getTime())) {
            cursorStartsAt = d;
          }
        }
      }

      if (cursorStartsAt) {
        if (q.sort === 'date_desc') {
          if (cursorId) {
            conditions.push(
              or(
                lte(events.startsAt, cursorStartsAt),
                and(eq(events.startsAt, cursorStartsAt), lte(events.id, cursorId))
              )
            );
          } else {
            conditions.push(lte(events.startsAt, cursorStartsAt));
          }
        } else {
          // date_asc (default)
          if (cursorId) {
            conditions.push(
              or(
                gte(events.startsAt, cursorStartsAt),
                and(eq(events.startsAt, cursorStartsAt), gte(events.id, cursorId))
              )
            );
          } else {
            conditions.push(gte(events.startsAt, cursorStartsAt));
          }
        }
      }

      // Order by
      const orderBy = q.sort === 'date_desc'
        ? [desc(events.startsAt), desc(events.id)]
        : [asc(events.startsAt), asc(events.id)];

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
          pricingType: events.pricingType,
          currency: events.currency,
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
        .orderBy(...orderBy)
        .limit(q.limit + 1);

      let nextCursor: string | null = null;
      if (items.length > q.limit) {
        const nextItem = items.pop()!;
        nextCursor = Buffer.from(JSON.stringify([nextItem.startsAt.toISOString(), nextItem.id])).toString('base64url');
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
          ticketTypes: {
            orderBy: (t, { asc }) => [asc(t.pricePaise), asc(t.name)],
          },
          faqs: {
            orderBy: (f, { asc }) => [asc(f.displayOrder)],
          },
          announcements: {
            orderBy: (a, { desc }) => [desc(a.createdAt)],
          },
          formFields: {
            orderBy: (f, { asc }) => [asc(f.position)],
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

      // Cross-field validation: registration window & team sizes
      if (data.registrationOpensAt && data.registrationClosesAt) {
        const opens = new Date(data.registrationOpensAt);
        const closes = new Date(data.registrationClosesAt);
        if (closes <= opens || closes > endsAt) {
          return reply.code(400).send({
            error: {
              code: 'INVALID_REGISTRATION_WINDOW',
              message: 'Registration closing time must be strictly after opening time and before event end time.',
              details: { opensAt: data.registrationOpensAt, closesAt: data.registrationClosesAt },
              requestId: req.id,
            },
          });
        }
      }

      if (data.teamMin && data.teamMax && data.teamMin > data.teamMax) {
        return reply.code(400).send({
          error: {
            code: 'INVALID_TEAM_CONSTRAINTS',
            message: 'Minimum team size cannot exceed maximum team size.',
            details: { teamMin: data.teamMin, teamMax: data.teamMax },
            requestId: req.id,
          },
        });
      }

      // Auto-resolve organizerId from user's active membership if omitted
      let resolvedOrganizerId = data.organizerId;
      if (!resolvedOrganizerId) {
        const firstMembership = await db.query.organizerMembers.findFirst({
          where: and(
            eq(organizerMembers.userId, user.id),
            eq(organizerMembers.status, 'active')
          ),
        });
        if (firstMembership) {
          resolvedOrganizerId = firstMembership.organizerId;
        } else if (user.globalRole === 'admin') {
          const firstOrg = await db.query.organizerProfiles.findFirst({
            where: eq(organizerProfiles.collegeId, user.collegeId),
          });
          resolvedOrganizerId = firstOrg?.id;
        }
      }

      if (!resolvedOrganizerId) {
        return reply.code(400).send({
          error: {
            code: 'ORGANIZER_REQUIRED',
            message: 'An active organizer profile is required to propose an event.',
            details: {},
            requestId: req.id,
          },
        });
      }

      // Verify user has membership in the organizer profile (unless admin)
      if (user.globalRole !== 'admin') {
        const membership = await db.query.organizerMembers.findFirst({
          where: and(
            eq(organizerMembers.organizerId, resolvedOrganizerId),
            eq(organizerMembers.userId, user.id),
            eq(organizerMembers.status, 'active')
          ),
        });

        if (!membership) {
          return reply.code(403).send({
            error: {
              code: 'FORBIDDEN',
              message: 'You are not an active member of this organizer profile.',
              details: { organizerId: resolvedOrganizerId },
              requestId: req.id,
            },
          });
        }
      }

      // Idempotency: return existing draft if duplicate submission occurs within 15 minutes
      const idempotencyKey = (req.headers['idempotency-key'] as string) || (req.body as any)?.idempotencyKey;
      if (idempotencyKey) {
        const existingEvent = await db.query.events.findFirst({
          where: and(
            eq(events.createdBy, user.id),
            eq(events.organizerId, resolvedOrganizerId),
            eq(events.title, data.title),
            eq(events.status, 'draft')
          ),
        });
        if (existingEvent) {
          return reply.code(200).send({
            event: existingEvent,
            message: 'Event draft already created (idempotent)',
          });
        }
      }

      const slug = await generateUniqueSlug(data.title, pool);

      const [newEvent] = await db
        .insert(events)
        .values({
          organizerId: resolvedOrganizerId,
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
          pricingType: data.pricingType,
          currency: data.currency,
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

      // Create ticket tiers
      if (data.ticketTiers && data.ticketTiers.length > 0) {
        for (const tier of data.ticketTiers) {
          await db.insert(ticketTypes).values({
            eventId: newEvent.id,
            name: tier.name,
            pricePaise: tier.pricePaise,
            capacity: tier.capacity,
            sold: 0,
            held: 0,
            perUserLimit: tier.perUserLimit || 5,
          });
        }
      } else if (data.pricingType === 'free' && newEvent.capacity > 0) {
        // Automatically create initial General Admission ticket tier if capacity defined and free
        await db.insert(ticketTypes).values({
          eventId: newEvent.id,
          name: 'General Admission',
          pricePaise: 0,
          capacity: newEvent.capacity,
          sold: 0,
          held: 0,
          perUserLimit: 2,
        });
      }

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

      // 1. Refuse modifications to completed or cancelled events
      if (currentEvent.status === 'cancelled' || currentEvent.status === 'completed') {
        return reply.code(400).send({
          error: {
            code: 'EVENT_CANNOT_BE_MODIFIED',
            message: `Event in '${currentEvent.status}' status cannot be modified.`,
            details: { status: currentEvent.status },
            requestId: req.id,
          },
        });
      }

      // 2. Restrict material edits while event is pending approval
      const isMaterial =
        parseResult.data.venueId !== undefined ||
        parseResult.data.startsAt !== undefined ||
        parseResult.data.endsAt !== undefined ||
        parseResult.data.capacity !== undefined;

      if (currentEvent.status === 'pending_approval' && isMaterial) {
        return reply.code(400).send({
          error: {
            code: 'MATERIAL_EDIT_RESTRICTED',
            message: 'Material event parameters (venue, dates, capacity) cannot be modified while pending reviewer approval.',
            details: { status: currentEvent.status },
            requestId: req.id,
          },
        });
      }

      // 3. Refuse capacity reduction below already sold + held tickets
      if (parseResult.data.capacity !== undefined) {
        if (parseResult.data.capacity < 1) {
          return reply.code(400).send({
            error: {
              code: 'INVALID_CAPACITY',
              message: 'Event capacity must be at least 1.',
              details: { requestedCapacity: parseResult.data.capacity },
              requestId: req.id,
            },
          });
        }

        const ttRows = await db
          .select({
            totalSold: sql<number>`coalesce(sum(${ticketTypes.sold}), 0)`,
            totalHeld: sql<number>`coalesce(sum(${ticketTypes.held}), 0)`,
          })
          .from(ticketTypes)
          .where(eq(ticketTypes.eventId, id));

        const allocated = Number(ttRows[0]?.totalSold || 0) + Number(ttRows[0]?.totalHeld || 0);
        if (parseResult.data.capacity < allocated) {
          return reply.code(400).send({
            error: {
              code: 'CAPACITY_BELOW_ALLOCATED',
              message: `Event capacity cannot be reduced below already allocated tickets (${allocated}).`,
              details: { requestedCapacity: parseResult.data.capacity, allocated },
              requestId: req.id,
            },
          });
        }
      }

      // 4. Cross-field validation: startsAt < endsAt, opens < closes <= ends, teamMin <= teamMax
      const effectiveStartsAt = parseResult.data.startsAt ? new Date(parseResult.data.startsAt) : new Date(currentEvent.startsAt);
      const effectiveEndsAt = parseResult.data.endsAt ? new Date(parseResult.data.endsAt) : new Date(currentEvent.endsAt);

      if (effectiveEndsAt <= effectiveStartsAt) {
        return reply.code(400).send({
          error: {
            code: 'INVALID_EVENT_WINDOW',
            message: 'Event end time must be strictly after start time.',
            details: { startsAt: effectiveStartsAt, endsAt: effectiveEndsAt },
            requestId: req.id,
          },
        });
      }

      const effectiveOpensAt = parseResult.data.registrationOpensAt !== undefined
        ? (parseResult.data.registrationOpensAt ? new Date(parseResult.data.registrationOpensAt) : null)
        : (currentEvent.registrationOpensAt ? new Date(currentEvent.registrationOpensAt) : null);
      const effectiveClosesAt = parseResult.data.registrationClosesAt !== undefined
        ? (parseResult.data.registrationClosesAt ? new Date(parseResult.data.registrationClosesAt) : null)
        : (currentEvent.registrationClosesAt ? new Date(currentEvent.registrationClosesAt) : null);

      if (effectiveOpensAt && effectiveClosesAt) {
        if (effectiveClosesAt <= effectiveOpensAt) {
          return reply.code(400).send({
            error: {
              code: 'INVALID_REGISTRATION_WINDOW',
              message: 'Registration closing time must be strictly after opening time.',
              details: { opensAt: effectiveOpensAt, closesAt: effectiveClosesAt },
              requestId: req.id,
            },
          });
        }
        if (effectiveClosesAt > effectiveEndsAt) {
          return reply.code(400).send({
            error: {
              code: 'INVALID_REGISTRATION_WINDOW',
              message: 'Registration closing time cannot be after event end time.',
              details: { closesAt: effectiveClosesAt, endsAt: effectiveEndsAt },
              requestId: req.id,
            },
          });
        }
      }

      const effectiveTeamMin = parseResult.data.teamMin !== undefined ? parseResult.data.teamMin : currentEvent.teamMin;
      const effectiveTeamMax = parseResult.data.teamMax !== undefined ? parseResult.data.teamMax : currentEvent.teamMax;

      if (effectiveTeamMin !== null && effectiveTeamMin !== undefined &&
          effectiveTeamMax !== null && effectiveTeamMax !== undefined) {
        if (effectiveTeamMin > effectiveTeamMax) {
          return reply.code(400).send({
            error: {
              code: 'INVALID_TEAM_CONSTRAINTS',
              message: 'Minimum team size cannot exceed maximum team size.',
              details: { teamMin: effectiveTeamMin, teamMax: effectiveTeamMax },
              requestId: req.id,
            },
          });
        }
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
      // Prevent transferring ownership or modifying tenant/creator metadata
      delete updates.organizerId;
      delete updates.collegeId;
      delete updates.createdBy;
      delete updates.id;

      // Update ticket tiers on draft events
      if (currentEvent.status === 'draft' && parseResult.data.ticketTiers !== undefined) {
        await db.delete(ticketTypes).where(eq(ticketTypes.eventId, id));
        for (const tier of parseResult.data.ticketTiers) {
          await db.insert(ticketTypes).values({
            eventId: id,
            name: tier.name,
            pricePaise: tier.pricePaise,
            capacity: tier.capacity,
            sold: 0,
            held: 0,
            perUserLimit: tier.perUserLimit || 5,
          });
        }
      }
      delete updates.ticketTiers;

      if (currentEvent.status === 'draft' && updates.title && updates.title !== currentEvent.title) {
        updates.slug = await generateUniqueSlug(updates.title, pool);
      }

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

      // Material edit on PUBLISHED event: write history & queue outbox notice to all ticket holders
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

          // Query distinct active ticket holders and queue notification.event_rescheduled
          const activeHolders = await db
            .selectDistinct({ userId: tickets.userId })
            .from(tickets)
            .where(and(eq(tickets.eventId, id), sql`${tickets.status} != 'REVOKED'`, sql`${tickets.userId} IS NOT NULL`));

          for (const holder of activeHolders) {
            if (holder.userId) {
              await db.insert(outbox).values({
                eventType: 'notification.event_rescheduled',
                payload: {
                  eventId: id,
                  eventTitle: updated.title,
                  userId: holder.userId,
                  startsAt: updated.startsAt,
                  endsAt: updated.endsAt,
                  venueId: updated.venueId,
                  updatedAt: updated.updatedAt,
                },
                status: 'pending',
                dedupeKey: `notif_rescheduled_${id}_${holder.userId}_${updated.version}`,
              });
            }
          }
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

        const summary = updated.cascadeSummary || {
          cancelledBookingsCount: 0,
          ticketsRevokedCount: 0,
          refundsQueuedCount: 0,
          waitlistClosedCount: 0,
          outboxQueuedCount: 0,
          releasedVenueBookingsCount: 0,
        };

        const message = `Event has been cancelled. Released ${summary.cancelledBookingsCount} bookings, revoked ${summary.ticketsRevokedCount} tickets, queued ${summary.refundsQueuedCount} refunds, and closed ${summary.waitlistClosedCount} waitlist entries.`;

        return reply.code(200).send({
          event: updated,
          summary,
          cancelledBookingsCount: summary.cancelledBookingsCount,
          ticketsRevokedCount: summary.ticketsRevokedCount,
          refundsQueuedCount: summary.refundsQueuedCount,
          waitlistClosedCount: summary.waitlistClosedCount,
          outboxQueuedCount: summary.outboxQueuedCount,
          message,
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

      // Public GET visibility guard: reject drafts for unauthorized callers
      if (event.status !== 'published') {
        const user = req.user;
        const isAdmin = user?.globalRole === 'admin';
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

        if (!isAdmin && !isCreator && !isOrganizerMember) {
          return reply.code(404).send({
            error: {
              code: 'EVENT_NOT_FOUND',
              message: 'Event not found or not publicly available',
              details: {},
              requestId: req.id,
            },
          });
        }
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

  // 12. Registration Form Builder: GET /api/v1/events/:id/form
  fastify.get(
    '/:id/form',
    {
      config: {
        auth: true,
        policy: 'event:manage:owned',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const formData = await getEventForm(id);
      return reply.code(200).send({ form: formData });
    }
  );

  // 13. Registration Form Builder: PUT /api/v1/events/:id/form (Optimistic locking & Frozen fields)
  const formFieldItemSchema = z.object({
    id: z.string().uuid().optional(),
    position: z.number().int().min(0).default(0),
    type: z.enum([
      'short_text',
      'long_text',
      'dropdown',
      'radio',
      'checkbox',
      'multi_checkbox',
      'phone',
      'email',
      'number',
      'date',
      'dietary',
    ]),
    label: z.string().min(1, 'Field label is required').max(255),
    helpText: z.string().max(1000).nullable().optional(),
    required: z.boolean().default(false),
    options: z.array(z.string().max(255)).default([]),
    validation: z.record(z.any()).default({}),
  });

  const updateEventFormSchema = z.object({
    version: z.number().int().optional(),
    expectedVersion: z.number().int().optional(),
    fields: z.array(formFieldItemSchema),
  });

  fastify.put(
    '/:id/form',
    {
      config: {
        auth: true,
        policy: 'event:manage:owned',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parseResult = updateEventFormSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid form builder payload',
            details: parseResult.error.flatten(),
            requestId: req.id,
          },
        });
      }

      const ifMatchHeader = req.headers['if-match'];
      const expectedVersion = ifMatchHeader
        ? parseInt(ifMatchHeader, 10)
        : parseResult.data.expectedVersion !== undefined
        ? parseResult.data.expectedVersion
        : parseResult.data.version;

      try {
        const updatedForm = await saveEventForm(id, parseResult.data.fields, expectedVersion);
        return reply.code(200).send({ form: updatedForm });
      } catch (err: any) {
        if (err instanceof FormBuilderError) {
          return reply.code(err.statusCode).send({
            error: {
              code: err.code,
              message: err.message,
              details: err.details,
              requestId: req.id,
            },
          });
        }
        throw err;
      }
    }
  );

  // 14. Form Submissions: GET /api/v1/events/:id/form/submissions (Visible to Organizer Only)
  fastify.get(
    '/:id/form/submissions',
    {
      config: {
        auth: true,
        policy: 'event:manage:owned',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const submissions = await getEventFormSubmissions(id);
      return reply.code(200).send(submissions);
    }
  );

  // 15. Event Materials: GET /api/v1/events/:id/materials (Registered-only attendee visibility or Organizer/Admin)
  fastify.get(
    '/:id/materials',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const user = req.user!;

      const targetEvent = await db.query.events.findFirst({
        where: eq(events.id, id),
      });

      if (!targetEvent) {
        return reply.code(404).send({
          error: {
            code: 'EVENT_NOT_FOUND',
            message: `Event ${id} not found`,
            details: { eventId: id },
            requestId: req.id,
          },
        });
      }

      // Check registered attendee status or organizer / admin privileges
      const isAdmin = user.globalRole === 'admin';
      const isCreator = targetEvent.createdBy === user.id;

      let isOrganizerMember = false;
      if (!isAdmin && !isCreator) {
        const membership = await db.query.organizerMembers.findFirst({
          where: and(
            eq(organizerMembers.organizerId, targetEvent.organizerId),
            eq(organizerMembers.userId, user.id),
            eq(organizerMembers.status, 'active')
          ),
        });
        isOrganizerMember = !!membership;
      }

      let isRegisteredAttendee = false;
      if (!isAdmin && !isCreator && !isOrganizerMember) {
        const attendeeBooking = await db.query.bookings.findFirst({
          where: and(
            eq(bookings.eventId, id),
            eq(bookings.userId, user.id),
            eq(bookings.status, 'CONFIRMED')
          ),
        });
        isRegisteredAttendee = !!attendeeBooking;
      }

      if (!isAdmin && !isCreator && !isOrganizerMember && !isRegisteredAttendee) {
        return reply.code(403).send({
          error: {
            code: 'REGISTRATION_REQUIRED',
            message: 'Event materials are accessible only to registered attendees and organizers',
            details: { eventId: id },
            requestId: req.id,
          },
        });
      }

      const materials = await db
        .select()
        .from(eventMaterials)
        .where(eq(eventMaterials.eventId, id))
        .orderBy(desc(eventMaterials.createdAt));

      return reply.code(200).send({
        materials,
      });
    }
  );

  // 16. Event Materials: POST /api/v1/events/:id/materials (Organizer Upload with Size/Type Limits)
  const ALLOWED_MATERIAL_MIME_TYPES = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip',
    'application/x-zip-compressed',
    'text/plain',
    'text/markdown',
    'text/csv',
    'image/png',
    'image/jpeg',
    'image/webp',
  ];
  const MAX_MATERIAL_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

  const createMaterialSchema = z.object({
    title: z.string().min(1, 'Title is required').max(255),
    description: z.string().max(2000).optional(),
    fileName: z.string().min(1, 'File name is required').max(255),
    fileSizeBytes: z
      .number()
      .int()
      .positive('File size must be positive')
      .max(MAX_MATERIAL_SIZE_BYTES, 'File size exceeds 25 MB limit'),
    mimeType: z.string().refine((val) => ALLOWED_MATERIAL_MIME_TYPES.includes(val.toLowerCase()), {
      message: 'Unsupported file type. Allowed formats: PDF, Word, PowerPoint, ZIP, CSV, TXT, images',
    }),
    fileUrl: z.string().min(1, 'File URL or storage path is required'),
  });

  fastify.post(
    '/:id/materials',
    {
      config: {
        auth: true,
        policy: 'event:manage:owned',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const user = req.user!;

      const parseResult = createMaterialSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid event material payload',
            details: parseResult.error.flatten(),
            requestId: req.id,
          },
        });
      }

      const targetEvent = await db.query.events.findFirst({
        where: eq(events.id, id),
      });

      if (!targetEvent) {
        return reply.code(404).send({
          error: {
            code: 'EVENT_NOT_FOUND',
            message: `Event ${id} not found`,
            details: { eventId: id },
            requestId: req.id,
          },
        });
      }

      const [created] = await db
        .insert(eventMaterials)
        .values({
          eventId: id,
          title: parseResult.data.title,
          description: parseResult.data.description || null,
          fileName: parseResult.data.fileName,
          fileSizeBytes: parseResult.data.fileSizeBytes,
          mimeType: parseResult.data.mimeType.toLowerCase(),
          fileUrl: parseResult.data.fileUrl,
          uploadedBy: user.id,
        })
        .returning();

      await logAuditEvent({
        actorId: user.id,
        action: 'event.material_uploaded',
        resourceType: 'event_material',
        resourceId: created.id,
        collegeId: user.collegeId,
        meta: {
          eventId: id,
          fileName: created.fileName,
          fileSizeBytes: created.fileSizeBytes,
          mimeType: created.mimeType,
        },
        ip: req.ip,
      });

      return reply.code(201).send({
        material: created,
      });
    }
  );

  // 17. Event Materials: DELETE /api/v1/events/:id/materials/:materialId (Organizer deletion)
  fastify.delete(
    '/:id/materials/:materialId',
    {
      config: {
        auth: true,
        policy: 'event:manage:owned',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id, materialId } = req.params as { id: string; materialId: string };
      const user = req.user!;

      const material = await db.query.eventMaterials.findFirst({
        where: and(eq(eventMaterials.id, materialId), eq(eventMaterials.eventId, id)),
      });

      if (!material) {
        return reply.code(404).send({
          error: {
            code: 'MATERIAL_NOT_FOUND',
            message: `Event material ${materialId} not found`,
            details: { materialId, eventId: id },
            requestId: req.id,
          },
        });
      }

      await db.delete(eventMaterials).where(eq(eventMaterials.id, materialId));

      await logAuditEvent({
        actorId: user.id,
        action: 'event.material_deleted',
        resourceType: 'event_material',
        resourceId: materialId,
        collegeId: user.collegeId,
        meta: { eventId: id, fileName: material.fileName },
        ip: req.ip,
      });

      return reply.code(200).send({
        success: true,
        message: 'Event material deleted successfully.',
      });
    }
  );
};
