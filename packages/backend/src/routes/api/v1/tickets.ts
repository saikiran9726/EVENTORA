import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  scanTicket,
  revokeTicket,
  verifyCertificateByCode,
  getUserTickets,
  getTicketById,
  getEventAttendance,
  getUserCertificates,
  getCertificateDownload,
  TicketScanError,
} from '../../../services/qr-ticket.js';
import { pool } from '../../../db/index.js';

const scanRequestSchema = z.object({
  token: z.string().min(1, 'Scan token or QR URL is required'),
  sessionId: z.string().uuid().optional(),
  deviceId: z.string().max(100).optional(),
});

const revokeRequestSchema = z.object({
  reason: z.string().min(3, 'Revocation reason must be at least 3 characters').max(500),
});

export const ticketRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // 1. GET /api/v1/me/tickets - Current user's digital tickets
  fastify.get(
    '/me/tickets',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const tickets = await getUserTickets(req.user!.id);
      return reply.send({ tickets });
    }
  );

  // 2. GET /api/v1/tickets/:id - Single ticket details
  fastify.get(
    '/tickets/:id',
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
            const res = await client.query(
              `SELECT user_id, owner_user_id, event_id FROM tickets WHERE id = $1;`,
              [id]
            );
            if (res.rows.length === 0) return false;
            const t = res.rows[0];
            if (t.user_id === user.id || t.owner_user_id === user.id) return true;

            // Check staff checkin assignment
            const staffRes = await client.query(
              `SELECT 1 FROM event_staff_assignments
               WHERE event_id = $1 AND user_id = $2 AND capability = 'checkin';`,
              [t.event_id, user.id]
            );
            if (staffRes.rows.length > 0) return true;

            // Check organizer membership
            const orgRes = await client.query(
              `SELECT 1 FROM events e
               JOIN organizer_members om ON om.organizer_id = e.organizer_id
               WHERE e.id = $1 AND om.user_id = $2 AND om.status = 'active';`,
              [t.event_id, user.id]
            );
            return orgRes.rows.length > 0;
          } finally {
            client.release();
          }
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const ticket = await getTicketById(id);
      if (!ticket) {
        return reply.code(404).send({
          error: {
            code: 'TICKET_NOT_FOUND',
            message: `Ticket ${id} not found`,
            details: { ticketId: id },
            requestId: req.id,
          },
        });
      }
      return reply.send({ ticket });
    }
  );

  // 3. POST /api/v1/events/:id/check-in/scan - Staff Check-in Scanner
  fastify.post(
    '/events/:id/check-in/scan',
    {
      config: {
        auth: true,
        policy: 'attendance:checkin:assigned',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id: eventId } = req.params as { id: string };
      const parsed = scanRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid scan request parameters',
            details: parsed.error.format(),
            requestId: req.id,
          },
        });
      }

      try {
        const result = await scanTicket({
          tokenOrUrl: parsed.data.token,
          eventId,
          staffId: req.user!.id,
          sessionId: parsed.data.sessionId,
          deviceId: parsed.data.deviceId,
        });

        return reply.send(result);
      } catch (err: any) {
        if (err instanceof TicketScanError) {
          return reply.code(err.statusCode).send({
            error: {
              code: `SCAN_${err.outcome}`,
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

  // 4. GET /api/v1/events/:id/attendance - Live Attendance Roster & Counters
  fastify.get(
    '/events/:id/attendance',
    {
      config: {
        auth: true,
        policy: 'attendance:checkin:assigned',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id: eventId } = req.params as { id: string };
      const attendance = await getEventAttendance(eventId);
      return reply.send(attendance);
    }
  );

  // 5. POST /api/v1/tickets/:id/revoke - Revoke a ticket
  fastify.post(
    '/tickets/:id/revoke',
    {
      config: {
        auth: true,
        policy: 'event:manage:owned',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id: ticketId } = req.params as { id: string };
      const parsed = revokeRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid revocation parameters',
            details: parsed.error.format(),
            requestId: req.id,
          },
        });
      }

      try {
        const result = await revokeTicket({
          ticketId,
          actorId: req.user!.id,
          reason: parsed.data.reason,
        });
        return reply.send(result);
      } catch (err: any) {
        if (err.message === 'Ticket not found') {
          return reply.code(404).send({
            error: {
              code: 'TICKET_NOT_FOUND',
              message: `Ticket ${ticketId} not found`,
              details: { ticketId },
              requestId: req.id,
            },
          });
        }
        throw err;
      }
    }
  );

  // 6. GET /api/v1/me/certificates - Authenticated attendee's certificates
  fastify.get(
    '/me/certificates',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const certificates = await getUserCertificates(req.user!.id);
      return reply.send({ certificates });
    }
  );

  // 7. GET /api/v1/certificates/:id/download - Download / JSON certificate representation
  fastify.get(
    '/certificates/:id/download',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const cert = await getCertificateDownload(id, req.user!.id);
      if (!cert) {
        return reply.code(404).send({
          error: {
            code: 'CERTIFICATE_NOT_FOUND',
            message: `Certificate ${id} not found or you are not authorized to download it.`,
            details: { certificateId: id },
            requestId: req.id,
          },
        });
      }
      return reply.send({ certificate: cert });
    }
  );

  // 8. GET /api/v1/verify/:code - Public Verification Endpoint (Zero PII leak)
  fastify.get(
    '/verify/:code',
    {
      config: {
        auth: false,
        policy: 'public',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { code } = req.params as { code: string };
      const clientIp = req.ip || '127.0.0.1';

      try {
        const result = await verifyCertificateByCode(code, clientIp);
        if (!result.found) {
          return reply.code(404).send({
            error: {
              code: 'CERTIFICATE_NOT_FOUND',
              message: result.message,
              details: { code },
              requestId: req.id,
            },
          });
        }
        return reply.send(result);
      } catch (err: any) {
        if (err.message && err.message.includes('rate limit exceeded')) {
          return reply.code(429).send({
            error: {
              code: 'RATE_LIMIT_EXCEEDED',
              message: err.message,
              details: { limit: 30, window: '60s' },
              requestId: req.id,
            },
          });
        }
        throw err;
      }
    }
  );
};
