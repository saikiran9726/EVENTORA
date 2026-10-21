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

export function buildApp(opts: FastifyServerOptions = {}): FastifyInstance {
  const app = fastify({
    genReqId: () => crypto.randomUUID(),
    logger: process.env.NODE_ENV === 'test' ? false : { level: 'info' },
    ...opts,
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

  // Health check route (whitelisted in auth-policy)
  app.get('/health', async (req) => {
    return { status: 'ok', timestamp: new Date().toISOString(), requestId: req.id };
  });

  // API v1 routes
  app.register(authRoutes, { prefix: '/api/v1/auth' });
  app.register(meRoutes, { prefix: '/api/v1/me' });
  app.register(adminRoutes, { prefix: '/api/v1/admin' });
  app.register(eventRoutes, { prefix: '/api/v1/events' });
  app.register(venueRoutes, { prefix: '/api/v1/venues' });
  app.register(calendarRoutes, { prefix: '/api/v1/calendar' });
  app.register(bookingRoutes, { prefix: '/api/v1' });
  app.register(teamRoutes, { prefix: '/api/v1/teams' });

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
