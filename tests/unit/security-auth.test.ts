import { describe, it, expect } from 'vitest';
import {
  ARGON2_CONFIG,
  SESSION_CONFIG,
  hashPassword,
  verifyPassword,
  generateOpaqueToken,
  hashTokenToBuffer,
} from '../../packages/backend/src/services/auth.js';
import { checkRateLimit } from '../../packages/backend/src/services/redis.js';
import { buildApp } from '../../packages/backend/src/app.js';

describe('Security & Auth Primitives (Non-Negotiables)', () => {
  it('enforces Argon2id parameters: memory 64 MiB, t=3, p=1', async () => {
    expect(ARGON2_CONFIG.memoryCost).toBe(65536); // 64 MiB = 65536 KiB
    expect(ARGON2_CONFIG.timeCost).toBe(3);       // t=3
    expect(ARGON2_CONFIG.parallelism).toBe(1);    // p=1

    const password = 'TestSecurePassword#2026';
    const hash = await hashPassword(password);

    // Assert hash header contains strict Argon2id parameters
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);

    const valid = await verifyPassword(hash, password);
    expect(valid).toBe(true);

    const invalid = await verifyPassword(hash, 'WrongPassword#999');
    expect(invalid).toBe(false);
  });

  it('generates 256-bit opaque random tokens and SHA-256 bytea hashes', () => {
    const token = generateOpaqueToken();
    // 32 bytes base64url is 43 characters
    expect(token.length).toBe(43);

    const hashBuffer = hashTokenToBuffer(token);
    expect(Buffer.isBuffer(hashBuffer)).toBe(true);
    expect(hashBuffer.length).toBe(32); // 256 bits = 32 bytes
  });

  it('session configuration defines 30m idle and 12h absolute timeouts', () => {
    expect(SESSION_CONFIG.idleTimeoutMs).toBe(30 * 60 * 1000);
    expect(SESSION_CONFIG.absoluteTimeoutMs).toBe(12 * 60 * 60 * 1000);
    expect(SESSION_CONFIG.cookieName).toBe('eventora_session');
    expect(SESSION_CONFIG.csrfCookieName).toBe('eventora_csrf');
  });

  it('sliding window rate limiter tracks limits and denies excess attempts', async () => {
    const key = `test_limit_${Date.now()}`;
    const limit = 3;
    const windowSeconds = 2;

    const r1 = await checkRateLimit(key, limit, windowSeconds);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);

    const r2 = await checkRateLimit(key, limit, windowSeconds);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(1);

    const r3 = await checkRateLimit(key, limit, windowSeconds);
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);

    // 4th attempt exceeds limit
    const r4 = await checkRateLimit(key, limit, windowSeconds);
    expect(r4.allowed).toBe(false);
    expect(r4.remaining).toBe(0);
  });

  it('login returns uniform error for unknown email vs wrong password', async () => {
    const app = buildApp();
    await app.ready();

    // 1. Unknown email
    const unknownRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'nobody_exists@campus.edu',
        password: 'SomeRandomPassword123!',
      },
    });

    expect(unknownRes.statusCode).toBe(401);
    const unknownBody = JSON.parse(unknownRes.body);
    expect(unknownBody.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknownBody.error.message).toBe('Invalid email or password.');

    // 2. Known email, wrong password
    const wrongPassRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'student1@campus.edu',
        password: 'IncorrectPassword#999!',
      },
    });

    expect(wrongPassRes.statusCode).toBe(401);
    const wrongPassBody = JSON.parse(wrongPassRes.body);
    expect(wrongPassBody.error.code).toBe('INVALID_CREDENTIALS');
    expect(wrongPassBody.error.message).toBe('Invalid email or password.');

    // Uniform message and code
    expect(unknownBody.error.message).toBe(wrongPassBody.error.message);
    expect(unknownBody.error.code).toBe(wrongPassBody.error.code);

    await app.close();
  });

  it('sets HttpOnly, SameSite=Lax cookie and rotates session on login', async () => {
    const app = buildApp();
    await app.ready();

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'student1@campus.edu',
        password: process.env.SEED_PASSWORD || 'Eventora#Test2026!',
      },
    });

    expect(loginRes.statusCode).toBe(200);
    const cookies = loginRes.cookies;

    const sessionCookie = cookies.find((c) => c.name === 'eventora_session');
    const csrfCookie = cookies.find((c) => c.name === 'eventora_csrf');

    expect(sessionCookie).toBeDefined();
    expect(sessionCookie!.httpOnly).toBe(true);
    expect(sessionCookie!.sameSite).toBe('Lax');
    expect(sessionCookie!.path).toBe('/');

    expect(csrfCookie).toBeDefined();
    expect(csrfCookie!.sameSite).toBe('Lax');

    const firstToken = sessionCookie!.value;

    // Login again -> asserts session rotation (fixation protection)
    const secondLoginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: {
        cookie: `eventora_session=${firstToken}`,
      },
      payload: {
        email: 'student1@campus.edu',
        password: process.env.SEED_PASSWORD || 'Eventora#Test2026!',
      },
    });

    expect(secondLoginRes.statusCode).toBe(200);
    const secondSessionCookie = secondLoginRes.cookies.find((c) => c.name === 'eventora_session');
    expect(secondSessionCookie).toBeDefined();
    // New token must not equal the previous one
    expect(secondSessionCookie!.value).not.toBe(firstToken);

    await app.close();
  });

  it('enforces double-submit CSRF token on state-changing authenticated requests', async () => {
    const app = buildApp();
    await app.ready();

    // Sign in to obtain session and csrf cookie
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'student1@campus.edu',
        password: process.env.SEED_PASSWORD || 'Eventora#Test2026!',
      },
    });

    const sessionCookie = loginRes.cookies.find((c) => c.name === 'eventora_session')!.value;
    const csrfCookie = loginRes.cookies.find((c) => c.name === 'eventora_csrf')!.value;

    // 1. Missing CSRF header on PATCH /api/v1/me -> 403 CSRF_INVALID
    const missingCsrfRes = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: {
        cookie: `eventora_session=${sessionCookie}; eventora_csrf=${csrfCookie}`,
      },
      payload: { displayName: 'Updated Aarav' },
    });

    expect(missingCsrfRes.statusCode).toBe(403);
    const missingCsrfBody = JSON.parse(missingCsrfRes.body);
    expect(missingCsrfBody.error.code).toBe('CSRF_INVALID');

    // 2. Mismatched CSRF header -> 403 CSRF_INVALID
    const mismatchedCsrfRes = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: {
        cookie: `eventora_session=${sessionCookie}; eventora_csrf=${csrfCookie}`,
        'x-csrf-token': 'wrong-csrf-token-value',
      },
      payload: { displayName: 'Updated Aarav' },
    });

    expect(mismatchedCsrfRes.statusCode).toBe(403);
    const mismatchedBody = JSON.parse(mismatchedCsrfRes.body);
    expect(mismatchedBody.error.code).toBe('CSRF_INVALID');

    // 3. Matching CSRF header -> 200 OK
    const validCsrfRes = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: {
        cookie: `eventora_session=${sessionCookie}; eventora_csrf=${csrfCookie}`,
        'x-csrf-token': csrfCookie,
      },
      payload: { displayName: 'Aarav Sharma' },
    });

    expect(validCsrfRes.statusCode).toBe(200);
    const validBody = JSON.parse(validCsrfRes.body);
    expect(validBody.user.displayName).toBe('Aarav Sharma');

    await app.close();
  });
});
