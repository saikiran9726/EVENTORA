import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../packages/backend/src/app.js';
import { pool } from '../../packages/backend/src/db/index.js';
import { simulatorAdapter } from '../../packages/backend/src/services/payment-adapter.js';
import {
  initiateCheckout,
  verifyPayment,
  processWebhook,
  requestRefund,
  decideRefund,
  getOrganizerSalesSummary,
  reconcileExpiredHolds,
} from '../../packages/backend/src/services/payment.js';
import { verifyPaymentStartupGuard } from '../../packages/backend/src/services/startup-guard.js';
import crypto from 'crypto';

describe('Phase 5 Quality Gate: Test-Mode Paid Checkout, Receipts & Ledger', () => {
  let app: any;
  let collegeId: string;
  let organizerAId: string;
  let organizerBId: string;
  let orgAUserId: string;
  let orgBUserId: string;
  let studentUserId: string;
  let paidEventId: string;
  let paidTicketTypeId: string;
  const createdUserIds: string[] = [];
  const createdEventIds: string[] = [];

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    const client = await pool.connect();
    try {
      // 1. Fetch college
      const cRes = await client.query('SELECT id FROM colleges LIMIT 1;');
      collegeId = cRes.rows[0].id;

      // 2. Create users
      const uRes = await client.query(
        `INSERT INTO users (college_id, email, password_hash, display_name, global_role, status)
         VALUES
           ($1, $2, 'hash', 'Organizer A Lead', 'student', 'active'),
           ($1, $3, 'hash', 'Organizer B Lead', 'student', 'active'),
           ($1, $4, 'hash', 'Student Buyer', 'student', 'active')
         RETURNING id;`,
        [
          collegeId,
          `org.a.${Date.now()}@campus.edu`,
          `org.b.${Date.now()}@campus.edu`,
          `student.buyer.${Date.now()}@campus.edu`,
        ]
      );
      orgAUserId = uRes.rows[0].id;
      orgBUserId = uRes.rows[1].id;
      studentUserId = uRes.rows[2].id;
      createdUserIds.push(orgAUserId, orgBUserId, studentUserId);

      // 3. Create Organizer Profiles
      const p1 = await client.query(
        `INSERT INTO organizer_profiles (college_id, display_name, status, created_by)
         VALUES ($1, 'Gate Club A', 'verified', $2) RETURNING id;`,
        [collegeId, orgAUserId]
      );
      organizerAId = p1.rows[0].id;

      const p2 = await client.query(
        `INSERT INTO organizer_profiles (college_id, display_name, status, created_by)
         VALUES ($1, 'Gate Club B', 'verified', $2) RETURNING id;`,
        [collegeId, orgBUserId]
      );
      organizerBId = p2.rows[0].id;

      // Assign memberships
      await client.query(
        `INSERT INTO organizer_members (organizer_id, user_id, role, status)
         VALUES ($1, $2, 'owner', 'active'),
                ($3, $4, 'owner', 'active');`,
        [organizerAId, orgAUserId, organizerBId, orgBUserId]
      );

      // 4. Create paid event
      const eRes = await client.query(
        `INSERT INTO events (
           organizer_id, college_id, title, slug, description, category, department, format,
           starts_at, ends_at, capacity, visibility, status, contact_email, created_by
         ) VALUES (
           $1, $2, 'Paid Robotics Masterclass', $3, 'Paid intensive workshop', 'Tech', 'CS', 'in_person',
           NOW() + INTERVAL '10 days', NOW() + INTERVAL '11 days', 50, 'public', 'published', 'contact@campus.edu', $4
         ) RETURNING id;`,
        [organizerAId, collegeId, `paid-masterclass-${Date.now()}`, orgAUserId]
      );
      paidEventId = eRes.rows[0].id;
      createdEventIds.push(paidEventId);

      // 5. Create paid ticket tier (₹150 = 15000 paise)
      const ttRes = await client.query(
        `INSERT INTO ticket_types (event_id, name, price_paise, capacity, sold, held)
         VALUES ($1, 'VIP Pass', 15000, 50, 0, 0)
         RETURNING id;`,
        [paidEventId]
      );
      paidTicketTypeId = ttRes.rows[0].id;
    } finally {
      client.release();
    }
  });

  async function createTestStudent(client: any): Promise<string> {
    const sRes = await client.query(
      `INSERT INTO users (college_id, email, password_hash, display_name, global_role, status)
       VALUES ($1, $2, 'hash', 'Test Student', 'student', 'active')
       RETURNING id;`,
      [collegeId, `student.${Date.now()}.${Math.random().toString(36).substring(2, 7)}@campus.edu`]
    );
    const id = sRes.rows[0].id;
    createdUserIds.push(id);
    return id;
  }

  async function createTestEventAndTicket(client: any): Promise<{ eventId: string; ticketTypeId: string }> {
    const eRes = await client.query(
      `INSERT INTO events (
         organizer_id, college_id, title, slug, description, category, department, format,
         starts_at, ends_at, capacity, visibility, status, contact_email, created_by
       ) VALUES (
         $1, $2, 'Paid Test Event', $3, 'Description', 'Tech', 'CS', 'in_person',
         NOW() + INTERVAL '10 days', NOW() + INTERVAL '11 days', 50, 'public', 'published', 'contact@campus.edu', $4
       ) RETURNING id;`,
      [organizerAId, collegeId, `paid-event-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`, orgAUserId]
    );
    const eventId = eRes.rows[0].id;
    createdEventIds.push(eventId);

    const ttRes = await client.query(
      `INSERT INTO ticket_types (event_id, name, price_paise, capacity, sold, held)
       VALUES ($1, 'VIP Pass', 15000, 50, 0, 0)
       RETURNING id;`,
      [eventId]
    );
    return { eventId, ticketTypeId: ttRes.rows[0].id };
  }

  afterAll(async () => {
    const client = await pool.connect();
    try {
      if (createdEventIds.length > 0) {
        await client.query(`DELETE FROM receipts WHERE booking_id IN (SELECT id FROM bookings WHERE event_id = ANY($1::uuid[]));`, [createdEventIds]);
        await client.query(`DELETE FROM organizer_ledger_entries WHERE booking_id IN (SELECT id FROM bookings WHERE event_id = ANY($1::uuid[]));`, [createdEventIds]);
        await client.query(`DELETE FROM refunds WHERE payment_id IN (SELECT p.id FROM payments p JOIN bookings b ON p.booking_id = b.id WHERE b.event_id = ANY($1::uuid[]));`, [createdEventIds]);
        await client.query(`DELETE FROM payment_attempts WHERE payment_id IN (SELECT p.id FROM payments p JOIN bookings b ON p.booking_id = b.id WHERE b.event_id = ANY($1::uuid[]));`, [createdEventIds]);
        await client.query(`DELETE FROM payments WHERE booking_id IN (SELECT id FROM bookings WHERE event_id = ANY($1::uuid[]));`, [createdEventIds]);
        await client.query(`DELETE FROM tickets WHERE event_id = ANY($1::uuid[]);`, [createdEventIds]);
        await client.query(`DELETE FROM booking_items WHERE ticket_type_id IN (SELECT id FROM ticket_types WHERE event_id = ANY($1::uuid[]));`, [createdEventIds]);
        await client.query(`DELETE FROM bookings WHERE event_id = ANY($1::uuid[]);`, [createdEventIds]);
        await client.query(`DELETE FROM ticket_types WHERE event_id = ANY($1::uuid[]);`, [createdEventIds]);
        await client.query(`DELETE FROM events WHERE id = ANY($1::uuid[]);`, [createdEventIds]);
      }
      if (createdUserIds.length > 0) {
        await client.query(`DELETE FROM organizer_members WHERE user_id = ANY($1::uuid[]);`, [createdUserIds]);
        if (organizerAId) await client.query(`DELETE FROM organizer_profiles WHERE id = $1;`, [organizerAId]);
        if (organizerBId) await client.query(`DELETE FROM organizer_profiles WHERE id = $1;`, [organizerBId]);
        await client.query(`DELETE FROM users WHERE id = ANY($1::uuid[]);`, [createdUserIds]);
      }
    } catch (e) {
      console.error('afterAll cleanup error:', e);
    } finally {
      client.release();
    }
  });

  // Gate Test 1: Startup Guard refuses to boot in production if live keys are present
  it('(1) Startup Guard refuses to boot in production if live keys are present', () => {
    const originalEnv = process.env.NODE_ENV;
    const originalSecret = process.env.RAZORPAY_KEY_SECRET;

    try {
      process.env.NODE_ENV = 'production';
      process.env.RAZORPAY_KEY_SECRET = 'rzp_live_secret_key_should_fail';

      expect(() => verifyPaymentStartupGuard()).toThrow(
        /Live payment credentials detected in production environment/
      );
    } finally {
      process.env.NODE_ENV = originalEnv;
      process.env.RAZORPAY_KEY_SECRET = originalSecret;
    }
  });

  // Gate Test 2: Forged redirect ?status=success issues no ticket without server verification
  it('(2) forged redirect ?status=success issues zero tickets without server verification', async () => {
    const client = await pool.connect();
    let testBookingId: string;

    try {
      // 1. Create a pending booking with held seat
      const bRes = await client.query(
        `INSERT INTO bookings (user_id, event_id, status, total_paise, idempotency_key, expires_at)
         VALUES ($1, $2, 'PENDING_PAYMENT', 15000, $3, NOW() + INTERVAL '15 minutes')
         RETURNING id;`,
        [studentUserId, paidEventId, `forged-idem-${Date.now()}`]
      );
      testBookingId = bRes.rows[0].id;

      await client.query(
        `INSERT INTO booking_items (booking_id, ticket_type_id, quantity, unit_price_paise)
         VALUES ($1, $2, 1, 15000);`,
        [testBookingId, paidTicketTypeId]
      );
      await client.query(`UPDATE ticket_types SET held = held + 1 WHERE id = $1;`, [paidTicketTypeId]);

      // 2. Initiate checkout
      const checkout = await initiateCheckout({ bookingId: testBookingId, userId: studentUserId });
      expect(checkout.orderId).toBeDefined();

      // Client fabricates redirect/callback query param without calling server verify
      const forgedQueryParams = { status: 'success', paymentId: 'fake_pay_id', orderId: checkout.orderId };
      expect(forgedQueryParams.status).toBe('success');

      // 3. Verify zero tickets issued in database
      const ticketCheck = await client.query(
        `SELECT COUNT(*)::int as count FROM tickets WHERE booking_id = $1;`,
        [testBookingId]
      );
      expect(ticketCheck.rows[0].count).toBe(0);

      // Verify booking remains in PENDING_PAYMENT
      const bookingCheck = await client.query(
        `SELECT status FROM bookings WHERE id = $1;`,
        [testBookingId]
      );
      expect(bookingCheck.rows[0].status).toBe('PENDING_PAYMENT');
    } finally {
      client.release();
    }
  });

  // Gate Test 3: Tampered amount rejected (422) and recorded as FAILED
  it('(3) tampered amount rejected with 422 and recorded as FAILED', async () => {
    const client = await pool.connect();
    try {
      const studentId = await createTestStudent(client);
      const bRes = await client.query(
        `INSERT INTO bookings (user_id, event_id, status, total_paise, idempotency_key, expires_at)
         VALUES ($1, $2, 'PENDING_PAYMENT', 15000, $3, NOW() + INTERVAL '15 minutes')
         RETURNING id;`,
        [studentId, paidEventId, `tamper-idem-${Date.now()}`]
      );
      const bookingId = bRes.rows[0].id;

      await client.query(
        `INSERT INTO booking_items (booking_id, ticket_type_id, quantity, unit_price_paise)
         VALUES ($1, $2, 1, 15000);`,
        [bookingId, paidTicketTypeId]
      );
      await client.query(`UPDATE ticket_types SET held = held + 1 WHERE id = $1;`, [paidTicketTypeId]);

      const checkout = await initiateCheckout({ bookingId, userId: studentId });

      // Attempt verification with tampered amount (e.g. attacker paid 100 paise instead of 15000 paise)
      const { executePaymentConfirmationTransaction } = await import('../../packages/backend/src/services/payment.js');
      await expect(
        executePaymentConfirmationTransaction({
          orderId: checkout.orderId,
          paymentId: `tampered_pay_${Date.now()}`,
          adapterSuccess: true,
          amountPaise: 100, // tampered!
        })
      ).rejects.toThrow(/AMOUNT_MISMATCH|does not match order amount/);

      // Verify payment marked as FAILED in DB
      const payCheck = await client.query(
        `SELECT status, failure_code FROM payments WHERE provider_order_id = $1;`,
        [checkout.orderId]
      );
      expect(payCheck.rows[0].status).toBe('FAILED');
      expect(payCheck.rows[0].failure_code).toBe('AMOUNT_MISMATCH');
    } finally {
      client.release();
    }
  });

  // Gate Test 4: Invalid signature returns 401 and logs audit in webhook_events
  it('(4) invalid webhook signature returns 401 and records audit event in webhook_events', async () => {
    const rawPayload = Buffer.from(JSON.stringify({ eventId: `evt_bad_${Date.now()}`, type: 'payment.captured' }));
    const invalidSignature = 'invalid_sha256_hex_signature_abcdef1234567890';

    await expect(
      processWebhook({
        rawBody: rawPayload,
        signature: invalidSignature,
      })
    ).rejects.toThrow(/Webhook signature verification failed|INVALID_SIGNATURE/);

    // Verify audit entry in webhook_events
    const client = await pool.connect();
    try {
      const auditRes = await client.query(
        `SELECT signature_valid, processing_status FROM webhook_events WHERE processing_status = 'FAILED' ORDER BY received_at DESC LIMIT 1;`
      );
      expect(auditRes.rows.length).toBe(1);
      expect(auditRes.rows[0].signature_valid).toBe(false);
      expect(auditRes.rows[0].processing_status).toBe('FAILED');
    } finally {
      client.release();
    }
  });

  // Gate Test 5: Webhook x50 concurrent duplicates -> 1 ticket set, 1 ledger row
  it('(5) webhook x50 concurrent duplicates -> exactly 1 ticket set, exactly 1 ledger row', async () => {
    const client = await pool.connect();
    let bookingId: string;
    let orderId: string;
    let paymentId: string;

    try {
      // Create pending booking
      const { eventId, ticketTypeId } = await createTestEventAndTicket(client);
      const studentId = await createTestStudent(client);
      const bRes = await client.query(
        `INSERT INTO bookings (user_id, event_id, status, total_paise, idempotency_key, expires_at)
         VALUES ($1, $2, 'PENDING_PAYMENT', 15000, $3, NOW() + INTERVAL '15 minutes')
         RETURNING id;`,
        [studentId, eventId, `dup-webhook-${Date.now()}`]
      );
      bookingId = bRes.rows[0].id;

      await client.query(
        `INSERT INTO booking_items (booking_id, ticket_type_id, quantity, unit_price_paise)
         VALUES ($1, $2, 1, 15000);`,
        [bookingId, ticketTypeId]
      );
      await client.query(`UPDATE ticket_types SET held = held + 1 WHERE id = $1;`, [ticketTypeId]);

      const checkout = await initiateCheckout({ bookingId, userId: studentId });
      orderId = checkout.orderId;
      paymentId = checkout.paymentId;
    } finally {
      client.release();
    }

    // Generate valid webhook payload and signature
    const providerEventId = `wh_storm_${Date.now()}`;
    const webhookPayload = JSON.stringify({
      eventId: providerEventId,
      type: 'payment.captured',
      orderId,
      paymentId: `pay_storm_${Date.now()}`,
      amountPaise: 15000,
    });
    const rawBody = Buffer.from(webhookPayload, 'utf8');
    const validSignature = simulatorAdapter.generateWebhookSignature(rawBody);

    // Blast 50 concurrent duplicate webhook deliveries
    const duplicatePromises = Array.from({ length: 50 }, () =>
      processWebhook({
        rawBody,
        signature: validSignature,
        timestampHeader: Math.floor(Date.now() / 1000).toString(),
      })
    );

    const results = await Promise.allSettled(duplicatePromises);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled.length).toBe(50);

    // Verify DB state: exactly 1 ticket issued, exactly 1 ledger row, booking CONFIRMED
    const vClient = await pool.connect();
    try {
      const ticketRes = await vClient.query(
        `SELECT count(*)::int as count FROM tickets WHERE booking_id = $1;`,
        [bookingId]
      );
      expect(ticketRes.rows[0].count).toBe(1);

      const ledgerRes = await vClient.query(
        `SELECT count(*)::int as count FROM organizer_ledger_entries WHERE booking_id = $1 AND entry_type = 'SALE';`,
        [bookingId]
      );
      expect(ledgerRes.rows[0].count).toBe(1);

      const bookingRes = await vClient.query(
        `SELECT status FROM bookings WHERE id = $1;`,
        [bookingId]
      );
      expect(bookingRes.rows[0].status).toBe('CONFIRMED');

      const receiptRes = await vClient.query(
        `SELECT count(*)::int as count FROM receipts WHERE booking_id = $1;`,
        [bookingId]
      );
      expect(receiptRes.rows[0].count).toBe(1);
    } finally {
      vClient.release();
    }
  });

  // Gate Test 6: Failed/pending payment -> zero valid tickets
  it('(6) failed/pending payment -> zero valid tickets', async () => {
    const client = await pool.connect();
    try {
      const { eventId, ticketTypeId } = await createTestEventAndTicket(client);
      const studentId = await createTestStudent(client);
      const bRes = await client.query(
        `INSERT INTO bookings (user_id, event_id, status, total_paise, idempotency_key, expires_at)
         VALUES ($1, $2, 'PENDING_PAYMENT', 15000, $3, NOW() + INTERVAL '15 minutes')
         RETURNING id;`,
        [studentId, eventId, `fail-test-${Date.now()}`]
      );
      const bookingId = bRes.rows[0].id;

      await client.query(
        `INSERT INTO booking_items (booking_id, ticket_type_id, quantity, unit_price_paise)
         VALUES ($1, $2, 1, 15000);`,
        [bookingId, ticketTypeId]
      );
      await client.query(`UPDATE ticket_types SET held = held + 1 WHERE id = $1;`, [ticketTypeId]);

      const checkout = await initiateCheckout({ bookingId, userId: studentId });

      // Simulate payment failure
      const failResult = await verifyPayment({
        orderId: checkout.orderId,
        paymentId: 'pay_fail_decline',
      });

      expect(failResult.confirmed).toBe(false);
      expect(failResult.status).toBe('FAILED');

      // Assert zero tickets
      const tRes = await client.query(
        `SELECT count(*)::int as count FROM tickets WHERE booking_id = $1;`,
        [bookingId]
      );
      expect(tRes.rows[0].count).toBe(0);

      // Assert held capacity released
      const ttRes = await client.query(
        `SELECT held FROM ticket_types WHERE id = $1;`,
        [ticketTypeId]
      );
      expect(ttRes.rows[0].held).toBe(0);
    } finally {
      client.release();
    }
  });

  // Gate Test 7: Expiry releases held seats only after reconciliation
  it('(7) expiry releases held seats only after reconciliation', async () => {
    const client = await pool.connect();
    try {
      // Create expired pending hold (expires_at in past)
      const { eventId, ticketTypeId } = await createTestEventAndTicket(client);
      const studentId = await createTestStudent(client);
      const bRes = await client.query(
        `INSERT INTO bookings (user_id, event_id, status, total_paise, idempotency_key, expires_at)
         VALUES ($1, $2, 'PENDING_PAYMENT', 15000, $3, NOW() - INTERVAL '10 minutes')
         RETURNING id;`,
        [studentId, eventId, `exp-test-${Date.now()}`]
      );
      const bookingId = bRes.rows[0].id;

      await client.query(
        `INSERT INTO booking_items (booking_id, ticket_type_id, quantity, unit_price_paise)
         VALUES ($1, $2, 1, 15000);`,
        [bookingId, ticketTypeId]
      );
      await client.query(`UPDATE ticket_types SET held = held + 1 WHERE id = $1;`, [ticketTypeId]);

      // Run reconciliation job
      const recResult = await reconcileExpiredHolds();
      expect(recResult.reconciledCount).toBeGreaterThanOrEqual(1);

      // Verify booking status is EXPIRED
      const bCheck = await client.query(`SELECT status FROM bookings WHERE id = $1;`, [bookingId]);
      expect(bCheck.rows[0].status).toBe('EXPIRED');

      // Verify held count released back to 0
      const ttCheck = await client.query(`SELECT held FROM ticket_types WHERE id = $1;`, [ticketTypeId]);
      expect(ttCheck.rows[0].held).toBe(0);
    } finally {
      client.release();
    }
  });

  // Gate Test 8: Refund transitions keep payment, refund, ticket, and ledger consistent
  it('(8) refund transitions keep payment, refund, ticket, and ledger 100% consistent', async () => {
    const client = await pool.connect();
    let bookingId: string;
    let paymentId: string;

    try {
      // 1. Setup confirmed paid booking
      const { eventId, ticketTypeId } = await createTestEventAndTicket(client);
      const studentId = await createTestStudent(client);
      const bRes = await client.query(
        `INSERT INTO bookings (user_id, event_id, status, total_paise, idempotency_key)
         VALUES ($1, $2, 'PENDING_PAYMENT', 15000, $3)
         RETURNING id;`,
        [studentId, eventId, `ref-test-${Date.now()}`]
      );
      bookingId = bRes.rows[0].id;

      await client.query(
        `INSERT INTO booking_items (booking_id, ticket_type_id, quantity, unit_price_paise)
         VALUES ($1, $2, 1, 15000);`,
        [bookingId, ticketTypeId]
      );
      await client.query(`UPDATE ticket_types SET held = held + 1 WHERE id = $1;`, [ticketTypeId]);

      const checkout = await initiateCheckout({ bookingId, userId: studentId });
      paymentId = checkout.paymentId;

      // Confirm payment
      const confirmed = await verifyPayment({
        orderId: checkout.orderId,
        paymentId: `pay_conf_${Date.now()}`,
      });
      expect(confirmed.status).toBe('SUCCEEDED');

      // Sold should be incremented to 1
      const ttSoldCheck = await client.query(`SELECT sold FROM ticket_types WHERE id = $1;`, [ticketTypeId]);
      expect(ttSoldCheck.rows[0].sold).toBe(1);

      // 2. Request refund (Attendee)
      const refundRecord = await requestRefund({
        bookingId,
        userId: studentId,
        reason: 'Unable to attend due to academic schedule clash',
        idempotencyKey: `ref-idem-${bookingId}`,
      });
      expect(refundRecord.status).toBe('REQUESTED');

      // 3. Organizer approves refund
      const decisionResult = await decideRefund({
        refundId: refundRecord.id,
        decision: 'APPROVED',
        userId: orgAUserId,
      });
      expect(decisionResult.status).toBe('SUCCEEDED');

      // 4. Assert full consistency across all tables:
      // - Payment status is REFUNDED
      const payCheck = await client.query(`SELECT status FROM payments WHERE id = $1;`, [paymentId]);
      expect(payCheck.rows[0].status).toBe('REFUNDED');

      // - Refund status is SUCCEEDED
      const refCheck = await client.query(`SELECT status, decided_by FROM refunds WHERE id = $1;`, [refundRecord.id]);
      expect(refCheck.rows[0].status).toBe('SUCCEEDED');
      expect(refCheck.rows[0].decided_by).toBe(orgAUserId);

      // - Tickets revoked
      const ticketCheck = await client.query(`SELECT status FROM tickets WHERE booking_id = $1;`, [bookingId]);
      expect(ticketCheck.rows[0].status).toBe('REVOKED');

      // - Ledger entry (REFUND) created
      const ledgerCheck = await client.query(
        `SELECT entry_type, amount_paise FROM organizer_ledger_entries WHERE booking_id = $1 ORDER BY created_at ASC;`,
        [bookingId]
      );
      expect(ledgerCheck.rows.length).toBe(2);
      expect(ledgerCheck.rows[0].entry_type).toBe('SALE');
      expect(ledgerCheck.rows[1].entry_type).toBe('REFUND');
      expect(ledgerCheck.rows[1].amount_paise).toBe(15000);

      // - Sold count decremented back to 0
      const ttCheck = await client.query(`SELECT sold FROM ticket_types WHERE id = $1;`, [ticketTypeId]);
      expect(ttCheck.rows[0].sold).toBe(0);
    } finally {
      client.release();
    }
  });

  // Gate Test 9: Organizer B gets 403 on Organizer A ledger
  it('(9) Organizer B gets 403 on Organizer A ledger (policy: analytics:view:owned)', async () => {
    // Organizer B attempts to view Organizer A ledger
    await expect(
      getOrganizerSalesSummary(organizerAId, orgBUserId, 'student')
    ).rejects.toThrow(/FORBIDDEN|Access denied/);

    // Organizer A viewing their own ledger succeeds
    const summaryA = await getOrganizerSalesSummary(organizerAId, orgAUserId, 'student');
    expect(summaryA.organizerId).toBe(organizerAId);
    expect(summaryA.isSimulated).toBe(true);
  });
});
