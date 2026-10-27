import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { db } from '../../../db/index.js';
import { events, venues } from '../../../db/schema.js';
import { eq, and, gte, lte, asc } from 'drizzle-orm';

const calendarQuerySchema = z.object({
  start: z.string().datetime().optional(),
  end: z.string().datetime().optional(),
});

export const calendarRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // GET /api/v1/calendar
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
      const parseResult = calendarQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid calendar date range',
            details: parseResult.error.flatten(),
            requestId: req.id,
          },
        });
      }

      const { start, end } = parseResult.data;

      const conditions: any[] = [
        eq(events.status, 'published'),
        eq(events.visibility, 'public'),
      ];

      if (start) {
        conditions.push(gte(events.startsAt, new Date(start)));
      }
      if (end) {
        conditions.push(lte(events.endsAt, new Date(end)));
      }

      const items = await db
        .select({
          id: events.id,
          title: events.title,
          slug: events.slug,
          category: events.category,
          format: events.format,
          startsAt: events.startsAt,
          endsAt: events.endsAt,
          venueName: venues.name,
          venueBuilding: venues.building,
        })
        .from(events)
        .leftJoin(venues, eq(events.venueId, venues.id))
        .where(and(...conditions))
        .orderBy(asc(events.startsAt));

      return reply.code(200).send({
        events: items,
      });
    }
  );
};
