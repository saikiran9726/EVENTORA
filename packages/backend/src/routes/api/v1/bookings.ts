import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import crypto from 'crypto';
import { pool } from '../../../db/index.js';
import { createBooking, BookingError } from '../../../services/booking.js';
import { joinWaitlist, leaveWaitlist, claimOffer, declineOffer } from '../../../services/waitlist.js';
import { cancelBooking } from '../../../services/cancellation.js';
import { checkRateLimit } from '../../../services/redis.js';
import { checkRegistrationEligibility } from '../../../services/passport-crosscollege.js';

const bookingItemSchema = z.object({
  ticketTypeId: z.string().uuid(),
  quantity: z.number().int().min(1).max(10),
});

const answerItemSchema = z.union([
  z.object({
    fieldId: z.string().uuid(),
    value: z.any(),
    attendeeIndex: z.number().int().min(0).default(0),
  }),
  z.object({
    questionId: z.string().uuid(),
    answer: z.any(),
    attendeeIndex: z.number().int().min(0).optional(),
  }),
]);

const createBookingSchema = z.object({
  items: z.array(bookingItemSchema).min(1),
  answers: z.array(answerItemSchema).optional(),
  teamRegistrationId: z.string().uuid().optional(),
});

const joinWaitlistSchema = z.object({
  ticketTypeId: z.string().uuid(),
});

const cancelBookingSchema = z.object({
  reason: z.string().min(3).max(500).optional(),
});

export const bookingRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // 1. POST /api/v1/events/:id/bookings
  fastify.post(
    '/events/:id/bookings',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id: eventId } = req.params as { id: string };
      const user = req.user!;

      // Enforce rate limit: 10 bookings per min per user
      const rl = await checkRateLimit(`rate:booking:${user.id}`, 10, 60);
      if (!rl.allowed) {
        return reply.code(429).send({
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many booking attempts. Please wait a minute before retrying.',
            details: { limit: 10, window: '60s', resetSeconds: rl.resetSeconds },
            requestId: req.id,
          },
        });
      }

      // Enforce Idempotency-Key header (capped at 128 characters)
      const idempotencyKey = (req.headers['idempotency-key'] || req.headers['Idempotency-Key']) as string;
      if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
        return reply.code(400).send({
          error: {
            code: 'MISSING_IDEMPOTENCY_KEY',
            message: 'Header "Idempotency-Key" is required for bookings',
            details: {},
            requestId: req.id,
          },
        });
      }

      if (idempotencyKey.trim().length > 128) {
        return reply.code(400).send({
          error: {
            code: 'INVALID_IDEMPOTENCY_KEY',
            message: 'Header "Idempotency-Key" must not exceed 128 characters',
            details: { maxLength: 128 },
            requestId: req.id,
          },
        });
      }

      const parseResult = createBookingSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid booking payload',
            details: parseResult.error.flatten(),
            requestId: req.id,
          },
        });
      }

      // SHA-256 payload binding for idempotency replays
      const normalizedPayload = {
        items: parseResult.data.items
          .map((it) => ({ ticketTypeId: it.ticketTypeId, quantity: it.quantity }))
          .sort((a, b) => a.ticketTypeId.localeCompare(b.ticketTypeId)),
        teamRegistrationId: parseResult.data.teamRegistrationId || null,
        answers: (parseResult.data.answers || []).map((a: any) => ({
          fieldId: a.fieldId || a.questionId,
          value: a.value !== undefined ? a.value : a.answer,
          attendeeIndex: a.attendeeIndex || 0,
        })),
      };
      const payloadHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(normalizedPayload))
        .digest('hex');

      // Cross-college & department eligibility verification (Phase 10 FR-XCOL)
      const eligibility = await checkRegistrationEligibility(eventId, {
        collegeId: user.collegeId,
        department: (user as any).department,
        year: (user as any).year,
      });

      if (!eligibility.eligible) {
        return reply.code(403).send({
          error: {
            code: eligibility.reason || 'ELIGIBILITY_RESTRICTION',
            message: eligibility.message || 'You do not meet the eligibility criteria for this event.',
            requestId: req.id,
          },
        });
      }

      try {
        const result = await createBooking({
          userId: user.id,
          eventId,
          items: parseResult.data.items,
          idempotencyKey: idempotencyKey.trim(),
          payloadHash,
          teamRegistrationId: parseResult.data.teamRegistrationId,
          answers: parseResult.data.answers,
        });

        return reply.code(result.isIdempotentReplay ? 200 : 201).send({
          booking: result.booking,
          items: result.items,
          tickets: result.tickets,
          warnings: result.warnings,
          idempotentReplay: result.isIdempotentReplay,
        });
      } catch (err: any) {
        if (err instanceof BookingError) {
          return reply.code(err.status).send({
            error: {
              code: err.code,
              message: err.message,
              details: err.details || {},
              requestId: req.id,
            },
          });
        }
        throw err;
      }
    }
  );

  // 2. GET /api/v1/bookings/:id (Owner or Admin only)
  fastify.get(
    '/bookings/:id',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: async (req) => {
          const { id } = req.params as { id: string };
          const user = req.user!;
          if (user.globalRole === 'admin') return true;
          const client = await pool.connect();
          try {
            const res = await client.query('SELECT user_id FROM bookings WHERE id = $1', [id]);
            if (res.rows.length === 0) return true;
            return res.rows[0].user_id === user.id;
          } finally {
            client.release();
          }
        },
      },
    },
    async (req, reply) => {
      const { id: bookingId } = req.params as { id: string };
      const user = req.user!;

      const client = await pool.connect();
      try {
        const bookingRes = await client.query(
          `SELECT b.*, e.title as event_title, e.starts_at as event_starts_at, e.ends_at as event_ends_at,
                  v.name as venue_name
           FROM bookings b
           JOIN events e ON b.event_id = e.id
           LEFT JOIN venues v ON e.venue_id = v.id
           WHERE b.id = $1;`,
          [bookingId]
        );

        if (bookingRes.rows.length === 0) {
          return reply.code(404).send({
            error: {
              code: 'BOOKING_NOT_FOUND',
              message: 'Booking not found',
              details: {},
              requestId: req.id,
            },
          });
        }

        const booking = bookingRes.rows[0];
        if (booking.user_id !== user.id && user.globalRole !== 'admin') {
          return reply.code(403).send({
            error: {
              code: 'FORBIDDEN',
              message: 'You are not authorized to view this booking',
              details: {},
              requestId: req.id,
            },
          });
        }

        const itemsRes = await client.query(
          `SELECT bi.*, tt.name as ticket_type_name
           FROM booking_items bi
           JOIN ticket_types tt ON bi.ticket_type_id = tt.id
           WHERE bi.booking_id = $1;`,
          [bookingId]
        );

        const ticketsRes = await client.query(
          `SELECT id, ticket_code, status, checked_in_at, created_at
           FROM tickets
           WHERE booking_id = $1;`,
          [bookingId]
        );

        const answersRes = await client.query(
          `SELECT ra.id, ra.field_id, ra.field_version, ra.value, ra.attendee_index,
                  eff.label as field_label, eff.type as field_type
           FROM registration_answers ra
           LEFT JOIN event_form_fields eff ON ra.field_id = eff.id
           WHERE ra.booking_id = $1
           ORDER BY ra.attendee_index ASC, eff.position ASC;`,
          [bookingId]
        );

        return reply.code(200).send({
          booking,
          items: itemsRes.rows,
          tickets: ticketsRes.rows,
          answers: answersRes.rows,
        });
      } finally {
        client.release();
      }
    }
  );

  // 3. POST /api/v1/bookings/:id/cancel
  fastify.post(
    '/bookings/:id/cancel',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: async (req) => {
          const { id } = req.params as { id: string };
          const user = req.user!;
          if (user.globalRole === 'admin') return true;
          const client = await pool.connect();
          try {
            const res = await client.query('SELECT user_id FROM bookings WHERE id = $1', [id]);
            if (res.rows.length === 0) return true;
            return res.rows[0].user_id === user.id;
          } finally {
            client.release();
          }
        },
      },
    },
    async (req, reply) => {
      const { id: bookingId } = req.params as { id: string };
      const user = req.user!;

      const parseResult = cancelBookingSchema.safeParse(req.body || {});
      const reason = parseResult.success ? parseResult.data.reason : 'Attendee cancelled booking';

      try {
        const result = await cancelBooking(bookingId, user.id, reason);
        return reply.code(200).send(result);
      } catch (err: any) {
        if (err instanceof BookingError) {
          return reply.code(err.status).send({
            error: {
              code: err.code,
              message: err.message,
              details: err.details || {},
              requestId: req.id,
            },
          });
        }
        throw err;
      }
    }
  );

  // 4. GET /api/v1/me/bookings (Current user booking history)
  fastify.get(
    '/me/bookings',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const user = req.user!;
      const client = await pool.connect();

      try {
        const res = await client.query(
          `SELECT b.*, e.title as event_title, e.slug as event_slug, e.starts_at as event_starts_at,
                  e.ends_at as event_ends_at, v.name as venue_name,
                  COUNT(t.id)::int as ticket_count,
                  MAX(t.ticket_code) as ticket_code,
                  MAX(t.id::text) as ticket_id,
                  MAX(t.status::text) as ticket_status
           FROM bookings b
           JOIN events e ON b.event_id = e.id
           LEFT JOIN venues v ON e.venue_id = v.id
           LEFT JOIN tickets t ON b.id = t.booking_id
           WHERE b.user_id = $1
           GROUP BY b.id, e.id, v.id
           ORDER BY b.created_at DESC;`,
          [user.id]
        );

        return reply.code(200).send({
          bookings: res.rows,
        });
      } finally {
        client.release();
      }
    }
  );

  // 5. GET /api/v1/events/:id/ticket-types (Live availability polling)
  fastify.get(
    '/events/:id/ticket-types',
    {
      config: {
        auth: false,
        policy: 'public',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id: eventId } = req.params as { id: string };
      const client = await pool.connect();

      try {
        const res = await client.query(
          `SELECT id, event_id, name, price_paise, capacity, sold, held,
                  GREATEST(0, capacity - (sold + held)) as available,
                  sales_start, sales_end, eligibility, per_user_limit
           FROM ticket_types
           WHERE event_id = $1
           ORDER BY price_paise ASC, name ASC;`,
          [eventId]
        );

        return reply.code(200).send({
          ticketTypes: res.rows,
        });
      } finally {
        client.release();
      }
    }
  );

  // 6. POST /api/v1/events/:id/waitlist (Join waitlist)
  fastify.post(
    '/events/:id/waitlist',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id: eventId } = req.params as { id: string };
      const user = req.user!;

      const parseResult = joinWaitlistSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid waitlist request',
            details: parseResult.error.flatten(),
            requestId: req.id,
          },
        });
      }

      try {
        const result = await joinWaitlist({
          userId: user.id,
          eventId,
          ticketTypeId: parseResult.data.ticketTypeId,
        });

        return reply.code(result.alreadyQueued ? 200 : 201).send({
          entry: result.entry,
          position: result.position,
          alreadyQueued: result.alreadyQueued,
        });
      } catch (err: any) {
        if (err instanceof BookingError) {
          return reply.code(err.status).send({
            error: {
              code: err.code,
              message: err.message,
              details: err.details || {},
              requestId: req.id,
            },
          });
        }
        throw err;
      }
    }
  );

  // 7. GET /api/v1/events/:id/waitlist/me
  fastify.get(
    '/events/:id/waitlist/me',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id: eventId } = req.params as { id: string };
      const user = req.user!;
      const client = await pool.connect();

      try {
        const res = await client.query(
          `SELECT w.*, tt.name as ticket_type_name, tt.price_paise
           FROM waitlist_entries w
           JOIN ticket_types tt ON w.ticket_type_id = tt.id
           WHERE w.event_id = $1 AND w.user_id = $2 AND w.status IN ('WAITING', 'OFFERED');`,
          [eventId, user.id]
        );

        if (res.rows.length === 0) {
          return reply.code(200).send({ inWaitlist: false, entry: null, serverTime: new Date().toISOString() });
        }

        const entry = res.rows[0];
        let position = null;
        if (entry.status === 'WAITING') {
          const posRes = await client.query(
            `SELECT COUNT(*)::int as position
             FROM waitlist_entries
             WHERE ticket_type_id = $1 AND status = 'WAITING'
               AND (created_at < $2 OR (created_at = $2 AND id <= $3));`,
            [entry.ticket_type_id, entry.created_at, entry.id]
          );
          position = posRes.rows[0].position || 1;
        }

        return reply.code(200).send({
          inWaitlist: true,
          entry,
          position,
          serverTime: new Date().toISOString(),
        });
      } finally {
        client.release();
      }
    }
  );

  // 8. DELETE /api/v1/events/:id/waitlist/me
  fastify.delete(
    '/events/:id/waitlist/me',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id: eventId } = req.params as { id: string };
      const user = req.user!;

      const result = await leaveWaitlist(user.id, eventId);
      return reply.code(200).send(result);
    }
  );

  // 9. POST /api/v1/waitlist/:entryId/claim (Claim offer)
  fastify.post(
    '/waitlist/:entryId/claim',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { entryId } = req.params as { entryId: string };
      const user = req.user!;

      const idempotencyKey = (req.headers['idempotency-key'] || req.headers['Idempotency-Key']) as string;
      if (!idempotencyKey) {
        return reply.code(400).send({
          error: {
            code: 'MISSING_IDEMPOTENCY_KEY',
            message: 'Header "Idempotency-Key" is required to claim a waitlist offer',
            details: {},
            requestId: req.id,
          },
        });
      }

      const body = (req.body as any) || {};
      const claimToken = body.claimToken;
      if (!claimToken || typeof claimToken !== 'string' || !claimToken.trim()) {
        return reply.code(400).send({
          error: {
            code: 'MISSING_CLAIM_TOKEN',
            message: 'Claim token is required to claim a waitlist offer',
            details: {},
            requestId: req.id,
          },
        });
      }

      try {
        const result = await claimOffer({
          entryId,
          userId: user.id,
          claimToken: claimToken.trim(),
          idempotencyKey: idempotencyKey.trim(),
        });

        return reply.code(200).send(result);
      } catch (err: any) {
        if (err instanceof BookingError) {
          return reply.code(err.status).send({
            error: {
              code: err.code,
              message: err.message,
              details: err.details || {},
              requestId: req.id,
            },
          });
        }
        throw err;
      }
    }
  );

  // 10. POST /api/v1/waitlist/:entryId/decline (Decline offer)
  fastify.post(
    '/waitlist/:entryId/decline',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { entryId } = req.params as { entryId: string };
      const user = req.user!;

      try {
        const result = await declineOffer(entryId, user.id);
        return reply.code(200).send(result);
      } catch (err: any) {
        if (err instanceof BookingError) {
          return reply.code(err.status).send({
            error: {
              code: err.code,
              message: err.message,
              details: err.details || {},
              requestId: req.id,
            },
          });
        }
        throw err;
      }
    }
  );
};
