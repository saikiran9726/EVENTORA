import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { Webhook } from 'svix';
export { Webhook };
import { pool } from '../../db/index.js';
import { config } from '../../config.js';
import { recordSuppression } from '../../services/email/suppression.js';

export async function handleResendWebhook(req: FastifyRequest, reply: FastifyReply) {
  const secret = config.RESEND_WEBHOOK_SECRET;
  const rawBody = (req as any).rawBody || Buffer.from(JSON.stringify(req.body));
  const headers = req.headers;

  const svixId = (headers['svix-id'] as string) || '';
  const svixTimestamp = (headers['svix-timestamp'] as string) || '';
  const svixSignature = (headers['svix-signature'] as string) || '';

  let event: any;

  if (secret) {
    if (!svixId || !svixTimestamp || !svixSignature) {
      return reply.code(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Missing Svix webhook signature headers',
          requestId: req.id,
        },
      });
    }

    try {
      const wh = new Webhook(secret);
      const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
      wh.verify(bodyStr, {
        'svix-id': svixId,
        'svix-timestamp': svixTimestamp,
        'svix-signature': svixSignature,
      });
      event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch {
      return reply.code(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid Resend webhook signature',
          requestId: req.id,
        },
      });
    }
  } else {
    // If no secret configured (local dev/test), accept request body directly
    event = req.body;
  }

  const { type, data } = event || {};
  const emailId = data?.email_id || data?.id;
  const recipients: string[] = Array.isArray(data?.to) ? data.to : data?.to ? [data.to] : [];

  switch (type) {
    case 'email.delivered': {
      if (emailId) {
        await pool.query(
          `UPDATE notification_deliveries
           SET status = 'DELIVERED', delivered_at = NOW()
           WHERE provider_msg_id = $1;`,
          [emailId]
        );
      }
      break;
    }

    case 'email.bounced': {
      const bounceType = data?.bounce?.type || 'Permanent';
      const isHard = bounceType === 'Permanent' || bounceType === 'hard';

      if (isHard) {
        for (const email of recipients) {
          if (email) {
            await recordSuppression({
              email,
              reason: 'hard_bounce',
              source: 'resend',
              details: data,
            });
          }
        }
      }

      if (emailId) {
        await pool.query(
          `UPDATE notification_deliveries
           SET status = 'FAILED', error_code = $1
           WHERE provider_msg_id = $2;`,
          [data?.bounce?.message || 'BOUNCED', emailId]
        );
      }
      break;
    }

    case 'email.complained': {
      for (const email of recipients) {
        if (email) {
          await recordSuppression({
            email,
            reason: 'complaint',
            source: 'resend',
            details: data,
          });
        }
      }

      if (emailId) {
        await pool.query(
          `UPDATE notification_deliveries
           SET status = 'FAILED', error_code = 'SPAM_COMPLAINT'
           WHERE provider_msg_id = $1;`,
          [emailId]
        );
      }
      break;
    }

    default:
      // Other events (e.g. email.sent, email.opened) are ignored safely
      break;
  }

  return reply.code(200).send({ received: true });
}

export const resendWebhookRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.post(
    '/webhooks/resend',
    {
      config: {
        auth: false,
        policy: 'public',
        objectCheck: false,
      },
    },
    handleResendWebhook
  );
};
