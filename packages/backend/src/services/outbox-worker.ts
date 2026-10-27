import crypto from 'crypto';
import { pool } from '../db/index.js';
import { config } from '../config.js';
import { expireOffers } from './waitlist.js';
import { recordWorkerHeartbeat } from '../routes/monitoring.js';
import { generateOpaqueToken, hashStringToHex } from './auth.js';
import { getEmailAdapter } from './email/index.js';
import {
  buildVerifyEmailTemplate,
  buildResetPasswordTemplate,
  buildBookingConfirmedTemplate,
  buildPaymentReceiptTemplate,
  buildPaymentVerificationQueueTemplate,
  buildBookingCancelledTemplate,
  buildWaitlistOfferTemplate,
  buildTeamInviteTemplate,
  buildEventStatusChangeTemplate,
  buildOrganizerAlertTemplate,
  buildFeedbackReminderTemplate,
} from './email/templates/index.js';

let isRunning = false;
let isDispatching = false;
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
 * Simulates email provider dispatch (backwards compatibility helper for existing latency tests).
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
  await new Promise((resolve) => setTimeout(resolve, 15));
  const providerMsgId = `eml_${crypto.randomBytes(12).toString('hex')}`;
  return {
    providerMsgId,
    acceptedAt: new Date(),
  };
}

/**
 * Resolves a recipient user's email and display name by user ID.
 */
async function resolveUserContact(userId: string): Promise<{ email: string; displayName: string } | null> {
  const res = await pool.query(
    'SELECT email, display_name FROM users WHERE id = $1 LIMIT 1;',
    [userId]
  );
  if (res.rows.length === 0) return null;
  return {
    email: res.rows[0].email,
    displayName: res.rows[0].display_name || 'Eventora User',
  };
}

/**
 * Checks if a notification delivery already succeeded for this notification + channel.
 */
async function isNotificationDelivered(notificationId: string, channel = 'email'): Promise<boolean> {
  const res = await pool.query(
    `SELECT status FROM notification_deliveries 
     WHERE notification_id = $1 AND channel = $2 AND status IN ('ACCEPTED', 'DELIVERED')
     LIMIT 1;`,
    [notificationId, channel]
  );
  return res.rows.length > 0;
}

/**
 * Process a single outbox message outside any long-running DB transaction.
 * Explicit handlers for every event type with throwing default for unknown types.
 */
export async function processOutboxMessage(message: any): Promise<void> {
  const { id, event_type, topic, payload } = message;
  const msgTopic = topic || event_type;

  let data: any;
  if (typeof payload === 'string') {
    try {
      data = JSON.parse(payload);
    } catch {
      throw new Error('INVALID_JSON_PAYLOAD');
    }
  } else {
    data = payload;
  }

  const emailAdapter = getEmailAdapter();
  const appUrl = config.APP_URL;

  switch (msgTopic) {
    // ---------------------------------------------------------
    // 1. Auth: Verify Email
    // ---------------------------------------------------------
    case 'auth.verify_email': {
      const { userId, email, displayName } = data;
      const targetEmail = email || (await resolveUserContact(userId))?.email;
      if (!targetEmail) {
        throw new Error(`MISSING_EMAIL_FOR_AUTH_VERIFY (userId: ${userId})`);
      }

      // Generate raw token on delivery; save hash only into password_resets
      const rawToken = generateOpaqueToken();
      const tokenHash = hashStringToHex(rawToken);

      await pool.query(
        `INSERT INTO password_resets (user_id, token_hash, purpose, expires_at)
         VALUES ($1, $2, 'verify_email', NOW() + INTERVAL '24 hours')`,
        [userId, tokenHash]
      );

      const verificationUrl = `${appUrl}/verify-email?token=${rawToken}`;
      const template = buildVerifyEmailTemplate({
        to: targetEmail,
        name: displayName || 'Student',
        verificationUrl,
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      });

      await emailAdapter.send({
        ...template,
        idempotencyKey: `email_verify_${userId}_${id}`,
      });
      break;
    }

    // ---------------------------------------------------------
    // 2. Auth: Resend Verification
    // ---------------------------------------------------------
    case 'auth.resend_verification': {
      const { userId, email, displayName } = data;
      const targetEmail = email || (await resolveUserContact(userId))?.email;
      if (!targetEmail) {
        throw new Error(`MISSING_EMAIL_FOR_RESEND_VERIFY (userId: ${userId})`);
      }

      const rawToken = generateOpaqueToken();
      const tokenHash = hashStringToHex(rawToken);

      await pool.query(
        `INSERT INTO password_resets (user_id, token_hash, purpose, expires_at)
         VALUES ($1, $2, 'verify_email', NOW() + INTERVAL '24 hours')`,
        [userId, tokenHash]
      );

      const verificationUrl = `${appUrl}/verify-email?token=${rawToken}`;
      const template = buildVerifyEmailTemplate({
        to: targetEmail,
        name: displayName || 'Student',
        verificationUrl,
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      });

      await emailAdapter.send({
        ...template,
        idempotencyKey: `email_resend_verify_${userId}_${id}`,
      });
      break;
    }

    // ---------------------------------------------------------
    // 3. Auth: Reset Password
    // ---------------------------------------------------------
    case 'auth.reset_password': {
      const { userId, email, displayName } = data;
      const targetEmail = email || (await resolveUserContact(userId))?.email;
      if (!targetEmail) {
        throw new Error(`MISSING_EMAIL_FOR_PASSWORD_RESET (userId: ${userId})`);
      }

      const rawToken = generateOpaqueToken();
      const tokenHash = hashStringToHex(rawToken);

      await pool.query(
        `INSERT INTO password_resets (user_id, token_hash, purpose, expires_at)
         VALUES ($1, $2, 'reset_password', NOW() + INTERVAL '1 hour')`,
        [userId, tokenHash]
      );

      const resetUrl = `${appUrl}/reset-password?token=${rawToken}`;
      const template = buildResetPasswordTemplate({
        to: targetEmail,
        name: displayName || 'User',
        resetUrl,
        expiresAt: new Date(Date.now() + 3600 * 1000),
      });

      await emailAdapter.send({
        ...template,
        idempotencyKey: `email_reset_${userId}_${id}`,
      });
      break;
    }

    // ---------------------------------------------------------
    // 4. Booking: Confirmed
    // ---------------------------------------------------------
    case 'booking.confirmed': {
      const { bookingId, eventId, userId, attendeeEmail, attendeeName, ticketUrl, startsAt, venueName, pricePaise } = data;
      const user = userId ? await resolveUserContact(userId) : null;
      const targetEmail = attendeeEmail || user?.email;
      if (!targetEmail) {
        throw new Error(`MISSING_EMAIL_FOR_BOOKING_CONFIRMED (bookingId: ${bookingId})`);
      }

      // Fetch event title if not provided
      let eventTitle = data.eventTitle;
      let eventStartsAt = startsAt;
      let venue = venueName;
      if (!eventTitle && eventId) {
        const evRes = await pool.query('SELECT title, starts_at, venue FROM events WHERE id = $1;', [eventId]);
        if (evRes.rows.length > 0) {
          eventTitle = evRes.rows[0].title;
          eventStartsAt = eventStartsAt || evRes.rows[0].starts_at;
          venue = venue || evRes.rows[0].venue;
        }
      }

      const template = buildBookingConfirmedTemplate({
        to: targetEmail,
        name: attendeeName || user?.displayName || 'Attendee',
        eventTitle: eventTitle || 'Event',
        bookingRef: bookingId || 'REF-' + id,
        ticketUrl: ticketUrl || `${appUrl}/bookings/${bookingId}`,
        startsAt: eventStartsAt || new Date(),
        venueName: venue,
        pricePaise: pricePaise || 0,
      });

      await emailAdapter.send({
        ...template,
        idempotencyKey: `email_booking_confirmed_${bookingId || id}`,
      });
      break;
    }

    // ---------------------------------------------------------
    // 5. Payment: Receipt
    // ---------------------------------------------------------
    case 'payment.receipt': {
      const { paymentId, userId, eventTitle, amountPaise, utr, paidAt, invoiceUrl, email } = data;
      const user = userId ? await resolveUserContact(userId) : null;
      const targetEmail = email || user?.email;
      if (!targetEmail) {
        throw new Error(`MISSING_EMAIL_FOR_PAYMENT_RECEIPT (paymentId: ${paymentId})`);
      }

      const template = buildPaymentReceiptTemplate({
        to: targetEmail,
        name: user?.displayName || 'Attendee',
        paymentId: paymentId || String(id),
        utr,
        eventTitle: eventTitle || 'Event Ticket',
        amountPaise: amountPaise || 0,
        paidAt: paidAt || new Date(),
        invoiceUrl: invoiceUrl || `${appUrl}/payments/${paymentId}/invoice`,
      });

      await emailAdapter.send({
        ...template,
        idempotencyKey: `email_payment_receipt_${paymentId || id}`,
      });
      break;
    }

    // ---------------------------------------------------------
    // 6. Payment: Verification Queue
    // ---------------------------------------------------------
    case 'payment.verification_queue': {
      const { paymentId, userId, eventTitle, amountPaise, utr, queuePosition, email } = data;
      const user = userId ? await resolveUserContact(userId) : null;
      const targetEmail = email || user?.email;
      if (!targetEmail) {
        throw new Error(`MISSING_EMAIL_FOR_VERIFICATION_QUEUE (paymentId: ${paymentId})`);
      }

      const template = buildPaymentVerificationQueueTemplate({
        to: targetEmail,
        name: user?.displayName || 'Attendee',
        eventTitle: eventTitle || 'Event Registration',
        amountPaise: amountPaise || 0,
        utr,
        queuePosition,
        statusUrl: `${appUrl}/checkout/status?paymentId=${paymentId}`,
      });

      await emailAdapter.send({
        ...template,
        idempotencyKey: `email_verification_queue_${paymentId || id}`,
      });
      break;
    }

    // ---------------------------------------------------------
    // 7. Booking: Cancelled
    // ---------------------------------------------------------
    case 'booking.cancelled': {
      const { bookingId, userId, eventTitle, refundStatus, refundAmountPaise, cancelledAt, email } = data;
      const user = userId ? await resolveUserContact(userId) : null;
      const targetEmail = email || user?.email;
      if (!targetEmail) {
        throw new Error(`MISSING_EMAIL_FOR_BOOKING_CANCELLED (bookingId: ${bookingId})`);
      }

      const template = buildBookingCancelledTemplate({
        to: targetEmail,
        name: user?.displayName || 'Attendee',
        eventTitle: eventTitle || 'Event',
        bookingRef: bookingId || String(id),
        refundStatus,
        refundAmountPaise,
        cancelledAt: cancelledAt || new Date(),
      });

      await emailAdapter.send({
        ...template,
        idempotencyKey: `email_booking_cancelled_${bookingId || id}`,
      });
      break;
    }

    // ---------------------------------------------------------
    // 8. Waitlist: Offer Dispatched
    // ---------------------------------------------------------
    case 'waitlist.offer':
    case 'waitlist.offer_dispatched': {
      const { waitlistId, userId, eventTitle, claimUrl, offerExpiresAt, expiresAt, tierName, email } = data;
      const user = userId ? await resolveUserContact(userId) : null;
      const targetEmail = email || user?.email;
      if (!targetEmail) {
        throw new Error(`MISSING_EMAIL_FOR_WAITLIST_OFFER (waitlistId: ${waitlistId})`);
      }

      const template = buildWaitlistOfferTemplate({
        to: targetEmail,
        name: user?.displayName || 'Attendee',
        eventTitle: eventTitle || 'Event',
        claimUrl: claimUrl || `${appUrl}/waitlist/claim?id=${waitlistId}`,
        expiresAt: offerExpiresAt || expiresAt || new Date(Date.now() + 2 * 3600 * 1000),
        tierName,
      });

      await emailAdapter.send({
        ...template,
        idempotencyKey: `email_waitlist_offer_${waitlistId || id}`,
      });
      break;
    }

    // ---------------------------------------------------------
    // 9. Team: Invitation
    // ---------------------------------------------------------
    case 'team.invite':
    case 'team.invitation':
    case 'team.registered': {
      const { teamId, inviteeEmail, inviteeName, inviterName, teamName, eventTitle, joinUrl } = data;
      if (!inviteeEmail) {
        throw new Error(`MISSING_EMAIL_FOR_TEAM_INVITE (teamId: ${teamId})`);
      }

      const template = buildTeamInviteTemplate({
        to: inviteeEmail,
        inviteeName,
        inviterName: inviterName || 'A teammate',
        teamName: teamName || 'Team',
        eventTitle: eventTitle || 'Campus Competition',
        joinUrl: joinUrl || `${appUrl}/teams/join?id=${teamId}`,
      });

      await emailAdapter.send({
        ...template,
        idempotencyKey: `email_team_invite_${teamId || id}_${inviteeEmail}`,
      });
      break;
    }

    // ---------------------------------------------------------
    // 10. Event Alert & Notifications
    // ---------------------------------------------------------
    case 'event.alert': {
      const { alertId, eventId, eventTitle, kind, message: alertBody, severity, recipients, tTrigger } = data;
      const tDequeued = new Date();
      const tEnqueued = message.created_at ? new Date(message.created_at) : tDequeued;
      const triggerDate = tTrigger ? new Date(tTrigger) : tEnqueued;

      if (Array.isArray(recipients) && recipients.length > 0) {
        for (const userId of recipients) {
          // 1. Ensure notification row exists
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

            // In-app delivery
            await pool.query(
              `INSERT INTO notification_deliveries (notification_id, channel, status, provider, attempts, accepted_at, delivered_at)
               VALUES ($1, 'inapp', 'DELIVERED', 'inapp_store', 1, NOW(), NOW())
               ON CONFLICT (notification_id, channel) DO NOTHING;`,
              [notifId]
            );
          }

          // Per-recipient idempotency: check if email already ACCEPTED
          const alreadyDelivered = await isNotificationDelivered(notifId, 'email');
          if (alreadyDelivered) {
            continue;
          }

          // Email delivery row
          const delivRes = await pool.query(
            `INSERT INTO notification_deliveries (notification_id, channel, status, provider, attempts)
             VALUES ($1, 'email', 'QUEUED', 'mock_ses', 0)
             ON CONFLICT (notification_id, channel) DO UPDATE SET attempts = notification_deliveries.attempts
             RETURNING id, status, attempts;`,
            [notifId]
          );
          const delivery = delivRes.rows[0];

          // Dispatch to email adapter (or fallback simulator if requested)
          const userContact = await resolveUserContact(userId);
          const recipientEmail = userContact?.email;

          try {
            let providerMsgId: string;
            let acceptedAt: Date;

            // Only honor failure simulation in test environment; disabled in production/staging
            if (process.env.NODE_ENV === 'test' && data.simulateProviderFailure === true) {
              const simRes = await simulateEmailProviderSend({
                recipientId: userId,
                subject: `Important Alert for ${eventTitle}`,
                body: alertBody,
                failSimulated: true,
              });
              providerMsgId = simRes.providerMsgId;
              acceptedAt = simRes.acceptedAt;
            } else if (recipientEmail) {
              const template = buildOrganizerAlertTemplate({
                to: recipientEmail,
                name: userContact?.displayName || 'Attendee',
                eventTitle: eventTitle || 'Campus Event',
                alertTitle: `[${String(kind).toUpperCase()}] ${eventTitle}`,
                message: alertBody,
                severity: severity || 'info',
                alertUrl: `${appUrl}/events/${eventId}`,
              });

              const sendRes = await emailAdapter.send({
                ...template,
                idempotencyKey: `alert_${notifId}_email`,
              });
              providerMsgId = sendRes.id;
              acceptedAt = new Date();
            } else {
              providerMsgId = `mock_${crypto.randomUUID()}`;
              acceptedAt = new Date();
            }

            // Update to ACCEPTED
            await pool.query(
              `UPDATE notification_deliveries
               SET status = 'ACCEPTED', provider_msg_id = $1, accepted_at = $2, attempts = attempts + 1
               WHERE id = $3;`,
              [providerMsgId, acceptedAt, delivery.id]
            );

            // Record latency metrics
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

    // ---------------------------------------------------------
    // 11. Event Status Change (Changed, Postponed, Cancelled)
    // ---------------------------------------------------------
    case 'event.changed':
    case 'event.postponed':
    case 'event.cancelled': {
      const { eventId, title, changeType, summary, newStartsAt, newVenueName, recipientEmail, attendeeName } = data;
      const targetEmail = recipientEmail || data.email;
      if (!targetEmail) {
        // Broadcast event notification with no direct recipient is logged
        break;
      }

      const template = buildEventStatusChangeTemplate({
        to: targetEmail,
        name: attendeeName || 'Attendee',
        eventTitle: title || 'Campus Event',
        changeType: (changeType || 'changed') as 'changed' | 'postponed' | 'cancelled',
        summary: summary || 'The event schedule or venue has been updated by the organizer.',
        newStartsAt,
        newVenueName,
        detailsUrl: `${appUrl}/events/${eventId}`,
      });

      await emailAdapter.send({
        ...template,
        idempotencyKey: `email_event_change_${eventId}_${targetEmail}_${id}`,
      });
      break;
    }

    // ---------------------------------------------------------
    // 12. Feedback: Reminder
    // ---------------------------------------------------------
    case 'feedback.reminder': {
      const { eventId, userId, email, name, eventTitle } = data;
      const user = userId ? await resolveUserContact(userId) : null;
      const targetEmail = email || user?.email;
      if (!targetEmail) {
        throw new Error(`MISSING_EMAIL_FOR_FEEDBACK_REMINDER (userId: ${userId})`);
      }

      const template = buildFeedbackReminderTemplate({
        to: targetEmail,
        name: name || user?.displayName || 'Attendee',
        eventTitle: eventTitle || 'Event',
        feedbackUrl: `${appUrl}/events/${eventId}/feedback`,
        unsubscribeUrl: `${appUrl}/settings/notifications`,
      });

      await emailAdapter.send({
        ...template,
        idempotencyKey: `email_feedback_${eventId}_${targetEmail}`,
      });
      break;
    }

    // ---------------------------------------------------------
    // 13. Organizer Alert
    // ---------------------------------------------------------
    case 'organizer.alert': {
      const { organizerId, eventTitle, alertTitle, message: alertMessage, severity, email } = data;
      let targetEmail = email;
      if (!targetEmail && organizerId) {
        const orgRes = await pool.query(
          `SELECT u.email FROM organizer_members om
           JOIN users u ON om.user_id = u.id
           WHERE om.organizer_id = $1 AND om.role = 'owner'
           LIMIT 1;`,
          [organizerId]
        );
        targetEmail = orgRes.rows[0]?.email;
      }

      if (targetEmail) {
        const template = buildOrganizerAlertTemplate({
          to: targetEmail,
          name: 'Organizer',
          eventTitle: eventTitle || 'Organized Event',
          alertTitle: alertTitle || 'Important Notice',
          message: alertMessage,
          severity: severity || 'info',
        });

        await emailAdapter.send({
          ...template,
          idempotencyKey: `email_org_alert_${organizerId || id}_${id}`,
        });
      }
      break;
    }

    // ---------------------------------------------------------
    // Throwing default: no silent DONE for unhandled event types!
    // ---------------------------------------------------------
    default:
      throw new Error(`UNKNOWN_EVENT_TYPE: ${msgTopic}`);
  }
}

/**
 * Dispatches a batch of pending or stale-processing outbox messages.
 * Uses a short claim transaction with SKIP LOCKED, then processes each message outside the transaction.
 */
export async function dispatchPendingOutboxMessages(batchSize = 50) {
  if (isDispatching) {
    return { processedCount: 0, failedCount: 0, totalBatch: 0, skipped: true };
  }

  isDispatching = true;
  let claimedRows: any[] = [];
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Short claim transaction:
    // Claim pending rows OR stale PROCESSING rows whose lock has expired
    const claimRes = await client.query(
      `SELECT id, event_type, topic, aggregate_id, payload, attempts, retries, dedupe_key, created_at
       FROM outbox
       WHERE ((status IN ('pending', 'PENDING') AND (next_attempt_at IS NULL OR next_attempt_at <= NOW()))
          OR (status = 'PROCESSING' AND locked_until IS NOT NULL AND locked_until < NOW()))
       ORDER BY id ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED;`,
      [batchSize]
    );

    claimedRows = claimRes.rows;

    if (claimedRows.length > 0) {
      const ids = claimedRows.map((r) => r.id);
      await client.query(
        `UPDATE outbox
         SET status = 'PROCESSING', locked_until = NOW() + INTERVAL '2 minutes'
         WHERE id = ANY($1);`,
        [ids]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // 2. Process all claimed messages OUTSIDE any DB transaction
  let processedCount = 0;
  let failedCount = 0;

  for (const msg of claimedRows) {
    try {
      await processOutboxMessage(msg);

      // Successfully processed -> mark DONE
      await pool.query(
        `UPDATE outbox
         SET status = 'DONE', processed_at = NOW(), locked_until = NULL, error = NULL
         WHERE id = $1;`,
        [msg.id]
      );
      processedCount++;
    } catch (err: any) {
      failedCount++;
      const currentAttempts = (msg.attempts || msg.retries || 0) + 1;
      const errorMessage = err?.message ? String(err.message).slice(0, 1000) : 'UNKNOWN_ERROR';

      if (currentAttempts >= 8 || errorMessage === 'INVALID_JSON_PAYLOAD') {
        // Dead letter cap reached -> mark DEAD
        await pool.query(
          `UPDATE outbox
           SET status = 'DEAD', attempts = $1::smallint, retries = $1::integer,
               locked_until = NULL, error = $2
           WHERE id = $3;`,
          [currentAttempts, errorMessage, msg.id]
        );
      } else {
        // Bounded exponential backoff: min(2^n s, 15 min) + jitter
        const delaySec = Math.min(Math.pow(2, currentAttempts), 900) + Math.floor(Math.random() * 2);
        await pool.query(
          `UPDATE outbox
           SET status = 'PENDING', attempts = $1::smallint, retries = $1::integer,
               next_attempt_at = NOW() + ($2 || ' seconds')::interval,
               locked_until = NULL, error = $3
           WHERE id = $4;`,
          [currentAttempts, delaySec, errorMessage, msg.id]
        );
      }
    }
  }

  isDispatching = false;
  return { processedCount, failedCount, totalBatch: claimedRows.length };
}

/**
 * Initializes PostgreSQL LISTEN/NOTIFY listener on a dedicated client connection.
 */
async function setupOutboxListener() {
  try {
    listenerClient = await pool.connect();
    await listenerClient.query('LISTEN outbox_channel');

    listenerClient.on('notification', async () => {
      try {
        await dispatchPendingOutboxMessages(50);
      } catch {
        // Handled in background loop
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
    // If listener setup fails (e.g. Supabase pooler), interval fallback handles it
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
      recordWorkerHeartbeat();
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
  isDispatching = false;
}
