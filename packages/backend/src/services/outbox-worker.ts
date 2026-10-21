import crypto from 'crypto';
import { pool } from '../db/index.js';
import { expireOffers } from './waitlist.js';

let isRunning = false;
let workerInterval: NodeJS.Timeout | null = null;
let sweeperInterval: NodeJS.Timeout | null = null;
let listenerClient: any = null;

/**
 * Triggers an asynchronous wake-up notification over PostgreSQL LISTEN/NOTIFY channel.
 */
export async function notifyOutbox(topic = 'general') {
  try {
    await pool.query(`SELECT pg_notify('outbox_channel', $1);`, [topic]);
  } catch {
    // Non-fatal if notification fails; interval polling will catch up
  }
}

/**
 * Simulates email provider dispatch (e.g. Postmark / AWS SES API).
 * Returns provider message ID or throws on simulated error.
 */
export async function simulateEmailProviderSend(params: {
  recipientId: string;
  subject: string;
  body: string;
  failSimulated?: boolean;
}): Promise<{ providerMsgId: string; acceptedAt: Date }> {
  if (params.failSimulated) {
    throw new Error('PROVIDER_500_SIMULATED_OUTAGE');
  }
  // Simulate network flight time (10-30ms)
  await new Promise((resolve) => setTimeout(resolve, 15));
  const providerMsgId = `eml_${crypto.randomBytes(12).toString('hex')}`;
  return {
    providerMsgId,
    acceptedAt: new Date(),
  };
}

/**
 * Process a single outbox row.
 */
export async function processOutboxMessage(message: any): Promise<boolean> {
  const { id, event_type, topic, payload } = message;
  const msgTopic = topic || event_type;
  const data = typeof payload === 'string' ? JSON.parse(payload) : payload;

  try {
    switch (msgTopic) {
      case 'event.alert': {
        const { alertId, eventId, eventTitle, kind, message: alertBody, severity, recipients, tTrigger } = data;
        const tDequeued = new Date();
        const tEnqueued = message.created_at ? new Date(message.created_at) : tDequeued;
        const triggerDate = tTrigger ? new Date(tTrigger) : tEnqueued;

        if (Array.isArray(recipients) && recipients.length > 0) {
          for (const userId of recipients) {
            // 1. Ensure notification row exists (especially for non-urgent which weren't written in tx)
            let notifId: string;
            const existingNotif = await pool.query(
              `SELECT id FROM notifications WHERE user_id = $1 AND event_id = $2 AND payload->>'alertId' = $3;`,
              [userId, eventId, alertId]
            );

            if (existingNotif.rows.length > 0) {
              notifId = existingNotif.rows[0].id;
            } else {
              const alertTitle = `[Alert: ${String(kind).toUpperCase()}] ${eventTitle}`;
              const insertRes = await pool.query(
                `INSERT INTO notifications (user_id, type, event_id, title, body, severity, payload)
                 VALUES ($1, 'event.alert', $2, $3, $4, $5, $6)
                 RETURNING id;`,
                [userId, eventId, alertTitle, alertBody, severity, JSON.stringify({ alertId, kind, eventId })]
              );
              notifId = insertRes.rows[0].id;

              // Deliver in-app
              await pool.query(
                `INSERT INTO notification_deliveries (notification_id, channel, status, provider, attempts, accepted_at, delivered_at)
                 VALUES ($1, 'inapp', 'DELIVERED', 'inapp_store', 1, NOW(), NOW())
                 ON CONFLICT (notification_id, channel) DO NOTHING;`,
                [notifId]
              );
            }

            // 2. Email Channel: Initialized as QUEUED
            const delivRes = await pool.query(
              `INSERT INTO notification_deliveries (notification_id, channel, status, provider, attempts)
               VALUES ($1, 'email', 'QUEUED', 'mock_ses', 0)
               ON CONFLICT (notification_id, channel) DO UPDATE SET attempts = notification_deliveries.attempts
               RETURNING id, status, attempts;`,
              [notifId]
            );
            const delivery = delivRes.rows[0];

            // 3. Dispatch to Provider (Test if simulated failure requested in payload)
            const shouldSimulateFailure = data.simulateProviderFailure === true;
            try {
              const { providerMsgId, acceptedAt } = await simulateEmailProviderSend({
                recipientId: userId,
                subject: `Important Alert for ${eventTitle}`,
                body: alertBody,
                failSimulated: shouldSimulateFailure,
              });

              // Status moves QUEUED -> ACCEPTED (never DELIVERED without webhook!)
              await pool.query(
                `UPDATE notification_deliveries
                 SET status = 'ACCEPTED', provider_msg_id = $1, accepted_at = $2, attempts = attempts + 1
                 WHERE id = $3;`,
                [providerMsgId, acceptedAt, delivery.id]
              );

              // 4. Record Latency Metrics
              await pool.query(
                `INSERT INTO notification_metrics (notification_id, t_trigger, t_enqueued, t_dequeued, t_provider_accepted)
                 VALUES ($1, $2, $3, $4, $5);`,
                [notifId, triggerDate, tEnqueued, tDequeued, acceptedAt]
              );
            } catch (err: any) {
              await pool.query(
                `UPDATE notification_deliveries
                 SET status = 'FAILED', attempts = attempts + 1, error_code = $1
                 WHERE id = $2;`,
                [err.message || 'PROVIDER_REJECTED', delivery.id]
              );
              throw err;
            }
          }
        }
        break;
      }

      case 'booking.confirmed':
      case 'waitlist.offer_dispatched':
      case 'booking.cancelled':
      case 'team.registered':
      case 'team.invitation':
      default:
        break;
    }
    return true;
  } catch (err) {
    console.error('[processOutboxMessage error]', err);
    return false;
  }
}

/**
 * Dispatches a batch of pending outbox messages with bounded exponential backoff & dead-lettering.
 */
export async function dispatchPendingOutboxMessages(batchSize = 50) {
  const client = await pool.connect();
  let processedCount = 0;
  let failedCount = 0;

  try {
    await client.query('BEGIN');

    // Fetch batch with SKIP LOCKED for safe concurrent processing
    const res = await client.query(
      `SELECT id, event_type, topic, payload, retries, attempts, dedupe_key, created_at
       FROM outbox
       WHERE (status IN ('pending', 'PENDING') AND (next_attempt_at IS NULL OR next_attempt_at <= NOW()))
       ORDER BY id ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED;`,
      [batchSize]
    );

    for (const msg of res.rows) {
      // Mark PROCESSING
      await client.query(
        `UPDATE outbox SET status = 'PROCESSING' WHERE id = $1;`,
        [msg.id]
      );

      const success = await processOutboxMessage(msg);
      if (success) {
        await client.query(
          `UPDATE outbox
           SET status = 'DONE', processed_at = NOW()
           WHERE id = $1;`,
          [msg.id]
        );
        processedCount++;
      } else {
        const currentAttempts = (msg.attempts || msg.retries || 0) + 1;
        failedCount++;

        if (currentAttempts >= 8) {
          // Dead letter cap reached -> mark DEAD
          await client.query(
            `UPDATE outbox
             SET status = 'DEAD', attempts = $1::smallint, retries = $1::integer
             WHERE id = $2;`,
            [currentAttempts, msg.id]
          );
        } else {
          // Bounded exponential delay: min(2^n s, 15 min) + jitter
          const delaySec = Math.min(Math.pow(2, currentAttempts), 900) + Math.floor(Math.random() * 2);
          await client.query(
            `UPDATE outbox
             SET status = 'PENDING', attempts = $1::smallint, retries = $1::integer,
                 next_attempt_at = NOW() + ($2 || ' seconds')::interval
             WHERE id = $3;`,
            [currentAttempts, delaySec, msg.id]
          );
        }
      }
    }

    await client.query('COMMIT');
    return { processedCount, failedCount, totalBatch: res.rows.length };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Initializes PostgreSQL LISTEN/NOTIFY listener on a dedicated client connection.
 */
async function setupOutboxListener() {
  try {
    listenerClient = await pool.connect();
    await listenerClient.query('LISTEN outbox_channel');

    listenerClient.on('notification', async () => {
      // Immediate event-driven wakeup!
      try {
        await dispatchPendingOutboxMessages(50);
      } catch {
        // Handled in dispatcher
      }
    });

    listenerClient.on('error', () => {
      try {
        listenerClient.release(true);
      } catch {
        // ignore
      }
      listenerClient = null;
    });
  } catch {
    // If listener setup fails, interval fallback handles it
  }
}

/**
 * Starts the Outbox background dispatcher with LISTEN/NOTIFY and fallback interval polling.
 */
export function startOutboxWorker(intervalMs = 3000) {
  if (isRunning) return;
  isRunning = true;

  // Setup Postgres LISTEN/NOTIFY listener
  setupOutboxListener();

  // Interval polling fallback (also handles retries that have reached next_attempt_at)
  workerInterval = setInterval(async () => {
    try {
      await dispatchPendingOutboxMessages();
    } catch {
      // ignore in background loop
    }
  }, intervalMs);

  // 60-second waitlist offer expiry sweeper
  sweeperInterval = setInterval(async () => {
    try {
      await expireOffers();
    } catch {
      // ignore
    }
  }, 60000);
}

export function stopOutboxWorker() {
  if (workerInterval) clearInterval(workerInterval);
  if (sweeperInterval) clearInterval(sweeperInterval);
  if (listenerClient) {
    try {
      listenerClient.release(true);
    } catch {
      // ignore
    }
    listenerClient = null;
  }
  workerInterval = null;
  sweeperInterval = null;
  isRunning = false;
}
