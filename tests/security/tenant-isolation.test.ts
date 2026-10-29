import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { pool } from '../../packages/backend/src/db/index.js';
import { buildApp } from '../../packages/backend/src/app.js';

describe('Phase P27: Tenant Isolation Security Quality Gate (Multi-Tenancy Enforcement)', () => {
  let app: FastifyInstance;

  let collegeAId: string;
  let collegeBId: string;

  let studentAId: string;
  let studentACookie: string;
  let studentACsrf: string;

  let studentBId: string;
  let studentBCookie: string;
  let studentBCsrf: string;

  let organizerAId: string;
  let organizerAUserId: string;
  let organizerACookie: string;
  let organizerACsrf: string;

  let organizerBId: string;
  let organizerBUserId: string;
  let organizerBCookie: string;
  let organizerBCsrf: string;

  let eventAPrivateId: string;
  let eventBPrivateId: string;
  let eventCrossCollegeId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // 1. Create College A and College B
    const colARes = await pool.query(
      `INSERT INTO colleges (name, domain, status)
       VALUES ('College Alpha P27', 'alpha.campus.edu', 'active')
       ON CONFLICT (domain) DO UPDATE SET name = EXCLUDED.name, status = 'active'
       RETURNING id;`
    );
    collegeAId = colARes.rows[0].id;

    const colBRes = await pool.query(
      `INSERT INTO colleges (name, domain, status)
       VALUES ('College Beta P27', 'beta.campus.edu', 'active')
       ON CONFLICT (domain) DO UPDATE SET name = EXCLUDED.name, status = 'active'
       RETURNING id;`
    );
    collegeBId = colBRes.rows[0].id;

    // Helper to create and authenticate a user
    async function createAndAuthUser(email: string, role = 'student', colId: string) {
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email,
          password: 'Password123!Secure',
          displayName: `User ${email.split('@')[0]}`,
        },
      });

      await pool.query(
        `UPDATE users
         SET email_verified_at = NOW(), status = 'active', global_role = $1, college_id = $2
         WHERE email = $3;`,
        [role, colId, email]
      );

      const uRes = await pool.query(`SELECT id FROM users WHERE email = $1;`, [email]);
      const userId = uRes.rows[0].id;

      const loginRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email, password: 'Password123!Secure' },
      });

      const cookies = loginRes.cookies;
      const sCookie = cookies.find((c) => c.name === 'eventora_session')!;
      const csrfCookie = cookies.find((c) => c.name === 'eventora_csrf')!;

      return {
        userId,
        cookie: `eventora_session=${sCookie.value}; eventora_csrf=${csrfCookie.value}`,
        csrf: csrfCookie.value,
      };
    }

    // 2. Setup Student A (College A) and Student B (College B)
    const stuA = await createAndAuthUser(`student.a.${Date.now()}@alpha.campus.edu`, 'student', collegeAId);
    studentAId = stuA.userId;
    studentACookie = stuA.cookie;
    studentACsrf = stuA.csrf;

    const stuB = await createAndAuthUser(`student.b.${Date.now()}@beta.campus.edu`, 'student', collegeBId);
    studentBId = stuB.userId;
    studentBCookie = stuB.cookie;
    studentBCsrf = stuB.csrf;

    // 3. Setup Organizer A (College A) and Organizer B (College B)
    const orgA = await createAndAuthUser(`organizer.a.${Date.now()}@alpha.campus.edu`, 'student', collegeAId);
    organizerAUserId = orgA.userId;
    organizerACookie = orgA.cookie;
    organizerACsrf = orgA.csrf;

    const oAProfile = await pool.query(
      `INSERT INTO organizer_profiles (college_id, display_name, status, created_by)
       VALUES ($1, 'Alpha Tech Society', 'verified', $2) RETURNING id;`,
      [collegeAId, organizerAUserId]
    );
    organizerAId = oAProfile.rows[0].id;
    await pool.query(
      `INSERT INTO organizer_members (organizer_id, user_id, role, status)
       VALUES ($1, $2, 'owner', 'active');`,
      [organizerAId, organizerAUserId]
    );

    const orgB = await createAndAuthUser(`organizer.b.${Date.now()}@beta.campus.edu`, 'student', collegeBId);
    organizerBUserId = orgB.userId;
    organizerBCookie = orgB.cookie;
    organizerBCsrf = orgB.csrf;

    const oBProfile = await pool.query(
      `INSERT INTO organizer_profiles (college_id, display_name, status, created_by)
       VALUES ($1, 'Beta Coding Guild', 'verified', $2) RETURNING id;`,
      [collegeBId, organizerBUserId]
    );
    organizerBId = oBProfile.rows[0].id;
    await pool.query(
      `INSERT INTO organizer_members (organizer_id, user_id, role, status)
       VALUES ($1, $2, 'owner', 'active');`,
      [organizerBId, organizerBUserId]
    );

    // 4. Create Private Events for College A, College B, and Cross-College Event
    const eARes = await pool.query(
      `INSERT INTO events (
         organizer_id, college_id, title, slug, description, category, format,
         starts_at, ends_at, capacity, created_by, contact_email, status, visibility
       ) VALUES (
         $1, $2, 'Alpha Internal Hackathon', 'alpha-internal-${Date.now()}', 'Private to Alpha', 'Tech', 'in_person',
         NOW() + INTERVAL '2 days', NOW() + INTERVAL '3 days', 50, $3, 'org@alpha.campus.edu', 'published', 'college'
       ) RETURNING id;`,
      [organizerAId, collegeAId, organizerAUserId]
    );
    eventAPrivateId = eARes.rows[0].id;

    // Add standard ticket tier for Event A
    await pool.query(
      `INSERT INTO ticket_types (event_id, name, capacity, price_paise, sold, held)
       VALUES ($1, 'Alpha Member Pass', 50, 0, 0, 0);`,
      [eventAPrivateId]
    );

    const eBRes = await pool.query(
      `INSERT INTO events (
         organizer_id, college_id, title, slug, description, category, format,
         starts_at, ends_at, capacity, created_by, contact_email, status, visibility
       ) VALUES (
         $1, $2, 'Beta Internal Symposium', 'beta-internal-${Date.now()}', 'Private to Beta', 'Tech', 'in_person',
         NOW() + INTERVAL '2 days', NOW() + INTERVAL '3 days', 50, $3, 'org@beta.campus.edu', 'published', 'college'
       ) RETURNING id;`,
      [organizerBId, collegeBId, organizerBUserId]
    );
    eventBPrivateId = eBRes.rows[0].id;

    const eCrossRes = await pool.query(
      `INSERT INTO events (
         organizer_id, college_id, title, slug, description, category, format,
         starts_at, ends_at, capacity, created_by, contact_email, status, visibility
       ) VALUES (
         $1, $2, 'Inter-College RoboWars 2026', 'inter-college-robo-${Date.now()}', 'Open to All Campuses', 'Tech', 'in_person',
         NOW() + INTERVAL '5 days', NOW() + INTERVAL '6 days', 200, $3, 'robowars@alpha.campus.edu', 'published', 'public'
       ) RETURNING id;`,
      [organizerAId, collegeAId, organizerAUserId]
    );
    eventCrossCollegeId = eCrossRes.rows[0].id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('Tenant Boundary: Student B (College B) cannot view College A internal event', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${eventAPrivateId}`,
      headers: {
        cookie: studentBCookie,
      },
    });

    // College-scoped event is hidden from cross-college students
    expect([403, 404]).toContain(res.statusCode);
  });

  it('Tenant Boundary: Student B (College B) cannot book tickets for College A internal event', async () => {
    const ttRes = await pool.query(`SELECT id FROM ticket_types WHERE event_id = $1 LIMIT 1;`, [eventAPrivateId]);
    const ticketTypeId = ttRes.rows[0].id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${eventAPrivateId}/bookings`,
      headers: {
        cookie: studentBCookie,
        'x-csrf-token': studentBCsrf,
        'Idempotency-Key': `book-cross-${Date.now()}`,
      },
      payload: {
        items: [{ ticketTypeId, quantity: 1 }],
      },
    });

    expect([400, 403, 404]).toContain(res.statusCode);
  });

  it('Tenant Boundary: Organizer B (College B) cannot modify or cancel College A event', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${eventAPrivateId}/cancel`,
      headers: {
        cookie: organizerBCookie,
        'x-csrf-token': organizerBCsrf,
      },
      payload: {
        reason: 'Malicious cross-college cancellation attempt',
      },
    });

    expect([403, 404]).toContain(res.statusCode);
  });

  it('Tenant Boundary: Organizer B (College B) cannot view College A attendee roster or analytics', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${eventAPrivateId}/attendance`,
      headers: {
        cookie: organizerBCookie,
      },
    });

    expect([403, 404]).toContain(res.statusCode);
  });

  it('Cross-College Access: Student B can view and access cross-college published events', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/events/${eventCrossCollegeId}`,
      headers: {
        cookie: studentBCookie,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.event.id).toBe(eventCrossCollegeId);
    expect(body.event.visibility).toBe('public');
  });
});
