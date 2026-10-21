import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  submitFeedback,
  getPublicEventRatings,
  getOrganizerFeedback,
  reportFeedback,
  moderateFeedback,
  getOrganizerAnalytics,
  createExportJob,
  getExportDownloadByToken,
  FeedbackError,
} from '../../../services/feedback-analytics.js';
import { pool } from '../../../db/index.js';

const submitFeedbackSchema = z.object({
  rating: z.number().int().min(1, 'Rating must be at least 1').max(5, 'Rating cannot exceed 5'),
  comment: z.string().max(2000, 'Comment must not exceed 2000 characters').optional(),
  answers: z.record(z.any()).optional(),
});

const reportFeedbackSchema = z.object({
  reason: z.string().min(3, 'Reason must be at least 3 characters').max(500),
});

const moderateFeedbackSchema = z.object({
  status: z.enum(['visible', 'flagged', 'hidden']),
  notes: z.string().max(500).optional(),
});

const exportRequestSchema = z.object({
  format: z.enum(['csv', 'xlsx']).default('csv'),
  kind: z.enum(['attendees', 'feedback', 'sales_ledger', 'analytics']).default('attendees'),
});

export const feedbackRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // 1. GET /api/v1/me/feedback-invitations - Pending and completed feedback for attendee
  fastify.get(
    '/me/feedback-invitations',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const client = await pool.connect();
      try {
        const res = await client.query(
          `SELECT fi.event_id, fi.status, fi.invited_at, fi.last_reminded_at, fi.reminders_sent,
                  e.title as event_title, e.starts_at as event_date,
                  ef.id as feedback_id, ef.rating, ef.comment, ef.submitted_at, ef.edited_at
           FROM tickets t
           JOIN events e ON t.event_id = e.id
           LEFT JOIN feedback_invitations fi ON fi.event_id = e.id AND fi.user_id = t.user_id
           LEFT JOIN event_feedback ef ON ef.event_id = e.id AND ef.user_id = t.user_id
           WHERE t.user_id = $1 AND t.status = 'CHECKED_IN'
           ORDER BY e.starts_at DESC;`,
          [req.user!.id]
        );

        return reply.send({ invitations: res.rows });
      } finally {
        client.release();
      }
    }
  );

  // 2. POST /api/v1/events/:id/feedback - Submit or edit feedback (Checked-in attendees only)
  fastify.post(
    '/events/:id/feedback',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id: eventId } = req.params as { id: string };
      const parsed = submitFeedbackSchema.safeParse(req.body);

      if (!parsed.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid feedback submission parameters',
            details: parsed.error.format(),
            requestId: req.id,
          },
        });
      }

      try {
        const feedback = await submitFeedback({
          eventId,
          userId: req.user!.id,
          rating: parsed.data.rating,
          comment: parsed.data.comment,
          answers: parsed.data.answers,
        });

        return reply.code(200).send({
          feedback,
          message: feedback.edited_at
            ? 'Feedback updated successfully.'
            : 'Thank you! Your feedback has been recorded.',
        });
      } catch (err: any) {
        if (err instanceof FeedbackError) {
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

  // 3. GET /api/v1/events/:id/ratings - Public Ratings & Response Rate
  fastify.get(
    '/events/:id/ratings',
    {
      config: {
        auth: false,
        policy: 'public',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id: eventId } = req.params as { id: string };
      const ratings = await getPublicEventRatings(eventId);
      return reply.send(ratings);
    }
  );

  // 4. GET /api/v1/organizer/events/:id/feedback - Paginated Organizer Feedback (Zero PII)
  fastify.get(
    '/organizer/events/:id/feedback',
    {
      config: {
        auth: true,
        policy: 'analytics:view:owned',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id: eventId } = req.params as { id: string };
      const { page = '1', limit = '20' } = req.query as { page?: string; limit?: string };

      const feedbackData = await getOrganizerFeedback(
        eventId,
        parseInt(page, 10) || 1,
        parseInt(limit, 10) || 20
      );

      return reply.send(feedbackData);
    }
  );

  // 5. POST /api/v1/feedback/:id/report - Report feedback review
  fastify.post(
    '/feedback/:id/report',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id: feedbackId } = req.params as { id: string };
      const parsed = reportFeedbackSchema.safeParse(req.body);

      if (!parsed.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid report parameters',
            details: parsed.error.format(),
            requestId: req.id,
          },
        });
      }

      const report = await reportFeedback({
        feedbackId,
        reporterId: req.user!.id,
        reason: parsed.data.reason,
      });

      return reply.send({
        success: true,
        message: 'Review flagged for moderation review.',
        report,
      });
    }
  );

  // 6. POST /api/v1/feedback/:id/moderate - Moderate feedback review (Organizer or Admin)
  fastify.post(
    '/feedback/:id/moderate',
    {
      config: {
        auth: true,
        policy: 'event:manage:owned',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id: feedbackId } = req.params as { id: string };
      const parsed = moderateFeedbackSchema.safeParse(req.body);

      if (!parsed.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid moderation parameters',
            details: parsed.error.format(),
            requestId: req.id,
          },
        });
      }

      try {
        const result = await moderateFeedback({
          feedbackId,
          actorId: req.user!.id,
          status: parsed.data.status,
          notes: parsed.data.notes,
        });

        return reply.send({
          success: true,
          feedback: result,
        });
      } catch (err: any) {
        if (err instanceof FeedbackError) {
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

  // 7. GET /api/v1/organizer/events/:id/analytics - Complete Organizer Analytics & Funnel
  fastify.get(
    '/organizer/events/:id/analytics',
    {
      config: {
        auth: true,
        policy: 'analytics:view:owned',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id: eventId } = req.params as { id: string };
      const analytics = await getOrganizerAnalytics(eventId);
      return reply.send(analytics);
    }
  );

  // 8. POST /api/v1/organizer/events/:id/exports - Request Data Export (CSV Formula Neutralized)
  fastify.post(
    '/organizer/events/:id/exports',
    {
      config: {
        auth: true,
        policy: 'export:owned',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id: eventId } = req.params as { id: string };
      const parsed = exportRequestSchema.safeParse(req.body);

      if (!parsed.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid export parameters',
            details: parsed.error.format(),
            requestId: req.id,
          },
        });
      }

      // Check if user has elevated PII export role
      const hasPiiExportRole = req.user!.globalRole === 'admin';

      const job = await createExportJob({
        eventId,
        requesterId: req.user!.id,
        format: parsed.data.format,
        kind: parsed.data.kind,
        hasPiiExportRole,
      });

      return reply.code(200).send(job);
    }
  );

  // 9. GET /api/v1/exports/download/:token - Download Generated Export
  fastify.get(
    '/exports/download/:token',
    {
      config: {
        auth: false,
        policy: 'public',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { token } = req.params as { token: string };
      const exportData = getExportDownloadByToken(token);

      if (!exportData) {
        return reply.code(404).send({
          error: {
            code: 'EXPORT_NOT_FOUND',
            message: 'Export file not found or download link has expired (15-minute validity).',
            details: { token },
            requestId: req.id,
          },
        });
      }

      reply.header('Content-Type', exportData.format === 'csv' ? 'text/csv' : 'application/vnd.ms-excel');
      reply.header('Content-Disposition', `attachment; filename="eventora_export_${Date.now()}.${exportData.format}"`);
      return reply.send(exportData.content);
    }
  );
};
