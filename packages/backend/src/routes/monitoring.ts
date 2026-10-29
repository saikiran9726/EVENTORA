import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { pool } from '../db/index.js';
import { config } from '../config.js';
import { constantTimeCompare } from '../services/auth.js';
import { getRedisClient } from '../services/redis.js';
import {
  trigger5xxAlert,
  triggerP95Alert,
  triggerWorkerHeartbeatAlert,
} from '../lib/sentry.js';

// In-memory Prometheus metric counters for runtime aggregation
const metricsStore = {
  requestCounts: new Map<string, number>(),
  requestDurations: new Map<string, number[]>(),
  totalRequestsWindow: 0,
  serverErrorsWindow: 0,
  windowStartedAt: Date.now(),
  startTime: Date.now(),
};

export function recordMetricRequest(method: string, route: string, status: number, durationSec: number) {
  const key = `${method}:${route}:${status}`;
  metricsStore.requestCounts.set(key, (metricsStore.requestCounts.get(key) || 0) + 1);

  const durKey = `${method}:${route}`;
  const list = metricsStore.requestDurations.get(durKey) || [];
  if (list.length >= 1000) list.shift();
  list.push(durationSec);
  metricsStore.requestDurations.set(durKey, list);

  // 1. Sliding window 5xx rate calculation & alerting
  const now = Date.now();
  if (now - metricsStore.windowStartedAt > 300000) {
    // Reset window every 5 minutes
    metricsStore.totalRequestsWindow = 0;
    metricsStore.serverErrorsWindow = 0;
    metricsStore.windowStartedAt = now;
  }
  metricsStore.totalRequestsWindow++;
  if (status >= 500) {
    metricsStore.serverErrorsWindow++;
  }

  if (metricsStore.totalRequestsWindow >= 20) {
    const errorRate = metricsStore.serverErrorsWindow / metricsStore.totalRequestsWindow;
    if (errorRate > 0.05) {
      trigger5xxAlert(errorRate, 300);
    }
  }

  // 2. p95 latency check
  if (list.length >= 20) {
    const sorted = [...list].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const p95Ms = p95 * 1000;
    if (p95Ms > 1000) {
      triggerP95Alert(p95Ms, 1000);
    }
  }
}

// In-memory worker heartbeat record (updated by outbox dispatcher)
let lastWorkerHeartbeat = Date.now();

export function recordWorkerHeartbeat() {
  lastWorkerHeartbeat = Date.now();
}

export function getLastWorkerHeartbeat(): number {
  return lastWorkerHeartbeat;
}

export function setLastWorkerHeartbeatForTest(timestamp: number) {
  lastWorkerHeartbeat = timestamp;
}

export const monitoringRoutes: FastifyPluginAsync = async (fastify) => {
  // 1. GET /health & /healthz (Liveness check: process alive, zero external dependencies)
  const livenessHandler = async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.code(200).send({
      status: 'ok',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  };

  fastify.get('/health', { config: { auth: false, policy: 'public', objectCheck: false } }, livenessHandler);
  fastify.get('/healthz', { config: { auth: false, policy: 'public', objectCheck: false } }, livenessHandler);

  // 2. GET /readiness, /ready, /readyz (Deep check: Postgres SELECT 1, Redis PING, Migrations, Worker heartbeat)
  const readinessHandler = async (_req: FastifyRequest, reply: FastifyReply) => {
    const checks: Record<string, any> = {};
    let isReady = true;

    // Check A: Postgres SELECT 1
    const pgStart = Date.now();
    try {
      const client = await Promise.race([
        pool.connect(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Postgres connection timeout (3s)')), 3000)
        ),
      ]);
      try {
        await Promise.race([
          client.query('SELECT 1 as alive;'),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Postgres query timeout (3s)')), 3000)
          ),
        ]);
        checks.postgres = {
          status: 'ok',
          latencyMs: Date.now() - pgStart,
        };
      } finally {
        client.release();
      }
    } catch (err: any) {
      isReady = false;
      checks.postgres = {
        status: 'failed',
        error: err.message,
      };
    }

    // Check B: Schema Migration Version
    if (checks.postgres?.status === 'ok') {
      try {
        const migRes = await pool.query<{ current_version: number | null }>(
          'SELECT MAX(version) as current_version FROM schema_migrations;'
        );
        const version = migRes.rows[0]?.current_version || 0;
        checks.migration = {
          status: version >= 11 ? 'ok' : 'pending',
          version,
        };
        if (version < 11) isReady = false;
      } catch (err: any) {
        isReady = false;
        checks.migration = {
          status: 'failed',
          version: 0,
          error: err.message || 'schema_migrations relation does not exist',
        };
      }
    } else {
      checks.migration = {
        status: 'skipped',
        error: 'Database offline',
      };
    }

    // Check C: Redis / Queue connection
    try {
      const redis = getRedisClient();
      const pingResult = await redis.ping();
      checks.redis = {
        status: pingResult === 'PONG' ? 'ok' : 'degraded',
        adapter: config.REDIS_URL ? 'redis' : 'in-memory',
      };
      if (pingResult !== 'PONG') {
        isReady = false;
      }
    } catch (err: any) {
      isReady = false;
      checks.redis = {
        status: 'failed',
        error: err.message,
      };
    }

    // Check D: Worker Heartbeat
    const workerSecondsAgo = Math.round((Date.now() - lastWorkerHeartbeat) / 1000);
    const isWorkerAlive = workerSecondsAgo <= config.WORKER_HEARTBEAT_THRESHOLD_SECONDS;
    checks.worker = {
      status: isWorkerAlive ? 'ok' : 'degraded',
      lastHeartbeatSecondsAgo: workerSecondsAgo,
      thresholdSeconds: config.WORKER_HEARTBEAT_THRESHOLD_SECONDS,
    };
    if (!isWorkerAlive) {
      triggerWorkerHeartbeatAlert(workerSecondsAgo, config.WORKER_HEARTBEAT_THRESHOLD_SECONDS);
    }

    const statusCode = isReady ? 200 : 503;
    return reply.code(statusCode).send({
      status: isReady ? 'ready' : 'not_ready',
      checks,
      timestamp: new Date().toISOString(),
    });
  };

  fastify.get('/readiness', { config: { auth: false, policy: 'public', objectCheck: false } }, readinessHandler);
  fastify.get('/ready', { config: { auth: false, policy: 'public', objectCheck: false } }, readinessHandler);
  fastify.get('/readyz', { config: { auth: false, policy: 'public', objectCheck: false } }, readinessHandler);

  // 3. GET /metrics (Prometheus format; restricted to authorized monitoring scraper via X-Metrics-Token)
  fastify.get(
    '/metrics',
    {
      config: {
        auth: false,
        policy: 'public',
        objectCheck: false,
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const headerToken = req.headers['x-metrics-token'];
      const token =
        typeof headerToken === 'string'
          ? headerToken
          : typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ')
            ? req.headers.authorization.slice(7).trim()
            : '';

      if (!token || !constantTimeCompare(token, config.METRICS_SECRET)) {
        return reply.code(401).send({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Metrics endpoint requires valid X-Metrics-Token authentication.',
            details: {},
            requestId: req.id,
          },
        });
      }

      const mem = process.memoryUsage();
      const uptime = Math.round(process.uptime());

      // Collect Pool stats
      const totalPool = pool.totalCount || config.DB_POOL_MAX;
      const idlePool = pool.idleCount || 0;
      const waitingPool = pool.waitingCount || 0;

      // Query outbox lag
      let pendingOutbox = 0;
      let outboxLag = 0;
      try {
        const outboxRes = await pool.query(`
          SELECT 
            COUNT(*) as pending_count,
            COALESCE(EXTRACT(EPOCH FROM (NOW() - MIN(created_at))), 0) as lag_seconds
          FROM outbox
          WHERE status = 'PENDING';
        `);
        pendingOutbox = parseInt(outboxRes.rows[0]?.pending_count || '0', 10);
        outboxLag = parseFloat(outboxRes.rows[0]?.lag_seconds || '0');
      } catch {
        // ignore in mock mode
      }

      let promText = '';
      promText += '# HELP process_uptime_seconds Total seconds elapsed since process start.\n';
      promText += '# TYPE process_uptime_seconds gauge\n';
      promText += `process_uptime_seconds ${uptime}\n\n`;

      promText += '# HELP process_memory_heap_bytes Process heap memory in bytes.\n';
      promText += '# TYPE process_memory_heap_bytes gauge\n';
      promText += `process_memory_heap_bytes ${mem.heapUsed}\n\n`;

      promText += '# HELP db_pool_total_connections Total active database connections in pool.\n';
      promText += '# TYPE db_pool_total_connections gauge\n';
      promText += `db_pool_total_connections ${totalPool}\n`;
      promText += `db_pool_idle_connections ${idlePool}\n`;
      promText += `db_pool_waiting_connections ${waitingPool}\n\n`;

      promText += '# HELP outbox_pending_count Number of transactional outbox records awaiting dispatch.\n';
      promText += '# TYPE outbox_pending_count gauge\n';
      promText += `outbox_pending_count ${pendingOutbox}\n`;
      promText += `outbox_lag_seconds ${outboxLag}\n\n`;

      promText += '# HELP http_requests_total Total HTTP requests served by Eventora.\n';
      promText += '# TYPE http_requests_total counter\n';
      for (const [key, count] of metricsStore.requestCounts.entries()) {
        const [method, route, status] = key.split(':');
        promText += `http_requests_total{method="${method}",route="${route}",status="${status}"} ${count}\n`;
      }

      reply.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      return reply.send(promText);
    }
  );
};
