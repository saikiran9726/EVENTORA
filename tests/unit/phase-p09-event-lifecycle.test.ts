import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { buildApp } from '../../packages/backend/src/app.js';
import { pool } from '../../packages/backend/src/db/index.js';
import {
  transitionEventStatus,
  isValidTransition,
  InvalidTransitionError,
} from '../../packages/backend/src/services/event-lifecycle.js';
import {
  autoCompleteEndedEvents,
  runEventCompletionLeaderJob,
  EVENT_COMPLETER_ADVISORY_LOCK_ID,
} from '../../packages/backend/src/services/event-scheduler.js';
import { scanTicket } from '../../packages/backend/src/services/qr-ticket.js';
import { createBooking, BookingError } from '../../packages/backend/src/services/booking.js';
import { runRollbackToVersion } from '../../packages/backend/src/db/migrate-down.js';
import { runMigrations } from '../../packages/backend/src/db/migrate.js';

describe('Phase P09: Event Lifecycle & Cancel Cascade Quality Gate', () => {
  let app: any;
  let collegeId: string;
  let organizerId: string;
  let orgUserId: string;
  let venueId: string;
  const createdUserIds: string[] = [];
  const createdEventIds: string[] = [];

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

  async function createUser(emailPrefix: string): Promise<string> {
    const res = await pool.query(
      `INSERT INTO users (college_id, email, password_hash, display_name, global_role, status)
       VALUES ($1, $2, 'hash', $3, 'student', 'active')
       RETURNING id;`,
      [collegeId, `${emailPrefix}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}@campus.edu`, `User ${emailPrefix}`]
    );
    const id = res.rows[0].id;
    createdUserIds.push(id);
    return id;
  }

  let eventSeq = 0;
  async function createEventWithFullState(opts?: {
    status?: string;
    startsAt?: Date;
    endsAt?: Date;
    pricePaise?: number;
  }) {
    const client = await pool.connect();
    try {
      eventSeq++;
      const status = opts?.status || 'published';
      const defaultStartsAt = new Date(Date.now() + (30 + eventSeq * 3) * 86400000);
      const startsAt = opts?.startsAt || defaultStartsAt;
      const endsAt = opts?.endsAt || new Date(startsAt.getTime() + 24 * 3600000);
      const pricePaise = opts?.pricePaise ?? 50000; // 500.00 INR

      const eRes = await client.query(
        `INSERT INTO events (
           organizer_id, college_id, title, slug, description, category, department, format,
           venue_id, starts_at, ends_at, capacity, status, visibility, contact_email, created_by
         ) VALUES (
           $1, $2, 'Lifecycle Fest', $3, 'Testing Lifecycle', 'Technology', 'CSE', 'in_person',
           $4, $5, $6, 100, $7, 'public', 'org@campus.edu', $8
         ) RETURNING id;`,
        [
          organizerId,
          collegeId,
          `life-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          venueId,
          startsAt,
          endsAt,
          status,
          orgUserId,
        ]
      );
      const eventId = eRes.rows[0].id;
      createdEventIds.push(eventId);

      // Create ticket tier
      const ttRes = await client.query(
        `INSERT INTO ticket_types (event_id, name, price_paise, capacity, sold, held)
         VALUES ($1, 'VIP Pass', $2, 50, 0, 0)
         RETURNING id;`,
        [eventId, pricePaise]
      );
      const ticketTypeId = ttRes.rows[0].id;

      // Create venue booking on hold or confirmed
      await client.query(
        `INSERT INTO venue_bookings (venue_id, event_id, during, status)
         VALUES ($1, $2, tstzrange($3, $4, '[)'), 'confirmed')
         ON CONFLICT DO NOTHING;`,
        [venueId, eventId, startsAt, endsAt]
      );

      return { eventId, ticketTypeId, startsAt, endsAt };
    } finally {
      client.release();
    }
  }

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    const client = await pool.connect();
    try {
      const cRes = await client.query('SELECT id FROM colleges LIMIT 1;');
      collegeId = cRes.rows[0].id;

      const uRes = await client.query(
        `INSERT INTO users (college_id, email, password_hash, display_name, global_role, status)
         VALUES ($1, $2, 'hash', 'Organizer Lead P09', 'student', 'active')
         RETURNING id;`,
        [collegeId, `org.lead.p09.${Date.now()}@campus.edu`]
      );
      orgUserId = uRes.rows[0].id;
      createdUserIds.push(orgUserId);

      const pRes = await client.query(
        `INSERT INTO organizer_profiles (college_id, display_name, status, created_by)
         VALUES ($1, 'P09 Engineering Society', 'verified', $2)
         RETURNING id;`,
        [collegeId, orgUserId]
      );
      organizerId = pRes.rows[0].id;

      await client.query(
        `INSERT INTO organizer_members (organizer_id, user_id, role, status)
         VALUES ($1, $2, 'owner', 'active');`,
        [organizerId, orgUserId]
      );

      const vRes = await client.query(
        `INSERT INTO venues (college_id, name, building, capacity)
         VALUES ($1, 'P09 Test Arena', 'Campus Center', 500)
         RETURNING id;`,
        [collegeId]
      );
      venueId = vRes.rows[0].id;
    } finally {
      client.release();
    }
  }, 30000);

  afterAll(async () => {
    const client = await pool.connect();
    try {
      if (createdEventIds.length > 0) {
        await client.query(`DELETE FROM scan_log WHERE event_id = ANY($1::uuid[]);`, [createdEventIds]);
        await client.query(`DELETE FROM checkins WHERE event_id = ANY($1::uuid[]);`, [createdEventIds]);
        await client.query(`DELETE FROM outbox WHERE payload->>'eventId' = ANY($1::text[]);`, [createdEventIds]);
        await client.query(`DELETE FROM refunds WHERE payment_id IN (SELECT id FROM payments WHERE booking_id IN (SELECT id FROM bookings WHERE event_id = ANY($1::uuid[])));`, [createdEventIds]);
        await client.query(`DELETE FROM payments WHERE booking_id IN (SELECT id FROM bookings WHERE event_id = ANY($1::uuid[]));`, [createdEventIds]);
        await client.query(`DELETE FROM tickets WHERE event_id = ANY($1::uuid[]);`, [createdEventIds]);
        await client.query(`DELETE FROM waitlist_entries WHERE event_id = ANY($1::uuid[]);`, [createdEventIds]);
        await client.query(`DELETE FROM bookings WHERE event_id = ANY($1::uuid[]);`, [createdEventIds]);
        await client.query(`DELETE FROM ticket_types WHERE event_id = ANY($1::uuid[]);`, [createdEventIds]);
        await client.query(`DELETE FROM venue_bookings WHERE event_id = ANY($1::uuid[]);`, [createdEventIds]);
        await client.query(`DELETE FROM event_status_history WHERE event_id = ANY($1::uuid[]);`, [createdEventIds]);
        await client.query(`DELETE FROM events WHERE id = ANY($1::uuid[]);`, [createdEventIds]);
      }
      if (venueId) {
        await client.query(`DELETE FROM venues WHERE id = $1;`, [venueId]);
      }
      if (organizerId) {
        await client.query(`DELETE FROM organizer_members WHERE organizer_id = $1;`, [organizerId]);
        await client.query(`DELETE FROM organizer_profiles WHERE id = $1;`, [organizerId]);
      }
      if (createdUserIds.length > 0) {
        await client.query(`DELETE FROM sessions WHERE user_id = ANY($1::uuid[]);`, [createdUserIds]);
        await client.query(`DELETE FROM users WHERE id = ANY($1::uuid[]);`, [createdUserIds]);
      }
    } catch (e) {
      console.warn('afterAll cleanup error:', e);
    } finally {
      client.release();
    }
  }, 30000);

  // 1. Single Transaction & Atomicity Tests
  describe('1. Single Database Transaction & Transition Integrity', () => {
    it('validates state transitions via state machine table', () => {
      expect(isValidTransition('draft', 'pending_approval')).toBe(true);
      expect(isValidTransition('approved', 'published')).toBe(true);
      expect(isValidTransition('published', 'cancelled')).toBe(true);
      expect(isValidTransition('published', 'postponed')).toBe(true);
      expect(isValidTransition('published', 'completed')).toBe(true);

      // Blocked skips
      expect(isValidTransition('draft', 'published')).toBe(false);
      expect(isValidTransition('cancelled', 'published')).toBe(false);
      expect(isValidTransition('completed', 'published')).toBe(false);
    });

    it('rejects invalid state transition with InvalidTransitionError and touches no data', async () => {
      const { eventId } = await createEventWithFullState({ status: 'draft' });

      await expect(
        transitionEventStatus(eventId, 'draft', 'published', {
          actorId: orgUserId,
          actorRole: 'student',
        })
      ).rejects.toThrow(InvalidTransitionError);

      // Verify status remains draft
      const res = await pool.query('SELECT status FROM events WHERE id = $1;', [eventId]);
      expect(res.rows[0].status).toBe('draft');
    });

    it('optimistic locking: rejects transition if fromStatus does not match current DB status', async () => {
      const { eventId } = await createEventWithFullState({ status: 'published' });

      await expect(
        transitionEventStatus(eventId, 'draft' as any, 'cancelled', {
          actorId: orgUserId,
          actorRole: 'student',
        })
      ).rejects.toThrow(InvalidTransitionError);
    });
  });

  // 2. Full Cancel Cascade on Published Paid Event
  describe('2. Cancel Cascade on Published Paid Event', () => {
    it('cancels event, cancels bookings, revokes tickets, resets tiers, closes waitlist, queues refunds, writes outbox & audit in 1 transaction', async () => {
      const { eventId, ticketTypeId } = await createEventWithFullState({
        status: 'published',
        pricePaise: 25000, // 250.00 INR
      });

      const attendee1Id = await createUser('att1.cancel');
      const attendee2Id = await createUser('att2.cancel');
      const waitlistUserId = await createUser('wl.cancel');

      // 1. Create paid booking 1 with succeeded payment & valid ticket
      const b1Res = await pool.query(
        `INSERT INTO bookings (user_id, event_id, status, total_paise, idempotency_key)
         VALUES ($1, $2, 'CONFIRMED', 25000, $3)
         RETURNING id;`,
        [attendee1Id, eventId, `idem_b1_${Date.now()}`]
      );
      const booking1Id = b1Res.rows[0].id;

      const p1Res = await pool.query(
        `INSERT INTO payments (booking_id, provider, provider_order_id, provider_payment_id, amount_paise, status, is_simulated)
         VALUES ($1, 'simulator', $2, $3, 25000, 'SUCCEEDED', true)
         RETURNING id;`,
        [booking1Id, `order_p1_${Date.now()}`, `pay_p1_${Date.now()}`]
      );
      const payment1Id = p1Res.rows[0].id;

      const rawToken1 = crypto.randomBytes(32).toString('hex').slice(0, 43);
      const qrHash1 = crypto.createHash('sha256').update(rawToken1).digest();
      await pool.query(
        `INSERT INTO tickets (booking_id, ticket_type_id, user_id, event_id, qr_payload_hash, qr_token_hash, ticket_code, status)
         VALUES ($1, $2, $3, $4, $5, $5, $6, 'VALID');`,
        [booking1Id, ticketTypeId, attendee1Id, eventId, qrHash1, `TC1-${Date.now()}`]
      );

      // 2. Create paid booking 2 with succeeded payment & valid ticket
      const b2Res = await pool.query(
        `INSERT INTO bookings (user_id, event_id, status, total_paise, idempotency_key)
         VALUES ($1, $2, 'CONFIRMED', 25000, $3)
         RETURNING id;`,
        [attendee2Id, eventId, `idem_b2_${Date.now()}`]
      );
      const booking2Id = b2Res.rows[0].id;

      const p2Res = await pool.query(
        `INSERT INTO payments (booking_id, provider, provider_order_id, provider_payment_id, amount_paise, status, is_simulated)
         VALUES ($1, 'simulator', $2, $3, 25000, 'SUCCEEDED', true)
         RETURNING id;`,
        [booking2Id, `order_p2_${Date.now()}`, `pay_p2_${Date.now()}`]
      );
      const payment2Id = p2Res.rows[0].id;

      const rawToken2 = crypto.randomBytes(32).toString('hex').slice(0, 43);
      const qrHash2 = crypto.createHash('sha256').update(rawToken2).digest();
      await pool.query(
        `INSERT INTO tickets (booking_id, ticket_type_id, user_id, event_id, qr_payload_hash, qr_token_hash, ticket_code, status)
         VALUES ($1, $2, $3, $4, $5, $5, $6, 'VALID');`,
        [booking2Id, ticketTypeId, attendee2Id, eventId, qrHash2, `TC2-${Date.now()}`]
      );

      // 3. Mark sold and held on ticket_type
      await pool.query(
        `UPDATE ticket_types SET sold = 2, held = 1 WHERE id = $1;`,
        [ticketTypeId]
      );

      // 4. Add waitlist entry (OFFERED)
      await pool.query(
        `INSERT INTO waitlist_entries (event_id, ticket_type_id, user_id, status)
         VALUES ($1, $2, $3, 'OFFERED');`,
        [eventId, ticketTypeId, waitlistUserId]
      );

      // 5. Call cancel endpoint as organizer via POST /api/v1/events/:id/cancel
      const sessionHeaders = await createSessionForUser(orgUserId);
      const cancelRes = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${eventId}/cancel`,
        headers: sessionHeaders,
        payload: {
          note: 'Severe campus weather emergency',
        },
      });

      expect(cancelRes.statusCode).toBe(200);
      const cancelBody = JSON.parse(cancelRes.payload);

      // Verify real counts returned by the API
      expect(cancelBody.cancelledBookingsCount).toBe(2);
      expect(cancelBody.ticketsRevokedCount).toBe(2);
      expect(cancelBody.refundsQueuedCount).toBe(2);
      expect(cancelBody.waitlistClosedCount).toBe(1);
      expect(cancelBody.outboxQueuedCount).toBeGreaterThanOrEqual(2); // 2 attendee notices + 1 event notice
      expect(cancelBody.message).toContain('Released 2 bookings, revoked 2 tickets, queued 2 refunds, and closed 1 waitlist entries');

      // Verify database state
      const evCheck = await pool.query('SELECT status FROM events WHERE id = $1;', [eventId]);
      expect(evCheck.rows[0].status).toBe('cancelled');

      const bCheck = await pool.query('SELECT status FROM bookings WHERE event_id = $1;', [eventId]);
      expect(bCheck.rows.length).toBe(2);
      for (const r of bCheck.rows) {
        expect(r.status).toBe('CANCELLED');
      }

      const tCheck = await pool.query('SELECT status FROM tickets WHERE event_id = $1;', [eventId]);
      expect(tCheck.rows.length).toBe(2);
      for (const r of tCheck.rows) {
        expect(r.status).toBe('REVOKED');
      }

      const ttCheck = await pool.query('SELECT sold, held FROM ticket_types WHERE id = $1;', [ticketTypeId]);
      expect(ttCheck.rows[0].sold).toBe(0);
      expect(ttCheck.rows[0].held).toBe(0);

      const wlCheck = await pool.query('SELECT status FROM waitlist_entries WHERE event_id = $1;', [eventId]);
      expect(wlCheck.rows[0].status).toBe('EXPIRED');

      const refCheck = await pool.query('SELECT * FROM refunds WHERE payment_id IN ($1, $2);', [payment1Id, payment2Id]);
      expect(refCheck.rows.length).toBe(2);
      for (const ref of refCheck.rows) {
        expect(ref.status).toBe('REQUESTED');
        expect(ref.amount_paise).toBe(25000);
        expect(ref.reason).toContain('Severe campus weather emergency');
      }

      const pCheck = await pool.query('SELECT status FROM payments WHERE id IN ($1, $2);', [payment1Id, payment2Id]);
      for (const p of pCheck.rows) {
        expect(p.status).toBe('REFUND_PENDING');
      }

      // Check venue booking was released
      const vbCheck = await pool.query('SELECT status FROM venue_bookings WHERE event_id = $1;', [eventId]);
      expect(vbCheck.rows[0].status).toBe('released');

      // Check outbox entries
      const obCheck = await pool.query(
        `SELECT event_type, payload FROM outbox WHERE payload->>'eventId' = $1;`,
        [eventId]
      );
      const outboxTypes = obCheck.rows.map((r: any) => r.event_type);
      expect(outboxTypes).toContain('event.cancelled');
      expect(outboxTypes).toContain('notification.event_cancelled');

      // Check audit log recorded in same transaction
      const auditCheck = await pool.query(
        `SELECT action, meta FROM audit_logs WHERE resource_id = $1 AND action = 'event.status_changed.cancelled';`,
        [eventId]
      );
      expect(auditCheck.rows.length).toBeGreaterThan(0);
    });
  });

  // 3. Check-in Scanner & Booking Guards on Non-Published Events
  describe('3. Check-in Scanner & Booking Guards on Non-Published Events', () => {
    it('scanner rejects tickets for cancelled events with REVOKED outcome', async () => {
      const { eventId, ticketTypeId } = await createEventWithFullState({ status: 'published' });
      const attendeeId = await createUser('att.scan.cancel');

      const bRes = await pool.query(
        `INSERT INTO bookings (user_id, event_id, status, total_paise, idempotency_key)
         VALUES ($1, $2, 'CONFIRMED', 0, $3) RETURNING id;`,
        [attendeeId, eventId, `idem_scan_cancel_${Date.now()}`]
      );
      const bookingId = bRes.rows[0].id;

      const rawToken = crypto.randomBytes(32).toString('hex').slice(0, 43);
      const qrHash = crypto.createHash('sha256').update(rawToken).digest();
      await pool.query(
        `INSERT INTO tickets (booking_id, ticket_type_id, user_id, event_id, qr_payload_hash, qr_token_hash, ticket_code, status)
         VALUES ($1, $2, $3, $4, $5, $5, $6, 'VALID');`,
        [bookingId, ticketTypeId, attendeeId, eventId, qrHash, `TC-scan1-${Date.now()}`]
      );

      // Cancel the event
      await transitionEventStatus(eventId, 'published', 'cancelled', {
        actorId: orgUserId,
        actorRole: 'student',
        note: 'Cancelling for scan test',
      });

      // Staff scans attendee ticket
      const scanRes = await scanTicket({
        tokenOrUrl: rawToken,
        eventId,
        staffId: orgUserId,
      });

      expect(scanRes.outcome).toBe('REVOKED');
      expect(scanRes.message).toContain('Revoked Ticket');
    });

    it('scanner rejects tickets for non-published events (e.g. postponed) with EVENT_NOT_PUBLISHED', async () => {
      const { eventId, ticketTypeId } = await createEventWithFullState({ status: 'published' });
      const attendeeId = await createUser('att.scan.postponed');

      const bRes = await pool.query(
        `INSERT INTO bookings (user_id, event_id, status, total_paise, idempotency_key)
         VALUES ($1, $2, 'CONFIRMED', 0, $3) RETURNING id;`,
        [attendeeId, eventId, `idem_scan_cancel_${Date.now()}`]
      );
      const bookingId = bRes.rows[0].id;

      const rawToken = crypto.randomBytes(32).toString('hex').slice(0, 43);
      const qrHash = crypto.createHash('sha256').update(rawToken).digest();
      await pool.query(
        `INSERT INTO tickets (booking_id, ticket_type_id, user_id, event_id, qr_payload_hash, qr_token_hash, ticket_code, status)
         VALUES ($1, $2, $3, $4, $5, $5, $6, 'VALID');`,
        [bookingId, ticketTypeId, attendeeId, eventId, qrHash, `TC-scan1-${Date.now()}`]
      );

      // Postpone the event
      await transitionEventStatus(eventId, 'published', 'postponed', {
        actorId: orgUserId,
        actorRole: 'student',
        note: 'Postponed due to delay',
      });

      const scanRes = await scanTicket({
        tokenOrUrl: rawToken,
        eventId,
        staffId: orgUserId,
      });

      expect(scanRes.outcome).toBe('EVENT_NOT_PUBLISHED');
      expect(scanRes.message).toContain('postponed');
    });

    it('booking service rejects reservations on non-published events (EVENT_NOT_PUBLISHED)', async () => {
      const { eventId, ticketTypeId } = await createEventWithFullState({ status: 'published' });
      const attendeeId = await createUser('att.book.nonpub');

      // Cancel event
      await transitionEventStatus(eventId, 'published', 'cancelled', {
        actorId: orgUserId,
        actorRole: 'student',
      });

      await expect(
        createBooking({
          eventId,
          userId: attendeeId,
          items: [{ ticketTypeId, quantity: 1 }],
        })
      ).rejects.toThrowError(BookingError);
    });
  });

  // 4. Material Edits on Published Events: Outbox Reschedule Notifications
  describe('4. Material Edits on Published Events', () => {
    it('notifies active ticket holders via notification.event_rescheduled outbox on startsAt/endsAt changes', async () => {
      const { eventId, ticketTypeId, startsAt, endsAt } = await createEventWithFullState({ status: 'published' });
      const attendee1Id = await createUser('att.resched1');
      const attendee2Id = await createUser('att.resched2');

      // Create active tickets
      for (const attId of [attendee1Id, attendee2Id]) {
        const bRes = await pool.query(
          `INSERT INTO bookings (user_id, event_id, status, total_paise, idempotency_key)
           VALUES ($1, $2, 'CONFIRMED', 0, $3) RETURNING id;`,
          [attId, eventId, `idem_resched_${attId}_${Date.now()}`]
        );
        const bId = bRes.rows[0].id;
        const rawToken = crypto.randomBytes(32).toString('hex').slice(0, 43);
        const qrHash = crypto.createHash('sha256').update(rawToken).digest();
        await pool.query(
          `INSERT INTO tickets (booking_id, ticket_type_id, user_id, event_id, qr_payload_hash, qr_token_hash, ticket_code, status)
           VALUES ($1, $2, $3, $4, $5, $5, $6, 'VALID');`,
          [bId, ticketTypeId, attId, eventId, qrHash, `TC-mat-${attId}-${Date.now()}`]
        );
      }

      // Perform material edit via PATCH /api/v1/events/:id
      const newStartsAt = new Date(startsAt.getTime() + 2 * 86400000);
      const newEndsAt = new Date(endsAt.getTime() + 2 * 86400000);

      const sessionHeaders = await createSessionForUser(orgUserId);
      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/events/${eventId}`,
        headers: sessionHeaders,
        payload: {
          startsAt: newStartsAt.toISOString(),
          endsAt: newEndsAt.toISOString(),
        },
      });

      expect(patchRes.statusCode).toBe(200);

      // Verify outbox contains notification.event_rescheduled for attendee1 and attendee2
      const obRes = await pool.query(
        `SELECT event_type, payload FROM outbox
         WHERE event_type = 'notification.event_rescheduled'
           AND payload->>'eventId' = $1;`,
        [eventId]
      );

      expect(obRes.rows.length).toBe(2);
      const userIdsNotified = obRes.rows.map((r: any) => r.payload.userId);
      expect(userIdsNotified).toContain(attendee1Id);
      expect(userIdsNotified).toContain(attendee2Id);
    });
  });

  // 5. Event Auto-Completion Scheduler
  describe('5. Event Auto-Completion Scheduler with Advisory Lock', () => {
    it('auto-completes events whose ends_at is in the past and writes system status history', async () => {
      // Event ended 1 hour ago
      const pastEndsAt = new Date(Date.now() - 3600000);
      const pastStartsAt = new Date(Date.now() - 7200000);
      const { eventId } = await createEventWithFullState({
        status: 'published',
        startsAt: pastStartsAt,
        endsAt: pastEndsAt,
      });

      const res = await autoCompleteEndedEvents(eventId);
      expect(res.eventIds).toContain(eventId);

      // Verify DB status is now 'completed'
      const evRes = await pool.query('SELECT status FROM events WHERE id = $1;', [eventId]);
      expect(evRes.rows[0].status).toBe('completed');

      // Verify event_status_history has actor_id as NULL (system) and note
      const histRes = await pool.query(
        `SELECT from_status, to_status, actor_id, note FROM event_status_history
         WHERE event_id = $1 ORDER BY at DESC LIMIT 1;`,
        [eventId]
      );
      expect(histRes.rows[0].from_status).toBe('published');
      expect(histRes.rows[0].to_status).toBe('completed');
      expect(histRes.rows[0].actor_id).toBeNull();
      expect(histRes.rows[0].note).toContain('Auto-completed by system scheduler');
    });

    it('advisory lock prevents concurrent duplicate scheduler runs across cluster nodes', async () => {
      const lockClient = await pool.connect();
      try {
        // Node A holds the lock
        const lockRes = await lockClient.query(
          `SELECT pg_try_advisory_lock($1) as acquired;`,
          [EVENT_COMPLETER_ADVISORY_LOCK_ID]
        );
        expect(lockRes.rows[0].acquired).toBe(true);

        // Node B tries to run leader job
        const jobResult = await runEventCompletionLeaderJob();
        expect(jobResult.executed).toBe(false);
        expect(jobResult.acquired).toBe(false);
        expect(jobResult.reason).toBe('LOCKED_BY_ANOTHER_LEADER');
      } finally {
        await lockClient.query(`SELECT pg_advisory_unlock($1);`, [EVENT_COMPLETER_ADVISORY_LOCK_ID]);
        lockClient.release();
      }
    });
  });

  // 6. Migration 14 Expand / Contract Rollback Verification
  describe('6. Schema Migration 14 Expand / Contract Rollback', () => {
    it('verifies rollback from 14 to 13 and re-application to 14 maintains data integrity', async () => {
      // 1. Verify currently at version >= 14
      const v1 = await pool.query('SELECT MAX(version) as ver FROM schema_migrations;');
      expect(Number(v1.rows[0].ver)).toBeGreaterThanOrEqual(14);

      // 2. Rollback to version 13
      await runRollbackToVersion(13);
      const v2 = await pool.query('SELECT MAX(version) as ver FROM schema_migrations;');
      expect(Number(v2.rows[0].ver)).toBe(13);

      // 3. Re-apply to >= 14
      await runMigrations();
      const v3 = await pool.query('SELECT MAX(version) as ver FROM schema_migrations;');
      expect(Number(v3.rows[0].ver)).toBeGreaterThanOrEqual(14);
    });
  });
});
