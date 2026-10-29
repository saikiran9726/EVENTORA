import { describe, it, expect, beforeAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../packages/backend/src/app.js';
import { pool } from '../../packages/backend/src/db/index.js';
import crypto from 'crypto';

describe('Phase P32: Security Suite & Zero-PII Snapshots on Public Endpoints', () => {
  let app: FastifyInstance;
  let collegeId: string;
  let publicEventSlug: string;
  let publicEventId: string;
  let publicPassportSlug: string;
  let publicCertCode: string;

  const FORBIDDEN_PII_KEYS = [
    'password',
    'password_hash',
    'passwordHash',
    'roll_number',
    'rollNumber',
    'session_token',
    'sessionToken',
    'payment_secret',
    'secret',
    'webhook_secret',
    'qr_token_hash',
    'claim_token_hash',
  ];

  function assertZeroPiiLeaks(obj: any, path = ''): void {
    if (!obj || typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
      obj.forEach((item, index) => assertZeroPiiLeaks(item, `${path}[${index}]`));
      return;
    }

    for (const [key, value] of Object.entries(obj)) {
      const currentPath = path ? `${path}.${key}` : key;

      // Fail if any prohibited PII key is present
      const lowerKey = key.toLowerCase();
      for (const forbidden of FORBIDDEN_PII_KEYS) {
        if (lowerKey === forbidden.toLowerCase()) {
          throw new Error(`PII Leak Detected! Key "${currentPath}" found in public response.`);
        }
      }

      // Check values for raw password hashes (argon2 / bcrypt)
      if (typeof value === 'string') {
        if (value.startsWith('$argon2') || value.startsWith('$2b$')) {
          throw new Error(`Password Hash Leak Detected at "${currentPath}"!`);
        }
      }

      assertZeroPiiLeaks(value, currentPath);
    }
  }

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    const client = await pool.connect();
    try {
      const cRes = await client.query('SELECT id FROM colleges LIMIT 1;');
      if (cRes.rows.length > 0) {
        collegeId = cRes.rows[0].id;
      } else {
        const nc = await client.query(
          `INSERT INTO colleges (name, domain) VALUES ('Security Tech', 'sec.edu') RETURNING id;`
        );
        collegeId = nc.rows[0].id;
      }

      // Organizer
      const orgUser = await client.query(
        `INSERT INTO users (college_id, email, password_hash, display_name, global_role, status)
         VALUES ($1, $2, 'hash', 'Sec Organizer', 'student', 'active')
         RETURNING id;`,
        [collegeId, `sec.org.${Date.now()}@sec.edu`]
      );

      const orgRes = await client.query(
        `INSERT INTO organizer_profiles (college_id, display_name, status, created_by)
         VALUES ($1, 'Security Club', 'verified', $2)
         RETURNING id;`,
        [collegeId, orgUser.rows[0].id]
      );
      const orgId = orgRes.rows[0].id;

      // Public Event
      publicEventSlug = `sec-pub-${Date.now()}`;
      const evRes = await client.query(
        `INSERT INTO events (
           organizer_id, college_id, title, slug, description, category, department, format,
           starts_at, ends_at, capacity, visibility, status, contact_email, created_by, team_mode,
           registration_opens_at, registration_closes_at
         ) VALUES (
           $1, $2, 'Public Security Expo', $3, 'Open to all students', 'technical', 'CSE', 'in_person',
           NOW() + INTERVAL '3 days', NOW() + INTERVAL '4 days', 200, 'public', 'published', 'sec@sec.edu', $4, 'none',
           NOW() - INTERVAL '1 day', NOW() + INTERVAL '2 days'
         ) RETURNING id;`,
        [orgId, collegeId, publicEventSlug, orgUser.rows[0].id]
      );
      publicEventId = evRes.rows[0].id;

      await client.query(
        `INSERT INTO ticket_types (event_id, name, price_paise, capacity, sold, held, per_user_limit)
         VALUES ($1, 'General Pass', 0, 200, 0, 0, 2);`,
        [publicEventId]
      );

      // Student with Public Passport
      const passportSlugVal = `sec-student-${Date.now()}`;
      publicPassportSlug = passportSlugVal;
      const stuUser = await client.query(
        `INSERT INTO users (college_id, email, password_hash, display_name, global_role, status)
         VALUES ($1, $2, 'hash', 'Privacy Student', 'student', 'active')
         RETURNING id;`,
        [collegeId, `privacy.student.${Date.now()}@sec.edu`]
      );

      await client.query(
        `INSERT INTO passport_settings (user_id, is_public, slug)
         VALUES ($1, true, $2);`,
        [stuUser.rows[0].id, passportSlugVal]
      );

      // Public Certificate
      publicCertCode = `SEC-CERT-${Date.now()}`;
      await client.query(
        `INSERT INTO certificates (user_id, event_id, verification_code, hash)
         VALUES ($1, $2, $3, $4);`,
        [stuUser.rows[0].id, publicEventId, publicCertCode, crypto.randomBytes(32)]
      );
    } finally {
      client.release();
    }
  });

  describe('1. Zero-PII Snapshots Across All Public Endpoints', () => {
    it('GET /api/v1/events (Discovery Catalog) contains zero PII leaks', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/events' });
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.items).toBeDefined();
      expect(json.items.length).toBeGreaterThan(0);
      assertZeroPiiLeaks(json);
    });

    it('GET /api/v1/events/:slug (Event Details) contains zero PII leaks', async () => {
      const res = await app.inject({ method: 'GET', url: `/api/v1/events/${publicEventSlug}` });
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.event).toBeDefined();
      assertZeroPiiLeaks(json);
    });

    it('GET /api/v1/calendar contains zero PII leaks', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/calendar' });
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      assertZeroPiiLeaks(json);
    });

    it('GET /api/v1/venues contains zero PII leaks', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/venues' });
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      assertZeroPiiLeaks(json);
    });

    it('GET /api/v1/events/:id/ratings contains zero PII leaks', async () => {
      const res = await app.inject({ method: 'GET', url: `/api/v1/events/${publicEventId}/ratings` });
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      assertZeroPiiLeaks(json);
    });

    it('GET /api/v1/p/:slug (Public Student Passport) contains zero PII leaks', async () => {
      const res = await app.inject({ method: 'GET', url: `/api/v1/p/${publicPassportSlug}` });
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      assertZeroPiiLeaks(json);
    });

    it('GET /api/v1/verify/:code (Public Certificate Lookup) contains zero PII leaks', async () => {
      const res = await app.inject({ method: 'GET', url: `/api/v1/verify/${publicCertCode}` });
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      assertZeroPiiLeaks(json);
    });

    it('GET /openapi.json contains zero PII or secret credentials', async () => {
      const res = await app.inject({ method: 'GET', url: '/openapi.json' });
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      assertZeroPiiLeaks(json);
    });
  });

  describe('2. Hardened Security Headers', () => {
    it('enforces nosniff, DENY frame options, strict referrer, and content security policy', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/events' });
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(res.headers['content-security-policy']).toBeDefined();
    });
  });

  describe('3. CSRF Protection & IDOR Boundaries', () => {
    it('rejects mutating authenticated request when CSRF token is missing', async () => {
      const sessionToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(sessionToken).digest();

      // Create session in db
      const client = await pool.connect();
      try {
        const u = await client.query('SELECT id FROM users LIMIT 1;');
        await client.query(
          `INSERT INTO sessions (id_hash, user_id, expires_at)
           VALUES ($1, $2, NOW() + INTERVAL '1 hour');`,
          [tokenHash, u.rows[0].id]
        );
      } finally {
        client.release();
      }

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/me/preferences',
        cookies: {
          eventora_session: sessionToken,
          // Missing eventora_csrf cookie and missing x-csrf-token header
        },
        payload: { theme: 'dark' },
      });

      // Must be rejected with 403 Forbidden
      expect(res.statusCode).toBe(403);
    });
  });
});
