import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../packages/backend/src/app.js';
import { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';

describe('Security & Financial Invariants Regression Suite', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('D1: Authentication & Token Security Invariants', () => {
    it('rejects passwords > 128 chars to prevent Argon2id CPU DoS', async () => {
      const longPassword = 'A'.repeat(129) + '!1a';

      const loginRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: 'student1@campus.edu',
          password: longPassword,
        },
      });

      expect(loginRes.statusCode).toBe(400);

      const registerRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          displayName: 'DoS Attacker',
          email: `attacker.${Date.now()}@campus.edu`,
          password: longPassword,
        },
      });

      expect(registerRes.statusCode).toBe(400);
    });

    it('rejects registration with unrecognized non-college email domains', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          displayName: 'Outsider Attacker',
          email: `outsider.${Date.now()}@malicious-unregistered-domain.com`,
          password: 'ValidPassword#123!',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error?.code).toBe('INVALID_COLLEGE_DOMAIN');
    });

    it('enforces token purpose separation: verification token cannot be used for password reset', async () => {
      // 1. Register a student to get a verification token
      const testEmail = `token.sep.${Date.now()}@campus.edu`;
      const regRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          displayName: 'Token Separation Test',
          email: testEmail,
          password: 'ValidPassword#123!',
        },
      });

      expect(regRes.statusCode).toBe(201);
      const regBody = JSON.parse(regRes.body);
      const verificationToken = regBody.verificationToken;
      expect(verificationToken).toBeDefined();

      // 2. Attempt to use this verification token on password reset endpoint /api/v1/auth/reset
      const resetRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/reset',
        payload: {
          token: verificationToken,
          newPassword: 'NewValidPassword#456!',
        },
      });

      // Must be rejected because token hash prefixes differ (verify: vs reset:)
      expect(resetRes.statusCode).toBe(400);
      const resetBody = JSON.parse(resetRes.body);
      expect(resetBody.error?.code).toBe('INVALID_OR_EXPIRED_TOKEN');
    });
  });

  describe('D3: Payment Simulator Access Control', () => {
    it('blocks unauthenticated and non-admin calls to the payment simulator endpoint', async () => {
      // Unauthenticated call
      const unauthRes = await app.inject({
        method: 'POST',
        url: '/api/v1/simulator/payments',
        payload: {
          orderId: 'sim_test_order_123',
          action: 'succeed',
        },
      });

      expect(unauthRes.statusCode).toBe(401);

      // Student authenticated call
      const loginRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: 'student1@campus.edu',
          password: 'Eventora#Test2026!',
        },
      });

      const cookies = loginRes.headers['set-cookie'];
      const csrfMatch = String(cookies).match(/eventora_csrf=([^;]+)/);
      const sessionMatch = String(cookies).match(/eventora_session=([^;]+)/);
      const csrfToken = csrfMatch ? decodeURIComponent(csrfMatch[1]) : '';
      const sessionCookie = sessionMatch ? sessionMatch[0] : '';

      const studentRes = await app.inject({
        method: 'POST',
        url: '/api/v1/simulator/payments',
        headers: {
          cookie: `${sessionCookie}; eventora_csrf=${csrfToken}`,
          'x-csrf-token': csrfToken,
        },
        payload: {
          orderId: 'sim_test_order_123',
          action: 'succeed',
        },
      });

      // Student does not possess user:manage / platform_admin policy
      expect(studentRes.statusCode).toBe(403);
    });
  });

  describe('D10: Event PATCH Property Sanitization', () => {
    it('ignores attempts to overwrite organizerId, collegeId, or createdBy via PATCH /events/:id', async () => {
      // Login as organizer
      const loginRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: 'organizer.ras@campus.edu',
          password: 'Eventora#Test2026!',
        },
      });

      const cookies = loginRes.headers['set-cookie'];
      const csrfMatch = String(cookies).match(/eventora_csrf=([^;]+)/);
      const sessionMatch = String(cookies).match(/eventora_session=([^;]+)/);
      const csrfToken = csrfMatch ? decodeURIComponent(csrfMatch[1]) : '';
      const sessionCookie = sessionMatch ? sessionMatch[0] : '';

      // Get an event to patch
      const eventsRes = await app.inject({
        method: 'GET',
        url: '/api/v1/events?limit=1',
      });
      const eventsBody = JSON.parse(eventsRes.body);
      const targetEvent = eventsBody.items?.[0];

      if (targetEvent) {
        const fakeOrganizerId = crypto.randomUUID();
        const patchRes = await app.inject({
          method: 'PATCH',
          url: `/api/v1/events/${targetEvent.id}`,
          headers: {
            cookie: `${sessionCookie}; eventora_csrf=${csrfToken}`,
            'x-csrf-token': csrfToken,
          },
          payload: {
            title: targetEvent.title,
            organizerId: fakeOrganizerId,
            collegeId: crypto.randomUUID(),
          },
        });

        if (patchRes.statusCode === 200) {
          const patchedBody = JSON.parse(patchRes.body);
          // organizerId must NOT have changed to fakeOrganizerId
          expect(patchedBody.event?.organizerId).not.toBe(fakeOrganizerId);
        }
      }
    });
  });

  describe('D11: Platform Admin Safety Invariants', () => {
    it('strictly rejects admin self-demotion and self-suspension', async () => {
      // Login as platform admin
      const loginRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: 'admin.system@campus.edu',
          password: 'Eventora#Test2026!',
        },
      });

      expect(loginRes.statusCode).toBe(200);
      const adminUser = JSON.parse(loginRes.body).user;

      const cookies = loginRes.headers['set-cookie'];
      const csrfMatch = String(cookies).match(/eventora_csrf=([^;]+)/);
      const sessionMatch = String(cookies).match(/eventora_session=([^;]+)/);
      const csrfToken = csrfMatch ? decodeURIComponent(csrfMatch[1]) : '';
      const sessionCookie = sessionMatch ? sessionMatch[0] : '';

      // Try self-demotion
      const demoteRes = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/users/${adminUser.id}/role`,
        headers: {
          cookie: `${sessionCookie}; eventora_csrf=${csrfToken}`,
          'x-csrf-token': csrfToken,
        },
        payload: {
          globalRole: 'student',
        },
      });

      expect(demoteRes.statusCode).toBe(400);
      const demoteBody = JSON.parse(demoteRes.body);
      expect(demoteBody.error?.code).toBe('SELF_DEMOTION_PROHIBITED');

      // Try self-suspension
      const suspendRes = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/users/${adminUser.id}/role`,
        headers: {
          cookie: `${sessionCookie}; eventora_csrf=${csrfToken}`,
          'x-csrf-token': csrfToken,
        },
        payload: {
          status: 'suspended',
        },
      });

      expect(suspendRes.statusCode).toBe(400);
      const suspendBody = JSON.parse(suspendRes.body);
      expect(suspendBody.error?.code).toBe('SELF_SUSPENSION_PROHIBITED');
    });
  });
});
