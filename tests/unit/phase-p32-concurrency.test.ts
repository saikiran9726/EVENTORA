import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../../packages/backend/src/db/index.js';
import { createBooking } from '../../packages/backend/src/services/booking.js';
import { scanTicket, createTicketWithRetry } from '../../packages/backend/src/services/qr-ticket.js';
import { claimOffer } from '../../packages/backend/src/services/waitlist.js';
import { requestRefund, decideRefund, executePaymentConfirmationTransaction } from '../../packages/backend/src/services/payment.js';
import crypto from 'crypto';

describe('Phase P32: Concurrency & Race Condition Suite (Real Postgres)', () => {
  let collegeId: string;
  let organizerId: string;
  let organizerUserId: string;
  let studentUserIds: string[] = [];

  beforeAll(async () => {
    const client = await pool.connect();
    try {
      const colRes = await client.query('SELECT id FROM colleges LIMIT 1;');
      if (colRes.rows.length > 0) {
        collegeId = colRes.rows[0].id;
      } else {
        const nc = await client.query(
          `INSERT INTO colleges (name, domain) VALUES ('P32 Institute', 'p32.edu') RETURNING id;`
        );
        collegeId = nc.rows[0].id;
      }

      // Organizer User & Profile
      const uRes = await client.query(
        `INSERT INTO users (college_id, email, password_hash, display_name, global_role, status)
         VALUES ($1, $2, 'hash', 'P32 Org Lead', 'student', 'active')
         RETURNING id;`,
        [collegeId, `p32.org.${Date.now()}@p32.edu`]
      );
      organizerUserId = uRes.rows[0].id;

      const orgRes = await client.query(
        `INSERT INTO organizer_profiles (college_id, display_name, status, created_by)
         VALUES ($1, 'P32 Concurrency Club', 'verified', $2)
         RETURNING id;`,
        [collegeId, organizerUserId]
      );
      organizerId = orgRes.rows[0].id;

      // Create 15 distinct student users for concurrent operations
      for (let i = 0; i < 15; i++) {
        const stuRes = await client.query(
          `INSERT INTO users (college_id, email, password_hash, display_name, global_role, status)
           VALUES ($1, $2, 'hash', $3, 'student', 'active')
           RETURNING id;`,
          [collegeId, `p32.student.${i}.${Date.now()}@p32.edu`, `P32 Student ${i}`]
        );
        studentUserIds.push(stuRes.rows[0].id);
      }
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    const client = await pool.connect();
    try {
      await client.query(`DELETE FROM users WHERE id = ANY($1);`, [[organizerUserId, ...studentUserIds]]);
      await client.query(`DELETE FROM organizer_profiles WHERE id = $1;`, [organizerId]);
    } catch {
      // ignore teardown error
    } finally {
      client.release();
    }
  });

  it('1. Oversell Race: 10 concurrent booking holds for 2 available seats -> exactly 2 succeed, 8 fail with zero oversell', async () => {
    const client = await pool.connect();
    let eventId: string;
    let ticketTypeId: string;

    try {
      const evtRes = await client.query(
        `INSERT INTO events (
           organizer_id, college_id, title, slug, description, category, department, format,
           starts_at, ends_at, capacity, visibility, status, contact_email, created_by, team_mode,
           registration_opens_at, registration_closes_at
         ) VALUES (
           $1, $2, 'Concurrency Limited Workshop', $3, 'Test', 'technical', 'CSE', 'in_person',
           NOW() + INTERVAL '1 day', NOW() + INTERVAL '2 days', 2, 'public', 'published', 'org@p32.edu', $4, 'none',
           NOW() - INTERVAL '1 hour', NOW() + INTERVAL '1 day'
         ) RETURNING id;`,
        [organizerId, collegeId, `p32-oversell-${Date.now()}`, organizerUserId]
      );
      eventId = evtRes.rows[0].id;

      const ttRes = await client.query(
        `INSERT INTO ticket_types (event_id, name, price_paise, capacity, sold, held, per_user_limit)
         VALUES ($1, 'Limited Tier', 0, 2, 0, 0, 1)
         RETURNING id;`,
        [eventId]
      );
      ticketTypeId = ttRes.rows[0].id;
    } finally {
      client.release();
    }

    // Launch 10 concurrent createBooking calls
    const bookingPromises = studentUserIds.slice(0, 10).map((userId, idx) =>
      createBooking({
        eventId,
        userId,
        items: [{ ticketTypeId, quantity: 1 }],
        idempotencyKey: `idemp-oversell-${idx}-${Date.now()}`,
      })
    );

    const results = await Promise.allSettled(bookingPromises);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Exactly 2 succeeded, 8 rejected
    expect(fulfilled.length).toBe(2);
    expect(rejected.length).toBe(8);

    // Verify rejected errors are capacity/sold out related
    for (const rej of rejected) {
      if (rej.status === 'rejected') {
        const code = rej.reason?.code || '';
        expect(['CAPACITY_EXCEEDED', 'SOLD_OUT', 'INSUFFICIENT_CAPACITY']).toContain(code);
      }
    }

    // Verify DB state: total tickets created is strictly 2
    const verifyClient = await pool.connect();
    try {
      const ttCheck = await verifyClient.query(`SELECT capacity, sold, held FROM ticket_types WHERE id = $1;`, [
        ticketTypeId,
      ]);
      const { capacity, sold, held } = ttCheck.rows[0];
      expect(sold + held).toBe(2);
      expect(sold + held).toBeLessThanOrEqual(capacity);

      const tktCount = await verifyClient.query(`SELECT COUNT(*)::int as count FROM tickets WHERE event_id = $1;`, [
        eventId,
      ]);
      expect(tktCount.rows[0].count).toBe(2);
    } finally {
      verifyClient.release();
    }
  });

  it('2. Double-Scan Race: 6 concurrent gate scans for a single ticket -> exactly 1 ACCEPTED, 5 DUPLICATE', async () => {
    const client = await pool.connect();
    let eventId: string;
    let ticketId: string;
    let rawToken: string;
    let staffId = studentUserIds[0];

    try {
      const evtRes = await client.query(
        `INSERT INTO events (
           organizer_id, college_id, title, slug, description, category, department, format,
           starts_at, ends_at, capacity, visibility, status, contact_email, created_by, team_mode,
           registration_opens_at, registration_closes_at
         ) VALUES (
           $1, $2, 'Concurrency Scan Event', $3, 'Test', 'cultural', 'CSE', 'in_person',
           NOW() - INTERVAL '1 hour', NOW() + INTERVAL '2 hours', 100, 'public', 'published', 'scan@p32.edu', $4, 'none',
           NOW() - INTERVAL '2 hours', NOW() + INTERVAL '2 hours'
         ) RETURNING id;`,
        [organizerId, collegeId, `p32-scan-${Date.now()}`, organizerUserId]
      );
      eventId = evtRes.rows[0].id;

      const ttRes = await client.query(
        `INSERT INTO ticket_types (event_id, name, price_paise, capacity, sold, held, per_user_limit)
         VALUES ($1, 'Scan Tier', 0, 100, 1, 0, 5)
         RETURNING id;`,
        [eventId]
      );
      const ticketTypeId = ttRes.rows[0].id;

      const bkRes = await client.query(
        `INSERT INTO bookings (event_id, user_id, status, total_paise, idempotency_key)
         VALUES ($1, $2, 'CONFIRMED', 0, $3)
         RETURNING id;`,
        [eventId, studentUserIds[1], `idemp-scan-bk-${Date.now()}`]
      );
      const bookingId = bkRes.rows[0].id;

      const ticket = await createTicketWithRetry(client, {
        bookingId,
        eventId,
        ticketTypeId,
        userId: studentUserIds[1],
      });
      ticketId = ticket.id;
      rawToken = ticket.rawToken;
    } finally {
      client.release();
    }

    // Launch 6 concurrent scans with the exact same QR token
    const scanPromises = Array.from({ length: 6 }).map((_, idx) =>
      scanTicket({
        tokenOrUrl: rawToken,
        eventId,
        staffId,
        deviceId: `turnstile-${idx}`,
      })
    );

    const outcomes = await Promise.all(scanPromises);
    const accepted = outcomes.filter((o) => o.outcome === 'ACCEPTED');
    const duplicate = outcomes.filter((o) => o.outcome === 'DUPLICATE');

    expect(accepted.length).toBe(1);
    expect(duplicate.length).toBe(5);

    // Database check: exactly 1 checkin record exists in checkins table
    const checkClient = await pool.connect();
    try {
      const chkRes = await checkClient.query(`SELECT COUNT(*)::int as count FROM checkins WHERE ticket_id = $1;`, [
        ticketId,
      ]);
      expect(chkRes.rows[0].count).toBe(1);

      const tktRes = await checkClient.query(`SELECT status FROM tickets WHERE id = $1;`, [ticketId]);
      expect(tktRes.rows[0].status).toBe('CHECKED_IN');
    } finally {
      checkClient.release();
    }
  });

  it('3. Double-Claim Waitlist Race: 5 concurrent claim requests for a single offer -> exactly 1 succeeds, others 409', async () => {
    const client = await pool.connect();
    let eventId: string;
    let ticketTypeId: string;
    let waitlistEntryId: string;
    const targetUserId = studentUserIds[2];
    const claimRawToken = crypto.randomBytes(32).toString('hex');
    const claimTokenHash = crypto.createHash('sha256').update(claimRawToken).digest('hex');

    try {
      const evtRes = await client.query(
        `INSERT INTO events (
           organizer_id, college_id, title, slug, description, category, department, format,
           starts_at, ends_at, capacity, visibility, status, contact_email, created_by, team_mode,
           registration_opens_at, registration_closes_at
         ) VALUES (
           $1, $2, 'Waitlist Race Event', $3, 'Test', 'technical', 'CSE', 'in_person',
           NOW() + INTERVAL '1 day', NOW() + INTERVAL '2 days', 5, 'public', 'published', 'wl@p32.edu', $4, 'none',
           NOW() - INTERVAL '1 hour', NOW() + INTERVAL '1 day'
         ) RETURNING id;`,
        [organizerId, collegeId, `p32-wl-${Date.now()}`, organizerUserId]
      );
      eventId = evtRes.rows[0].id;

      const ttRes = await client.query(
        `INSERT INTO ticket_types (event_id, name, price_paise, capacity, sold, held, per_user_limit)
         VALUES ($1, 'WL Tier', 0, 5, 4, 1, 1)
         RETURNING id;`,
        [eventId]
      );
      ticketTypeId = ttRes.rows[0].id;

      const wlRes = await client.query(
        `INSERT INTO waitlist_entries (
           event_id, user_id, ticket_type_id, status, offer_expires_at, claim_token_hash
         ) VALUES (
           $1, $2, $3, 'OFFERED', NOW() + INTERVAL '2 hours', $4
         ) RETURNING id;`,
        [eventId, targetUserId, ticketTypeId, claimTokenHash]
      );
      waitlistEntryId = wlRes.rows[0].id;
    } finally {
      client.release();
    }

    // Launch 5 concurrent claims with distinct idempotency keys (simulating distinct worker/client races)
    const claimPromises = Array.from({ length: 5 }).map((_, idx) =>
      claimOffer({
        entryId: waitlistEntryId,
        userId: targetUserId,
        claimToken: claimRawToken,
        idempotencyKey: `idemp-claim-race-${idx}-${Date.now()}`,
      })
    );

    const results = await Promise.allSettled(claimPromises);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(4);

    // Verify rejected were OFFER_INVALID_OR_EXPIRED (409)
    for (const r of rejected) {
      if (r.status === 'rejected') {
        expect(r.reason?.status).toBe(409);
        expect(r.reason?.code).toBe('OFFER_INVALID_OR_EXPIRED');
      }
    }

    // Check DB state: waitlist entry status is CLAIMED
    const checkClient = await pool.connect();
    try {
      const entryRes = await checkClient.query(`SELECT status FROM waitlist_entries WHERE id = $1;`, [
        waitlistEntryId,
      ]);
      expect(entryRes.rows[0].status).toBe('CLAIMED');
    } finally {
      checkClient.release();
    }
  });

  it('4. Double-Confirm Payment Webhook Race: duplicate concurrent SUCCESS webhooks -> exactly 1 transitions payment, 0 duplicate tickets', async () => {
    const client = await pool.connect();
    let eventId: string;
    let ticketTypeId: string;
    let bookingId: string;
    let paymentId: string;
    const buyerId = studentUserIds[3];
    const orderId = `youpi_ord_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    try {
      const evtRes = await client.query(
        `INSERT INTO events (
           organizer_id, college_id, title, slug, description, category, department, format,
           starts_at, ends_at, capacity, visibility, status, contact_email, created_by, team_mode
         ) VALUES (
           $1, $2, 'Paid Concurrency Event', $3, 'Test', 'technical', 'CSE', 'in_person',
           NOW() + INTERVAL '1 day', NOW() + INTERVAL '2 days', 50, 'public', 'published', 'paid@p32.edu', $4, 'none'
         ) RETURNING id;`,
        [organizerId, collegeId, `p32-paid-${Date.now()}`, organizerUserId]
      );
      eventId = evtRes.rows[0].id;

      const ttRes = await client.query(
        `INSERT INTO ticket_types (event_id, name, price_paise, capacity, sold, held, per_user_limit)
         VALUES ($1, 'Paid Tier', 50000, 50, 0, 1, 1)
         RETURNING id;`,
        [eventId]
      );
      ticketTypeId = ttRes.rows[0].id;

      const bkRes = await client.query(
        `INSERT INTO bookings (event_id, user_id, status, total_paise, idempotency_key, expires_at)
         VALUES ($1, $2, 'PENDING_PAYMENT', 50000, $3, NOW() + INTERVAL '15 minutes')
         RETURNING id;`,
        [eventId, buyerId, `idemp-bk-paid-${Date.now()}`]
      );
      bookingId = bkRes.rows[0].id;

      await client.query(
        `INSERT INTO booking_items (booking_id, ticket_type_id, quantity, unit_price_paise)
         VALUES ($1, $2, 1, 50000);`,
        [bookingId, ticketTypeId]
      );

      const pRes = await client.query(
        `INSERT INTO payments (booking_id, amount_paise, currency, status, provider, provider_order_id)
         VALUES ($1, 50000, 'INR', 'PENDING', 'youpi', $2)
         RETURNING id;`,
        [bookingId, orderId]
      );
      paymentId = pRes.rows[0].id;
    } finally {
      client.release();
    }

    // Launch 2 concurrent payment confirmation transactions for the exact same order
    const [resA, resB] = await Promise.all([
      executePaymentConfirmationTransaction({
        orderId,
        paymentId: `provider_pay_a_${Date.now()}`,
        adapterSuccess: true,
        amountPaise: 50000,
        expectedUserId: buyerId,
      }),
      executePaymentConfirmationTransaction({
        orderId,
        paymentId: `provider_pay_b_${Date.now()}`,
        adapterSuccess: true,
        amountPaise: 50000,
        expectedUserId: buyerId,
      }),
    ]);

    // Exactly 1 performed the transition, the other is an idempotent replay
    const confirmedCount = [resA, resB].filter((r) => r.confirmed).length;
    expect(confirmedCount).toBe(2);
    const alreadyProcessedCount = [resA, resB].filter((r) => r.alreadyProcessed).length;
    expect(alreadyProcessedCount).toBe(1);

    // Check database invariants
    const checkClient = await pool.connect();
    try {
      const tktRes = await checkClient.query(`SELECT COUNT(*)::int as count FROM tickets WHERE booking_id = $1;`, [
        bookingId,
      ]);
      // Exactly 1 ticket issued regardless of race condition
      expect(tktRes.rows[0].count).toBe(1);

      const payRes = await checkClient.query(`SELECT status FROM payments WHERE id = $1;`, [paymentId]);
      expect(['SUCCESS', 'SUCCEEDED']).toContain(payRes.rows[0].status);
    } finally {
      checkClient.release();
    }
  });

  it('5. Refund Race: concurrent decision on refund request -> exactly 1 succeeds, second gets 409 ALREADY_DECIDED', async () => {
    const client = await pool.connect();
    let bookingId: string;
    let refundId: string;
    const buyerId = studentUserIds[4];

    try {
      const evtRes = await client.query(
        `INSERT INTO events (
           organizer_id, college_id, title, slug, description, category, department, format,
           starts_at, ends_at, capacity, visibility, status, contact_email, created_by, team_mode
         ) VALUES (
           $1, $2, 'Refund Race Event', $3, 'Test', 'technical', 'CSE', 'in_person',
           NOW() + INTERVAL '5 days', NOW() + INTERVAL '6 days', 20, 'public', 'published', 'ref@p32.edu', $4, 'none'
         ) RETURNING id;`,
        [organizerId, collegeId, `p32-ref-${Date.now()}`, organizerUserId]
      );
      const eventId = evtRes.rows[0].id;

      await client.query(
        `INSERT INTO ticket_types (event_id, name, price_paise, capacity, sold, held, per_user_limit)
         VALUES ($1, 'Ref Tier', 25000, 20, 1, 0, 1);`,
        [eventId]
      );

      const bkRes = await client.query(
        `INSERT INTO bookings (event_id, user_id, status, total_paise, idempotency_key)
         VALUES ($1, $2, 'CONFIRMED', 25000, $3)
         RETURNING id;`,
        [eventId, buyerId, `idemp-bk-ref-${Date.now()}`]
      );
      bookingId = bkRes.rows[0].id;

      await client.query(
        `INSERT INTO payments (booking_id, amount_paise, currency, status, provider, provider_order_id)
         VALUES ($1, 25000, 'INR', 'SUCCESS', 'youpi', $2);`,
        [bookingId, `order_ref_${Date.now()}`]
      );

      // Submit refund request
      const refundRes = await requestRefund({
        bookingId,
        userId: buyerId,
        reason: 'Duplicate purchase',
        idempotencyKey: `idemp-refund-${Date.now()}`,
      });
      refundId = refundRes.id;
    } finally {
      client.release();
    }

    // Two organizer managers concurrently attempt to decide the refund
    // One approves, the other rejects
    const [decisionA, decisionB] = await Promise.allSettled([
      decideRefund({
        refundId,
        decision: 'APPROVED',
        userId: organizerUserId,
      }),
      decideRefund({
        refundId,
        decision: 'REJECTED',
        userId: organizerUserId,
      }),
    ]);

    const fulfilled = [decisionA, decisionB].filter((d) => d.status === 'fulfilled');
    const rejected = [decisionA, decisionB].filter((d) => d.status === 'rejected');

    // Exactly 1 decision succeeded, the other was rejected with ALREADY_DECIDED
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    if (rejected[0].status === 'rejected') {
      expect(rejected[0].reason?.code).toBe('ALREADY_DECIDED');
      expect(rejected[0].reason?.status).toBe(409);
    }
  });
});
