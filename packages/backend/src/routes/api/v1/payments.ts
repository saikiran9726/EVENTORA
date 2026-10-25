import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { pool } from '../../../db/index.js';
import {
  initiateCheckout,
  verifyPayment,
  processWebhook,
  requestRefund,
  decideRefund,
  getOrganizerSalesSummary,
  PaymentError,
} from '../../../services/payment.js';
import { simulatorAdapter } from '../../../services/payment-adapter.js';

const verifyPaymentSchema = z.object({
  orderId: z.string().min(1),
  paymentId: z.string().min(1),
  signature: z.string().optional(),
});

const refundRequestSchema = z.object({
  reason: z.string().min(3).max(500),
  idempotencyKey: z.string().min(1).max(255),
});

const refundDecisionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
});

export const paymentRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // 1. POST /api/v1/bookings/:id/checkout (Owner creates hold + payment order)
  fastify.post(
    '/bookings/:id/checkout',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id: bookingId } = req.params as { id: string };
      const user = req.user!;

      try {
        const order = await initiateCheckout({ bookingId, userId: user.id });
        return reply.code(200).send({
          order,
          isSimulated: true,
          mode: 'TEST MODE – simulated money',
        });
      } catch (err: any) {
        if (err instanceof PaymentError) {
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

  // 2. POST /api/v1/payments/verify (Server re-queries adapter; browser result is a hint only)
  fastify.post(
    '/payments/verify',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const parsed = verifyPaymentSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid payment verification payload',
            details: parsed.error.format(),
            requestId: req.id,
          },
        });
      }

      try {
        const result = await verifyPayment({
          orderId: parsed.data.orderId,
          paymentId: parsed.data.paymentId,
          signature: parsed.data.signature,
          userId: req.user?.id,
        });

        if (!result.confirmed) {
          return reply.code(400).send({
            error: {
              code: 'PAYMENT_FAILED',
              message: 'Payment verification failed or was declined',
              details: { failureCode: result.failureCode },
              requestId: req.id,
            },
          });
        }

        return reply.code(200).send({
          success: true,
          status: result.status,
          receiptNumber: result.receiptNumber,
          isSimulated: true,
          tickets: result.tickets,
        });
      } catch (err: any) {
        if (err instanceof PaymentError) {
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

  // 3. POST /api/v1/webhooks/payments (Raw body, HMAC-SHA256 constant-time compare, 5 min tolerance)
  fastify.post(
    '/webhooks/payments',
    {
      config: {
        auth: false,
        policy: 'public',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const signature = (req.headers['x-razorpay-signature'] ||
        req.headers['x-webhook-signature'] ||
        req.headers['stripe-signature']) as string;
      const timestampHeader = (req.headers['x-webhook-timestamp'] ||
        req.headers['x-razorpay-timestamp']) as string;

      const rawBody = (req as any).rawBody || Buffer.from(JSON.stringify(req.body || {}));

      try {
        const result = await processWebhook({
          rawBody,
          signature,
          timestampHeader,
        });

        return reply.code(200).send({
          received: true,
          result,
        });
      } catch (err: any) {
        if (err instanceof PaymentError) {
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

  // 4. POST /api/v1/bookings/:id/refunds (Attendee requests refund with idempotency key)
  fastify.post(
    '/bookings/:id/refunds',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id: bookingId } = req.params as { id: string };
      const parsed = refundRequestSchema.safeParse(req.body);

      if (!parsed.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid refund request body',
            details: parsed.error.format(),
            requestId: req.id,
          },
        });
      }

      try {
        const refund = await requestRefund({
          bookingId,
          userId: req.user!.id,
          reason: parsed.data.reason,
          idempotencyKey: parsed.data.idempotencyKey,
        });

        return reply.code(201).send({
          refund,
          message: 'Refund request submitted for organizer review.',
        });
      } catch (err: any) {
        if (err instanceof PaymentError) {
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

  // 5. POST /api/v1/refunds/:id/decision (Organizer manager/admin decision)
  fastify.post(
    '/refunds/:id/decision',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const { id: refundId } = req.params as { id: string };
      const parsed = refundDecisionSchema.safeParse(req.body);

      if (!parsed.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid decision payload. Must be APPROVED or REJECTED.',
            details: parsed.error.format(),
            requestId: req.id,
          },
        });
      }

      try {
        const result = await decideRefund({
          refundId,
          decision: parsed.data.decision,
          userId: req.user!.id,
        });

        return reply.code(200).send(result);
      } catch (err: any) {
        if (err instanceof PaymentError) {
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

  // 6. GET /api/v1/me/payments (List user payments)
  fastify.get(
    '/me/payments',
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
          `SELECT p.id, p.provider, p.provider_order_id, p.amount_paise, p.currency, p.status,
                  p.is_simulated, p.created_at, b.id as booking_id, e.title as event_title,
                  r.number as receipt_number
           FROM payments p
           JOIN bookings b ON p.booking_id = b.id
           JOIN events e ON b.event_id = e.id
           LEFT JOIN receipts r ON b.id = r.booking_id
           WHERE b.user_id = $1
           ORDER BY p.created_at DESC;`,
          [user.id]
        );

        return reply.code(200).send({
          payments: res.rows,
          mode: 'TEST MODE – simulated money',
        });
      } finally {
        client.release();
      }
    }
  );

  // 7. GET /api/v1/organizers/:id/sales (Organizer sales summary)
  fastify.get(
    '/organizers/:id/sales',
    {
      config: {
        auth: true,
        policy: 'analytics:view:owned',
        objectCheck: true,
      },
    },
    async (req, reply) => {
      const { id: organizerId } = req.params as { id: string };
      const summary = await getOrganizerSalesSummary(organizerId, req.user!.id, req.user!.globalRole);
      return reply.code(200).send(summary);
    }
  );

  // 8. GET /api/v1/organizers/:id/ledger (Organizer financial ledger entries)
  fastify.get(
    '/organizers/:id/ledger',
    {
      config: {
        auth: true,
        policy: 'analytics:view:owned',
        objectCheck: true,
      },
    },
    async (req, reply) => {
      const { id: organizerId } = req.params as { id: string };
      const summary = await getOrganizerSalesSummary(organizerId, req.user!.id, req.user!.globalRole);
      return reply.code(200).send({
        organizerId,
        entries: summary.ledgerEntries,
        isSimulated: true,
        mode: 'TEST MODE – simulated ledger',
      });
    }
  );

  // 9. POST /api/v1/simulator/payments (Simulator console controls, admin-only and disabled in production)
  fastify.post(
    '/simulator/payments',
    {
      config: {
        auth: true,
        policy: 'user:manage',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      if (process.env.NODE_ENV === 'production' && process.env.ENABLE_TEST_SIMULATOR !== 'true') {
        return reply.code(403).send({
          error: {
            code: 'FORBIDDEN',
            message: 'Simulator control endpoints are disabled in production.',
            details: {},
            requestId: req.id,
          },
        });
      }

      const { status } = (req.body as any) || {};
      if (['SUCCEEDED', 'FAILED', 'PENDING', 'AUTO'].includes(status)) {
        simulatorAdapter.forcePaymentStatus = status;
        return reply.code(200).send({
          simulatorStatus: simulatorAdapter.forcePaymentStatus,
          message: `Simulator adapter forcePaymentStatus set to ${status}`,
        });
      }
      return reply.code(400).send({
        error: {
          code: 'INVALID_STATUS',
          message: 'Status must be SUCCEEDED, FAILED, PENDING, or AUTO',
          details: {},
          requestId: req.id,
        },
      });
    }
  );
};
