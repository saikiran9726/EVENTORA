# Eventora Overhaul Changelog

## Phase P05 — Frontend Foundation A: API Client, Auth State & Error Handling

**Date:** 2026-10-26  
**Author:** Principal Full-Stack Engineer  
**Status:** Complete & Verified  

---

### 1. Eliminating Raw Network Calls & LocalStorage Tokens
- **Zero Raw Fetch Calls:** Migrated `PublicPassportPage.tsx` and `PublicVerifyPage.tsx` from raw browser `fetch()` to typed `apiClient.get<T>()`.
- **Zero LocalStorage Auth Token Reads:** Removed legacy `localStorage.getItem('eventora_auth_token')` reads and manual `Authorization: Bearer` injections from `ExportDialog.tsx`, `FeedbackSheet.tsx`, `CheckoutPage.tsx`, and `OrganizerDashboardPage.tsx`. Auth now relies strictly on HTTP-only session cookies with double-submit CSRF protection.
- **ESLint Rule Enforcement:** Configured `no-restricted-syntax` in `eslint.config.js` targeting `packages/frontend/src/**/*.{ts,tsx}`:
  - Prohibits `CallExpression[callee.name='fetch']` (except in `api-client.ts`).
  - Prohibits `Literal[value='eventora_auth_token']`.
  - Verified 0 errors across codebase via `pnpm lint`.

---

### 2. API Client Hardening (`packages/frontend/src/lib/api-client.ts`)
- **Global Unauthorized Callback:** Added `apiClient.setOnUnauthorized(cb)` called whenever the server responds with HTTP 401.
- **Abort Listener Leak Prevention:** Explicitly detached external `signal` event listeners in `finally` block using `removeEventListener('abort', ...)`.
- **Abort vs Timeout Differentiation:**
  - External abort signal produces `ApiError('USER_ABORTED', 'Request was aborted by user', ..., status: 499)`.
  - Request timeout produces `ApiError('REQUEST_TIMEOUT', 'The operation timed out...', ..., status: 408)`.
- **Idempotent Retry with Exponential Backoff:**
  - Idempotent HTTP methods (`GET`, `HEAD`, `OPTIONS`) automatically retry on 502, 503, 504 and transient network errors with exponential backoff and jitter.
  - State-changing methods (`POST`, `PUT`, `PATCH`, `DELETE`) are strictly excluded from retries.
- **Render Cold-Start Detection:**
  - Requests exceeding 3000ms trigger `onColdStartHandler(true)` and dispatch `eventora:server-waking` custom event.
  - Upon completion, `onColdStartHandler(false)` is invoked and dispatches `eventora:server-ready`.
  - Connected to a banner in `App.tsx` notifying users of server spin-up.
- **Type-Safe Convenience Methods:** Added `apiClient.get`, `apiClient.post`, `apiClient.put`, `apiClient.patch`, and `apiClient.delete`.

---

### 3. TanStack Query Integration & Error Reporting
- **Query Client Setup:** Added `@tanstack/react-query` to `@eventora/frontend`, configured `packages/frontend/src/lib/query-client.ts` with `staleTime: 30s`, `gcTime: 5m`, and status-aware error retry heuristics (skips 400/401/403/404/409/422).
- **QueryClientProvider:** Wrapped application root in `App.tsx` with `<QueryClientProvider client={queryClient}>`.
- **Error Reporter:** Added `packages/frontend/src/lib/error-reporter.ts` (`reportError`) with structured diagnostic metadata.
- **Global Handlers:** Registered `window.addEventListener('unhandledrejection')` and `window.addEventListener('error')` in `packages/frontend/src/main.tsx`.

---

### 4. AuthContext State Hardening (`packages/frontend/src/context/AuthContext.tsx`)
- **Stale Closure Elimination:** Utilized `userRef` synchronized synchronously with `setUser` to prevent stale closure bugs in `refreshUser` and unauthorized handlers.
- **Strict Login Verification:** Login calls `/api/v1/auth/login` and immediately verifies the session authoritatively via `/api/v1/me`. If `/me` fails, login aborts, clears state, and reports verification error instead of leaving the client in a broken half-authenticated state.
- **Session Expiration & Return Path Restoration:** Registered `apiClient.setOnUnauthorized`:
  - When unauthorized event fires for an authenticated user, saves current route in `returnPath`, clears user state, and opens `ExpiredSessionModal`.
  - When re-logging in, restores user immediately to the original `returnPath`.

---

### 5. Automated Verification & Regression Gates
- **Unit Tests:**
  - `tests/unit/api-client.test.ts`: 10 tests verifying CSRF injection, envelope parsing, unauthorized callbacks, cold start, timeout/abort distinction, and idempotent retries.
  - `tests/unit/phase-p05-frontend-foundation.test.ts`: 7 tests verifying 0 raw fetches, 0 token reads, ESLint rules, TanStack Query mounting, and unhandled rejection hooks.
- **Full Vitest Suite:** 32 test files, 273 tests passing (100%).
- **Production Build:** Vite production build passes in 4.19s with 0 errors (`pnpm build:frontend`).
- **E2E Test:** Added automated journey in `tests/e2e/auth-flow.spec.ts` verifying session expiration (401), session expired modal popup, and return path restoration after re-login.

---

## Phase P02 — Auth: Tokens, Verification, Reset, Sessions & CSRF

**Date:** 2026-10-26  
**Author:** Principal Full-Stack Engineer  
**Status:** Complete & Verified  

---

### 1. Database Migrations & Schema Architecture

- **Migration 12 (`Phase 12: Auth Token Purpose Separation & Session Hardening`):**
  - Added `purpose VARCHAR(50) DEFAULT 'reset_password' NOT NULL` to table `password_resets`.
  - Added check constraint `chk_password_resets_purpose CHECK (purpose IN ('verify_email', 'reset_password'))`.
  - Added version 12 registration into `schema_migrations`.
- **Down-Migration Engine (`packages/backend/src/db/migrate-down.ts`):**
  - Added atomic rollback step 12 -> 11 dropping constraint `chk_password_resets_purpose`, dropping column `purpose`, and removing version 12 record.
  - Verified expand/contract rollback down to version 11 and up-migration to version 12 on PostgreSQL.
- **Drizzle Schema Alignment (`packages/backend/src/db/schema.ts`):**
  - Updated `passwordResets` table definition to declare `purpose: varchar('purpose', { length: 50 }).default('reset_password').notNull()`.

---

### 2. Token Security & Purpose Separation

- **Token Purpose Segregation:**
  - Registration and resend verification tokens are inserted with `purpose: 'verify_email'`.
  - Password reset tokens are inserted with `purpose: 'reset_password'`.
  - `/api/v1/auth/verify-email` atomically consumes tokens with:
    `UPDATE password_resets SET used_at = now WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now AND purpose = 'verify_email' RETURNING user_id`.
  - `/api/v1/auth/reset` atomically consumes tokens with:
    `UPDATE password_resets SET used_at = now WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now AND purpose = 'reset_password' RETURNING user_id`.
  - Cross-purpose attacks (using a verification token on `/reset` or a reset token on `/verify-email`) fail with 400 `INVALID_OR_EXPIRED_TOKEN`.
- **Token Invalidation on Resend and Reset:**
  - `/api/v1/auth/resend-verification` marks all unconsumed prior `verify_email` tokens for the user as used (`used_at = NOW()`) before issuing a fresh token.
  - `/api/v1/auth/reset` marks all outstanding `reset_password` tokens for the user as used and immediately revokes all active sessions for that user.
- **Token Suppression in Production:**
  - `/api/v1/auth/register`, `/api/v1/auth/forgot`, and `/api/v1/auth/resend-verification` only include tokens in response payloads if `process.env.NODE_ENV === 'test'`.
  - In development and production environments, tokens are strictly excluded from response JSON.
  - Removed `token` field completely from `/api/v1/auth/login` JSON response; authentication tokens are transported exclusively via HttpOnly, Secure, SameSite=Lax cookies.

---

### 3. Password Policy & Identity Protection

- **Password Denylist (`packages/backend/src/services/password-denylist.ts`):**
  - Implemented `isCommonPassword` check against common weak passwords, dictionary words, and predictable alphanumeric permutations.
  - Integrated denylist into Zod validation rules for registration and password reset.
- **Password Length Boundary:**
  - Enforced `max(128)` on all password schemas to mitigate bcrypt/argon2 Denial-of-Service attacks.
- **Email Normalization & Domain Enforcement:**
  - Standardized email inputs using `z.string().trim().toLowerCase().email()` across all routes.
  - Retained strict active campus domain mapping; unverified or non-campus domains return 400 `INVALID_COLLEGE_DOMAIN`.
- **Anti-Enumeration Uniform Responses:**
  - Registration returns a uniform 201 response if an account already exists with that email, eliminating `EMAIL_ALREADY_EXISTS` account harvesting vectors.

---

### 4. Rate Limiting & Denial-of-Service Defense

- **Isolated IP & Account Failure Budgets (`packages/backend/src/services/redis.ts`):**
  - Added `checkRateLimitThreshold`, `recordRateLimitFailure`, and `clearRateLimit`.
  - Login checks failures per IP (`login:fail:ip:${clientIp}`, limit: 10/min) and per account per IP (`login:fail:account:${clientIp}:${email}`, limit: 5/min).
  - Successful logins do not consume failure budget and clear recorded failures for the account on that IP.
  - An attacker on IP A attempting to brute-force a victim account exhausts their own budget without causing the victim on IP B to be locked out.

---

### 5. Session Management & Device Control

- **Throttled `last_seen_at` Writes:**
  - In `validateSession`, updated session sliding idle window writes to only execute when `now - lastSeenAt >= 60,000` ms, drastically decreasing database update churn.
- **Privilege Escalation Session Revocation:**
  - In `/api/v1/admin/users/:id/role`, modified role update handler to revoke all active sessions for the target user whenever `globalRole` changes or user is suspended.
- **Device Management Endpoints (`packages/backend/src/routes/api/v1/me.ts`):**
  - `GET /api/v1/me/sessions`: Lists active sessions for the current user including hex session IDs, timestamps, and `isCurrent` device flag.
  - `DELETE /api/v1/me/sessions`: Revokes all other sessions for the user (or all sessions if `?all=true`).
  - `DELETE /api/v1/me/sessions/:id`: Revokes a specific session device by its ID, clearing cookies if revoking current session.

---

### 6. CSRF Hardening

- **Origin & Sec-Fetch-Site Policy (`packages/backend/src/plugins/auth-policy.ts`):**
  - Retained double-submit CSRF cookie and `x-csrf-token` header validation.
  - Enforced `Sec-Fetch-Site: same-origin|none|same-site` on state-changing authenticated methods (`POST`, `PUT`, `PATCH`, `DELETE`). Requests with `Sec-Fetch-Site: cross-site` are immediately rejected with 403 `CSRF_FETCH_SITE_REJECTED`.
  - In non-test environments (and when strict check is asserted), verified that at least `Origin` or `Sec-Fetch-Site` is present, rejecting ambient cross-site requests with 403 `CSRF_ORIGIN_REQUIRED`.
  - Enforced `Origin` validation against local host, Vercel deployments, and configured CORS domains.

---

### 7. Verification & Automated Regression Coverage

- **New Security Test Suite:**
  - `tests/security/phase-p02-auth-security.test.ts` (20 automated tests passing 100%).
- **Full Vitest Suite:**
  - 30 test files, 241 tests passing (100%).
- **Full Playwright Browser Suite:**
  - 11 spec files, 75 tests passing across Mobile-375, Tablet-768, and Desktop-1280 (100%).
- **Static Analysis & Builds:**
  - TypeScript typecheck passed with 0 errors across `@eventora/shared`, `@eventora/backend`, and `@eventora/frontend`.
  - ESLint passed with 0 errors.
  - Production build succeeded for all packages.

---

## Phase P03 — Proxy, CORS, Rate Limiting, Headers & Metrics

**Date:** 2026-10-26  
**Author:** Principal Full-Stack Engineer  
**Status:** Complete & Verified  

---

### 1. Reverse-Proxy & Client IP Trust

- **Configured `fastify({ trustProxy: 1 })` (`packages/backend/src/app.ts`):**
  - Configured proxy-addr to trust exactly 1 hop (the immediate upstream reverse proxy on Render / Vercel).
  - Deleted all manual, vulnerable `x-forwarded-for` and `x-client-ip` parsing across the codebase.
  - All route handlers and plugins now access `req.ip` directly.
  - Verified immunity to prepended `X-Forwarded-For` IP rotation attacks (`1.1.1.1, realIp`, `2.2.2.2, realIp`); Fastify resolves `req.ip` strictly to the real client IP.

---

### 2. Strict CORS Allow-List

- **Configured Strict Allow-List (`packages/backend/src/app.ts`):**
  - Replaced insecure `.endsWith('.vercel.app')` pattern matching with a strict allow-list `Set` parsed from comma-separated `CORS_ORIGIN`.
  - Calling `cb(null, false)` for unknown origins prevents `@fastify/cors` from reflecting foreign `Origin` headers into `Access-Control-Allow-Origin`.
  - In non-production environments (development and test), `http://localhost:5173` and `http://127.0.0.1:5173` are permitted automatically.

---

### 3. Redis Distributed Rate Limiter & Scopes

- **Redis-Backed Limiter Plugin (`packages/backend/src/plugins/rate-limiter.ts`):**
  - Replaced the in-memory Map limiter and timer intervals with Redis-backed sliding-window rate limiting via `checkRateLimit` from `services/redis.ts`.
  - Registered in `preHandler` hook after `authPolicyPlugin` so `req.user` is populated.
  - Key derivation: `${rule.scope}:${req.ip}:${userId}`. Ensures campus/corporate shared-proxy NAT users have independent rate limit budgets.
  - Implemented 12 protected scopes:
    1. `register`: `POST /api/v1/auth/register` (max 10, window 60s)
    2. `login`: `POST /api/v1/auth/login` (max 10, window 60s)
    3. `forgot`: `POST /api/v1/auth/forgot-password` (max 5, window 60s)
    4. `verify`: `POST /api/v1/auth/verify-email`, `POST /api/v1/auth/reset-password` (max 10, window 60s)
    5. `booking`: `POST /api/v1/events/:id/bookings` (max 10, window 60s)
    6. `checkout`: `POST /api/v1/bookings/:id/checkout` (max 20, window 60s)
    7. `payments/verify`: `POST /api/v1/payments/verify`, `POST /api/v1/payments/checkout/verify` (max 20, window 60s)
    8. `scan`: `POST /api/v1/events/:id/check-in/scan`, `POST /api/v1/events/:id/check-in/sync-batch` (max 120, window 60s)
    9. `feedback`: `POST /api/v1/events/:id/feedback`, `POST /api/v1/events/:id/feedback/replies`, `POST /api/v1/events/:id/feedback/flag` (max 10, window 60s)
    10. `alerts`: `POST /api/v1/events/:id/alerts`, `POST /api/v1/alerts/broadcast` (max 10, window 60s)
    11. `exports`: `POST /api/v1/organizer/events/:id/exports`, `GET /api/v1/exports/download/:token` (max 10, window 60s)
    12. `public verify/passport`: `GET /api/v1/verify/:code`, `GET /api/v1/p/:slug`, `GET /p/:slug`, `GET /api/v1/crosscollege-passport/:id` (max 30, window 60s)
  - Emits standard `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers on all evaluated routes.
  - Emits `Retry-After` header and uniform `{ error: { code: 'RATE_LIMIT_EXCEEDED', message, details, requestId } }` envelope on 429.
- **Fixed Callers Treating checkRateLimit as Boolean:**
  - Repaired `packages/backend/src/routes/api/v1/bookings.ts:52`: Changed `const allowed = await checkRateLimit(...); if (!allowed)` to `const rl = await checkRateLimit(...); if (!rl.allowed)`.
  - Repaired `packages/backend/src/routes/api/v1/teams.ts:222`: Changed `const allowed = await checkRateLimit(...); if (!allowed)` to `const rl = await checkRateLimit(...); if (!rl.allowed)`.

---

### 4. Metrics Authentication & Cardinality Bounding

- **Constant-Time Metrics Authentication (`packages/backend/src/routes/monitoring.ts`):**
  - Removed insecure IP/CIDR heuristic checks (`isInternalNetwork`) that permitted unauthenticated access to Prometheus internals from local/RFC-1918 subnets.
  - `/metrics` now exclusively validates `X-Metrics-Token` header using `constantTimeCompare(token, config.METRICS_SECRET)`. Missing or invalid tokens return 401 `UNAUTHORIZED`.
- **Cardinality Explosion Defense (`packages/backend/src/app.ts`):**
  - In `app.addHook('onResponse', ...)`, mapped unmatched routes and wildcard catch-all paths (`/*`) to `'__unmatched__'` label instead of raw URL paths, preventing bot scanners and 404 floods from causing metric memory explosion.

---

### 5. SPA Security Headers

- **Updated `vercel.json` & `packages/frontend/vercel.json`:**
  - Added `"headers"` configuration for `/(.*)` with production security headers:
    - `Content-Security-Policy`: `"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https://eventora-api-p35a.onrender.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';"`
    - `Strict-Transport-Security`: `"max-age=31536000; includeSubDomains; preload"`
    - `X-Content-Type-Options`: `"nosniff"`
    - `X-Frame-Options`: `"DENY"`
    - `Referrer-Policy`: `"strict-origin-when-cross-origin"`
    - `Permissions-Policy`: `"camera=(self), microphone=(), geolocation=()"`

---

### 6. Verification & Automated Regression Coverage

- **New Security Test Suite:**
  - `tests/security/phase-p03-security.test.ts` (12 automated tests passing 100%):
    - Spoofed XFF immunity: changing prepended IPs does not evade rate limits.
    - Shared-proxy isolation: User A throttling does not affect User B on the same IP.
    - Strict CORS rejection: foreign origins receive no allow headers; configured origins pass.
    - Metrics authentication: 401 on missing/bad token, 200 with Prometheus text on valid token.
    - Metric cardinality protection: unmatched 404 paths mapped to `__unmatched__`.
    - Rate limit headers & 429 response verification across public and authenticated scopes.
    - Vercel SPA security headers verification.
- **Updated Existing Tests:**
  - `tests/unit/phase11-gate.test.ts`: Updated test 3 to assert 401 `UNAUTHORIZED` when `X-Metrics-Token` is missing.
- **Full Vitest Suite:**
  - 31 test files, 253 tests passing (100%).
- **Full Playwright Browser Suite:**
  - 11 spec files, 75 tests passing across Mobile-375, Tablet-768, and Desktop-1280 (100%).
- **Static Analysis & Builds:**
  - TypeScript typecheck passed with 0 errors.
  - ESLint passed with 0 errors.
  - Production build passed for all workspace packages.

---

## Phase P04 — Authorization Rewrite (RBAC, IDOR, Params)

**Date:** 2026-10-26  
**Author:** Principal Full-Stack Engineer  
**Status:** Complete & Verified  

---

### 1. Route Policy Decoupling & Explicit Event Resolvers

- **Removed URL Path Heuristics (`packages/backend/src/plugins/auth-policy.ts`):**
  - Eliminated all `req.url.includes(...)` substring heuristics previously used to guess entity types from `:id`.
  - Added explicit `resolveEventId?: (req: FastifyRequest) => Promise<string | null | undefined> | string | null | undefined` to `RouteConfigPolicy` interface and `RouteShorthandOptions`.
  - Hoisted all dynamic database and schema imports (`db`, `events`, `organizerMembers`, `eventStaffAssignments`) to the module top level.
- **Fail-Closed Missing Context:**
  - In `event:manage:owned`, `attendance:checkin:assigned`, `attendance:resolve_conflict`, `analytics:view:owned`, and `export:owned`, missing event or organizer contexts strictly fail closed with 403 `FORBIDDEN` (eliminating silent policy bypasses).
- **Hardened Check-in & Conflict Capabilities:**
  - `attendance:resolve_conflict` policy now strictly enforces that event staff possess the dedicated `capability === 'checkin'`, or that the user is an active `owner` or `manager` of the event's organizer club.
- **Configured Explicit Resolvers on Sub-Resource Routes:**
  - `POST /api/v1/tickets/:id/revoke`: Resolves `eventId` via `getTicketById(id)`.
  - `POST /api/v1/feedback/:id/moderate`: Resolves `eventId` via `event_feedback.event_id`.
  - `POST /api/v1/volunteer-roles/:id/shifts`: Resolves `eventId` via `volunteer_roles.event_id`.
  - `GET /api/v1/shifts/:id/applications`: Resolves `eventId` via `volunteer_shifts -> volunteer_roles.event_id`.
  - `POST /api/v1/applications/:id/(approve|assign|reject|complete)`: Resolves `eventId` via `volunteer_applications -> volunteer_shifts -> volunteer_roles.event_id`.
  - `PATCH /api/v1/issues/:id`: Resolves `eventId` via `support_issues.event_id`.
  - `POST /api/v1/conflicts/:id/resolve`: Resolves `eventId` via `scan_conflicts.event_id`.

---

### 2. Global Route Parameter UUID Validation

- **Global `preValidation` Hook (`packages/backend/src/app.ts`):**
  - Added a global fastify `preValidation` hook inspecting all request route parameters in `req.params`.
  - Any parameter named `id` or ending with `Id` is strictly validated against UUID syntax `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`.
  - Non-UUID inputs immediately terminate with HTTP 400 `{ error: { code: 'INVALID_ID', message: "Route parameter '...' must be a valid UUID", details: { parameter, value }, requestId } }`, preventing invalid syntax from ever reaching database drivers or causing unhandled 500 errors.
  - Excluded `/api/v1/me/sessions/:id` (which uses a 64-character SHA-256 session token hash rather than an entity UUID).

---

### 3. Anti-Self-Dealing Guard on Refunds

- **Self-Dealing Prohibition (`packages/backend/src/services/payment.ts`):**
  - In `decideRefund`, added verification against self-approval:
    `if (ref.requested_by === userId || ref.booking_user_id === userId) throw new PaymentError('FORBIDDEN', 'Requester cannot decide their own refund request', 403)`.
  - Even if an organizer owner or manager possesses authority over their club's ledger, they are strictly prohibited from approving refund requests for their own personal bookings.

---

### 4. Event Discovery Scoping & Keyset Cursor Pagination

- **Status & Visibility Scoping (`packages/backend/src/routes/api/v1/events.ts`):**
  - Enum-validated `status` parameter in query schema against `eventStatusEnum.enumValues`.
  - Anonymous users are strictly constrained to `published` events.
  - Authenticated students and non-organizer members are constrained to `published` events.
  - Authenticated organizer members can query non-published statuses (`draft`, `pending_approval`, `approved`, etc.) strictly scoped to organizers where they maintain an active membership.
  - College visibility scoping: `visibility = 'college'` events are scoped strictly to `events.collegeId = user.collegeId`. Anonymous users and cross-college students only see `visibility = 'public'` events.
- **Keyset Cursor Pagination:**
  - Updated `nextCursor` and cursor consumption to use base64url-encoded `(startsAt, id)` tuples.
  - Honored sort directions (`date_asc` and `date_desc`) with tie-breaker sorting on `id` to prevent pagination skips and duplicates.

---

### 5. Event Mutation & Capacity Constraints

- **Update Schema & State Invariants (`packages/backend/src/routes/api/v1/events.ts`):**
  - Configured `updateEventSchema = createEventSchema.omit({ organizerId: true }).partial().extend({ version: z.number().int().optional() })`.
  - Blocked all modifications on completed and cancelled events with HTTP 400 `EVENT_CANNOT_BE_MODIFIED`.
  - Restricted material parameter edits (`venueId`, `startsAt`, `endsAt`, `capacity`) while event status is `'pending_approval'` with HTTP 400 `MATERIAL_EDIT_RESTRICTED`.
  - Enforced minimum capacity: `capacity >= 1`.
  - Query ticket types: Refused capacity reductions below already committed allocations (`capacity < totalSold + totalHeld`) with HTTP 400 `CAPACITY_BELOW_ALLOCATED`.
  - Cross-field validation: enforced `startsAt < endsAt`, `registrationOpensAt < registrationClosesAt <= endsAt`, and `teamMin <= teamMax`.

---

### 6. Object-Level Access Control (IDOR Prevention)

- **Explicit `objectCheck` on Private Entities:**
  - Added object-level ownership verification hooks returning 403 `FORBIDDEN` across all private attendee endpoints:
    - `GET /api/v1/bookings/:id`
    - `POST /api/v1/bookings/:id/cancel`
    - `POST /api/v1/bookings/:id/checkout`
    - `POST /api/v1/bookings/:id/refunds`
    - `GET /api/v1/certificates/:id/download`

---

### 7. Administrative Protections

- **Self-Demotion & Last Admin Protection (`packages/backend/src/routes/api/v1/admin.ts`):**
  - Maintained safeguards preventing administrators from demoting their own account (`SELF_DEMOTION_PROHIBITED`) or suspending their own account (`SELF_SUSPENSION_PROHIBITED`).
  - Enforced platform safeguard preventing the demotion or suspension of the last active administrator (`LAST_ADMIN_PROTECTION`).
  - Audited all administrative role mutations via `logAuditEvent`.

---

### 8. Verification & Automated Coverage

- **Automated IDOR & Route Authorization Matrix (`tests/security/idor-matrix.test.ts`):**
  - Implemented 12 automated test cases evaluating all 8 role personas (`anon`, `student`, `other-college student`, `organizer-A`, `organizer-B`, `check-in staff`, `reviewer`, `admin`) across public, student-private, organizer-management, review, check-in, conflict resolution, analytics, and admin routes.
  - Verified 100% pass rate.
- **Full Vitest Suite:**
  - 31 test files, 260 tests passing (100%).
- **Full Playwright Browser Suite:**
  - 11 spec files, 75 tests passing across Mobile-375, Tablet-768, and Desktop-1280 (100%).
- **Static Analysis & Builds:**
  - TypeScript typecheck passed with 0 errors across all workspace packages.
  - ESLint passed with 0 errors across all workspace packages.
  - Production build passed for all packages.

---

## Phase P05 — Frontend Foundation A: API Client, Auth State & Error Handling

**Date:** 2026-10-26  
**Author:** Principal Full-Stack Engineer  
**Status:** Complete & Verified  

---

### 1. Robust Unified API Client (`apiClient`)
- Replaced ad-hoc `fetch()` calls across the frontend with `apiClient` (`packages/frontend/src/lib/api-client.ts`).
- Standardized request envelope parsing to unpack backend `{ error: { code, message, details, requestId } }` errors into typed `ApiError` instances.
- Added automatic exponential backoff with jitter on network drops and 5xx errors.
- Handled Render cold starts with wake-up detection emitting `eventora:server-waking` and `eventora:server-ready` window events.
- Wired 401 Unauthorized detection to global callback triggering session expiration modals.

---

### 2. Centralized Auth State & Session Expiration
- Unified auth state in `AuthContext` (`packages/frontend/src/context/AuthContext.tsx`).
- Created `ExpiredSessionModal` notifying users when their 30-minute idle session expires and preserving the destination route for post-login return.
- Connected profile display name updates and preference toggles to `/api/v1/me` and `/api/v1/me/preferences`.

---

### 3. Error Reporting & Diagnostics
- Implemented `reportError` in `packages/frontend/src/lib/error-reporter.ts` capturing error stacks, component traces, and backend `requestId`.
- Added automated unit test suite `tests/unit/phase-p05-frontend-foundation.test.ts` (7 passing tests).

---

## Phase P06 — Frontend Foundation B: Router, Guards & Error Boundaries

**Date:** 2026-10-26  
**Author:** Principal Full-Stack Engineer  
**Status:** Complete & Verified  

---

### 1. React Router DOM v6 Migration & Declarative Routes
- Replaced manual state-based router (`activeTab`, `currentView`, `activeEventId`) in `App.tsx` with `<BrowserRouter>`, `<Routes>`, and `<Route>` from `react-router-dom` v6.
- Declared canonical URL hierarchy across all 23 application views:
  - Discovery: `/`
  - Event Details: `/events/:slug`
  - Checkout & Tickets: `/checkout/:bookingId`, `/tickets`, `/tickets/:id`
  - Calendars & Hubs: `/calendar`, `/teams`, `/volunteers`
  - Passports & Verification: `/passport`, `/p/:slug`, `/verify`, `/verify/:code`
  - Attendee Profile: `/profile`
  - Organizer Command Center: `/organizer`, `/organizer/create`, `/organizer/:tab`
  - Reviewer Queue: `/review`
  - Campus Administration: `/admin`, `/admin/:tab`
  - Scanner & Check-in: `/scan`, `/scan/:eventId`
  - Authentication: `/login`, `/register`, `/forgot`, `/reset/:token`, `/verify-email/:token`
  - Catch-All: `*` routing to `NotFoundPage` (404)
  - Backward compatibility: Legacy redirects for `/dashboard` -> `/organizer` and `/auth/*` -> `/*`.

---

### 2. Server-Derived Authorization Guards (`RequireAuth` & `RequireRole`)
- Created `packages/frontend/src/components/auth/RouteGuards.tsx`:
  - `RequireAuth`: Intercepts unauthenticated users, captures current route in `returnTo`, and redirects to `/login?returnTo=...`.
  - `RequireRole`: Derives effective user roles solely from authenticated server data (`user.globalRole`, `user.organizerMemberships`, `user.staffAssignments`).
- **Complete Deletion of Manual Role Switcher:**
  - Completely purged the manual `<select aria-label="Switch User Role">` across `StudentShell`, `OrganizerShell`, `ReviewerShell`, `AdminShell`, `CheckinShell`, and `AppShell`.
  - Zero remaining occurrences across all source and test files.
- **Dedicated 403 Forbidden Page (`packages/frontend/src/pages/ForbiddenPage.tsx`):**
  - Displays access denied status, required role information, and recovery actions ("Discover Events" and "Go Back").

---

### 3. Suspense, Code-Splitting & Per-Route Error Boundaries
- Code-split all page components using `React.lazy()` with Rollup dynamic chunks.
- Created `RouteSkeleton` (`packages/frontend/src/components/ui/RouteSkeleton.tsx`) with pulsing wireframe loading feedback.
- Implemented `ErrorBoundary` (`packages/frontend/src/components/layout/ErrorBoundary.tsx`):
  - Captures runtime React component failures without crashing the entire single-page application.
  - Automatically extracts and displays backend `requestId` and error codes.
  - Provides interactive "Try Again" recovery retry and fallback navigation buttons.
  - Integrated at the root platform level and individually around each code-split route view.

---

### 4. Scanner Real Event Parameter & Event Picker
- Purged hardcoded `'mock-event-id'` across `packages/frontend/src/pages/ScannerPage.tsx` and `packages/frontend/src/lib/offline-sync.ts`.
- Implemented Active Event Picker when navigating to `/scan` without an `eventId`: queries active events, displays interactive selection cards, and navigates to `/scan/:eventId`.
- Added "Switch Event" header action inside the active turnstile scanner.

---

### 5. ReturnTo Navigation Preservation
- Enhanced `LoginPage` and `RegisterPage` to forward and preserve `returnTo` search parameters during new account registration and email verification.
- Upon successful login, users are automatically returned to their intended deep link destination.

---

### 6. Verification & Automated Coverage
- **Unit & Security Matrix Suite:**
  - Created `tests/unit/phase-p06-router-guards.test.ts` (8 passing unit tests).
  - Full vitest suite: 33 test files, 281 tests passing (100%).
- **Playwright E2E Acceptance Suite (`tests/e2e/router-guards-navigation.spec.ts`):**
  - 15 tests passing across Mobile-375, Tablet-768, and Desktop-1280 (100%):
    1. Deep links survive page reload without resetting to root or losing state (`/calendar`, `/teams`, `/volunteers`).
    2. Logged-out redirect preserves `returnTo` and navigates back upon login (`/profile`).
    3. 404 Catch-All renders `NotFoundPage` with clean return to Discovery.
    4. Role-guarded routes render 403 `ForbiddenPage` with required role indicators for unauthorized roles (`/admin`, `/review`).
    5. Browser back and forward history navigation buttons navigate correctly between routes.
- **Static Analysis & Builds:**
  - TypeScript typecheck passed with 0 errors across `@eventora/shared`, `@eventora/backend`, and `@eventora/frontend`.
  - ESLint passed with 0 errors.
  - Vite production build succeeded in 4.18s with code-split route chunks.

