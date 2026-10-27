import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../packages/backend/src/app.js';
import { pool } from '../../packages/backend/src/db/index.js';
import {
  scanTicket,
  createTicketWithRetry,
} from '../../packages/backend/src/services/qr-ticket.js';
import { soundEffects } from '../../packages/frontend/src/lib/audio.js';

describe('Phase P15: Camera Scanner & Scan Hardening', () => {
  let app: any;
  let collegeId: string;
  let organizerId: string;
  let organizerUserId: string;
  let regularStaffUserId: string;
  let adminUserId: string;
  let eventAId: string;
  let eventBId: string;
  let ticketTypeAId: string;
  let ticketTypeBId: string;
  let bookingAId: string;
  let bookingBId: string;

  const createdUserIds: string[] = [];
  const createdEventIds: string[] = [];

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    const client = await pool.connect();
    try {
      // 1. Fetch College
      const cRes = await client.query('SELECT id FROM colleges LIMIT 1;');
      collegeId = cRes.rows[0].id;

      // 2. Create Users (Organizer, Regular Staff, Admin)
      const uRes = await client.query(
        `INSERT INTO users (college_id, email, password_hash, display_name, global_role, status, email_verified_at)
         VALUES
           ($1, $2, 'hash_org', 'Organizer Lead', 'student', 'active', NOW()),
           ($1, $3, 'hash_staff', 'Regular Volunteer Staff', 'student', 'active', NOW()),
           ($1, $4, 'hash_admin', 'Campus Admin', 'admin', 'active', NOW())
         RETURNING id, global_role;`,
        [
          collegeId,
          `org.lead.p15.${Date.now()}@campus.edu`,
          `staff.p15.${Date.now()}@campus.edu`,
          `admin.p15.${Date.now()}@campus.edu`,
        ]
      );

      organizerUserId = uRes.rows[0].id;
      regularStaffUserId = uRes.rows[1].id;
      adminUserId = uRes.rows[2].id;
      createdUserIds.push(organizerUserId, regularStaffUserId, adminUserId);

      // 3. Organizer Profile
      const orgRes = await client.query(
        `INSERT INTO organizer_profiles (college_id, display_name, status, created_by)
         VALUES ($1, 'P15 Robotics Society', 'verified', $2)
         RETURNING id;`,
        [collegeId, organizerUserId]
      );
      organizerId = orgRes.rows[0].id;

      await client.query(
        `INSERT INTO organizer_members (organizer_id, user_id, role, status)
         VALUES ($1, $2, 'owner', 'active');`,
        [organizerId, organizerUserId]
      );

      // 4. Create Active Published Event A (Starts tomorrow, ends in 2 days)
      const eResA = await client.query(
        `INSERT INTO events (
           organizer_id, college_id, title, slug, description, category, format,
           starts_at, ends_at, capacity, visibility, status, contact_email, created_by
         ) VALUES (
           $1, $2, 'P15 Active Event A', $3, 'P15 Active Event Description', 'Tech', 'in_person',
           NOW() + INTERVAL '1 day', NOW() + INTERVAL '2 days', 200, 'public', 'published', 'p15a@campus.edu', $4
         ) RETURNING id;`,
        [organizerId, collegeId, `p15-active-event-a-${Date.now()}`, organizerUserId]
      );
      eventAId = eResA.rows[0].id;
      createdEventIds.push(eventAId);

      // 5. Create Published Event B (for cross-event testing)
      const eResB = await client.query(
        `INSERT INTO events (
           organizer_id, college_id, title, slug, description, category, format,
           starts_at, ends_at, capacity, visibility, status, contact_email, created_by
         ) VALUES (
           $1, $2, 'P15 Other Event B', $3, 'P15 Other Event Description', 'Arts', 'in_person',
           NOW() + INTERVAL '1 day', NOW() + INTERVAL '2 days', 200, 'public', 'published', 'p15b@campus.edu', $4
         ) RETURNING id;`,
        [organizerId, collegeId, `p15-other-event-b-${Date.now()}`, organizerUserId]
      );
      eventBId = eResB.rows[0].id;
      createdEventIds.push(eventBId);

      // 6. Ticket Types for Events A and B
      const ttResA = await client.query(
        `INSERT INTO ticket_types (event_id, name, price_paise, capacity)
         VALUES ($1, 'General Admission', 0, 100) RETURNING id;`,
        [eventAId]
      );
      ticketTypeAId = ttResA.rows[0].id;

      const ttResB = await client.query(
        `INSERT INTO ticket_types (event_id, name, price_paise, capacity)
         VALUES ($1, 'General Admission', 0, 100) RETURNING id;`,
        [eventBId]
      );
      ticketTypeBId = ttResB.rows[0].id;

      // 7. Bookings
      const bResA = await client.query(
        `INSERT INTO bookings (user_id, event_id, status, total_paise, idempotency_key)
         VALUES ($1, $2, 'CONFIRMED', 0, $3) RETURNING id;`,
        [organizerUserId, eventAId, `idem_p15_bkg_a_${Date.now()}`]
      );
      bookingAId = bResA.rows[0].id;

      const bResB = await client.query(
        `INSERT INTO bookings (user_id, event_id, status, total_paise, idempotency_key)
         VALUES ($1, $2, 'CONFIRMED', 0, $3) RETURNING id;`,
        [organizerUserId, eventBId, `idem_p15_bkg_b_${Date.now()}`]
      );
      bookingBId = bResB.rows[0].id;

      // 8. Assign regular staff to event A check-in
      await client.query(
        `INSERT INTO event_staff_assignments (event_id, user_id, capability, granted_by)
         VALUES ($1, $2, 'checkin', $3);`,
        [eventAId, regularStaffUserId, organizerUserId]
      );
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  async function createAttendeeTicket(eventId: string, ticketTypeId: string, bookingId: string) {
    const client = await pool.connect();
    try {
      const email = `att.${Date.now()}.${Math.random().toString(36).substring(2, 7)}@campus.edu`;
      const uRes = await client.query(
        `INSERT INTO users (college_id, email, password_hash, display_name, global_role, status)
         VALUES ($1, $2, 'hash', 'Attendee Student', 'student', 'active')
         RETURNING id;`,
        [collegeId, email]
      );
      const attendeeId = uRes.rows[0].id;
      createdUserIds.push(attendeeId);

      const ticket = await createTicketWithRetry(client, {
        bookingId,
        ticketTypeId,
        userId: attendeeId,
        eventId,
      });

      return { ticket, attendeeId };
    } finally {
      client.release();
    }
  }

  // 1. Concurrency Test: Parallel Scans of One Ticket
  describe('1. Concurrency Verification: Parallel Scans of One Ticket', () => {
    it('parallel scans of one ticket -> exactly one ACCEPTED and remainder DUPLICATE', async () => {
      const { ticket } = await createAttendeeTicket(eventAId, ticketTypeAId, bookingAId);

      // Launch 20 concurrent scanTicket calls simultaneously
      const scanPromises = Array.from({ length: 20 }, (_, idx) =>
        scanTicket({
          tokenOrUrl: ticket.rawToken,
          eventId: eventAId,
          staffId: regularStaffUserId,
          deviceId: `turnstile-gate-${idx % 3}`,
        })
      );

      const results = await Promise.all(scanPromises);

      const accepted = results.filter((r) => r.outcome === 'ACCEPTED');
      const duplicates = results.filter((r) => r.outcome === 'DUPLICATE');

      expect(accepted.length).toBe(1);
      expect(duplicates.length).toBe(19);

      // Verify the accepted scan message has initials
      expect(accepted[0].message).toContain('Accepted');
      expect(accepted[0].ticketId).toBe(ticket.id);

      // Verify DB records
      const client = await pool.connect();
      try {
        const chkRes = await client.query(
          `SELECT count(*)::int as count FROM checkins WHERE ticket_id = $1;`,
          [ticket.id]
        );
        expect(chkRes.rows[0].count).toBe(1);

        const tRes = await client.query(
          `SELECT status, checked_in_by, version FROM tickets WHERE id = $1;`,
          [ticket.id]
        );
        expect(tRes.rows[0].status).toBe('CHECKED_IN');
        expect(tRes.rows[0].checked_in_by).toBe(regularStaffUserId);
        expect(tRes.rows[0].version).toBe(2);
      } finally {
        client.release();
      }
    });
  });

  // 2. Aborted-Transaction Bug Regression Test (Savepoint Isolation)
  describe('2. Regression Test: Achievement/Certificate Error Does NOT Abort Check-In', () => {
    it('commits ACCEPTED check-in even when student achievement insert encounters a foreign-key or constraint issue', async () => {
      const { ticket, attendeeId } = await createAttendeeTicket(eventAId, ticketTypeAId, bookingAId);

      // Pre-seed a conflicting achievement with the same (type, source_ref_id)
      // but verify that SAVEPOINT isolates the failure cleanly without aborting tx
      const client = await pool.connect();
      try {
        await client.query(
          `INSERT INTO student_achievements (user_id, type, source_event_id, source_ref_id, verification_status, visibility)
           VALUES ($1, 'ATTENDANCE', $2, $3, 'VERIFIED', 'public')
           ON CONFLICT (type, source_ref_id) DO NOTHING;`,
          [attendeeId, eventAId, ticket.id]
        );
      } finally {
        client.release();
      }

      // Perform check-in scan
      const scanRes = await scanTicket({
        tokenOrUrl: ticket.rawToken,
        eventId: eventAId,
        staffId: regularStaffUserId,
      });

      expect(scanRes.outcome).toBe('ACCEPTED');
      expect(scanRes.ticketId).toBe(ticket.id);

      // Check DB: ticket MUST be CHECKED_IN (proves transaction was NOT aborted)
      const client2 = await pool.connect();
      try {
        const tRes = await client2.query(
          `SELECT status FROM tickets WHERE id = $1;`,
          [ticket.id]
        );
        expect(tRes.rows[0].status).toBe('CHECKED_IN');
      } finally {
        client2.release();
      }
    });
  });

  // 3. Event Status & Window Guard
  describe('3. Event Status & Window Guards', () => {
    it('rejects ticket check-in when event is not published (draft / postponed / cancelled)', async () => {
      const client = await pool.connect();
      let draftEventId: string;
      let draftTicketTypeId: string;
      let draftBookingId: string;

      try {
        const eRes = await client.query(
          `INSERT INTO events (
             organizer_id, college_id, title, slug, description, category, format,
             starts_at, ends_at, capacity, visibility, status, contact_email, created_by
           ) VALUES (
             $1, $2, 'Draft Event P15', $3, 'Desc', 'Tech', 'in_person',
             NOW() + INTERVAL '1 day', NOW() + INTERVAL '2 days', 50, 'public', 'draft', 'draft@p15.org', $4
           ) RETURNING id;`,
          [organizerId, collegeId, `p15-draft-${Date.now()}`, organizerUserId]
        );
        draftEventId = eRes.rows[0].id;
        createdEventIds.push(draftEventId);

        const ttRes = await client.query(
          `INSERT INTO ticket_types (event_id, name, price_paise, capacity)
           VALUES ($1, 'General', 0, 50) RETURNING id;`,
          [draftEventId]
        );
        draftTicketTypeId = ttRes.rows[0].id;

        const bRes = await client.query(
          `INSERT INTO bookings (user_id, event_id, status, total_paise, idempotency_key)
           VALUES ($1, $2, 'CONFIRMED', 0, $3) RETURNING id;`,
          [organizerUserId, draftEventId, `idem_draft_${Date.now()}`]
        );
        draftBookingId = bRes.rows[0].id;
      } finally {
        client.release();
      }

      const { ticket } = await createAttendeeTicket(draftEventId, draftTicketTypeId, draftBookingId);

      const scanRes = await scanTicket({
        tokenOrUrl: ticket.rawToken,
        eventId: draftEventId,
        staffId: regularStaffUserId,
      });

      expect(scanRes.outcome).toBe('EVENT_NOT_PUBLISHED');
      expect(scanRes.message).toContain('Check-in blocked');
    });

    it('rejects ticket check-in when event check-in window is closed because event has already ended', async () => {
      const client = await pool.connect();
      let pastEventId: string;
      let pastTicketTypeId: string;
      let pastBookingId: string;

      try {
        const eRes = await client.query(
          `INSERT INTO events (
             organizer_id, college_id, title, slug, description, category, format,
             starts_at, ends_at, capacity, visibility, status, contact_email, created_by
           ) VALUES (
             $1, $2, 'Past Concluded Event P15', $3, 'Desc', 'Tech', 'in_person',
             NOW() - INTERVAL '3 days', NOW() - INTERVAL '1 day', 50, 'public', 'published', 'past@p15.org', $4
           ) RETURNING id;`,
          [organizerId, collegeId, `p15-past-${Date.now()}`, organizerUserId]
        );
        pastEventId = eRes.rows[0].id;
        createdEventIds.push(pastEventId);

        const ttRes = await client.query(
          `INSERT INTO ticket_types (event_id, name, price_paise, capacity)
           VALUES ($1, 'General', 0, 50) RETURNING id;`,
          [pastEventId]
        );
        pastTicketTypeId = ttRes.rows[0].id;

        const bRes = await client.query(
          `INSERT INTO bookings (user_id, event_id, status, total_paise, idempotency_key)
           VALUES ($1, $2, 'CONFIRMED', 0, $3) RETURNING id;`,
          [organizerUserId, pastEventId, `idem_past_${Date.now()}`]
        );
        pastBookingId = bRes.rows[0].id;
      } finally {
        client.release();
      }

      const { ticket } = await createAttendeeTicket(pastEventId, pastTicketTypeId, pastBookingId);

      const scanRes = await scanTicket({
        tokenOrUrl: ticket.rawToken,
        eventId: pastEventId,
        staffId: regularStaffUserId,
      });

      expect(scanRes.outcome).toBe('OUTSIDE_WINDOW');
      expect(scanRes.message).toContain('Event has ended');
    });
  });

  // 4. Session ID & Session Check-in Window
  describe('4. Attendance Session Window & Unknown Session Validation', () => {
    it('rejects scan with unknown sessionId and returns INVALID with descriptive error', async () => {
      const { ticket } = await createAttendeeTicket(eventAId, ticketTypeAId, bookingAId);

      const fakeSessionId = '00000000-0000-0000-0000-000000009999';

      const scanRes = await scanTicket({
        tokenOrUrl: ticket.rawToken,
        eventId: eventAId,
        staffId: regularStaffUserId,
        sessionId: fakeSessionId,
      });

      expect(scanRes.outcome).toBe('INVALID');
      expect(scanRes.message).toContain('Unknown or invalid session ID for this event');
    });

    it('rejects scan outside session check-in window with OUTSIDE_WINDOW', async () => {
      const client = await pool.connect();
      let closedSessionId: string;

      try {
        const sRes = await client.query(
          `INSERT INTO attendance_sessions (
             event_id, name, starts_at, ends_at, checkin_opens_at, checkin_closes_at
           ) VALUES (
             $1, 'Closed Session', NOW() + INTERVAL '1 day', NOW() + INTERVAL '2 days',
             NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour'
           ) RETURNING id;`,
          [eventAId]
        );
        closedSessionId = sRes.rows[0].id;
      } finally {
        client.release();
      }

      const { ticket } = await createAttendeeTicket(eventAId, ticketTypeAId, bookingAId);

      const scanRes = await scanTicket({
        tokenOrUrl: ticket.rawToken,
        eventId: eventAId,
        staffId: regularStaffUserId,
        sessionId: closedSessionId,
      });

      expect(scanRes.outcome).toBe('OUTSIDE_WINDOW');
      expect(scanRes.message).toContain('closed for this session');
    });

    it('accepts scan within active session check-in window and records session_id in checkins', async () => {
      const client = await pool.connect();
      let activeSessionId: string;

      try {
        const sRes = await client.query(
          `INSERT INTO attendance_sessions (
             event_id, name, starts_at, ends_at, checkin_opens_at, checkin_closes_at
           ) VALUES (
             $1, 'Active Session Gate', NOW() + INTERVAL '1 day', NOW() + INTERVAL '2 days',
             NOW() - INTERVAL '30 minutes', NOW() + INTERVAL '2 hours'
           ) RETURNING id;`,
          [eventAId]
        );
        activeSessionId = sRes.rows[0].id;
      } finally {
        client.release();
      }

      const { ticket } = await createAttendeeTicket(eventAId, ticketTypeAId, bookingAId);

      const scanRes = await scanTicket({
        tokenOrUrl: ticket.rawToken,
        eventId: eventAId,
        staffId: regularStaffUserId,
        sessionId: activeSessionId,
      });

      expect(scanRes.outcome).toBe('ACCEPTED');

      const client2 = await pool.connect();
      try {
        const chkRes = await client2.query(
          `SELECT session_id FROM checkins WHERE ticket_id = $1;`,
          [ticket.id]
        );
        expect(chkRes.rows[0].session_id).toBe(activeSessionId);
      } finally {
        client2.release();
      }
    });
  });

  // 5. Cross-Event Ticket ID Masking (Security ASVS L2)
  describe('5. Cross-Event Ticket ID Masking: Only Admins See Other-Event Ticket IDs', () => {
    it('omits ticketId when regular check-in staff scans a ticket belonging to another event', async () => {
      // Create ticket for Event B
      const { ticket } = await createAttendeeTicket(eventBId, ticketTypeBId, bookingBId);

      // Regular staff at Event A gate scans Event B ticket
      const scanRes = await scanTicket({
        tokenOrUrl: ticket.rawToken,
        eventId: eventAId,
        staffId: regularStaffUserId,
      });

      expect(scanRes.outcome).toBe('WRONG_EVENT');
      expect(scanRes.message).toContain('Wrong Event');
      // Invariant: ticketId MUST NOT leak to regular staff
      expect(scanRes.ticketId).toBeUndefined();
    });

    it('includes ticketId when an admin scans a ticket belonging to another event', async () => {
      // Create ticket for Event B
      const { ticket } = await createAttendeeTicket(eventBId, ticketTypeBId, bookingBId);

      // Admin at Event A gate scans Event B ticket
      const scanRes = await scanTicket({
        tokenOrUrl: ticket.rawToken,
        eventId: eventAId,
        staffId: adminUserId,
      });

      expect(scanRes.outcome).toBe('WRONG_EVENT');
      expect(scanRes.message).toContain('Wrong Event');
      // Invariant: admin CAN see ticketId for forensics
      expect(scanRes.ticketId).toBe(ticket.id);
    });
  });

  // 6. Audio Synthesizer Unit Tests
  describe('6. Audio Feedback Engine', () => {
    beforeAll(() => {
      if (typeof globalThis.localStorage === 'undefined') {
        const store: Record<string, string> = {};
        globalThis.localStorage = {
          getItem: (key: string) => store[key] ?? null,
          setItem: (key: string, val: string) => {
            store[key] = String(val);
          },
          removeItem: (key: string) => {
            delete store[key];
          },
          clear: () => {
            for (const k of Object.keys(store)) delete store[k];
          },
          length: 0,
          key: (_idx: number) => null,
        } as Storage;
      }
    });

    it('supports toggling mute and persists to localStorage', () => {
      soundEffects.setMuted(true);
      expect(soundEffects.getMuted()).toBe(true);
      expect(localStorage.getItem('eventora_scanner_muted')).toBe('true');

      soundEffects.setMuted(false);
      expect(soundEffects.getMuted()).toBe(false);
      expect(localStorage.getItem('eventora_scanner_muted')).toBe('false');
    });

    it('synthesizes sounds safely without throwing', () => {
      expect(() => soundEffects.playSuccess()).not.toThrow();
      expect(() => soundEffects.playWarning()).not.toThrow();
      expect(() => soundEffects.playError()).not.toThrow();
    });
  });
});
