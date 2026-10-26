# Eventora Overhaul Changelog

## Phase P10 — Event Creation: Free/Paid + Schema

**Date:** 2026-10-26  
**Author:** Principal Full-Stack Engineer  
**Status:** Complete & Verified  

---

### 1. Database Migrations & Schema Architecture (Phase 15)
- **Migration 15 (`Phase 15: Event Pricing Type, Currency & Tier Backfill`):**
  - Created `event_pricing_type` enum (`'free'`, `'paid'`) with idempotent check.
  - Added additive columns to `events` table:
    - `pricing_type event_pricing_type NOT NULL DEFAULT 'free'`
    - `currency VARCHAR(10) NOT NULL DEFAULT 'INR'`
  - Created performance index `idx_events_pricing_type` on `events(pricing_type)`.
  - Added backfill SQL migrating existing records:
    `UPDATE events e SET pricing_type = 'paid' WHERE EXISTS (SELECT 1 FROM ticket_types tt WHERE tt.event_id = e.id AND tt.price_paise > 0);`
  - Added version 15 tracking record into `schema_migrations`.
- **Down-Migration Engine (`packages/backend/src/db/migrate-down.ts`):**
  - Added rollback step 15 -> 14: drops index `idx_events_pricing_type`, drops columns `pricing_type` and `currency` from `events`, drops enum type `event_pricing_type`, and removes version 15 record.
  - Tested and verified live rollback 15 -> 14 and re-application 14 -> 15 against PostgreSQL database.
- **Drizzle Schema Alignment (`packages/backend/src/db/schema.ts`):**
  - Added `eventPricingTypeEnum` (`'free'`, `'paid'`).
  - Updated `events` table with `pricingType` and `currency`.
  - Added relational mappings `eventsRelations` and `ticketTypesRelations` for relational queries.
- **Startup Migration Probe (`packages/backend/src/index.ts`):**
  - Updated startup check to verify schema version `< 15`.

---

### 2. Money & Currency Utilities (`packages/shared/src/money.ts`)
- **Integer Paise Financial Invariants:**
  - Exported `ALLOWED_CURRENCIES = ['INR']` and `isAllowedCurrency()`.
  - Implemented `rupeeToPaise(rupees: number | string): number`: safely converts rupees to integer paise without floating point inaccuracy. Rejects negative amounts, non-numeric values, and fractional paise (>2 decimal places).
  - Implemented `paiseToRupee(paise: number): number`: converts integer paise back to numeric rupee amount, rejecting non-integers or negative amounts.
  - Implemented `formatPaiseToRupee(paise: number, forceDecimals?: boolean): string`: localized standard Indian Rupee currency string representation (e.g. `₹250`, `₹99.50`).
  - Re-exported utilities across packages via `packages/shared/src/index.ts` and `packages/frontend/src/lib/utils.ts`.

---

### 3. URL-Safe Slug Generation & Collision Resolution (`packages/backend/src/services/slug.ts`)
- **Transliteration Engine (`transliterateToSlug`):**
  - Decomposes accented unicode diacritics via `normalize('NFKD')`.
  - Expands symbols cleanly (`&` -> `and`, `@` -> `at`, `%` -> `percent`, `+` -> `plus`, `#` -> `hash`).
  - Strips non-alphanumeric noise, normalizes whitespace to single hyphens, and trims leading/trailing hyphens.
- **Collision Resolution (`generateUniqueSlug`):**
  - Checks database for collisions on base slug; appends random alphanumeric suffixes (`${base}-${suffix}`) with retry budget; falls back to timestamp suffix if needed.
  - Supports pg `Pool` and Drizzle client.

---

### 4. Backend Route Schemas & Route Validation (`packages/backend/src/routes/api/v1/events.ts`)
- **Strict Free vs. Paid Zod Validation:**
  - `pricingType: z.enum(['free', 'paid']).default('free')`
  - `currency: z.string().default('INR')`
  - `ticketTiers: z.array(ticketTierInputSchema).optional()`
  - Cross-field validation rules enforced in `superRefine`:
    - `currency` must be in `ALLOWED_CURRENCIES` (`['INR']`).
    - Paid events: requires $\ge 1$ ticket tier, each tier price must be $> 0$ paise, sum of tier capacities cannot exceed overall event capacity.
    - Free events: all tiers must have `price_paise = 0`, sum of tier capacities cannot exceed overall event capacity.
- **API Endpoint Updates:**
  - `POST /api/v1/events`: Generates unique slug, inserts `pricingType` and `currency`, creates ticket tiers or defaults free tier (`General Admission`, `pricePaise = 0`).
  - `GET /api/v1/events`: Supports `pricing_type` query filter (`free | paid | all`), returns `pricingType` and `currency`.
  - `GET /api/v1/events/:slug`: Returns event with relational `ticketTypes`.
  - `PATCH /api/v1/events/:id`: Allows editing `ticketTiers` for draft events, regenerates unique slug if draft title changes.

---

### 5. Frontend Event Proposal Wizard (`packages/frontend/src/pages/events/CreateEventPage.tsx`)
- **Rule 5 Compliance (No localStorage):**
  - Removed all `localStorage` draft saving and proposal idempotency key caching.
  - Implemented server-side draft autosave: "Save Draft" persists drafts directly via `POST /api/v1/events` or `PATCH /api/v1/events/:id`.
- **Mandatory Free / Paid Segmented Control:**
  - Interactive segmented control in Step 3 (`[ Free ] Free Registration` vs `[ Paid ] Paid / Ticketed Event`).
  - Free mode: informs organizer that attendees register directly without checkout or payment screens.
  - Paid mode:
    - Standardizes currency indicator to `INR` (Indian Rupee).
    - Ticket price input in ₹ with live calculation helper displaying exact integer paise (e.g. `₹499.50` -> `49,950 paise`).
    - Optional multi-tier builder (e.g. Early Bird, Regular, VIP) with inline capacity sum tracking against event capacity.
- **Timezone-Aware Date Pickers:**
  - All date/time fields explicitly labeled with timezone: `(IST / Indian Standard Time, UTC+5:30)`.

---

### 6. Verification & Quality Gates
- **Unit & Integration Tests:**
  - `tests/unit/money.test.ts`: 12 tests passing (`rupeeToPaise`, `paiseToRupee`, `formatPaiseToRupee`, `ALLOWED_CURRENCIES`, `isAllowedCurrency`).
  - `tests/unit/phase-p10-event-creation.test.ts`: 13 tests passing (Free vs Paid schema rules, zero paise checks, currency allow-list, capacity bounds, slug transliteration).
  - `tests/unit/phase-p09-event-lifecycle.test.ts`: 11 tests passing (schema migration rollback/re-apply).
  - `tests/unit/form-workflow-repair.test.ts`: 13 tests passing.
- **Playwright E2E Tests:**
  - `tests/e2e/phase-p10-event-creation.spec.ts`: 2 tests passing (Desktop-1280):
    1. Creates Free Event proposal with server draft autosave and no payment screen.
    2. Creates Paid Event proposal with ₹ to integer paise live conversion and INR currency.
  - `tests/e2e/event-lifecycle.spec.ts`: Full end-to-end lifecycle test passing.
- **Typecheck & Lint:**
  - `pnpm typecheck`: 0 errors across `@eventora/shared`, `@eventora/backend`, and `@eventora/frontend`.
  - `pnpm lint`: 0 errors.

---

## Phase P09 — Event Lifecycle, Cancel Cascade & Auto-Completion Scheduler

**Date:** 2026-10-26  
**Author:** Principal Full-Stack Engineer  
**Status:** Complete & Verified  

---

### 1. Database Migrations & Schema Architecture (Phase 14)
- **Migration 14 (`Phase 14: Event Status History System Actor, Completion Index & Scan Outcome`):**
  - Made `actor_id` nullable in `event_status_history` (`ALTER TABLE event_status_history ALTER COLUMN actor_id DROP NOT NULL;`) to permit automated background scheduler transitions.
  - Created composite performance index `idx_events_status_ends_at` on `events(status, ends_at)` for instant identification of expired published events.
  - Made `requested_by` nullable in `refunds` (`ALTER TABLE refunds ALTER COLUMN requested_by DROP NOT NULL;`) so organizer/system cancel cascades insert refunds cleanly without requiring dummy reviewer actors.
  - Added `'EVENT_NOT_PUBLISHED'` to `scan_outcome` enum (`ALTER TYPE scan_outcome ADD VALUE IF NOT EXISTS 'EVENT_NOT_PUBLISHED';`).
  - Added version 14 entry to `schema_migrations`.
- **Down-Migration Engine (`packages/backend/src/db/migrate-down.ts`):**
  - Added rollback step 14 -> 13: drops index `idx_events_status_ends_at`, restores `NOT NULL` constraint on `event_status_history.actor_id` and `refunds.requested_by` (with fallback user assignment), and removes version 14 record.
  - Tested and verified live rollback 14 -> 13 and re-application 13 -> 14.
- **Drizzle Schema Alignment (`packages/backend/src/db/schema.ts`):**
  - Updated `eventStatusHistory.actorId` (nullable).
  - Updated `refunds.requestedBy` (nullable).
  - Updated `scanOutcomeEnum` with `'EVENT_NOT_PUBLISHED'`.
- **Startup Migration Probe (`packages/backend/src/index.ts`):**
  - Updated startup check to verify schema version `< 14`.

---

### 2. Single-Transaction Event Lifecycle State Transitions (`packages/backend/src/services/event-lifecycle.ts`)
- **Single Client Transaction:**
  - Rewrote `transitionEventStatus` to run status update + event status history + venue booking reconciliation + cancel cascade + outbox notifications + audit logging inside **ONE atomic client transaction** (`client.query('BEGIN')` ... `COMMIT`).
  - If any step throws or encounters a concurrency conflict, the entire operation rolls back atomically.
- **Complete Cancel Cascade:**
  - Releases venue bookings (`status = 'released'`).
  - Revokes all active tickets (`status = 'REVOKED'`).
  - Resets ticket tier capacity counters (`sold = 0, held = 0`).
  - Cancels all active bookings (`status = 'CANCELLED'`).
  - Closes all waiting and offered waitlist entries (`status = 'EXPIRED'`).
  - Automatically queues refund requests with `status = 'REQUESTED'` in `refunds` for paid bookings with succeeded payment, and updates payments to `status = 'REFUND_PENDING'`.
  - Queues outbox notifications for each attendee (`notification.event_cancelled`) and general event outbox entry (`event.cancelled`).
  - Returns `CancelCascadeSummary` with exact counts: `cancelledBookingsCount`, `ticketsRevokedCount`, `refundsQueuedCount`, `waitlistClosedCount`, `outboxQueuedCount`, `releasedVenueBookingsCount`.

---

### 3. API Route Enhancements (`packages/backend/src/routes/api/v1/events.ts`)
- **Real Cancel Cascade Summary:**
  - Replaced generic/false cancellation message with live counts in `POST /api/v1/events/:id/cancel`:
    - Root and summary counts: `cancelledBookingsCount`, `ticketsRevokedCount`, `refundsQueuedCount`, `waitlistClosedCount`, `outboxQueuedCount`.
    - Dynamic message: `"Event has been cancelled. Released X bookings, revoked Y tickets, queued Z refunds, and closed W waitlist entries."`.
- **Material Edit Attendee Outbox Notifications:**
  - In `PATCH /api/v1/events/:id`, when a published event undergoes material changes (`startsAt`, `endsAt`, `venueId`), all active ticket holders are retrieved and queued individual `notification.event_rescheduled` outbox rows for notification fan-out.

---

### 4. Check-in Scanner & Booking Guards (`packages/backend/src/services/qr-ticket.ts`, `booking.ts`)
- **Check-in Scanner:**
  - Guard checks `events.status`. If the event is not `published`:
    - If the ticket was revoked/cancelled, logs outcome `'REVOKED'` and returns message `"Revoked Ticket: This registration has been cancelled or revoked."`.
    - Otherwise logs outcome `'EVENT_NOT_PUBLISHED'` and returns `"Check-in blocked: Event is <status>, not published."`.
- **Booking Guards:**
  - Confirms `createBooking` and `createHold` reject bookings for non-published events (`EVENT_NOT_PUBLISHED`).

---

### 5. Automated Event Completion Scheduler (`packages/backend/src/services/event-scheduler.ts`)
- **Advisory Lock Worker:**
  - Uses PostgreSQL session-level advisory lock `EVENT_COMPLETER_ADVISORY_LOCK_ID = 4208002` (`pg_try_advisory_lock`) to guarantee single-leader execution across horizontal cluster nodes.
- **Auto-Completion:**
  - Queries `events` where `status = 'published' AND ends_at <= NOW()`.
  - Transitions them to `'completed'` with `actorId: 'system'` and audit log note.
- **Fastify Lifecycle Hooks (`packages/backend/src/index.ts`):**
  - Worker starts automatically on server listen (`startEventCompleterWorker()`).
  - Gracefully stops on server close (`stopEventCompleterWorker()`) via `server.addHook('onClose')`.

---

## Phase P08 — Inventory & Booking Correctness, Hold Reconciler & Concurrency Safeguards

**Date:** 2026-10-26  
**Author:** Principal Full-Stack Engineer  
**Status:** Complete & Verified  

---

### 1. Database Migrations & Schema Architecture (Phase 13)
- **Migration 13 (`Phase 13: Active Solo Booking Partial Unique Index & Hold Reconciliation`):**
  - Created partial unique index `bookings_active_user_event_solo_idx` on `(user_id, event_id)` WHERE `status IN ('PENDING_PAYMENT', 'CONFIRMED') AND team_registration_id IS NULL`. Replaces blanket unique constraint to allow historical cancelled/refunded bookings while strictly preventing duplicate active solo bookings.
  - Added `payload_hash VARCHAR(64)` column to `bookings` table for cryptographic idempotency payload verification.
  - Added version 13 tracking into `schema_migrations`.
- **Down-Migration Engine (`packages/backend/src/db/migrate-down.ts`):**
  - Added rollback step 13 -> 12: drops index `bookings_active_user_event_solo_idx`, restores `uq_booking_user_event_active`, drops column `payload_hash`, and removes version 13 record.
  - Verified atomic rollback 13 -> 12 and re-application 12 -> 13 against live PostgreSQL.
- **Drizzle Schema Alignment (`packages/backend/src/db/schema.ts`):**
  - Updated `bookings` table definition in Drizzle with `payloadHash: varchar('payload_hash', { length: 64 })` and `bookingsActiveUserEventSoloIdx`.
- **Startup Migration Probe (`packages/backend/src/index.ts`):**
  - Updated auto-migration trigger probe to check for schema version `< 13`.

---

### 2. Single-Leader Advisory Lock Hold Reconciler
- **Hold Reconciler Service (`packages/backend/src/services/hold-reconciler.ts`):**
  - Implemented Postgres advisory lock worker using `pg_try_advisory_lock(4208001)` to ensure single-leader execution across horizontally clustered backend nodes.
  - Background loop calls `reconcileExpiredHolds` every 60 seconds.
  - Deadlocks avoided by locking `ticket_types` sorted `ORDER BY id ASC FOR UPDATE` before decrementing `held` counters.
- **Server Lifecycle Hooks (`packages/backend/src/index.ts`):**
  - Starts hold reconciler worker on Fastify server listen.
  - Registers `onClose` hook to gracefully stop worker and release advisory locks during shutdown.

---

### 3. Inventory State Machine & Row-Locking Cancellation
- **Row-Locking Cancellation (`packages/backend/src/services/cancellation.ts`):**
  - Acquires exclusive row locks on `ticket_types` sorted `ORDER BY id ASC FOR UPDATE` to prevent deadlocks under concurrency.
  - Reconciles held vs. sold counters accurately:
    - If booking is `PENDING_PAYMENT`: decrements `held = GREATEST(0, held - quantity)`.
    - If booking is `CONFIRMED`: decrements `sold = GREATEST(0, sold - quantity)` and calls `promoteNext(booking.event_id, item.ticket_type_id, client)`.
- **Waitlist Promotion Polymorphism (`packages/backend/src/services/waitlist.ts`):**
  - Hardened `promoteNext` to support both `(ticketTypeId, client)` and `(eventId, ticketTypeId, client)` signatures seamlessly.
- **Payment Lifecycle Counters (`packages/backend/src/services/payment.ts`):**
  - Payment success: acquires row locks sorted by ID, decrements `held`, increments `sold`.
  - Payment failure: acquires row locks sorted by ID, decrements `held` (prevents seat leaks).
  - Refund approval: acquires row locks sorted by ID, decrements `sold`, and triggers waitlist promotion.

---

### 4. Booking Creation Invariants & Safeguards (`packages/backend/src/services/booking.ts`)
- **Event Capacity Guard:** Enforces `events.capacity` constraint across all tiers simultaneously by locking the `events` table row `FOR UPDATE`.
- **Event Expiry Guard:** Rejects bookings attempted after event conclusion (`now() > endsAt`) with HTTP 400 `EVENT_ALREADY_ENDED`.
- **Line Item Deduplication:** Line items with identical `ticketTypeId` are merged before capacity checks, preventing duplicate line-item bypass exploits.
- **Custom Form Question Validation:** Answers validated against custom form questions in `registration_form_questions` (verifies required fields, question ownership, and allowed enum options).
- **Team Registration Validation:** Validates `teamRegistrationId` against `team_event_registrations` and active status in `team_members`.
- **Cryptographic Idempotency Guard:**
  - Idempotency keys capped at $\le 128$ characters and validated.
  - Computes SHA-256 payload hash of normalized request body.
  - Concurrent and replay requests with matching keys return existing booking if payload matches.
  - Replays with altered body payload are rejected with HTTP 422 `IDEMPOTENCY_PAYLOAD_MISMATCH`.

---

### 5. Automated Verification & Quality Gates
- **Comprehensive P08 Unit & Integration Suite (`tests/unit/phase-p08-inventory-booking.test.ts`):**
  - 21 tests covering all state machine branches.
  - Concurrency gate: 200 parallel bookings competing for 10 available seats $\to$ exactly 10 succeed, 190 fail, and counters stay strictly consistent (`sold + held == 10`).
  - Abandoned holds free seats after expiry.
  - Failed payments release held inventory without leaking seats.
  - Cancellation promotes waitlisted candidates automatically.
- **Vitest Full Regression:** 35/35 test files passed, 310/310 tests passed (100%).
- **Playwright Full Regression:** 54/54 core tests passed, 24/24 final journey tests passed across Mobile, Tablet, and Desktop viewports.
- **Typecheck & Lint:** 0 TypeScript errors, 0 ESLint errors across whole monorepo.
- **Production Build:** `pnpm build` completed cleanly in 4.22s.

---

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

---

## Phase P07 — Design System, Tokens, UI Components & Overlays

**Date:** 2026-10-26  
**Author:** Principal Full-Stack Engineer  
**Status:** Complete & Verified  

---

### 1. Design Tokens, Inter Typography & Safe-Area Insets
- **Updated `tailwind.config.ts` & `index.css`:**
  - Prioritized `'Inter'` across font family definitions (`font-sans`), falling back to modern system fonts.
  - Extended semantic color scale tokens (`--brand-light`, `--surface-3`, `--border-subtle`, `--text-subtle`) ensuring strict WCAG 2.1 AA contrast (>= 4.5:1) in both light and dark themes.
  - Standardized transition durations to `<= 200ms` (`fast: 100ms`, `normal: 180ms`, `slow: 200ms`).
  - Added `@media (prefers-reduced-motion: reduce)` reducing all CSS and Framer Motion animations to 0.01ms.
  - Implemented safe-area insets (`--safe-area-bottom`, `--safe-area-top`, `.pb-safe`, `.pt-safe`) for phone home indicator bars and notches.

---

### 2. Form Controls & Validation Accessibility
- **Rebuilt `components/ui/*` Form Inputs (`Input`, `Select`, `Textarea`, `Checkbox`, `Switch`):**
  - Integrated `useId()` for deterministic element and label association.
  - Linked validation errors and helper descriptions via `aria-describedby` and `aria-invalid`.
  - Added `role="alert"` on rendered error elements for screen reader announcements.
  - Replaced unstyled native controls with accessible custom controls (custom `ChevronDown` on Select, styled checkmark box on Checkbox, smooth animated toggle pill on Switch).

---

### 3. Rebuilt Overlays: Modal, Dialog & BottomSheet
- **Fixed Focus Stealing on Re-renders:**
  - Stored `onClose` in a mutable ref (`const onCloseRef = useRef(onClose); onCloseRef.current = onClose;`).
  - Constrained effect dependency strictly to `[isOpen, isDismissible]` (preventing re-renders in parent components from stealing input focus).
- **Body Scroll-Lock with Cleanup:**
  - Locks `document.body.style.overflow = 'hidden'` on open with scrollbar width compensation, cleanly restoring previous overflow and padding styles on unmount.
- **Accessible Focus Trap & Return Focus:**
  - Cycles Tab and Shift+Tab strictly within modal focusable elements.
  - Automatically captures `document.activeElement` on open and returns focus on close.
- **Non-Dismissible Variant (`isDismissible = false`):**
  - Disables backdrop click dismissal, disables Escape key dismissal, and hides close `X` button for blocking modal workflows (e.g. `ExpiredSessionModal`).
- **Framer Motion Transitions:**
  - Standardized all backdrop and sheet animations to `<= 200ms`.

---

### 4. Rebuilt Navigation Components (Tabs, Table, Pagination, FeedbackStates)
- **`Tabs`:** Full WAI-ARIA tab pattern (`role="tablist"`, `role="tab"`, `role="tabpanel"`, `tabIndex={isActive ? 0 : -1}`, `aria-selected`), with ArrowLeft, ArrowRight, Home, and End keyboard navigation.
- **`Table`:** Focusable scrollable region with `role="region"`, sort direction column headers (`aria-sort`), and responsive mobile card mode support.
- **`Pagination`:** Numbered page buttons with `aria-current="page"`, ellipsis indicators, and accessible Previous/Next button boundaries.
- **`FeedbackStates`:** `EmptyState`, `ErrorState` (with optional `requestId` display and one-click copy), and `PermissionDeniedState`.
- **`Button`:** Added `aria-busy={isLoading || undefined}`, active press feedback (`active:scale-[0.98]`), and default `type="button"`.

---

### 5. Shell Layouts & Mobile Navigation
- Added safe-area insets (`pt-safe`, `pb-safe`) and padding adjustments across `StudentShell`, `OrganizerShell`, `ReviewerShell`, `AdminShell`, and `CheckinShell`.
- Ensured mobile-first 360px compatibility with zero horizontal page overflow.

---

### 6. Verification & Automated Coverage
- **Unit Suite (`tests/unit/phase-p07-design-system.test.ts`):**
  - 8 automated unit tests verifying design tokens, overlay focus stability, scroll-lock cleanup, form validation linkages, tab arrow navigation, pagination, feedback states, and button press feedback (100% pass).
- **Full Vitest Suite:**
  - 34 test files, 289 tests passed (100%).
- **Playwright E2E Suite (`tests/e2e/design-system.spec.ts`):**
  - 30 tests passing across Mobile-375, Tablet-768, and Desktop-1280 (100% pass):
    1. Discovery Page responsive layout, chips, and no horizontal overflow.
    2. Event Details 16:9 aspect box, sticky CTA, and modal focus trap / Esc dismissal.
    3. Organizer Analytics KPI cards, sortable table, and responsive cards.
    4. Component Gallery state matrix and dark mode persistence (`.dark` and `[data-theme="dark"]`).
    5. Axe-Core accessibility scan on Discovery (zero serious/critical violations).
    6. Keyboard-only pass (Tab navigation & focus visibility).
    7. Component Gallery Axe-Core scan on `/components` (zero serious/critical violations).
    8. Overlay focus trap, Esc dismissal, body scroll-lock, and non-dismissible dialog.
    9. Form controls validation and `aria-describedby` error linkages.
    10. Tabs keyboard arrow navigation.
  - Screenshots updated at 375, 768, and 1280 viewports.
- **Static Analysis & Builds:**
  - TypeScript typecheck passed with 0 errors across all workspace packages.
  - ESLint passed with 0 errors.
  - Production build succeeded in 4.53s.




---

## Phase P11: Custom Registration Form Builder & Submissions

### 1. Database Schema & Migration 16
- **Additive Migration 16 (`Phase 16: Custom Registration Form Builder & Versioned Fields`):**
  - Created `event_form_field_type` enum: `['short_text','long_text','dropdown','radio','checkbox','multi_checkbox','phone','email','number','date','dietary']`.
  - Created `event_form_fields` table (`id`, `event_id`, `position`, `type`, `label`, `help_text`, `required`, `options jsonb`, `validation jsonb`, `version`).
  - Added indexed constraint on `(event_id, position)`.
  - Added additive columns to `registration_answers`: `field_id`, `field_version`, `value jsonb`, `attendee_index`. Dropped `NOT NULL` on legacy `question_id` / `answer`.
  - Down-migration (16 $\to$ 15) implemented and tested.

### 2. Form Builder Service & API Endpoints
- **Service (`packages/backend/src/services/form-builder.ts`):**
  - HTML tag and script stripping (`stripHtml`) to protect against stored XSS.
  - Length capping $\le 1000$ characters.
  - ReDoS protection with `isSafeRegex` to reject catastrophic backtracking patterns.
  - Validation across all 11 field types (email, phone, numeric min/max, option membership for dropdown/radio/multi_checkbox/dietary, safe regex pattern matching).
  - Optimistic locking check (`expectedVersion`) on `saveEventForm`. Returns `409 VERSION_CONFLICT` on mismatch.
  - Frozen form field guard: Once registrations exist for an event (`registrationCount > 0`), fields cannot be deleted or have their types modified. Returns `400 FORM_FROZEN`.
  - `getEventFormSubmissions`: Retrieves attendee custom answers grouped by booking ID and attendee index.
- **Endpoints (`packages/backend/src/routes/api/v1/events.ts`):**
  - `GET /api/v1/events/:id/form` (`event:manage:owned`).
  - `PUT /api/v1/events/:id/form` (`event:manage:owned`).
  - `GET /api/v1/events/:id/form/submissions` (`event:manage:owned`, visible only to event organizer).
  - Updated `GET /api/v1/events/:slug` to include `formFields` ordered by position.
- **Booking Flow (`packages/backend/src/services/booking.ts`):**
  - Validates custom answers during booking creation.
  - Rejects unknown `fieldId` (`UNKNOWN_FORM_FIELD`).
  - Persists answers with `field_id`, `field_version`, `value`, and `attendee_index`.

### 3. Log Redaction
- Updated `REDACT_PATHS` in `packages/backend/src/logger.ts` to redact `answers`, `*.answers`, `body.answers`, `registrationAnswers`, and `*.registrationAnswers`.

### 4. Frontend Components
- **`DynamicRegistrationForm.tsx`:** Dynamic rendering of all 11 field types with client-side validation (`validateDynamicForm`), error badges, and multi-ticket attendee tabs.
- **`FormBuilder.tsx`:** Complete visual form builder with field type palette, drag-and-drop / keyboard reordering (`Move Up`, `Move Down`), duplicate field, delete field, per-type settings (options list editor, min/max limits, custom regex), version badge, frozen notice banner, and live interactive attendee preview.
- **`FormSubmissionsView.tsx`:** Organizer response dashboard with search filter, per-attendee answers display, and CSV export.
- **Dashboard & Event Details Integration:**
  - `OrganizerDashboardPage.tsx`: Added "Registration Forms (P11)" tab with Form Builder & Responses sub-tabs, plus direct "View Custom Answers" action in Attendee Roster.
  - `EventDetailsPage.tsx`: Loads custom form fields and dynamically renders questionnaire during booking, sending structured per-attendee answers.

### 5. Verification & Testing
- **Unit & Integration Suite (`tests/unit/phase-p11-form-builder.test.ts`):** 25 automated tests covering HTML stripping, 1000 char limit, required rules, option membership, dietary defaults, safe regex, ReDoS protection, log redaction, optimistic locking (409), frozen form guard (400), unknown field rejection, multi-ticket answer persistence, and organizer-only submissions access. All 25 passed.
- **Playwright E2E Suite (`tests/e2e/phase-p11-custom-form.spec.ts`):** E2E test verifying organizer form design, live preview, save, and submission inspection.
- **Typecheck:** Passed with 0 errors across `@eventora/shared`, `@eventora/backend`, and `@eventora/frontend`.
