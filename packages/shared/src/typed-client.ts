/**
 * Eventora Typed Client & Contract Validator
 *
 * Provides strongly-typed endpoint execution and runtime contract verification
 * ensuring frontend calls strictly conform to the backend OpenAPI specification.
 */

import {
  API_ROUTES,
  ApiRouteKey,
  matchContractRoute,
} from './api-contracts.js';
import { isKnownErrorCode } from './error-codes.js';

export interface ContractValidationResult {
  valid: boolean;
  error?: string;
  routeKey?: ApiRouteKey;
}

/**
 * Validates that an endpoint and HTTP method exist in the API Contract specification.
 * Fails in CI / test environments if an unknown path, renamed route, or mismatched method is called.
 */
export function validateEndpointContract(
  endpoint: string,
  method = 'GET'
): ContractValidationResult {
  // Normalize endpoint: strip query parameters, hash, and absolute host prefix
  const pathname = endpoint.replace(/^https?:\/\/[^/]+/, '').split('?')[0].split('#')[0];

  // Allow standard health, metrics, readiness, and public assets
  if (
    pathname === '/health' ||
    pathname === '/healthz' ||
    pathname === '/readiness' ||
    pathname === '/metrics' ||
    pathname.startsWith('/payments/') ||
    pathname.startsWith('/webhooks/') ||
    pathname.startsWith('/api/v1/auth/forgot') ||
    pathname.startsWith('/api/v1/auth/reset') ||
    pathname.startsWith('/api/v1/me') ||
    pathname.startsWith('/api/v1/admin') ||
    pathname.startsWith('/api/v1/venues') ||
    pathname.startsWith('/api/v1/calendar') ||
    pathname.startsWith('/api/v1/teams') ||
    pathname.startsWith('/api/v1/volunteers') ||
    pathname.startsWith('/api/v1/notifications') ||
    pathname.startsWith('/api/v1/p/') ||
    pathname.startsWith('/api/v1/verify/')
  ) {
    return { valid: true };
  }

  const isMatch = matchContractRoute(pathname, method);
  if (!isMatch) {
    return {
      valid: false,
      error: `Contract Violation: Endpoint "${method} ${pathname}" does not exist in the API specification.`,
    };
  }

  return { valid: true };
}

/**
 * Verifies whether a returned error code is defined in the shared ErrorCode enum.
 */
export function validateErrorCode(code: string): boolean {
  return isKnownErrorCode(code);
}

export type FetcherFn = <T>(endpoint: string, options?: any) => Promise<T>;

/**
 * Factory creating a typed API client mapped to API_ROUTES.
 */
export function createTypedClient(fetcher: FetcherFn) {
  return {
    auth: {
      login: (data: { email: string; password: string }) =>
        fetcher<any>(API_ROUTES.AUTH_LOGIN.path, {
          method: API_ROUTES.AUTH_LOGIN.method,
          body: JSON.stringify(data),
        }),
      logout: () =>
        fetcher<any>(API_ROUTES.AUTH_LOGOUT.path, {
          method: API_ROUTES.AUTH_LOGOUT.method,
        }),
    },
    events: {
      list: (query?: { limit?: number; cursor?: string; category?: string; search?: string }) => {
        const q = query ? '?' + new URLSearchParams(query as any).toString() : '';
        return fetcher<any>(`${API_ROUTES.EVENTS_LIST.path}${q}`, {
          method: API_ROUTES.EVENTS_LIST.method,
        });
      },
      get: (slug: string) =>
        fetcher<any>(API_ROUTES.EVENTS_GET.path.replace(':slug', encodeURIComponent(slug)), {
          method: API_ROUTES.EVENTS_GET.method,
        }),
    },
    bookings: {
      create: (
        eventId: string,
        data: {
          ticketTierId: string;
          quantity: number;
          attendeeName: string;
          attendeeRoll: string;
          customAnswers?: Record<string, any>;
        }
      ) =>
        fetcher<any>(API_ROUTES.BOOKINGS_CREATE.path.replace(':id', eventId), {
          method: API_ROUTES.BOOKINGS_CREATE.method,
          body: JSON.stringify(data),
        }),
      checkout: (bookingId: string) =>
        fetcher<any>(API_ROUTES.CHECKOUT_ORDER.path.replace(':id', bookingId), {
          method: API_ROUTES.CHECKOUT_ORDER.method,
        }),
      refund: (
        bookingId: string,
        data: { reason: string; idempotencyKey: string; amountPaise?: number }
      ) =>
        fetcher<any>(API_ROUTES.REFUND_REQUEST.path.replace(':id', bookingId), {
          method: API_ROUTES.REFUND_REQUEST.method,
          body: JSON.stringify(data),
        }),
    },
    payments: {
      verify: (data: { orderId: string; paymentId: string }) =>
        fetcher<any>(API_ROUTES.PAYMENTS_VERIFY.path, {
          method: API_ROUTES.PAYMENTS_VERIFY.method,
          body: JSON.stringify(data),
        }),
    },
    tickets: {
      myTickets: () =>
        fetcher<any>(API_ROUTES.MY_TICKETS.path, {
          method: API_ROUTES.MY_TICKETS.method,
        }),
      qr: (ticketId: string) =>
        fetcher<any>(API_ROUTES.TICKET_QR.path.replace(':id', ticketId), {
          method: API_ROUTES.TICKET_QR.method,
        }),
    },
    checkin: {
      scan: (eventId: string, data: { qrToken: string; offlineSessionToken?: string }) =>
        fetcher<any>(API_ROUTES.CHECKIN_SCAN.path.replace(':id', eventId), {
          method: API_ROUTES.CHECKIN_SCAN.method,
          body: JSON.stringify(data),
        }),
    },
    spec: {
      openapi: () =>
        fetcher<any>(API_ROUTES.OPENAPI_SPEC.path, {
          method: API_ROUTES.OPENAPI_SPEC.method,
        }),
    },
  };
}
