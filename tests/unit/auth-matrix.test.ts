import { describe, it, expect } from 'vitest';
import { buildApp } from '../../packages/backend/src/app.js';

describe('RBAC Auth Matrix & Session Invalidation', () => {
  const seedPassword = process.env.SEED_PASSWORD || 'Eventora#Test2026!';

  async function loginAs(app: any, email: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: seedPassword },
    });
    expect(res.statusCode).toBe(200);
    const sessionCookie = res.cookies.find((c: any) => c.name === 'eventora_session')?.value;
    const csrfCookie = res.cookies.find((c: any) => c.name === 'eventora_csrf')?.value;
    return { sessionCookie, csrfCookie, body: JSON.parse(res.body) };
  }

  it('evaluates role access matrix for /api/v1/admin/users: anonymous(401), student(403), reviewer(403), admin(200)', async () => {
    const app = buildApp();
    await app.ready();

    // 1. Anonymous access
    const anonRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users',
    });
    expect(anonRes.statusCode).toBe(401);
    const anonBody = JSON.parse(anonRes.body);
    expect(anonBody.error.code).toBe('UNAUTHORIZED');

    // 2. Student access
    const student = await loginAs(app, 'student1@campus.edu');
    const studentRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users',
      headers: {
        cookie: `eventora_session=${student.sessionCookie}`,
      },
    });
    expect(studentRes.statusCode).toBe(403);
    const studentBody = JSON.parse(studentRes.body);
    expect(studentBody.error.code).toBe('FORBIDDEN');
    expect(studentBody.error.details.requiredPolicy).toBe('user:manage');

    // 3. Reviewer access
    const reviewer = await loginAs(app, 'reviewer.faculty@campus.edu');
    const reviewerRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users',
      headers: {
        cookie: `eventora_session=${reviewer.sessionCookie}`,
      },
    });
    expect(reviewerRes.statusCode).toBe(403);
    const reviewerBody = JSON.parse(reviewerRes.body);
    expect(reviewerBody.error.code).toBe('FORBIDDEN');

    // 4. Admin access
    const admin = await loginAs(app, 'admin.system@campus.edu');
    const adminRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users',
      headers: {
        cookie: `eventora_session=${admin.sessionCookie}`,
      },
    });
    expect(adminRes.statusCode).toBe(200);
    const adminBody = JSON.parse(adminRes.body);
    expect(adminBody.items).toBeDefined();
    expect(adminBody.pagination).toBeDefined();
    expect(adminBody.items.length).toBeGreaterThan(0);

    await app.close();
  });

  it('immediately invalidates active sessions when user status is changed to suspended', async () => {
    const app = buildApp();
    await app.ready();

    // Student3 logs in and has an active session
    const student = await loginAs(app, 'student3@campus.edu');
    const studentId = student.body.user.id;

    // Verify student can access /api/v1/me
    const meBefore = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: {
        cookie: `eventora_session=${student.sessionCookie}`,
      },
    });
    expect(meBefore.statusCode).toBe(200);

    // Admin suspends student3
    const admin = await loginAs(app, 'admin.system@campus.edu');
    const suspendRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/users/${studentId}/role`,
      headers: {
        cookie: `eventora_session=${admin.sessionCookie}; eventora_csrf=${admin.csrfCookie}`,
        'x-csrf-token': admin.csrfCookie,
      },
      payload: {
        status: 'suspended',
      },
    });
    expect(suspendRes.statusCode).toBe(200);

    // Student3 attempts another request mid-session -> must be rejected 401
    const meAfter = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: {
        cookie: `eventora_session=${student.sessionCookie}`,
      },
    });
    expect(meAfter.statusCode).toBe(401);
    const meAfterBody = JSON.parse(meAfter.body);
    expect(meAfterBody.error.code).toBe('UNAUTHORIZED');

    // Student3 attempts to login again -> must be rejected 403 ACCOUNT_SUSPENDED
    const loginAgainRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'student3@campus.edu',
        password: seedPassword,
      },
    });
    expect(loginAgainRes.statusCode).toBe(403);
    const loginAgainBody = JSON.parse(loginAgainRes.body);
    expect(loginAgainBody.error.code).toBe('ACCOUNT_SUSPENDED');

    // Reinstate student3 for idempotency of test suite
    const reinstateRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/users/${studentId}/role`,
      headers: {
        cookie: `eventora_session=${admin.sessionCookie}; eventora_csrf=${admin.csrfCookie}`,
        'x-csrf-token': admin.csrfCookie,
      },
      payload: {
        status: 'active',
      },
    });
    expect(reinstateRes.statusCode).toBe(200);

    await app.close();
  });

  it('allows authenticated users to query and update preferences', async () => {
    const app = buildApp();
    await app.ready();

    const student = await loginAs(app, 'student2@campus.edu');

    // Get preferences
    const getRes = await app.inject({
      method: 'GET',
      url: '/api/v1/me/preferences',
      headers: {
        cookie: `eventora_session=${student.sessionCookie}`,
      },
    });
    expect(getRes.statusCode).toBe(200);
    const getBody = JSON.parse(getRes.body);
    expect(getBody.preferences).toBeDefined();

    // Patch preferences
    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me/preferences',
      headers: {
        cookie: `eventora_session=${student.sessionCookie}; eventora_csrf=${student.csrfCookie}`,
        'x-csrf-token': student.csrfCookie,
      },
      payload: {
        theme: 'dark',
        emailEnabled: false,
      },
    });
    expect(patchRes.statusCode).toBe(200);
    const patchBody = JSON.parse(patchRes.body);
    expect(patchBody.preferences.theme).toBe('dark');
    expect(patchBody.preferences.emailEnabled).toBe(false);

    await app.close();
  });
});
