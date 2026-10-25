import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { checkRateLimit } from '../services/redis.js';

export interface RateLimitRule {
  scope: string;
  methods: string[];
  patterns: (string | RegExp)[];
  max: number;
  windowSeconds: number;
}

export const RATE_LIMIT_RULES: RateLimitRule[] = [
  // 1. Register
  {
    scope: 'register',
    methods: ['POST'],
    patterns: [
      '/api/v1/auth/register',
      /^\/(api\/v1\/)?auth\/register\/?$/,
    ],
    max: 10,
    windowSeconds: 60,
  },
  // 2. Login
  {
    scope: 'login',
    methods: ['POST'],
    patterns: [
      '/api/v1/auth/login',
      /^\/(api\/v1\/)?auth\/login\/?$/,
    ],
    max: 10,
    windowSeconds: 60,
  },
  // 3. Forgot Password
  {
    scope: 'forgot',
    methods: ['POST'],
    patterns: [
      '/api/v1/auth/forgot-password',
      /^\/(api\/v1\/)?auth\/forgot-password\/?$/,
    ],
    max: 5,
    windowSeconds: 60,
  },
  // 4. Verify Email & Reset Password
  {
    scope: 'verify',
    methods: ['POST'],
    patterns: [
      '/api/v1/auth/verify-email',
      '/api/v1/auth/reset-password',
      /^\/(api\/v1\/)?auth\/(verify-email|reset-password)\/?$/,
    ],
    max: 10,
    windowSeconds: 60,
  },
  // 5. Booking Creation
  {
    scope: 'booking',
    methods: ['POST'],
    patterns: [
      '/api/v1/events/:id/bookings',
      /^\/(api\/v1\/)?events\/[^/]+\/bookings\/?$/,
    ],
    max: 10,
    windowSeconds: 60,
  },
  // 6. Checkout
  {
    scope: 'checkout',
    methods: ['POST'],
    patterns: [
      '/api/v1/bookings/:id/checkout',
      /^\/(api\/v1\/)?bookings\/[^/]+\/checkout\/?$/,
    ],
    max: 20,
    windowSeconds: 60,
  },
  // 7. Payments Verify
  {
    scope: 'payments/verify',
    methods: ['POST'],
    patterns: [
      '/api/v1/payments/verify',
      '/api/v1/payments/checkout/verify',
      /^\/(api\/v1\/)?payments\/(checkout\/)?verify\/?$/,
    ],
    max: 20,
    windowSeconds: 60,
  },
  // 8. Staff QR Scan & Offline Check-in Batch
  {
    scope: 'scan',
    methods: ['POST'],
    patterns: [
      '/api/v1/events/:id/check-in/scan',
      '/api/v1/events/:id/check-in/sync-batch',
      /^\/(api\/v1\/)?events\/[^/]+\/check-in\/(scan|sync-batch)\/?$/,
    ],
    max: 120,
    windowSeconds: 60,
  },
  // 9. Feedback
  {
    scope: 'feedback',
    methods: ['POST'],
    patterns: [
      '/api/v1/events/:id/feedback',
      '/api/v1/events/:id/feedback/replies',
      '/api/v1/events/:id/feedback/flag',
      /^\/(api\/v1\/)?events\/[^/]+\/feedback(\/replies|\/flag)?\/?$/,
    ],
    max: 10,
    windowSeconds: 60,
  },
  // 10. Alerts Broadcast
  {
    scope: 'alerts',
    methods: ['POST'],
    patterns: [
      '/api/v1/events/:id/alerts',
      '/api/v1/alerts/broadcast',
      /^\/(api\/v1\/)?(events\/[^/]+\/alerts|alerts\/broadcast)\/?$/,
    ],
    max: 10,
    windowSeconds: 60,
  },
  // 11. Data Exports
  {
    scope: 'exports',
    methods: ['POST', 'GET'],
    patterns: [
      '/api/v1/organizer/events/:id/exports',
      '/api/v1/exports/download/:token',
      /^\/(api\/v1\/)?(organizer\/events\/[^/]+\/exports|exports\/download\/[^/]+)\/?$/,
    ],
    max: 10,
    windowSeconds: 60,
  },
  // 12. Public Verify & Passport
  {
    scope: 'public verify/passport',
    methods: ['GET'],
    patterns: [
      '/api/v1/verify/:code',
      '/verify/:code',
      '/api/v1/p/:slug',
      '/p/:slug',
      '/api/v1/crosscollege-passport/:id',
      '/crosscollege-passport/:id',
      /^\/(api\/v1\/)?(verify|p|crosscollege-passport)\/[^/]+\/?$/,
    ],
    max: 30,
    windowSeconds: 60,
  },
];

export function findMatchingRateLimitRule(
  method: string,
  routeTemplate?: string,
  pathname?: string
): RateLimitRule | null {
  for (const rule of RATE_LIMIT_RULES) {
    if (!rule.methods.includes(method)) continue;

    for (const pattern of rule.patterns) {
      if (typeof pattern === 'string') {
        if (routeTemplate && routeTemplate === pattern) return rule;
        if (pathname && pathname === pattern) return rule;
      } else if (pattern instanceof RegExp) {
        if (routeTemplate && pattern.test(routeTemplate)) return rule;
        if (pathname && pattern.test(pathname)) return rule;
      }
    }
  }
  return null;
}

export const rateLimiterPlugin: FastifyPluginAsync = fp(async (fastify) => {
  fastify.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    // Whitelist test environment if explicitly disabled
    if (process.env.DISABLE_RATE_LIMIT === 'true') return;

    const pathname = req.url.split('?')[0];
    const rule = findMatchingRateLimitRule(req.method, req.routeOptions?.url, pathname);
    if (!rule) return;

    // Fastify with trustProxy: 1 resolves req.ip to the client IP
    const ip = req.ip || '127.0.0.1';
    const userId = req.user?.id || 'anon';
    const rateLimitKey = `${rule.scope}:${ip}:${userId}`;

    const result = await checkRateLimit(rateLimitKey, rule.max, rule.windowSeconds);

    reply.header('X-RateLimit-Limit', rule.max);
    reply.header('X-RateLimit-Remaining', result.remaining);
    reply.header('X-RateLimit-Reset', result.resetSeconds);

    if (!result.allowed) {
      reply.header('Retry-After', result.resetSeconds);
      return reply.code(429).send({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: `Too many requests for ${rule.scope}. Please retry after ${result.resetSeconds} seconds.`,
          details: {
            scope: rule.scope,
            limit: rule.max,
            windowSeconds: rule.windowSeconds,
            resetSeconds: result.resetSeconds,
          },
          requestId: req.id,
        },
      });
    }
  });
});
