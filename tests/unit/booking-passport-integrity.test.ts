import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../packages/backend/src/app.js';
import { db, pool } from '../../packages/backend/src/db/index.js';
import { events, ticketTypes, bookings, bookingItems, tickets, outbox } from '../../packages/backend/src/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { FastifyInstance } from 'fastify';

interface AuthSession {
  headers: {
    cookie: string;
    'x-csrf-token': string;
  };
  user: any;
}

describe('Phase 5 Booking & Passport Integrity Verification Suite', () => {
  let app: FastifyInstance;
  let student1: AuthSession;
  let student2: AuthSession;
  let reviewer: AuthSession;
  let admin: AuthSession;
  let testVenueId: string;
  let createdTicketId: string;
  let issuedTicketCode: string;

  async function loginAs(email: string): Promise<AuthSession> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: 'Eventora#Test2026!' },
    });
    expect(res.statusCode).toBe(200);
    const sessionCookie = res.cookies.find((c: any) => c.name === 'eventora_session')?.value;
    const csrfCookie = res.cookies.find((c: any) => c.name === 'eventora_csrf')?.value;
    return {
      headers: {
        cookie: `eventora_session=${sessionCookie}; eventora_csrf=${csrfCookie}`,
        'x-csrf-token': csrfCookie || '',
      },
      user: JSON.parse(res.body).user,
    };
  }

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    student1 = await loginAs('student1@campus.edu');
    student2 = await loginAs('student2@campus.edu');
    reviewer = await loginAs('reviewer.faculty@campus.edu');
    admin = await loginAs('admin.system@campus.edu');

    const venueRes = await app.inject({ method: 'GET', url: '/api/v1/venues' });
    expect(venueRes.statusCode).toBe(200);
    testVenueId = JSON.parse(venueRes.body).venues[0].id;
  });

  afterAll(async () => {
    await app.close();
  });

  // =========================================================================
  // 1. VALID REGISTRATION & PERSISTED TICKET ISSUANCE
  // =========================================================================
  describe('1. Valid Registration & Persisted Ticket Issuance', () => {
    let testEventId: string;
    let freeTierId: string;
    let createdBookingId: string;

    beforeAll(async () => {
      // Create and publish event
      const randomDayOffset = 1000 + Math.floor(Math.random() * 200);
      const startsAt = new Date(Date.now() + 86400000 * randomDayOffset).toISOString();
      const endsAt = new Date(Date.now() + 86400000 * randomDayOffset + 7200000).toISOString();

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/events',
        headers: admin.headers,
        payload: {
          title: `Autonomous Rover Challenge ${Date.now()}`,
          description: 'A 48-hour student engineering competition designing autonomous lunar rovers.',
          category: 'Robotics',
          department: 'Computer Science',
          format: 'in_person',
          contactEmail: 'admin.system@campus.edu',
          venueId: testVenueId,
          startsAt,
          endsAt,
          capacity: 100,
        },
      });
      testEventId = JSON.parse(createRes.body).event.id;

      // Submit and approve
      await app.inject({
        method: 'POST',
        url: `/api/v1/events/${testEventId}/submit`,
        headers: admin.headers,
        payload: {},
      });
      await app.inject({
        method: 'POST',
        url: `/api/v1/events/${testEventId}/approval`,
        headers: reviewer.headers,
        payload: { decision: 'approved', comments: 'Approved' },
      });
      await app.inject({
        method: 'POST',
        url: `/api/v1/events/${testEventId}/publish`,
        headers: admin.headers,
        payload: {},
      });

      // Insert free ticket type
      const ttRes = await pool.query(
        `INSERT INTO ticket_types (event_id, name, price_paise, capacity, sold, held)
         VALUES ($1, 'Student General Pass', 0, 50, 0, 0)
         RETURNING id;`,
        [testEventId]
      );
      freeTierId = ttRes.rows[0].id;
    });

    it('1.1. Dispatches valid booking request and creates atomic booking & ticket transaction', async () => {
      const idempotencyKey = `book-valid-${Date.now()}`;
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${testEventId}/bookings`,
        headers: {
          ...student1.headers,
          'Idempotency-Key': idempotencyKey,
        },
        payload: {
          items: [{ ticketTypeId: freeTierId, quantity: 1 }],
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);

      // Verify response envelope
      expect(body.booking).toBeDefined();
      expect(body.booking.status).toBe('CONFIRMED');
      expect(body.booking.total_paise).toBe(0);
      expect(body.booking.user_id).toBe(student1.user.id);
      expect(body.booking.event_id).toBe(testEventId);

      expect(body.items).toBeDefined();
      expect(body.items.length).toBe(1);
      expect(body.items[0].ticket_type_id).toBe(freeTierId);

      expect(body.tickets).toBeDefined();
      expect(body.tickets.length).toBe(1);
      expect(body.tickets[0].id).toBeDefined();
      expect(body.tickets[0].ticket_code).toBeDefined();
      expect(body.tickets[0].status).toBe('VALID');

      createdBookingId = body.booking.id;
      createdTicketId = body.tickets[0].id;
      issuedTicketCode = body.tickets[0].ticket_code;

      // Verify PostgreSQL database persistence directly
      const dbBooking = await pool.query('SELECT * FROM bookings WHERE id = $1;', [createdBookingId]);
      expect(dbBooking.rows.length).toBe(1);
      expect(dbBooking.rows[0].status).toBe('CONFIRMED');

      const dbTicket = await pool.query('SELECT * FROM tickets WHERE id = $1;', [createdTicketId]);
      expect(dbTicket.rows.length).toBe(1);
      expect(dbTicket.rows[0].ticket_code).toBe(issuedTicketCode);
      expect(dbTicket.rows[0].user_id).toBe(student1.user.id);
      expect(dbTicket.rows[0].status).toBe('VALID');
      expect(dbTicket.rows[0].qr_payload_hash).toBeDefined();

      // Verify outbox atomic record
      const dbOutbox = await pool.query(
        "SELECT * FROM outbox WHERE dedupe_key = $1;",
        [`booking-confirmed-${createdBookingId}`]
      );
      expect(dbOutbox.rows.length).toBe(1);

      // Verify ticket_types inventory increment
      const dbTier = await pool.query('SELECT sold FROM ticket_types WHERE id = $1;', [freeTierId]);
      expect(dbTier.rows[0].sold).toBe(1);
    });

    it('1.2. Proves GET /api/v1/me/tickets returns the persisted ticket for Passport UI', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/me/tickets',
        headers: student1.headers,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.tickets).toBeDefined();
      expect(Array.isArray(body.tickets)).toBe(true);

      const foundTicket = body.tickets.find((t: any) => t.id === createdTicketId);
      expect(foundTicket).toBeDefined();
      expect(foundTicket.ticket_code).toBe(issuedTicketCode);
      expect(foundTicket.event_id).toBe(testEventId);
      expect(foundTicket.event_title).toContain('Autonomous Rover Challenge');
      expect(foundTicket.status).toBe('VALID');
      expect(foundTicket.tier_name).toBe('Student General Pass');
    });

    it('1.3. Proves GET /api/v1/me/bookings returns the booking correlated with ticket code', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/me/bookings',
        headers: student1.headers,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.bookings).toBeDefined();

      const foundBooking = body.bookings.find((b: any) => b.id === createdBookingId);
      expect(foundBooking).toBeDefined();
      expect(foundBooking.ticket_code).toBe(issuedTicketCode);
      expect(foundBooking.ticket_status).toBe('VALID');
      expect(foundBooking.ticket_count).toBe(1);
    });

    it('1.4. Proves GET /api/v1/tickets/:id returns single ticket for the ticket owner', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/tickets/${createdTicketId}`,
        headers: student1.headers,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.ticket).toBeDefined();
      expect(body.ticket.id).toBe(createdTicketId);
      expect(body.ticket.ticket_code).toBe(issuedTicketCode);
      expect(body.ticket.status).toBe('VALID');
    });
  });

  // =========================================================================
  // 2. INVALID REGISTRATION VALIDATION & INTEGRITY
  // =========================================================================
  describe('2. Invalid Registration Validation', () => {
    let publishedEventId: string;
    let draftEventId: string;

    beforeAll(async () => {
      const randomOffset = 1300 + Math.floor(Math.random() * 100);
      const startsAt = new Date(Date.now() + 86400000 * randomOffset).toISOString();
      const endsAt = new Date(Date.now() + 86400000 * randomOffset + 7200000).toISOString();

      // Published event
      const pubRes = await app.inject({
        method: 'POST',
        url: '/api/v1/events',
        headers: admin.headers,
        payload: {
          title: `Validation Test Event ${Date.now()}`,
          description: 'Testing validation failures for booking endpoints.',
          category: 'Technology',
          department: 'Computer Science',
          format: 'in_person',
          contactEmail: 'admin.system@campus.edu',
          venueId: testVenueId,
          startsAt,
          endsAt,
          capacity: 50,
        },
      });
      publishedEventId = JSON.parse(pubRes.body).event.id;

      await app.inject({
        method: 'POST',
        url: `/api/v1/events/${publishedEventId}/submit`,
        headers: admin.headers,
        payload: {},
      });
      await app.inject({
        method: 'POST',
        url: `/api/v1/events/${publishedEventId}/approval`,
        headers: reviewer.headers,
        payload: { decision: 'approved', comments: 'Approved' },
      });
      await app.inject({
        method: 'POST',
        url: `/api/v1/events/${publishedEventId}/publish`,
        headers: admin.headers,
        payload: {},
      });

      // Draft event (never published)
      const draftRes = await app.inject({
        method: 'POST',
        url: '/api/v1/events',
        headers: admin.headers,
        payload: {
          title: `Unpublished Draft Event ${Date.now()}`,
          description: 'This event remains in draft and should reject registrations.',
          category: 'Technology',
          department: 'Computer Science',
          format: 'in_person',
          contactEmail: 'admin.system@campus.edu',
          venueId: testVenueId,
          startsAt,
          endsAt,
          capacity: 50,
        },
      });
      draftEventId = JSON.parse(draftRes.body).event.id;
    });

    it('2.1. Rejects non-UUID ticket tier ID with 400 VALIDATION_ERROR', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${publishedEventId}/bookings`,
        headers: {
          ...student1.headers,
          'Idempotency-Key': `inv-${Date.now()}`,
        },
        payload: {
          items: [{ ticketTypeId: 'regular-tier', quantity: 1 }],
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('2.2. Rejects zero or negative quantity with 400 VALIDATION_ERROR', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${publishedEventId}/bookings`,
        headers: {
          ...student1.headers,
          'Idempotency-Key': `inv-qty-${Date.now()}`,
        },
        payload: {
          items: [{ ticketTypeId: '44d2a71e-f6af-4764-8793-b116f9439a30', quantity: 0 }],
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('2.3. Rejects empty ticket items array with 400 VALIDATION_ERROR', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${publishedEventId}/bookings`,
        headers: {
          ...student1.headers,
          'Idempotency-Key': `inv-empty-${Date.now()}`,
        },
        payload: {
          items: [],
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('2.4. Rejects booking on unpublished draft event with 400 EVENT_NOT_PUBLISHED', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${draftEventId}/bookings`,
        headers: {
          ...student1.headers,
          'Idempotency-Key': `inv-draft-${Date.now()}`,
        },
        payload: {
          items: [{ ticketTypeId: '44d2a71e-f6af-4764-8793-b116f9439a30', quantity: 1 }],
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('EVENT_NOT_PUBLISHED');
      expect(body.error.message).toContain('Registrations are only open for published events');
    });

    it('2.5. Confirms zero phantom bookings or tickets were created from failed requests', async () => {
      const checkRes = await pool.query(
        'SELECT COUNT(*)::int as count FROM bookings WHERE event_id = $1;',
        [draftEventId]
      );
      expect(checkRes.rows[0].count).toBe(0);
    });
  });

  // =========================================================================
  // 3. DUPLICATE SUBMISSION & IDEMPOTENCY REPLAY SAFETY
  // =========================================================================
  describe('3. Duplicate Submission & Idempotency Replay Safety', () => {
    let testEventId: string;
    let freeTierId: string;
    let originalBookingId: string;

    beforeAll(async () => {
      const randomOffset = 1500 + Math.floor(Math.random() * 100);
      const startsAt = new Date(Date.now() + 86400000 * randomOffset).toISOString();
      const endsAt = new Date(Date.now() + 86400000 * randomOffset + 7200000).toISOString();

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/events',
        headers: admin.headers,
        payload: {
          title: `Idempotency Test Event ${Date.now()}`,
          description: 'Testing idempotent replay safety.',
          category: 'Technology',
          department: 'Computer Science',
          format: 'in_person',
          contactEmail: 'admin.system@campus.edu',
          venueId: testVenueId,
          startsAt,
          endsAt,
          capacity: 50,
        },
      });
      testEventId = JSON.parse(createRes.body).event.id;

      await app.inject({ method: 'POST', url: `/api/v1/events/${testEventId}/submit`, headers: admin.headers, payload: {} });
      await app.inject({ method: 'POST', url: `/api/v1/events/${testEventId}/approval`, headers: reviewer.headers, payload: { decision: 'approved', comments: 'Approved' } });
      await app.inject({ method: 'POST', url: `/api/v1/events/${testEventId}/publish`, headers: admin.headers, payload: {} });

      const ttRes = await pool.query(
        `INSERT INTO ticket_types (event_id, name, price_paise, capacity, sold, held)
         VALUES ($1, 'Pass', 0, 10, 0, 0)
         RETURNING id;`,
        [testEventId]
      );
      freeTierId = ttRes.rows[0].id;
    });

    it('3.1. Submitting identical request with same Idempotency-Key returns existing booking without duplicating rows', async () => {
      const idempotencyKey = `idem-book-${Date.now()}`;
      const payload = { items: [{ ticketTypeId: freeTierId, quantity: 1 }] };

      // Initial request
      const res1 = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${testEventId}/bookings`,
        headers: {
          ...student2.headers,
          'Idempotency-Key': idempotencyKey,
        },
        payload,
      });
      expect(res1.statusCode).toBe(201);
      const body1 = JSON.parse(res1.body);
      originalBookingId = body1.booking.id;

      // Duplicate replay
      const res2 = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${testEventId}/bookings`,
        headers: {
          ...student2.headers,
          'Idempotency-Key': idempotencyKey,
        },
        payload,
      });

      // Should return 200 or 201 with identical booking details
      expect([200, 201]).toContain(res2.statusCode);
      const body2 = JSON.parse(res2.body);
      expect(body2.booking.id).toBe(originalBookingId);
      expect(body2.idempotentReplay).toBe(true);

      // Verify DB contains exactly 1 booking and 1 ticket
      const bookingsCount = await pool.query(
        'SELECT COUNT(*)::int as count FROM bookings WHERE user_id = $1 AND event_id = $2;',
        [student2.user.id, testEventId]
      );
      expect(bookingsCount.rows[0].count).toBe(1);

      const tierCount = await pool.query('SELECT sold FROM ticket_types WHERE id = $1;', [freeTierId]);
      expect(tierCount.rows[0].sold).toBe(1);
    });

    it('3.2. Submitting duplicate registration for same event with NEW key rejects with 409 ALREADY_REGISTERED', async () => {
      const newKey = `new-key-${Date.now()}`;
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${testEventId}/bookings`,
        headers: {
          ...student2.headers,
          'Idempotency-Key': newKey,
        },
        payload: { items: [{ ticketTypeId: freeTierId, quantity: 1 }] },
      });

      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('ALREADY_REGISTERED');
      expect(body.error.message).toContain('already have an active registration');
    });
  });

  // =========================================================================
  // 4. CAPACITY BOUNDARY ENFORCEMENT
  // =========================================================================
  describe('4. Capacity Boundary Enforcement', () => {
    let testEventId: string;
    let limitedTierId: string;

    beforeAll(async () => {
      const randomOffset = 1700 + Math.floor(Math.random() * 100);
      const startsAt = new Date(Date.now() + 86400000 * randomOffset).toISOString();
      const endsAt = new Date(Date.now() + 86400000 * randomOffset + 7200000).toISOString();

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/events',
        headers: admin.headers,
        payload: {
          title: `Capacity Bound Event ${Date.now()}`,
          description: 'Testing strict capacity limits.',
          category: 'Symposium',
          department: 'Computer Science',
          format: 'in_person',
          contactEmail: 'admin.system@campus.edu',
          venueId: testVenueId,
          startsAt,
          endsAt,
          capacity: 1, // Only 1 seat total
        },
      });
      testEventId = JSON.parse(createRes.body).event.id;

      await app.inject({ method: 'POST', url: `/api/v1/events/${testEventId}/submit`, headers: admin.headers, payload: {} });
      await app.inject({ method: 'POST', url: `/api/v1/events/${testEventId}/approval`, headers: reviewer.headers, payload: { decision: 'approved', comments: 'Approved' } });
      await app.inject({ method: 'POST', url: `/api/v1/events/${testEventId}/publish`, headers: admin.headers, payload: {} });

      const ttRes = await pool.query(
        `INSERT INTO ticket_types (event_id, name, price_paise, capacity, sold, held)
         VALUES ($1, 'Exclusive Seat', 0, 1, 0, 0)
         RETURNING id;`,
        [testEventId]
      );
      limitedTierId = ttRes.rows[0].id;
    });

    it('4.1. First booking succeeds and fills capacity to 100%', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${testEventId}/bookings`,
        headers: {
          ...student1.headers,
          'Idempotency-Key': `seat-1-${Date.now()}`,
        },
        payload: { items: [{ ticketTypeId: limitedTierId, quantity: 1 }] },
      });

      expect(res.statusCode).toBe(201);
      const dbTier = await pool.query('SELECT sold, capacity FROM ticket_types WHERE id = $1;', [limitedTierId]);
      expect(dbTier.rows[0].sold).toBe(1);
      expect(dbTier.rows[0].capacity).toBe(1);
    });

    it('4.2. Subsequent booking exceeding capacity rejects with 409 SOLD_OUT', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${testEventId}/bookings`,
        headers: {
          ...student2.headers,
          'Idempotency-Key': `seat-2-${Date.now()}`,
        },
        payload: { items: [{ ticketTypeId: limitedTierId, quantity: 1 }] },
      });

      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('SOLD_OUT');

      // Verify DB capacity was never breached
      const dbTier = await pool.query('SELECT sold, capacity FROM ticket_types WHERE id = $1;', [limitedTierId]);
      expect(dbTier.rows[0].sold).toBe(1);
    });
  });

  // =========================================================================
  // 5. ATOMIC TRANSACTION ROLLBACK SAFETY
  // =========================================================================
  describe('5. Atomic Transaction Rollback Safety', () => {
    it('5.1. Failed transaction rolls back completely without leaving orphan rows', async () => {
      const fakeEventId = '00000000-0000-0000-0000-000000000000';
      const fakeTierId = '11111111-1111-1111-1111-111111111111';

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${fakeEventId}/bookings`,
        headers: {
          ...student1.headers,
          'Idempotency-Key': `rollback-test-${Date.now()}`,
        },
        payload: { items: [{ ticketTypeId: fakeTierId, quantity: 1 }] },
      });

      expect([400, 403, 404]).toContain(res.statusCode);

      // Verify no bookings or tickets exist for fakeEventId
      const checkBookings = await pool.query('SELECT COUNT(*)::int as count FROM bookings WHERE event_id = $1;', [fakeEventId]);
      expect(checkBookings.rows[0].count).toBe(0);

      const checkTickets = await pool.query('SELECT COUNT(*)::int as count FROM tickets WHERE event_id = $1;', [fakeEventId]);
      expect(checkTickets.rows[0].count).toBe(0);
    });
  });

  // =========================================================================
  // 6. PASSPORT NAVIGATION & REFRESH CONSISTENCY
  // =========================================================================
  describe('6. Passport Navigation & Refresh Consistency', () => {
    it('6.1. Sequential queries simulating navigation and page refresh return identical ticket sets', async () => {
      // First fetch
      const res1 = await app.inject({
        method: 'GET',
        url: '/api/v1/me/tickets',
        headers: student1.headers,
      });
      expect(res1.statusCode).toBe(200);
      const tickets1 = JSON.parse(res1.body).tickets;

      // Second fetch (simulating page reload)
      const res2 = await app.inject({
        method: 'GET',
        url: '/api/v1/me/tickets',
        headers: student1.headers,
      });
      expect(res2.statusCode).toBe(200);
      const tickets2 = JSON.parse(res2.body).tickets;

      expect(tickets1.length).toBe(tickets2.length);
      expect(tickets1.map((t: any) => t.id)).toEqual(tickets2.map((t: any) => t.id));
    });
  });

  // =========================================================================
  // 7. FRESH LOGIN, SESSION PERSISTENCE & IDOR ISOLATION
  // =========================================================================
  describe('7. Fresh Login, Session Persistence & IDOR Isolation', () => {
    it('7.1. Unauthenticated request without cookies is rejected with 401 Unauthorized', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/me/tickets',
      });
      expect(res.statusCode).toBe(401);
    });

    it('7.2. Student 2 cannot see Student 1 tickets in /me/tickets (Tenant/User Isolation)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/me/tickets',
        headers: student2.headers,
      });
      expect(res.statusCode).toBe(200);
      const tickets = JSON.parse(res.body).tickets;
      const leakedTicket = tickets.find((t: any) => t.id === createdTicketId);
      expect(leakedTicket).toBeUndefined();
    });

    it('7.3. Student 2 cannot query Student 1 ticket via /tickets/:id (IDOR Object Guard)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/tickets/${createdTicketId}`,
        headers: student2.headers,
      });

      // Fastify objectCheck returns false -> 403 Forbidden
      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('7.4. Student 1 logging in from a fresh session retrieves the exact persisted tickets', async () => {
      // Re-login student 1
      const freshSession = await loginAs('student1@campus.edu');

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/me/tickets',
        headers: freshSession.headers,
      });

      expect(res.statusCode).toBe(200);
      const tickets = JSON.parse(res.body).tickets;
      const foundTicket = tickets.find((t: any) => t.id === createdTicketId);
      expect(foundTicket).toBeDefined();
      expect(foundTicket.id).toBe(createdTicketId);
      expect(foundTicket.status).toBe('VALID');
    });
  });
});
