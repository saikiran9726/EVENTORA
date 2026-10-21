import fastify, { FastifyInstance, FastifyServerOptions } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import crypto from 'crypto';
import { authPolicyPlugin, validateRouteSecurity } from './plugins/auth-policy.js';
import { authRoutes } from './routes/api/v1/auth.js';
import { meRoutes } from './routes/api/v1/me.js';
import { adminRoutes } from './routes/api/v1/admin.js';
import { eventRoutes } from './routes/api/v1/events.js';
import { venueRoutes } from './routes/api/v1/venues.js';
import { calendarRoutes } from './routes/api/v1/calendar.js';
import { bookingRoutes } from './routes/api/v1/bookings.js';
import { teamRoutes } from './routes/api/v1/teams.js';
import { paymentRoutes } from './routes/api/v1/payments.js';
import { ticketRoutes } from './routes/api/v1/tickets.js';
import { feedbackRoutes } from './routes/api/v1/feedback.js';
import { volunteerRoutes } from './routes/api/v1/volunteers.js';
import { notificationRoutes } from './routes/api/v1/notifications.js';
import { offlineCheckinRoutes } from './routes/api/v1/offline-checkin.js';
import { crossCollegePassportRoutes } from './routes/api/v1/crosscollege-passport.js';
import { monitoringRoutes, recordMetricRequest } from './routes/monitoring.js';
import { securityHeadersPlugin } from './plugins/security-headers.js';
import { rateLimiterPlugin } from './plugins/rate-limiter.js';
import { REDACT_PATHS } from './logger.js';
import { verifyPaymentStartupGuard } from './services/startup-guard.js';

export function buildApp(opts: FastifyServerOptions = {}): FastifyInstance {
  verifyPaymentStartupGuard();

  const app = fastify({
    genReqId: () => crypto.randomUUID(),
    logger: process.env.NODE_ENV === 'test' ? false : {
      level: 'info',
      redact: {
        paths: REDACT_PATHS,
        censor: '[REDACTED]',
      },
    },
    ...opts,
  });

  // Security Headers (CSP, HSTS, X-Content-Type-Options, Permissions-Policy)
  app.register(securityHeadersPlugin);

  // Rate Limiting (Sensitive Routes)
  app.register(rateLimiterPlugin);

  // Metrics hook
  app.addHook('onResponse', async (req, reply) => {
    const durationSec = (reply.elapsedTime || 0) / 1000;
    const route = req.routeOptions?.url || req.url.split('?')[0];
    recordMetricRequest(req.method, route, reply.statusCode, durationSec);
  });

  // Preserve raw request body as Buffer for timing-safe webhook HMAC-SHA256 signature verification
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    try {
      (req as any).rawBody = body;
      const json = JSON.parse(body.toString());
      done(null, json);
    } catch (err: any) {
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  // Strict Deny-by-default route validator
  app.addHook('onRoute', validateRouteSecurity);

  // CORS
  app.register(fastifyCors, {
    origin: (origin, cb) => {
      // Allow local development, mobile apps, and test runners
      cb(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-CSRF-Token',
      'x-csrf-token',
      'Idempotency-Key',
      'idempotency-key',
      'If-Match',
      'if-match',
    ],
  });

  // Cookie parsing
  app.register(fastifyCookie);

  // Auth & Policy enforcement
  app.register(authPolicyPlugin);

  // Monitoring & Health (GET /health, GET /readiness, GET /metrics)
  app.register(monitoringRoutes);

  // API v1 routes
  app.register(authRoutes, { prefix: '/api/v1/auth' });
  app.register(meRoutes, { prefix: '/api/v1/me' });
  app.register(adminRoutes, { prefix: '/api/v1/admin' });
  app.register(eventRoutes, { prefix: '/api/v1/events' });
  app.register(venueRoutes, { prefix: '/api/v1/venues' });
  app.register(calendarRoutes, { prefix: '/api/v1/calendar' });
  app.register(bookingRoutes, { prefix: '/api/v1' });
  app.register(teamRoutes, { prefix: '/api/v1/teams' });
  app.register(paymentRoutes, { prefix: '/api/v1' });
  app.register(ticketRoutes, { prefix: '/api/v1' });
  app.register(feedbackRoutes, { prefix: '/api/v1' });
  app.register(volunteerRoutes, { prefix: '/api/v1' });
  app.register(notificationRoutes, { prefix: '/api/v1' });
  app.register(offlineCheckinRoutes, { prefix: '/api/v1' });
  app.register(crossCollegePassportRoutes, { prefix: '/api/v1' });
  app.register(crossCollegePassportRoutes, { prefix: '' });

  // 404 Handler - Strict Error Envelope
  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({
      error: {
        code: 'NOT_FOUND',
        message: `Route ${req.method} ${req.url} was not found.`,
        details: { method: req.method, path: req.url },
        requestId: req.id,
      },
    });
  });

  // Global Error Handler - Strict Error Envelope (no leaked stack traces or SQL details)
  app.setErrorHandler((error, req, reply) => {
    const statusCode = error.statusCode || 500;
    const errorCode = error.code || (statusCode === 500 ? 'INTERNAL_SERVER_ERROR' : 'ERROR');

    // Never leak stack trace or internal database driver details to clients
    const isClientError = statusCode < 500;
    const userMessage = isClientError
      ? error.message
      : 'An unexpected internal error occurred. Please contact support.';

    reply.code(statusCode).send({
      error: {
        code: errorCode,
        message: userMessage,
        details: error.validation ? { validation: error.validation } : {},
        requestId: req.id,
      },
    });
  });

  return app;
}
