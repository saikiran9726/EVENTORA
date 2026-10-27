import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { db } from '../../../db/index.js';
import { venues } from '../../../db/schema.js';
import { eq } from 'drizzle-orm';
import { logAuditEvent } from '../../../services/audit.js';
import { checkVenueAvailability } from '../../../services/venue.js';

const createVenueSchema = z.object({
  name: z.string().min(2).max(255),
  building: z.string().min(2).max(255),
  capacity: z.number().int().min(1),
  accessibilityNotes: z.string().optional(),
  directions: z.string().optional(),
  mapUrl: z.string().url().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  collegeId: z.string().uuid().optional(),
});

export const venueRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // 1. GET /api/v1/venues
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
      const items = await db
        .select()
        .from(venues)
        .where(eq(venues.status, 'active'));

      return reply.code(200).send({
        venues: items,
      });
    }
  );

  // 2. POST /api/v1/venues
  fastify.post(
    '/',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const parseResult = createVenueSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid venue payload',
            details: parseResult.error.flatten(),
            requestId: req.id,
          },
        });
      }

      const user = req.user!;
      const data = parseResult.data;
      const collegeId = data.collegeId || user.collegeId;

      const [newVenue] = await db
        .insert(venues)
        .values({
          collegeId,
          name: data.name,
          building: data.building,
          capacity: data.capacity,
          accessibilityNotes: data.accessibilityNotes,
          directions: data.directions,
          mapUrl: data.mapUrl,
          lat: data.lat !== undefined ? String(data.lat) : null,
          lng: data.lng !== undefined ? String(data.lng) : null,
          status: 'active',
        })
        .returning();

      await logAuditEvent({
        actorId: user.id,
        action: 'venue.created',
        resourceType: 'venue',
        resourceId: newVenue.id,
        collegeId,
        ip: req.ip,
      });

      return reply.code(201).send({
        venue: newVenue,
        message: 'Venue created successfully',
      });
    }
  );

  // 3. GET /api/v1/venues/:id/availability
  fastify.get(
    '/:id/availability',
    {
      config: {
        auth: false,
        policy: 'public',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { startsAt, endsAt, excludeEventId } = req.query as {
        startsAt?: string;
        endsAt?: string;
        excludeEventId?: string;
      };

      if (!startsAt || !endsAt) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'startsAt and endsAt query parameters are required',
            details: {},
            requestId: req.id,
          },
        });
      }

      const avail = await checkVenueAvailability(
        id,
        new Date(startsAt),
        new Date(endsAt),
        excludeEventId
      );

      return reply.code(200).send(avail);
    }
  );
};
