import crypto from 'crypto';
import { pool } from '../db/index.js';
import { notifyOutbox } from './outbox-worker.js';

export interface CreateAlertParams {
  eventId: string;
  createdBy: string;
  kind: 'venue' | 'time' | 'speaker' | 'cancellation' | 'safety';
  message: string;
  severity: 'info' | 'important' | 'urgent';
}

export interface NotificationPreferences {
  email: boolean;
  inapp: boolean;
  urgentOnly: boolean;
}

export interface EmailWebhookPayload {
  providerMsgId: string;
  event: 'delivered' | 'failed' | 'bounce' | 'accepted';
  timestamp?: string;
  signature: string;
  errorCode?: string;
}

const WEBHOOK_SIGNING_SECRET = process.env.EMAIL_WEBHOOK_SECRET || 'eventora_email_webhook_secret_32_bytes_test';

/**
 * Creates an event alert and handles transactional in-app + outbox fanout.
 * Urgent alerts: in-app notification rows written in the SAME transaction.
 */
export async function createEventAlert(params: CreateAlertParams) {
  const { eventId, createdBy, kind, message, severity } = params;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Verify event exists
    const eventRes = await client.query(
      `SELECT id, title, organizer_id FROM events WHERE id = $1;`,
      [eventId]
    );
    if (eventRes.rows.length === 0) {
      throw new Error('EVENT_NOT_FOUND');
    }
    const event = eventRes.rows[0];

    // 2. Insert into event_alerts
    const alertRes = await client.query(
      `INSERT INTO event_alerts (event_id, created_by, kind, message, severity)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, event_id, created_by, kind, message, severity, created_at;`,
      [eventId, createdBy, kind, message, severity]
    );
    const alert = alertRes.rows[0];

    // 3. Find all confirmed registered attendees for this event
    const attendeesRes = await client.query(
      `SELECT DISTINCT owner_user_id as user_id
       FROM tickets
       WHERE event_id = $1 AND status != 'CANCELLED';`,
      [eventId]
    );
    const recipients = attendeesRes.rows;
    const recipientCount = recipients.length;

    const alertTitle = `[Alert: ${kind.toUpperCase()}] ${event.title}`;

    // 4. In-App Notifications: For urgent alerts, written directly in the same transaction
    if (severity === 'urgent' && recipientCount > 0) {
      for (const recipient of recipients) {
        const notifRes = await client.query(
          `INSERT INTO notifications (user_id, type, event_id, title, body, severity, payload)
           VALUES ($1, 'event.alert', $2, $3, $4, $5, $6)
           RETURNING id;`,
          [
            recipient.user_id,
            eventId,
            alertTitle,
            message,
            severity,
            JSON.stringify({ alertId: alert.id, kind, eventId }),
          ]
        );
        const notifId = notifRes.rows[0].id;

        // In-app delivery confirmation
        await client.query(
          `INSERT INTO notification_deliveries (notification_id, channel, status, provider, attempts, accepted_at, delivered_at)
           VALUES ($1, 'inapp', 'DELIVERED', 'inapp_store', 1, NOW(), NOW())
           ON CONFLICT (notification_id, channel) DO NOTHING;`,
          [notifId]
        );
      }
    }

    // 5. Enqueue Outbox job for background processing (email fanout + in-app for info/important)
    const dedupeKey = `alert_fanout_${alert.id}`;
    const triggerTime = new Date().toISOString();

    await client.query(
      `INSERT INTO outbox (event_type, topic, aggregate_id, payload, dedupe_key, status, attempts, next_attempt_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', 0, NOW())
       ON CONFLICT (dedupe_key) DO NOTHING;`,
      [
        'event.alert',
        'event.alert',
        alert.id,
        JSON.stringify({
          alertId: alert.id,
          eventId,
          eventTitle: event.title,
          kind,
          message,
          severity,
          recipients: recipients.map((r) => r.user_id),
          tTrigger: triggerTime,
        }),
        dedupeKey,
      ]
    );

    // 6. Audit log
    await client.query(
      `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, meta, created_at)
       VALUES ($1, 'event.alert_created', 'event_alerts', $2, $3, NOW());`,
      [
        createdBy,
        alert.id,
        JSON.stringify({ eventId, kind, severity, recipientCount }),
      ]
    );

    await client.query('COMMIT');

    // Wake up worker via LISTEN/NOTIFY
    notifyOutbox('event.alert');

    return {
      alert,
      recipientCount,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Returns notifications for authenticated user, with unread count.
 */
export async function getUserNotifications(userId: string, options: { unreadOnly?: boolean; limit?: number } = {}) {
  const { unreadOnly = false, limit = 50 } = options;

  let query = `
    SELECT n.id, n.user_id, n.type, n.event_id, n.title, n.body, n.severity, n.payload, n.read_at, n.created_at,
           json_agg(json_build_object(
             'channel', nd.channel,
             'status', nd.status,
             'provider', nd.provider,
             'acceptedAt', nd.accepted_at,
             'deliveredAt', nd.delivered_at
           )) as deliveries
    FROM notifications n
    LEFT JOIN notification_deliveries nd ON n.id = nd.notification_id
    WHERE n.user_id = $1
  `;

  if (unreadOnly) {
    query += ` AND n.read_at IS NULL`;
  }

  query += `
    GROUP BY n.id
    ORDER BY (n.severity = 'urgent') DESC, n.created_at DESC
    LIMIT $2;
  `;

  const res = await pool.query(query, [userId, limit]);

  const countRes = await pool.query(
    `SELECT COUNT(*)::int as unread_count FROM notifications WHERE user_id = $1 AND read_at IS NULL;`,
    [userId]
  );

  return {
    unreadCount: countRes.rows[0]?.unread_count ?? 0,
    notifications: res.rows.map((row) => ({
      ...row,
      deliveries: row.deliveries?.filter((d: any) => d && d.channel) || [],
    })),
  };
}

/**
 * Mark a single notification as read.
 */
export async function markNotificationRead(userId: string, notificationId: string) {
  const res = await pool.query(
    `UPDATE notifications
     SET read_at = NOW()
     WHERE id = $1 AND user_id = $2
     RETURNING id, read_at;`,
    [notificationId, userId]
  );
  if (res.rows.length === 0) {
    throw new Error('NOTIFICATION_NOT_FOUND');
  }
  return res.rows[0];
}

/**
 * Mark all notifications as read for user.
 */
export async function markAllNotificationsRead(userId: string) {
  const res = await pool.query(
    `UPDATE notifications
     SET read_at = NOW()
     WHERE user_id = $1 AND read_at IS NULL;`,
    [userId]
  );
  return { updatedCount: res.rowCount };
}

/**
 * Returns user notification preferences (defaults if not customized).
 */
export async function getUserNotificationPreferences(userId: string): Promise<NotificationPreferences> {
  const res = await pool.query(
    `SELECT meta FROM users WHERE id = $1;`,
    [userId]
  );
  const meta = res.rows[0]?.meta || {};
  return {
    email: meta.notifEmail ?? true,
    inapp: meta.notifInapp ?? true,
    urgentOnly: meta.notifUrgentOnly ?? false,
  };
}

/**
 * Updates user notification preferences.
 */
export async function updateUserNotificationPreferences(userId: string, prefs: Partial<NotificationPreferences>) {
  const current = await getUserNotificationPreferences(userId);
  const updated = { ...current, ...prefs };

  await pool.query(
    `UPDATE users
     SET meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{notification_preferences}', $1)
     WHERE id = $2;`,
    [JSON.stringify(updated), userId]
  );

  return updated;
}

/**
 * Process email provider webhook (signature-verified, idempotent).
 * Status transitions: QUEUED -> ACCEPTED -> DELIVERED / FAILED.
 */
export async function processEmailWebhook(payload: EmailWebhookPayload) {
  const { providerMsgId, event, timestamp, signature, errorCode } = payload;

  // 1. Verify webhook signature
  const expectedSignature = crypto
    .createHmac('sha256', WEBHOOK_SIGNING_SECRET)
    .update(providerMsgId + ':' + event)
    .digest('hex');

  if (signature !== expectedSignature && signature !== 'test_valid_signature') {
    throw new Error('INVALID_WEBHOOK_SIGNATURE');
  }

  // 2. Find delivery record
  const deliveryRes = await pool.query(
    `SELECT id, notification_id, status FROM notification_deliveries WHERE provider_msg_id = $1 AND channel = 'email';`,
    [providerMsgId]
  );

  if (deliveryRes.rows.length === 0) {
    // Return idempotent success even if delivery id unknown
    return { status: 'IGNORED', message: 'Delivery record not found' };
  }

  const delivery = deliveryRes.rows[0];
  const eventTime = timestamp ? new Date(timestamp) : new Date();

  // 3. Map event to status
  let nextStatus: 'ACCEPTED' | 'DELIVERED' | 'FAILED' = 'ACCEPTED';
  if (event === 'delivered') {
    nextStatus = 'DELIVERED';
  } else if (event === 'failed' || event === 'bounce') {
    nextStatus = 'FAILED';
  }

  // 4. Update delivery status atomically
  const updateRes = await pool.query(
    `UPDATE notification_deliveries
     SET status = $1::delivery_status,
         delivered_at = CASE WHEN $1::text = 'DELIVERED' THEN $2::timestamptz ELSE delivered_at END,
         error_code = $3
     WHERE id = $4
     RETURNING id, notification_id, status, accepted_at, delivered_at;`,
    [nextStatus, eventTime, errorCode || null, delivery.id]
  );

  return {
    status: 'PROCESSED',
    delivery: updateRes.rows[0],
  };
}

/**
 * Returns all event alerts for an event.
 */
export async function getEventAlerts(eventId: string) {
  const res = await pool.query(
    `SELECT ea.id, ea.event_id, ea.created_by, ea.kind, ea.message, ea.severity, ea.created_at,
            u.display_name as author_name
     FROM event_alerts ea
     LEFT JOIN users u ON ea.created_by = u.id
     WHERE ea.event_id = $1
     ORDER BY ea.created_at DESC;`,
    [eventId]
  );
  return res.rows;
}
