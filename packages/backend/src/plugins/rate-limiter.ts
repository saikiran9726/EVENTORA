import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';

interface RateLimitConfig {
  max: number;
  timeWindowMs: number;
}

const ROUTE_RATE_LIMITS: Record<string, RateLimitConfig> = {
  '/api/v1/auth/login': { max: 10, timeWindowMs: 60_000 },
  '/api/v1/auth/register': { max: 10, timeWindowMs: 60_000 },
  '/api/v1/bookings/:id/checkout': { max: 20, timeWindowMs: 60_000 },
  '/api/v1/events/:id/check-in/scan': { max: 120, timeWindowMs: 60_000 },
  '/api/v1/events/:id/feedback': { max: 10, timeWindowMs: 60_000 },
};

interface WindowEntry {
  timestamps: number[];
}

const windowMap = new Map<string, WindowEntry>();

// Clean up stale IP windows every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of windowMap.entries()) {
    entry.timestamps = entry.timestamps.filter((t) => now - t < 600_000);
    if (entry.timestamps.length === 0) windowMap.delete(key);
  }
}, 300_000);

export function getRateLimitConfig(url: string): RateLimitConfig | null {
  for (const [pattern, cfg] of Object.entries(ROUTE_RATE_LIMITS)) {
    if (pattern.includes(':id')) {
      const regex = new RegExp('^' + pattern.replace(/:[a-zA-Z0-9_]+/g, '[^/]+') + '$');
      if (regex.test(url)) return cfg;
    } else if (url === pattern) {
      return cfg;
    }
  }
  return null;
}

export const rateLimiterPlugin: FastifyPluginAsync = fp(async (fastify) => {
  fastify.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    // Whitelist test environment if explicitly disabled
    if (process.env.DISABLE_RATE_LIMIT === 'true') return;

    const url = req.url.split('?')[0];
    const cfg = getRateLimitConfig(url);
    if (!cfg) return;

    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ||
      (req.headers['x-client-ip'] as string) ||
      req.ip ||
      req.socket.remoteAddress ||
      'unknown';
    const userId = (req as any).user?.id || '';
    const key = `${url}:${ip}:${userId}`;
    const now = Date.now();

    let entry = windowMap.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      windowMap.set(key, entry);
    }

    // Retain only timestamps within the current window
    entry.timestamps = entry.timestamps.filter((t) => now - t < cfg.timeWindowMs);

    const remaining = Math.max(0, cfg.max - entry.timestamps.length);
    const resetSeconds = Math.ceil(cfg.timeWindowMs / 1000);

    reply.header('X-RateLimit-Limit', cfg.max);
    reply.header('X-RateLimit-Remaining', remaining);
    reply.header('X-RateLimit-Reset', resetSeconds);

    if (entry.timestamps.length >= cfg.max) {
      reply.header('Retry-After', resetSeconds);
      return reply.code(429).send({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: `Too many requests to ${url}. Please retry after ${resetSeconds} seconds.`,
          details: { limit: cfg.max, windowSeconds: resetSeconds },
          requestId: req.id,
        },
      });
    }

    entry.timestamps.push(now);
  });
});
