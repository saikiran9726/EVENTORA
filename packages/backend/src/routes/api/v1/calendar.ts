import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { db } from '../../../db/index.js';
import { events, venues } from '../../../db/schema.js';
import { eq, and, gte, lte, asc } from 'drizzle-orm';

const calendarQuerySchema = z.object({
  start: z.string().optional(),
  end: z.string().optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Month format must be YYYY-MM').optional(),
  view: z.enum(['month', 'agenda', 'week', 'day']).optional(),
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
            message: 'Invalid calendar query parameters',
            details: parseResult.error.flatten(),
            requestId: req.id,
          },
        });
      }

      const { start, end, month } = parseResult.data;

      const conditions: any[] = [
        eq(events.status, 'published'),
        eq(events.visibility, 'public'),
      ];

      if (month) {
        const [yearStr, monthStr] = month.split('-');
        const y = parseInt(yearStr, 10);
        const m = parseInt(monthStr, 10) - 1;
        const monthStart = new Date(Date.UTC(y, m, 1, 0, 0, 0));
        const monthEnd = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999));
        conditions.push(lte(events.startsAt, monthEnd));
        conditions.push(gte(events.endsAt, monthStart));
      } else {
        if (start && !isNaN(Date.parse(start))) {
          conditions.push(gte(events.startsAt, new Date(start)));
        }
        if (end && !isNaN(Date.parse(end))) {
          conditions.push(lte(events.endsAt, new Date(end)));
        }
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
        items,
      });
    }
  );
};
