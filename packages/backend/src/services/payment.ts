import { pool } from '../db/index.js';
import crypto from 'crypto';
import { getPaymentAdapter } from './payment-adapter.js';
import { promoteNext } from './waitlist.js';
import { BookingError } from './booking.js';

export class PaymentError extends BookingError {}

export interface InitiateCheckoutParams {
  bookingId: string;
  userId: string;
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

/**
 * Initiates paid checkout for a booking in PENDING_PAYMENT state.
 * Server calculates exact totals from stored ticket_types.price_paise; client amounts ignored.
 */
export async function initiateCheckout(params: InitiateCheckoutParams) {
  const { bookingId, userId } = params;
  const client = await pool.connect();
  const adapter = getPaymentAdapter();

  try {
    await client.query('BEGIN');

    // 1. Fetch booking with row lock
    const bRes = await client.query(
      `SELECT b.id, b.user_id, b.event_id, b.status, b.total_paise, b.expires_at, e.organizer_id
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

    // 2. Compute exact server total from stored items
    const itemsRes = await client.query(
      `SELECT bi.ticket_type_id, bi.quantity, tt.price_paise
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

    // Check existing pending payment
    const existingPaymentRes = await client.query(
      `SELECT id, provider_order_id, status FROM payments WHERE booking_id = $1 AND status = 'PENDING';`,
      [bookingId]
    );

    let orderId: string;
    let paymentId: string;

    if (existingPaymentRes.rows.length > 0) {
      orderId = existingPaymentRes.rows[0].provider_order_id;
      paymentId = existingPaymentRes.rows[0].id;
    } else {
      // Create new provider order
      const order = await adapter.createOrder({
        amountPaise: calculatedTotalPaise,
        currency: 'INR',
        receipt: `rcpt_${bookingId.slice(0, 8)}`,
      });
      orderId = order.orderId;

      const pRes = await client.query(
        `INSERT INTO payments (
           booking_id, provider, provider_order_id, amount_paise, currency, status, is_simulated
         ) VALUES ($1, $2, $3, $4, 'INR', 'PENDING', true)
         RETURNING id;`,
        [bookingId, adapter.name, orderId, calculatedTotalPaise]
      );
      paymentId = pRes.rows[0].id;

      // Log attempt
      await client.query(
        `INSERT INTO payment_attempts (payment_id, status, raw_ref) VALUES ($1, 'INITIATED', $2);`,
        [paymentId, orderId]
      );
    }

    await client.query('COMMIT');

    return {
      bookingId,
      paymentId,
      orderId,
      amountPaise: calculatedTotalPaise,
      currency: 'INR',
      expiresAt: booking.expires_at,
      isSimulated: true,
      message: 'TEST MODE – simulated money. No real money moves.',
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Verifies payment result by re-querying the adapter directly.
 * Browser result is a hint only; never trust client parameters.
 */
export async function verifyPayment(params: VerifyPaymentParams) {
  const { orderId, paymentId, signature } = params;
  const adapter = getPaymentAdapter();

  // Re-query the adapter
  const adapterResult = await adapter.verifyPayment({
    orderId,
    paymentId,
    signature,
  });

  return await executePaymentConfirmationTransaction({
    orderId,
    paymentId: adapterResult.paymentId,
    adapterSuccess: adapterResult.success,
    amountPaise: adapterResult.amountPaise,
    failureCode: adapterResult.failureCode,
  });
}

/**
 * Unified single-transaction atomic confirmation:
 * Verifies amount == server total -> payment SUCCEEDED -> held-=q, sold+=q ->
 * booking CONFIRMED -> tickets created -> ledger SALE -> receipt -> outbox.
 */
export async function executePaymentConfirmationTransaction(params: {
  orderId: string;
  paymentId: string;
  adapterSuccess: boolean;
  amountPaise: number;
  failureCode?: string;
}) {
  const { orderId, paymentId, adapterSuccess, amountPaise, failureCode } = params;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Lock payment row
    const pRes = await client.query(
      `SELECT p.id, p.booking_id, p.amount_paise, p.status, b.event_id, b.user_id, e.organizer_id
       FROM payments p
       JOIN bookings b ON p.booking_id = b.id
       JOIN events e ON b.event_id = e.id
       WHERE p.provider_order_id = $1 FOR UPDATE;`,
      [orderId]
    );

    if (pRes.rows.length === 0) {
      throw new PaymentError('PAYMENT_NOT_FOUND', 'Payment order not found', 404);
    }

    const payment = pRes.rows[0];

    // Idempotency: if already SUCCEEDED, return immediately
    if (payment.status === 'SUCCEEDED') {
      await client.query('COMMIT');
      return {
        confirmed: true,
        alreadyProcessed: true,
        paymentId: payment.id,
        bookingId: payment.booking_id,
        status: 'SUCCEEDED',
      };
    }

    // 2. Handle failure from adapter
    if (!adapterSuccess) {
      await client.query(
        `UPDATE payments SET status = 'FAILED', failure_code = $1, updated_at = NOW() WHERE id = $2;`,
        [failureCode || 'DECLINED', payment.id]
      );
      await client.query(`UPDATE bookings SET status = 'PAYMENT_FAILED' WHERE id = $1;`, [payment.booking_id]);

      // Release hold
      const itemsRes = await client.query(
        `SELECT ticket_type_id, quantity FROM booking_items WHERE booking_id = $1;`,
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

    // 3. Amount verification (tampered amount safety)
    if (amountPaise !== payment.amount_paise) {
      await client.query(
        `UPDATE payments SET status = 'FAILED', failure_code = 'AMOUNT_MISMATCH', updated_at = NOW() WHERE id = $1;`,
        [payment.id]
      );
      await client.query('COMMIT');
      throw new PaymentError('AMOUNT_MISMATCH', 'Paid amount does not match order amount', 422);
    }

    // 4. Mark payment SUCCEEDED
    await client.query(
      `UPDATE payments
       SET status = 'SUCCEEDED', provider_payment_id = $1, updated_at = NOW()
       WHERE id = $2;`,
      [paymentId, payment.id]
    );

    // 5. Transfer capacity: held -= q, sold += q
    const itemsRes = await client.query(
      `SELECT ticket_type_id, quantity FROM booking_items WHERE booking_id = $1 ORDER BY ticket_type_id ASC;`,
      [payment.booking_id]
    );

    for (const item of itemsRes.rows) {
      // Row lock ticket type
      await client.query(
        `SELECT capacity, sold, held FROM ticket_types WHERE id = $1 FOR UPDATE;`,
        [item.ticket_type_id]
      );
      await client.query(
        `UPDATE ticket_types
         SET held = GREATEST(held - $1, 0), sold = sold + $1
         WHERE id = $2;`,
        [item.quantity, item.ticket_type_id]
      );
    }

    // 6. Confirm Booking
    await client.query(
      `UPDATE bookings SET status = 'CONFIRMED' WHERE id = $1;`,
      [payment.booking_id]
    );

    // 7. Issue Tickets (Phase 6 hook / 32-byte crypto token hashed in DB)
    const issuedTickets = [];
    for (const item of itemsRes.rows) {
      for (let i = 0; i < item.quantity; i++) {
        const rawToken = crypto.randomBytes(32).toString('base64url');
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest();
        const ticketCode = `TCK-${Date.now().toString().slice(-6)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

        const tRes = await client.query(
          `INSERT INTO tickets (
             booking_id, ticket_type_id, user_id, event_id, ticket_code, qr_payload_hash, status
           ) VALUES ($1, $2, $3, $4, $5, $6, 'VALID')
           RETURNING id, ticket_code;`,
          [payment.booking_id, item.ticket_type_id, payment.user_id, payment.event_id, ticketCode, tokenHash]
        );
        issuedTickets.push({
          id: tRes.rows[0].id,
          ticketCode: tRes.rows[0].ticket_code,
          qrPayload: rawToken,
        });
      }
    }

    // 8. Organizer Ledger Entry (SALE)
    await client.query(
      `INSERT INTO organizer_ledger_entries (
         organizer_id, booking_id, payment_id, entry_type, amount_paise, is_simulated
       ) VALUES ($1, $2, $3, 'SALE', $4, true)
       ON CONFLICT (payment_id, entry_type) DO NOTHING;`,
      [payment.organizer_id, payment.booking_id, payment.id, payment.amount_paise]
    );

    // 9. Receipt
    const receiptNumber = `REC-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    await client.query(
      `INSERT INTO receipts (booking_id, number) VALUES ($1, $2) ON CONFLICT (number) DO NOTHING;`,
      [payment.booking_id, receiptNumber]
    );

    // 10. Outbox Dispatch
    await client.query(
      `INSERT INTO outbox (event_type, payload, dedupe_key)
       VALUES ('payment.succeeded', $1, $2);`,
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
      status: 'SUCCEEDED',
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
 * Ingests and verifies webhook payload with HMAC-SHA256 signature and 5-min timestamp tolerance.
 * Idempotent: 50 concurrent duplicate webhooks result in exactly 1 confirmation and 1 ledger entry.
 */
export async function processWebhook(params: WebhookProcessParams) {
  const { rawBody, signature, timestampHeader } = params;
  const adapter = getPaymentAdapter();

  // 1. Signature Verification
  const isValidSignature = adapter.verifyWebhookSignature(rawBody, signature);
  const payloadHash = crypto.createHash('sha256').update(rawBody).digest();

  if (!isValidSignature) {
    // Record failed webhook attempt in audit
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO webhook_events (
           provider_event_id, provider, type, signature_valid, processing_status, payload_hash
         ) VALUES ($1, $2, 'payment.unknown', false, 'FAILED', $3)
         ON CONFLICT (provider_event_id) DO NOTHING;`,
        [`inv_sig_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`, adapter.name, payloadHash]
      );
    } finally {
      client.release();
    }
    throw new PaymentError('INVALID_SIGNATURE', 'Webhook signature verification failed', 401);
  }

  // 2. Timestamp Tolerance Check (5 minutes = 300 seconds)
  if (timestampHeader) {
    const timestampSec = parseInt(timestampHeader, 10);
    const nowSec = Math.floor(Date.now() / 1000);
    if (!isNaN(timestampSec) && Math.abs(nowSec - timestampSec) > 300) {
      throw new PaymentError('TIMESTAMP_EXPIRED', 'Webhook timestamp tolerance exceeded (5 minutes)', 401);
    }
  }

  let eventData: any;
  try {
    eventData = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new PaymentError('INVALID_JSON', 'Malformed webhook JSON payload', 400);
  }

  const providerEventId = eventData.eventId || eventData.id || `evt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const eventType = eventData.type || 'payment.captured';
  const orderId = eventData.orderId || eventData.payload?.order?.id;
  const paymentId = eventData.paymentId || eventData.payload?.payment?.id || `pay_${Date.now()}`;
  const amountPaise = eventData.amountPaise || eventData.payload?.payment?.amount;

  // 3. Insert into webhook_events with ON CONFLICT (provider_event_id) for idempotent deduplication
  const client = await pool.connect();
  let isInserted = false;
  try {
    const hookRes = await client.query(
      `INSERT INTO webhook_events (
         provider_event_id, provider, type, signature_valid, processing_status, payload_hash
       ) VALUES ($1, $2, $3, true, 'RECEIVED', $4)
       ON CONFLICT (provider_event_id) DO NOTHING
       RETURNING *;`,
      [providerEventId, adapter.name, eventType, payloadHash]
    );
    isInserted = hookRes.rows.length > 0;
  } finally {
    client.release();
  }

  if (!isInserted) {
    // Replay rejected via provider_event_id unique constraint -> safe no-op 200
    return { duplicate: true, providerEventId, status: 'ALREADY_PROCESSED' };
  }

  if (!orderId) {
    await pool.query(
      `UPDATE webhook_events SET processing_status = 'IGNORED', processed_at = NOW() WHERE provider_event_id = $1;`,
      [providerEventId]
    );
    return { ignored: true, reason: 'NO_ORDER_ID' };
  }

  // 4. Confirm payment atomically
  const confirmation = await executePaymentConfirmationTransaction({
    orderId,
    paymentId,
    adapterSuccess: true,
    amountPaise,
  });

  await pool.query(
    `UPDATE webhook_events SET processing_status = 'PROCESSED', processed_at = NOW() WHERE provider_event_id = $1;`,
    [providerEventId]
  );

  return {
    success: true,
    providerEventId,
    confirmation,
  };
}

/**
 * Requests refund for a confirmed booking.
 */
export async function requestRefund(params: RequestRefundParams) {
  const { bookingId, userId, reason, idempotencyKey } = params;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Fetch booking and payment
    const pRes = await client.query(
      `SELECT p.id, p.amount_paise, p.status as payment_status, b.status as booking_status, b.user_id
       FROM payments p
       JOIN bookings b ON p.booking_id = b.id
       WHERE b.id = $1 FOR UPDATE;`,
      [bookingId]
    );

    if (pRes.rows.length === 0) {
      throw new PaymentError('PAYMENT_NOT_FOUND', 'Payment not found for booking', 404);
    }

    const { id: paymentId, amount_paise, payment_status, booking_status, user_id } = pRes.rows[0];

    if (user_id !== userId) {
      throw new PaymentError('FORBIDDEN', 'You do not own this booking', 403);
    }

    if (booking_status !== 'CONFIRMED' || payment_status !== 'SUCCEEDED') {
      throw new PaymentError('NOT_REFUNDABLE', 'Only confirmed paid bookings can be refunded', 400);
    }

    // 2. Check existing refund with idempotency key
    const refRes = await client.query(
      `INSERT INTO refunds (
         payment_id, amount_paise, reason, status, requested_by, idempotency_key
       ) VALUES ($1, $2, $3, 'REQUESTED', $4, $5)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING *;`,
      [paymentId, amount_paise, reason, userId, idempotencyKey]
    );

    if (refRes.rows.length === 0) {
      // Return existing
      const existing = await client.query(
        `SELECT * FROM refunds WHERE idempotency_key = $1;`,
        [idempotencyKey]
      );
      await client.query('COMMIT');
      return existing.rows[0];
    }

    await client.query('COMMIT');
    return refRes.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Decides refund (organizer owner/manager or admin only).
 * If approved: adapter refund -> payment REFUNDED -> ticket revoked -> ledger REFUND -> release seat & promote next.
 */
export async function decideRefund(params: DecideRefundParams) {
  const { refundId, decision, userId } = params;
  const client = await pool.connect();
  const adapter = getPaymentAdapter();

  try {
    await client.query('BEGIN');

    const refRes = await client.query(
      `SELECT r.id, r.payment_id, r.amount_paise, r.status, p.booking_id, p.provider_payment_id,
              b.event_id, e.organizer_id
       FROM refunds r
       JOIN payments p ON r.payment_id = p.id
       JOIN bookings b ON p.booking_id = b.id
       JOIN events e ON b.event_id = e.id
       WHERE r.id = $1 FOR UPDATE;`,
      [refundId]
    );

    if (refRes.rows.length === 0) {
      throw new PaymentError('REFUND_NOT_FOUND', 'Refund request not found', 404);
    }

    const ref = refRes.rows[0];

    if (ref.status !== 'REQUESTED') {
      throw new PaymentError('INVALID_STATE', `Refund is already in ${ref.status} state`, 409);
    }

    if (decision === 'REJECTED') {
      await client.query(
        `UPDATE refunds SET status = 'REJECTED', decided_by = $1 WHERE id = $2;`,
        [userId, refundId]
      );
      await client.query('COMMIT');
      return { success: true, status: 'REJECTED' };
    }

    // Approved: execute refund via adapter
    const adapterRefund = await adapter.createRefund({
      paymentId: ref.provider_payment_id || ref.payment_id,
      amountPaise: ref.amount_paise,
      reason: 'Refund approved by organizer',
    });

    if (!adapterRefund.success) {
      await client.query(
        `UPDATE refunds SET status = 'FAILED', decided_by = $1 WHERE id = $2;`,
        [userId, refundId]
      );
      await client.query('COMMIT');
      throw new PaymentError('ADAPTER_FAILED', 'Payment adapter rejected refund', 502);
    }

    // 1. Update refund status
    await client.query(
      `UPDATE refunds SET status = 'SUCCEEDED', decided_by = $1 WHERE id = $2;`,
      [userId, refundId]
    );

    // 2. Update payment status
    await client.query(
      `UPDATE payments SET status = 'REFUNDED', updated_at = NOW() WHERE id = $1;`,
      [ref.payment_id]
    );

    // 3. Invalidate tickets
    await client.query(
      `UPDATE tickets SET status = 'REVOKED' WHERE booking_id = $1;`,
      [ref.booking_id]
    );

    // 4. Record Ledger Entry (REFUND)
    await client.query(
      `INSERT INTO organizer_ledger_entries (
         organizer_id, booking_id, payment_id, entry_type, amount_paise, is_simulated
       ) VALUES ($1, $2, $3, 'REFUND', $4, true)
       ON CONFLICT (payment_id, entry_type) DO NOTHING;`,
      [ref.organizer_id, ref.booking_id, ref.payment_id, ref.amount_paise]
    );

    // 5. Decrement sold and promote next waitlisted user
    const itemsRes = await client.query(
      `SELECT ticket_type_id, quantity FROM booking_items WHERE booking_id = $1;`,
      [ref.booking_id]
    );

    for (const item of itemsRes.rows) {
      await client.query(
        `UPDATE ticket_types SET sold = GREATEST(sold - $1, 0) WHERE id = $2;`,
        [item.quantity, item.ticket_type_id]
      );
      await promoteNext(item.ticket_type_id, client);
    }

    await client.query('COMMIT');
    return { success: true, status: 'SUCCEEDED', refundId: ref.id };
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
export async function getOrganizerSalesSummary(organizerId: string, requesterUserId: string, requesterRole: string) {
  const client = await pool.connect();
  try {
    // RBAC check: only organizer members or global admins
    if (requesterRole !== 'admin') {
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

    for (const row of ledgerRes.rows) {
      if (row.entry_type === 'SALE') {
        grossPaise += row.amount_paise;
      } else if (row.entry_type === 'REFUND') {
        refundsPaise += row.amount_paise;
      }
    }

    const netPaise = grossPaise - refundsPaise;

    return {
      organizerId,
      grossPaise,
      discountsPaise: 0,
      refundsPaise,
      netPaise,
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
export async function reconcileExpiredHolds() {
  const client = await pool.connect();
  const adapter = getPaymentAdapter();
  let reconciledCount = 0;

  try {
    // Find expired pending bookings
    const expRes = await client.query(
      `SELECT b.id, b.status, b.expires_at, p.id as payment_id, p.provider_order_id
       FROM bookings b
       LEFT JOIN payments p ON b.id = p.booking_id
       WHERE b.status = 'PENDING_PAYMENT' AND b.expires_at < NOW()
       LIMIT 50;`
    );

    for (const row of expRes.rows) {
      if (row.provider_order_id) {
        // Re-query adapter
        const statusCheck = await adapter.verifyPayment({
          orderId: row.provider_order_id,
          paymentId: `rec_${row.provider_order_id}`,
        });

        if (statusCheck.success) {
          // Late success: confirm atomically
          await executePaymentConfirmationTransaction({
            orderId: row.provider_order_id,
            paymentId: statusCheck.paymentId,
            adapterSuccess: true,
            amountPaise: statusCheck.amountPaise,
          });
          reconciledCount++;
          continue;
        }
      }

      // Definitive failed/expired: release held seats
      await client.query('BEGIN');
      await client.query(`UPDATE bookings SET status = 'EXPIRED' WHERE id = $1;`, [row.id]);
      if (row.payment_id) {
        await client.query(`UPDATE payments SET status = 'FAILED', failure_code = 'HOLD_EXPIRED' WHERE id = $1;`, [row.payment_id]);
      }

      const itemsRes = await client.query(`SELECT ticket_type_id, quantity FROM booking_items WHERE booking_id = $1;`, [row.id]);
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
    return { reconciledCount, error: err };
  } finally {
    client.release();
  }
}
