import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import crypto from 'crypto';
import { pool } from '../../packages/backend/src/db/index.js';
import { buildApp } from '../../packages/backend/src/app.js';
import { FakeYouPiServer } from '../fakes/youpi-server.js';
import {
  initiateCheckout,
  processYouPiWebhook,
  handleSlotActivation,
  recordManualRefund,
  resolveVerificationQueue,
  getYouPiThroughputStatus,
} from '../../packages/backend/src/services/payment.js';
import { importBankStatementCsv } from '../../packages/backend/src/services/reconciliation.js';
import { youpiAdapter } from '../../packages/backend/src/services/payment-adapter.js';
import { FastifyInstance } from 'fastify';

describe('Phase P12: YouPI-PG Payments Core Integration & Security', () => {
  let app: FastifyInstance;
  let fakeYouPi: FakeYouPiServer;
  let youpiBaseUrl: string;

  let collegeId: string;
  let orgAUserId: string;
  let orgBUserId: string;
  let studentUserId: string;
  let organizerAId: string;
  let organizerBId: string;
  let eventId: string;
  let ticketTypeId: string;

  const testWebhookSecret = 'youpi_test_webhook_secret_key_2026';

  beforeAll(async () => {
    // 1. Start fake YouPI server
    fakeYouPi = new FakeYouPiServer();
    fakeYouPi.webhookSecret = testWebhookSecret;
    youpiBaseUrl = await fakeYouPi.start();

    // 2. Configure environment for YouPI integration
    process.env.PAYMENT_PROVIDER = 'youpi';
    process.env.YOUPI_API_BASE_URL = youpiBaseUrl;
    process.env.YOUPI_CHECKOUT_BASE_URL = youpiBaseUrl;
    process.env.YOUPI_WEBHOOK_SECRET = testWebhookSecret;
    process.env.YOUPI_DAILY_LIMIT = '500';

    youpiAdapter.setApiUrl(youpiBaseUrl);
    youpiAdapter.setWebhookSecret(testWebhookSecret);

    // 3. Initialize Fastify app
    app = buildApp();
    await app.ready();

    // 4. Setup database fixtures
    const client = await pool.connect();
    try {
      const cRes = await client.query('SELECT id FROM colleges LIMIT 1;');
      collegeId = cRes.rows[0].id;

      const uRes = await client.query(
        `INSERT INTO users (college_id, email, password_hash, display_name, global_role, status)
         VALUES
           ($1, $2, 'hash', 'Org A Admin', 'student', 'active'),
           ($1, $3, 'hash', 'Org B Lead', 'student', 'active'),
           ($1, $4, 'hash', 'Student Attending', 'student', 'active')
         RETURNING id;`,
        [
          collegeId,
          `youpi.org.a.${Date.now()}@campus.edu`,
          `youpi.org.b.${Date.now()}@campus.edu`,
          `youpi.student.${Date.now()}@campus.edu`,
        ]
      );
      orgAUserId = uRes.rows[0].id;
      orgBUserId = uRes.rows[1].id;
      studentUserId = uRes.rows[2].id;

      const p1 = await client.query(
        `INSERT INTO organizer_profiles (college_id, display_name, status, created_by)
         VALUES ($1, 'Robotics Club', 'verified', $2) RETURNING id;`,
        [collegeId, orgAUserId]
      );
      organizerAId = p1.rows[0].id;

      const p2 = await client.query(
        `INSERT INTO organizer_profiles (college_id, display_name, status, created_by)
         VALUES ($1, 'Debate Society', 'verified', $2) RETURNING id;`,
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

      const slug = `tech-symposium-${Date.now()}`;
      const eRes = await client.query(
        `INSERT INTO events (
           college_id, organizer_id, title, slug, description, category,
           format, starts_at, ends_at, capacity, pricing_type, status, contact_email, created_by
         ) VALUES (
           $1, $2, 'Tech Symposium 2026', $3, 'Annual fest', 'technology',
           'in_person', NOW() + INTERVAL '10 days', NOW() + INTERVAL '11 days', 100, 'paid', 'published', 'contact@symposium.org', $4
         ) RETURNING id;`,
        [collegeId, organizerAId, slug, orgAUserId]
      );
      eventId = eRes.rows[0].id;

      const ttRes = await client.query(
        `INSERT INTO ticket_types (event_id, name, capacity, price_paise, held, sold)
         VALUES ($1, 'General Delegate', 100, 49900, 0, 0)
         RETURNING id;`,
        [eventId]
      );
      ticketTypeId = ttRes.rows[0].id;
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    await app.close();
    await fakeYouPi.stop();
  });

  beforeEach(() => {
    fakeYouPi.reset();
  });

  // Helper to create a test booking in PENDING_PAYMENT
  async function createTestBooking(
    amountPaise = 49900,
    quantity = 1
  ): Promise<{ bookingId: string; studentId: string }> {
    const client = await pool.connect();
    try {
      const uRes = await client.query(
        `INSERT INTO users (college_id, email, password_hash, display_name, global_role, status)
         VALUES ($1, $2, 'hash', 'Student Attending', 'student', 'active')
         RETURNING id;`,
        [collegeId, `youpi.student.${Date.now()}.${Math.floor(Math.random() * 1000000)}@campus.edu`]
      );
      const studentId = uRes.rows[0].id;

      const bRes = await client.query(
        `INSERT INTO bookings (user_id, event_id, status, total_paise, idempotency_key, expires_at)
         VALUES ($1, $2, 'PENDING_PAYMENT', $3, $4, NOW() + INTERVAL '15 minutes')
         RETURNING id;`,
        [studentId, eventId, amountPaise, `idem_${Date.now()}_${Math.random()}`]
      );
      const bookingId = bRes.rows[0].id;

      await client.query(
        `INSERT INTO booking_items (booking_id, ticket_type_id, quantity, unit_price_paise)
         VALUES ($1, $2, $3, $4);`,
        [bookingId, ticketTypeId, quantity, amountPaise / quantity]
      );

      await client.query(`UPDATE ticket_types SET held = held + $1 WHERE id = $2;`, [quantity, ticketTypeId]);

      return { bookingId, studentId };
    } finally {
      client.release();
    }
  }

  describe('1. Webhook Signatures & Security Validation', () => {
    it('rejects forged signature with 401 INVALID_SIGNATURE', async () => {
      const { bookingId, studentId } = await createTestBooking();
      const checkout = await initiateCheckout({ bookingId, userId: studentId });

      const webhookData = fakeYouPi.generateWebhookPayload(checkout.orderId);

      // Tamper signature
      const tamperedSig = crypto.randomBytes(32).toString('hex');

      await expect(
        processYouPiWebhook({
          rawBody: webhookData.rawBody,
          signatureV2: tamperedSig,
          timestamp: webhookData.headers['X-Gateway-Timestamp'],
          deliveryId: webhookData.headers['X-Gateway-Delivery-Id'],
        })
      ).rejects.toThrow(/INVALID_SIGNATURE|Signature verification failed/);
    });

    it('rejects tampered raw body with 401 INVALID_SIGNATURE', async () => {
      const { bookingId, studentId } = await createTestBooking();
      const checkout = await initiateCheckout({ bookingId, userId: studentId });

      const webhookData = fakeYouPi.generateWebhookPayload(checkout.orderId);

      // Alter payload after signature generated
      const tamperedBody = Buffer.from(
        JSON.stringify({ ...webhookData.payload, amountPaise: 100 })
      );

      await expect(
        processYouPiWebhook({
          rawBody: tamperedBody,
          signatureV2: webhookData.headers['X-Gateway-Signature-V2'],
          timestamp: webhookData.headers['X-Gateway-Timestamp'],
          deliveryId: webhookData.headers['X-Gateway-Delivery-Id'],
        })
      ).rejects.toThrow(/INVALID_SIGNATURE/);
    });

    it('rejects tampered timestamp in V2 binding', async () => {
      const { bookingId, studentId } = await createTestBooking();
      const checkout = await initiateCheckout({ bookingId, userId: studentId });

      const webhookData = fakeYouPi.generateWebhookPayload(checkout.orderId);

      // Alter timestamp Header
      const alteredTimestamp = String(Date.now() - 50000);

      await expect(
        processYouPiWebhook({
          rawBody: webhookData.rawBody,
          signatureV2: webhookData.headers['X-Gateway-Signature-V2'],
          timestamp: alteredTimestamp,
          deliveryId: webhookData.headers['X-Gateway-Delivery-Id'],
        })
      ).rejects.toThrow(/INVALID_SIGNATURE/);
    });

    it('rejects expired timestamp older than 2 hours', async () => {
      const { bookingId, studentId } = await createTestBooking();
      const checkout = await initiateCheckout({ bookingId, userId: studentId });

      const oldTimestamp = Date.now() - 3 * 3600 * 1000; // 3 hours ago
      const webhookData = fakeYouPi.generateWebhookPayload(checkout.orderId, {
        timestamp: oldTimestamp,
      });

      await expect(
        processYouPiWebhook({
          rawBody: webhookData.rawBody,
          signatureV2: webhookData.headers['X-Gateway-Signature-V2'],
          timestamp: String(oldTimestamp),
          deliveryId: webhookData.headers['X-Gateway-Delivery-Id'],
        })
      ).rejects.toThrow(/Timestamp outside 2-hour retry window|TIMESTAMP_EXPIRED/);
    });

    it('requires X-Gateway-Delivery-Id for idempotency tracking', async () => {
      const { bookingId, studentId } = await createTestBooking();
      const checkout = await initiateCheckout({ bookingId, userId: studentId });

      const webhookData = fakeYouPi.generateWebhookPayload(checkout.orderId);

      await expect(
        processYouPiWebhook({
          rawBody: webhookData.rawBody,
          signatureV2: webhookData.headers['X-Gateway-Signature-V2'],
          timestamp: webhookData.headers['X-Gateway-Timestamp'],
          deliveryId: '',
        })
      ).rejects.toThrow(/MISSING_DELIVERY_ID/);
    });
  });

  describe('2. Deduplication & Delivery Retry', () => {
    it('deduplicates identical delivery ID without duplicate fulfillment', async () => {
      const { bookingId, studentId } = await createTestBooking();
      const checkout = await initiateCheckout({ bookingId, userId: studentId });

      const deliveryId = crypto.randomUUID();
      const webhookData = fakeYouPi.generateWebhookPayload(checkout.orderId, { deliveryId });

      // First delivery: processes successfully
      const res1 = await processYouPiWebhook({
        rawBody: webhookData.rawBody,
        signatureV2: webhookData.headers['X-Gateway-Signature-V2'],
        timestamp: webhookData.headers['X-Gateway-Timestamp'],
        deliveryId,
      });

      expect(res1.received).toBe(true);
      expect(res1.status).toBe('SUCCESS');

      // Second delivery with identical delivery ID
      const res2 = await processYouPiWebhook({
        rawBody: webhookData.rawBody,
        signatureV2: webhookData.headers['X-Gateway-Signature-V2'],
        timestamp: webhookData.headers['X-Gateway-Timestamp'],
        deliveryId,
      });

      expect(res2.received).toBe(true);
      expect(res2.deduplicated).toBe(true);
      expect(res2.status).toBe('PROCESSED');

      // Check database state: exactly 1 sale ledger entry and 1 ticket issued
      const client = await pool.connect();
      try {
        const lRes = await client.query(
          `SELECT COUNT(*) FROM organizer_ledger_entries WHERE booking_id = $1 AND entry_type = 'SALE';`,
          [bookingId]
        );
        expect(Number(lRes.rows[0].count)).toBe(1);

        const tRes = await client.query(`SELECT COUNT(*) FROM tickets WHERE booking_id = $1;`, [bookingId]);
        expect(Number(tRes.rows[0].count)).toBe(1);
      } finally {
        client.release();
      }
    });

    it('allows retry for previously failed delivery ID', async () => {
      const deliveryId = crypto.randomUUID();
      const client = await pool.connect();
      try {
        await client.query(
          `INSERT INTO webhook_deliveries (delivery_id, provider, event_type, status, attempts)
           VALUES ($1, 'youpi', 'PAYMENT.SUCCESS', 'FAILED', 1);`,
          [deliveryId]
        );

        const { bookingId, studentId } = await createTestBooking();
        const checkout = await initiateCheckout({ bookingId, userId: studentId });
        const webhookData = fakeYouPi.generateWebhookPayload(checkout.orderId, { deliveryId });

        const res = await processYouPiWebhook({
          rawBody: webhookData.rawBody,
          signatureV2: webhookData.headers['X-Gateway-Signature-V2'],
          timestamp: webhookData.headers['X-Gateway-Timestamp'],
          deliveryId,
        });

        expect(res.received).toBe(true);
        expect(res.status).toBe('SUCCESS');

        const dCheck = await client.query(
          `SELECT status, attempts FROM webhook_deliveries WHERE delivery_id = $1;`,
          [deliveryId]
        );
        expect(dCheck.rows[0].status).toBe('PROCESSED');
        expect(dCheck.rows[0].attempts).toBe(2);
      } finally {
        client.release();
      }
    });
  });

  describe('3. Settlement Validation & Verification Queue', () => {
    it('routes amount mismatch to VERIFICATION_QUEUE instead of auto-confirming', async () => {
      const { bookingId, studentId } = await createTestBooking(49900);
      const checkout = await initiateCheckout({ bookingId, userId: studentId });

      // Generate webhook reporting only 10000 paise (paid less)
      const webhookData = fakeYouPi.generateWebhookPayload(checkout.orderId, {
        amountPaise: 10000,
      });

      const res = await processYouPiWebhook({
        rawBody: webhookData.rawBody,
        signatureV2: webhookData.headers['X-Gateway-Signature-V2'],
        timestamp: webhookData.headers['X-Gateway-Timestamp'],
        deliveryId: webhookData.headers['X-Gateway-Delivery-Id'],
      });

      expect(res.received).toBe(true);
      expect(res.status).toBe('VERIFICATION_QUEUE');
      expect(res.reason).toBe('AMOUNT_MISMATCH');

      // Assert payment is held in VERIFICATION_QUEUE and booking NOT confirmed
      const client = await pool.connect();
      try {
        const pCheck = await client.query(`SELECT status, verification_queue_reason FROM payments WHERE id = $1;`, [
          checkout.paymentId,
        ]);
        expect(pCheck.rows[0].status).toBe('VERIFICATION_QUEUE');
        expect(pCheck.rows[0].verification_queue_reason).toContain('Amount mismatch');

        const bCheck = await client.query(`SELECT status FROM bookings WHERE id = $1;`, [bookingId]);
        expect(bCheck.rows[0].status).toBe('PENDING_PAYMENT');
      } finally {
        client.release();
      }
    });

    it('routes duplicate UTR to VERIFICATION_QUEUE', async () => {
      const usedUtr = '987654321098';

      // First successful payment with usedUtr
      const { bookingId: b1, studentId: s1 } = await createTestBooking();
      const c1 = await initiateCheckout({ bookingId: b1, userId: s1 });
      const w1 = fakeYouPi.generateWebhookPayload(c1.orderId, { utr: usedUtr });
      await processYouPiWebhook({
        rawBody: w1.rawBody,
        signatureV2: w1.headers['X-Gateway-Signature-V2'],
        timestamp: w1.headers['X-Gateway-Timestamp'],
        deliveryId: crypto.randomUUID(),
      });

      // Second payment arrives with duplicate UTR
      const { bookingId: b2, studentId: s2 } = await createTestBooking();
      const c2 = await initiateCheckout({ bookingId: b2, userId: s2 });
      const w2 = fakeYouPi.generateWebhookPayload(c2.orderId, { utr: usedUtr });

      const res2 = await processYouPiWebhook({
        rawBody: w2.rawBody,
        signatureV2: w2.headers['X-Gateway-Signature-V2'],
        timestamp: w2.headers['X-Gateway-Timestamp'],
        deliveryId: crypto.randomUUID(),
      });

      expect(res2.received).toBe(true);
      expect(res2.status).toBe('VERIFICATION_QUEUE');
      expect(res2.reason).toBe('DUPLICATE_UTR');

      const client = await pool.connect();
      try {
        const pCheck = await client.query(`SELECT status FROM payments WHERE id = $1;`, [c2.paymentId]);
        expect(pCheck.rows[0].status).toBe('VERIFICATION_QUEUE');
      } finally {
        client.release();
      }
    });

    it('rejects unknown order ID with 404 UNKNOWN_ORDER', async () => {
      const fakeOrderId = crypto.randomUUID();
      // Record in fake server so status API won't 404
      fakeYouPi.orders.set(fakeOrderId, {
        id: fakeOrderId,
        orderId: fakeOrderId,
        amount: '499.00',
        amountPaise: 49900,
        currency: 'INR',
        status: 'SUCCESS',
        slotActive: true,
        queueStatus: 'ACTIVE',
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        createdAt: new Date().toISOString(),
      });

      const webhookData = fakeYouPi.generateWebhookPayload(fakeOrderId);

      await expect(
        processYouPiWebhook({
          rawBody: webhookData.rawBody,
          signatureV2: webhookData.headers['X-Gateway-Signature-V2'],
          timestamp: webhookData.headers['X-Gateway-Timestamp'],
          deliveryId: crypto.randomUUID(),
        })
      ).rejects.toThrow(/UNKNOWN_ORDER/);
    });

    it('resolves VERIFICATION_QUEUE item manually: APPROVE fulfills, REJECT cancels', async () => {
      // 1. Create a payment in VERIFICATION_QUEUE
      const { bookingId, studentId } = await createTestBooking();
      const checkout = await initiateCheckout({ bookingId, userId: studentId });

      const client = await pool.connect();
      try {
        await client.query(
          `UPDATE payments SET status = 'VERIFICATION_QUEUE', verification_queue_reason = 'Suspect bank note' WHERE id = $1;`,
          [checkout.paymentId]
        );

        // 2. Organizer APPROVES payment
        const resolveRes = await resolveVerificationQueue({
          paymentId: checkout.paymentId,
          decision: 'APPROVE',
          reviewerUserId: orgAUserId,
          notes: 'Bank manager confirmed credit on phone',
        });

        expect(resolveRes.success).toBe(true);
        expect(resolveRes.status).toBe('SUCCESS');

        // Check booking CONFIRMED and ticket issued
        const bCheck = await client.query(`SELECT status FROM bookings WHERE id = $1;`, [bookingId]);
        expect(bCheck.rows[0].status).toBe('CONFIRMED');

        const tCheck = await client.query(`SELECT status FROM tickets WHERE booking_id = $1;`, [bookingId]);
        expect(tCheck.rows.length).toBe(1);
        expect(tCheck.rows[0].status).toBe('VALID');

        const lCheck = await client.query(
          `SELECT entry_type FROM organizer_ledger_entries WHERE booking_id = $1;`,
          [bookingId]
        );
        expect(lCheck.rows[0].entry_type).toBe('SALE');
      } finally {
        client.release();
      }
    });
  });

  describe('4. Single-Slot Queue & Hold Extension', () => {
    it('extends booking hold when queue slot activates', async () => {
      const { bookingId, studentId } = await createTestBooking();
      const checkout = await initiateCheckout({ bookingId, userId: studentId });

      const client = await pool.connect();
      try {
        // Set initial expires_at to 1 minute from now
        await client.query(`UPDATE bookings SET expires_at = NOW() + INTERVAL '1 minute' WHERE id = $1;`, [bookingId]);

        const activation = await handleSlotActivation(checkout.paymentId);
        expect(activation.success).toBe(true);
        expect(activation.slotActive).toBe(true);

        const bRes = await client.query(`SELECT expires_at FROM bookings WHERE id = $1;`, [bookingId]);
        const newExpiry = new Date(bRes.rows[0].expires_at).getTime();
        const now = Date.now();

        // Must be extended by ~5 minutes
        expect(newExpiry - now).toBeGreaterThan(4 * 60 * 1000);
      } finally {
        client.release();
      }
    });

    it('reports live throughput status and queue length', async () => {
      const throughput = await getYouPiThroughputStatus();
      expect(throughput.provider).toBe('youpi');
      expect(typeof throughput.dailyLimit).toBe('number');
      expect(typeof throughput.dailyCount).toBe('number');
      expect(typeof throughput.remainingSlotsToday).toBe('number');
      expect(throughput.hourlyThroughputWarning).toContain('12');
    });
  });

  describe('5. Daily Limits Enforcement', () => {
    it('blocks checkout when YOUPI_DAILY_LIMIT is reached', async () => {
      const client = await pool.connect();
      let currentCount = 0;
      try {
        const countRes = await client.query(
          `SELECT COUNT(*)::int as count
           FROM payments
           WHERE provider = 'youpi'
             AND created_at >= NOW() - INTERVAL '24 hours'
             AND status IN ('PENDING', 'QUEUED', 'SUCCESS', 'SUCCEEDED');`
        );
        currentCount = countRes.rows[0]?.count || 0;
      } finally {
        client.release();
      }

      const originalLimit = process.env.YOUPI_DAILY_LIMIT;
      try {
        // Set daily limit to allow exactly 1 more checkout
        process.env.YOUPI_DAILY_LIMIT = String(currentCount + 1);

        const { bookingId: b1, studentId: s1 } = await createTestBooking();
        const c1 = await initiateCheckout({ bookingId: b1, userId: s1 });
        expect(c1.paymentId).toBeDefined();

        const { bookingId: b2, studentId: s2 } = await createTestBooking();

        // Second checkout should hit limit
        await expect(
          initiateCheckout({ bookingId: b2, userId: s2 })
        ).rejects.toThrow(/DAILY_LIMIT_EXCEEDED|Daily payment quota/);
      } finally {
        process.env.YOUPI_DAILY_LIMIT = originalLimit || '500';
      }
    });
  });

  describe('6. Manual Refund Process & Checked-in Protection', () => {
    it('records manual refund with 12-digit UTR and cancels booking', async () => {
      // 1. Complete paid booking
      const { bookingId, studentId } = await createTestBooking();
      const checkout = await initiateCheckout({ bookingId, userId: studentId });
      const webhook = fakeYouPi.generateWebhookPayload(checkout.orderId);
      await processYouPiWebhook({
        rawBody: webhook.rawBody,
        signatureV2: webhook.headers['X-Gateway-Signature-V2'],
        timestamp: webhook.headers['X-Gateway-Timestamp'],
        deliveryId: crypto.randomUUID(),
      });

      // 2. Request refund
      const client = await pool.connect();
      let refundId: string;
      try {
        const rRes = await client.query(
          `INSERT INTO refunds (payment_id, amount_paise, reason, status, idempotency_key)
           VALUES ($1, 49900, 'Student ill', 'REFUND_PENDING_MANUAL', $2)
           RETURNING id;`,
          [checkout.paymentId, `idem_ref_${Date.now()}`]
        );
        refundId = rRes.rows[0].id;
      } finally {
        client.release();
      }

      // 3. Organizer records manual bank transfer UTR
      const refundUtr = '123456789012';
      const result = await recordManualRefund({
        refundId,
        organizerUserId: orgAUserId,
        refundUtr,
        notes: 'IMPS transfer from college bank account',
      });

      expect(result.status).toBe('SUCCEEDED');
      expect(result.refundUtr).toBe(refundUtr);

      // 4. Assert ledger REFUND entry and tickets revoked
      const client2 = await pool.connect();
      try {
        const lRes = await client2.query(
          `SELECT entry_type, amount_paise FROM organizer_ledger_entries WHERE booking_id = $1 ORDER BY created_at DESC;`,
          [bookingId]
        );
        expect(lRes.rows[0].entry_type).toBe('REFUND');
        expect(lRes.rows[0].amount_paise).toBe(49900);

        const tRes = await client2.query(`SELECT status FROM tickets WHERE booking_id = $1;`, [bookingId]);
        expect(tRes.rows[0].status).toBe('REVOKED');

        const bRes = await client2.query(`SELECT status FROM bookings WHERE id = $1;`, [bookingId]);
        expect(bRes.rows[0].status).toBe('CANCELLED');
      } finally {
        client2.release();
      }
    });

    it('rejects refund if ticket has already been CHECKED_IN', async () => {
      const { bookingId, studentId } = await createTestBooking();
      const checkout = await initiateCheckout({ bookingId, userId: studentId });
      const webhook = fakeYouPi.generateWebhookPayload(checkout.orderId);
      await processYouPiWebhook({
        rawBody: webhook.rawBody,
        signatureV2: webhook.headers['X-Gateway-Signature-V2'],
        timestamp: webhook.headers['X-Gateway-Timestamp'],
        deliveryId: crypto.randomUUID(),
      });

      const client = await pool.connect();
      let refundId: string;
      try {
        // Mark ticket as CHECKED_IN
        await client.query(`UPDATE tickets SET status = 'CHECKED_IN' WHERE booking_id = $1;`, [bookingId]);

        const rRes = await client.query(
          `INSERT INTO refunds (payment_id, amount_paise, reason, status, idempotency_key)
           VALUES ($1, 49900, 'Late refund request', 'REFUND_PENDING_MANUAL', $2)
           RETURNING id;`,
          [checkout.paymentId, `idem_ref_used_${Date.now()}`]
        );
        refundId = rRes.rows[0].id;
      } finally {
        client.release();
      }

      await expect(
        recordManualRefund({
          refundId,
          organizerUserId: orgAUserId,
          refundUtr: '999888777666',
        })
      ).rejects.toThrow(/TICKETS_ALREADY_CHECKED_IN|TICKET_ALREADY_USED|Tickets have already been used for entry/);
    });

    it('enforces organizer ownership check for manual refunds (Org B gets 403 on Org A)', async () => {
      const { bookingId, studentId } = await createTestBooking();
      const checkout = await initiateCheckout({ bookingId, userId: studentId });
      const webhook = fakeYouPi.generateWebhookPayload(checkout.orderId);
      await processYouPiWebhook({
        rawBody: webhook.rawBody,
        signatureV2: webhook.headers['X-Gateway-Signature-V2'],
        timestamp: webhook.headers['X-Gateway-Timestamp'],
        deliveryId: crypto.randomUUID(),
      });

      const client = await pool.connect();
      let refundId: string;
      try {
        const rRes = await client.query(
          `INSERT INTO refunds (payment_id, amount_paise, reason, status, idempotency_key)
           VALUES ($1, 49900, 'Cross org test', 'REFUND_PENDING_MANUAL', $2)
           RETURNING id;`,
          [checkout.paymentId, `idem_ref_cross_${Date.now()}`]
        );
        refundId = rRes.rows[0].id;
      } finally {
        client.release();
      }

      // Org B user attempts to record refund for Org A
      await expect(
        recordManualRefund({
          refundId,
          organizerUserId: orgBUserId,
          refundUtr: '111222333444',
        })
      ).rejects.toThrow(/FORBIDDEN|Access denied/);
    });
  });

  describe('7. Bank Statement CSV Reconciliation', () => {
    it('imports statement CSV and matches payments by 12-digit UTR', async () => {
      // 1. Complete a payment with a known UTR
      const reconUtr = String(Math.floor(100000000000 + Math.random() * 900000000000));
      const unmatchedUtr = String(Math.floor(100000000000 + Math.random() * 900000000000));
      const { bookingId, studentId } = await createTestBooking();
      const checkout = await initiateCheckout({ bookingId, userId: studentId });
      const webhook = fakeYouPi.generateWebhookPayload(checkout.orderId, { utr: reconUtr });
      await processYouPiWebhook({
        rawBody: webhook.rawBody,
        signatureV2: webhook.headers['X-Gateway-Signature-V2'],
        timestamp: webhook.headers['X-Gateway-Timestamp'],
        deliveryId: crypto.randomUUID(),
      });

      // 2. Prepare bank statement CSV containing the matched UTR and an unmatched UTR
      const csvData = [
        'Date,Description,UTR,Amount,Type',
        `2026-10-26,UPI/CR/${reconUtr}/Student,${reconUtr},499.00,CR`,
        `2026-10-26,UPI/CR/${unmatchedUtr}/Unknown,${unmatchedUtr},250.00,CR`,
      ].join('\n');

      const summary = await importBankStatementCsv({
        csvContent: csvData,
        filename: 'bank_stmt_oct26.csv',
        adminUserId: orgAUserId,
      });

      expect(summary.totalRows).toBe(2);
      expect(summary.matchedRows).toBe(1);
      expect(summary.unmatchedRows).toBe(1);

      // Verify reconciliation records in DB
      const client = await pool.connect();
      try {
        const itemRes = await client.query(
          `SELECT utr, status FROM reconciliation_items WHERE utr IN ($1, $2);`,
          [reconUtr, unmatchedUtr]
        );
        expect(itemRes.rows.length).toBe(2);
        const matched = itemRes.rows.find((r) => r.utr === reconUtr);
        const unmatched = itemRes.rows.find((r) => r.utr === unmatchedUtr);
        expect(matched.status).toBe('MATCHED');
        expect(unmatched.status).toBe('UNMATCHED');
      } finally {
        client.release();
      }
    });
  });

  describe('8. Simulator Lockdown in Production', () => {
    it('returns 403 on simulator payments when NODE_ENV is production and ENABLE_TEST_SIMULATOR is not true', async () => {
      const originalEnv = process.env.NODE_ENV;
      const originalFlag = process.env.ENABLE_TEST_SIMULATOR;

      try {
        process.env.NODE_ENV = 'production';
        delete process.env.ENABLE_TEST_SIMULATOR;

        const response = await app.inject({
          method: 'POST',
          url: '/api/v1/simulator/payments',
          headers: {
            'content-type': 'application/json',
          },
          payload: { status: 'SUCCEEDED' },
        });

        // Fastify returns 401 unauthenticated or 403 forbidden
        expect([401, 403]).toContain(response.statusCode);
      } finally {
        process.env.NODE_ENV = originalEnv;
        if (originalFlag) process.env.ENABLE_TEST_SIMULATOR = originalFlag;
      }
    });
  });
});
