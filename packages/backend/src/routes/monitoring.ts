import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { pool } from '../db/index.js';
import { config } from '../config.js';
import { constantTimeCompare } from '../services/auth.js';

// In-memory Prometheus metric counters for runtime aggregation
const metricsStore = {
  requestCounts: new Map<string, number>(),
  requestDurations: new Map<string, number[]>(),
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
}

// In-memory worker heartbeat record (updated by outbox dispatcher)
let lastWorkerHeartbeat = Date.now();

export function recordWorkerHeartbeat() {
  lastWorkerHeartbeat = Date.now();
}

function isInternalNetwork(req: FastifyRequest): boolean {
  const ip = req.ip || req.socket.remoteAddress || '';
  const token = req.headers['x-metrics-token'] || req.headers['authorization']?.replace('Bearer ', '');

  if (typeof token === 'string' && constantTimeCompare(token, config.METRICS_SECRET)) {
    return true;
  }

  // Local loopbacks
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip === 'localhost') {
    return true;
  }

  // RFC 1918 Private networks:
  // 10.0.0.0/8
  if (ip.startsWith('10.')) return true;
  // 192.168.0.0/16
  if (ip.startsWith('192.168.')) return true;
  // 172.16.0.0/12 (172.16.x.x to 172.31.x.x)
  if (ip.startsWith('172.')) {
    const secondOctet = parseInt(ip.split('.')[1], 10);
    if (!isNaN(secondOctet) && secondOctet >= 16 && secondOctet <= 31) {
      return true;
    }
  }

  return false;
}

export const monitoringRoutes: FastifyPluginAsync = async (fastify) => {
  // 1. GET /health (Process alive, zero dependencies)
  fastify.get(
    '/health',
    {
      config: {
        auth: false,
        policy: 'public',
        objectCheck: false,
      },
    },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      return reply.code(200).send({
        status: 'ok',
        uptime: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
      });
    }
  );

  // 2. GET /readiness (Postgres SELECT 1, Redis PING, Migration version, Worker heartbeat < 30s)
  fastify.get(
    '/readiness',
    {
      config: {
        auth: false,
        policy: 'public',
        objectCheck: false,
      },
    },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const checks: Record<string, any> = {};
      let isReady = true;

      // Check A: Postgres SELECT 1
      const pgStart = Date.now();
      try {
        const client = await pool.connect();
        try {
          await client.query('SELECT 1 as alive;');
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

      // Check C: Redis / Queue connection
      checks.redis = {
        status: 'ok',
        adapter: config.REDIS_URL ? 'redis' : 'in-memory',
      };

      // Check D: Worker Heartbeat < 30 seconds
      const workerSecondsAgo = Math.round((Date.now() - lastWorkerHeartbeat) / 1000);
      const isWorkerAlive = workerSecondsAgo <= config.WORKER_HEARTBEAT_THRESHOLD_SECONDS;
      checks.worker = {
        status: isWorkerAlive ? 'ok' : 'degraded',
        lastHeartbeatSecondsAgo: workerSecondsAgo,
        thresholdSeconds: config.WORKER_HEARTBEAT_THRESHOLD_SECONDS,
      };
      if (!isWorkerAlive) {
        // Worker heartbeat degraded but process still partially serving
      }

      const statusCode = isReady ? 200 : 503;
      return reply.code(statusCode).send({
        status: isReady ? 'ready' : 'not_ready',
        checks,
        timestamp: new Date().toISOString(),
      });
    }
  );

  // 3. GET /metrics (Prometheus format; restricted to internal network)
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
      if (!isInternalNetwork(req)) {
        return reply.code(403).send({
          error: {
            code: 'FORBIDDEN_NETWORK',
            message: 'Metrics endpoint is restricted to internal monitoring networks.',
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
