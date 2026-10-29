import fastify, { FastifyInstance, FastifyServerOptions } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import crypto from 'crypto';
import { config } from './config.js';
import { authPolicyPlugin, validateRouteSecurity } from './plugins/auth-policy.js';
import { authRoutes } from './routes/api/v1/auth.js';
import { meRoutes } from './routes/api/v1/me.js';
import { adminRoutes } from './routes/api/v1/admin.js';
import { eventRoutes } from './routes/api/v1/events.js';
import { venueRoutes } from './routes/api/v1/venues.js';
import { calendarRoutes } from './routes/api/v1/calendar.js';
import { bookingRoutes } from './routes/api/v1/bookings.js';
import { teamRoutes } from './routes/api/v1/teams.js';
import { paymentRoutes, handleYouPiWebhookRoute, handleGetPaymentStatusRoute, checkPaymentStatusOwnership } from './routes/api/v1/payments.js';
import { ticketRoutes, checkTicketAccess, handleGetTicketQrSvgRoute, handleGetTicketDownloadRoute, handleVerifyCertificateRoute } from './routes/api/v1/tickets.js';
import { feedbackRoutes } from './routes/api/v1/feedback.js';
import { volunteerRoutes } from './routes/api/v1/volunteers.js';
import { notificationRoutes } from './routes/api/v1/notifications.js';
import { offlineCheckinRoutes } from './routes/api/v1/offline-checkin.js';
import { crossCollegePassportRoutes, handleGetPublicPassportRoute } from './routes/api/v1/crosscollege-passport.js';
import { handleResendWebhook } from './routes/webhooks/resend.js';
import { monitoringRoutes, recordMetricRequest } from './routes/monitoring.js';
import { seoRoutes } from './routes/api/v1/seo.js';
import { securityHeadersPlugin } from './plugins/security-headers.js';
import { rateLimiterPlugin } from './plugins/rate-limiter.js';
import fastifySwagger from '@fastify/swagger';
import {
  validatorCompiler,
  serializerCompiler,
  jsonSchemaTransform,
} from 'fastify-type-provider-zod';
import { logger } from './logger.js';
import { verifyPaymentStartupGuard } from './services/startup-guard.js';
import { initBackendSentry, captureException } from './lib/sentry.js';

export function buildApp(opts: FastifyServerOptions = {}): FastifyInstance {
  initBackendSentry();
  verifyPaymentStartupGuard();

  const app = fastify({
    trustProxy: 1,
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'requestId',
    genReqId: (req) => {
      const incomingId = (req.headers['x-request-id'] || req.headers['X-Request-ID']) as string | undefined;
      if (typeof incomingId === 'string' && incomingId.trim().length > 0 && incomingId.length <= 128) {
        return incomingId.trim();
      }
      return crypto.randomUUID();
    },
    logger: process.env.NODE_ENV === 'test' ? false : logger,
    ...opts,
  });

  // Configure Zod validator and serializer compilers
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Register OpenAPI / Swagger documentation generator
  app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'Eventora API',
        description: 'Smart Campus Event Management System OpenAPI 3.0 specification',
        version: '1.0.0',
      },
      servers: [
        { url: 'https://eventora-api-p35a.onrender.com', description: 'Production API' },
        { url: 'http://127.0.0.1:4000', description: 'Local Development API' },
      ],
      components: {
        securitySchemes: {
          sessionCookie: {
            type: 'apiKey',
            name: 'eventora_session',
            in: 'cookie',
          },
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
    transform: jsonSchemaTransform,
  });

  // Public OpenAPI JSON specification endpoints
  app.get(
    '/openapi.json',
    {
      schema: {
        description: 'OpenAPI 3.0 JSON specification',
        tags: ['OpenAPI'],
      },
      config: {
        auth: false,
        policy: 'public',
        objectCheck: false,
      },
    },
    async () => {
      return (app as any).swagger();
    }
  );

  app.get(
    '/api/v1/openapi.json',
    {
      schema: {
        description: 'OpenAPI 3.0 JSON specification (v1 alias)',
        tags: ['OpenAPI'],
      },
      config: {
        auth: false,
        policy: 'public',
        objectCheck: false,
      },
    },
    async () => {
      return (app as any).swagger();
    }
  );

  // Ensure outgoing responses echo the trace requestId
  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  // Security Headers (CSP, HSTS, X-Content-Type-Options, Permissions-Policy)
  app.register(securityHeadersPlugin);

  // Metrics hook (Bounded cardinality with __unmatched__ route mapping)
  app.addHook('onResponse', async (req, reply) => {
    const durationSec = (reply.elapsedTime || 0) / 1000;
    const route =
      req.routeOptions?.url && req.routeOptions.url !== '/*'
        ? req.routeOptions.url
        : '__unmatched__';
    recordMetricRequest(req.method, route, reply.statusCode, durationSec);
  });

  // Preserve raw request body as Buffer for timing-safe webhook HMAC-SHA256 signature verification
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    try {
      (req as any).rawBody = body;
      const str = body.toString().trim();
      const json = str ? JSON.parse(str) : {};
      done(null, json);
    } catch (err: any) {
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  // Strict Deny-by-default route validator
  app.addHook('onRoute', validateRouteSecurity);

  // CORS - Strict allow-list built from comma-separated CORS_ORIGIN (No untrusted origin reflection)
  const allowedOrigins = new Set(
    (config.CORS_ORIGIN || '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean)
  );

  // In non-production environments (development/test), also allow local development origins if not explicitly present
  if (config.NODE_ENV !== 'production') {
    allowedOrigins.add('http://localhost:5173');
    allowedOrigins.add('http://127.0.0.1:5173');
  }

  app.register(fastifyCors, {
    origin: (origin, cb) => {
      // Allow non-browser agents, local test runners, mobile apps, or same-origin requests without Origin header
      if (!origin) return cb(null, true);

      if (allowedOrigins.has(origin)) {
        return cb(null, true);
      }
      return cb(null, false);
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
      'X-Request-ID',
      'x-request-id',
      'X-Metrics-Token',
      'x-metrics-token',
    ],
  });

  // Cookie parsing
  app.register(fastifyCookie);

  // Auth & Policy enforcement
  app.register(authPolicyPlugin);

  // Rate Limiting (Redis-backed checkRateLimit; req.ip + user.id after auth policy)
  app.register(rateLimiterPlugin);

  // Global UUID route parameter validation hook
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  app.addHook('preValidation', async (req, reply) => {
    // Skip session hash parameters which are 64-char sha256 hex hashes rather than UUIDs
    if (req.url.startsWith('/api/v1/me/sessions/')) return;
    // Skip outbox parameters which are integer IDs
    if (req.url.startsWith('/api/v1/admin/outbox/')) return;

    if (req.params && typeof req.params === 'object') {
      for (const [key, value] of Object.entries(req.params as Record<string, unknown>)) {
        if ((key === 'id' || key.endsWith('Id')) && typeof value === 'string') {
          if (!UUID_REGEX.test(value)) {
            return reply.code(400).send({
              error: {
                code: 'INVALID_ID',
                message: `Route parameter '${key}' must be a valid UUID`,
                details: { parameter: key, value },
                requestId: req.id,
              },
            });
          }
        }
      }
    }
  });

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
  app.register(seoRoutes);
  app.register(seoRoutes, { prefix: '/api/v1' });

  // Direct webhook endpoint for YouPI-PG at /webhooks/payments/youpi (also at /api/v1/webhooks/payments/youpi)
  app.post(
    '/webhooks/payments/youpi',
    {
      config: {
        auth: false,
        policy: 'public',
        objectCheck: false,
      },
    },
    handleYouPiWebhookRoute
  );

  // Resend webhook endpoints at /webhooks/resend and /api/v1/webhooks/resend
  app.post(
    '/webhooks/resend',
    {
      config: {
        auth: false,
        policy: 'public',
        objectCheck: false,
      },
    },
    handleResendWebhook
  );

  app.post(
    '/api/v1/webhooks/resend',
    {
      config: {
        auth: false,
        policy: 'public',
        objectCheck: false,
      },
    },
    handleResendWebhook
  );

  // Direct status endpoint for YouPI checkout at /payments/:id/status (also at /api/v1/payments/:id/status)
  app.get(
    '/payments/:id/status',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: checkPaymentStatusOwnership,
      },
    },
    handleGetPaymentStatusRoute
  );

  // Direct ticket QR and download routes at /tickets/:id/qr.svg and /tickets/:id/download
  app.get(
    '/tickets/:id/qr.svg',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: checkTicketAccess,
      },
    },
    handleGetTicketQrSvgRoute
  );

  app.get(
    '/tickets/:id/download',
    {
      config: {
        auth: true,
        policy: 'authenticated',
        objectCheck: checkTicketAccess,
      },
    },
    handleGetTicketDownloadRoute
  );

  // Direct public passport lookup at /p/:slug (also at /api/v1/p/:slug)
  app.get(
    '/p/:slug',
    {
      config: {
        auth: false,
        policy: 'public',
        objectCheck: false,
      },
    },
    handleGetPublicPassportRoute
  );

  // Direct public certificate verification at /verify/:code (also at /api/v1/verify/:code)
  app.get(
    '/verify/:code',
    {
      config: {
        auth: false,
        policy: 'public',
        objectCheck: false,
      },
    },
    handleVerifyCertificateRoute
  );

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

    if (statusCode >= 500) {
      captureException(error, {
        requestId: req.id,
        userId: (req as any).user?.id,
        method: req.method,
        url: req.url,
      });
    }

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
