import { describe, it, expect, beforeAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../packages/backend/src/app.js';
import {
  ERROR_CODES,
  ErrorCode,
  StrictErrorEnvelopeSchema,
  API_ROUTES,
  createTypedClient,
  validateEndpointContract,
} from '@eventora/shared';

describe('Phase P31: API Contracts, OpenAPI Derivation & Guard Verification', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  describe('1. OpenAPI 3.0 Derivation via Zod & Swagger', () => {
    it('serves OpenAPI 3.0 specification from /openapi.json with expected info and servers', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/openapi.json',
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.openapi).toMatch(/^3\.0\./);
      expect(json.info).toBeDefined();
      expect(json.info.title).toBe('Eventora API');
      expect(json.info.version).toBe('1.0.0');
      expect(json.paths).toBeDefined();
    });

    it('serves identical OpenAPI 3.0 specification from /api/v1/openapi.json', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/openapi.json',
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.openapi).toMatch(/^3\.0\./);
      expect(json.info).toBeDefined();
      expect(json.info.title).toBe('Eventora API');
    });

    it('documents key core domain endpoints in the derived OpenAPI paths', async () => {
      const swagger = (app as any).swagger();
      const paths = Object.keys(swagger.paths);

      // Verify standard routes exist in swagger
      expect(paths).toContain('/api/v1/auth/login');
      expect(paths).toContain('/api/v1/events/');
      expect(paths).toContain('/api/v1/events/{id}');
      expect(paths).toContain('/api/v1/bookings/{id}/checkout');
      expect(paths).toContain('/api/v1/bookings/{id}/refunds');
      expect(paths).toContain('/api/v1/tickets/{id}');
    });

    it('exposes security schemes including bearerAuth in OpenAPI spec', async () => {
      const swagger = (app as any).swagger();
      expect(swagger.components).toBeDefined();
      expect(swagger.components.securitySchemes).toBeDefined();
      expect(swagger.components.securitySchemes.bearerAuth).toEqual({
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      });
    });
  });

  describe('2. Shared Error-Code Enum & Strict Error Envelope', () => {
    it('contains all required business error codes across auth, booking, payments, tickets, check-in and feedback', () => {
      const requiredCodes: ErrorCode[] = [
        'UNAUTHORIZED',
        'FORBIDDEN',
        'CSRF_INVALID',
        'EMAIL_NOT_VERIFIED',
        'HOLD_EXPIRED',
        'SOLD_OUT',
        'PAYMENT_FAILED',
        'PAYMENT_PENDING',
        'REFUND_FAILED',
        'QR_INVALID',
        'QR_EXPIRED',
        'ALREADY_CHECKED_IN',
        'TICKET_REVOKED',
        'FEEDBACK_LOCKED',
        'INELIGIBLE_NOT_ATTENDED',
        'VALIDATION_ERROR',
        'RATE_LIMITED',
        'NOT_FOUND',
      ];

      for (const code of requiredCodes) {
        expect(ERROR_CODES).toContain(code);
      }
    });

    it('accepts compliant error envelopes with recognized ErrorCode values', () => {
      const sample = {
        error: {
          code: 'HOLD_EXPIRED' as const,
          message: 'The ticket reservation hold has timed out',
          requestId: 'req-abc-123',
          details: { holdExpiresAt: '2026-10-29T12:00:00Z' },
        },
      };

      const result = StrictErrorEnvelopeSchema.safeParse(sample);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.error.code).toBe('HOLD_EXPIRED');
      }
    });

    it('FAIL-CHECK: StrictErrorEnvelopeSchema rejects uncontracted error code (e.g. BOOKING_EXPIRED instead of HOLD_EXPIRED)', () => {
      const invalidSample = {
        error: {
          code: 'BOOKING_EXPIRED', // Invalid! Must be HOLD_EXPIRED
          message: 'Reservation timed out',
          requestId: 'req-456',
        },
      };

      const result = StrictErrorEnvelopeSchema.safeParse(invalidSample);
      expect(result.success).toBe(false);
      if (!result.success) {
        const issues = result.error.issues;
        expect(issues.some((issue) => issue.path.includes('code'))).toBe(true);
      }
    });
  });

  describe('3. Typed Client & Endpoint Contract Validation', () => {
    it('successfully validates responses against API_ROUTES schemas', () => {
      const validEventDetail = {
        event: {
          id: '123e4567-e89b-12d3-a456-426614174000',
          title: 'Tech Fest 2026',
          slug: 'tech-fest-2026',
          description: 'Annual technical conference and hackathon',
          category: 'technical',
          format: 'in_person' as const,
          startsAt: '2026-11-10T09:00:00Z',
          endsAt: '2026-11-10T17:00:00Z',
          capacity: 500,
          pricingType: 'free' as const,
          currency: 'INR',
          visibility: 'public' as const,
          status: 'published',
        },
      };

      const validated = API_ROUTES.EVENTS_GET.response.parse(validEventDetail);
      expect(validated.event.id).toBe('123e4567-e89b-12d3-a456-426614174000');
      expect(validated.event.title).toBe('Tech Fest 2026');
    });

    it('typed client delegates HTTP calls and validates contracts', async () => {
      const mockRawFetcher = async (endpoint: string) => {
        if (endpoint === '/api/v1/events/mock-fest') {
          return {
            event: {
              id: 'evt-100',
              title: 'Mock Fest',
              slug: 'mock-fest',
              description: 'Mock fest description',
              category: 'cultural',
              format: 'in_person',
              startsAt: '2026-11-10T09:00:00Z',
              endsAt: '2026-11-10T17:00:00Z',
              capacity: 100,
              pricingType: 'free',
              currency: 'INR',
              visibility: 'public',
              status: 'published',
            },
          };
        }
        throw new Error('Not found');
      };

      const typed = createTypedClient(mockRawFetcher);
      const res = await typed.events.get('mock-fest');
      expect(res.event.id).toBe('evt-100');
      expect(res.event.title).toBe('Mock Fest');
    });

    it('validateEndpointContract detects matching and non-matching endpoints', () => {
      const validCheck = validateEndpointContract('/api/v1/events/hackathon', 'GET');
      expect(validCheck.valid).toBe(true);

      const invalidCheck = validateEndpointContract('/api/v1/unregistered/random/route', 'GET');
      expect(invalidCheck.valid).toBe(false);
      expect(invalidCheck.error).toContain('Contract Violation');
    });

    it('enforces integer paise for refund requests (contract guard against floats)', () => {
      const validRefundPayload = {
        reason: 'Unable to attend due to medical emergency',
        idempotencyKey: 'idemp-refund-001',
        amountPaise: 49900,
      };
      const parseValid = API_ROUTES.REFUND_REQUEST.request.safeParse(validRefundPayload);
      expect(parseValid.success).toBe(true);

      const invalidFloatPayload = {
        reason: 'Refund test',
        idempotencyKey: 'idemp-refund-002',
        amountPaise: 499.5, // Floats are strictly prohibited!
      };
      const parseInvalid = API_ROUTES.REFUND_REQUEST.request.safeParse(invalidFloatPayload);
      expect(parseInvalid.success).toBe(false);
    });
  });

  describe('4. Mandatory Acceptance Criteria: Breaking Changes & Uncontracted Reference Detection', () => {
    it('FAILS when a route is renamed (e.g. /api/v1/events -> /api/v1/renamed_events)', () => {
      const renamedPath = '/api/v1/renamed_events';
      const swagger = (app as any).swagger();
      const registeredPaths = new Set(Object.keys(swagger.paths || {}));

      // Assert the renamed route does NOT exist in backend
      const existsInSwagger = registeredPaths.has(renamedPath) || registeredPaths.has(renamedPath + '/');
      const existsInFastify = (app as any).hasRoute({ method: 'GET', url: renamedPath });

      expect(existsInSwagger).toBe(false);
      expect(existsInFastify).toBe(false);
    });

    it('FAILS when uncontracted /refund is referenced instead of /refunds', () => {
      // Contract route defines /api/v1/bookings/:id/refunds (plural)
      const correctContract = API_ROUTES.REFUND_REQUEST.path;
      expect(correctContract).toBe('/api/v1/bookings/:id/refunds');

      const singularIncorrectPath = '/api/v1/bookings/:id/refund';
      const hasIncorrectRoute = (app as any).hasRoute({ method: 'POST', url: singularIncorrectPath });
      expect(hasIncorrectRoute).toBe(false);
    });

    it('FAILS when client expects payload wrapped in incorrect field nesting (e.g. order.orderId vs data.orderId)', () => {
      // Contract expects checkout response to contain { order: BookingOrderSchema }
      const validCheckoutResponse = {
        order: {
          orderId: 'order_test_999',
          paymentId: 'pay_test_999',
          amountPaise: 150000,
          currency: 'INR',
          expiresAt: '2026-10-29T18:00:00Z',
        },
      };

      const parseCorrect = API_ROUTES.CHECKOUT_ORDER.response.safeParse(validCheckoutResponse);
      expect(parseCorrect.success).toBe(true);

      // Incorrect nesting: { data: { orderId: ... } } instead of order: BookingOrderSchema
      const incorrectNestingResponse = {
        data: {
          orderId: 'order_test_999',
        },
        amountPaise: 150000,
        currency: 'INR',
      };

      const parseIncorrect = API_ROUTES.CHECKOUT_ORDER.response.safeParse(incorrectNestingResponse);
      expect(parseIncorrect.success).toBe(false);
    });

    it('FAILS contract test when an uncontracted error code is used in place of standard enum', () => {
      const bogusCodes = [
        'BOOKING_EXPIRED',      // Should be HOLD_EXPIRED
        'OUT_OF_STOCK',        // Should be SOLD_OUT
        'NOT_PERMITTED',       // Should be FORBIDDEN
        'SOMETHING_WENT_WRONG' // Non-standard code
      ];

      for (const bogus of bogusCodes) {
        expect(ERROR_CODES).not.toContain(bogus as any);
        const envelope = {
          error: {
            code: bogus,
            message: 'Test message',
            requestId: 'req-fail-test',
          },
        };
        const res = StrictErrorEnvelopeSchema.safeParse(envelope);
        expect(res.success).toBe(false);
      }
    });
  });
});
