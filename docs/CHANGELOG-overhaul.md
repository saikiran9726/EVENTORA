# Eventora Overhaul Changelog

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
