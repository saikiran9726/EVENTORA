import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../packages/backend/src/app.js';
import { pool } from '../../packages/backend/src/db/index.js';
import { FastifyInstance } from 'fastify';

describe('Production Readiness & Live Defect Regression Suite', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. GET /api/v1/events?limit=20 returns 200 with valid items array (resolving 42P01)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/events?limit=20',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.items).toBeDefined();
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.limit).toBe(20);
    expect(body.error).toBeUndefined();
  });

  it('2. GET /api/v1/venues returns 200 with seeded campus venues', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/venues',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.venues).toBeDefined();
    expect(Array.isArray(body.venues)).toBe(true);
    expect(body.venues.length).toBeGreaterThan(0);
    expect(body.venues[0].name).toBeDefined();
    expect(body.venues[0].building).toBeDefined();
  });

  it('3. GET /readiness accurately verifies PostgreSQL connection and migration version >= 11', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/readiness',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ready');
    expect(body.checks.postgres.status).toBe('ok');
    expect(body.checks.migration.status).toBe('ok');
    expect(body.checks.migration.version).toBeGreaterThanOrEqual(11);
    expect(body.checks.worker.status).toBe('ok');
  });

  it('4. POST /api/v1/auth/login with demo student account succeeds with 200 and session cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'student1@campus.edu',
        password: 'Eventora#Test2026!',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.user).toBeDefined();
    expect(body.user.email).toBe('student1@campus.edu');
    expect(body.user.globalRole).toBe('student');

    // Confirm session cookie was issued
    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    expect(String(setCookie)).toContain('eventora_session');
  });

  it('5. POST /api/v1/auth/register allows student creation under campus.edu domain', async () => {
    const uniqueEmail = `test.student.${Date.now()}@campus.edu`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        displayName: 'Automated Test Student',
        email: uniqueEmail,
        password: 'Eventora#SecurePass2026!',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.user).toBeDefined();
    expect(body.user.email).toBe(uniqueEmail);
    expect(body.verificationToken).toBeDefined();
  });
});
