# Eventora API Architecture & Contract Specification

**API Version:** `v1`  
**OpenAPI Specification:** OpenAPI 3.0.3  
**Protocol:** RESTful HTTPS with JSON payloads & Server-Sent Events (SSE)  
**Contract Verification:** `scripts/verify-api-contracts.ts` (enforced in CI via `pnpm contracts:check`)

---

## 1. Global Architectural Principles

### 1.1 Standardized Error Envelope
Every non-2xx HTTP response from the Eventora backend strictly implements the standardized error envelope:

```json
{
  "error": {
    "code": "BOOKING_SOLD_OUT",
    "message": "The selected ticket tier has sold out.",
    "details": {},
    "requestId": "req-9f82b7c4-0b1a-4d32"
  }
}
```

- **`code`:** Stable, machine-readable string matching canonical error codes in `@eventora/shared` (`isKnownErrorCode`).
- **`message`:** Human-readable description sanitized for client display (never leaks driver internals or database stack traces).
- **`details`:** Optional validation issue breakdown (e.g. Zod field errors `{ path: 'email', message: 'Invalid email address' }`).
- **`requestId`:** Tracing identifier correlated with server logs and OpenTelemetry spans.

### 1.2 Authentication & Security Policy Header
Every API route enforces authentication and capability policies:
- **Session Tokens:** 256-bit cryptographically secure token passed via `HttpOnly; Secure; SameSite=Lax` cookie.
- **CSRF Defense:** Double-submit cookie pattern with `X-CSRF-Token` header on all state-modifying requests (`POST`, `PUT`, `PATCH`, `DELETE`).
- **Route Authorization:** Deny-by-default hook validates that every registered route explicitly defines `{ auth, policy, objectCheck }`.

### 1.3 Currency & Monetary Invariant
All financial calculations, charges, refunds, and ledger balances are strictly integer values representing paise:
$$\text{paise} = \text{rupees} \times 100$$
Floating-point currency inputs or calculations are rejected at the schema validation boundary.

---

## 2. Core API Endpoint Catalog

### 2.1 Authentication & Profile (`/api/v1/auth`, `/api/v1/me`)
- `POST /api/v1/auth/register` — Register a new student or campus organizer account (Argon2id hashing, rate limited).
- `POST /api/v1/auth/login` — Authenticate credentials, set session cookie, issue CSRF token.
- `POST /api/v1/auth/logout` — Revoke active session in database and purge browser cookies.
- `GET /api/v1/auth/session` — Retrieve current caller session identity, active roles, and college tenancy.
- `GET /api/v1/auth/csrf` — Public endpoint to obtain initial CSRF token cookie and response payload.
- `GET /api/v1/me` — Retrieve student profile, preferences, and permissions.

### 2.2 Events & Lifecycle Management (`/api/v1/events`)
- `GET /api/v1/events` — Public discovery listing published events with faceted filters (category, date, venue, price).
- `POST /api/v1/events` — Propose a new campus event (requires `event:create` policy; caller must belong to organizer).
- `GET /api/v1/events/:id` — Detailed event metadata, ticket tiers, venue, and registration status.
- `PUT /api/v1/events/:id` — Update draft or changes-requested event details (`event:manage:owned`).
- `POST /api/v1/events/:id/submit` — Submit event proposal for faculty/admin review.
- `POST /api/v1/events/:id/approval` — Faculty reviewer decision endpoint (`APPROVED`, `CHANGES_REQUESTED`, `REJECTED`).
- `POST /api/v1/events/:id/publish` — Publish approved event to campus discovery catalog.

### 2.3 Registrations, Bookings & Waitlist (`/api/v1/bookings`, `/api/v1/waitlist`)
- `POST /api/v1/events/:id/bookings` — Atomically book seats with `SELECT ... FOR UPDATE` capacity lock.
- `GET /api/v1/bookings/:id` — Retrieve booking summary and line items (object-level check: student or organizer).
- `POST /api/v1/bookings/:id/checkout` — Initiate payment checkout flow or confirm free registration.
- `POST /api/v1/bookings/:id/cancel` — Student cancellation; releases seats and enqueues waitlist promotion.
- `POST /api/v1/events/:id/waitlist` — Join waitlist queue when ticket tier capacity is depleted.
- `POST /api/v1/waitlist/:id/claim` — Claim offered waitlist reservation within 15-minute offer window.

### 2.4 Turnstile Attendance & Offline Check-In (`/api/v1/events/:id/check-in`)
- `POST /api/v1/events/:id/check-in/scan` — High-speed turnstile scan validating opaque 43-char QR tokens.
- `GET /api/v1/events/:id/check-in/manifest` — Download HMAC-signed offline ticket manifest for mobile scanners.
- `POST /api/v1/events/:id/check-in/sync-batch` — Upload queued offline scan batches with conflict detection.
- `POST /api/v1/conflicts/:id/resolve` — Supervisor resolution for multi-device scan discrepancies.

### 2.5 Payments, Refunds & Webhooks (`/api/v1/payments`, `/api/v1/webhooks`)
- `POST /api/v1/payments/verify` — Verify signed gateway callback and confirm booking.
- `POST /api/v1/webhooks/payments` — Inbound payment provider webhook (HMAC signature required).
- `POST /api/v1/webhooks/resend` — Inbound email event webhook (bounces, deliveries, spam complaints).
- `POST /api/v1/bookings/:id/refund` — Request ticket refund (validates cancellation policy and ledger status).

### 2.6 Organizer Financial Ledger & Reporting (`/api/v1/organizers`)
- `GET /api/v1/organizers/:id/ledger` — Double-entry accounting journal of `SALE` and `REFUND` transactions.
- `GET /api/v1/organizers/:id/sales` — Aggregate sales analytics, tier breakdown, and net revenue in paise.
- `POST /api/v1/organizer/events/:id/exports` — Queue asynchronous, sanitized CSV export jobs.
- `GET /api/v1/exports/download/:token` — Download generated CSV report via single-use signed token.

### 2.7 Passports, Verifications & System Probes (`/api/v1/me/passport`, `/health`)
- `GET /api/v1/me/passport` — Authenticated student achievement passport and participation logs.
- `GET /api/v1/p/:slug` — Public passport viewing (redacts PII; private passports return indistinguishable 404).
- `GET /api/v1/verify/:code` — Public certificate verification endpoint checking SHA-256 integrity hash.
- `GET /health` — Liveness probe checking container status and memory bounds.
- `GET /readiness` — Readiness probe checking PostgreSQL and Redis connection pool availability.
- `GET /metrics` — Prometheus telemetry scrape target.

---

## 3. OpenAPI 3.0 Generation & CI Contract Verification

Fastify generates the dynamic OpenAPI 3.0 specification via `@fastify/swagger` and `fastify-type-provider-zod`.
The test suite `scripts/verify-api-contracts.ts` guarantees that:
1. Every path registered in backend routing exists in frontend client SDK `API_ROUTES`.
2. Every request parameter and payload matches strict Zod schemas.
3. Every error code returned by endpoints belongs to canonical `@eventora/shared` constants.
