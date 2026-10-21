import { FastifyInstance, FastifyRequest, FastifyReply, RouteOptions } from 'fastify';
import fp from 'fastify-plugin';
import { validateSession, SESSION_CONFIG, constantTimeCompare } from '../services/auth.js';
import type { User, Session } from '../db/schema.js';

export type PolicyName =
  | 'public'
  | 'authenticated'
  | 'user:manage'
  | 'event:create'
  | 'event:review'
  | 'event:manage:owned'
  | 'attendance:checkin:assigned'
  | 'analytics:view:owned'
  | 'export:owned';

export interface RouteConfigPolicy {
  auth: boolean;
  policy: PolicyName;
  objectCheck?: boolean | ((req: FastifyRequest) => Promise<boolean>);
}

declare module 'fastify' {
  interface FastifyContextConfig {
    auth?: boolean;
    policy?: PolicyName;
    objectCheck?: boolean | ((req: FastifyRequest) => Promise<boolean>);
  }

  interface FastifyRequest {
    user?: User;
    session?: Session;
    sessionToken?: string;
  }
}

/**
 * Validates deny-by-default policy metadata for any route
 */
export function validateRouteSecurity(routeOptions: RouteOptions): void {
  // Fastify internal, schema, or CORS preflight routes
  if (
    routeOptions.url === '/health' ||
    routeOptions.url === '/favicon.ico' ||
    routeOptions.method === 'OPTIONS'
  ) {
    return;
  }

  const config = routeOptions.config as RouteConfigPolicy | undefined;

  if (!config || typeof config.auth !== 'boolean' || !config.policy) {
    throw new Error(
      `[Security Startup Failure] Route ${routeOptions.method} ${routeOptions.url} lacks explicit deny-by-default { auth, policy, objectCheck } configuration!`
    );
  }

  if (config.objectCheck === undefined) {
    throw new Error(
      `[Security Startup Failure] Route ${routeOptions.method} ${routeOptions.url} lacks explicit objectCheck declaration!`
    );
  }
}

export const authPolicyPlugin = fp(async function (fastify: FastifyInstance) {
  // PreHandler enforcement hook
  fastify.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    // Skip health check
    if (req.url === '/health') return;

    const config = req.routeOptions?.config as RouteConfigPolicy | undefined;

    // Unmatched route or missing policy on undefined route -> allow 404 handler to process
    if (!config || !config.policy) {
      return;
    }

    // Extract session token from cookie or Authorization header
    const cookieToken = req.cookies[SESSION_CONFIG.cookieName];
    const authHeader = req.headers.authorization;
    let token = cookieToken;
    if (!token && authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    }

    if (token) {
      req.sessionToken = token;
      const validated = await validateSession(token);
      if (validated) {
        req.user = validated.user;
        req.session = validated.session;
      }
    }

    // If route is public
    if (config.policy === 'public' && !config.auth) {
      return;
    }

    // Auth required but user not authenticated or session invalid
    if (config.auth && (!req.user || !req.session)) {
      return reply.code(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required or session expired',
          details: {},
          requestId: req.id,
        },
      });
    }

    // CSRF verification for authenticated state-changing requests
    if (config.auth && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const csrfCookie = req.cookies[SESSION_CONFIG.csrfCookieName];
      const csrfHeader = req.headers['x-csrf-token'] as string | undefined;

      // Check double-submit
      if (!csrfCookie || !csrfHeader || !constantTimeCompare(csrfCookie, csrfHeader)) {
        return reply.code(403).send({
          error: {
            code: 'CSRF_INVALID',
            message: 'Invalid or missing CSRF token',
            details: {},
            requestId: req.id,
          },
        });
      }

      // Check Origin / Referer header if present
      const origin = req.headers.origin || req.headers.referer;
      const host = (req.headers['x-forwarded-host'] as string) || req.headers.host;
      if (origin && host) {
        try {
          const originUrl = new URL(origin);
          const originHost = originUrl.host;
          const hostNameOnly = host.split(':')[0];
          const originNameOnly = originUrl.hostname;

          const isLocalDev =
            (originNameOnly === 'localhost' || originNameOnly === '127.0.0.1') &&
            (hostNameOnly === 'localhost' || hostNameOnly === '127.0.0.1');

          if (!isLocalDev && originHost !== host) {
            return reply.code(403).send({
              error: {
                code: 'CSRF_ORIGIN_MISMATCH',
                message: 'Cross-origin request rejected',
                details: {},
                requestId: req.id,
              },
            });
          }
        } catch {
          return reply.code(403).send({
            error: {
              code: 'CSRF_ORIGIN_MALFORMED',
              message: 'Malformed Origin or Referer header',
              details: {},
              requestId: req.id,
            },
          });
        }
      }
    }

    // Evaluate RBAC Policy
    const userRole = req.user?.globalRole;

    switch (config.policy) {
      case 'public':
        break;

      case 'authenticated':
        // Any authenticated active user
        if (!req.user) {
          return reply.code(401).send({
            error: {
              code: 'UNAUTHORIZED',
              message: 'Authentication required',
              details: {},
              requestId: req.id,
            },
          });
        }
        break;

      case 'user:manage':
        // Admin role required
        if (userRole !== 'admin') {
          return reply.code(403).send({
            error: {
              code: 'FORBIDDEN',
              message: 'Administrative privileges required for user:manage',
              details: { requiredPolicy: 'user:manage', userRole },
              requestId: req.id,
            },
          });
        }
        break;

      case 'event:review':
        if (userRole !== 'reviewer' && userRole !== 'admin') {
          return reply.code(403).send({
            error: {
              code: 'FORBIDDEN',
              message: 'Reviewer or admin role required for event:review',
              details: { requiredPolicy: 'event:review', userRole },
              requestId: req.id,
            },
          });
        }
        break;

      case 'event:create': {
        if (userRole === 'admin') break;
        // Check if user is an active member in any verified organizer club
        const { db } = await import('../db/index.js');
        const { organizerMembers } = await import('../db/schema.js');
        const { eq, and } = await import('drizzle-orm');

        const membership = await db.query.organizerMembers.findFirst({
          where: and(eq(organizerMembers.userId, req.user!.id), eq(organizerMembers.status, 'active')),
        });

        if (!membership) {
          return reply.code(403).send({
            error: {
              code: 'FORBIDDEN',
              message: 'Organizer membership required to create events',
              details: { requiredPolicy: 'event:create', userRole },
              requestId: req.id,
            },
          });
        }
        break;
      }

      case 'event:manage:owned': {
        if (userRole === 'admin') break;
        const eventId = (req.params as any)?.id;
        if (!eventId) break;

        const { db } = await import('../db/index.js');
        const { events, organizerMembers } = await import('../db/schema.js');
        const { eq, and } = await import('drizzle-orm');

        const targetEvent = await db.query.events.findFirst({
          where: eq(events.id, eventId),
        });

        if (!targetEvent) {
          return reply.code(404).send({
            error: {
              code: 'EVENT_NOT_FOUND',
              message: `Event ${eventId} not found`,
              details: { eventId },
              requestId: req.id,
            },
          });
        }

        const membership = await db.query.organizerMembers.findFirst({
          where: and(
            eq(organizerMembers.organizerId, targetEvent.organizerId),
            eq(organizerMembers.userId, req.user!.id),
            eq(organizerMembers.status, 'active')
          ),
        });

        if (!membership) {
          return reply.code(403).send({
            error: {
              code: 'FORBIDDEN',
              message: 'You do not have organizer permissions for this event',
              details: { requiredPolicy: 'event:manage:owned', eventId },
              requestId: req.id,
            },
          });
        }
        break;
      }

      default:
        // For other policies, fallback to admin or check
        if (userRole !== 'admin') {
          return reply.code(403).send({
            error: {
              code: 'FORBIDDEN',
              message: `Insufficient permissions for policy: ${config.policy}`,
              details: { requiredPolicy: config.policy, userRole },
              requestId: req.id,
            },
          });
        }
        break;
    }

    // Object Check
    if (typeof config.objectCheck === 'function') {
      const allowed = await config.objectCheck(req);
      if (!allowed) {
        return reply.code(403).send({
          error: {
            code: 'FORBIDDEN',
            message: 'Object-level permission check failed',
            details: { policy: config.policy },
            requestId: req.id,
          },
        });
      }
    }
  });
});
