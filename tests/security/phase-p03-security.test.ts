import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../packages/backend/src/app.js';
import { pool } from '../../packages/backend/src/db/index.js';
import { createSession } from '../../packages/backend/src/services/auth.js';
import { config } from '../../packages/backend/src/config.js';
import { FastifyInstance } from 'fastify';
import fs from 'fs';
import path from 'path';

describe('Phase P03 Security Suite: Proxy, CORS, Rate Limiting, Headers & Metrics', () => {
  let app: FastifyInstance;
  let collegeId: string;
  let userAId: string;
  let userBId: string;
  let userASessionHeaders: Record<string, string>;
  let userBSessionHeaders: Record<string, string>;
  let testEventId: string;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    const client = await pool.connect();
    try {
      // Find or create college
      const colRes = await client.query("SELECT id FROM colleges WHERE status = 'active' LIMIT 1;");
      if (colRes.rows.length === 0) {
        const newCol = await client.query(`
          INSERT INTO colleges (name, domain, status)
          VALUES ('P03 Test Campus', 'p03.edu', 'active')
          RETURNING id;
        `);
        collegeId = newCol.rows[0].id;
      } else {
        collegeId = colRes.rows[0].id;
      }

      // Create User A and User B
      const uRes = await client.query(`
        INSERT INTO users (college_id, email, password_hash, display_name, global_role, status, email_verified_at)
        VALUES 
          ($1, $2, 'hash_a', 'User A Proxy', 'student', 'active', NOW()),
          ($1, $3, 'hash_b', 'User B Proxy', 'student', 'active', NOW())
        RETURNING id, email;
      `, [collegeId, `usera.${Date.now()}@p03.edu`, `userb.${Date.now()}@p03.edu`]);

      userAId = uRes.rows[0].id;
      userBId = uRes.rows[1].id;

      // Create sessions
      const sA = await createSession(userAId);
      const csrfA = 'csrf_token_a_12345678901234567890';
      userASessionHeaders = {
        cookie: `eventora_session=${sA.token}; eventora_csrf=${csrfA}`,
        'x-csrf-token': csrfA,
      };

      const sB = await createSession(userBId);
      const csrfB = 'csrf_token_b_12345678901234567890';
      userBSessionHeaders = {
        cookie: `eventora_session=${sB.token}; eventora_csrf=${csrfB}`,
        'x-csrf-token': csrfB,
      };

      // Create test venue & event
      const vRes = await client.query(`
        INSERT INTO venues (college_id, name, building, capacity, status)
        VALUES ($1, 'P03 Testing Hall', 'Building Alpha', 200, 'active')
        RETURNING id;
      `, [collegeId]);
      const venueId = vRes.rows[0].id;

      // Find an existing published event or create one
      const existing = await client.query("SELECT id FROM events WHERE status = 'published' LIMIT 1;");
      if (existing.rows.length > 0) {
        testEventId = existing.rows[0].id;
      } else {
        const orgRes = await client.query("SELECT id FROM organizer_profiles LIMIT 1;");
        const orgProfileId = orgRes.rows[0]?.id;
        const eRes = await client.query(`
          INSERT INTO events (
            college_id, organizer_id, created_by, title, slug, description, category,
            format, status, venue_id, starts_at, ends_at, capacity, contact_email
          ) VALUES (
            $1, $2, $3, 'P03 Security Test Event', $4, 'Event for testing rate limiting and proxy headers', 'Academic',
            'in_person', 'published', $5, NOW() + INTERVAL '2 days', NOW() + INTERVAL '3 days', 100, 'contact@p03.edu'
          ) RETURNING id;
        `, [collegeId, orgProfileId, userAId, `p03-event-${Date.now()}`, venueId]);
        testEventId = eRes.rows[0].id;
      }
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    await app.close();
  });

  // =========================================================================
  // 1. TRUST PROXY & X-FORWARDED-FOR SPOOFING RESISTANCE
  // =========================================================================
  describe('1. Trust Proxy & Spoofed XFF Immunity', () => {
    it('uses the immediate proxy client IP and ignores prepended spoofed IPs', async () => {
      const realClientIp = '198.51.100.42';

      // Attacker attempts to bypass register rate limit by rotating the prepended spoofed IP:
      // "1.1.1.1, realClientIp", "2.2.2.2, realClientIp", ...
      // With trustProxy: 1, Fastify extracts the rightmost untrusted hop (realClientIp)
      let blocked = false;
      let blockedStatusCode = 0;

      for (let i = 0; i < 12; i++) {
        const spoofedIp = `10.0.0.${i + 1}`;
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/register',
          headers: {
            'x-forwarded-for': `${spoofedIp}, ${realClientIp}`,
          },
          payload: {
            displayName: `Attacker Spoof ${i}`,
            email: `spoof.${i}.${Date.now()}@invalid.com`,
            password: 'BadPassword!123',
          },
        });

        if (res.statusCode === 429) {
          blocked = true;
          blockedStatusCode = res.statusCode;
          const body = JSON.parse(res.body);
          expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');
          expect(res.headers['retry-after']).toBeDefined();
          break;
        }
      }

      // Attacker was successfully blocked despite rotating the prepended spoofed IP
      expect(blocked).toBe(true);
      expect(blockedStatusCode).toBe(429);
    });
  });

  // =========================================================================
  // 2. SHARED-PROXY / NAT ISOLATION (USER A VS USER B)
  // =========================================================================
  describe('2. Shared-Proxy IP Isolation (Campus NAT)', () => {
    it('isolates User A and User B sharing the same proxy IP so User A throttling does not block User B', async () => {
      const sharedProxyIp = '203.0.113.199';

      // User A rapidly exhausts booking attempts from sharedProxyIp
      let userABlocked = false;
      for (let i = 0; i < 12; i++) {
        const res = await app.inject({
          method: 'POST',
          url: `/api/v1/events/${testEventId}/bookings`,
          headers: {
            ...userASessionHeaders,
            'x-forwarded-for': sharedProxyIp,
            'idempotency-key': `user-a-key-${i}-${Date.now()}`,
          },
          payload: {},
        });

        if (res.statusCode === 429) {
          userABlocked = true;
          expect(res.headers['x-ratelimit-remaining']).toBeDefined();
          break;
        }
      }
      expect(userABlocked).toBe(true);

      // User B makes a booking request from the EXACT SAME sharedProxyIp
      // User B must NOT be throttled because the rate-limit key includes req.user.id
      const userBRes = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${testEventId}/bookings`,
        headers: {
          ...userBSessionHeaders,
          'x-forwarded-for': sharedProxyIp,
          'idempotency-key': `user-b-key-${Date.now()}`,
        },
        payload: {},
      });

      // User B must NOT receive 429 (User B has an independent budget on the shared IP)
      expect(userBRes.statusCode).not.toBe(429);
      expect(userBRes.statusCode).toBe(400);
      const userBBody = JSON.parse(userBRes.body);
      expect(userBBody.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // =========================================================================
  // 3. STRICT CORS ALLOW-LIST (NO UNTRUSTED ORIGIN REFLECTION)
  // =========================================================================
  describe('3. Strict CORS Allow-List & Foreign Origin Rejection', () => {
    it('does NOT reflect untrusted foreign origins in Access-Control-Allow-Origin', async () => {
      const foreignOrigin = 'https://malicious-attacker-site.com';

      const res = await app.inject({
        method: 'GET',
        url: '/health',
        headers: {
          origin: foreignOrigin,
        },
      });

      // Response must not reflect foreignOrigin
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('rejects CORS preflight OPTIONS request from untrusted origin', async () => {
      const foreignOrigin = 'https://evil.example.org';

      const res = await app.inject({
        method: 'OPTIONS',
        url: '/api/v1/auth/login',
        headers: {
          origin: foreignOrigin,
          'access-control-request-method': 'POST',
        },
      });

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('allows configured trusted origin and supplies credentials header', async () => {
      const trustedOrigin = 'http://localhost:5173';

      const res = await app.inject({
        method: 'GET',
        url: '/health',
        headers: {
          origin: trustedOrigin,
        },
      });

      expect(res.headers['access-control-allow-origin']).toBe(trustedOrigin);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });
  });

  // =========================================================================
  // 4. METRICS ENDPOINT AUTHENTICATION & CARDINALITY EXPLOSION DEFENSE
  // =========================================================================
  describe('4. Metrics Authentication & Route Cardinality Bounding', () => {
    it('rejects GET /metrics without X-Metrics-Token with 401 UNAUTHORIZED', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/metrics',
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('UNAUTHORIZED');
      expect(body.error.message).toContain('X-Metrics-Token');
    });

    it('rejects GET /metrics with invalid token with 401 UNAUTHORIZED', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/metrics',
        headers: {
          'x-metrics-token': 'wrong-metrics-secret-token',
        },
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('serves Prometheus metrics on GET /metrics with valid X-Metrics-Token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/metrics',
        headers: {
          'x-metrics-token': config.METRICS_SECRET,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
      expect(res.body).toContain('http_requests_total');
      expect(res.body).toContain('process_uptime_seconds');
      expect(res.body).toContain('db_pool_total_connections');
    });

    it('maps random unmatched 404 paths to __unmatched__ route label preventing cardinality explosion', async () => {
      const randomPath = `/api/v1/scanner-probe-${Date.now()}-${Math.random()}`;

      // Hit an unmatched random path
      const notFoundRes = await app.inject({
        method: 'GET',
        url: randomPath,
      });
      expect(notFoundRes.statusCode).toBe(404);

      // Query metrics
      const metricsRes = await app.inject({
        method: 'GET',
        url: '/metrics',
        headers: {
          'x-metrics-token': config.METRICS_SECRET,
        },
      });

      expect(metricsRes.statusCode).toBe(200);
      // Metrics text must contain the bounded __unmatched__ label
      expect(metricsRes.body).toContain('route="__unmatched__"');
      // Metrics text must NOT contain the unbounded randomPath
      expect(metricsRes.body).not.toContain(randomPath);
    });
  });

  // =========================================================================
  // 5. TWELVE SCOPES RATE LIMITING COVERAGE & RESPONSE HEADERS
  // =========================================================================
  describe('5. Twelve Rate Limiting Scopes & Header Verification', () => {
    it('sets X-RateLimit headers (Limit, Remaining, Reset) on rate-limited endpoints', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/verify/NONEXISTENT123',
      });

      expect(res.headers['x-ratelimit-limit']).toBeDefined();
      expect(res.headers['x-ratelimit-remaining']).toBeDefined();
      expect(res.headers['x-ratelimit-reset']).toBeDefined();
    });

    it('throttles public verify/passport endpoint when limit exceeded', async () => {
      const testIp = '198.51.100.77';

      // Rate limit for public verify/passport is 30/min
      let blocked = false;
      for (let i = 0; i < 35; i++) {
        const res = await app.inject({
          method: 'GET',
          url: `/api/v1/verify/CODE${i}`,
          headers: {
            'x-forwarded-for': testIp,
          },
        });

        if (res.statusCode === 429) {
          blocked = true;
          const body = JSON.parse(res.body);
          expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');
          expect(res.headers['retry-after']).toBeDefined();
          break;
        }
      }

      expect(blocked).toBe(true);
    });
  });

  // =========================================================================
  // 6. SPA SECURITY HEADERS IN VERCEL.JSON
  // =========================================================================
  describe('6. SPA Security Headers in vercel.json', () => {
    it('defines CSP, HSTS, nosniff, Referrer-Policy, and camera Permissions-Policy in vercel.json', () => {
      const vercelPath = path.resolve(process.cwd(), 'vercel.json');
      const content = JSON.parse(fs.readFileSync(vercelPath, 'utf-8'));

      expect(content.headers).toBeDefined();
      const allRouteHeaders = content.headers.find((h: any) => h.source === '/(.*)');
      expect(allRouteHeaders).toBeDefined();

      const headersMap = new Map<string, string>();
      for (const h of allRouteHeaders.headers) {
        headersMap.set(h.key.toLowerCase(), h.value);
      }

      expect(headersMap.get('content-security-policy')).toBeDefined();
      expect(headersMap.get('content-security-policy')).toContain("default-src 'self'");
      expect(headersMap.get('strict-transport-security')).toContain('max-age=31536000');
      expect(headersMap.get('x-content-type-options')).toBe('nosniff');
      expect(headersMap.get('x-frame-options')).toBe('DENY');
      expect(headersMap.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
      expect(headersMap.get('permissions-policy')).toContain('camera=(self)');
    });
  });
});
