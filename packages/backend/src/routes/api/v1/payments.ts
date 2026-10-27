import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { pool } from '../../../db/index.js';
import {
  initiateCheckout,
  verifyPayment,
  processWebhook,
  processYouPiWebhook,
  recordManualRefund,
  resolveVerificationQueue,
  getYouPiThroughputStatus,
  requestRefund,
  decideRefund,
  getOrganizerSalesSummary,
  PaymentError,
} from '../../../services/payment.js';
import { simulatorAdapter } from '../../../services/payment-adapter.js';
import { importBankStatementCsv } from '../../../services/reconciliation.js';

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

const recordManualRefundSchema = z.object({
  refundUtr: z.string().regex(/^\d{12}$/, 'Refund UTR must be exactly 12 digits'),
  notes: z.string().max(1000).optional(),
});

const resolveVerificationSchema = z.object({
  resolution: z.enum(['CONFIRM', 'REJECT']),
  notes: z.string().max(1000).optional(),
  adminOverride: z.boolean().optional(),
});

const importReconciliationCsvSchema = z.object({
  csvContent: z.string().min(1),
  filename: z.string().optional(),
});

export async function handleYouPiWebhookRoute(req: FastifyRequest, reply: FastifyReply) {
  const signatureV2 = (req.headers['x-gateway-signature-v2'] || req.headers['x-youpi-signature-v2']) as string | undefined;
  const signatureV1 = (req.headers['x-gateway-signature'] || req.headers['x-youpi-signature']) as string | undefined;
  const timestamp = (req.headers['x-gateway-timestamp'] || req.headers['x-youpi-timestamp']) as string | undefined;
  const deliveryId = (req.headers['x-gateway-delivery-id'] || req.headers['x-youpi-delivery-id']) as string | undefined;
  const gatewayEvent = (req.headers['x-gateway-event'] || req.headers['x-youpi-event']) as string | undefined;

  const rawBody = (req as any).rawBody || (Buffer.isBuffer(req.body) ? req.body : undefined);

  if (!rawBody || !Buffer.isBuffer(rawBody)) {
    return reply.code(400).send({
      error: {
        code: 'MISSING_RAW_BODY',
        message: 'Raw body buffer is required for webhook signature verification',
        details: {},
        requestId: req.id,
      },
    });
  }

  if (!deliveryId) {
    return reply.code(400).send({
      error: {
        code: 'MISSING_DELIVERY_ID',
        message: 'X-Gateway-Delivery-Id header is required for deduplication',
        details: {},
        requestId: req.id,
      },
    });
  }

  try {
    const result = await processYouPiWebhook({
      rawBody,
      signatureV2,
      signatureV1,
      timestamp,
      deliveryId,
      gatewayEvent,
    });

    return reply.code(200).send({
      success: true,
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
    // Database or unexpected error: return 500 so YouPI retries
    return reply.code(500).send({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Internal error processing payment webhook. Gateway should retry.',
        details: {},
        requestId: req.id,
      },
    });
  }
}

export const paymentRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // 1. POST /api/v1/bookings/:id/checkout (Owner creates hold + payment order)
  fastify.post(
    '/bookings/:id/checkout',
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

  // 10. POST /api/v1/webhooks/payments/youpi (YouPI-PG HMAC-SHA256 V2/V1 verified webhook)
  fastify.post(
    '/webhooks/payments/youpi',
    {
      config: {
        auth: false,
        policy: 'public',
        objectCheck: false,
      },
    },
    handleYouPiWebhookRoute
  );

  // 11. GET /api/v1/payments/throughput (Live queue length and daily limit counter)
  fastify.get(
    '/payments/throughput',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const status = await getYouPiThroughputStatus();
      return reply.code(200).send(status);
    }
  );

  // 12. POST /api/v1/organizer/refunds/:id/record-manual (Organizer records manual peer-to-peer bank refund UTR)
  fastify.post(
    '/organizer/refunds/:id/record-manual',
    {
      config: {
        auth: true,
        policy: 'event:manage:owned',
        objectCheck: async (req) => {
          const { id: refundId } = req.params as { id: string };
          const user = req.user!;
          if (user.globalRole === 'admin') return true;
          const client = await pool.connect();
          try {
            const res = await client.query(
              `SELECT e.organizer_id
               FROM refunds r
               JOIN bookings b ON r.booking_id = b.id
               JOIN events e ON b.event_id = e.id
               WHERE r.id = $1;`,
              [refundId]
            );
            if (res.rows.length === 0) return true;
            const orgRes = await client.query(
              `SELECT 1 FROM organizer_members WHERE organizer_id = $1 AND user_id = $2 AND status = 'active';`,
              [res.rows[0].organizer_id, user.id]
            );
            return orgRes.rows.length > 0;
          } finally {
            client.release();
          }
        },
      },
    },
    async (req, reply) => {
      const { id: refundId } = req.params as { id: string };
      const parsed = recordManualRefundSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid manual refund payload: 12-digit UTR required',
            details: parsed.error.format(),
            requestId: req.id,
          },
        });
      }

      try {
        const result = await recordManualRefund({
          refundId,
          organizerUserId: req.user!.id,
          refundUtr: parsed.data.refundUtr,
          notes: parsed.data.notes,
        });

        return reply.code(200).send({
          success: true,
          refund: result,
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

  // 13. GET /api/v1/organizer/payments/verification-queue (List flagged payments requiring review)
  fastify.get(
    '/organizer/payments/verification-queue',
    {
      config: {
        auth: true,
        policy: 'event:manage:owned',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const user = req.user!;
      const client = await pool.connect();
      try {
        let query: string;
        let params: any[];

        if (user.globalRole === 'admin') {
          query = `
            SELECT p.id, p.booking_id, p.provider, p.provider_order_id, p.amount_paise,
                   p.currency, p.status, p.utr, p.verification_queue_reason,
                   p.raw_webhook_payload, p.created_at, p.updated_at,
                   b.event_id, e.title as event_title, e.organizer_id,
                   u.email as attendee_email, u.name as attendee_name
            FROM payments p
            JOIN bookings b ON p.booking_id = b.id
            JOIN events e ON b.event_id = e.id
            JOIN users u ON b.user_id = u.id
            WHERE p.status = 'VERIFICATION_QUEUE'
            ORDER BY p.updated_at DESC;
          `;
          params = [];
        } else {
          query = `
            SELECT p.id, p.booking_id, p.provider, p.provider_order_id, p.amount_paise,
                   p.currency, p.status, p.utr, p.verification_queue_reason,
                   p.raw_webhook_payload, p.created_at, p.updated_at,
                   b.event_id, e.title as event_title, e.organizer_id,
                   u.email as attendee_email, u.name as attendee_name
            FROM payments p
            JOIN bookings b ON p.booking_id = b.id
            JOIN events e ON b.event_id = e.id
            JOIN users u ON b.user_id = u.id
            JOIN organizer_members om ON e.organizer_id = om.organizer_id
            WHERE p.status = 'VERIFICATION_QUEUE' AND om.user_id = $1 AND om.status = 'active'
            ORDER BY p.updated_at DESC;
          `;
          params = [user.id];
        }

        const res = await client.query(query, params);
        return reply.code(200).send({
          items: res.rows,
          count: res.rows.length,
        });
      } finally {
        client.release();
      }
    }
  );

  // 14. POST /api/v1/organizer/payments/:id/resolve-verification (Manual confirm/reject for flagged payments)
  fastify.post(
    '/organizer/payments/:id/resolve-verification',
    {
      config: {
        auth: true,
        policy: 'event:manage:owned',
        objectCheck: async (req) => {
          const { id: paymentId } = req.params as { id: string };
          const user = req.user!;
          if (user.globalRole === 'admin') return true;
          const client = await pool.connect();
          try {
            const res = await client.query(
              `SELECT e.organizer_id
               FROM payments p
               JOIN bookings b ON p.booking_id = b.id
               JOIN events e ON b.event_id = e.id
               WHERE p.id = $1;`,
              [paymentId]
            );
            if (res.rows.length === 0) return true;
            const orgRes = await client.query(
              `SELECT 1 FROM organizer_members WHERE organizer_id = $1 AND user_id = $2 AND status = 'active';`,
              [res.rows[0].organizer_id, user.id]
            );
            return orgRes.rows.length > 0;
          } finally {
            client.release();
          }
        },
      },
    },
    async (req, reply) => {
      const { id: paymentId } = req.params as { id: string };
      const parsed = resolveVerificationSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid verification resolution payload',
            details: parsed.error.format(),
            requestId: req.id,
          },
        });
      }

      try {
        const result = await resolveVerificationQueue({
          paymentId,
          adminUserId: req.user!.id,
          resolution: parsed.data.resolution,
          notes: parsed.data.notes,
          adminOverride: parsed.data.adminOverride,
        });

        return reply.code(200).send({
          success: true,
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

  // 15. POST /api/v1/admin/reconciliation/import-csv (Import bank statement CSV for payment reconciliation)
  fastify.post(
    '/admin/reconciliation/import-csv',
    {
      config: {
        auth: true,
        policy: 'user:manage',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const parsed = importReconciliationCsvSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid CSV import payload',
            details: parsed.error.format(),
            requestId: req.id,
          },
        });
      }

      try {
        const record = await importBankStatementCsv({
          csvContent: parsed.data.csvContent,
          filename: parsed.data.filename || 'bank_statement.csv',
          adminUserId: req.user!.id,
        });

        return reply.code(200).send({
          success: true,
          record,
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

  // 16. GET /api/v1/admin/reconciliation/reports (View recent reconciliation audit reports)
  fastify.get(
    '/admin/reconciliation/reports',
    {
      config: {
        auth: true,
        policy: 'user:manage',
        objectCheck: false,
      },
    },
    async (req, reply) => {
      const client = await pool.connect();
      try {
        const res = await client.query(
          `SELECT r.id, r.source, r.filename, r.total_records, r.matched_records,
                  r.unmatched_records, r.discrepant_records, r.created_at,
                  u.name as imported_by_name
           FROM reconciliation_records r
           LEFT JOIN users u ON r.imported_by = u.id
           ORDER BY r.created_at DESC
           LIMIT 50;`
        );

        return reply.code(200).send({
          reports: res.rows,
        });
      } finally {
        client.release();
      }
    }
  );
};
