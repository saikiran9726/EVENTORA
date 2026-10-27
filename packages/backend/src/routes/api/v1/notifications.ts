import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  createEventAlert,
  getUserNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  getUserNotificationPreferences,
  updateUserNotificationPreferences,
  processEmailWebhook,
  getEventAlerts,
  NotificationError,
} from '../../../services/notifications-alerts.js';
import { pool } from '../../../db/index.js';

const CreateAlertSchema = z.object({
  kind: z.enum(['venue', 'time', 'speaker', 'cancellation', 'safety']),
  message: z.string().min(1).max(2000),
  severity: z.enum(['info', 'important', 'urgent']).default('info'),
});

const GetAlertsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1, 'Limit must be at least 1').max(100, 'Limit cannot exceed 100').default(50),
});

const NotificationsQuerySchema = z.object({
  unreadOnly: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  limit: z.coerce.number().int().min(1, 'Limit must be at least 1').max(100, 'Limit cannot exceed 100').default(50),
});

const EmailWebhookSchema = z.object({
  providerMsgId: z.string().min(1),
  event: z.enum(['delivered', 'failed', 'bounce', 'accepted']),
  timestamp: z.string().optional(),
  signature: z.string().min(1),
  errorCode: z.string().optional(),
});

const UpdatePreferencesSchema = z.object({
  email: z.boolean().optional(),
  inapp: z.boolean().optional(),
  urgentOnly: z.boolean().optional(),
});

export async function notificationRoutes(fastify: FastifyInstance) {
  // 1. POST /events/:id/alerts (Fan-out via Outbox + immediate in-app for urgent)
  fastify.post(
    '/events/:id/alerts',
    {
      config: {
        auth: true,
        policy: 'event:manage:owned',
        objectCheck: true,
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id: eventId } = req.params as { id: string };
      const parsed = CreateAlertSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid alert creation payload',
            details: parsed.error.format(),
            requestId: req.id,
          },
        });
      }

      // Delegate directly to service and global error handler
      const result = await createEventAlert({
        eventId,
        createdBy: req.user!.id,
        kind: parsed.data.kind,
        message: parsed.data.message,
        severity: parsed.data.severity,
      });

      return reply.code(201).send(result);
    }
  );

  // 2. GET /events/:id/alerts (Public view for published events; restricted to ticket holders/organizers for unpublished)
  fastify.get(
    '/events/:id/alerts',
    {
      config: {
        auth: false,
        policy: 'public',
        objectCheck: false,
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id: eventId } = req.params as { id: string };

      // Validate limit query parameter (1-100, NaN-safe)
      const parsedQuery = GetAlertsQuerySchema.safeParse(req.query);
      if (!parsedQuery.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid pagination query parameters (limit must be an integer between 1 and 100)',
            details: parsedQuery.error.format(),
            requestId: req.id,
          },
        });
      }

      const limit = parsedQuery.data.limit;

      // Check event existence and publication status
      const eventRes = await pool.query(
        `SELECT id, status, organizer_id FROM events WHERE id = $1;`,
        [eventId]
      );

      if (eventRes.rows.length === 0) {
        throw new NotificationError('EVENT_NOT_FOUND', 'Event not found', 404);
      }

      const event = eventRes.rows[0];

      // If event is not published, only ticket holders, organizers, or admins may view alerts
      if (event.status !== 'published') {
        if (!req.user) {
          return reply.code(401).send({
            error: {
              code: 'UNAUTHORIZED',
              message: 'Authentication required to view alerts for unpublished events',
              details: {},
              requestId: req.id,
            },
          });
        }

        const isGlobalAdmin = req.user.globalRole === 'admin';
        let isOrganizer = false;
        if (!isGlobalAdmin) {
          const orgMemberRes = await pool.query(
            `SELECT 1 FROM organizer_members WHERE organizer_id = $1 AND user_id = $2 AND status = 'active' LIMIT 1;`,
            [event.organizer_id, req.user.id]
          );
          isOrganizer = orgMemberRes.rows.length > 0;
        }

        if (!isGlobalAdmin && !isOrganizer) {
          const ticketRes = await pool.query(
            `SELECT 1 FROM tickets WHERE event_id = $1 AND (user_id = $2 OR owner_user_id = $2) LIMIT 1;`,
            [eventId, req.user.id]
          );
          if (ticketRes.rows.length === 0) {
            return reply.code(403).send({
              error: {
                code: 'FORBIDDEN',
                message: 'Alerts for unpublished events are only accessible to ticket holders and organizers',
                details: {},
                requestId: req.id,
              },
            });
          }
        }
      }

      const alerts = await getEventAlerts(eventId, limit);
      return reply.send({ alerts });
    }
  );

  // 3. GET /me/notifications (User notification center with bounded limit)
  fastify.get(
    '/me/notifications',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: false,
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parsedQuery = NotificationsQuerySchema.safeParse(req.query);
      if (!parsedQuery.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid notification query parameters (limit must be an integer between 1 and 100)',
            details: parsedQuery.error.format(),
            requestId: req.id,
          },
        });
      }

      const { unreadOnly, limit } = parsedQuery.data;
      const result = await getUserNotifications(req.user!.id, { unreadOnly, limit });
      return reply.send(result);
    }
  );

  // 4. PATCH /me/notifications/:id/read (Mark single notification as read)
  fastify.patch(
    '/me/notifications/:id/read',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: false,
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      try {
        const notif = await markNotificationRead(req.user!.id, id);
        return reply.send({ notification: notif });
      } catch (err: any) {
        if (err.message === 'NOTIFICATION_NOT_FOUND') {
          return reply.code(404).send({
            error: {
              code: 'NOT_FOUND',
              message: 'Notification not found or access denied',
              requestId: req.id,
            },
          });
        }
        return reply.code(500).send({
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to update notification',
            requestId: req.id,
          },
        });
      }
    }
  );

  // 5. POST /me/notifications/read-all (Mark all read)
  fastify.post(
    '/me/notifications/read-all',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: false,
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const result = await markAllNotificationsRead(req.user!.id);
      return reply.send(result);
    }
  );

  // 6. GET /me/notification-preferences
  fastify.get(
    '/me/notification-preferences',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: false,
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const preferences = await getUserNotificationPreferences(req.user!.id);
      return reply.send({ preferences });
    }
  );

  // 7. PATCH /me/notification-preferences
  fastify.patch(
    '/me/notification-preferences',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: false,
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = UpdatePreferencesSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid preferences payload',
            requestId: req.id,
          },
        });
      }

      const updated = await updateUserNotificationPreferences(req.user!.id, parsed.data);
      return reply.send({ preferences: updated });
    }
  );

  // 8. POST /webhooks/email (Provider delivery webhook: signature-verified, idempotent)
  fastify.post(
    '/webhooks/email',
    {
      config: {
        auth: false,
        policy: 'public',
        objectCheck: false,
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = EmailWebhookSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid webhook payload structure',
            requestId: req.id,
          },
        });
      }

      try {
        const result = await processEmailWebhook(parsed.data);
        return reply.send(result);
      } catch (err: any) {
        if (err.message === 'INVALID_WEBHOOK_SIGNATURE') {
          return reply.code(401).send({
            error: {
              code: 'UNAUTHORIZED',
              message: 'Invalid email webhook signature',
              requestId: req.id,
            },
          });
        }
        return reply.code(500).send({
          error: {
            code: 'INTERNAL_ERROR',
            message: err.message || 'Webhook processing failed',
            requestId: req.id,
          },
        });
      }
    }
  );
}
