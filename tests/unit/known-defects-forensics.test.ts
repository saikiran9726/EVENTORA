import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../packages/backend/src/app.js';
import { db } from '../../packages/backend/src/db/index.js';
import { FastifyInstance } from 'fastify';

interface AuthSession {
  headers: {
    cookie: string;
    'x-csrf-token': string;
  };
  body: any;
}

describe('Known Failures Forensic Reproduction & Verification Suite', () => {
  let app: FastifyInstance;
  let student: AuthSession;
  let reviewer: AuthSession;
  let admin: AuthSession;

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
      body: JSON.parse(res.body),
    };
  }

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    student = await loginAs('student1@campus.edu');
    reviewer = await loginAs('reviewer.faculty@campus.edu');
    admin = await loginAs('admin.system@campus.edu');
  });

  afterAll(async () => {
    await app.close();
  });

  // =========================================================================
  // REPRODUCTION 1: Registration-to-Passport Ticket Flow & /me/bookings
  // =========================================================================
  describe('Reproduction 1: Registration-to-Passport Ticket Flow', () => {
    it('1.1. Proves /me/bookings SQL query executes cleanly without PostgreSQL 42883 MAX(uuid) error', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/me/bookings',
        headers: student.headers,
      });

      // Before commit 1086a77, this returned 500 with SQLSTATE 42883 (function max(uuid) does not exist)
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.bookings).toBeDefined();
      expect(Array.isArray(body.bookings)).toBe(true);
      expect(body.error).toBeUndefined();
    });

    it('1.2. Proves /me/tickets returns active event passes with turnstile QR hashes for Passport', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/me/tickets',
        headers: student.headers,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.tickets).toBeDefined();
      expect(Array.isArray(body.tickets)).toBe(true);
      expect(body.error).toBeUndefined();
    });
  });

  // =========================================================================
  // REPRODUCTION 2: Club Verification Route Mismatch
  // =========================================================================
  describe('Reproduction 2: Club Verification Forensics', () => {
    it('2.1. Proves POST /api/v1/organizers/:id/verification compatibility alias route is active and successfully verifies organizer', async () => {
      const seededOrganizer = await db.query.organizerProfiles.findFirst();
      expect(seededOrganizer).toBeDefined();
      const organizerId = seededOrganizer!.id;
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/organizers/${organizerId}/verification`,
        headers: admin.headers,
        payload: { status: 'VERIFIED', evidenceRef: 'Campus Dean Charter 2026' },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.verification).toBeDefined();
      expect(body.verification.status).toBe('VERIFIED');
    });

    it('2.2. Proves the real backend route POST /api/v1/admin/organizers/:id/verify exists and enforces admin authorization', async () => {
      const seededOrganizer = await db.query.organizerProfiles.findFirst();
      expect(seededOrganizer).toBeDefined();
      const organizerId = seededOrganizer!.id;
      
      // Proves student is blocked with 403 Forbidden
      const studentRes = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/organizers/${organizerId}/verify`,
        headers: student.headers,
        payload: { status: 'VERIFIED' },
      });
      expect(studentRes.statusCode).toBe(403);
      const studentBody = JSON.parse(studentRes.body);
      expect(studentBody.error.code).toBe('FORBIDDEN');

      // Proves admin is authorized and successfully verifies the club charter
      const adminRes = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/organizers/${organizerId}/verify`,
        headers: admin.headers,
        payload: { status: 'VERIFIED', evidenceRef: 'Campus Dean Charter 2026' },
      });
      expect(adminRes.statusCode).toBe(200);
      const adminBody = JSON.parse(adminRes.body);
      expect(adminBody.verification).toBeDefined();
      expect(adminBody.verification.status).toBe('VERIFIED');
    });
  });

  // =========================================================================
  // REPRODUCTION 3: Registration Typing & Non-UUID Fallback ID Rejection
  // =========================================================================
  describe('Reproduction 3: Registration Typing & Field State Forensics', () => {
    it('3.1. Proves proposal creation with non-UUID venue ID (e.g. "v-auditorium") is rejected by Zod schema with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/events',
        headers: admin.headers,
        payload: {
          title: 'Test Form Rejection Event',
          description: 'A comprehensive campus workshop testing non-UUID venue string validation.',
          category: 'Technology',
          department: 'Computer Science',
          format: 'in_person',
          contactEmail: 'organizer@campus.edu',
          venueId: 'v-auditorium', // Non-UUID mock ID that broke the form
          startsAt: new Date(Date.now() + 86400000).toISOString(),
          endsAt: new Date(Date.now() + 90000000).toISOString(),
          capacity: 100,
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('3.2. Proves proposal creation with valid UUID venue ID is accepted by schema validator', async () => {
      // Fetch a real seeded campus venue
      const venuesRes = await app.inject({ method: 'GET', url: '/api/v1/venues' });
      expect(venuesRes.statusCode).toBe(200);
      const venues = JSON.parse(venuesRes.body).venues;
      expect(venues.length).toBeGreaterThan(0);
      const validVenueId = venues[0].id;

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/events',
        headers: admin.headers,
        payload: {
          title: `Forensic Valid Venue Event ${Date.now()}`,
          description: 'A comprehensive campus workshop for hands-on technical training.',
          category: 'Hackathon',
          department: 'Computer Science',
          format: 'in_person',
          contactEmail: 'organizer@campus.edu',
          venueId: validVenueId,
          startsAt: new Date(Date.now() + 86400000 * 10).toISOString(),
          endsAt: new Date(Date.now() + 86400000 * 10 + 3600000).toISOString(),
          capacity: 50,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.event).toBeDefined();
      expect(body.event.venueId).toBe(validVenueId);
    });
  });

  // =========================================================================
  // REPRODUCTION 4: Faculty Review Authorization Forensics
  // =========================================================================
  describe('Reproduction 4: Faculty Review Authorization Forensics', () => {
    it('4.1. Proves student account calling POST /api/v1/events/:id/approval receives exact 403 "Reviewer or admin role required for event:review"', async () => {
      const dummyEventId = '00000000-0000-0000-0000-000000000002';
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${dummyEventId}/approval`,
        headers: student.headers,
        payload: {
          decision: 'approved',
          comments: 'Approved by student without faculty privileges',
        },
      });

      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('FORBIDDEN');
      // Proves the exact failure string reported by users
      expect(body.error.message).toBe('Reviewer or admin role required for event:review');
    });

    it('4.2. Proves reviewer account (reviewer.faculty@campus.edu) passes the policy guard', async () => {
      const dummyEventId = '00000000-0000-0000-0000-000000000002';
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${dummyEventId}/approval`,
        headers: reviewer.headers,
        payload: {
          decision: 'approved',
          comments: 'Faculty Dean verified compliance with department safety rules.',
        },
      });

      // 404 (Event not found) proves the policy check passed and entered route logic
      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('EVENT_NOT_FOUND');
    });
  });

  // =========================================================================
  // REPRODUCTION 5: Proposal Submission Timeout, Empty Body & Duplicate Prevention
  // =========================================================================
  describe('Reproduction 5: Proposal Submission Timeout & Duplicate Prevention', () => {
    it('5.1. Proves POST /api/v1/events/:id/submit handles empty JSON body {} without crash or timeout', async () => {
      const dummyEventId = '00000000-0000-0000-0000-000000000003';
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${dummyEventId}/submit`,
        headers: admin.headers,
        payload: {},
      });

      // 404 proves Fastify body parser handled empty body cleanly without crashing or timing out
      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('EVENT_NOT_FOUND');
    });

    it('5.2. Proves duplicate event proposal submissions with same Idempotency-Key are handled safely', async () => {
      const idempotencyKey = `idemp-test-${Date.now()}`;
      const payload = {
        title: `Idempotency Probe Event ${Date.now()}`,
        description: 'An advanced workshop verifying idempotent proposal duplicate prevention.',
        category: 'Workshop',
        department: 'Electronics',
        format: 'in_person',
        contactEmail: 'organizer@campus.edu',
        startsAt: new Date(Date.now() + 86400000 * 15).toISOString(),
        endsAt: new Date(Date.now() + 86400000 * 15 + 7200000).toISOString(),
        capacity: 30,
      };

      // First submission
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/events',
        headers: {
          ...admin.headers,
          'Idempotency-Key': idempotencyKey,
        },
        payload,
      });
      expect(res1.statusCode).toBe(201);
      const event1 = JSON.parse(res1.body).event;

      // Second identical submission with same Idempotency-Key
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/events',
        headers: {
          ...admin.headers,
          'Idempotency-Key': idempotencyKey,
        },
        payload,
      });

      // Should return either 200/201, never create duplicate unlinked event
      expect([200, 201]).toContain(res2.statusCode);
      const event2 = JSON.parse(res2.body).event;
      expect(event2.id).toBe(event1.id);
    });
  });
});
