import { pool } from '../db/index.js';
import crypto from 'crypto';
import { getPaymentAdapter, PaymentAdapterError } from './payment-adapter.js';
import { promoteNext } from './waitlist.js';
import { BookingError } from './booking.js';
import { createTicketWithRetry } from './qr-ticket.js';

export class PaymentError extends BookingError {
  constructor(code: string, message: string, status = 400, details?: Record<string, any>) {
    super(code, `${code}: ${message}`, status, details);
    this.name = 'PaymentError';
  }
}

export interface InitiateCheckoutParams {
  bookingId: string;
  userId: string;
  returnUrl?: string;
  adminOverride?: boolean;
}

export interface VerifyPaymentParams {
  orderId: string;
  paymentId: string;
  signature?: string;
  userId?: string;
}

export interface WebhookProcessParams {
  rawBody: Buffer;
  signature: string;
  timestampHeader?: string;
}

export interface YouPiWebhookProcessParams {
  rawBody: Buffer;
  signatureV2?: string;
  signatureV1?: string;
  timestamp?: string;
  deliveryId: string;
  gatewayEvent?: string;
}

export interface RequestRefundParams {
  bookingId: string;
  userId: string;
  reason: string;
  idempotencyKey: string;
}

export interface DecideRefundParams {
  refundId: string;
  decision: 'APPROVED' | 'REJECTED';
  userId: string;
}

export interface RecordManualRefundParams {
  refundId: string;
  refundUtr: string;
  notes?: string;
  organizerUserId: string;
}

export interface ResolveVerificationQueueParams {
  paymentId: string;
  decision?: 'APPROVE' | 'REJECT';
  resolution?: 'CONFIRM' | 'REJECT';
  reviewerUserId?: string;
  adminUserId?: string;
  notes?: string;
  adminOverride?: boolean;
}

/**
 * Returns throughput limits, current daily consumption, and single-slot queue advisories.
 */
export async function getYouPiThroughputStatus() {
  const provider = process.env.PAYMENT_PROVIDER || 'youpi';
  const dailyLimit = parseInt(process.env.YOUPI_DAILY_LIMIT || '20', 10);

  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT COUNT(*)::int as count
       FROM payments
       WHERE provider = 'youpi'
         AND created_at >= NOW() - INTERVAL '24 hours'
         AND status IN ('PENDING', 'QUEUED', 'SUCCESS', 'SUCCEEDED');`
    );
    const dailyUsed = res.rows[0]?.count || 0;

    return {
      provider,
      dailyLimit,
      dailyUsed,
      dailyCount: dailyUsed,
      dailyRemaining: Math.max(0, dailyLimit - dailyUsed),
      remainingSlotsToday: Math.max(0, dailyLimit - dailyUsed),
      warning:
        'YouPI-PG uses a single-slot FIFO queue per receiving VPA. Recommended throughput is ≤ 12 completed payments/hour and ≤ 20 payments/day per account.',
      hourlyThroughputWarning:
        'YouPI-PG uses a single-slot FIFO queue per receiving VPA. Recommended throughput is ≤ 12 completed payments/hour and ≤ 20 payments/day per account.',
    };
  } finally {
    client.release();
  }
}

/**
 * Initiates paid checkout for a booking in PENDING_PAYMENT state.
 * Server calculates exact totals from stored ticket_types.price_paise; client amounts ignored.
 * Enforces YOUPI_DAILY_LIMIT and single-slot queue integration.
 */
export async function initiateCheckout(params: InitiateCheckoutParams) {
  const { bookingId, userId, returnUrl, adminOverride } = params;
  const paymentProvider = process.env.PAYMENT_PROVIDER || 'youpi';

  // Feature Flag: If free_only, reject paid checkouts
  if (paymentProvider === 'free_only') {
    throw new PaymentError(
      'GATEWAY_DISABLED',
      'Paid event registrations are currently suspended. Only free events are available.',
      503
    );
  }

  const client = await pool.connect();
  const adapter = getPaymentAdapter();

  try {
    await client.query('BEGIN');

    // 1. Fetch booking with row lock
    const bRes = await client.query(
      `SELECT b.id, b.user_id, b.event_id, b.status, b.total_paise, b.expires_at, b.created_at, e.organizer_id, e.title as event_title
       FROM bookings b
       JOIN events e ON b.event_id = e.id
       WHERE b.id = $1 FOR UPDATE;`,
      [bookingId]
    );

    if (bRes.rows.length === 0) {
      throw new PaymentError('BOOKING_NOT_FOUND', 'Booking not found', 404);
    }

    const booking = bRes.rows[0];

    // Ownership check
    if (booking.user_id !== userId) {
      throw new PaymentError('FORBIDDEN', 'You do not have permission to checkout this booking', 403);
    }

    if (booking.status === 'CONFIRMED') {
      throw new PaymentError('ALREADY_CONFIRMED', 'This booking is already confirmed', 400);
    }

    if (booking.status !== 'PENDING_PAYMENT') {
      throw new PaymentError('INVALID_STATE', `Booking is in ${booking.status} state, cannot checkout`, 409);
    }

    if (booking.expires_at && new Date(booking.expires_at) <= new Date()) {
      throw new PaymentError('HOLD_EXPIRED', 'Seat hold has expired. Please reserve again.', 410);
    }

    // 2. Enforce Daily Limit for YouPI gateway (default 20, unless admin override)
    if (adapter.name === 'youpi') {
      const dailyLimit = parseInt(process.env.YOUPI_DAILY_LIMIT || '20', 10);
      const limitCheck = await client.query(
        `SELECT COUNT(*)::int as count
         FROM payments
         WHERE provider = 'youpi'
           AND created_at >= NOW() - INTERVAL '24 hours'
           AND status IN ('PENDING', 'QUEUED', 'SUCCESS', 'SUCCEEDED');`
      );
      const dailyCount = limitCheck.rows[0]?.count || 0;
      if (dailyCount >= dailyLimit && !adminOverride) {
        throw new PaymentError(
          'DAILY_LIMIT_EXCEEDED',
          `Daily payment limit (${dailyLimit}) has been reached. Please try again tomorrow or contact admin.`,
          429,
          { dailyLimit, dailyCount }
        );
      }
    }

    // 3. Compute exact server total from stored items
    const itemsRes = await client.query(
      `SELECT bi.ticket_type_id, bi.quantity, tt.name as ticket_name, tt.price_paise
       FROM booking_items bi
       JOIN ticket_types tt ON bi.ticket_type_id = tt.id
       WHERE bi.booking_id = $1;`,
      [bookingId]
    );

    let calculatedTotalPaise = 0;
    for (const item of itemsRes.rows) {
      calculatedTotalPaise += item.price_paise * item.quantity;
    }

    if (calculatedTotalPaise <= 0) {
      throw new PaymentError('ZERO_AMOUNT', 'Free bookings must use free registration flow', 400);
    }

    // 4. Check existing pending/queued payment
    const existingPaymentRes = await client.query(
      `SELECT id, provider_order_id, status, checkout_url, slot_active, queue_position
       FROM payments
       WHERE booking_id = $1 AND status IN ('PENDING', 'QUEUED');`,
      [bookingId]
    );

    let paymentId: string;
    let orderId: string;
    let checkoutUrl: string | undefined;
    let slotActive: boolean = true;
    let queueStatus: string = 'ACTIVE';

    if (existingPaymentRes.rows.length > 0) {
      const existing = existingPaymentRes.rows[0];
      paymentId = existing.id;
      orderId = existing.provider_order_id;
      checkoutUrl = existing.checkout_url || undefined;
      slotActive = Boolean(existing.slot_active);
      queueStatus = slotActive ? 'ACTIVE' : 'WAITING';
    } else {
      // 5. Generate our payment row first (our payments.id IS the YouPI orderId)
      paymentId = crypto.randomUUID();
      orderId = paymentId;

      let orderRes;
      try {
        orderRes = await adapter.createOrder({
          orderId,
          amountPaise: calculatedTotalPaise,
          currency: 'INR',
          receipt: `rcpt_${bookingId.slice(0, 8)}`,
          returnUrl,
        });
      } catch (adapterErr: any) {
        if (adapterErr instanceof PaymentAdapterError && adapterErr.code === 'ORDER_AMOUNT_MISMATCH') {
          throw new PaymentError('ORDER_AMOUNT_MISMATCH', adapterErr.message, 409, adapterErr.details);
        }
        throw adapterErr;
      }

      checkoutUrl = orderRes.checkoutUrl;
      slotActive = orderRes.slotActive;
      queueStatus = orderRes.queueStatus || (slotActive ? 'ACTIVE' : 'WAITING');
      const initialStatus = slotActive ? 'PENDING' : 'QUEUED';

      // Insert into payments table
      await client.query(
        `INSERT INTO payments (
           id, booking_id, provider, provider_order_id, provider_payment_id,
           amount_paise, currency, status, checkout_url, slot_active, queue_position, is_simulated
         ) VALUES ($1, $2, $3, $4, $5, $6, 'INR', $7, $8, $9, $10, $11);`,
        [
          paymentId,
          bookingId,
          adapter.name,
          orderId,
          orderRes.providerPaymentId,
          calculatedTotalPaise,
          initialStatus,
          checkoutUrl || null,
          slotActive,
          slotActive ? 0 : 1,
          adapter.name === 'simulator',
        ]
      );

      // Audit trail in payment_events
      await client.query(
        `INSERT INTO payment_events (payment_id, event_type, from_status, to_status, payload)
         VALUES ($1, 'ORDER_CREATED', NULL, $2, $3);`,
        [
          paymentId,
          initialStatus,
          JSON.stringify({
            orderId,
            amountPaise: calculatedTotalPaise,
            slotActive,
            queueStatus,
          }),
        ]
      );

      // Also log in payment_attempts
      await client.query(
        `INSERT INTO payment_attempts (payment_id, status, raw_ref) VALUES ($1, 'INITIATED', $2);`,
        [paymentId, orderId]
      );
    }

    await client.query('COMMIT');

    const firstTicketName = itemsRes.rows[0]?.ticket_name || 'Standard Admission';
    const totalQuantity = itemsRes.rows.reduce((acc: number, r: any) => acc + (Number(r.quantity) || 1), 0) || 1;

    return {
      bookingId,
      paymentId,
      orderId,
      amountPaise: calculatedTotalPaise,
      currency: 'INR',
      checkoutUrl,
      slotActive,
      queueStatus,
      expiresAt: booking.expires_at,
      isSimulated: adapter.name === 'simulator',
      eventId: booking.event_id,
      eventTitle: booking.event_title,
      ticketName: firstTicketName,
      quantity: totalQuantity,
      warning:
        'YouPI-PG operates a single-slot FIFO queue per receiving VPA. If your payment is queued, seat hold will be extended once your slot activates.',
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Handles slot activation when YouPI advances the single-slot FIFO queue.
 * Extends the seat hold by 5 minutes (capped at max 30 min from creation).
 */
export async function handleSlotActivation(paymentId: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const pRes = await client.query(
      `SELECT p.id, p.booking_id, p.status, b.created_at as booking_created_at
       FROM payments p
       JOIN bookings b ON p.booking_id = b.id
       WHERE p.id = $1 FOR UPDATE;`,
      [paymentId]
    );

    if (pRes.rows.length === 0) return null;
    const payment = pRes.rows[0];

    // Extend hold by 5 minutes, capped at 30 minutes from booking creation
    await client.query(
      `UPDATE bookings
       SET expires_at = LEAST(created_at + INTERVAL '30 minutes', NOW() + INTERVAL '5 minutes')
       WHERE id = $1;`,
      [payment.booking_id]
    );

    await client.query(
      `UPDATE payments
       SET slot_active = true, status = 'PENDING', queue_position = 0, updated_at = NOW()
       WHERE id = $1;`,
      [paymentId]
    );

    await client.query(
      `INSERT INTO payment_events (payment_id, event_type, from_status, to_status, payload)
       VALUES ($1, 'SLOT_ACTIVATED', $2, 'PENDING', '{"slotActive": true}'::jsonb);`,
      [paymentId, payment.status]
    );

    await client.query('COMMIT');
    return { success: true, paymentId, slotActive: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Authoritative Webhook Processor for YouPI-PG.
 * Verifies X-Gateway-Signature-V2 (with V1 fallback), deduplicates on X-Gateway-Delivery-Id,
 * re-queries YouPI status API, validates 12-digit unique UTR and exact amount,
 * routes mismatches to VERIFICATION_QUEUE, and executes atomic booking fulfillment.
 */
export async function processYouPiWebhook(params: YouPiWebhookProcessParams) {
  const { rawBody, signatureV2, signatureV1, timestamp, deliveryId, gatewayEvent } = params;
  const adapter = getPaymentAdapter('youpi');

  // 1. Delivery ID presence
  if (!deliveryId || typeof deliveryId !== 'string') {
    throw new PaymentError('MISSING_DELIVERY_ID', 'X-Gateway-Delivery-Id header is required for deduplication', 400);
  }

  // 2. Signature verification
  const verification = adapter.verifyWebhook({
    rawBody,
    signatureV2,
    signatureV1,
    timestamp,
    deliveryId,
  });

  if (!verification.valid) {
    throw new PaymentError('INVALID_SIGNATURE', verification.reason || 'Webhook signature verification failed', 401);
  }

  // 3. Deduplication on webhook_deliveries
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const delRes = await client.query(
      `SELECT id, status, attempts FROM webhook_deliveries WHERE delivery_id = $1 FOR UPDATE;`,
      [deliveryId]
    );

    if (delRes.rows.length > 0) {
      const existing = delRes.rows[0];
      if (existing.status === 'PROCESSED') {
        await client.query('COMMIT');
        return { received: true, deduplicated: true, status: 'PROCESSED' };
      }
      // Retry previously failed delivery
      await client.query(
        `UPDATE webhook_deliveries
         SET attempts = attempts + 1, last_attempt_at = NOW(), status = 'RECEIVED'
         WHERE id = $1;`,
        [existing.id]
      );
    } else {
      await client.query(
        `INSERT INTO webhook_deliveries (delivery_id, provider, event_type, status)
         VALUES ($1, 'youpi', $2, 'RECEIVED');`,
        [deliveryId, gatewayEvent || 'UNKNOWN']
      );
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      await client.query(
        `UPDATE webhook_deliveries SET status = 'FAILED', error_message = 'Malformed JSON' WHERE delivery_id = $1;`,
        [deliveryId]
      );
      await client.query('COMMIT');
      throw new PaymentError('INVALID_JSON', 'Malformed webhook JSON payload', 400);
    }

    const { orderId, amountPaise, utr, event, paymentId } = payload;

    // 4. Handle Non-SUCCESS events (EXPIRED, CANCELLED, FAILED)
    if (event !== 'SUCCESS') {
      const pRes = await client.query(
        `SELECT id, booking_id, status FROM payments WHERE id::text = $1 OR provider_order_id = $1 FOR UPDATE;`,
        [orderId]
      );

      if (pRes.rows.length > 0) {
        const payment = pRes.rows[0];
        const nextStatus = ['EXPIRED', 'CANCELLED', 'FAILED'].includes(event) ? event : 'FAILED';

        await client.query(
          `UPDATE payments SET status = $1, raw_webhook_payload = $2, updated_at = NOW() WHERE id = $3;`,
          [nextStatus, JSON.stringify(payload), payment.id]
        );

        await client.query(
          `INSERT INTO payment_events (payment_id, event_type, from_status, to_status, payload)
           VALUES ($1, $2, $3, $4, $5);`,
          [payment.id, `GATEWAY_${event}`, payment.status, nextStatus, JSON.stringify(payload)]
        );

        // Release seat hold on failure/expiration
        await client.query(`UPDATE bookings SET status = 'CANCELLED' WHERE id = $1;`, [payment.booking_id]);

        const itemsRes = await client.query(
          `SELECT ticket_type_id, quantity FROM booking_items WHERE booking_id = $1;`,
          [payment.booking_id]
        );
        for (const it of itemsRes.rows) {
          await client.query(
            `UPDATE ticket_types SET held = GREATEST(0, held - $1) WHERE id = $2;`,
            [it.quantity, it.ticket_type_id]
          );
        }
      }

      await client.query(
        `UPDATE webhook_deliveries SET status = 'PROCESSED', updated_at = NOW() WHERE delivery_id = $1;`,
        [deliveryId]
      );
      await client.query('COMMIT');
      return { received: true, status: event };
    }

    // 5. Handle SUCCESS Event
    // Lookup payment row
    const pRes = await client.query(
      `SELECT p.id, p.booking_id, p.amount_paise, p.status, p.utr, p.provider,
              b.event_id, b.user_id, b.status as booking_status, b.expires_at as booking_expires_at,
              e.organizer_id
       FROM payments p
       JOIN bookings b ON p.booking_id = b.id
       JOIN events e ON b.event_id = e.id
       WHERE p.id::text = $1 OR p.provider_order_id = $1 FOR UPDATE;`,
      [orderId]
    );

    if (pRes.rows.length === 0) {
      await client.query(
        `UPDATE webhook_deliveries SET status = 'FAILED', error_message = 'UNKNOWN_ORDER' WHERE delivery_id = $1;`,
        [deliveryId]
      );
      await client.query('COMMIT');
      throw new PaymentError('UNKNOWN_ORDER', `Payment order ${orderId} does not map to any known payment`, 404);
    }

    const payment = pRes.rows[0];

    // Idempotency: if already SUCCESS or SUCCEEDED
    if (payment.status === 'SUCCESS' || payment.status === 'SUCCEEDED') {
      await client.query(
        `UPDATE webhook_deliveries SET status = 'PROCESSED', updated_at = NOW() WHERE delivery_id = $1;`,
        [deliveryId]
      );
      await client.query('COMMIT');
      return { received: true, deduplicated: true, status: 'ALREADY_SUCCESS' };
    }

    // Check origin status: only PENDING or QUEUED can transition to SUCCESS
    if (!['PENDING', 'QUEUED'].includes(payment.status)) {
      await client.query(
        `UPDATE payments
         SET status = 'VERIFICATION_QUEUE',
             verification_queue_reason = $1,
             raw_webhook_payload = $2,
             updated_at = NOW()
         WHERE id = $3;`,
        [`Invalid transition from status ${payment.status} on SUCCESS webhook`, JSON.stringify(payload), payment.id]
      );

      await client.query(
        `INSERT INTO payment_events (payment_id, event_type, from_status, to_status, payload)
         VALUES ($1, 'VERIFICATION_FLAGGED', $2, 'VERIFICATION_QUEUE', $3);`,
        [payment.id, payment.status, JSON.stringify(payload)]
      );

      await client.query(
        `UPDATE webhook_deliveries SET status = 'PROCESSED', updated_at = NOW() WHERE delivery_id = $1;`,
        [deliveryId]
      );
      await client.query('COMMIT');
      return { received: true, status: 'VERIFICATION_QUEUE', reason: 'INVALID_ORIGIN_STATUS' };
    }

    // Amount match check
    if (amountPaise !== payment.amount_paise) {
      await client.query(
        `UPDATE payments
         SET status = 'VERIFICATION_QUEUE',
             verification_queue_reason = $1,
             raw_webhook_payload = $2,
             updated_at = NOW()
         WHERE id = $3;`,
        [
          `Amount mismatch: expected ${payment.amount_paise} paise, webhook reported ${amountPaise} paise`,
          JSON.stringify(payload),
          payment.id,
        ]
      );

      await client.query(
        `INSERT INTO payment_events (payment_id, event_type, from_status, to_status, payload)
         VALUES ($1, 'AMOUNT_MISMATCH', $2, 'VERIFICATION_QUEUE', $3);`,
        [payment.id, payment.status, JSON.stringify(payload)]
      );

      await client.query(
        `UPDATE webhook_deliveries SET status = 'PROCESSED', updated_at = NOW() WHERE delivery_id = $1;`,
        [deliveryId]
      );
      await client.query('COMMIT');
      return { received: true, status: 'VERIFICATION_QUEUE', reason: 'AMOUNT_MISMATCH' };
    }

    // UTR 12-digit format check
    const utrStr = utr ? String(utr).trim() : '';
    if (!/^\d{12}$/.test(utrStr)) {
      await client.query(
        `UPDATE payments
         SET status = 'VERIFICATION_QUEUE',
             verification_queue_reason = $1,
             raw_webhook_payload = $2,
             updated_at = NOW()
         WHERE id = $3;`,
        [`Invalid UTR format (must be 12 digits): ${utrStr}`, JSON.stringify(payload), payment.id]
      );

      await client.query(
        `INSERT INTO payment_events (payment_id, event_type, from_status, to_status, payload)
         VALUES ($1, 'MALFORMED_UTR', $2, 'VERIFICATION_QUEUE', $3);`,
        [payment.id, payment.status, JSON.stringify(payload)]
      );

      await client.query(
        `UPDATE webhook_deliveries SET status = 'PROCESSED', updated_at = NOW() WHERE delivery_id = $1;`,
        [deliveryId]
      );
      await client.query('COMMIT');
      return { received: true, status: 'VERIFICATION_QUEUE', reason: 'MALFORMED_UTR' };
    }

    // UTR uniqueness across all payments
    const dupUtrRes = await client.query(
      `SELECT id FROM payments WHERE utr = $1 AND id != $2;`,
      [utrStr, payment.id]
    );

    if (dupUtrRes.rows.length > 0) {
      await client.query(
        `UPDATE payments
         SET status = 'VERIFICATION_QUEUE',
             verification_queue_reason = $1,
             raw_webhook_payload = $2,
             updated_at = NOW()
         WHERE id = $3;`,
        [
          `Duplicate UTR ${utrStr} already used on payment ${dupUtrRes.rows[0].id}`,
          JSON.stringify(payload),
          payment.id,
        ]
      );

      await client.query(
        `INSERT INTO payment_events (payment_id, event_type, from_status, to_status, payload)
         VALUES ($1, 'DUPLICATE_UTR', $2, 'VERIFICATION_QUEUE', $3);`,
        [payment.id, payment.status, JSON.stringify(payload)]
      );

      await client.query(
        `UPDATE webhook_deliveries SET status = 'PROCESSED', updated_at = NOW() WHERE delivery_id = $1;`,
        [deliveryId]
      );
      await client.query('COMMIT');
      return { received: true, status: 'VERIFICATION_QUEUE', reason: 'DUPLICATE_UTR' };
    }

    // Re-confirm via YouPI Status API
    try {
      const remoteStatus = await adapter.getStatus(paymentId || orderId);
      if (remoteStatus.status !== 'SUCCESS') {
        await client.query(
          `UPDATE payments
           SET status = 'VERIFICATION_QUEUE',
               verification_queue_reason = $1,
               raw_webhook_payload = $2,
               updated_at = NOW()
           WHERE id = $3;`,
          [
            `YouPI status API returned ${remoteStatus.status}, expected SUCCESS`,
            JSON.stringify(payload),
            payment.id,
          ]
        );

        await client.query(
          `INSERT INTO payment_events (payment_id, event_type, from_status, to_status, payload)
           VALUES ($1, 'STATUS_API_MISMATCH', $2, 'VERIFICATION_QUEUE', $3);`,
          [payment.id, payment.status, JSON.stringify(payload)]
        );

        await client.query(
          `UPDATE webhook_deliveries SET status = 'PROCESSED', updated_at = NOW() WHERE delivery_id = $1;`,
          [deliveryId]
        );
        await client.query('COMMIT');
        return { received: true, status: 'VERIFICATION_QUEUE', reason: 'STATUS_API_MISMATCH' };
      }
    } catch (statusErr: any) {
      // If status query fails with 404 or other non-retryable error, route to verification queue
      await client.query(
        `UPDATE payments
         SET status = 'VERIFICATION_QUEUE',
             verification_queue_reason = $1,
             raw_webhook_payload = $2,
             updated_at = NOW()
         WHERE id = $3;`,
        [`Status re-query error: ${statusErr.message}`, JSON.stringify(payload), payment.id]
      );
      await client.query(
        `UPDATE webhook_deliveries SET status = 'PROCESSED', updated_at = NOW() WHERE delivery_id = $1;`,
        [deliveryId]
      );
      await client.query('COMMIT');
      return { received: true, status: 'VERIFICATION_QUEUE', reason: 'STATUS_API_ERROR' };
    }

    // Check expiry race: If hold expired prior to arrival
    if (payment.booking_expires_at && new Date(payment.booking_expires_at) < new Date()) {
      await client.query(
        `UPDATE payments
         SET status = 'VERIFICATION_QUEUE',
             verification_queue_reason = 'Payment arrived after booking hold expired (late payment race)',
             utr = $1,
             raw_webhook_payload = $2,
             updated_at = NOW()
         WHERE id = $3;`,
        [utrStr, JSON.stringify(payload), payment.id]
      );

      await client.query(
        `INSERT INTO payment_events (payment_id, event_type, from_status, to_status, payload)
         VALUES ($1, 'LATE_PAYMENT_EXPIRED_HOLD', $2, 'VERIFICATION_QUEUE', $3);`,
        [payment.id, payment.status, JSON.stringify(payload)]
      );

      await client.query(
        `UPDATE webhook_deliveries SET status = 'PROCESSED', updated_at = NOW() WHERE delivery_id = $1;`,
        [deliveryId]
      );
      await client.query('COMMIT');
      return { received: true, status: 'VERIFICATION_QUEUE', reason: 'LATE_PAYMENT_EXPIRED_HOLD' };
    }

    // 6. Unified Single-Transaction Atomic Fulfillment
    await client.query(
      `UPDATE payments
       SET status = 'SUCCESS',
           utr = $1,
           provider_payment_id = $2,
           raw_webhook_payload = $3,
           updated_at = NOW()
       WHERE id = $4;`,
      [utrStr, paymentId || payment.provider_payment_id, JSON.stringify(payload), payment.id]
    );

    await client.query(
      `INSERT INTO payment_events (payment_id, event_type, from_status, to_status, payload)
       VALUES ($1, 'PAYMENT_SUCCESS', $2, 'SUCCESS', $3);`,
      [payment.id, payment.status, JSON.stringify(payload)]
    );

    // Transfer inventory: held -= quantity, sold += quantity
    const itemsRes = await client.query(
      `SELECT ticket_type_id, quantity FROM booking_items WHERE booking_id = $1 ORDER BY ticket_type_id ASC;`,
      [payment.booking_id]
    );

    const ticketTypeIds = itemsRes.rows.map((i: any) => i.ticket_type_id).sort();
    if (ticketTypeIds.length > 0) {
      await client.query(
        `SELECT id, capacity, sold, held FROM ticket_types WHERE id = ANY($1::uuid[]) ORDER BY id ASC FOR UPDATE;`,
        [ticketTypeIds]
      );
    }

    for (const it of itemsRes.rows) {
      await client.query(
        `UPDATE ticket_types
         SET held = GREATEST(0, held - $1), sold = sold + $1
         WHERE id = $2;`,
        [it.quantity, it.ticket_type_id]
      );
    }

    // Confirm booking
    await client.query(
      `UPDATE bookings SET status = 'CONFIRMED' WHERE id = $1;`,
      [payment.booking_id]
    );

    // Issue QR tickets
    const issuedTickets = [];
    for (const item of itemsRes.rows) {
      for (let i = 0; i < item.quantity; i++) {
        const tRes = await createTicketWithRetry(client, {
          bookingId: payment.booking_id,
          ticketTypeId: item.ticket_type_id,
          userId: payment.user_id,
          eventId: payment.event_id,
        });
        issuedTickets.push({
          id: tRes.id,
          ticketCode: tRes.ticket_code,
        });
      }
    }

    // Ledger Entry (SALE)
    await client.query(
      `INSERT INTO organizer_ledger_entries (
         organizer_id, booking_id, payment_id, entry_type, amount_paise, is_simulated
       ) VALUES ($1, $2, $3, 'SALE', $4, false)
       ON CONFLICT (payment_id, entry_type) DO NOTHING;`,
      [payment.organizer_id, payment.booking_id, payment.id, payment.amount_paise]
    );

    // Receipt
    const receiptNumber = `REC-YOUPI-${Date.now().toString().slice(-6)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    await client.query(
      `INSERT INTO receipts (booking_id, number) VALUES ($1, $2) ON CONFLICT (number) DO NOTHING;`,
      [payment.booking_id, receiptNumber]
    );

    // Outbox notification
    await client.query(
      `INSERT INTO outbox (event_type, payload, dedupe_key)
       VALUES ('payment.succeeded', $1, $2)
       ON CONFLICT (dedupe_key) DO NOTHING;`,
      [
        JSON.stringify({
          bookingId: payment.booking_id,
          paymentId: payment.id,
          utr: utrStr,
          amountPaise: payment.amount_paise,
          receiptNumber,
          ticketsCount: issuedTickets.length,
        }),
        `outbox_youpi_${payment.id}`,
      ]
    );

    // Mark webhook delivery as PROCESSED
    await client.query(
      `UPDATE webhook_deliveries SET status = 'PROCESSED', updated_at = NOW() WHERE delivery_id = $1;`,
      [deliveryId]
    );

    await client.query('COMMIT');

    return {
      received: true,
      confirmed: true,
      status: 'SUCCESS',
      paymentId: payment.id,
      bookingId: payment.booking_id,
      receiptNumber,
      tickets: issuedTickets,
    };
  } catch (err: any) {
    await client.query('ROLLBACK');

    // On processing errors, mark delivery FAILED and rethrow so Fastify replies 5xx to trigger YouPI retry
    try {
      await pool.query(
        `UPDATE webhook_deliveries
         SET status = 'FAILED', error_message = $1, updated_at = NOW()
         WHERE delivery_id = $2;`,
        [err.message, deliveryId]
      );
    } catch {
      // Ignore secondary error
    }

    throw err;
  } finally {
    client.release();
  }
}

/**
 * Resolves a payment trapped in VERIFICATION_QUEUE.
 * Admins/organizers can manually APPROVE (triggering fulfillment) or REJECT (canceling hold).
 */
export async function resolveVerificationQueue(params: ResolveVerificationQueueParams) {
  const decision = params.decision || (params.resolution === 'CONFIRM' ? 'APPROVE' : 'REJECT');
  const reviewerUserId = params.reviewerUserId || params.adminUserId || 'system';
  const { paymentId, notes } = params;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const pRes = await client.query(
      `SELECT p.id, p.booking_id, p.amount_paise, p.status, p.utr,
              b.event_id, b.user_id, e.organizer_id
       FROM payments p
       JOIN bookings b ON p.booking_id = b.id
       JOIN events e ON b.event_id = e.id
       WHERE p.id = $1 FOR UPDATE;`,
      [paymentId]
    );

    if (pRes.rows.length === 0) {
      throw new PaymentError('PAYMENT_NOT_FOUND', 'Payment record not found', 404);
    }

    const payment = pRes.rows[0];
    if (payment.status !== 'VERIFICATION_QUEUE') {
      throw new PaymentError('INVALID_STATE', `Payment is in ${payment.status}, not VERIFICATION_QUEUE`, 409);
    }

    if (decision === 'APPROVE') {
      // Execute fulfillment
      await client.query(
        `UPDATE payments
         SET status = 'SUCCESS',
             manual_reviewed_by = $1,
             manual_reviewed_at = NOW(),
             verification_queue_reason = $2,
             updated_at = NOW()
         WHERE id = $3;`,
        [reviewerUserId, `Manually Approved: ${notes || 'No review notes'}`, paymentId]
      );

      await client.query(
        `INSERT INTO payment_events (payment_id, event_type, from_status, to_status, payload)
         VALUES ($1, 'MANUAL_VERIFICATION_APPROVED', 'VERIFICATION_QUEUE', 'SUCCESS', $2);`,
        [paymentId, JSON.stringify({ reviewerUserId, notes })]
      );

      // Inventory transfer
      const itemsRes = await client.query(
        `SELECT ticket_type_id, quantity FROM booking_items WHERE booking_id = $1;`,
        [payment.booking_id]
      );
      for (const it of itemsRes.rows) {
        await client.query(
          `UPDATE ticket_types SET held = GREATEST(0, held - $1), sold = sold + $1 WHERE id = $2;`,
          [it.quantity, it.ticket_type_id]
        );
      }

      await client.query(`UPDATE bookings SET status = 'CONFIRMED' WHERE id = $1;`, [payment.booking_id]);

      // Issue tickets
      const issuedTickets = [];
      for (const it of itemsRes.rows) {
        for (let i = 0; i < it.quantity; i++) {
          const tRes = await createTicketWithRetry(client, {
            bookingId: payment.booking_id,
            ticketTypeId: it.ticket_type_id,
            userId: payment.user_id,
            eventId: payment.event_id,
          });
          issuedTickets.push({
            id: tRes.id,
            ticket_code: tRes.ticket_code,
          });
        }
      }

      // Ledger entry
      await client.query(
        `INSERT INTO organizer_ledger_entries (
           organizer_id, booking_id, payment_id, entry_type, amount_paise, is_simulated
         ) VALUES ($1, $2, $3, 'SALE', $4, false)
         ON CONFLICT (payment_id, entry_type) DO NOTHING;`,
        [payment.organizer_id, payment.booking_id, payment.id, payment.amount_paise]
      );
    } else {
      // REJECT: Mark payment failed, cancel booking, release held seats
      await client.query(
        `UPDATE payments
         SET status = 'FAILED',
             manual_reviewed_by = $1,
             manual_reviewed_at = NOW(),
             verification_queue_reason = $2,
             updated_at = NOW()
         WHERE id = $3;`,
        [reviewerUserId, `Manually Rejected: ${notes || 'No review notes'}`, paymentId]
      );

      await client.query(
        `INSERT INTO payment_events (payment_id, event_type, from_status, to_status, payload)
         VALUES ($1, 'MANUAL_VERIFICATION_REJECTED', 'VERIFICATION_QUEUE', 'FAILED', $2);`,
        [paymentId, JSON.stringify({ reviewerUserId, notes })]
      );

      await client.query(`UPDATE bookings SET status = 'CANCELLED' WHERE id = $1;`, [payment.booking_id]);

      const itemsRes = await client.query(
        `SELECT ticket_type_id, quantity FROM booking_items WHERE booking_id = $1;`,
        [payment.booking_id]
      );
      for (const it of itemsRes.rows) {
        await client.query(
          `UPDATE ticket_types SET held = GREATEST(0, held - $1) WHERE id = $2;`,
          [it.quantity, it.ticket_type_id]
        );
      }
    }

    await client.query('COMMIT');
    return { success: true, paymentId, decision, status: decision === 'APPROVE' ? 'SUCCESS' : 'FAILED' };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Records an offline/direct manual refund executed by the organizer.
 * Verifies checked-in tickets are excluded (checked-in tickets cannot be refunded).
 */
export async function recordManualRefund(params: RecordManualRefundParams) {
  const { refundId, refundUtr, notes, organizerUserId } = params;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Fetch refund with row lock
    const rRes = await client.query(
      `SELECT r.id, r.payment_id, r.amount_paise, r.status,
              p.booking_id, b.event_id, b.status as booking_status, e.organizer_id
       FROM refunds r
       JOIN payments p ON r.payment_id = p.id
       JOIN bookings b ON p.booking_id = b.id
       JOIN events e ON b.event_id = e.id
       WHERE r.id = $1 FOR UPDATE;`,
      [refundId]
    );

    if (rRes.rows.length === 0) {
      throw new PaymentError('REFUND_NOT_FOUND', 'Refund record not found', 404);
    }

    const refund = rRes.rows[0];

    // Check organizer membership
    if (organizerUserId) {
      const orgCheck = await client.query(
        `SELECT 1 FROM organizer_members WHERE organizer_id = $1 AND user_id = $2 AND status = 'active';`,
        [refund.organizer_id, organizerUserId]
      );
      if (orgCheck.rows.length === 0) {
        throw new PaymentError('FORBIDDEN', 'Access denied: not an active member of the organizer for this event', 403);
      }
    }

    // Check refund status
    if (refund.status === 'SUCCEEDED') {
      await client.query('COMMIT');
      return { refundId, status: 'SUCCEEDED', alreadyProcessed: true };
    }

    // 2. Check ticket scan / checkin status: checked-in tickets are excluded from refunds
    const checkinRes = await client.query(
      `SELECT COUNT(*)::int as count
       FROM tickets t
       LEFT JOIN checkins c ON c.ticket_id = t.id
       WHERE t.booking_id = $1 AND (t.status = 'CHECKED_IN' OR c.id IS NOT NULL);`,
      [refund.booking_id]
    );

    if ((checkinRes.rows[0]?.count || 0) > 0) {
      throw new PaymentError(
        'TICKETS_ALREADY_CHECKED_IN',
        'Cannot refund booking because one or more tickets have already been scanned / checked in.',
        400
      );
    }

    // 3. Update refund record
    await client.query(
      `UPDATE refunds
       SET status = 'SUCCEEDED',
           refund_utr = $1,
           decided_by = $2,
           manual_processed_at = NOW(),
           manual_notes = $3
       WHERE id = $4;`,
      [refundUtr, organizerUserId, notes || null, refundId]
    );

    // 4. Update payment status to REFUNDED
    await client.query(
      `UPDATE payments
       SET status = 'REFUNDED', updated_at = NOW()
       WHERE id = $1;`,
      [refund.payment_id]
    );

    await client.query(
      `INSERT INTO payment_events (payment_id, event_type, from_status, to_status, payload)
       VALUES ($1, 'MANUAL_REFUND_SUCCEEDED', 'SUCCESS', 'REFUNDED', $2);`,
      [refund.payment_id, JSON.stringify({ refundId, refundUtr, organizerUserId })]
    );

    // 5. Cancel booking & void tickets
    await client.query(`UPDATE bookings SET status = 'CANCELLED' WHERE id = $1;`, [refund.booking_id]);
    await client.query(
      `UPDATE tickets SET status = 'REVOKED', revoked_at = NOW(), revoke_reason = 'Manual refund processed' WHERE booking_id = $1;`,
      [refund.booking_id]
    );

    // 6. Record REFUND entry in organizer ledger
    await client.query(
      `INSERT INTO organizer_ledger_entries (
         organizer_id, booking_id, payment_id, entry_type, amount_paise, is_simulated
       ) VALUES ($1, $2, $3, 'REFUND', $4, false)
       ON CONFLICT (payment_id, entry_type) DO NOTHING;`,
      [refund.organizer_id, refund.booking_id, refund.payment_id, refund.amount_paise]
    );

    await client.query('COMMIT');

    return {
      refundId,
      refundUtr,
      status: 'SUCCEEDED',
      bookingId: refund.booking_id,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Standard / Legacy verification route (re-queries adapter directly).
 */
export async function verifyPayment(params: VerifyPaymentParams) {
  const { orderId, paymentId, signature, userId } = params;
  const adapter = getPaymentAdapter();

  let isSuccess = false;
  let amountPaise = 0;
  let failureCode: string | undefined;

  if (typeof (adapter as any).verifyPayment === 'function') {
    const simRes = await (adapter as any).verifyPayment({ orderId, paymentId, signature });
    isSuccess = Boolean(simRes.success);
    amountPaise = simRes.amountPaise;
    failureCode = simRes.failureCode;
  } else {
    const adapterResult = await adapter.getStatus(orderId || paymentId);
    isSuccess = adapterResult.status === 'SUCCESS';
    amountPaise = adapterResult.amountPaise;
    failureCode = isSuccess ? undefined : 'PAYMENT_NOT_SETTLED';
  }

  return await executePaymentConfirmationTransaction({
    orderId,
    paymentId,
    adapterSuccess: isSuccess,
    amountPaise,
    failureCode,
    expectedUserId: userId,
  });
}

/**
 * Single-transaction atomic confirmation for legacy / direct calls.
 */
export async function executePaymentConfirmationTransaction(params: {
  orderId: string;
  paymentId: string;
  adapterSuccess: boolean;
  amountPaise: number;
  failureCode?: string;
  expectedUserId?: string;
}) {
  const { orderId, paymentId, adapterSuccess, amountPaise, failureCode, expectedUserId } = params;
  const client = await pool.connect();
  const adapter = getPaymentAdapter();
  const successStatus = adapter.name === 'simulator' ? 'SUCCEEDED' : 'SUCCESS';

  try {
    await client.query('BEGIN');

    const pRes = await client.query(
      `SELECT p.id, p.booking_id, p.amount_paise, p.status, b.event_id, b.user_id, e.organizer_id
       FROM payments p
       JOIN bookings b ON p.booking_id = b.id
       JOIN events e ON b.event_id = e.id
       WHERE p.id::text = $1 OR p.provider_order_id = $1 FOR UPDATE;`,
      [orderId]
    );

    if (pRes.rows.length === 0) {
      throw new PaymentError('PAYMENT_NOT_FOUND', 'Payment order not found', 404);
    }

    const payment = pRes.rows[0];

    if (expectedUserId && payment.user_id !== expectedUserId) {
      throw new PaymentError('FORBIDDEN', 'You do not have permission to verify this payment order', 403);
    }

    if (payment.status === 'SUCCESS' || payment.status === 'SUCCEEDED') {
      await client.query('COMMIT');
      return {
        confirmed: true,
        alreadyProcessed: true,
        paymentId: payment.id,
        bookingId: payment.booking_id,
        status: successStatus,
      };
    }

    if (!adapterSuccess) {
      await client.query(
        `UPDATE payments SET status = 'FAILED', failure_code = $1, updated_at = NOW() WHERE id = $2;`,
        [failureCode || 'DECLINED', payment.id]
      );
      await client.query(`UPDATE bookings SET status = 'PAYMENT_FAILED' WHERE id = $1;`, [payment.booking_id]);

      const itemsRes = await client.query(
        `SELECT ticket_type_id, quantity FROM booking_items WHERE booking_id = $1 ORDER BY ticket_type_id ASC;`,
        [payment.booking_id]
      );
      for (const item of itemsRes.rows) {
        await client.query(
          `UPDATE ticket_types SET held = GREATEST(held - $1, 0) WHERE id = $2;`,
          [item.quantity, item.ticket_type_id]
        );
      }

      await client.query('COMMIT');
      return {
        confirmed: false,
        paymentId: payment.id,
        bookingId: payment.booking_id,
        status: 'FAILED',
        failureCode,
      };
    }

    if (amountPaise !== payment.amount_paise) {
      await client.query(
        `UPDATE payments SET status = 'FAILED', failure_code = 'AMOUNT_MISMATCH', updated_at = NOW() WHERE id = $1;`,
        [payment.id]
      );
      await client.query('COMMIT');
      throw new PaymentError('AMOUNT_MISMATCH', 'Paid amount does not match order amount', 422);
    }

    await client.query(
      `UPDATE payments
       SET status = $1, provider_payment_id = $2, updated_at = NOW()
       WHERE id = $3;`,
      [successStatus, paymentId, payment.id]
    );

    const itemsRes = await client.query(
      `SELECT ticket_type_id, quantity FROM booking_items WHERE booking_id = $1 ORDER BY ticket_type_id ASC;`,
      [payment.booking_id]
    );

    const ticketTypeIds = itemsRes.rows.map((i: any) => i.ticket_type_id).sort();
    if (ticketTypeIds.length > 0) {
      await client.query(
        `SELECT id, capacity, sold, held FROM ticket_types WHERE id = ANY($1::uuid[]) ORDER BY id ASC FOR UPDATE;`,
        [ticketTypeIds]
      );
    }

    for (const item of itemsRes.rows) {
      await client.query(
        `UPDATE ticket_types
         SET held = GREATEST(held - $1, 0), sold = sold + $1
         WHERE id = $2;`,
        [item.quantity, item.ticket_type_id]
      );
    }

    await client.query(`UPDATE bookings SET status = 'CONFIRMED' WHERE id = $1;`, [payment.booking_id]);

    const issuedTickets = [];
    for (const item of itemsRes.rows) {
      for (let i = 0; i < item.quantity; i++) {
        const tRes = await createTicketWithRetry(client, {
          bookingId: payment.booking_id,
          ticketTypeId: item.ticket_type_id,
          userId: payment.user_id,
          eventId: payment.event_id,
        });
        issuedTickets.push({
          id: tRes.id,
          ticketCode: tRes.ticket_code,
          qrPayload: tRes.rawToken,
        });
      }
    }

    await client.query(
      `INSERT INTO organizer_ledger_entries (
         organizer_id, booking_id, payment_id, entry_type, amount_paise, is_simulated
       ) VALUES ($1, $2, $3, 'SALE', $4, false)
       ON CONFLICT (payment_id, entry_type) DO NOTHING;`,
      [payment.organizer_id, payment.booking_id, payment.id, payment.amount_paise]
    );

    const receiptNumber = `REC-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    await client.query(
      `INSERT INTO receipts (booking_id, number) VALUES ($1, $2) ON CONFLICT (number) DO NOTHING;`,
      [payment.booking_id, receiptNumber]
    );

    await client.query(
      `INSERT INTO outbox (event_type, payload, dedupe_key)
       VALUES ('payment.succeeded', $1, $2)
       ON CONFLICT (dedupe_key) DO NOTHING;`,
      [
        JSON.stringify({
          bookingId: payment.booking_id,
          paymentId: payment.id,
          amountPaise: payment.amount_paise,
          receiptNumber,
          ticketsCount: issuedTickets.length,
        }),
        `outbox_pay_${payment.id}`,
      ]
    );

    await client.query('COMMIT');

    return {
      confirmed: true,
      alreadyProcessed: false,
      paymentId: payment.id,
      bookingId: payment.booking_id,
      receiptNumber,
      status: successStatus,
      tickets: issuedTickets,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Legacy webhook processor (for backwards compatibility).
 */
export async function processWebhook(params: WebhookProcessParams) {
  const { rawBody, signature, timestampHeader } = params;
  const adapter = getPaymentAdapter();

  const isValidSignature = adapter.verifyWebhook({
    rawBody,
    signatureV1: signature,
    timestamp: timestampHeader,
  }).valid;

  if (!isValidSignature) {
    throw new PaymentError('INVALID_SIGNATURE', 'Webhook signature verification failed', 401);
  }

  let eventData: any;
  try {
    eventData = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new PaymentError('INVALID_JSON', 'Malformed webhook JSON payload', 400);
  }

  const orderId = eventData.orderId || eventData.payload?.order?.id;
  const paymentId = eventData.paymentId || eventData.payload?.payment?.id || `pay_${Date.now()}`;
  const amountPaise = eventData.amountPaise || eventData.payload?.payment?.amount;

  return await executePaymentConfirmationTransaction({
    orderId,
    paymentId,
    adapterSuccess: true,
    amountPaise,
  });
}

/**
 * Requests refund for a confirmed booking.
 */
export async function requestRefund(params: RequestRefundParams) {
  const { bookingId, userId, reason, idempotencyKey } = params;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const pRes = await client.query(
      `SELECT p.id, p.amount_paise, p.status as payment_status, b.status as booking_status, b.user_id
       FROM payments p
       JOIN bookings b ON p.booking_id = b.id
       WHERE p.booking_id = $1 AND p.status IN ('SUCCESS', 'SUCCEEDED')
       FOR UPDATE;`,
      [bookingId]
    );

    if (pRes.rows.length === 0) {
      throw new PaymentError('NOT_ELIGIBLE', 'No succeeded payment found for this booking to refund', 400);
    }

    const payment = pRes.rows[0];

    if (payment.user_id !== userId) {
      throw new PaymentError('FORBIDDEN', 'You can only request refunds for your own bookings', 403);
    }

    const existingRes = await client.query(`SELECT id, status FROM refunds WHERE idempotency_key = $1;`, [
      idempotencyKey,
    ]);
    if (existingRes.rows.length > 0) {
      await client.query('COMMIT');
      return { id: existingRes.rows[0].id, refundId: existingRes.rows[0].id, status: existingRes.rows[0].status, deduplicated: true };
    }

    const rRes = await client.query(
      `INSERT INTO refunds (payment_id, amount_paise, reason, status, requested_by, idempotency_key)
       VALUES ($1, $2, $3, 'REQUESTED', $4, $5)
       RETURNING id;`,
      [payment.id, payment.amount_paise, reason, userId, idempotencyKey]
    );

    await client.query('COMMIT');
    return { id: rRes.rows[0].id, refundId: rRes.rows[0].id, status: 'REQUESTED' };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Decides a refund request (Approved or Rejected by Organizer).
 */
export async function decideRefund(params: DecideRefundParams) {
  const { refundId, decision, userId } = params;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const rRes = await client.query(
      `SELECT r.id, r.payment_id, r.amount_paise, r.status, r.requested_by, p.booking_id, e.organizer_id
       FROM refunds r
       JOIN payments p ON r.payment_id = p.id
       JOIN bookings b ON p.booking_id = b.id
       JOIN events e ON b.event_id = e.id
       WHERE r.id = $1 FOR UPDATE;`,
      [refundId]
    );

    if (rRes.rows.length === 0) {
      throw new PaymentError('REFUND_NOT_FOUND', 'Refund request not found', 404);
    }

    const refund = rRes.rows[0];
    if (refund.requested_by && refund.requested_by === userId) {
      throw new PaymentError('FORBIDDEN', 'Requester cannot decide their own refund (anti-self-dealing)', 403);
    }

    if (refund.status !== 'REQUESTED') {
      throw new PaymentError('ALREADY_DECIDED', `Refund has already been ${refund.status.toLowerCase()}`, 409);
    }

    if (decision === 'REJECTED') {
      await client.query(
        `UPDATE refunds SET status = 'REJECTED', decided_by = $1, manual_processed_at = NOW() WHERE id = $2;`,
        [userId, refundId]
      );
      await client.query('COMMIT');
      return { refundId, status: 'REJECTED' };
    }

    const adapter = getPaymentAdapter();
    if (adapter.name === 'simulator') {
      await client.query(
        `UPDATE refunds SET status = 'SUCCEEDED', decided_by = $1, manual_processed_at = NOW() WHERE id = $2;`,
        [userId, refundId]
      );
      await client.query(`UPDATE payments SET status = 'REFUNDED', updated_at = NOW() WHERE id = $1;`, [refund.payment_id]);
      await client.query(`UPDATE bookings SET status = 'CANCELLED' WHERE id = $1;`, [refund.booking_id]);
      await client.query(
        `UPDATE tickets SET status = 'REVOKED', revoked_at = NOW(), revoke_reason = 'Simulated refund' WHERE booking_id = $1;`,
        [refund.booking_id]
      );
      await client.query(
        `INSERT INTO organizer_ledger_entries (
           organizer_id, booking_id, payment_id, entry_type, amount_paise, is_simulated
         ) VALUES ($1, $2, $3, 'REFUND', $4, true)
         ON CONFLICT (payment_id, entry_type) DO NOTHING;`,
        [refund.organizer_id, refund.booking_id, refund.payment_id, refund.amount_paise]
      );
      const itemsRes = await client.query(
        `SELECT ticket_type_id, quantity FROM booking_items WHERE booking_id = $1;`,
        [refund.booking_id]
      );
      for (const item of itemsRes.rows) {
        await client.query(
          `UPDATE ticket_types SET sold = GREATEST(sold - $1, 0) WHERE id = $2;`,
          [item.quantity, item.ticket_type_id]
        );
        await promoteNext(item.ticket_type_id, client);
      }
      await client.query('COMMIT');
      return { success: true, status: 'SUCCEEDED', refundId: refund.id };
    }

    // Mark as APPROVED (Awaiting manual bank transfer recording)
    await client.query(
      `UPDATE refunds SET status = 'APPROVED', decided_by = $1 WHERE id = $2;`,
      [userId, refundId]
    );

    await client.query('COMMIT');
    return { refundId, status: 'APPROVED', manualRequired: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Scoped organizer sales and financial ledger summary.
 * Returns gross, discounts, refunds, and net totals in paise with is_simulated=true.
 */
export async function getOrganizerSalesSummary(
  organizerId: string,
  requesterUserId?: string,
  requesterRole?: string
) {
  const client = await pool.connect();
  try {
    // RBAC check: only organizer members or global admins
    if (requesterRole && requesterRole !== 'admin' && requesterUserId) {
      const memRes = await client.query(
        `SELECT role FROM organizer_members WHERE organizer_id = $1 AND user_id = $2 AND status = 'active';`,
        [organizerId, requesterUserId]
      );
      if (memRes.rows.length === 0) {
        throw new PaymentError('FORBIDDEN', 'Access denied to organizer sales and financial ledger', 403);
      }
    }

    // Ledger entries
    const ledgerRes = await client.query(
      `SELECT id, booking_id, payment_id, entry_type, amount_paise, is_simulated, created_at
       FROM organizer_ledger_entries
       WHERE organizer_id = $1
       ORDER BY created_at DESC;`,
      [organizerId]
    );

    let grossPaise = 0;
    let refundsPaise = 0;
    let salesCount = 0;
    let refundsCount = 0;

    for (const row of ledgerRes.rows) {
      if (row.entry_type === 'SALE') {
        grossPaise += Number(row.amount_paise);
        salesCount++;
      } else if (row.entry_type === 'REFUND') {
        refundsPaise += Number(row.amount_paise);
        refundsCount++;
      }
    }

    const netPaise = grossPaise - refundsPaise;

    return {
      organizerId,
      grossPaise,
      discountsPaise: 0,
      refundsPaise,
      netPaise,
      salesCount,
      refundsCount,
      currency: 'INR',
      isSimulated: true,
      ledgerEntries: ledgerRes.rows,
    };
  } finally {
    client.release();
  }
}

/**
 * Expiry Reconciliation Job:
 * For each expired hold, re-queries adapter; if unknown/pending, extends once;
 * only on definitive FAILED/none -> releases hold.
 */
export async function reconcileExpiredHolds(): Promise<{ reconciledCount: number }> {
  const client = await pool.connect();
  const adapter = getPaymentAdapter();
  let reconciledCount = 0;

  try {
    const expRes = await client.query(
      `SELECT b.id, b.status, b.expires_at, p.id as payment_id, p.provider_order_id
       FROM bookings b
       LEFT JOIN payments p ON b.id = p.booking_id
       WHERE b.status = 'PENDING_PAYMENT' AND b.expires_at < NOW()
       LIMIT 50;`
    );

    for (const row of expRes.rows) {
      if (row.provider_order_id) {
        try {
          const statusCheck = await adapter.getStatus(row.provider_order_id);
          if (statusCheck.status === 'SUCCESS') {
            await executePaymentConfirmationTransaction({
              orderId: row.provider_order_id,
              paymentId: row.payment_id,
              adapterSuccess: true,
              amountPaise: statusCheck.amountPaise,
            });
            reconciledCount++;
            continue;
          }
        } catch {
          // If status check fails, proceed with normal expiration
        }
      }

      await client.query('BEGIN');
      await client.query(`UPDATE bookings SET status = 'EXPIRED' WHERE id = $1;`, [row.id]);
      if (row.payment_id) {
        await client.query(
          `UPDATE payments SET status = 'EXPIRED', failure_code = 'HOLD_EXPIRED' WHERE id = $1;`,
          [row.payment_id]
        );
        await client.query(
          `INSERT INTO payment_events (payment_id, event_type, from_status, to_status, payload)
           VALUES ($1, 'EXPIRED', 'PENDING', 'EXPIRED', '{"reason":"Hold timeout"}');`,
          [row.payment_id]
        );
      }

      const itemsRes = await client.query(
        `SELECT ticket_type_id, quantity FROM booking_items WHERE booking_id = $1;`,
        [row.id]
      );
      for (const item of itemsRes.rows) {
        await client.query(
          `UPDATE ticket_types SET held = GREATEST(held - $1, 0) WHERE id = $2;`,
          [item.quantity, item.ticket_type_id]
        );
        await promoteNext(item.ticket_type_id, client);
      }
      await client.query('COMMIT');
      reconciledCount++;
    }

    return { reconciledCount };
  } catch (err) {
    console.error('[Payment Reconciliation] Error during hold reconciliation:', err);
    return { reconciledCount };
  } finally {
    client.release();
  }
}

export interface GetPaymentStatusParams {
  paymentId: string;
  userId: string;
  userRole?: string;
}

/**
 * Retrieves authoritative payment status, seat hold, and fulfillment details.
 * Owner-only, admin, or event organizer access enforced.
 */
export async function getPaymentStatus(params: GetPaymentStatusParams) {
  const { paymentId, userId, userRole } = params;
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT p.id, p.booking_id, p.provider, p.provider_order_id, p.amount_paise,
              p.currency, p.status, p.utr, p.slot_active, p.queue_position,
              p.checkout_url, p.verification_queue_reason, p.created_at, p.updated_at,
              b.user_id, b.status as booking_status, b.expires_at as booking_expires_at,
              e.id as event_id, e.title as event_title, e.organizer_id,
              r.number as receipt_number, r.issued_at as receipt_issued_at
       FROM payments p
       JOIN bookings b ON p.booking_id = b.id
       JOIN events e ON b.event_id = e.id
       LEFT JOIN receipts r ON b.id = r.booking_id
       WHERE (p.id::text = $1 OR p.provider_order_id = $1 OR p.booking_id::text = $1);`,
      [paymentId]
    );

    if (res.rows.length === 0) {
      throw new PaymentError('PAYMENT_NOT_FOUND', 'Payment session not found', 404);
    }

    const row = res.rows[0];

    // Authorization: owner or admin or event organizer
    if (userRole !== 'admin' && row.user_id !== userId) {
      const orgMember = await client.query(
        `SELECT 1 FROM organizer_members WHERE organizer_id = $1 AND user_id = $2 AND status = 'active';`,
        [row.organizer_id, userId]
      );
      if (orgMember.rows.length === 0) {
        throw new PaymentError('FORBIDDEN', 'Access denied to payment status', 403);
      }
    }

    // If payment or booking is confirmed/success, fetch issued tickets
    let tickets: any[] = [];
    if (row.status === 'SUCCESS' || row.booking_status === 'CONFIRMED') {
      const tRes = await client.query(
        `SELECT id, ticket_code, status, created_at
         FROM tickets
         WHERE booking_id = $1;`,
        [row.booking_id]
      );
      tickets = tRes.rows;
    }

    return {
      id: row.id,
      bookingId: row.booking_id,
      orderId: row.provider_order_id,
      provider: row.provider,
      status: row.status,
      bookingStatus: row.booking_status,
      bookingExpiresAt: row.booking_expires_at,
      amountPaise: Number(row.amount_paise),
      currency: row.currency,
      utr: row.utr,
      slotActive: Boolean(row.slot_active),
      queuePosition: row.queue_position || 0,
      checkoutUrl: row.checkout_url,
      verificationQueueReason: row.verification_queue_reason,
      receiptNumber: row.receipt_number,
      receiptIssuedAt: row.receipt_issued_at,
      eventId: row.event_id,
      eventTitle: row.event_title,
      tickets,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } finally {
    client.release();
  }
}

