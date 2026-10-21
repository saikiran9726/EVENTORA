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
} from '../../../services/notifications-alerts.js';

const CreateAlertSchema = z.object({
  kind: z.enum(['venue', 'time', 'speaker', 'cancellation', 'safety']),
  message: z.string().min(1).max(2000),
  severity: z.enum(['info', 'important', 'urgent']).default('info'),
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

      try {
        const result = await createEventAlert({
          eventId,
          createdBy: req.user!.id,
          kind: parsed.data.kind,
          message: parsed.data.message,
          severity: parsed.data.severity,
        });

        return reply.code(201).send(result);
      } catch (err: any) {
        if (err.message === 'EVENT_NOT_FOUND') {
          return reply.code(404).send({
            error: {
              code: 'NOT_FOUND',
              message: 'Event not found',
              requestId: req.id,
            },
          });
        }
        return reply.code(500).send({
          error: {
            code: 'INTERNAL_ERROR',
            message: err.message || 'Failed to create alert',
            requestId: req.id,
          },
        });
      }
    }
  );

  // 2. GET /events/:id/alerts (Public or attendee view)
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
      const alerts = await getEventAlerts(eventId);
      return reply.send({ alerts });
    }
  );

  // 3. GET /me/notifications (User notification center)
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
      const query = req.query as { unreadOnly?: string; limit?: string };
      const unreadOnly = query.unreadOnly === 'true';
      const limit = query.limit ? parseInt(query.limit, 10) : 50;

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
