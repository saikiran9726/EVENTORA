import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../packages/backend/src/app.js';
import { pool } from '../../packages/backend/src/db/index.js';
import { runExplainAnalyzeIndexReview } from '../../scripts/explain-analyze-indexes.js';
import { runRestoreRehearsal } from '../../scripts/restore-rehearsal.js';
import { maskEmail, REDACT_PATHS } from '../../packages/backend/src/logger.js';
import { FastifyInstance } from 'fastify';

describe('Phase 11 Quality Gate: Production Hardening, Monitoring, Security & Ops (NFR-SCALE, NFR-UPTIME, NFR-SEC)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // 1. GET /health
  it('1. GET /health returns 200 ok with uptime and timestamp without external deps', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
    expect(typeof body.uptime).toBe('number');
    expect(body.timestamp).toBeDefined();
  });

  // 2. GET /readiness
  it('2. GET /readiness verifies Postgres SELECT 1, Redis, migration version, and worker heartbeat', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/readiness',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ready');
    expect(body.checks.postgres.status).toBe('ok');
    expect(typeof body.checks.postgres.latencyMs).toBe('number');
    expect(body.checks.migration.status).toBe('ok');
    expect(body.checks.migration.version).toBeGreaterThanOrEqual(10);
    expect(body.checks.redis.status).toBe('ok');
    expect(body.checks.worker.status).toBe('ok');
  });

  // 3. GET /metrics (Prometheus Format & Network Boundary)
  it('3. GET /metrics exports Prometheus text format and enforces internal network isolation', async () => {
    // A: Local/internal request succeeds with Prometheus metrics
    const res = await app.inject({
      method: 'GET',
      url: '/metrics',
      remoteAddress: '127.0.0.1',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toContain('process_uptime_seconds');
    expect(res.body).toContain('process_memory_heap_bytes');
    expect(res.body).toContain('db_pool_total_connections');
    expect(res.body).toContain('outbox_pending_count');

    // B: External unauthorized IP is rejected with 403 FORBIDDEN
    const forbiddenRes = await app.inject({
      method: 'GET',
      url: '/metrics',
      remoteAddress: '203.0.113.195', // public IP
    });

    expect(forbiddenRes.statusCode).toBe(403);
    const errBody = JSON.parse(forbiddenRes.body);
    expect(errBody.error.code).toBe('FORBIDDEN_NETWORK');

    // C: External IP with internal token succeeds
    const tokenRes = await app.inject({
      method: 'GET',
      url: '/metrics',
      remoteAddress: '203.0.113.195',
      headers: {
        'x-metrics-token': 'internal-metrics-token-for-prometheus-scraper',
      },
    });
    expect(tokenRes.statusCode).toBe(200);
  });

  // 4. Security Headers (CSP, HSTS, MIME, Permissions)
  it('4. Enforces production security headers (CSP no inline scripts, HSTS, nosniff, camera self)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    expect(res.headers['strict-transport-security']).toContain('max-age=31536000');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(res.headers['permissions-policy']).toContain('camera=(self)');
  });

  // 5. Rate Limiting on Sensitive Routes
  it('5. Rate limiter throttles sensitive routes (brute-force login limiter) with 429 and Retry-After', async () => {
    const testIp = '198.51.100.99';

    // Send 5 rapid login attempts
    for (let i = 0; i < 5; i++) {
      const r = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: {
          'x-client-ip': testIp,
        },
        payload: { email: 'bruteforce@example.com', password: 'bad-password-123' },
      });
      // Should be 401 invalid credentials, not 429 yet
      expect(r.statusCode).toBe(401);
    }

    // 6th request must be rejected with 429
    const blockedRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: {
        'x-client-ip': testIp,
      },
      payload: { email: 'bruteforce@example.com', password: 'bad-password-123' },
    });

    expect(blockedRes.statusCode).toBe(429);
    const blockedBody = JSON.parse(blockedRes.body);
    expect(blockedBody.error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(blockedBody.error.message).toContain('Too many failed login attempts');
  });

  // 6. Structured Log Redaction & Email Masking
  it('6. Redaction list sanitizes authorization, secrets, passwords, and masks emails', () => {
    expect(REDACT_PATHS).toContain('req.headers.authorization');
    expect(REDACT_PATHS).toContain('req.headers.cookie');
    expect(REDACT_PATHS).toContain('body.password');
    expect(REDACT_PATHS).toContain('body.token');
    expect(REDACT_PATHS).toContain('body.qr');

    expect(maskEmail('aarav.patel@campus.edu')).toBe('a***l@campus.edu');
    expect(maskEmail('admin@eventora.edu')).toBe('a***n@eventora.edu');
  });

  // 7. EXPLAIN (ANALYZE, BUFFERS) Index Review
  it('7. EXPLAIN (ANALYZE, BUFFERS) completes across critical discovery, booking, scan, and analytics queries', async () => {
    const explainResults = await runExplainAnalyzeIndexReview();
    expect(explainResults.length).toBeGreaterThanOrEqual(5);

    for (const res of explainResults) {
      expect(res.plan.length).toBeGreaterThan(0);
      expect(res.executionTimeMs).toBeLessThan(1000); // Sub-second execution
    }
  });

  // 8. Restore Rehearsal & ops_runs Recording
  it('8. Disaster recovery rehearsal restores into scratch database and records RTO/RPO into ops_runs', async () => {
    const rehearsal = await runRestoreRehearsal();
    expect(rehearsal.smokePassed).toBe(true);
    expect(rehearsal.rtoSeconds).toBeLessThan(300); // Target RTO < 5 minutes
    expect(rehearsal.rpoSeconds).toBeLessThan(900); // Target RPO < 15 minutes
    expect(rehearsal.tablesVerified.events).toBeDefined();

    // Verify ops_runs has recorded the run
    const opsRes = await pool.query(`
      SELECT kind, outcome, evidence_ref 
      FROM ops_runs 
      WHERE kind = 'restore_rehearsal'
      ORDER BY started_at DESC 
      LIMIT 1;
    `);

    expect(opsRes.rows.length).toBe(1);
    expect(opsRes.rows[0].outcome).toBe('SUCCESS');
    expect(opsRes.rows[0].evidence_ref.checksum).toBeDefined();
  });
});
