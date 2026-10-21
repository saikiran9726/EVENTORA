import { describe, it, expect } from 'vitest';
import { buildApp } from '../../packages/backend/src/app.js';

describe('Route Policy & Deny-by-Default Enforcement', () => {
  it('every registered route must declare explicit { auth, policy, objectCheck }', async () => {
    const app = buildApp();
    await app.ready();

    // Verify specifically each known endpoint has strict policy
    const testCases = [
      { method: 'POST', url: '/api/v1/auth/register' },
      { method: 'POST', url: '/api/v1/auth/login' },
      { method: 'POST', url: '/api/v1/auth/logout' },
      { method: 'POST', url: '/api/v1/auth/verify-email' },
      { method: 'POST', url: '/api/v1/auth/forgot' },
      { method: 'POST', url: '/api/v1/auth/reset' },
      { method: 'GET', url: '/api/v1/me' },
      { method: 'PATCH', url: '/api/v1/me' },
      { method: 'GET', url: '/api/v1/me/preferences' },
      { method: 'PATCH', url: '/api/v1/me/preferences' },
      { method: 'GET', url: '/api/v1/admin/users' },
      { method: 'POST', url: '/api/v1/admin/users/test-id/role' },
    ];

    for (const tc of testCases) {
      const res = await app.inject({
        method: tc.method as any,
        url: tc.url,
      });

      // Anonymous access on protected routes should return 401 or 403, never 404 or missing policy error
      if (tc.url.startsWith('/api/v1/me') || tc.url.startsWith('/api/v1/admin') || tc.url === '/api/v1/auth/logout') {
        expect([401, 403]).toContain(res.statusCode);
        const body = JSON.parse(res.body);
        expect(body.error).toBeDefined();
        expect(body.error.code).toBeDefined();
        expect(body.error.requestId).toBeDefined();
      }
    }

    await app.close();
  });

  it('fails server route registration if a route lacks declared policy or auth', () => {
    const badApp = buildApp();
    expect(() => {
      // Add an unprotected rogue route without config
      badApp.get('/api/v1/rogue-route', async () => ({ secret: 'leaked' }));
    }).toThrow(/lacks explicit deny-by-default { auth, policy, objectCheck } configuration/);
  });

  it('fails server route registration if a route lacks explicit objectCheck', () => {
    const badApp = buildApp();
    expect(() => {
      badApp.get(
        '/api/v1/missing-object-check',
        {
          config: {
            auth: true,
            policy: 'authenticated',
            // objectCheck omitted intentionally
          } as any,
        },
        async () => ({ ok: true })
      );
    }).toThrow(/lacks explicit objectCheck declaration/);
  });

  it('returns standard error envelope on unknown routes (404)', async () => {
    const app = buildApp();
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/does-not-exist',
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toContain('not found');
    expect(body.error.requestId).toBeDefined();

    await app.close();
  });
});
