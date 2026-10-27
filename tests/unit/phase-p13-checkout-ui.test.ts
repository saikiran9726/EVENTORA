import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import crypto from 'crypto';
import { pool } from '../../packages/backend/src/db/index.js';
import { buildApp } from '../../packages/backend/src/app.js';
import { FakeYouPiServer } from '../fakes/youpi-server.js';
import {
  initiateCheckout,
  getPaymentStatus,
  handleSlotActivation,
  reconcileExpiredHolds,
} from '../../packages/backend/src/services/payment.js';
import { youpiAdapter } from '../../packages/backend/src/services/payment-adapter.js';
import { FastifyInstance } from 'fastify';

describe('Phase P13: Checkout UI, YouPI Status Polling & Verification Queue', () => {
  let app: FastifyInstance;
  let fakeYouPi: FakeYouPiServer;
  let youpiBaseUrl: string;

  let collegeId: string;
  let orgAUserId: string;
  let orgBUserId: string;
  let organizerAId: string;
  let organizerBId: string;
  let eventId: string;
  let ticketTypeId: string;

  let orgAHeaders: Record<string, string>;

  const testWebhookSecret = 'youpi_test_webhook_secret_key_2026';
  const originalEnv = { ...process.env };

  async function createSessionForUser(userId: string): Promise<Record<string, string>> {
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const csrfToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(sessionToken).digest();

    await pool.query(
      `INSERT INTO sessions (id_hash, user_id, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '1 day');`,
      [tokenHash, userId]
    );

    return {
      cookie: `eventora_session=${sessionToken}; eventora_csrf=${csrfToken}`,
      'x-csrf-token': csrfToken,
    };
  }

  async function createStudentUser() {
    const client = await pool.connect();
    try {
      const uRes = await client.query(
        `INSERT INTO users (college_id, email, password_hash, display_name, global_role, status)
         VALUES ($1, $2, 'hash', 'Student Attending', 'student', 'active')
         RETURNING id;`,
        [collegeId, `p13.student.${Date.now()}.${Math.floor(Math.random() * 1000000)}@campus.edu`]
      );
      const userId = uRes.rows[0].id;
      const headers = await createSessionForUser(userId);
      return { userId, headers };
    } finally {
      client.release();
    }
  }

  beforeAll(async () => {
    fakeYouPi = new FakeYouPiServer();
    fakeYouPi.webhookSecret = testWebhookSecret;
    youpiBaseUrl = await fakeYouPi.start();

    process.env.PAYMENT_PROVIDER = 'youpi';
    process.env.YOUPI_API_BASE_URL = youpiBaseUrl;
    process.env.YOUPI_CHECKOUT_BASE_URL = youpiBaseUrl;
    process.env.YOUPI_WEBHOOK_SECRET = testWebhookSecret;
    process.env.YOUPI_DAILY_LIMIT = '500';

    youpiAdapter.setApiUrl(youpiBaseUrl);
    youpiAdapter.setWebhookSecret(testWebhookSecret);

    app = buildApp();
    await app.ready();

    const client = await pool.connect();
    try {
      const cRes = await client.query('SELECT id FROM colleges LIMIT 1;');
      collegeId = cRes.rows[0].id;

      const uRes = await client.query(
        `INSERT INTO users (college_id, email, password_hash, display_name, global_role, status)
         VALUES
           ($1, $2, 'hash', 'Org A Admin', 'student', 'active'),
           ($1, $3, 'hash', 'Org B Lead', 'student', 'active')
         RETURNING id;`,
        [
          collegeId,
          `youpi.p13.orga.${Date.now()}@campus.edu`,
          `youpi.p13.orgb.${Date.now()}@campus.edu`,
        ]
      );
      orgAUserId = uRes.rows[0].id;
      orgBUserId = uRes.rows[1].id;

      const p1 = await client.query(
        `INSERT INTO organizer_profiles (college_id, display_name, status, created_by)
         VALUES ($1, 'P13 Robotics Club', 'verified', $2) RETURNING id;`,
        [collegeId, orgAUserId]
      );
      organizerAId = p1.rows[0].id;

      const p2 = await client.query(
        `INSERT INTO organizer_profiles (college_id, display_name, status, created_by)
         VALUES ($1, 'P13 Debate Society', 'verified', $2) RETURNING id;`,
        [collegeId, orgBUserId]
      );
      organizerBId = p2.rows[0].id;

      await client.query(
        `INSERT INTO organizer_members (organizer_id, user_id, role, status)
         VALUES
           ($1, $2, 'owner', 'active'),
           ($3, $4, 'owner', 'active');`,
        [organizerAId, orgAUserId, organizerBId, orgBUserId]
      );

      const slug = `p13-symposium-${Date.now()}`;
      const eRes = await client.query(
        `INSERT INTO events (
           college_id, organizer_id, title, slug, description, category,
           format, starts_at, ends_at, capacity, pricing_type, status, contact_email, created_by
         ) VALUES (
           $1, $2, 'P13 Tech Symposium', $3, 'Annual fest', 'technology',
           'in_person', NOW() + INTERVAL '10 days', NOW() + INTERVAL '11 days', 100, 'paid', 'published', 'contact@p13.org', $4
         ) RETURNING id;`,
        [collegeId, organizerAId, slug, orgAUserId]
      );
      eventId = eRes.rows[0].id;

      const ttRes = await client.query(
        `INSERT INTO ticket_types (event_id, name, capacity, price_paise, held, sold)
         VALUES ($1, 'General Delegate', 100, 25000, 0, 0)
         RETURNING id;`,
        [eventId]
      );
      ticketTypeId = ttRes.rows[0].id;

      orgAHeaders = await createSessionForUser(orgAUserId);
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    await app.close();
    await fakeYouPi.stop();
    process.env = originalEnv;
  });

  beforeEach(() => {
    fakeYouPi.reset();
  });

  async function createTestBooking(
    userId: string,
    amountPaise = 25000,
    quantity = 1
  ): Promise<{ bookingId: string }> {
    const client = await pool.connect();
    try {
      const bRes = await client.query(
        `INSERT INTO bookings (user_id, event_id, status, total_paise, idempotency_key, expires_at)
         VALUES ($1, $2, 'PENDING_PAYMENT', $3, $4, NOW() + INTERVAL '15 minutes')
         RETURNING id;`,
        [userId, eventId, amountPaise, `idem_p13_${Date.now()}_${Math.random()}`]
      );
      const bookingId = bRes.rows[0].id;

      await client.query(
        `INSERT INTO booking_items (booking_id, ticket_type_id, quantity, unit_price_paise)
         VALUES ($1, $2, $3, $4);`,
        [bookingId, ticketTypeId, quantity, amountPaise / quantity]
      );

      await client.query(`UPDATE ticket_types SET held = held + $1 WHERE id = $2;`, [quantity, ticketTypeId]);

      return { bookingId };
    } finally {
      client.release();
    }
  }

  // 1. Payment status endpoint ownership & security
  describe('1. GET /payments/:id/status Route Authorization & Ownership Security', () => {
    it('allows booking owner to poll payment status and returns PENDING before webhook', async () => {
      const { userId, headers } = await createStudentUser();
      const { bookingId } = await createTestBooking(userId);
      const order = await initiateCheckout({ bookingId, userId });

      // Owner polls status
      const res = await app.inject({
        method: 'GET',
        url: `/payments/${order.paymentId}/status`,
        headers,
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.id).toBe(order.paymentId);
      expect(data.bookingId).toBe(bookingId);
      expect(data.status).toBe('PENDING');
      expect(data.amountPaise).toBe(25000);
      expect(data.tickets).toEqual([]); // No tickets before webhook confirmation!
      expect(data.receiptNumber).toBeNull();
    });

    it('rejects unauthorized students with 403 (IDOR Isolation)', async () => {
      const studentA = await createStudentUser();
      const studentB = await createStudentUser();
      const { bookingId } = await createTestBooking(studentA.userId);
      const order = await initiateCheckout({ bookingId, userId: studentA.userId });

      // Student B attempts to snoop Student A's payment status
      const res = await app.inject({
        method: 'GET',
        url: `/payments/${order.paymentId}/status`,
        headers: studentB.headers,
      });

      expect(res.statusCode).toBe(403);
      const data = JSON.parse(res.body);
      expect(data.error.code).toBe('FORBIDDEN');
    });

    it('allows event organizer to inspect payment status', async () => {
      const studentA = await createStudentUser();
      const { bookingId } = await createTestBooking(studentA.userId);
      const order = await initiateCheckout({ bookingId, userId: studentA.userId });

      // Organizer A inspects student's payment status
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/payments/${order.paymentId}/status`,
        headers: orgAHeaders,
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.id).toBe(order.paymentId);
    });
  });

  // 2. Browser callback alone is NEVER proof of payment
  describe('2. Browser Callback Invariant: No code path marks payment SUCCEEDED from browser state alone', () => {
    it('leaves payment in PENDING when browser callback triggers without webhook arrival', async () => {
      const { userId, headers } = await createStudentUser();
      const { bookingId } = await createTestBooking(userId);
      const order = await initiateCheckout({ bookingId, userId });

      // Verify initial status is PENDING
      const preCheck = await getPaymentStatus({
        paymentId: order.paymentId,
        userId,
      });
      expect(preCheck.status).toBe('PENDING');
      expect(preCheck.bookingStatus).toBe('PENDING_PAYMENT');

      // Attempting to invoke verify without a verified webhook confirmation refuses to confirm
      const verifyRes = await app.inject({
        method: 'POST',
        url: '/api/v1/payments/verify',
        headers,
        payload: {
          orderId: order.orderId,
          paymentId: order.paymentId,
        },
      });

      // Browser verify returns 400 PAYMENT_FAILED because gateway webhook hasn't settled it
      expect(verifyRes.statusCode).toBe(400);

      // Verify payment cannot be confirmed by browser state alone
      const postCheck = await getPaymentStatus({
        paymentId: order.paymentId,
        userId,
      });
      expect(postCheck.status).not.toBe('SUCCESS');
      expect(postCheck.bookingStatus).not.toBe('CONFIRMED');
      expect(postCheck.tickets).toHaveLength(0);
    });
  });

  // 3. Happy path: pay -> webhook -> status polling transitions to SUCCESS
  describe('3. Happy Path: Webhook Delivery -> Authoritative SUCCESS & Ticket Fulfillment', () => {
    it('fulfills booking and generates digital receipt once verified webhook arrives', async () => {
      const { userId, headers } = await createStudentUser();
      const { bookingId } = await createTestBooking(userId);
      const order = await initiateCheckout({ bookingId, userId });

      // Generate signed webhook from fake YouPI gateway with unique 12-digit UTR
      const utr = `${Math.floor(100000000000 + Math.random() * 900000000000)}`;
      const webhook = fakeYouPi.generateWebhookPayload(order.orderId, {
        event: 'SUCCESS',
        utr,
      });

      // Webhook delivered to Eventora
      const whRes = await app.inject({
        method: 'POST',
        url: '/webhooks/payments/youpi',
        headers: webhook.headers,
        payload: webhook.rawBody,
      });
      expect(whRes.statusCode).toBe(200);

      // Status polling now returns SUCCESS with tickets and receipt
      const pollRes = await app.inject({
        method: 'GET',
        url: `/payments/${order.paymentId}/status`,
        headers,
      });

      expect(pollRes.statusCode).toBe(200);
      const statusData = JSON.parse(pollRes.body);
      expect(statusData.status).toBe('SUCCESS');
      expect(statusData.bookingStatus).toBe('CONFIRMED');
      expect(statusData.utr).toBe(utr);
      expect(statusData.receiptNumber).toMatch(/^REC-/);
      expect(statusData.tickets.length).toBeGreaterThan(0);
      expect(statusData.tickets[0].ticket_code).toBeDefined();
    });
  });

  // 4. Verification Queue Resolution (Organizer manual review)
  describe('4. Verification Queue: Flagged Payment Inspection, Approval & Fulfilment', () => {
    it('routes mismatched payment to VERIFICATION_QUEUE and organizer approves with atomic fulfillment', async () => {
      const { userId } = await createStudentUser();
      const { bookingId } = await createTestBooking(userId);
      const order = await initiateCheckout({ bookingId, userId });

      // Simulate a webhook with amount mismatch (e.g. 20000 paise instead of 25000 paise)
      const utr = `${Math.floor(100000000000 + Math.random() * 900000000000)}`;
      const mismatchWebhook = fakeYouPi.generateWebhookPayload(order.orderId, {
        event: 'SUCCESS',
        amountPaise: 20000,
        utr,
      });

      // Gateway sends webhook
      const whRes = await app.inject({
        method: 'POST',
        url: '/webhooks/payments/youpi',
        headers: mismatchWebhook.headers,
        payload: mismatchWebhook.rawBody,
      });
      expect(whRes.statusCode).toBe(200);

      // Payment is now in VERIFICATION_QUEUE
      const statusRes = await getPaymentStatus({
        paymentId: order.paymentId,
        userId,
      });
      expect(statusRes.status).toBe('VERIFICATION_QUEUE');
      expect(statusRes.verificationQueueReason).toContain('Amount mismatch');

      // Organizer lists items in Verification Queue
      const queueRes = await app.inject({
        method: 'GET',
        url: '/api/v1/organizer/payments/verification-queue',
        headers: orgAHeaders,
      });

      expect(queueRes.statusCode).toBe(200);
      const queueData = JSON.parse(queueRes.body);
      const flaggedItem = queueData.items.find((i: any) => i.id === order.paymentId);
      expect(flaggedItem).toBeDefined();
      expect(flaggedItem.verification_queue_reason).toMatch(/amount mismatch/i);

      // Organizer reviews and approves the payment
      const resolveRes = await app.inject({
        method: 'POST',
        url: `/api/v1/organizer/payments/${order.paymentId}/resolve-verification`,
        headers: orgAHeaders,
        payload: {
          resolution: 'CONFIRM',
          notes: 'Verified remaining credit received on bank statement',
        },
      });

      expect(resolveRes.statusCode).toBe(200);
      const resolvedData = JSON.parse(resolveRes.body);
      expect(resolvedData.success).toBe(true);

      // Status polling now returns SUCCESS with issued tickets
      const finalStatus = await getPaymentStatus({
        paymentId: order.paymentId,
        userId,
      });
      expect(finalStatus.status).toBe('SUCCESS');
      expect(finalStatus.bookingStatus).toBe('CONFIRMED');
      expect(finalStatus.tickets.length).toBeGreaterThan(0);
    });

    it('rejects flagged payment and releases held seats back to capacity pool', async () => {
      const { userId } = await createStudentUser();
      const { bookingId } = await createTestBooking(userId);
      const order = await initiateCheckout({ bookingId, userId });

      // Manually set to VERIFICATION_QUEUE
      const client = await pool.connect();
      try {
        await client.query(
          `UPDATE payments SET status = 'VERIFICATION_QUEUE', verification_queue_reason = 'SUSPICIOUS_IP' WHERE id = $1;`,
          [order.paymentId]
        );
      } finally {
        client.release();
      }

      // Organizer rejects the payment
      const resolveRes = await app.inject({
        method: 'POST',
        url: `/api/v1/organizer/payments/${order.paymentId}/resolve-verification`,
        headers: orgAHeaders,
        payload: {
          resolution: 'REJECT',
          notes: 'Fraudulent transaction attempt flagged',
        },
      });

      expect(resolveRes.statusCode).toBe(200);

      // Verify payment is FAILED and booking is CANCELLED
      const statusRes = await getPaymentStatus({
        paymentId: order.paymentId,
        userId,
      });
      expect(statusRes.status).toBe('FAILED');
      expect(statusRes.bookingStatus).toBe('CANCELLED');
    });
  });

  // 5. Single-slot Queue Hold Extension
  describe('5. Single-slot FIFO Queue: Hold Extension & Slot Activation', () => {
    it('extends hold timer by 5 minutes upon slot activation', async () => {
      const { userId } = await createStudentUser();
      const { bookingId } = await createTestBooking(userId);

      // Simulate a queued order
      const client = await pool.connect();
      let paymentId: string;
      try {
        paymentId = crypto.randomUUID();
        await client.query(
          `INSERT INTO payments (id, booking_id, provider, provider_order_id, amount_paise, status, slot_active, queue_position)
           VALUES ($1, $2, 'youpi', $3, 25000, 'QUEUED', false, 2);`,
          [paymentId, bookingId, `order_${paymentId}`]
        );
      } finally {
        client.release();
      }

      // Slot activates
      const activation = await handleSlotActivation(paymentId);
      expect(activation.success).toBe(true);

      // Verify hold was extended
      const checkRes = await getPaymentStatus({
        paymentId,
        userId,
      });
      expect(checkRes.slotActive).toBe(true);
      expect(checkRes.status).toBe('PENDING');
      expect(new Date(checkRes.bookingExpiresAt).getTime()).toBeGreaterThan(Date.now() + 4 * 60 * 1000);
    });
  });

  // 6. Expired hold frees seats
  describe('6. Expired Hold Frees Seats & Rejects Checkout with HOLD_EXPIRED', () => {
    it('reconciles expired holds and rejects initiateCheckout with HOLD_EXPIRED / INVALID_STATE', async () => {
      const { userId, headers } = await createStudentUser();
      const { bookingId } = await createTestBooking(userId);

      // Manually set booking expires_at in the past
      const client = await pool.connect();
      try {
        await client.query(
          `UPDATE bookings SET expires_at = NOW() - INTERVAL '5 minutes' WHERE id = $1;`,
          [bookingId]
        );
      } finally {
        client.release();
      }

      // Run expired holds reconciler
      const recon = await reconcileExpiredHolds();
      expect(recon.reconciledCount).toBeGreaterThanOrEqual(1);

      // Attempting to checkout an expired hold rejects with HOLD_EXPIRED or INVALID_STATE
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/bookings/${bookingId}/checkout`,
        headers,
      });

      expect([409, 410]).toContain(res.statusCode);
      const body = JSON.parse(res.body);
      expect(['HOLD_EXPIRED', 'INVALID_STATE']).toContain(body.error.code);
    });
  });

  // 7. Duplicate & late webhooks
  describe('7. Webhook Idempotency: Duplicate webhooks return 200 without double-crediting', () => {
    it('handles duplicate deliveries gracefully', async () => {
      const { userId } = await createStudentUser();
      const { bookingId } = await createTestBooking(userId);
      const order = await initiateCheckout({ bookingId, userId });

      const utr = `${Math.floor(100000000000 + Math.random() * 900000000000)}`;
      const webhook = fakeYouPi.generateWebhookPayload(order.orderId, {
        event: 'SUCCESS',
        utr,
      });

      // Delivery 1
      const res1 = await app.inject({
        method: 'POST',
        url: '/webhooks/payments/youpi',
        headers: webhook.headers,
        payload: webhook.rawBody,
      });
      expect(res1.statusCode).toBe(200);

      // Delivery 2 (Duplicate)
      const res2 = await app.inject({
        method: 'POST',
        url: '/webhooks/payments/youpi',
        headers: webhook.headers,
        payload: webhook.rawBody,
      });
      expect(res2.statusCode).toBe(200);
      const data2 = JSON.parse(res2.body);
      expect(data2.result?.deduplicated).toBe(true);

      // Assert only 1 ledger entry and 1 ticket created
      const client = await pool.connect();
      try {
        const tCount = await client.query('SELECT COUNT(*)::int as count FROM tickets WHERE booking_id = $1;', [bookingId]);
        expect(tCount.rows[0].count).toBe(1);

        const lCount = await client.query('SELECT COUNT(*)::int as count FROM organizer_ledger_entries WHERE booking_id = $1;', [bookingId]);
        expect(lCount.rows[0].count).toBe(1);
      } finally {
        client.release();
      }
    });
  });
});
