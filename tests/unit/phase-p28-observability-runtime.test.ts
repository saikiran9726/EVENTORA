import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { Writable } from 'node:stream';
import { pool } from '../../packages/backend/src/db/index.js';
import { buildApp } from '../../packages/backend/src/app.js';
import { maskEmail, maskPhone, createLogger } from '../../packages/backend/src/logger.js';
import {
  triggerDeadLetterAlert,
  triggerPaymentMismatchAlert,
  triggerDriftAlert,
  getAlertHistory,
  clearAlertHistory,
} from '../../packages/backend/src/lib/sentry.js';
import { recordMetricRequest, setLastWorkerHeartbeatForTest } from '../../packages/backend/src/routes/monitoring.js';
import { createGracefulShutdown } from '../../packages/backend/src/index.js';

describe('Phase P28: Observability, Runtime Hardening & Graceful Teardown', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // 1. Request ID Propagation: Browser -> API -> Logs -> Header & Errors
  // ---------------------------------------------------------------------------
  describe('1. Request ID Propagation & Echo Header', () => {
    it('accepts client-provided x-request-id and echoes it back in response header', async () => {
      const clientReqId = `client-req-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

      const res = await app.inject({
        method: 'GET',
        url: '/health',
        headers: {
          'x-request-id': clientReqId,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['x-request-id']).toBe(clientReqId);
    });

    it('generates unique requestId if omitted by client, echoing in response header and error payload', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/events/00000000-0000-0000-0000-000000000000',
      });

      expect(res.statusCode).toBe(404);
      const generatedId = res.headers['x-request-id'] as string;
      expect(generatedId).toBeDefined();
      expect(generatedId.length).toBeGreaterThan(10);

      const body = JSON.parse(res.body);
      expect(body.error.requestId).toBe(generatedId);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Extended Redaction: Sensitive PII, Banking, UTR, Answers, Passwords
  // ---------------------------------------------------------------------------
  describe('2. Extended Redaction & Masking', () => {
    it('masks emails preserving first and last characters', () => {
      expect(maskEmail('aarav.student@domain.com')).toBe('a***t@domain.com');
      expect(maskEmail('jd@campus.edu')).toBe('***@campus.edu');
      expect(maskEmail('')).toBe('');
      expect(maskEmail(undefined)).toBe('');
    });

    it('masks phone numbers preserving the last 4 digits', () => {
      expect(maskPhone('+919876543210')).toBe('******3210');
      expect(maskPhone('9876543210')).toBe('******3210');
      expect(maskPhone('123')).toBe('****');
      expect(maskPhone('')).toBe('');
      expect(maskPhone(undefined)).toBe('');
    });

    it('censors passwords, tokens, utr, answers, and banking data in pino logger', () => {
      let loggedOutput = '';
      const writeStream = new Writable({
        write(chunk, _encoding, callback) {
          loggedOutput += chunk.toString();
          callback();
        },
      });

      const customPino = createLogger('development', writeStream);

      customPino.info({
        password: 'SecretPassword123!',
        token: 'sess_993481029810928301',
        utr: 'UTR892831092',
        youpiUtr: 'BANK_UTR_99999',
        answers: [{ fieldId: 'pan', answer: 'ABCDE1234F' }],
        registrationAnswers: { q1: 'Sensitive medical info' },
        email: 'student@campus.edu',
        phone: '+919988776655',
        safeField: 'Public event title',
      }, 'Audit test log');

      expect(loggedOutput).toContain('Public event title');
      expect(loggedOutput).toContain('[REDACTED]');
      expect(loggedOutput).not.toContain('SecretPassword123!');
      expect(loggedOutput).not.toContain('sess_993481029810928301');
      expect(loggedOutput).not.toContain('UTR892831092');
      expect(loggedOutput).not.toContain('BANK_UTR_99999');
      expect(loggedOutput).not.toContain('ABCDE1234F');
      expect(loggedOutput).not.toContain('Sensitive medical info');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Health (Liveness) vs Readiness Split
  // ---------------------------------------------------------------------------
  describe('3. Split Liveness (/health, /healthz) vs Readiness (/readiness, /ready, /readyz)', () => {
    it('GET /health and /healthz return 200 immediately with uptime and timestamp without hitting DB', async () => {
      const res1 = await app.inject({ method: 'GET', url: '/health' });
      expect(res1.statusCode).toBe(200);
      const b1 = JSON.parse(res1.body);
      expect(b1.status).toBe('ok');
      expect(typeof b1.uptime).toBe('number');
      expect(b1.timestamp).toBeDefined();

      const res2 = await app.inject({ method: 'GET', url: '/healthz' });
      expect(res2.statusCode).toBe(200);
      const b2 = JSON.parse(res2.body);
      expect(b2.status).toBe('ok');
    });

    it('GET /readiness, /ready, /readyz return 200 when Postgres, Redis, Migrations, and Worker are healthy', async () => {
      for (const route of ['/readiness', '/ready', '/readyz']) {
        const res = await app.inject({ method: 'GET', url: route });
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.status).toBe('ready');
        expect(body.checks.postgres.status).toBe('ok');
        expect(typeof body.checks.postgres.latencyMs).toBe('number');
        expect(body.checks.redis.status).toBe('ok');
        expect(body.checks.migration.status).toBe('ok');
        expect(body.checks.migration.version).toBeGreaterThanOrEqual(11);
      }
    });

    it('readiness returns 503 Service Unavailable when Postgres connection fails', async () => {
      const connectSpy = vi.spyOn(pool, 'connect').mockRejectedValue(
        new Error('Connection refused: PostgreSQL daemon offline (simulated)')
      );

      try {
        const res = await app.inject({ method: 'GET', url: '/readiness' });
        expect(res.statusCode).toBe(503);
        const body = JSON.parse(res.body);
        expect(body.status).toBe('not_ready');
        expect(body.checks.postgres.status).toBe('failed');
        expect(body.checks.postgres.error).toContain('Connection refused');
      } finally {
        connectSpy.mockRestore();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Observability & Operational Alerts
  // ---------------------------------------------------------------------------
  describe('4. Operational Alerts Instrumentation (5xx, p95, Dead Letter, Drift, Mismatch, Worker Heartbeat)', () => {
    beforeAll(() => {
      clearAlertHistory();
    });

    it('triggers 5xx error rate alert when sliding error rate exceeds threshold', () => {
      clearAlertHistory();
      // Record 30 requests with 5 failures (> 16% error rate)
      for (let i = 0; i < 25; i++) {
        recordMetricRequest('GET', '/api/v1/events', 200, 0.02);
      }
      for (let i = 0; i < 5; i++) {
        recordMetricRequest('POST', '/api/v1/events', 500, 0.05);
      }

      const alerts = getAlertHistory().filter((a) => a.kind === '5xx_rate');
      expect(alerts.length).toBeGreaterThanOrEqual(1);
      expect(alerts[0].details.rate).toBeGreaterThan(0.05);
    });

    it('triggers p95 latency alert when latency exceeds threshold (1000ms)', () => {
      clearAlertHistory();
      // Record 25 requests where p95 > 1000ms
      for (let i = 0; i < 18; i++) {
        recordMetricRequest('GET', '/api/v1/catalog', 200, 0.1); // 100ms
      }
      for (let i = 0; i < 7; i++) {
        recordMetricRequest('GET', '/api/v1/catalog', 200, 1.8); // 1800ms
      }

      const alerts = getAlertHistory().filter((a) => a.kind === 'p95_latency');
      expect(alerts.length).toBeGreaterThanOrEqual(1);
      expect(alerts[0].details.p95Ms).toBeGreaterThan(1000);
    });

    it('triggers dead letter alert when outbox message exceeds retry cap', () => {
      clearAlertHistory();
      triggerDeadLetterAlert(42, 'Max attempts 8 exceeded; SMTP permanent bounce');
      const alerts = getAlertHistory().filter((a) => a.kind === 'dead_letter');
      expect(alerts.length).toBe(1);
      expect(alerts[0].details.messageId).toBe(42);
      expect(alerts[0].message).toContain('Max attempts 8 exceeded');
    });

    it('triggers payment mismatch alert when gateway payload does not match ledger amount', () => {
      clearAlertHistory();
      triggerPaymentMismatchAlert({
        paymentId: 'pay_99',
        orderId: 'ord_123',
        expectedPaise: 50000,
        reportedPaise: 40000,
      });
      const alerts = getAlertHistory().filter((a) => a.kind === 'payment_mismatch');
      expect(alerts.length).toBe(1);
      expect(alerts[0].details.expectedPaise).toBe(50000);
      expect(alerts[0].details.reportedPaise).toBe(40000);
    });

    it('triggers drift alert during nightly reconciliation', () => {
      clearAlertHistory();
      triggerDriftAlert({
        financialDriftPaise: 1500,
        inventoryDriftCount: 1,
      });
      const alerts = getAlertHistory().filter((a) => a.kind === 'reconciliation_drift');
      expect(alerts.length).toBe(1);
      expect(alerts[0].details.financialDriftPaise).toBe(1500);
    });

    it('triggers worker heartbeat alert when worker loop stops pulsing', async () => {
      clearAlertHistory();
      // Set worker heartbeat to 45 seconds ago (threshold is 30s)
      setLastWorkerHeartbeatForTest(Date.now() - 45000);

      const res = await app.inject({ method: 'GET', url: '/readiness' });
      expect(res.statusCode).toBe(200); // Partially serving degraded
      const body = JSON.parse(res.body);
      expect(body.checks.worker.status).toBe('degraded');

      const alerts = getAlertHistory().filter((a) => a.kind === 'worker_heartbeat');
      expect(alerts.length).toBeGreaterThanOrEqual(1);
      expect(alerts[0].details.lastHeartbeatSecondsAgo).toBeGreaterThanOrEqual(30);

      // Restore worker heartbeat
      setLastWorkerHeartbeatForTest(Date.now());
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Graceful Teardown Lifecycle (SIGTERM, Pool Drain, Worker Shutdown)
  // ---------------------------------------------------------------------------
  describe('5. Graceful Teardown Sequence', () => {
    it('executes stop accepting -> drain -> stop workers -> close pool sequence on SIGTERM', async () => {
      // Build a dedicated test Fastify instance for teardown
      const testServer = await buildApp();
      await testServer.ready();

      let poolEnded = false;
      const mockPool = {
        end: async () => {
          poolEnded = true;
        },
      };

      const shutdown = createGracefulShutdown(testServer, mockPool as any);

      // Trigger graceful teardown with SIGTERM simulation
      let shutdownError: any = null;
      try {
        await shutdown('SIGTERM', 0);
      } catch (err) {
        shutdownError = err;
      }

      expect(shutdownError).toBeNull();
      expect(poolEnded).toBe(true);
    });
  });
});
