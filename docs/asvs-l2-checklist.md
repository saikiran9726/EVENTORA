# OWASP Application Security Verification Standard (ASVS) 4.0 — Level 2 Checklist & Compliance Matrix

**Standard:** OWASP ASVS 4.0.3 (Level 2 — Applications containing sensitive data, financial transactions, and campus identity governance)  
**System:** Eventora Smart Campus Platform  
**Audit Date:** 2026-10-29  
**Overall Status:** **PASSED (100% Verification Rate)**

---

## Payments Gateway Architecture & Compliance Notice

> [!IMPORTANT]
> **YouPI-PG Architecture & Regulatory Position:**
> YouPI-PG describes itself as an experimental research project, not bank/NPCI-approved or production-certified; it detects payments by parsing bank SMS/email alerts, suggests ≤ 20 payment attempts per day per receiving account, and serves one payer at a time per UPI ID. Collecting ticket money this way may raise bank, UPI, payment-aggregator, tax and consumer-protection questions — get qualified advice and your bank's written approval before real-money use. Treat it as suitable for small, controlled, organizer-approved events behind the `PAYMENT_PROVIDER` flag with buyer disclosure and manual reconciliation; for large or public paid events add a licensed gateway (Razorpay/Cashfree/PhonePe PG) as a second adapter.
>
> *(Note: This compliance disclosure is mirrored in the Organizer UI within the Financial Ledger tab and the Paid Event Creation workflow).*

---

## ASVS Level 2 Control Verification Matrix

| ASVS Chapter & Control ID | Level 2 Security Requirement | Eventora Implementation Architecture | Proving Test Suite / Evidence | Verification Status |
| :--- | :--- | :--- | :--- | :--- |
| **V1.1 Architecture & Design** | Deny-by-default route security model; explicit threat modeling. | Every Fastify route must declare `{ auth, policy, objectCheck }`. Route boot validator refuses to start server if unconfigured routes exist. | `tests/security/route-security-audit.test.ts`<br>`tests/security/phase-p32-security-pii.test.ts` | **PASSED** |
| **V1.2 Trust Boundaries** | Clear separation between client, API gateway, database, and background workers. | Strict trust boundary: zero trust in client amounts or client-submitted ticket counts. Monetary amounts calculated server-side in integer paise from stored rows only. | `tests/unit/phase-p32-mutation.test.ts`<br>`tests/unit/phase-p32-concurrency.test.ts` | **PASSED** |
| **V2.1 Password Security** | Modern cryptographic password hashing resistant to GPU cracking. | Argon2id hashing (`m=65536, t=3, p=4`) with constant-time dummy verification on nonexistent users to eliminate timing side-channels. | `tests/security/timing-safe.test.ts`<br>`tests/unit/auth.test.ts` | **PASSED** |
| **V2.2 Brute-Force Defense** | Rate limiting on authentication endpoints to prevent credential stuffing. | Redis sliding-window rate limiting throttles failed authentication attempts to 5 attempts/minute per IP and email. | `tests/security/rate-limit.test.ts` | **PASSED** |
| **V3.1 Session Security** | Cryptographically strong 256-bit session identifiers. | `crypto.randomBytes(32)` generated token; database stores SHA-256 hash `id_hash`. Client receives unguessable cookie. | `tests/security/session-management.test.ts` | **PASSED** |
| **V3.2 Cookie Hardening** | Defense-in-depth cookie attributes (`HttpOnly`, `Secure`, `SameSite`). | Cookies set with `HttpOnly; Secure; SameSite=Lax; Path=/`. Double-submit CSRF cookie with strict SameSite and timing-safe header verification. | `tests/security/csrf-defense.test.ts`<br>`tests/security/phase-p32-security-pii.test.ts` | **PASSED** |
| **V3.3 Session Termination** | Instant, irrevocable session termination upon logout or password change. | Calling `POST /api/v1/auth/logout` deletes the hashed session in Postgres and clears cookie headers immediately. | `tests/e2e/auth-flow.spec.ts`<br>`tests/security/session-management.test.ts` | **PASSED** |
| **V4.1 Access Control (RBAC)** | Role-based and capability-based authorization matrix. | Roles (`student`, `organizer`, `reviewer`, `admin`, `checkin_staff`) mapped to granular policies (`event:create`, `event:review`, `attendance:checkin:assigned`). | `tests/security/idor-matrix.test.ts`<br>`tests/unit/policy-evaluator.test.ts` | **PASSED** |
| **V4.2 IDOR Prevention** | Object-level authorization preventing cross-tenant access. | In-depth object checks ensure users can only view their own bookings, tickets, and organizer profiles. Cross-tenant access returns 403 or indistinguishable 404. | `tests/security/idor-matrix.test.ts`<br>`tests/security/phase-p32-security-pii.test.ts` | **PASSED** |
| **V5.1 Input Validation** | Comprehensive input validation for all API entry points. | 100% of request bodies, URL params, and query strings validated using strict Zod schemas with unexpected property rejection. | `scripts/verify-api-contracts.ts`<br>`tests/unit/zod-validation.test.ts` | **PASSED** |
| **V5.2 Parameterized SQL** | Complete prevention of SQL injection vulnerabilities. | All database interactions utilize parameterized `$1, $2` variables via `pg` driver and Drizzle ORM; zero dynamic SQL string interpolation. | `tests/security/sql-injection-resilience.test.ts` | **PASSED** |
| **V7.1 Cryptography** | Secure random generation and timing-safe comparisons. | `crypto.randomBytes(32)` used for all tokens and secrets; `crypto.timingSafeEqual` used for webhook HMAC verification and CSRF comparisons. | `tests/security/timing-safe.test.ts`<br>`tests/unit/phase-p32-mutation.test.ts` | **PASSED** |
| **V7.2 Key Management** | Dual-key rotation and zero hardcoded secrets. | Dual-key JWT rotation (`JWT_SECRET_CURRENT`, `JWT_SECRET_PREVIOUS`); environment validation fails boot if secrets contain default development placeholders in production. | `tests/unit/env-validation.test.ts`<br>`tests/unit/crypto-rotation.test.ts` | **PASSED** |
| **V8.1 Data Protection & Privacy**| Zero PII leakage across public endpoints. | Public event discovery, organizer profiles, and passports redact email, phone, and internal IDs. Private passports return indistinguishable 404s. | `tests/security/phase-p32-security-pii.test.ts`<br>`tests/unit/privacy-filtering.test.ts` | **PASSED** |
| **V8.2 Error Handling** | Standardized error envelope with no internal stack traces leaked. | All errors conform to `{ error: { code, message, details, requestId } }`. Generic 500 message returns "Internal Server Error" without driver internals. | `tests/security/phase-p32-security-pii.test.ts`<br>`tests/unit/error-envelope.test.ts` | **PASSED** |
| **V9.1 Communication Security** | Transport layer security and HTTP hardening headers. | HSTS `max-age=31536000; includeSubDomains; preload`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`. | `tests/unit/security-headers.test.ts`<br>`tests/security/phase-p32-security-pii.test.ts` | **PASSED** |
| **V10.1 Malicious Code & Webhooks**| Verifiable webhook signatures and replay defense. | Payment provider and Resend webhooks require HMAC-SHA256 signatures with provider timestamp verification within a 5-minute clock drift window. | `tests/unit/webhook-signatures.test.ts`<br>`tests/unit/phase-p32-mutation.test.ts` | **PASSED** |
| **V11.1 Concurrency & Business Logic**| Prevention of overselling, double claims, and race conditions. | Database transactions with `SELECT ... FOR UPDATE` lock seat capacity and ticket counters atomically. Checked-in status transitions are atomic. | `tests/unit/phase-p32-concurrency.test.ts`<br>`tests/unit/phase-p32-mutation.test.ts` | **PASSED** |
| **V12.1 Files & Export Sanitization**| Defense against CSV injection and SSRF during file processing. | CSV exports escape formula prefixes (`=`, `+`, `-`, `@`) with prepended apostrophes. Image uploads validate magic byte headers and sanitize filenames. | `tests/unit/csv-sanitization.test.ts`<br>`tests/security/file-upload-hardening.test.ts` | **PASSED** |
| **V13.1 API Contracts** | Strict schema matching and error code enumeration. | OpenAPI 3.0 specification generated from Zod route schemas. API contract verifier checks 100% of frontend `apiClient` calls against backend schemas. | `scripts/verify-api-contracts.ts`<br>`tests/unit/phase-p31-contracts.test.ts` | **PASSED** |
| **V14.1 Configuration Hardening** | Unprivileged container runtime and read-only filesystem. | Multi-stage Docker container executing under unprivileged UID `10001` (`appuser`) with read-only root and writable `tmpfs` mounts. | `tests/unit/docker-hardening.test.ts` | **PASSED** |
