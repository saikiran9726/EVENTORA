import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../packages/backend/src/app.js';
import { db, pool } from '../../packages/backend/src/db/index.js';
import { events, ticketTypes, bookings, tickets } from '../../packages/backend/src/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { FastifyInstance } from 'fastify';

interface AuthSession {
  headers: {
    cookie: string;
    'x-csrf-token': string;
  };
  user: any;
}

describe('Phase 4 Form & Event Workflow Repair Test Suite', () => {
  let app: FastifyInstance;
  let student: AuthSession;
  let organizer: AuthSession;
  let reviewer: AuthSession;
  let admin: AuthSession;
  let testVenueId: string;

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

    student = await loginAs('student1@campus.edu');
    organizer = await loginAs('organizer.ras@campus.edu');
    reviewer = await loginAs('reviewer.faculty@campus.edu');
    admin = await loginAs('admin.system@campus.edu');

    // Fetch valid seeded venue UUID
    const venueRes = await app.inject({ method: 'GET', url: '/api/v1/venues' });
    expect(venueRes.statusCode).toBe(200);
    const venueData = JSON.parse(venueRes.body);
    testVenueId = venueData.venues[0].id;
  });

  afterAll(async () => {
    await app.close();
  });

  // =========================================================================
  // 1. EVENT PROPOSAL FORM VALIDATION & DRAFT CREATION
  // =========================================================================
  describe('1. Event Proposal Form Validation & Creation', () => {
    it('1.1. Rejects incomplete proposal payload missing required fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/events',
        headers: organizer.headers,
        payload: {
          title: 'Hi', // Less than min 3 chars
          description: 'Short', // Less than min 10 chars
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('Invalid event payload');
    });

    it('1.2. Rejects proposal with non-UUID venueId', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/events',
        headers: organizer.headers,
        payload: {
          title: 'Autonomous Robotics Workshop',
          description: 'An advanced hands-on campus engineering workshop on ROS2.',
          category: 'Robotics',
          department: 'Computer Science',
          format: 'in_person',
          contactEmail: 'organizer@campus.edu',
          venueId: 'v-auditorium', // Invalid string non-UUID
          startsAt: new Date(Date.now() + 86400000 * 20).toISOString(),
          endsAt: new Date(Date.now() + 86400000 * 20 + 7200000).toISOString(),
          capacity: 100,
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('1.3. Successfully creates event draft when organizer submits valid payload', async () => {
      const randomDayOffset = 100 + Math.floor(Math.random() * 200);
      const startsAt = new Date(Date.now() + 86400000 * randomDayOffset).toISOString();
      const endsAt = new Date(Date.now() + 86400000 * randomDayOffset + 10800000).toISOString();

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/events',
        headers: organizer.headers,
        payload: {
          title: `Robotics Masterclass ${Date.now()}`,
          description: 'A comprehensive full-stack robotics symposium exploring edge computing and AI.',
          category: 'Robotics',
          department: 'Computer Science',
          format: 'in_person',
          contactEmail: 'organizer.ras@campus.edu',
          venueId: testVenueId,
          startsAt,
          endsAt,
          capacity: 120,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.event).toBeDefined();
      expect(body.event.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(body.event.status).toBe('draft');
    });

    it('1.4. Proves proposal submission is idempotent when retried with same Idempotency-Key', async () => {
      const idempotencyKey = `prop-test-${Date.now()}`;
      const randomDayOffset = 350 + Math.floor(Math.random() * 100);
      const startsAt = new Date(Date.now() + 86400000 * randomDayOffset).toISOString();
      const endsAt = new Date(Date.now() + 86400000 * randomDayOffset + 7200000).toISOString();

      const payload = {
        title: `Idempotent Proposal Test ${Date.now()}`,
        description: 'Testing that retrying an event proposal draft creation does not duplicate records.',
        category: 'Technology',
        department: 'Computer Science',
        format: 'in_person',
        contactEmail: 'organizer.ras@campus.edu',
        venueId: testVenueId,
        startsAt,
        endsAt,
        capacity: 80,
      };

      // First submission
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/events',
        headers: {
          ...organizer.headers,
          'Idempotency-Key': idempotencyKey,
        },
        payload,
      });
      expect(res1.statusCode).toBe(201);
      const event1 = JSON.parse(res1.body).event;

      // Immediate retry with identical payload and idempotency key
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/events',
        headers: {
          ...organizer.headers,
          'Idempotency-Key': idempotencyKey,
        },
        payload,
      });

      // Must return existing draft ID without creating a second event
      expect(res2.statusCode).toBe(200);
      const event2 = JSON.parse(res2.body).event;
      expect(event2.id).toBe(event1.id);
    });
  });

  // =========================================================================
  // 2. EVENT PROPOSAL SUBMISSION & VENUE CONFLICT CHECK
  // =========================================================================
  describe('2. Proposal Submission & Venue Booking Lifecycle', () => {
    let createdDraftId: string;
    let conflictStartsAt: string;
    let conflictEndsAt: string;

    beforeAll(async () => {
      const randomDayOffset = 600 + Math.floor(Math.random() * 150);
      conflictStartsAt = new Date(Date.now() + 86400000 * randomDayOffset).toISOString();
      conflictEndsAt = new Date(Date.now() + 86400000 * randomDayOffset + 14400000).toISOString();

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/events',
        headers: organizer.headers,
        payload: {
          title: `Symposium on Autonomous Systems ${Date.now()}`,
          description: 'A formal symposium on autonomous systems and aerial robotics.',
          category: 'Symposium',
          department: 'Computer Science',
          format: 'in_person',
          contactEmail: 'organizer.ras@campus.edu',
          venueId: testVenueId,
          startsAt: conflictStartsAt,
          endsAt: conflictEndsAt,
          capacity: 150,
        },
      });
      expect(createRes.statusCode).toBe(201);
      createdDraftId = JSON.parse(createRes.body).event.id;
    });

    it('2.1. Submits draft proposal for faculty review with empty JSON body without timeout', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${createdDraftId}/submit`,
        headers: organizer.headers,
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.event.status).toBe('pending_approval');
    });

    it('2.2. Detects GiST venue conflict when overlapping slot is reserved on same venue', async () => {
      // Overlapping slot by 1 hour
      const overlappingStarts = new Date(new Date(conflictStartsAt).getTime() + 3600000).toISOString();
      const overlappingEnds = new Date(new Date(conflictEndsAt).getTime() + 3600000).toISOString();

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/events',
        headers: admin.headers,
        payload: {
          title: `Conflicting Event Proposal ${Date.now()}`,
          description: 'This proposal should collide with the existing venue booking.',
          category: 'General',
          department: 'Mechanical',
          format: 'in_person',
          contactEmail: 'admin.system@campus.edu',
          venueId: testVenueId,
          startsAt: overlappingStarts,
          endsAt: overlappingEnds,
          capacity: 100,
        },
      });
      expect(createRes.statusCode).toBe(201);
      const secondEventId = JSON.parse(createRes.body).event.id;

      // Submitting the second overlapping proposal triggers venue reservation GiST check
      const submitRes = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${secondEventId}/submit`,
        headers: admin.headers,
        payload: {},
      });

      // PostgreSQL GiST exclusion range check throws 409 VENUE_CONFLICT
      expect(submitRes.statusCode).toBe(409);
      const body = JSON.parse(submitRes.body);
      expect(body.error.code).toBe('VENUE_CONFLICT');
      expect(body.error.message).toContain('already booked');
    });
  });

  // =========================================================================
  // 3. REGISTRATION FORM & TICKET ISSUANCE WORKFLOW
  // =========================================================================
  describe('3. Registration Form & Ticket Issuance', () => {
    let publishedEventId: string;
    let freeTierId: string;

    beforeAll(async () => {
      // Create and publish an event for booking
      const randomDayOffset = 800 + Math.floor(Math.random() * 100);
      const startsAt = new Date(Date.now() + 86400000 * randomDayOffset).toISOString();
      const endsAt = new Date(Date.now() + 86400000 * randomDayOffset + 7200000).toISOString();

      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/events',
        headers: admin.headers,
        payload: {
          title: `AI Campus Summit ${Date.now()}`,
          description: 'A campus wide conference celebrating AI student research projects.',
          category: 'AI & Data',
          department: 'Computer Science',
          format: 'in_person',
          contactEmail: 'admin.system@campus.edu',
          venueId: testVenueId,
          startsAt,
          endsAt,
          capacity: 100,
        },
      });
      publishedEventId = JSON.parse(createRes.body).event.id;

      // Submit and approve
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
        payload: { decision: 'approved', comments: 'Approved for campus publishing' },
      });

      // Publish event
      await app.inject({
        method: 'POST',
        url: `/api/v1/events/${publishedEventId}/publish`,
        headers: admin.headers,
        payload: {},
      });

      // Create free ticket tier
      const ttRes = await pool.query(`
        INSERT INTO ticket_types (event_id, name, price_paise, capacity, sold, held)
        VALUES ($1, 'General Student Pass', 0, 100, 0, 0)
        RETURNING id;
      `, [publishedEventId]);
      freeTierId = ttRes.rows[0].id;
    });

    it('3.1. Rejects booking submission when Idempotency-Key header is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${publishedEventId}/bookings`,
        headers: student.headers,
        payload: {
          items: [{ ticketTypeId: freeTierId, quantity: 1 }],
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('MISSING_IDEMPOTENCY_KEY');
    });

    it('3.2. Rejects booking with non-UUID ticketTypeId with 400 VALIDATION_ERROR', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${publishedEventId}/bookings`,
        headers: {
          ...student.headers,
          'Idempotency-Key': `bkg-test-${Date.now()}`,
        },
        payload: {
          items: [{ ticketTypeId: 'regular-tier', quantity: 1 }],
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('3.3. Confirms valid booking, creates QR ticket, and issues digital pass into Passport', async () => {
      const idempotencyKey = `bkg-reg-${Date.now()}`;
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${publishedEventId}/bookings`,
        headers: {
          ...student.headers,
          'Idempotency-Key': idempotencyKey,
        },
        payload: {
          items: [{ ticketTypeId: freeTierId, quantity: 1 }],
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.booking).toBeDefined();
      expect(body.booking.status).toBe('CONFIRMED');
      expect(body.booking.total_paise).toBe(0);
      expect(body.tickets).toBeDefined();
      expect(body.tickets.length).toBe(1);
      expect(body.tickets[0].id).toBeDefined();
      expect(body.tickets[0].ticket_code).toBeDefined();

      // Verify ticket appears in student's /me/tickets for Passport display
      const ticketsRes = await app.inject({
        method: 'GET',
        url: '/api/v1/me/tickets',
        headers: student.headers,
      });
      expect(ticketsRes.statusCode).toBe(200);
      const myTickets = JSON.parse(ticketsRes.body).tickets;
      const matchingTicket = myTickets.find((t: any) => t.event_id === publishedEventId);
      expect(matchingTicket).toBeDefined();
      expect(matchingTicket.status).toBe('VALID');
    });
  });

  // =========================================================================
  // 4. ATTENDEE FEEDBACK FORM VALIDATION & SUBMISSION
  // =========================================================================
  describe('4. Attendee Feedback Form Validation', () => {
    it('4.1. Rejects rating greater than 5 or less than 1', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/events/44d2a71e-f6af-4764-8793-b116f9439a30/feedback`,
        headers: student.headers,
        payload: {
          rating: 6, // Exceeds max 5
          comment: 'Great event',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('4.2. Rejects negative or zero rating', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/events/44d2a71e-f6af-4764-8793-b116f9439a30/feedback`,
        headers: student.headers,
        payload: {
          rating: 0, // Below min 1
          comment: 'Could be better',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // =========================================================================
  // 5. TEAM CREATION & HACKATHON WORKFLOW FORM
  // =========================================================================
  describe('5. Team Creation & Deliverables Workflow', () => {
    let createdTeamId: string;

    it('5.1. Validates and creates a team with custom skills and max size', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/teams',
        headers: student.headers,
        payload: {
          name: `Squad Alpha ${Date.now().toString().slice(-4)}`,
          description: 'Cross-functional engineering team for smart campus sustainability hackathon.',
          visibility: 'discoverable',
          maxSize: 4,
          skillsOffered: ['React', 'Python', 'Edge IoT'],
          skillsNeeded: ['UI/UX', 'Embedded Systems'],
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.team).toBeDefined();
      expect(body.team.id).toBeDefined();
      expect(body.team.max_size).toBe(4);
      createdTeamId = body.team.id;
    });

    it('5.2. Invites a student collaborator to the squad by email', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/teams/${createdTeamId}/invitations`,
        headers: student.headers,
        payload: {
          email: 'student2@campus.edu',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.invitation).toBeDefined();
      expect(body.invitation.status).toBe('PENDING');
    });
  });
});
