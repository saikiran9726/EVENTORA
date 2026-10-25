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
