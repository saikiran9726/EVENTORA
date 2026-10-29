import { FastifyInstance, FastifyRequest, FastifyReply, RouteOptions } from 'fastify';
import fp from 'fastify-plugin';
import { validateSession, SESSION_CONFIG, constantTimeCompare } from '../services/auth.js';
import { config as appConfig } from '../config.js';
import { db } from '../db/index.js';
import {
  events,
  organizerMembers,
  eventStaffAssignments,
  type User,
  type Session,
} from '../db/schema.js';
import { eq, and } from 'drizzle-orm';

export type PolicyName =
  | 'public'
  | 'authenticated'
  | 'user:manage'
  | 'event:create'
  | 'event:review'
  | 'event:manage:owned'
  | 'attendance:checkin:assigned'
  | 'attendance:resolve_conflict'
  | 'analytics:view:owned'
  | 'export:owned';

export interface RouteConfigPolicy {
  auth: boolean;
  policy: PolicyName;
  objectCheck?: boolean | ((req: FastifyRequest) => Promise<boolean>);
  resolveEventId?: (req: FastifyRequest) => Promise<string | null | undefined> | string | null | undefined;
}

declare module 'fastify' {
  interface FastifyContextConfig {
    auth?: boolean;
    policy?: PolicyName;
    objectCheck?: boolean | ((req: FastifyRequest) => Promise<boolean>);
    resolveEventId?: (req: FastifyRequest) => Promise<string | null | undefined> | string | null | undefined;
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
    // Skip liveness health checks (zero auth overhead)
    if (req.url === '/health' || req.url === '/healthz') return;

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

      // 1. Double-submit cookie verification
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

      // 2. Modern browser Sec-Fetch-Site / Origin enforcement
      const secFetchSite = (req.headers['sec-fetch-site'] as string | undefined)?.toLowerCase();
      const origin = req.headers.origin || req.headers.referer;
      const host = (req.headers['x-forwarded-host'] as string) || req.headers.host;

      // Reject cross-site requests via Sec-Fetch-Site
      if (secFetchSite && !['same-origin', 'none', 'same-site'].includes(secFetchSite)) {
        return reply.code(403).send({
          error: {
            code: 'CSRF_FETCH_SITE_REJECTED',
            message: 'Cross-site request rejected via Sec-Fetch-Site policy',
            details: { secFetchSite },
            requestId: req.id,
          },
        });
      }

      // In production/development or when strict origin is asserted, require Origin or Sec-Fetch-Site
      const isTest = process.env.NODE_ENV === 'test';
      const enforceStrictOrigin = !isTest || req.headers['x-enforce-csrf-origin'] === 'true';
      if (enforceStrictOrigin && !origin && !secFetchSite) {
        return reply.code(403).send({
          error: {
            code: 'CSRF_ORIGIN_REQUIRED',
            message: 'State-changing requests require a valid Origin or Sec-Fetch-Site header',
            details: {},
            requestId: req.id,
          },
        });
      }

      // 3. Check Origin / Referer target domain if present
      if (origin) {
        try {
          const originUrl = new URL(origin);
          const originHost = originUrl.host;
          const originHostname = originUrl.hostname;

          const isLocalDev =
            originHostname === 'localhost' || originHostname === '127.0.0.1';

          const isVercel =
            originHost === 'eventora-jet.vercel.app' || originHostname.endsWith('.vercel.app');

          const isConfigured = (appConfig.CORS_ORIGIN || '').includes(originUrl.origin);

          if (!isLocalDev && !isVercel && !isConfigured && host && originHost !== host) {
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

        const eventId = config.resolveEventId
          ? await config.resolveEventId(req)
          : ((req.params as any)?.eventId || (req.params as any)?.id);

        if (!eventId) {
          return reply.code(403).send({
            error: {
              code: 'FORBIDDEN',
              message: 'Event context required for event:manage:owned',
              details: { requiredPolicy: 'event:manage:owned' },
              requestId: req.id,
            },
          });
        }

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

        if (!membership || (membership.role !== 'owner' && membership.role !== 'manager')) {
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

      case 'analytics:view:owned': {
        if (userRole === 'admin') break;

        let organizerId: string | null | undefined = null;
        if (config.resolveEventId) {
          const resolved = await config.resolveEventId(req);
          if (resolved) {
            const ev = await db.query.events.findFirst({ where: eq(events.id, resolved) });
            organizerId = ev ? ev.organizerId : resolved;
          }
        } else {
          organizerId = (req.params as any)?.organizerId;
          const paramId = (req.params as any)?.id;
          if (!organizerId && paramId) {
            const ev = await db.query.events.findFirst({ where: eq(events.id, paramId) });
            organizerId = ev ? ev.organizerId : paramId;
          }
        }

        if (!organizerId) {
          return reply.code(403).send({
            error: {
              code: 'FORBIDDEN',
              message: 'Organizer context required for analytics:view:owned',
              details: { requiredPolicy: 'analytics:view:owned' },
              requestId: req.id,
            },
          });
        }

        const membership = await db.query.organizerMembers.findFirst({
          where: and(
            eq(organizerMembers.organizerId, organizerId),
            eq(organizerMembers.userId, req.user!.id),
            eq(organizerMembers.status, 'active')
          ),
        });

        if (!membership || (membership.role !== 'owner' && membership.role !== 'manager')) {
          return reply.code(403).send({
            error: {
              code: 'FORBIDDEN',
              message: 'You do not have permission to view analytics or ledger for this organizer',
              details: { requiredPolicy: 'analytics:view:owned', organizerId },
              requestId: req.id,
            },
          });
        }
        break;
      }

      case 'export:owned': {
        if (userRole === 'admin') break;

        const eventId = config.resolveEventId
          ? await config.resolveEventId(req)
          : ((req.params as any)?.id || (req.params as any)?.eventId);

        if (!eventId) {
          return reply.code(403).send({
            error: {
              code: 'FORBIDDEN',
              message: 'Event context required for export:owned',
              details: { requiredPolicy: 'export:owned' },
              requestId: req.id,
            },
          });
        }

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

        if (!membership || (membership.role !== 'owner' && membership.role !== 'manager')) {
          return reply.code(403).send({
            error: {
              code: 'FORBIDDEN',
              message: 'You do not have export permissions for this event',
              details: { requiredPolicy: 'export:owned', eventId },
              requestId: req.id,
            },
          });
        }
        break;
      }

      case 'attendance:checkin:assigned': {
        if (userRole === 'admin') break;

        const eventId = config.resolveEventId
          ? await config.resolveEventId(req)
          : ((req.params as any)?.id || (req.params as any)?.eventId || (req.body as any)?.eventId);

        if (!eventId) {
          return reply.code(403).send({
            error: {
              code: 'FORBIDDEN',
              message: 'Event context required for attendance:checkin:assigned',
              details: { requiredPolicy: 'attendance:checkin:assigned' },
              requestId: req.id,
            },
          });
        }

        // 1. Check direct staff assignment
        const assignment = await db.query.eventStaffAssignments.findFirst({
          where: and(
            eq(eventStaffAssignments.eventId, eventId),
            eq(eventStaffAssignments.userId, req.user!.id),
            eq(eventStaffAssignments.capability, 'checkin')
          ),
        });

        if (assignment && (!assignment.expiresAt || new Date(assignment.expiresAt) > new Date())) {
          break;
        }

        // 2. Check if user is organizer owner/manager for this event
        const targetEvent = await db.query.events.findFirst({
          where: eq(events.id, eventId),
        });

        if (targetEvent) {
          const orgMembership = await db.query.organizerMembers.findFirst({
            where: and(
              eq(organizerMembers.organizerId, targetEvent.organizerId),
              eq(organizerMembers.userId, req.user!.id),
              eq(organizerMembers.status, 'active')
            ),
          });

          if (orgMembership && (orgMembership.role === 'owner' || orgMembership.role === 'manager')) {
            break;
          }
        }

        return reply.code(403).send({
          error: {
            code: 'FORBIDDEN',
            message: 'You are not assigned as check-in staff for this event',
            details: { requiredPolicy: 'attendance:checkin:assigned', eventId },
            requestId: req.id,
          },
        });
      }

      case 'attendance:resolve_conflict': {
        if (userRole === 'admin') break;

        const eventId = config.resolveEventId
          ? await config.resolveEventId(req)
          : ((req.params as any)?.eventId || (req.body as any)?.eventId);

        if (!eventId) {
          return reply.code(403).send({
            error: {
              code: 'FORBIDDEN',
              message: 'Event context required to resolve attendance scan conflicts',
              details: { requiredPolicy: 'attendance:resolve_conflict' },
              requestId: req.id,
            },
          });
        }

        // 1. Staff assignment with checkin capability
        const assignment = await db.query.eventStaffAssignments.findFirst({
          where: and(
            eq(eventStaffAssignments.eventId, eventId),
            eq(eventStaffAssignments.userId, req.user!.id),
            eq(eventStaffAssignments.capability, 'checkin')
          ),
        });
        if (assignment && (!assignment.expiresAt || new Date(assignment.expiresAt) > new Date())) {
          break;
        }

        // 2. Organizer owner/manager
        const targetEvent = await db.query.events.findFirst({
          where: eq(events.id, eventId),
        });
        if (targetEvent) {
          const orgMembership = await db.query.organizerMembers.findFirst({
            where: and(
              eq(organizerMembers.organizerId, targetEvent.organizerId),
              eq(organizerMembers.userId, req.user!.id),
              eq(organizerMembers.status, 'active')
            ),
          });
          if (orgMembership && (orgMembership.role === 'owner' || orgMembership.role === 'manager')) {
            break;
          }
        }

        return reply.code(403).send({
          error: {
            code: 'FORBIDDEN',
            message: 'You do not have permission to resolve attendance scan conflicts',
            details: { requiredPolicy: 'attendance:resolve_conflict', eventId },
            requestId: req.id,
          },
        });
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
