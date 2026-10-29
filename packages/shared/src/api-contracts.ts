/**
 * Eventora Typed API Contracts & Endpoint Registry
 *
 * Enforces synchronized schemas between Fastify backend routes, OpenAPI specification,
 * and frontend apiClient calls.
 */

import { z } from 'zod';
import { ERROR_CODES } from './error-codes.js';

// Base Success & Error Envelope Schemas
export const ApiErrorSchema = z.object({
  code: z.enum(ERROR_CODES),
  message: z.string(),
  details: z.record(z.any()).default({}),
  requestId: z.string(),
});

export const StandardErrorResponseSchema = z.object({
  error: ApiErrorSchema,
});

// Common Entity Schemas
export const PublicEventSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  slug: z.string(),
  description: z.string(),
  category: z.string(),
  format: z.enum(['in_person', 'online', 'hybrid']),
  venueName: z.string().nullable().optional(),
  startsAt: z.string(),
  endsAt: z.string(),
  capacity: z.number().int(),
  pricingType: z.enum(['free', 'paid']),
  currency: z.string(),
  visibility: z.enum(['college', 'public']),
  status: z.string(),
  coverImageUrl: z.string().nullable().optional(),
});

export const TicketTierSchema = z.object({
  id: z.string().uuid(),
  eventId: z.string().uuid(),
  name: z.string(),
  pricePaise: z.number().int().nonnegative(),
  capacity: z.number().int().positive(),
  perUserLimit: z.number().int().positive().default(5),
  sold: z.number().int().nonnegative().default(0),
  held: z.number().int().nonnegative().default(0),
});

export const BookingOrderSchema = z.object({
  orderId: z.string(),
  paymentId: z.string(),
  amountPaise: z.number().int().nonnegative(),
  currency: z.string(),
  checkoutUrl: z.string().nullable().optional(),
  expiresAt: z.string(),
});

export const TicketPassSchema = z.object({
  id: z.string().uuid(),
  bookingId: z.string().uuid(),
  eventId: z.string().uuid(),
  ticketTierId: z.string().uuid(),
  status: z.enum(['VALID', 'CHECKED_IN', 'REVOKED', 'REFUNDED']),
  attendeeName: z.string(),
  qrTokenHash: z.string().optional(),
  checkedInAt: z.string().nullable().optional(),
});

// Endpoint Definitions Map
export const API_ROUTES = {
  // Authentication
  AUTH_LOGIN: {
    path: '/api/v1/auth/login',
    method: 'POST',
    request: z.object({
      email: z.string().email(),
      password: z.string().min(8),
    }),
    response: z.object({
      user: z.object({
        id: z.string().uuid(),
        email: z.string().email(),
        displayName: z.string(),
        role: z.string(),
      }),
      sessionToken: z.string().optional(),
    }),
  },
  AUTH_LOGOUT: {
    path: '/api/v1/auth/logout',
    method: 'POST',
    request: z.object({}).optional(),
    response: z.object({
      success: z.boolean(),
    }),
  },

  // Events
  EVENTS_LIST: {
    path: '/api/v1/events',
    method: 'GET',
    query: z.object({
      limit: z.coerce.number().int().min(1).max(50).default(20),
      cursor: z.string().optional(),
      category: z.string().optional(),
      search: z.string().optional(),
      format: z.enum(['in_person', 'online', 'hybrid']).optional(),
    }),
    response: z.object({
      events: z.array(PublicEventSchema),
      nextCursor: z.string().nullable().optional(),
    }),
  },
  EVENTS_GET: {
    path: '/api/v1/events/:slug',
    method: 'GET',
    params: z.object({
      slug: z.string().min(1),
    }),
    response: z.object({
      event: PublicEventSchema.extend({
        ticketTiers: z.array(TicketTierSchema).optional(),
        organizer: z.object({
          displayName: z.string(),
          status: z.string(),
        }).optional(),
      }),
    }),
  },

  // Bookings & Checkout
  BOOKINGS_CREATE: {
    path: '/api/v1/events/:id/bookings',
    method: 'POST',
    params: z.object({
      id: z.string().uuid(),
    }),
    request: z.object({
      ticketTierId: z.string().uuid(),
      quantity: z.number().int().min(1).max(10).default(1),
      attendeeName: z.string().min(1),
      attendeeRoll: z.string().min(1),
      customAnswers: z.record(z.any()).optional(),
    }),
    response: z.object({
      booking: z.object({
        id: z.string().uuid(),
        status: z.string(),
        totalPaise: z.number().int(),
        expiresAt: z.string(),
      }),
    }),
  },
  CHECKOUT_ORDER: {
    path: '/api/v1/bookings/:id/checkout',
    method: 'POST',
    params: z.object({
      id: z.string().uuid(),
    }),
    request: z.object({}).optional(),
    response: z.object({
      order: BookingOrderSchema,
    }),
  },
  REFUND_REQUEST: {
    path: '/api/v1/bookings/:id/refunds',
    method: 'POST',
    params: z.object({
      id: z.string().uuid(),
    }),
    request: z.object({
      reason: z.string().min(3).max(500),
      idempotencyKey: z.string().min(1).max(255),
      amountPaise: z.number().int().positive().optional(),
    }),
    response: z.object({
      refund: z.object({
        id: z.string().uuid(),
        bookingId: z.string().uuid(),
        status: z.string(),
        amountPaise: z.number().int().nonnegative().optional(),
      }),
      message: z.string(),
    }),
  },

  // Payments
  PAYMENTS_VERIFY: {
    path: '/api/v1/payments/verify',
    method: 'POST',
    request: z.object({
      orderId: z.string(),
      paymentId: z.string(),
    }),
    response: z.object({
      confirmed: z.boolean(),
      status: z.enum(['SUCCEEDED', 'PENDING', 'FAILED']),
      receiptNumber: z.string().optional(),
      bookingId: z.string().uuid().optional(),
    }),
  },

  // Tickets
  MY_TICKETS: {
    path: '/api/v1/me/tickets',
    method: 'GET',
    response: z.object({
      tickets: z.array(
        TicketPassSchema.extend({
          eventTitle: z.string(),
          eventSlug: z.string(),
          startsAt: z.string(),
          venueName: z.string().nullable().optional(),
        })
      ),
    }),
  },
  TICKET_QR: {
    path: '/api/v1/tickets/:id/qr.svg',
    method: 'GET',
    params: z.object({
      id: z.string().uuid(),
    }),
    response: z.object({
      svg: z.string(),
      payload: z.string(),
      offlineManifestRef: z.string().optional(),
    }),
  },

  // Gate Check-in & Scanner
  CHECKIN_SCAN: {
    path: '/api/v1/events/:id/check-in/scan',
    method: 'POST',
    params: z.object({
      id: z.string().uuid(),
    }),
    request: z.object({
      qrToken: z.string(),
      offlineSessionToken: z.string().optional(),
    }),
    response: z.object({
      outcome: z.enum([
        'ACCEPTED',
        'DUPLICATE',
        'INVALID',
        'WRONG_EVENT',
        'REVOKED',
        'OUTSIDE_WINDOW',
        'EVENT_NOT_PUBLISHED',
      ]),
      message: z.string(),
      ticketId: z.string().uuid().optional(),
      checkedInAt: z.string().optional(),
      attendeeInitials: z.string().optional(),
    }),
  },

  // SEO & Open Specification
  OPENAPI_SPEC: {
    path: '/openapi.json',
    method: 'GET',
    response: z.record(z.any()),
  },
  SITEMAP: {
    path: '/sitemap.xml',
    method: 'GET',
    response: z.string(),
  },
  ROBOTS: {
    path: '/robots.txt',
    method: 'GET',
    response: z.string(),
  },
} as const;

export type ApiRouteKey = keyof typeof API_ROUTES;

/**
 * Validates whether an incoming path matches a registered contracted route.
 */
export function matchContractRoute(path: string, method: string): boolean {
  const normMethod = method.toUpperCase();
  for (const route of Object.values(API_ROUTES)) {
    if (route.method !== normMethod) continue;

    // Convert route template (e.g. /api/v1/events/:slug) to RegExp
    const regexPattern = new RegExp(
      '^' + route.path.replace(/:[a-zA-Z0-9_]+/g, '[^/?#]+') + '$'
    );
    if (regexPattern.test(path)) {
      return true;
    }
  }
  return false;
}
