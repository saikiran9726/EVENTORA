import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../packages/backend/src/app.js';
import { pool, db } from '../../packages/backend/src/db/index.js';
import { users } from '../../packages/backend/src/db/schema.js';
import { hashPassword, createSession, validateSession } from '../../packages/backend/src/services/auth.js';
import { eq } from 'drizzle-orm';
import { FastifyInstance } from 'fastify';

describe('Phase P02 Security Suite: Auth Tokens, Purpose Separation, Sessions & CSRF', () => {
  let app: FastifyInstance;
  let collegeId: string;
  let collegeDomain: string;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    const client = await pool.connect();
    try {
      const col = await client.query("SELECT id, domain FROM colleges WHERE status = 'active' LIMIT 1;");
      if (col.rows.length === 0) {
        const newCol = await client.query(`
          INSERT INTO colleges (name, domain, status)
          VALUES ('Security Test Campus', 'sec-test.edu', 'active')
          RETURNING id, domain;
        `);
        collegeId = newCol.rows[0].id;
        collegeDomain = newCol.rows[0].domain;
      } else {
        collegeId = col.rows[0].id;
        collegeDomain = col.rows[0].domain;
      }
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Password Policy & Denylist Enforcement', () => {
    it('rejects passwords longer than 128 characters on register', async () => {
      const longPassword = 'A'.repeat(129) + '!1a';
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: `p02.toolong.${Date.now()}@${collegeDomain}`,
          password: longPassword,
          displayName: 'Long Pass User',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error?.code).toBe('VALIDATION_ERROR');
    });

    it('rejects common passwords found on denylist (e.g. Password123!) on register', async () => {
      const weakPasswords = ['Password123!', 'admin123!', 'welcome123!'];

      for (const pwd of weakPasswords) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/register',
          payload: {
            email: `p02.weak.${Date.now()}.${Math.random().toString(36).slice(2, 6)}@${collegeDomain}`,
            password: pwd,
            displayName: 'Weak Password User',
          },
        });

        expect(res.statusCode).toBe(400);
        const body = JSON.parse(res.body);
        expect(body.error?.code).toBe('VALIDATION_ERROR');
      }
    });

    it('normalizes email by trimming and lowercasing', async () => {
      const rawLocal = `norm.${Date.now()}`;
      const emailWithWhitespaceAndCaps = `  ${rawLocal.toUpperCase()}@${collegeDomain.toUpperCase()}  `;
      const expectedNormalized = `${rawLocal}@${collegeDomain}`.toLowerCase();

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: emailWithWhitespaceAndCaps,
          password: 'Eventora#SecurePass2026!',
          displayName: 'Normalized User',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.user.email).toBe(expectedNormalized);

      // Verify DB row has normalized email
      const dbUser = await db.query.users.findFirst({
        where: eq(users.email, expectedNormalized),
      });
      expect(dbUser).toBeDefined();
      expect(dbUser?.email).toBe(expectedNormalized);
    });

    it('rejects unknown college domain with 400 INVALID_COLLEGE_DOMAIN', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: `outsider.${Date.now()}@unregistered-rogue-campus.com`,
          password: 'Eventora#SecurePass2026!',
          displayName: 'Outsider',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error?.code).toBe('INVALID_COLLEGE_DOMAIN');
    });
  });

  describe('2. Uniform Registration & Token Suppression in Non-Test Environments', () => {
    it('returns uniform 201 response without EMAIL_ALREADY_EXISTS error to prevent user enumeration', async () => {
      const email = `uniform.${Date.now()}@${collegeDomain}`;

      // 1. First registration
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email,
          password: 'Eventora#SecurePass2026!',
          displayName: 'Uniform Target',
        },
      });
      expect(res1.statusCode).toBe(201);

      // 2. Second registration with identical email
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email,
          password: 'Eventora#SecurePass2026!',
          displayName: 'Uniform Impostor',
        },
      });

      expect(res2.statusCode).toBe(201);
      const body = JSON.parse(res2.body);
      expect(body.message).toBe('Registration successful. Please verify your email.');
      // Must not leak error code EMAIL_ALREADY_EXISTS
      expect(body.error).toBeUndefined();
    });

    it('never returns reset or verification tokens when NODE_ENV is production', async () => {
      const originalEnv = process.env.NODE_ENV || 'test';
      try {
        process.env.NODE_ENV = 'production';

        const email = `prod.tokens.${Date.now()}@${collegeDomain}`;

        // 1. Register under production mode
        const regRes = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/register',
          payload: {
            email,
            password: 'Eventora#SecurePass2026!',
            displayName: 'Prod Mode User',
          },
        });

        expect(regRes.statusCode).toBe(201);
        const regBody = JSON.parse(regRes.body);
        expect(regBody.verificationToken).toBeUndefined();

        // 2. Forgot password under production mode
        const forgotRes = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/forgot',
          payload: { email },
        });

        expect(forgotRes.statusCode).toBe(200);
        const forgotBody = JSON.parse(forgotRes.body);
        expect(forgotBody.resetToken).toBeUndefined();
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });
  });

  describe('3. Login Response Hygiene & Rate Limiting Failure Budget', () => {
    it('omits session token from login response body completely', async () => {
      const email = `login.notoken.${Date.now()}@${collegeDomain}`;
      const password = 'Eventora#SecurePass2026!';
      const hash = await hashPassword(password);

      await db
        .insert(users)
        .values({
          collegeId,
          email,
          passwordHash: hash,
          displayName: 'No Token in Body',
          globalRole: 'student',
          status: 'active',
          emailVerifiedAt: new Date(),
        });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email, password },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.user).toBeDefined();
      expect(body.csrfToken).toBeDefined();
      expect(body.token).toBeUndefined(); // Crucial: never in body
      expect(res.headers['set-cookie']).toBeDefined(); // Delivered strictly via HttpOnly cookie
    });

    it('successful logins do not consume failure rate-limit budget', async () => {
      const email = `success.nobudget.${Date.now()}@${collegeDomain}`;
      const password = 'Eventora#SecurePass2026!';
      const hash = await hashPassword(password);

      await db.insert(users).values({
        collegeId,
        email,
        passwordHash: hash,
        displayName: 'Budget Preserved',
        globalRole: 'student',
        status: 'active',
        emailVerifiedAt: new Date(),
      });

      // 6 consecutive successful logins must all succeed without hitting 429
      for (let i = 0; i < 6; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { email, password },
        });
        expect(res.statusCode).toBe(200);
      }
    });

    it('locked-out victim cannot be created by an attacker on another IP', async () => {
      const victimEmail = `victim.${Date.now()}@${collegeDomain}`;
      const correctPassword = 'Eventora#SecurePass2026!';
      const hash = await hashPassword(correctPassword);

      await db.insert(users).values({
        collegeId,
        email: victimEmail,
        passwordHash: hash,
        displayName: 'Victim User',
        globalRole: 'student',
        status: 'active',
        emailVerifiedAt: new Date(),
      });

      const attackerIp = '198.51.100.99';
      const victimIp = '203.0.113.88';

      // Attacker exhausts attempts for victim's account from attacker IP
      for (let i = 0; i < 5; i++) {
        const failRes = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          headers: { 'x-forwarded-for': attackerIp },
          payload: { email: victimEmail, password: 'WrongPassword#999!' },
        });
        expect(failRes.statusCode).toBe(401);
      }

      // Attacker 6th attempt is rate-limited (429)
      const attackerBlocked = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { 'x-forwarded-for': attackerIp },
        payload: { email: victimEmail, password: 'WrongPassword#999!' },
      });
      expect(attackerBlocked.statusCode).toBe(429);

      // Victim attempts login with correct credentials from victim IP
      const victimLogin = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { 'x-forwarded-for': victimIp },
        payload: { email: victimEmail, password: correctPassword },
      });

      // Must succeed! Victim is not locked out by attacker's activity
      expect(victimLogin.statusCode).toBe(200);
      const victimBody = JSON.parse(victimLogin.body);
      expect(victimBody.user.email).toBe(victimEmail);
    });
  });

  describe('4. Token Purpose Separation & Replay Invariants', () => {
    it('verification token cannot reset a password', async () => {
      const email = `token.purpose.${Date.now()}@${collegeDomain}`;

      // Register student to get verification token
      const regRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email,
          password: 'Eventora#SecurePass2026!',
          displayName: 'Purpose Separation Test',
        },
      });

      expect(regRes.statusCode).toBe(201);
      const regBody = JSON.parse(regRes.body);
      const verificationToken = regBody.verificationToken;
      expect(verificationToken).toBeDefined();

      // Attempt to use verification token on /reset endpoint
      const resetRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/reset',
        payload: {
          token: verificationToken,
          newPassword: 'NewEventora#Pass2026!',
        },
      });

      expect(resetRes.statusCode).toBe(400);
      const resetBody = JSON.parse(resetRes.body);
      expect(resetBody.error?.code).toBe('INVALID_OR_EXPIRED_TOKEN');
    });

    it('reset token cannot verify an email', async () => {
      const email = `reset.as.verify.${Date.now()}@${collegeDomain}`;
      const hash = await hashPassword('Eventora#SecurePass2026!');

      await db.insert(users).values({
        collegeId,
        email,
        passwordHash: hash,
        displayName: 'Reset As Verify',
        globalRole: 'student',
        status: 'active',
        emailVerifiedAt: new Date(),
      });

      // Request forgot password to get reset token
      const forgotRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot',
        payload: { email },
      });

      expect(forgotRes.statusCode).toBe(200);
      const forgotBody = JSON.parse(forgotRes.body);
      const resetToken = forgotBody.resetToken;
      expect(resetToken).toBeDefined();

      // Attempt to use reset token on /verify-email endpoint
      const verifyRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/verify-email',
        payload: { token: resetToken },
      });

      expect(verifyRes.statusCode).toBe(400);
      const verifyBody = JSON.parse(verifyRes.body);
      expect(verifyBody.error?.code).toBe('INVALID_OR_EXPIRED_TOKEN');
    });

    it('double use of a verification token fails atomically', async () => {
      const email = `double.use.verify.${Date.now()}@${collegeDomain}`;

      const regRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: { 'x-forwarded-for': '10.99.1.1' },
        payload: {
          email,
          password: 'Eventora#SecurePass2026!',
          displayName: 'Double Use Verify',
        },
      });

      const regBody = JSON.parse(regRes.body);
      const verificationToken = regBody.verificationToken;

      // 1. First consumption succeeds
      const firstRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/verify-email',
        payload: { token: verificationToken },
      });
      expect(firstRes.statusCode).toBe(200);

      // 2. Second consumption fails
      const secondRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/verify-email',
        payload: { token: verificationToken },
      });
      expect(secondRes.statusCode).toBe(400);
      expect(JSON.parse(secondRes.body).error?.code).toBe('INVALID_OR_EXPIRED_TOKEN');
    });

    it('double use of a password reset token fails atomically and revokes all sessions on first use', async () => {
      const email = `double.use.reset.${Date.now()}@${collegeDomain}`;
      const hash = await hashPassword('Eventora#SecurePass2026!');

      const [user] = await db
        .insert(users)
        .values({
          collegeId,
          email,
          passwordHash: hash,
          displayName: 'Double Use Reset',
          globalRole: 'student',
          status: 'active',
          emailVerifiedAt: new Date(),
        })
        .returning();

      // Create an active session
      const { token: sessionToken } = await createSession(user.id);

      // Generate reset token
      const forgotRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/forgot',
        headers: { 'x-forwarded-for': '10.99.2.1' },
        payload: { email },
      });
      const resetToken = JSON.parse(forgotRes.body).resetToken;

      // 1. First reset succeeds
      const firstReset = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/reset',
        payload: {
          token: resetToken,
          newPassword: 'BrandNewEventora#2026!',
        },
      });
      expect(firstReset.statusCode).toBe(200);

      // Verify that all previous sessions were revoked
      const sessionAfterReset = await validateSession(sessionToken);
      expect(sessionAfterReset).toBeNull();

      // 2. Second reset attempt with same token fails
      const secondReset = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/reset',
        payload: {
          token: resetToken,
          newPassword: 'AnotherBrandNew#2026!',
        },
      });
      expect(secondReset.statusCode).toBe(400);
      expect(JSON.parse(secondReset.body).error?.code).toBe('INVALID_OR_EXPIRED_TOKEN');
    });

    it('resend-verification invalidates prior outstanding verification tokens', async () => {
      const email = `resend.invalidate.${Date.now()}@${collegeDomain}`;

      const regRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: { 'x-forwarded-for': '10.99.3.1' },
        payload: {
          email,
          password: 'Eventora#SecurePass2026!',
          displayName: 'Resend Invalidation Test',
        },
      });

      const token1 = JSON.parse(regRes.body).verificationToken;

      // Resend verification token
      const resendRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/resend-verification',
        headers: { 'x-forwarded-for': '10.99.3.1' },
        payload: { email },
      });

      expect(resendRes.statusCode).toBe(200);
      const token2 = JSON.parse(resendRes.body).verificationToken;
      expect(token2).toBeDefined();
      expect(token2).not.toBe(token1);

      // Prior token1 must now fail
      const tryToken1 = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/verify-email',
        payload: { token: token1 },
      });
      expect(tryToken1.statusCode).toBe(400);
      expect(JSON.parse(tryToken1.error || tryToken1.body).error?.code).toBe('INVALID_OR_EXPIRED_TOKEN');

      // New token2 must succeed
      const tryToken2 = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/verify-email',
        payload: { token: token2 },
      });
      expect(tryToken2.statusCode).toBe(200);
    });
  });

  describe('5. Sessions: Throttled last_seen_at & Device Management (/me/sessions)', () => {
    it('throttles last_seen_at writes to >= 60 seconds during active session validation', async () => {
      const email = `session.throttle.${Date.now()}@${collegeDomain}`;
      const hash = await hashPassword('Eventora#SecurePass2026!');

      const [user] = await db
        .insert(users)
        .values({
          collegeId,
          email,
          passwordHash: hash,
          displayName: 'Throttle Tester',
          globalRole: 'student',
          status: 'active',
          emailVerifiedAt: new Date(),
        })
        .returning();

      const { token: sessionToken } = await createSession(user.id);
      const val1 = await validateSession(sessionToken);
      expect(val1).not.toBeNull();
      const initialLastSeen = val1!.session.lastSeenAt.getTime();

      // Immediately validate again within 60s
      const val2 = await validateSession(sessionToken);
      expect(val2).not.toBeNull();
      // lastSeenAt must remain identical because write was throttled!
      expect(val2!.session.lastSeenAt.getTime()).toBe(initialLastSeen);
    });

    it('GET /me/sessions lists active devices and DELETE /me/sessions revokes devices', async () => {
      const email = `devices.${Date.now()}@${collegeDomain}`;
      const hash = await hashPassword('Eventora#SecurePass2026!');

      const [user] = await db
        .insert(users)
        .values({
          collegeId,
          email,
          passwordHash: hash,
          displayName: 'Device Manager',
          globalRole: 'student',
          status: 'active',
          emailVerifiedAt: new Date(),
        })
        .returning();

      // Create session 1 (current)
      const { token: token1 } = await createSession(user.id);
      // Create session 2 (another device)
      const { token: token2 } = await createSession(user.id);

      const csrfToken = 'test-csrf-token-devices';

      // 1. GET /api/v1/me/sessions
      const listRes = await app.inject({
        method: 'GET',
        url: '/api/v1/me/sessions',
        headers: {
          cookie: `eventora_session=${token1}; eventora_csrf=${csrfToken}`,
        },
      });

      expect(listRes.statusCode).toBe(200);
      const listBody = JSON.parse(listRes.body);
      expect(listBody.sessions).toHaveLength(2);
      expect(listBody.sessions.some((s: any) => s.isCurrent === true)).toBe(true);

      const otherSession = listBody.sessions.find((s: any) => !s.isCurrent);
      expect(otherSession).toBeDefined();

      // 2. DELETE /api/v1/me/sessions/:id (revoke device 2)
      const revokeTarget = await app.inject({
        method: 'DELETE',
        url: `/api/v1/me/sessions/${otherSession.id}`,
        headers: {
          cookie: `eventora_session=${token1}; eventora_csrf=${csrfToken}`,
          'x-csrf-token': csrfToken,
        },
      });

      expect(revokeTarget.statusCode).toBe(200);

      // Verify token2 is now rejected
      const valToken2 = await validateSession(token2);
      expect(valToken2).toBeNull();

      // Token 1 remains active
      const valToken1 = await validateSession(token1);
      expect(valToken1).not.toBeNull();

      // 3. DELETE /api/v1/me/sessions?all=true (revoke all)
      const revokeAll = await app.inject({
        method: 'DELETE',
        url: '/api/v1/me/sessions?all=true',
        headers: {
          cookie: `eventora_session=${token1}; eventora_csrf=${csrfToken}`,
          'x-csrf-token': csrfToken,
        },
      });
      expect(revokeAll.statusCode).toBe(200);

      const valToken1After = await validateSession(token1);
      expect(valToken1After).toBeNull();
    });

    it('privilege change via /admin/users/:id/role revokes active sessions for the user', async () => {
      // Create Admin
      const adminHash = await hashPassword('Admin#Secure2026!');
      const [admin] = await db
        .insert(users)
        .values({
          collegeId,
          email: `admin.escalate.${Date.now()}@${collegeDomain}`,
          passwordHash: adminHash,
          displayName: 'Admin User',
          globalRole: 'admin',
          status: 'active',
          emailVerifiedAt: new Date(),
        })
        .returning();

      // Create Student
      const studentHash = await hashPassword('Student#Secure2026!');
      const [student] = await db
        .insert(users)
        .values({
          collegeId,
          email: `student.promoted.${Date.now()}@${collegeDomain}`,
          passwordHash: studentHash,
          displayName: 'Promoted Student',
          globalRole: 'student',
          status: 'active',
          emailVerifiedAt: new Date(),
        })
        .returning();

      const { token: studentSession } = await createSession(student.id);
      const { token: adminSession } = await createSession(admin.id);
      const adminCsrf = 'admin-csrf-p02-test';

      // Admin updates student's role to 'reviewer'
      const roleUpdateRes = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/users/${student.id}/role`,
        headers: {
          cookie: `eventora_session=${adminSession}; eventora_csrf=${adminCsrf}`,
          'x-csrf-token': adminCsrf,
        },
        payload: { globalRole: 'reviewer' },
      });

      expect(roleUpdateRes.statusCode).toBe(200);

      // Student's old session must now be revoked due to privilege change
      const validatedStudent = await validateSession(studentSession);
      expect(validatedStudent).toBeNull();
    });
  });

  describe('6. CSRF Hardening: Double-Submit, Sec-Fetch-Site & Origin Policy', () => {
    let csrfUserId: string;

    beforeAll(async () => {
      const hash = await hashPassword('Eventora#SecurePass2026!');
      const [u] = await db
        .insert(users)
        .values({
          collegeId,
          email: `csrf.target.${Date.now()}@${collegeDomain}`,
          passwordHash: hash,
          displayName: 'CSRF Target User',
          globalRole: 'student',
          status: 'active',
          emailVerifiedAt: new Date(),
        })
        .returning();
      csrfUserId = u.id;
    });

    it('rejects cross-site request when Sec-Fetch-Site: cross-site', async () => {
      const { token: sess } = await createSession(csrfUserId);
      const csrf = 'valid-csrf-token';

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/me/preferences',
        headers: {
          cookie: `eventora_session=${sess}; eventora_csrf=${csrf}`,
          'x-csrf-token': csrf,
          'sec-fetch-site': 'cross-site',
        },
        payload: { theme: 'dark' },
      });

      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body);
      expect(body.error?.code).toBe('CSRF_FETCH_SITE_REJECTED');
    });

    it('rejects untrusted Origin header', async () => {
      const { token: sess } = await createSession(csrfUserId);
      const csrf = 'valid-csrf-token';

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/me/preferences',
        headers: {
          cookie: `eventora_session=${sess}; eventora_csrf=${csrf}`,
          'x-csrf-token': csrf,
          origin: 'https://evil-attacker-site.com',
        },
        payload: { theme: 'dark' },
      });

      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body);
      expect(body.error?.code).toBe('CSRF_ORIGIN_MISMATCH');
    });

    it('accepts request with Sec-Fetch-Site: same-origin and matching double-submit CSRF', async () => {
      const { token: sess } = await createSession(csrfUserId);
      const csrf = 'valid-double-submit-csrf';

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/me/preferences',
        headers: {
          cookie: `eventora_session=${sess}; eventora_csrf=${csrf}`,
          'x-csrf-token': csrf,
          'sec-fetch-site': 'same-origin',
        },
        payload: { theme: 'dark' },
      });

      expect(res.statusCode).toBe(200);
    });
  });
});
