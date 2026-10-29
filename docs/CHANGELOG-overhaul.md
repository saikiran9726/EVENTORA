# Eventora Overhaul Changelog

## Phase P33 — Production Documentation, UAT Matrix, Go-Live Protocol & Payments Compliance Sign-Off

**Date:** 2026-10-29  
**Author:** Principal Full-Stack Engineer  
**Status:** Complete & Verified  

---

### 1. Payment Gateway Architecture & Compliance Disclosure
- **Regulatory Transparency Callout:**
  - Standardized compliance advisory regarding the experimental nature of YouPI-PG (not bank/NPCI-approved or production-certified; parses bank SMS/email notifications; suggests $\le 20$ daily payment attempts per receiving account; serves one payer at a time per UPI ID).
  - Explicit warning that collecting ticket funds through parsing mechanisms requires bank written approval and qualified tax advice.
  - Advised dual-adapter architecture adding a licensed gateway (Razorpay/Cashfree/PhonePe PG) as a second adapter for large or public paid events.
- **Surface Placements:**
  - Integrated into `docs/asvs-l2-checklist.md` as prominent compliance callout.
  - Integrated into Organizer Dashboard (`packages/frontend/src/pages/OrganizerDashboardPage.tsx`) directly in the Financial Ledger tab.
  - Integrated into Event Creation workflow (`packages/frontend/src/pages/events/CreateEventPage.tsx`) directly in the Paid ticket configuration section.

---

### 2. OWASP ASVS 4.0 Level 2 Checklist (`docs/asvs-l2-checklist.md`)
- Complete mapping of ASVS controls (V1 Architecture, V2 Authentication, V3 Session Management, V4 Access Control, V5 Input Validation, V7 Cryptography, V8 Data Protection & Error Handling, V9 Communication Security, V10 Malicious Code, V11 Business Logic, V12 Files/Exports, V13 API Contracts, V14 Configuration) with proving test suites and 100% verification rate.

---

### 3. Production Risk Register & Recovery Targets (`docs/risk-register.md`)
- Documented technical risks, route auth state inventory, and YouPI-PG specific constraints (daily 20-attempt limit, single-payer lock, manual reconciliation requirements).
- Formalized Recovery Point Objective (RPO $\le$ 15 min; achieved 120s) and Recovery Time Objective (RTO $\le$ 1 hour; achieved 0.05s smoke / 12m full restore).

---

### 4. Operations Runbook, On-Call Roster & Restore Evidence (`docs/runbook.md`)
- On-call schedule and paging escalation hierarchy (L1/L2/IC).
- Credential and secret rotation procedures with zero downtime (dual JWT keys, database passwords, PgBouncer, Redis, Resend API keys, YouPI webhook secret).
- Documented live disaster recovery restore rehearsal output via `scripts/restore-rehearsal.ts` verifying all 28 migration versions and core table integrity checksums.
- Detailed rollback playbooks across Render API, Vercel frontend, and PostgreSQL numbered down-migrations.

---

### 5. Requirements Traceability Matrix (`docs/rtm.csv`)
- Updated RTM to include comprehensive trace coverage for all phases P01 through P33, linking UI routes, API endpoints, PostgreSQL tables, security policies, and test IDs.

---

### 6. Entity Relationship Architecture & Complete Table Catalog (`docs/erd.md`)
- Added Mermaid `erDiagram` visualizing relationships between Colleges, Users, Sessions, Events, Venues, Tickets, Bookings, Payments, Outbox, and Turnstile Scans.
- Comprehensive inventory of all 60 active database tables and 46 enums across 9 functional domains.

---

### 7. API Specification & Contract Architecture (`docs/api.md`)
- Detailed documentation of REST and SSE endpoint namespaces, authentication mechanisms (sessions, double-submit CSRF, deny-by-default route policies), integer paise monetary guarantees, and standardized error envelopes.

---

### 8. Production Go-Live Verification & Operational Sign-Off (`docs/go-live.md`)
- Real-device testing matrix: Android Chrome rear camera autofocus, iOS Safari video stream constraints and safe-areas, low-end Android memory footprint with virtualized lists, and throttled 3G offline manifest caching.
- Strict ₹1 payment + refund dry run protocol: explicitly requires human account holder written permission; strictly forbidden from automated agent execution; ₹1.00 exact transaction limit; manual reconciliation and reversal checklist.
- Verified absence of seed accounts in production build (`import.meta.env.DEV` guards).
- Confirmed live alerts, rollback playbooks, and public legal pages (`/terms`, `/privacy`, `/refunds`).

---

### 9. Automated Compliance Test Suite (`tests/unit/phase-p33-docs-uat-compliance.test.ts`)
- 8 automated tests asserting documentation completeness, exact compliance text parity across docs and UI pages, real-device UAT constraints, and ₹1 safety mandates.

---

## Phase P32 — Test Suites, Concurrency Races, Security Zero-PII Snapshots, Mutation Invariants & Load Gate

**Date:** 2026-10-29  
**Author:** Principal Full-Stack Engineer  
**Status:** Complete & Verified  

---

### 1. Concurrency & Race Condition Suite (`tests/unit/phase-p32-concurrency.test.ts`)
- **Oversell Race Condition (`FOR UPDATE` on `ticket_types` & `events`):**
  - 10 concurrent booking holds fired simultaneously against a ticket tier with strictly 2 remaining capacity.
  - Exactly 2 bookings succeeded; 8 were rejected atomically with `CAPACITY_EXCEEDED` / `SOLD_OUT`. Zero oversell verified in database rows (`sold + held == 2`).
- **Double-Scan Turnstile Check-In Race:**
  - 6 concurrent gate scans executed against a single QR token.
  - Exactly 1 scan returned `ACCEPTED`; remaining 5 returned `DUPLICATE`. Database verified with strictly 1 entry in `checkins`.
- **Double-Claim Waitlist Promotion Race:**
  - 5 concurrent claim requests using the same offer token.
  - Exactly 1 claim succeeded with ticket creation; 4 requests failed with `409 OFFER_INVALID_OR_EXPIRED`.
- **Double-Confirm Payment Webhook Race:**
  - Concurrent payment confirmations / webhooks for the same order.
  - Exactly 1 executed transaction transition and ticket creation; the second returned `{ confirmed: true, alreadyProcessed: true }` without duplicate ticket generation.
- **Refund Concurrency Race:**
  - Concurrent organizer decisions on a refund request.
  - Exactly 1 succeeded; second decision rejected with `409 ALREADY_DECIDED`.

---

### 2. Security Suite & Zero-PII Snapshots on Public Endpoints (`tests/security/phase-p32-security-pii.test.ts`)
- **Recursive PII Leaks Assertion:**
  - Public discovery catalog (`GET /api/v1/events`), event details (`GET /api/v1/events/:slug`), calendar (`GET /api/v1/calendar`), venues (`GET /api/v1/venues`), ratings (`GET /api/v1/events/:id/ratings`), public student passport (`GET /api/v1/p/:slug`), public certificate lookup (`GET /api/v1/verify/:code`), and OpenAPI specification (`GET /openapi.json`).
  - Proved zero exposure of sensitive fields (`password`, `password_hash`, `roll_number`, `session_token`, `payment_secret`, `secret`, `webhook_secret`).
- **Security Headers & CSRF Verification:**
  - Enforced `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, and CSP.
  - Verified 403 rejection on state-changing requests when double-submit CSRF token is missing or mismatched.

---

### 3. Mutation Testing on Booking and Payments (`tests/unit/phase-p32-mutation.test.ts`)
- **Mutant Invariants Killed:**
  - Mutant 1: Fractional / float money acceptance mutant killed by strict `z.number().int().nonnegative()` paise validation.
  - Mutant 2: Non-atomic capacity oversell mutant killed by PostgreSQL `FOR UPDATE` lock assertions.
  - Mutant 3: Double-scan status check-then-set race window mutant killed by atomic single-statement update.
  - Mutant 4: Anti-self-dealing refund decider mutant killed by 403 `FORBIDDEN` self-dealing check.
  - Mutant 5: Webhook signature bypass mutant killed by constant-time `crypto.timingSafeEqual` HMAC-SHA256 verification.

---

### 4. Playwright End-to-End Journeys with ZERO Network Mocks (`tests/e2e/phase-p32-no-mock-journeys.spec.ts`)
- Executed real browser journeys hitting live Fastify API (port 4000) and live Vite frontend (port 5173) on real Postgres:
  - Journey 1: Student register $\to$ email verify $\to$ sign in $\to$ discovery $\to$ passport view.
  - Journey 2: Club Organizer Command Center & Analytics view.
  - Journey 3: Turnstile Check-in Scanner interface with camera/offline UI elements.
  - Journey 4: Campus Teams & Collaboration portal.
- All 7 e2e tests passed (including consent checkbox compliance fix in `auth-flow.spec.ts`).

---

### 5. k6 Load Test Suite & Threshold Verification (`tests/unit/phase-p32-k6-thresholds.test.ts`)
- Verified pass/fail SLAs for all 4 load test profiles in `tests/load/`:
  - `last_seats.js`: `http_req_duration p(95)<1000ms`, `http_req_failed rate<0.02` under 200 VUs.
  - `paid_checkout.js`: `http_req_duration p(95)<1500ms`, `http_req_failed rate<0.01` under 100 VUs.
  - `checkin_burst.js`: `http_req_duration p(95)<400ms`, `http_req_failed rate<0.02` under 150 VUs.
  - `login_burst.js`: `http_req_duration p(95)<800ms`, `http_req_failed rate<0.05` under 150 VUs.
- Added `@vitest/coverage-v8` with `"test:coverage": "vitest run --coverage"`.

---

## Phase P31 — API Contracts: OpenAPI Derivation, Typed Client, Shared Error Codes & Guard Verification

**Date:** 2026-10-29  
**Author:** Principal Full-Stack Engineer  
**Status:** Complete & Verified  

---

### 1. OpenAPI 3.0 Derivation via Zod & Swagger
- **Fastify Type-Provider & Swagger Integration (`packages/backend/src/app.ts`):**
  - Integrated `fastify-type-provider-zod` and `@fastify/swagger` with `jsonSchemaTransform`.
  - Configured OpenAPI 3.0 specification metadata (`Eventora API v1.0.0`) with Bearer auth and session security schemes.
  - Exposed live OpenAPI 3.0 JSON specification endpoints at `GET /openapi.json` and `GET /api/v1/openapi.json`.
  - Added JSON schema annotations across key endpoints (`/api/v1/events/`, `/api/v1/events/{id}`, `/api/v1/bookings/{id}/checkout`, `/api/v1/bookings/{id}/refunds`, etc.).

---

### 2. Typed API Client & Contract Enforcement
- **Central Endpoint Contract Registry (`packages/shared/src/api-contracts.ts`):**
  - Created `API_ROUTES` mapping paths, HTTP methods, parameter schemas, request schemas, and response schemas.
  - Implemented `matchContractRoute` helper to test endpoint and method compatibility.
- **Strongly-Typed Client Factory (`packages/shared/src/typed-client.ts`):**
  - Implemented `createTypedClient(fetcher)` exposing type-safe domain namespaces (`auth`, `events`, `bookings`, `payments`, `tickets`, `checkin`, `spec`).
  - Added `validateEndpointContract(endpoint, method)` which verifies route existence and guards against drift between frontend and backend.
- **Frontend Integration (`packages/frontend/src/lib/api-client.ts`):**
  - Attached `apiClient.typed = createTypedClient(apiClient)` and `apiClient.validateContract = validateEndpointContract`.
  - Typed `ApiError.code: ErrorCode | string` with strict enum checking.

---

### 3. Shared Error-Code Enum Parity
- **Centralized Error Codes (`packages/shared/src/error-codes.ts` & `packages/shared/src/error.ts`):**
  - Defined 100+ standard error code strings in `ERROR_CODES` constant tuple and exported `ErrorCode` type.
  - Normalized domain errors across authentication, CSRF, event lifecycle, booking/holds, payments, tickets/check-in, and feedback.
  - Updated `StrictErrorEnvelopeSchema` to reject uncontracted error codes (e.g. catches typo/legacy `BOOKING_EXPIRED` in favor of `HOLD_EXPIRED`).

---

### 4. Contract CI Verification & Quality Gates
- **Contract Verification Script (`scripts/verify-api-contracts.ts`):**
  - Inspects live Fastify route tree against `API_ROUTES`.
  - Scans frontend source files for all `apiClient` calls and `error.code` assertions to detect uncontracted paths and unrecognized error codes.
  - Added npm script `"contracts:check": "tsx scripts/verify-api-contracts.ts"`.
- **Test Suite (`tests/unit/phase-p31-api-contracts.test.ts`):**
  - 15 unit tests covering OpenAPI derivation, shared error code enum parity, typed client invocation, integer paise refund verification, and negative breaking-change guard tests (catching route renaming, `/refund` vs `/refunds`, and bogus error codes).
- **Verification Gates:**
  - `pnpm contracts:check` passed (14 contracted routes verified, 0 violations).
  - `pnpm typecheck` passed cleanly across all packages.
  - `pnpm lint` passed with 0 errors.
  - `pnpm license:check` passed (33 production dependencies verified).

---

## Phase P30 — Accessibility (WCAG 2.2 AA), Performance Budgets, Shareable Event SEO, PWA & i18n

**Date:** 2026-10-29  
**Author:** Principal Full-Stack Engineer  
**Status:** Complete & Verified  

---

### 1. WCAG 2.2 AA Accessibility Quality Gate
- **Focus Rings & Reduced Motion:**
  - High-contrast visible focus rings implemented globally across dark and light themes (`:focus-visible:outline-none :focus-visible:ring-2 :focus-visible:ring-brand :focus-visible:ring-offset-2`).
  - Pre-configured `prefers-reduced-motion: reduce` resets in `packages/frontend/src/index.css`.
- **Landmarks & Skip Navigation:**
  - Added skip link in `packages/frontend/src/App.tsx` pointing to `#main-content` with focus styling (`sr-only focus:not-sr-only`).
  - Standardized `<main id="main-content" tabIndex={-1}>` and `<header>`, `<nav aria-label="...">`, `<aside>` landmarks across all shell layouts (`StudentShell`, `OrganizerShell`, `AdminShell`, `ReviewerShell`, `CheckinShell`).
- **Live Announcements (`aria-live`):**
  - `ToastProvider`: `role="status"` / `role="alert"` with `aria-live="polite"` and `aria-atomic="true"`.
  - `ReceiptView`: Accessible live payment confirmation region (`aria-live="polite"`, `role="status"`).
  - `CheckoutPage`: Interactive step announcements (`aria-live="polite"`).
  - `ScannerPage`: Real-time gate scan outcome assertions (`aria-live="assertive"`).
- **Control Labelling & Tap Targets:**
  - Enforced minimum 44px tap targets (`min-h-[44px] min-w-[44px]` / `min-h-[48px]`) on interactive controls and mobile bottom navigation.
  - Screen reader passes verified on FormBuilder reordering (`aria-label="Move question up"`, `aria-label="Move question down"`), scanner controls, and checkout input fields.

---

### 2. Performance Budgets, Route Splitting & Chunk Optimization
- **Code-Splitting & Vendor Chunk Isolation (`packages/frontend/vite.config.ts`):**
  - Granular manual chunk splitting: `vendor-react`, `vendor-query`, `vendor-motion`, `vendor-sentry`, `vendor-icons`.
  - Initial JS bundle gzipped strictly contained under the 200KB threshold (entry bundle $\approx$ 40KB gzipped).
- **Dynamic Imports:**
  - `html5-qrcode` dynamic import in `ScannerPage.tsx` avoids bundling barcode scanning code into main bundle.
- **Row Virtualization (`packages/frontend/src/components/ui/VirtualList.tsx`):**
  - Windowing component calculating visible index bounds for lists/rosters with $>200$ rows, rendering only $\approx 16$ active DOM elements.
- **Modern Responsive Images (`packages/frontend/src/components/ui/ResponsiveImage.tsx`):**
  - Generates `<picture>` tags with AVIF and WebP sources, lazy loading (`loading="lazy" decoding="async"`), and layout aspect ratio locks (CLS $< 0.1$).
- **Lighthouse CI Configuration (`.lighthouserc.json`):**
  - Enforces performance $\ge 0.9$, accessibility $\ge 0.95$, SEO $\ge 0.9$, LCP $< 2.5$s, CLS $< 0.1$, and initial JS $< 200$KB.

---

### 3. Shareable Event Pages, SEO, Open Graph & Structured Data
- **Vercel Edge Middleware (`middleware.ts`, `packages/frontend/middleware.ts`):**
  - Intercepts crawler/bot user agents (Googlebot, Facebook, Twitter, WhatsApp, LinkedIn, Slack, Telegram, Discord) requesting `/events/:slug`.
  - Injects OpenGraph meta tags, Twitter summary card, and `schema.org/Event` JSON-LD.
- **Client-Side Dynamic SEO (`packages/frontend/src/pages/EventDetailsPage.tsx`):**
  - Updates `document.title` and dynamically injects `schema.org/Event` JSON-LD script into `document.head`.
  - Structured data includes attendance mode (in-person/online/hybrid), event status, ISO dates in IST, ticket tiers, venue details, and organizer info.
- **Public Sitemap & Robots (`packages/backend/src/routes/api/v1/seo.ts`):**
  - `GET /sitemap.xml`: Generates valid XML containing published public events and strictly excluding private events (`visibility != 'public'`).
  - `GET /robots.txt`: Disallows sensitive administrative paths (`/admin`, `/organizer`, `/reviewer`, `/scan`, `/api/`) and points to `/sitemap.xml`.
  - Rewrites mapped in root and frontend `vercel.json`.

---

### 4. PWA (Workbox), Offline Ticket Presentation & i18n
- **Web App Manifest (`packages/frontend/public/manifest.webmanifest`):**
  - Configures standalone display mode, theme colors, shortcut icons, and offline pass presentation.
- **Workbox Service Worker (`packages/frontend/public/sw.js`):**
  - App shell precaching (`/`, `/index.html`, `/favicon.svg`).
  - StaleWhileRevalidate for scripts, styles, and scanner assets.
  - NetworkFirst with offline cache fallback for student tickets (`/tickets`, `/qr`).
  - Listens for `SKIP_WAITING` for zero-friction service worker updates.
- **PWA Update Prompt (`packages/frontend/src/components/ui/PWAUpdatePrompt.tsx`):**
  - Floating accessible notification prompting users when new builds are deployed, with one-click reload.
- **ECMAScript `Intl` IST & Currency Formatting (`@eventora/shared`):**
  - Localized Indian Rupee formatting (`formatPaiseToRupee`) using `Intl.NumberFormat('en-IN')`.
  - Indian Standard Time date/time formatters (`formatISTDate`, `formatISTTime`, `formatISTDateTime`, `formatISTDateRange`) using `Intl.DateTimeFormat` with `timeZone: 'Asia/Kolkata'`.
- **Multi-Language Message Catalogs (English, Hindi, Telugu):**
  - Message catalogs implemented in `packages/frontend/src/i18n/`: `en.json`, `hi.json` (हिन्दी), `te.json` (తెలుగు).
  - Context provider (`I18nContext.tsx`) with automatic locale detection, persistent storage, and fallback mechanisms.
  - Accessible Language Selector (`LanguageSelector.tsx`).

---

## Phase P29 — CI/CD Automation, Hardened Non-Root Containerization & Automated Rollback

**Date:** 2026-10-29  
**Author:** Principal Full-Stack Engineer  
**Status:** Complete & Verified  

---

### 1. GitHub Actions CI/CD Pipeline (`.github/workflows/ci.yml`)
- **Pipeline Architecture:**
  - `pnpm install --frozen-lockfile` caching across root and packages.
  - Multi-stage concurrent job matrix:
    - **`validate` Job:** Monorepo typechecking (`pnpm typecheck`), ESLint (`pnpm lint`), production license audit (`pnpm license:check`), production dependency audit (`pnpm audit --prod`), and Gitleaks secret scanner.
    - **`test` Job:** Full unit & integration testing (`pnpm test:unit` / `vitest run`) backed by dedicated GitHub Actions service containers:
      - PostgreSQL 16 on port 5432 (`postgres:16-alpine`) with health checks.
      - Redis 7 on port 6379 (`redis:7-alpine`) with health checks.
    - **`build` Job:** Full monorepo production build (`pnpm build`), followed by Docker image builds for `Dockerfile.api`, `Dockerfile.web`, and `Dockerfile.worker` with Trivy vulnerability scanning for `CRITICAL` issues.
    - **`e2e` Job:** End-to-end testing with Playwright (Desktop Chrome + Mobile viewport) alongside automated `axe-core` accessibility audits (`@axe-core/playwright`).
    - **`vercel-preview` Job:** Automated pull-request preview deployments for review and staging validation.

---

### 2. Production Deployment & Automated Rollback Pipeline (`.github/workflows/deploy-production.yml`)
- **Zero-Downtime Deployment Lifecycle:**
  - Gated by GitHub Environment `production` with required manual review/approval.
  - Automated additive database migrations (`pnpm --filter @eventora/backend run db:migrate`).
  - Concurrent deployment dispatch to Render (API & Worker services) and Vercel Production (Frontend SPA).
  - Post-deployment live smoke tests hitting `/health` (process liveness) and `/readiness` (Postgres, Redis, worker heartbeat).
  - Automated failure recovery invoking `scripts/rollback.sh` on smoke test failure to down-migrate schema, roll back Render commits, and record `deployment_rollback` into `ops_runs`.

---

### 3. Dependency License Compliance Guard (`scripts/check-licenses.ts`)
- **Direct Production Dependency Auditing:**
  - Automated scanner checking all root and package production dependencies against approved permissive licenses:
    - Allowed: `MIT`, `ISC`, `Apache-2.0`, `BSD-2-Clause`, `BSD-3-Clause`, `CC0-1.0`, `0BSD`, `Unlicense`, `Python-2.0`.
    - Prohibited & Flagged: Viral copyleft (`GPL`, `AGPL`, `SSPL`).
  - Integrated into root scripts: `"license:check": "tsx scripts/check-licenses.ts"`.
  - Zero non-compliant licenses detected across 31 production packages.

---

### 4. Hardened Non-Root & Read-Only Root Filesystem Dockerfiles
- **API Server Container (`Dockerfile.api`):**
  - Multi-stage Node.js 20 Alpine builder and runner.
  - Unprivileged user `eventora` (`USER 10001:10001`).
  - Read-only root filesystem readiness with mounted tmpfs volume (`VOLUME ["/tmp"]`).
  - Container healthcheck hitting `http://localhost:4000/health`.
- **Web SPA Container (`Dockerfile.web`):**
  - Hardened Nginx 1.25 Alpine runner serving SPA assets.
  - Listens on unprivileged port `8080` (replacing privileged port 80).
  - Non-root user `eventora` (`USER 10001:10001`) with permissions on `/usr/share/nginx/html`.
  - Read-only root filesystem compatible: PID written to `/tmp/nginx.pid` and volumes declared for `VOLUME ["/tmp", "/var/cache/nginx", "/var/run"]`.
- **Background Worker Container (`Dockerfile.worker`):**
  - Unprivileged runner (`USER 10001:10001`) executing `dist/worker.js`.
  - Temporary volume isolation (`VOLUME ["/tmp"]`).

---

### 5. Automated Rollback & Deploy Automation (`scripts/rollback.sh`, `scripts/deploy.sh`)
- **Rollback Automation (`scripts/rollback.sh`):**
  - Accepts `<release-tag>` and optional `[target-schema-version]`.
  - Validates and safely rolls back database schema using `packages/backend/src/db/migrate-down.ts`.
  - Reverts deployments on Render via API and verifies live health.
  - Logs structured operational audit telemetry directly to `ops_runs`.
- **Deployment Automation (`scripts/deploy.sh`):**
  - Validates pre-flight conditions, runs migrations, verifies live readiness, and creates git release tags with commit hashes.

---

### 6. Environment Configurations & Repository Governance
- **Staging vs Production Configurations:**
  - `config/staging.env.example`: Staging database (`eventora_staging`), isolated staging Redis, payment simulator (`PAYMENT_ADAPTER=simulator`), and sandbox email recipients.
  - `config/production.env.example`: Production Supabase Postgres pooler, live Redis, live YouPI-PG payment gateway (`PAYMENT_ADAPTER=youpi`), strict origin allowlist, and live Resend mailer.
- **Repository Governance:**
  - `.github/dependabot.yml`: Automated weekly dependency audits across npm packages and GitHub Actions.
  - `.github/BRANCH_PROTECTION.md`: Formalized rules for `master`/`main` branches requiring PRs, passing CI status checks, linear history, and zero admin bypass.

---

## Phase P28 — Observability, Runtime Hardening, Sentry, Graceful Teardown & Health Split

**Date:** 2026-10-29  
**Author:** Principal Full-Stack Engineer  
**Status:** Complete & Verified  

---

### 1. Unified Pino Logger, Extended Redaction & Request ID Tracing
- **Unified Logger (`packages/backend/src/logger.ts`):**
  - Exported single unified Pino logger instance across API server and background worker.
  - Extended redaction paths covering all sensitive and financial vectors:
    - Passwords & secrets: `password`, `*.password`, `body.password`, `passwordHash`, `secret`, `body.secret`.
    - Session & auth tokens: `token`, `*.token`, `body.token`, `sessionToken`, `refreshToken`, `csrfToken`, `cookie`, `authorization`.
    - QR codes: `qr`, `*.qr`, `qrTokenHash`, `qrData`.
    - Banking & UPI/UTR details: `utr`, `*.utr`, `body.utr`, `youpiUtr`, `cardNumber`, `cvv`, `pin`, `pan`, `aadhaar`.
    - Personal Identifiable Information: `email`, `phone`, `phoneNumber`, `answers`, `registrationAnswers`.
  - Serializers/formatters with privacy-preserving string masking:
    - `maskEmail`: Formats emails to `a***t@domain.com` (first and last characters visible).
    - `maskPhone`: Formats phones to `******3210` (preserving only the last 4 digits).
- **Request ID Propagation (Browser $\rightarrow$ API $\rightarrow$ Logs $\rightarrow$ Errors):**
  - Frontend (`packages/frontend/src/lib/api-client.ts`): Generates UUID `X-Request-ID` header on requests and captures `x-request-id` response header onto `ApiError`.
  - Backend (`packages/backend/src/app.ts`):
    - Configured Fastify with `requestIdHeader: 'x-request-id'`, `requestIdLogLabel: 'requestId'`, and `genReqId` checking client headers.
    - Added `onSend` hook echoing `x-request-id` on every HTTP response.
    - Attached `requestId: req.id` to all error envelopes.
  - UI Error Surfaces:
    - `packages/frontend/src/components/ui/Toast.tsx`: Added `requestId?: string` to `ToastItem`. Error toasts render `Ref: {requestId}` with one-click copy button.
    - `packages/frontend/src/components/ui/FeedbackStates.tsx`: `ErrorState` view presents request ID and copy pill.

---

### 2. Sentry Observability Across Backend, Worker & Frontend
- **Backend & Worker Sentry (`packages/backend/src/lib/sentry.ts`):**
  - Configured `@sentry/node` initialization for backend API (`initBackendSentry`) and worker (`initWorkerSentry`).
  - Automated release tracking (`SENTRY_RELEASE` or package version) and environment tagging (`NODE_ENV`).
  - Error tagging with `requestId`, user context, and route metadata in Fastify error handler.
- **Frontend Sentry (`packages/frontend/src/lib/sentry.ts`):**
  - Configured `@sentry/react` initialization (`initFrontendSentry`) inside `packages/frontend/src/main.tsx`.
  - Integrated with `packages/frontend/src/lib/error-reporter.ts`.
  - Enabled production source maps in `packages/frontend/vite.config.ts` (`build: { sourcemap: true }`).

---

### 3. Operational Alerts Instrumentation
- **Automated Metric Alerts (`packages/backend/src/lib/sentry.ts`):**
  - **5xx Error Rate Alert:** Monitored over sliding 5-minute window in `packages/backend/src/routes/monitoring.ts`. Triggers `trigger5xxAlert` if error rate exceeds 5% over $\ge 20$ requests.
  - **p95 Latency Alert:** Aggregated in `metricsStore.requestDurations`. Triggers `triggerP95Alert` if p95 response time exceeds 1000ms.
  - **Dead Letter Alert:** Integrated into `packages/backend/src/services/outbox-worker.ts`. Triggers `triggerDeadLetterAlert` when transactional outbox records exceed retry cap and transition to `DEAD`.
  - **Payment Mismatch Alert:** Integrated into `packages/backend/src/services/payment.ts`. Triggers `triggerPaymentMismatchAlert` when webhook amounts or currencies deviate from stored orders.
  - **Reconciliation Drift Alert:** Integrated into `packages/backend/src/services/reconciliation.ts`. Triggers `triggerDriftAlert` during nightly reconciliation runs.
  - **Worker Heartbeat Alert:** Evaluated in `packages/backend/src/routes/monitoring.ts`. Triggers `triggerWorkerHeartbeatAlert` when background worker loop heartbeat exceeds 30 seconds.

---

### 4. Split Liveness vs Deep Readiness
- **Liveness Routes (`GET /health` & `GET /healthz`):**
  - Immediate process alive check (200 OK with `status: 'ok'`, `uptime`, `timestamp`). Zero external database or cache queries.
  - Exempt from authentication and session decoding overhead in `packages/backend/src/plugins/auth-policy.ts`.
- **Readiness Routes (`GET /readiness`, `GET /ready`, `GET /readyz`):**
  - Deep dependency health check:
    - Postgres: `SELECT 1` with a strict 3-second timeout. Returns **503 Service Unavailable** if database connection fails.
    - Redis: Evaluates connection via `getRedisClient().ping()`.
    - Schema Migrations: Validates `MAX(version) >= 11`.
    - Worker Heartbeat: Validates worker pulse freshness.

---

### 5. Graceful Teardown Lifecycle & Process Safety
- **Shutdown Sequence (`packages/backend/src/index.ts` & `packages/backend/src/worker.ts`):**
  - Ordered graceful shutdown via `createGracefulShutdown`:
    1. Stop accepting new HTTP requests and drain in-flight connections (`await server.close()`).
    2. Stop background schedulers and worker loops (`stopOutboxWorker()`, `stopHoldReconcilerWorker()`, `stopEventCompleterWorker()`).
    3. Close database connection pool (`await pool.end()`).
  - Signal listeners for `SIGTERM` and `SIGINT` trigger clean shutdown.
  - Safety timeout (10s) prevents hung processes from stalling deployments.
  - Global process error handling for `uncaughtException` and `unhandledRejection` with structured logging, Sentry exception capture, and graceful process exit.
  - Wrapped `start()` in `.catch(...)` in `index.ts` to ensure unhandled startup failures are logged and terminate with non-zero exit code.

---

### 6. Verification & Quality Gates
- `tests/unit/phase-p28-observability-runtime.test.ts`: **15/15 tests passing**.
- `tests/unit/phase-p27-db-hardening-privacy.test.ts`: **16/16 tests passing**.
- `tests/security/tenant-isolation.test.ts`: **5/5 tests passing**.
- `pnpm typecheck`: **0 errors across @eventora/shared, @eventora/backend, @eventora/frontend**.
- `pnpm lint`: **0 errors**.

---

## Phase P27 — Database Hardening, Search GIN, Privacy Compliance & Nightly Reconciliation

**Date:** 2026-10-29  
**Author:** Principal Full-Stack Engineer  
**Status:** Complete & Verified  

---

### 1. Performance Indexes & Full-Text Search GIN
- **Migration 28 (`packages/backend/src/db/migrate.ts`):**
  - Applied transactional advisory locking `SELECT pg_advisory_xact_lock(71829301)` to prevent concurrent migration collisions.
  - Added SHA-256 migration checksum tracking to `schema_migrations`.
  - Added 13 production performance indexes across hot query paths:
    - `idx_events_status_starts_at` on `events(status, starts_at)`
    - `idx_events_organizer_status` on `events(organizer_id, status)`
    - `events.search_vector` generated column (`tsvector` over `title`, `description`, `category`, `tags`) with GIN index `idx_events_search_vector`
    - `idx_bookings_user_status` on `bookings(user_id, status)`
    - `idx_bookings_event_status_created` on `bookings(event_id, status, created_at)`
    - `idx_bookings_pending_payment` on `bookings(status, expires_at) WHERE status = 'PENDING_PAYMENT'`
    - `idx_tickets_event_status` on `tickets(event_id, status)`
    - `idx_tickets_qr_token_hash` unique index on `tickets(qr_token_hash)`
    - `idx_waitlist_tier_status_created` on `waitlist_entries(ticket_type_id, status, created_at, id)`
    - `idx_outbox_status_next_attempt` on `outbox(status, next_attempt_at)`
    - `idx_notifications_user_created` on `notifications(user_id, created_at)`
    - `idx_sessions_user_active` on `sessions(user_id) WHERE revoked_at IS NULL`
    - `idx_scan_log_event_at` on `scan_log(event_id, at)`
  - Reversible down-migration 28 $\rightarrow$ 27 in `packages/backend/src/db/migrate-down.ts` tested and verified live against PostgreSQL 18.
  - Synchronized Drizzle schema definitions in `packages/backend/src/db/schema.ts`.

---

### 2. Transaction Retry Mechanism
- **Serialization & Deadlock Resilience (`packages/backend/src/db/transaction.ts`):**
  - Implemented `withTransactionRetry` helper supporting retryable PostgreSQL error codes `40001` (`serialization_failure`) and `40P01` (`deadlock_detected`).
  - Configurable exponential backoff with randomized jitter (`baseDelayMs`, `maxDelayMs`, `maxRetries`) and strict rollback on failure.

---

### 3. DPDP & GDPR Privacy Compliance
- **Frontend Legal Pages & User Consent:**
  - Added statutory policy routes and components in `packages/frontend/src/pages/legal/`:
    - Privacy Policy (`/privacy` $\rightarrow$ `PrivacyPolicyPage.tsx`) detailing DPDP Act 2023 compliance, data collection, rights, and retention.
    - Terms of Service (`/terms` $\rightarrow$ `TermsOfServicePage.tsx`) covering student/organizer usage guidelines, ticketing, and platform rules.
    - Refund Policy (`/refunds` $\rightarrow$ `RefundPolicyPage.tsx`) specifying 48-hour event refund eligibility, organizer review windows, and platform processing.
  - Updated `packages/frontend/src/pages/auth/RegisterPage.tsx` with mandatory explicit consent checkbox requiring acceptance of Terms of Service and Privacy Policy before registration.
- **Privacy Service & Personal Data Operations (`packages/backend/src/services/privacy.ts`):**
  - `truncateIp`: Truncates IPv4 addresses to `/24` (zeroing last octet) and IPv6 to `/48` (first 3 hextets).
  - `anonymizeAndHashIp`: Hashes truncated IP with SHA-256 and salted pepper (`PRIVACY_PEPPER`).
  - Integrated privacy-preserving IP hashing into `logAuditEvent` and `createSession`.
  - `getUserDataExport(userId)`: Generates machine-readable personal data export in JSON across user profile, bookings, tickets, certificates, feedback, waitlists, notifications, and team memberships via `GET /api/v1/me/data-export`.
  - `anonymizeUserData(userId)`: Right to Erasure / erasure workflow via `DELETE /api/v1/me`:
    - Pseudonymizes user profile (scrambles email to `deleted_<hash>@privacy.eventora.internal`, sets displayName to `Anonymous User`, clears department and year).
    - Clears registration answers and non-essential PII.
    - Retains legally required financial ledger and transaction entries.
    - Immediately revokes all active sessions and refresh tokens.

---

### 4. Statutory Data Retention Purge Engine
- **Automated Retention Service (`packages/backend/src/services/retention.ts`):**
  - `runDataRetentionPurge(options)` purges expired operational data across:
    - Check-in `scan_log` older than 90 days.
    - Delivered / dead `outbox` records older than 30 days.
    - Revoked / expired `sessions` older than 30 days.
    - Expired `password_resets` tokens older than 7 days.
    - Historical `ops_runs` metrics older than 90 days.
  - Audits execution summary and purged counts inside `ops_runs` with `kind = 'retention_purge'`.

---

### 5. Nightly Financial & Inventory Reconciliation
- **Reconciliation Engine (`packages/backend/src/services/reconciliation.ts`):**
  - Computes net ledger paise ($\sum \text{charges} - \sum \text{refunds}$) and compares against settled payments minus succeeded refunds.
  - Recomputes live `sold` and `held` ticket counts directly from confirmed bookings and active booking items per ticket type.
  - Detects inventory and financial drift, recording status (`SUCCESS` or `DRIFT_ALERT`) into `ops_runs`.
  - Provides optional auto-healing flag (`autoHeal: true`) to realign `ticket_types.sold` and `held` to physical ticket realities without violating capacity constraints.

---

### 6. Tenant Isolation Security Gate
- **Multi-Tenancy Guard (`packages/backend/src/routes/api/v1/events.ts`, `packages/backend/src/services/passport-crosscollege.ts`):**
  - Strictly enforces campus tenant boundary: college-scoped events (`visibility = 'college'`) cannot be discovered, fetched by direct ID/slug, or booked by students or organizers of other institutions.
  - Cross-college events (`visibility = 'public'`) remain accessible to eligible participating institutions.
  - Tested in `tests/security/tenant-isolation.test.ts`.

---

### 7. Verification & Quality Gates
- `tests/unit/phase-p27-db-hardening-privacy.test.ts`: **16/16 tests passing**.
- `tests/security/tenant-isolation.test.ts`: **5/5 tests passing**.
- `pnpm typecheck`: **0 errors across @eventora/shared, @eventora/backend, @eventora/frontend**.
- `pnpm lint`: **0 errors**.

---

## Phase P26 — Remove Every Mock / Prototype Artifact, Tree-Shake Demo Mode & ESLint Import Bans

**Date:** 2026-10-29  
**Author:** Principal Full-Stack Engineer  
**Status:** Complete & Verified  

---

### 1. ESLint Policy & Static Import Guard
- **Restricted Imports Rule (`eslint.config.js`):**
  - Configured `@typescript-eslint` rule `no-restricted-imports` with patterns matching `**/mock/**`, `**/prototype/**`, `@/mock/**`, `@/prototype/**`, `../mock/**`, `../prototype/**` across `packages/frontend/src/**/*.{ts,tsx}`.
  - Exempts test and story suites (`**/*.test.{ts,tsx}`, `**/*.spec.{ts,tsx}`, `**/*.stories.{ts,tsx}`).
  - Strictly prevents new or legacy frontend code from referencing mock or prototype artifacts outside testing harnesses.

---

### 2. Elimination of Hardcoded Mock Artifacts & Fallbacks
- **Empty API Results $\Rightarrow$ Real Empty States:**
  - `DiscoveryPage.tsx`: Completely removed `PROTOTYPE_EVENTS` import and merging. Added dedicated empty state displaying `Compass` icon, "No events found", and filter reset button.
  - `EventDetailsPage.tsx`: Removed `PROTOTYPE_EVENTS` import and `prototypeEvent` fallback. Rendered clean loading spinner and `Event Not Found` card. Neutralized fake star ratings (`feedbackCount: 0, ratingAvg: 0`).
  - `TicketSelector.tsx`: Removed fake fallback tier (`default-free-pass`). Added explicit empty state: "No ticket tiers are currently available for this event."
  - `OrganizerDashboardPage.tsx`: Removed `PROTOTYPE_ORGANIZER_STATS` and `PROTOTYPE_ATTENDEES`. Initialized `organizerEvents: []`, `salesSummary`, and `ledgerEntries` to real empty/zero. Replaced mock attendee roster with live data from `/api/v1/events/:id/attendance` and empty table states. Replaced mock proposal IDs with dynamic event options. Removed mock feedback moderation bypass.
  - `VolunteerHubPage.tsx`: Initialized `openShifts: []`, `myShifts: []`, `totalHours: 0`. Removed `shift-demo-` and `app-demo-` bypasses; added real empty states to volunteer tabs.
  - `TeamsPage.tsx`: Removed `team-mock-1` / `NeuralHack Squad` injection and fake members. Now renders empty state when user has no teams.
  - `NotificationCenter.tsx`: Removed `mockNotifications` (`notif_urgent_01`, `notif_imp_02`, `notif_info_03`). API failure or empty results now yield an empty notification center.
  - `AlertComposer.tsx`: Removed hardcoded sample alerts (`alt_01`, `alt_02`) and fake 42 attendee recipient count fallback. API errors trigger proper error toasts without fake local addition.
  - `PassportPage.tsx`: Removed `DEFAULT_PROTOTYPE_ACHIEVEMENTS` and initialized clean empty states for achievements and certificates. Removed `Aarav Patel` and symposium fallback from certificate downloads.
  - `PublicPassportPage.tsx`: Removed hardcoded `aarav-patel` fallback; non-existent student slugs cleanly render 404 Passport Not Found state.
  - `PublicVerifyPage.tsx`: Removed hardcoded `7H9K-2M4N-8PQR` fake success verification branch.
  - `CalendarPage.tsx`: Catch block initializes empty events array (`setEvents([])`) rather than fake calendar entries.
  - `MyBookingsPage.tsx`: Removed fake `mock-bk-1` / `AI & Robotics Annual Symposium` default fallback in catch/else blocks.
  - `ReviewQueuePage.tsx`: Removed fake `mock-prop-1` / `mock-prop-2` in catch block and removed `selectedProposal.id.startsWith('mock-')` bypass.
  - `FeedbackSheet.tsx`: Removed `mock-` and non-UUID bypasses that simulated success toasts without reaching backend endpoints.
  - `ExportDialog.tsx`: Removed `mock-` event export bypass that simulated download links without calling `/api/v1/organizer/events/:id/exports`.
  - `AdminPortalPage.tsx`: Removed fake local state updates on failure in club verification; all errors bubble to standard error envelopes.

---

### 3. Build-Time Demo Mode Tree-Shaking & Component Gallery Gating
- **Shell Demo Banners Gated by `VITE_DEMO_MODE`:**
  - In `AppShell.tsx`, `StudentShell.tsx`, `AdminShell.tsx`, `OrganizerShell.tsx`, `ReviewerShell.tsx`, and `CheckinShell.tsx`:
    - Removed `PROTOTYPE_BADGE_TEXT` and `MOCK_BANNER_TEXT` imports.
    - Wrapped demo/prototype banners in `{import.meta.env.VITE_DEMO_MODE === 'true' && (...)}`.
    - Evaluates statically to `false` in production builds where `VITE_DEMO_MODE` is unset, triggering complete tree-shaking and elimination by Vite/esbuild/Rollup.
- **Component Gallery & Dev Route Gating:**
  - In `App.tsx`: `/components` route is guarded with `import.meta.env.DEV ? <ComponentGalleryPage /> : <Navigate to="/" replace />`.
  - All navigation links to `/components` in sidebar shells are guarded by `import.meta.env.DEV`.

---

### 4. Bundle Grep & Acceptance Verification
- **Production Bundle Grep Audit:**
  - Production build (`pnpm --filter @eventora/frontend build`) generates clean JavaScript bundles in `packages/frontend/dist/assets/`.
  - Automated grep inspection of all `.js` files in `dist/assets` confirmed 0 matches for:
    - `PROTOTYPE_EVENTS`
    - `MOCK_BANNER_TEXT`
    - `aarav-patel`
    - `evt-demo`
    - `bkg_demo_`
    - `team-mock-1`
    - `mock/data`
    - `prototype/data`
- **Quality Gate Tests:**
  - `tests/unit/phase-p26-no-mock-artifacts.test.ts`: 6 tests verifying ESLint rules, static source cleanliness, mock ID absence, bundle tree-shaking, `/components` DEV route guard, and shell `VITE_DEMO_MODE` gating.
  - `tests/e2e/phase-p26-empty-states.spec.ts`: E2E tests validating empty states across discovery, 404 for unknown student slugs on `/p/:slug`, and absence of prototype badges.
- **Monorepo Quality Gates:**
  - `pnpm typecheck`: 0 errors across `@eventora/shared`, `@eventora/backend`, `@eventora/frontend`.
  - `pnpm lint`: 0 errors.
  - Database schema: Additive and intact at Migration 27.


## Phase P25 — Offline Check-in Redesign, WebCrypto HMAC & Dexie IndexedDB

**Date:** 2026-10-29  
**Author:** Principal Full-Stack Engineer  
**Status:** Complete & Verified  

---

### 1. Database Migrations & Schema Architecture (Migration 27)
- **Migration 27 (`Phase 27: Manifest Items and Offline Check-in Hardening`):**
  - Additive alterations to existing tables:
    - `ALTER TABLE offline_manifests ADD COLUMN IF NOT EXISTS manifest_key TEXT;`
    - `ALTER TABLE offline_manifests ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;`
    - `ALTER TABLE offline_checkin_batches ADD COLUMN IF NOT EXISTS manifest_id UUID REFERENCES offline_manifests(id) ON DELETE SET NULL;`
    - `ALTER TABLE offline_checkin_batches ADD COLUMN IF NOT EXISTS client_sent_at TIMESTAMPTZ;`
    - `ALTER TABLE offline_checkin_batches ADD COLUMN IF NOT EXISTS clock_skew_ms INTEGER;`
  - Created normalized manifest items storage:
    - `CREATE TABLE IF NOT EXISTS manifest_items (...)` storing `manifest_id`, `ticket_id`, `token_ref`, `attendee_name`, `ticket_type_name`, `price_paise`, and `created_at`.
  - Added indexes:
    - `CREATE INDEX IF NOT EXISTS idx_manifest_items_manifest_id ON manifest_items(manifest_id);`
    - `CREATE INDEX IF NOT EXISTS idx_manifest_items_token_ref ON manifest_items(manifest_id, token_ref);`
    - `CREATE INDEX IF NOT EXISTS idx_offline_batches_manifest_id ON offline_checkin_batches(manifest_id);`
  - Registered version 27 in `schema_migrations`.
  - Updated Drizzle ORM definitions in `packages/backend/src/db/schema.ts` (`manifestItems`, exported types `ManifestItem`, `NewManifestItem`).
- **Down-Migration Engine (`packages/backend/src/db/migrate-down.ts`):**
  - Added rollback step 27 -> 26: drops indexes, drops table `manifest_items`, drops added columns from `offline_checkin_batches` and `offline_manifests`, and removes migration record 27.
  - Tested and verified live rollback 27 -> 26 and re-application 26 -> 27 against PostgreSQL.

---

### 2. Manifest Generation Hardening & Zero-Knowledge Verification
- **Per-Manifest Random Key `K`:**
  - Manifest generation creates a cryptographically secure 256-bit random key `K` (`crypto.randomBytes(32).toString('hex')`) per manifest instance.
  - Stored on server manifest row as `manifest_key` and sent to authorized scanner device in manifest payload.
- **Strict Ticket Eligibility Filter:**
  - Manifest generation strictly filters out invalid tickets:
    - `AND t.status NOT IN ('CANCELLED', 'REVOKED', 'CHECKED_IN')`
    - `AND b.status NOT IN ('CANCELLED', 'PAYMENT_FAILED', 'EXPIRED')`
  - Cancelled, refunded, revoked, and already checked-in attendees are never included in offline manifests.
- **Mandatory `OFFLINE_MANIFEST_SECRET`:**
  - `getOfflineManifestSecret()` enforces `process.env.OFFLINE_MANIFEST_SECRET` is defined and non-empty; throws runtime exception otherwise with zero default fallback.
- **Bulk Manifest Persistence (Zero N+1):**
  - Manifest rows are batch inserted into `manifest_items` in a single multi-row `INSERT` statement (`db.insert(manifestItems).values(...)`).

---

### 3. Client Storage with Dexie IndexedDB & WebCrypto AES-GCM
- **IndexedDB (`dexie`) Schema (`OfflineCheckinDatabase`):**
  - Stores manifests: `manifests: 'id, eventId, expiresAt, downloadedAt'`.
  - Stores offline scan queue: `queue: 'id, eventId, manifestId, status, scannedAt'`.
  - Stored manifests retain encrypted key `encryptedKey`, IV, salt, and ticket token reference maps.
- **Key Encryption at Rest:**
  - Device-derived PBKDF2 key encrypts random key `K` using WebCrypto AES-GCM (256-bit).
  - Key `K` is decrypted on-the-fly in scanner memory for verification, never stored in plain text.
- **WebCrypto HMAC Client-Side Membership Verification:**
  - Evaluates attendee ticket QR: computes `HMAC_K(SHA256(rawToken))` truncated to 16 hex characters.
  - Matches against stored `manifest_items.token_ref` without exposing ticket secrets.
- **Manifest Lifetime & Expiration Protection:**
  - `purgeExpiredManifests()` auto-purges expired manifests from IndexedDB.
  - Scanner blocks offline scans when manifest is expired (`EXPIRED_MANIFEST_BLOCKED`), prompting staff to reconnect.
- **Device Identity:**
  - Scanner device ID is generated using standard `crypto.randomUUID()`.
- **Prototype Deletion:**
  - Completely deleted mock objects (`prototypeManifest`, `man-prototype-01`) and hardcoded `'mock-event-id'` test branches.

---

### 4. Authoritative Sync Reconciliation & Conflict Handling
- **Server Receipt & Clock-Skew Estimation:**
  - Server records authoritative `received_at = new Date()`.
  - Measures client clock skew: `clock_skew_ms = received_at.getTime() - new Date(clientSentAt).getTime()`.
- **Manifest Authenticity & Revocation Checks:**
  - Verifies manifest exists, belongs to caller `staffId` and `deviceId`, and is not expired or revoked (`MANIFEST_EXPIRED`, `MANIFEST_REVOKED`, `MANIFEST_UNAUTHORIZED`).
- **Batch Collision Rejection:**
  - Reused `batchId` is rejected with HTTP 409 `BATCH_ID_COLLISION`.
- **Cross-Device Duplicate Scan Detection:**
  - If a ticket was already checked in (online or by another device batch), the second scan records a conflict in `scan_conflicts`.
  - Preserves both operations (winning op and conflicting op) with `staff_id`, `device_id`, and `offline_scanned_at` for auditability.
- **Delta & Revocation Endpoints:**
  - `GET /api/v1/events/:id/check-in/delta`: returns tickets updated or revoked since timestamp.
  - `POST /api/v1/events/:id/check-in/manifest/:manifestId/revoke`: revokes compromised manifests.
- **Conflict Resolution UI:**
  - Integrated into `ScannerPage.tsx` with conflict list inspection and resolution actions.

---

### 5. Verification & Test Suite
- `tests/unit/phase-p25-offline-checkin.test.ts`: 11 comprehensive unit & integration tests covering:
  1. Per-manifest random key `K` generation.
  2. Exclusion of cancelled, revoked, and checked-in tickets from manifest.
  3. Strict enforcement of `OFFLINE_MANIFEST_SECRET` requirement without defaults.
  4. Zero N+1 bulk insertion into `manifest_items`.
  5. IndexedDB manifest encryption at rest and WebCrypto HMAC ticket verification.
  6. Automatic purging and blocking of expired manifests.
  7. Prototype manifest and mock code elimination.
  8. Batch collision rejection (409 `BATCH_ID_COLLISION`).
  9. Authoritative server receipt time and clock-skew estimation.
  10. Cross-device duplicate detection with `scan_conflicts` recording.
  11. Migration 27 rollback to 26 and re-migration to 27.
- `tests/e2e/offline-checkin-redesign.spec.ts`: E2E test verifying 50 scans offline sync, concurrent device conflict resolution, revoked ticket rejection, and expired manifest enforcement.
- Monorepo Quality Gate:
  - 51 test files, 536/536 tests passing (100%).
  - `pnpm typecheck`: 0 errors.
  - `pnpm lint`: 0 errors.
  - `pnpm build`: Successful build across all packages.

---

## Phase P22 — Organizer Analytics Backend, Sales Velocity, Real-Time Turnout & Demographics

**Date:** 2026-10-28  
**Author:** Principal Full-Stack Engineer  
**Status:** Complete & Verified  

---

### 1. Database Migrations & Schema Architecture (Migration 25)
- **Migration 25 (`Phase 25: Organizer Analytics Performance Indexes`):**
  - Added additive high-performance composite indexes:
    - `CREATE INDEX IF NOT EXISTS idx_bookings_event_created_at ON bookings(event_id, created_at);`
    - `CREATE INDEX IF NOT EXISTS idx_bookings_event_status ON bookings(event_id, status);`
    - `CREATE INDEX IF NOT EXISTS idx_tickets_event_status_scanned ON tickets(event_id, status, checked_in_at);`
    - `CREATE INDEX IF NOT EXISTS idx_waitlist_event_status ON waitlist_entries(event_id, status);`
  - Registered version 25 in `schema_migrations`.
  - Updated Drizzle ORM definitions in `packages/backend/src/db/schema.ts`.
- **Down-Migration Engine (`packages/backend/src/db/migrate-down.ts`):**
  - Added rollback step 25 -> 24: safely drops `idx_bookings_event_created_at`, `idx_bookings_event_status`, `idx_tickets_event_status_scanned`, and `idx_waitlist_event_status`, and removes migration record 25.
  - Tested and verified live rollback 25 -> 24 and re-application 24 -> 25 against PostgreSQL.

---

### 2. Comprehensive Organizer Analytics Engine
- **Revenue Computation from `organizer_ledger_entries`:**
  - Gross, refunds, and net computed server-side directly from stored ledger rows (`entry_type = 'SALE'` vs `entry_type = 'REFUND'`).
  - Strict ledger invariant: reconciles exactly with `SUM(amount_paise)` in paise integers.
  - Refund rate expressed as both count percentage (`refundsCount / salesCount * 100`) and paise percentage (`refundsPaise / grossPaise * 100`).
- **Sales Velocity in `Asia/Kolkata` Time Zone:**
  - Grouped and truncated at PostgreSQL engine level:
    - Hourly: `to_char(date_trunc('hour', created_at AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD"T"HH24:00:00')`.
    - Daily: `to_char(date_trunc('day', created_at AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD')`.
  - Excludes cancelled bookings from velocity metrics.
- **Registrations vs. Capacity:**
  - Captures total capacity, total registered attendees, confirmed bookings, pending holds, cancellations, capacity utilization percentage, and remaining seats.
- **Ticket Tier Breakdown:**
  - Computes sold tickets, active holds (`PENDING_PAYMENT` with unexpired hold window), capacity, remaining seats, gross revenue paise, and percentage of total revenue / sold volume per ticket tier.
- **Waitlist Length Tracking:**
  - Categorizes waitlist entries into `waiting` (`WAITING`), `claimed` (`CLAIMED`), and `dropped` (`EXPIRED`, `DECLINED`, `LEFT`).
- **Demographics with Strict Cohort Suppression (< 5 Responses):**
  - Aggregates custom registration form answers from `registration_answers` joined with `event_form_fields`.
  - Strict differential privacy protection: buckets with `< 5` responses are NEVER exposed individually. All answer values with `< 5` responses are safely merged into a single suppressed bucket (`value: 'Other (< 5)', countDisplay: '< 5', suppressed: true`), eliminating attendee de-anonymization risks.
- **100% Backward Compatibility:**
  - Retains all existing KPI, funnel, ratings distribution, and timeseries properties consumed by `OrganizerDashboardPage.tsx`.

---

### 3. Real-Time Turnout & 5s ETag Polling
- **Turnout Endpoint (`GET /api/v1/organizer/events/:id/turnout`):**
  - Secured with `{ auth: true, policy: 'analytics:view:owned' }`.
  - Returns `totalTickets`, `checkedInTickets`, `turnoutPct`, `lastScannedAt`, `recentCheckins15m`, and anonymized recent check-in events (`attendeeNumber`, `tierName`, `scannedAt`).
- **5s ETag Polling (304 Not Modified):**
  - Computes deterministic weak ETag: `W/"turnout-${eventId}-${totalTickets}-${checkedInTickets}-${timestampMs}"`.
  - Inspects `If-None-Match` request header: returns `304 Not Modified` with zero body when unchanged, minimizing client-server network payload.
  - Sends updated 200 JSON with new ETag whenever a new ticket is checked in. Sets `Cache-Control: private, no-cache`.

---

### 4. Performance & EXPLAIN (ANALYZE, BUFFERS)
- Updated `scripts/explain-analyze-indexes.ts` with 5 new queries covering organizer analytics:
  - P22 Event Ledger Revenue Query (Index/Nested loop)
  - P22 Sales Velocity Hourly in Asia/Kolkata (Index scan on event_id, created_at)
  - P22 Real-time Check-In Turnout Query (`Index Only Scan using idx_tickets_event_status_scanned`)
  - P22 Demographics Answer Aggregation Query (Bitmap Heap Scan on event_form_fields)
  - P22 Waitlist Status Breakdown Query (`Index Only Scan using idx_waitlist_event_status`)
- All 11 benchmark queries execute in sub-millisecond execution times (< 1 ms in warmed cache).

---

### 5. Verification & Test Suite
- `tests/unit/phase-p22-organizer-analytics.test.ts`: 10 comprehensive tests covering:
  1. Server-side gross, refund, and net revenue computation and exact ledger reconciliation.
  2. Hourly and daily sales velocity aggregation in `Asia/Kolkata` time zone.
  3. Registrations vs capacity, capacity utilization %, and remaining seats.
  4. Per-tier breakdown with sold, held, capacity, remaining, gross paise, and volume percentages.
  5. Waitlist metrics across waiting, claimed, and dropped statuses.
  6. Demographics answer aggregation with strict suppression of cohorts with < 5 responses.
  7. Real-time turnout with 5s ETag polling (200 on initial, 304 on matching ETag, 200 on check-in change).
  8. Authorization policy `analytics:view:owned` (blocks unauthorized students with 403, allows owners and admins).
  9. EXPLAIN (ANALYZE, BUFFERS) validation on all 11 performance queries.
  10. Migration 25 rollback to 24 and re-migration to 25.
- Monorepo Quality Gate:
  - Full suite: 49 test files passed, 513 tests passed, 0 failures.
  - Typecheck: 0 errors across `@eventora/shared`, `@eventora/backend`, `@eventora/frontend`.
  - Lint: 0 errors across the repository.
  - Build: `@eventora/shared`, `@eventora/backend`, and `@eventora/frontend` production builds all succeed.

---

## Phase P21 — Feedback, Notifications, Alerts & Durable Exports Hardening

**Date:** 2026-10-27  
**Author:** Principal Full-Stack Engineer  
**Status:** Complete & Verified  

---

### 1. Database Migrations & Schema Architecture (Migration 24)
- **Migration 24 (`Phase 24: Durable Export Storage & Download Tokens`):**
  - Added additive columns and index to `export_jobs`:
    - `ALTER TABLE export_jobs ADD COLUMN IF NOT EXISTS file_data BYTEA;`
    - `ALTER TABLE export_jobs ADD COLUMN IF NOT EXISTS download_token TEXT;`
    - `CREATE INDEX IF NOT EXISTS idx_export_jobs_download_token ON export_jobs(download_token);`
  - Registered version 24 in `schema_migrations`.
  - Updated Drizzle ORM definition in `packages/backend/src/db/schema.ts`.
- **Down-Migration Engine (`packages/backend/src/db/migrate-down.ts`):**
  - Added rollback step 24 -> 23: drops `idx_export_jobs_download_token`, `download_token`, and `file_data`, and removes migration record 24.
  - Tested and verified live rollback 24 -> 23 and re-application 23 -> 24 against PostgreSQL.

---

### 2. Feedback Invitations & Attendee Eligibility
- **Deduplication with `DISTINCT ON (event_id)`:**
  - Updated `GET /api/v1/me/feedback-invitations` query to use `DISTINCT ON (t.event_id)` sorted by `event_date DESC`.
  - Prevents attendees holding multiple checked-in tickets for the same event from receiving duplicate invitations.
- **Checked-In Eligibility & 48-Hour Edit Window:**
  - Enforced that only checked-in attendees (`status = 'CHECKED_IN'` or verified in `checkins` table) can submit feedback; non-checked-in users receive 403 `INELIGIBLE_NOT_ATTENDED`.
  - Reviews can be edited within 48 hours of initial submission (`edited_at` set); editing after 48 hours is strictly rejected with 409 `FEEDBACK_LOCKED`.

---

### 3. Alerts Security, Rate Limiting & Global Error Handling
- **Published vs. Unpublished Event Access Control:**
  - `GET /events/:id/alerts` on `published` events is open to public/unauthenticated callers.
  - On unpublished events (`draft`, `under_review`, etc.), unauthenticated requests receive 401 `UNAUTHORIZED`.
  - Unrelated authenticated users receive 403 `FORBIDDEN`.
  - Only event ticket holders, event organizers, and global administrators may view unpublished event alerts.
- **Per-Event Alert Rate Limiting:**
  - Enforced a hard limit of maximum 5 alerts per 10 minutes per event in `createEventAlert` via index-backed count on `event_alerts(event_id, created_at DESC)`.
  - Excessive alert creations are rejected with 429 `RATE_LIMIT_EXCEEDED`.
- **Global Error Handling & Zero Internal Leaks:**
  - Refactored alert routes to use Fastify's global error handler and typed `NotificationError`.
  - Eliminated local try/catch blocks that previously leaked `err.message` on 500 internal errors.
- **Provider Failure Simulation Guard:**
  - Guarded `simulateProviderFailure` in `packages/backend/src/services/outbox-worker.ts` with `process.env.NODE_ENV === 'test'`, ensuring failure simulation cannot be triggered outside of unit/integration tests.

---

### 4. Durable Exports, ExcelJS, UTF-8 BOM & Security Hardening
- **Real `.xlsx` Generation via ExcelJS:**
  - Added `exceljs` library.
  - Generates authentic OpenXML spreadsheets with correct MIME type `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.
- **UTF-8 BOM on CSV Exports:**
  - Prepend standard UTF-8 Byte Order Mark (`\uFEFF`, bytes `0xEF, 0xBB, 0xBF`) to all CSV export files to ensure immediate, clean rendering in Microsoft Excel and spreadsheet tools.
- **Formula Injection Neutralization (CWE-1236):**
  - All cells starting with formula trigger characters (`=`, `+`, `-`, `@`, `\t`, `\r`) are automatically neutralized with a leading single quote (`'`) across both CSV and XLSX generators.
- **Durable Database Storage:**
  - Export payloads are saved as binary `file_data BYTEA` with unique `download_token` in `export_jobs` table, surviving process restarts and serverless cold starts.
- **Authenticated Owner Download & 15-Minute Expiry:**
  - Secured `GET /api/v1/exports/download/:token` with `{ auth: true, policy: 'authenticated' }`.
  - Enforced requester owner verification: only the creating user or global admin can download the export file; other users receive 403 `FORBIDDEN`.
  - Links expire after 15 minutes (`404 EXPORT_EXPIRED`).
- **Never Echo Token in Errors:**
  - Neither `EXPORT_NOT_FOUND` nor `EXPORT_EXPIRED` nor `FORBIDDEN` echoes the download token in `details` or `message`.
- **Audit Logging:**
  - Structured immutable entries written to `audit_logs` for both `export:generate` and `export:download`.
- **NaN-Safe Bounded Pagination:**
  - Bounded `limit` parameters to 1–100 with NaN-safe Zod validation across `/events/:id/alerts`, `/me/notifications`, and `/organizer/events/:id/feedback`.

---

### 5. Verification & Test Suite
- `tests/unit/phase-p21-feedback-notifications-exports.test.ts`: 13 quality gate tests covering:
  1. `DISTINCT ON (event_id)` deduplication in feedback invitations.
  2. Checked-in eligibility check (`403 INELIGIBLE_NOT_ATTENDED`).
  3. 48-hour feedback edit window (`409 FEEDBACK_LOCKED`).
  4. Alerts visibility authorization (public on published; restricted to ticket holders/organizers on draft).
  5. NaN-safe 1–100 bounds on `limit` query parameters across alerts, notifications, and feedback.
  6. Per-event alert rate limit (`429 RATE_LIMIT_EXCEEDED` on >5 alerts in 10 mins).
  7. Global error handler usage without leaking internal 500 error messages.
  8. Formula injection neutralization (`= + - @ \t \r`).
  9. UTF-8 BOM on CSV exports (`\uFEFF`).
  10. Real `.xlsx` OpenXML generation via ExcelJS with verified MIME type.
  11. Durable export store, authenticated owner download, and audit logging.
  12. 15-minute export expiry and zero token echo in error responses.
  13. Migration 24 rollback (24 -> 23) and re-application (23 -> 24).
- Full suite verification across all unit and security tests.

---

## Phase P20 — Passport, Cross-College, Certificates & Eligibility Hardening

**Date:** 2026-10-27  
**Author:** Principal Full-Stack Engineer  
**Status:** Complete & Verified  

---

### 1. Database Migrations & Schema Architecture (Migration 23)
- **Migration 23 (`Phase 23: Add Department and Year to Users`):**
  - Added additive columns to `users` table:
    - `ALTER TABLE users ADD COLUMN IF NOT EXISTS department VARCHAR(100);`
    - `ALTER TABLE users ADD COLUMN IF NOT EXISTS year INTEGER;`
  - Added query performance composite index:
    - `CREATE INDEX IF NOT EXISTS idx_users_college_dept ON users(college_id, department) WHERE department IS NOT NULL;`
  - Registered version 23 in `schema_migrations`.
  - Updated Drizzle ORM definition in `packages/backend/src/db/schema.ts`.
- **Down-Migration Engine (`packages/backend/src/db/migrate-down.ts`):**
  - Added rollback step 23 -> 22: drops `idx_users_college_dept`, drops columns `department` and `year` from `users`, and removes migration record 23.
  - Tested and verified live rollback 23 -> 22 and re-application 22 -> 23 against PostgreSQL.

---

### 2. Passport & Certificate Security Hardening
- **Zero PII Exposure on Public Endpoints:**
  - Hardened `/p/:slug` and `/api/v1/p/:slug` to strictly expose public achievements and display names only when `is_public` is true. Personal emails, phone numbers, and private data are completely excluded.
  - Hardened `/verify/:code` and `/api/v1/verify/:code` to return attendee initials (`A. S.`) instead of full personal names or emails.
- **Server-Side Privacy Enforcement:**
  - Enforced server-side checks for `is_public`, `show_attendance`, `show_volunteer`, and `show_certificates` toggles, preventing hidden categories from leaking through API responses.
- **Brute Force & Rate Limit Protection:**
  - Enforced per-IP (30 req/min) and global (300 req/min) rate limiting on `/verify/:code` and `/p/:slug` lookups.
- **Constant-Time Verification Code Comparison:**
  - Implemented `crypto.timingSafeEqual` in `verifyCertificateByCode` to prevent timing attack side-channels on certificate verification codes.
- **Slug Generation Collision Retry:**
  - Added 5-attempt retry loop with random hex entropy in `getOrCreatePassportSettings` to gracefully handle slug collisions.
- **Wildcard Injection Prevention & Pagination:**
  - Implemented `escapeIlikeWildcards` to sanitize `%`, `_`, and `\` in search filters for cross-college discovery (`filter.q`, `filter.category`).
  - Added hard pagination limits (`LIMIT 50` on cross-college events, `LIMIT 100` on colleges and achievements).

---

### 3. Route Hygiene & Cleanup
- **Route Prefix Duplication Fix:**
  - Removed duplicate registration of `crossCollegePassportRoutes` with empty prefix `''` in `packages/backend/src/app.ts`, eliminating 12 redundant route registrations at the root level.
  - Mounted explicit root endpoints for `GET /p/:slug` and `GET /verify/:code` with explicit `{ auth: false, policy: 'public', objectCheck: false }`.
- **Obsolete Endpoint Removal:**
  - Deleted obsolete public stub `POST /student_achievements`.

---

### 4. Real Department & Year Eligibility Engine
- **Direct Database Column Access:**
  - Eliminated untyped `(user as any).department` casting in `packages/backend/src/routes/api/v1/bookings.ts`.
  - Eligibility engine now directly evaluates typed `user.department` and `user.year` against ticket type restrictions (`allowed_departments`, `allowed_years`).
- **Profile Attributes API & UI:**
  - Updated `GET /api/v1/me` and `PATCH /api/v1/me` to expose and validate `department` and `year`.
  - Updated frontend `AuthContext` and `ProfilePreferencesPage.tsx` with department and academic year input fields.

---

### 5. Idempotent Certificate Issuance & Deep Linking
- **Idempotent Issuance Target:**
  - Updated `issueCertificateIfEligibleInternal` conflict resolution to `ON CONFLICT (user_id, event_id) DO UPDATE SET issued_at = certificates.issued_at`, guaranteeing immutable verification codes and hashes across replays.
- **Frontend Deep Linking:**
  - Updated `PublicVerifyPage.tsx` to accept verification codes from both URL path parameters (`/verify/:code`) and query string parameters (`/verify?code=...`).
  - Updated `PassportPage.tsx` to deep-link directly to `/verify/:code`.

---

### 6. Verification & Test Suite
- `tests/unit/phase-p20-passport-certificates.test.ts`: 11 quality gate tests verifying:
  1. Zero PII leak on public passport and verify endpoints.
  2. Server-side privacy toggles for attendance, volunteer, and certificate records.
  3. Per-IP and global brute-force rate limits on `/verify/:code`.
  4. Constant-time code comparison via `timingSafeEqual`.
  5. Slug collision retries with entropy.
  6. Wildcard escaping on `ILIKE` searches.
  7. Result size capping (`LIMIT 50` / `LIMIT 100`).
  8. Real department and academic year eligibility checks.
  9. Idempotent certificate issuance preserving existing verification codes and hashes.
  10. Complete removal of `/student_achievements` and root route duplication.
  11. Migration 23 rollback to 22 and re-application to 23.
- Full suite verification across all unit and security tests.

---

## Phase P19 — Volunteers, Venues, Calendar & RFC 5545 Hardening

**Date:** 2026-10-27  
**Author:** Principal Full-Stack Engineer  
**Status:** Complete & Verified  

---

### 1. Database Migrations & Schema Architecture (Migration 22)
- **Migration 22 (`Phase 22: Volunteer Unique Records & Performance Indexes`):**
  - Added unique constraint index to prevent duplicate volunteer record logging and guarantee idempotent passport credits:
    - `CREATE UNIQUE INDEX IF NOT EXISTS uq_volunteer_records_user_shift ON volunteer_records (user_id, shift_id);`
  - Added query performance indexes:
    - `CREATE INDEX IF NOT EXISTS idx_volunteer_shifts_role_time ON volunteer_shifts (role_id, starts_at, ends_at);`
    - `CREATE INDEX IF NOT EXISTS idx_volunteer_applications_user_status ON volunteer_applications (user_id, status);`
  - Registered version 22 in `schema_migrations`.
- **Down-Migration Engine (`packages/backend/src/db/migrate-down.ts`):**
  - Added rollback step 22 -> 21: drops `uq_volunteer_records_user_shift`, `idx_volunteer_shifts_role_time`, and `idx_volunteer_applications_user_status`, and cleans up migration record 22.
  - Tested and verified live rollback 22 -> 21 and re-application 21 -> 22 against PostgreSQL.

---

### 2. Volunteer Route & Shift Concurrency Hardening
- **Explicit Role -> Event Joins & Policy Checks:**
  - Audited all volunteer endpoints (`/events/:id/volunteer-roles`, `/volunteer-roles/:id/shifts`, `/shifts/:id/applications`, `/applications/:id/*`).
  - Implemented explicit joins traversing `application -> shift -> role -> event` with `policy: 'event:manage:owned'` and `resolveEventId`.
  - Added typed error hierarchy via `VolunteerError` with standardized JSON error envelopes.
- **Pessimistic Locking & Shift Capacity Guard:**
  - `assignVolunteerApplication` locks `volunteer_shifts` rows with `FOR UPDATE` inside a PostgreSQL transaction.
  - Rejects over-assignment with `409 CAPACITY_EXCEEDED` once assigned count reaches capacity.
  - Verified under 50 concurrent requests into a 5-seat shift: exactly 5 succeed, 45 fail.
- **Overlapping Shift Concurrency Guard:**
  - Pre-assignment and pre-application queries verify candidate does not hold concurrent `ASSIGNED` or `CHECKED_IN` shifts with overlapping time intervals (`starts_at < shift.ends_at AND ends_at > shift.starts_at`).
  - Throws `409 OVERLAPPING_SHIFT_ASSIGNMENT`.
  - Verified with parallel concurrent assignments for the same candidate.
- **Strictly Idempotent Shift Completion:**
  - `completeVolunteerShift` utilizes `ON CONFLICT (user_id, shift_id) DO UPDATE SET verified_at = NOW()` and short-circuits completed applications returning `{ alreadyCompleted: true }`.
  - Guaranteed single verified passport hours credit per completed shift.

---

### 3. Venue GiST Double-Booking Concurrency & Availability
- **PostgreSQL GiST Exclusion Constraints (`venue_bookings`):**
  - Hardened `bookVenueWindow` to catch SQLSTATE `23P01` (`exclusion_violation`) from `uq_venue_booking_overlap` and throw typed `VenueConflictError`.
  - Parallel concurrent bookings for the same venue with overlapping `tstzrange` windows result in exactly 1 success and immediate exclusion error for conflicting calls.
- **Public Availability Route (`GET /api/v1/venues/:id/availability`):**
  - Provides date-window conflict inspection queries returning `{ available: boolean, conflict?: { eventId, during } }`.

---

### 4. Calendar Engine & RFC 5545 Strict Compliance
- **Line Folding at 75 Octets:**
  - Implemented `foldIcsLine` enforcing the RFC 5545 75-octet limit with CRLF + single space continuation.
- **Text Escaping & UTC Time Format:**
  - Escaped special characters (`;`, `,`, `\`, `\n`) per RFC 5545 §3.3.11.
  - Formatted dates in UTC `YYYYMMDDTHHMMSSZ` format.
- **Parser Validation:**
  - Validated calendar export strings with `ical.js` (`ICAL.parse`) ensuring syntax conformance and round-trip preservation.
- **Public GETs Draft & PII Isolation:**
  - Hardened `/api/v1/calendar` to filter strictly `events.status = 'published'` and `events.visibility = 'public'`. Excluded all organizer and personal PII.
  - Hardened `GET /api/v1/events/:id/ics` and `GET /api/v1/events/:id/volunteer-roles` to return `404 EVENT_NOT_FOUND` on draft events for unauthenticated/unauthorized callers.

---

### 5. Verification & Test Suite
- `tests/unit/phase-p19-volunteers-venues-calendar.test.ts`: 7 acceptance tests covering shift capacity concurrency (50 parallel), overlapping shift concurrency, idempotent completion, venue GiST double-booking concurrency, RFC 5545 ical.js parser verification, public GET draft/PII isolation, and migration 22 rollback.
- Full suite test results: 46 test files, 479 tests passed (0 failures).

---

## Phase P18 — Teams Hardening, Paid Checkout, PII Removal, Invitations & Atomic Leadership

**Date:** 2026-10-27  
**Author:** Principal Full-Stack Engineer  
**Status:** Complete & Verified  

---

### 1. Database Migrations & Schema Architecture (Migration 21)
- **Migration 21 (`Phase 21: Team Invitation Token Index & Event Registration Indexes`):**
  - Added indexes:
    - `CREATE INDEX IF NOT EXISTS idx_team_invitations_token_hash ON team_invitations(token_hash);`
    - `CREATE INDEX IF NOT EXISTS idx_team_event_registrations_event_status ON team_event_registrations(event_id, status);`
  - Registered version 21 in `schema_migrations`.
- **Down-Migration Engine (`packages/backend/src/db/migrate-down.ts`):**
  - Added rollback step 21 -> 20: drops `idx_team_invitations_token_hash` and `idx_team_event_registrations_event_status`, and deletes migration record 21.
  - Tested and verified live rollback 21 -> 20 and re-application 20 -> 21 against PostgreSQL.

---

### 2. Team Seat Model & Paid Checkout Integration (`packages/backend/src/services/team.ts`, `packages/backend/src/services/payment.ts`)
- **Documented Seat Model Invariant:**
  - Team ticket tiers represent whole-team slots: 1 team slot/seat unit reserved in the ticket tier (`capacity - (sold + held) >= 1`).
  - Leader pays the team entry fee in integer paise.
  - All active team members in `memberSnapshot` gain event participation privileges.
- **Paid Registration Flow (`registerTeamForEvent`):**
  - Enforces `team_mode !== 'none'`, `team_min`, and `team_max` within the database transaction.
  - Enforces per-member duplicate booking check: verifies no member has an active solo booking (`CONFIRMED` or `PENDING_PAYMENT`), and no member is part of another registered team for that event (`status IN ('registered', 'pending_payment')`).
  - Paid tier (`price_paise > 0`):
    - Atomically increments tier `held` by 1.
    - Creates booking in `PENDING_PAYMENT` with 15-minute expiration window.
    - Creates team event registration in `pending_payment` status.
    - No tickets issued before payment.
  - Payment confirmation hook (`executePaymentConfirmationTransaction`):
    - Updates `team_event_registrations.status = 'registered'` upon payment confirmation.
    - Decrements `held` and increments `sold` by 1.
    - Issues ticket for the team booking.

---

### 3. PII Protection & Member Email Elimination
- **Strict Member Privacy (`getTeam` & `GET /api/v1/teams/:id`):**
  - Under no circumstances does `GET /teams/:id` or `memberSnapshot` expose member emails, passwords, or credentials.
  - Discoverable teams expose only `display_name`, `role`, `user_id`, and `joined_at`.
  - Private teams (`visibility === 'private'`) return `404 TEAM_NOT_FOUND` (not 403) to anonymous or non-member authenticated users.
- **Frontend Roster (`packages/frontend/src/pages/teams/TeamsPage.tsx`):**
  - Updated `TeamMember` interface to make `email` optional.
  - Replaced email display with user role in roster UI.

---

### 4. Cryptographic Invitation Security & Misuse Mitigation
- **Named-Invitee Only (`inviteMember`):**
  - Requires `inviteeId` or `email` upon invitation creation (`400 NAMED_INVITEE_REQUIRED`).
  - Generates cryptographically secure base64url token and stores SHA-256 hash in database.
- **Token Verification & Named Invitee Match (`acceptInvitation`):**
  - Requires plaintext token parameter (`400 MISSING_INVITATION_TOKEN`).
  - Computes SHA-256 hash and verifies matching `token_hash` (`400 INVITATION_INVALID`).
  - Rejects expired invitations with `400 INVITATION_EXPIRED`.
  - Rejects acceptance by users other than the named invitee with `403 NAMED_INVITEE_MISMATCH`.
  - Enforces rate limiting: max 20 invitations created per hour (`429 RATE_LIMIT_EXCEEDED`) and max 10 acceptance attempts per minute.

---

### 5. Atomic Leadership Transfers & Last-Leader Leave
- **Atomic Transfer (`transferLeadership`):**
  - Locks team and member rows (`FOR UPDATE`).
  - Demotes current leader to `'member'` and promotes target to `'leader'` atomically.
- **Leave Team (`leaveTeam`):**
  - Locks team and member rows (`FOR UPDATE`).
  - Updates leaving member's status to `'REMOVED'` and role to `'member'`.
  - If leader leaves with an explicit successor: successor is promoted to `'leader'`.
  - If leader leaves without explicit successor: auto-promotes the oldest co-leader or member so the team is never leaderless.
  - If the last member leaves: atomically archives the team (`teams.status = 'archived'`).
  - Concurrency verified: concurrent transfers and leaves serialize without deadlocks.

---

### 6. Verification & Quality Gates
- **Comprehensive Test Suite (`tests/unit/phase-p18-teams.test.ts`):** 20 tests covering PII removal, private team 404s, invitation misuse matrix, paid team pending-payment flow, seat model capacity gates, duplicate booking rejection, and atomic leadership concurrency.
- **Master Test Run:** 45 test files passed (472 passed tests).
- **Typecheck & Lint:** 0 TypeScript errors across monorepo packages, 0 ESLint errors.
- **Production Build:** `pnpm build` succeeded for backend, shared, and frontend.

---

## Phase P17 — Waitlist & Offer Claim Lifecycle Hardening

**Date:** 2026-10-27  
**Author:** Principal Full-Stack Engineer  
**Status:** Complete & Verified  

---

### 1. Database Migrations & Schema Architecture (Migration 20)
- **Migration 20 (`Phase 20: Waitlist Decline, Booking Link & Paid Claim Workflow`):**
  - Updated `waitlist_status` enum: added `'DECLINED'` value.
  - Added column to `waitlist_entries`:
    - `booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL`
  - Added partial index:
    - `CREATE INDEX IF NOT EXISTS idx_waitlist_entries_booking_id ON waitlist_entries(booking_id) WHERE booking_id IS NOT NULL;`
  - Registered version 20 in `schema_migrations`.
- **Down-Migration Engine (`packages/backend/src/db/migrate-down.ts`):**
  - Added rollback step 20 -> 19: drops index `idx_waitlist_entries_booking_id`, drops column `booking_id` from `waitlist_entries`, and removes version 20 record.
  - Tested and verified live rollback 20 -> 19 and re-application 19 -> 20 against PostgreSQL.
- **Drizzle Schema Alignment (`packages/backend/src/db/schema.ts`):**
  - Updated `waitlistStatusEnum` to include `'DECLINED'`.
  - Updated `waitlistEntries` table definition to include `bookingId`.

---

### 2. Waitlist Core Service Architecture (`packages/backend/src/services/waitlist.ts`)
- **Capacity & Sold-Out Enforcement (`joinWaitlist`):**
  - Strict capacity check: joining waitlist is allowed **only** when ticket tier is sold out (`capacity - (sold + held) <= 0`). If capacity is available, rejects with `400 TIER_NOT_SOLD_OUT`.
  - Registration window check: rejects with `400 REGISTRATION_CLOSED` if registration window has closed (`registration_closes_at < now`).
  - Active booking check: rejects with `409 ALREADY_REGISTERED` if user already holds an active booking (`CONFIRMED` or `PENDING_PAYMENT`) on the event.
  - Unique violation recovery: catches Postgres `23505` error on `uq_waitlist_active_user` concurrently and returns `{ entry, position, alreadyQueued: true }`.
- **Promotion Safety (`promoteNext`):**
  - Event status check: explicitly joins `events` and checks `status === 'published'`. Unpublished / draft events are skipped (`return null`), preventing offers for unlaunched events.
- **Paid vs Free Claim Workflows (`claimOffer`):**
  - Claim token enforcement: strictly validates `claimToken` (rejects missing/empty with `400 MISSING_CLAIM_TOKEN`).
  - Event & registration verification: enforces event is published and within registration window (`registration_opens_at`, `registration_closes_at`).
  - Duplicate booking prevention: rejects with `409 ALREADY_REGISTERED` if an active booking is already present for user.
  - Paid tier flow (`price_paise > 0`):
    - Seat remains in `held` capacity (does not alter `held` or `sold`).
    - Creates booking in `PENDING_PAYMENT` status with a fresh 15-minute `expires_at` window for checkout.
    - Does **not** issue a ticket (`ticket` is undefined; tickets only issued post-payment verification).
    - Links `waitlist_entries.booking_id = booking.id`.
    - Returns `{ booking, checkoutRequired: true, requiresPayment: true }`.
  - Free tier flow (`price_paise === 0`):
    - Atomically converts `held -> sold` (`held = GREATEST(0, held - 1)`, `sold = sold + 1`).
    - Creates booking in `CONFIRMED` status.
    - Issues digital ticket immediately with collision-safe `createTicketWithRetry`.
    - Links `waitlist_entries.booking_id = booking.id`.
    - Returns `{ booking, ticket }`.
  - Idempotency replay: repeating claim with identical `Idempotency-Key` returns original booking (and ticket if free) with `idempotentReplay: true`.
  - High concurrency safety: parallel claims on the same offer atomically resolve with exactly 1 winner and loser receives `409 OFFER_INVALID_OR_EXPIRED`.
- **Offer Decline Workflow (`declineOffer`):**
  - Atomically transitions entry from `OFFERED` to `DECLINED`.
  - Releases held capacity: `UPDATE ticket_types SET held = GREATEST(0, held - 1)`.
  - Triggers `promoteNext` to immediately offer seat to the next attendee in line if the event is published.

---

### 3. API Routes (`packages/backend/src/routes/api/v1/bookings.ts`)
- Added `POST /api/v1/waitlist/:entryId/decline`:
  - Route policy: `{ auth: true, policy: 'authenticated', objectCheck: false }`.
  - Allows attendee to decline an offered seat and triggers promotion for next attendee.
- Enhanced `GET /api/v1/events/:id/waitlist/me`:
  - Returns `serverTime: new Date().toISOString()` to eliminate client clock skew.
  - Returns tier `price_paise` for dynamic paid vs free claim actions.
- Enhanced `POST /api/v1/waitlist/:entryId/claim`:
  - Enforces `Idempotency-Key` header and non-empty `claimToken` in request body.

---

### 4. Frontend Waitlist Offer Experience (`packages/frontend/src/components/booking/WaitlistOfferBanner.tsx`)
- **Server Clock Synchronization:**
  - Calculates initial clock offset `(serverTimeMs - clientTimeMs)` from `serverTime`.
  - Evaluates remaining time against synced clock, eliminating client clock drift and premature/delayed expirations.
- **Decline Offer Action:**
  - Added Decline button with popover confirmation ("Release seat?", "Yes, Decline", "Cancel").
  - Invokes `POST /api/v1/waitlist/:entryId/decline` and notifies parent via `onOfferDeclined`.
- **Paid vs Free Dynamic Claiming:**
  - Displays formatted ticket tier price (`₹X` or `Free`).
  - Action button adapts dynamically: `Claim Free Ticket` vs `Claim & Pay ₹X`.
  - Handles pending payment redirect guidance if checkout is required.

---

### 5. Verification & Quality Gates
- **Unit & Integration Suite (`tests/unit/phase-p17-waitlist.test.ts`):**
  - 12 dedicated tests covering sold-out gate, already registered rejection, 23505 race conditions, token requirements, paid vs free claim semantics, decline release & promotion, idempotency replay, and migration 20 expand/contract rollback.
- **Full Monorepo Suite:**
  - All 44 test files (452 / 452 vitest tests) passed with 0 failures.
  - `pnpm typecheck` passed with 0 errors across `@eventora/shared`, `@eventora/backend`, `@eventora/frontend`.
  - `pnpm lint` passed with 0 errors.
  - `pnpm build` passed with 0 errors across all workspace packages.

---

## Phase P16 — Real Email with Resend & Outbox Redesign

**Date:** 2026-10-27  
**Author:** Principal Full-Stack Engineer  
**Status:** Complete & Verified  

---

### 1. Database Migrations & Schema Architecture (Migration 19)
- **Migration 19 (`Phase 19: Resend Email Adapter, Suppression List & Outbox Hardening`):**
  - Added columns to `outbox` table:
    - `locked_until TIMESTAMPTZ` (for short claim lease and stale worker recovery)
    - `error TEXT` (capturing failure diagnostics and provider outage responses)
  - Created index `idx_outbox_locked_until ON outbox(locked_until) WHERE locked_until IS NOT NULL`.
  - Created table `email_suppressions` for permanent bounce and complaint tracking:
    - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
    - `email VARCHAR(255) NOT NULL UNIQUE`
    - `reason VARCHAR(50) NOT NULL` (`hard_bounce`, `complaint`, `manual`)
    - `source VARCHAR(50) NOT NULL DEFAULT 'resend'`
    - `details JSONB NOT NULL DEFAULT '{}'::jsonb`
    - `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
  - Created index `idx_email_suppressions_email ON email_suppressions(email)`.
  - Registered version 19 in `schema_migrations`.
- **Down-Migration Engine (`packages/backend/src/db/migrate-down.ts`):**
  - Added rollback step 19 -> 18: drops `email_suppressions` table, drops index `idx_outbox_locked_until`, drops columns `locked_until` and `error` from `outbox`, and removes version 19 record.
  - Tested and verified live rollback 19 -> 18 and re-application 18 -> 19 against local PostgreSQL database.
- **Drizzle Schema Alignment (`packages/backend/src/db/schema.ts`):**
  - Updated `outbox` table definition with `lockedUntil` and `error`.
  - Defined `emailSuppressions` table with relational mapping and exported types (`EmailSuppression`, `NewEmailSuppression`).

---

### 2. Email Adapter Architecture & Suppression Service
- **Interface & Implementations (`packages/backend/src/services/email/`):**
  - Defined standard `EmailAdapter` interface (`send(options)`, `sendBatch(optionsList)`).
  - Implemented `ResendEmailAdapter` using official `resend` SDK:
    - Automatically slices batch payloads into chunks $\le 100$ per Resend batch API limit.
    - Attaches stable idempotency headers (`X-Entity-Ref-ID`) based on outbox or notification ID.
  - Implemented `ConsoleEmailAdapter` for local development.
  - Implemented `TestEmailAdapter` for automated test suites with inspection methods (`getSentEmails()`, `getLastEmail()`, `findEmailTo()`, `setFailNext()`).
  - Added `getEmailAdapter()` singleton factory honoring `config.EMAIL_ADAPTER` (`'resend'`, `'console'`, `'test'`).
- **Suppression Management (`packages/backend/src/services/email/suppression.ts`):**
  - `isEmailSuppressed(email: string)`: checks if an address has experienced a hard bounce or spam complaint.
  - `filterSuppressedEmails(emails: string[])`: splits recipient list into allowed and suppressed batches.
  - `recordSuppression(...)`: idempotent upsert into `email_suppressions`.
  - All email adapters automatically enforce suppression before making external network calls.

---

### 3. Unified Email Templates & Localization
- **Common Engine (`packages/backend/src/services/email/templates/common.ts`):**
  - `formatIST(date)`: formats all timestamps to Indian Standard Time (`Asia/Kolkata` / `+05:30`).
  - `formatRupees(paise)`: converts integer paise to standard localized ₹ rupee string (`₹450`, `₹1,250.50`).
  - `emailLayout(...)`: responsive HTML wrapper + plain text fallback + unsubscribe link for non-transactional messages.
- **Event Templates (`packages/backend/src/services/email/templates/index.ts`):**
  - Full templates implemented for all 12 events:
    1. `auth.verify_email`
    2. `auth.resend_verification`
    3. `auth.reset_password`
    4. `booking.confirmed`
    5. `payment.receipt`
    6. `payment.verification_queue`
    7. `booking.cancelled`
    8. `waitlist.offer` / `waitlist.offer_dispatched`
    9. `team.invite` / `team.invitation`
    10. `event.changed` / `event.postponed` / `event.cancelled`
    11. `organizer.alert`
    12. `feedback.reminder`

---

### 4. Outbox Worker Redesign & Concurrency Hardening
- **Short Claim Transaction & External Execution:**
  - `dispatchPendingOutboxMessages` uses short transaction with `SELECT ... FOR UPDATE SKIP LOCKED` and immediately marks claimed batch `status = 'PROCESSING', locked_until = NOW() + INTERVAL '2 minutes'`, then commits.
  - Message processing and email provider calls are performed strictly **OUTSIDE** any database transaction.
  - Upon completion, rows are updated to `status = 'DONE', processed_at = NOW(), locked_until = NULL`.
- **Bounded Exponential Backoff & Dead-Lettering:**
  - Failures increment `attempts`. For attempts $< 8$, schedules retry at `NOW() + min(2^n s, 15 min) + jitter`.
  - When `attempts >= 8` or on malformed JSON payload, marks `status = 'DEAD'` and records `error`.
- **Re-entrancy Guard & Stale Lock Reaper:**
  - In-memory `isDispatching` guard prevents overlapping execution loops within a worker process.
  - Reaper query automatically reclaims stale `PROCESSING` rows where `locked_until < NOW()`.
- **Explicit Handlers & Throwing Default:**
  - Removed silent `DONE` fallthroughs. Every event type has an explicit processor; unknown types throw errors and are retried/dead-lettered.

---

### 5. Auth Token Security Invariant
- **Single Delivery Path:**
  - Raw tokens are strictly omitted from `outbox.payload` (never stored in outbox).
  - Tokens are generated on delivery by the outbox handler; only SHA-256 hashes are stored in `password_resets`.
  - Raw tokens exist exclusively in the link delivered to the user's verified inbox (`/verify-email?token=...`, `/reset-password?token=...`).
  - Strict auth responses guarantee tokens never appear in API responses.

---

### 6. Resend Webhooks & Dead-Letter Management
- **Resend Webhook (`POST /webhooks/resend` and `/api/v1/webhooks/resend`):**
  - Cryptographically verifies Svix signatures (`svix-id`, `svix-timestamp`, `svix-signature`) using raw request body buffer and `RESEND_WEBHOOK_SECRET`.
  - Processes `email.delivered` (updates `notification_deliveries` to `DELIVERED`).
  - Processes `email.bounced` (records hard bounces in `email_suppressions`, updates delivery to `FAILED`).
  - Processes `email.complained` (records spam complaints in `email_suppressions`, updates delivery to `FAILED`).
- **Admin Dead-Letter API (`packages/backend/src/routes/api/v1/admin.ts`):**
  - `GET /api/v1/admin/outbox/dead-letter`: lists dead-letter outbox records with diagnostic error messages.
  - `POST /api/v1/admin/outbox/:id/retry`: resets dead message to `PENDING` with `attempts = 0` and writes an immutable entry into `audit_logs`.

---

### 7. Standalone Worker Process & Operations Runbook
- **Standalone Process:**
  - Created `packages/backend/src/worker.ts` running outbox dispatcher, hold reconciler, and event completer with SIGTERM/SIGINT graceful shutdown.
  - Updated `Dockerfile.worker` to execute `node packages/backend/dist/worker.js`.
  - Guarded `packages/backend/src/index.ts` so API server skips in-process workers in production unless `RUN_IN_PROCESS_WORKER=true`.
- **Operations Runbook (`docs/runbook.md`):**
  - Documented Resend sending domain verification, DKIM/SPF/DMARC DNS configuration, rate limits ($\le 100$ batch chunking), and idempotency keys.
  - Documented PostgreSQL `LISTEN/NOTIFY` direct session connection requirement vs transaction poolers (Supabase 6543 vs 5432) with fallback polling.

---

### 8. Quality Gate & Acceptance Verification
- **Test Suite (`tests/unit/phase-p16-resend-outbox.test.ts`):**
  - 16 new automated unit and integration tests passing.
  - Verified provider outage backoff and cap at `DEAD` after 8 attempts.
  - Verified concurrent workers with `SKIP LOCKED` never double-send.
  - Verified stale lock reaper reclaims expired `PROCESSING` messages.
  - Verified hard bounce & spam complaint suppression prevents subsequent dispatches.
  - Verified Svix webhook signature verification (accepts valid, rejects forged/missing with 401).
  - Verified end-to-end registration -> email -> verify -> login flow and forgot password -> email -> reset -> session revocation flow.
  - Verified admin dead-letter view and retry API.
  - Verified schema migration 19 expand/contract rollback and re-application.
- **Master Monorepo Verification:**
  - `pnpm typecheck`: 0 errors across `@eventora/shared`, `@eventora/backend`, `@eventora/frontend`.
  - `pnpm lint`: 0 errors.
  - `pnpm test`: 43 test files passed, 440/440 tests passed.

---

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


---

## [Phase P12] - 2026-10-27: Payments Core: YouPI-PG Integration & Security Hardening

### 1. Database Schema & Migration 17
- **Additive Migration 17 (`packages/backend/src/db/migrate.ts`):**
  - Updated enum `payment_status` to support `QUEUED` and `VERIFICATION_QUEUE`.
  - Updated enum `refund_status` to support `REFUND_PENDING_MANUAL`.
  - Added columns to `payments`: `utr` (VARCHAR 12, unique constraint), `slot_active` (BOOLEAN), `queue_position` (INTEGER), `checkout_url` (TEXT), `verification_queue_reason` (TEXT), `manual_reviewed_by` (UUID fk users), `manual_reviewed_at` (TIMESTAMPTZ), `raw_webhook_payload` (JSONB).
  - Created tables:
    - `payment_events`: Immutable audit trail for payment state changes (`payment_id`, `from_status`, `to_status`, `event_type`, `payload`, `actor_user_id`, `actor_role`).
    - `webhook_deliveries`: Deduplication log for inbound gateway webhook delivery IDs (`delivery_id`, `provider`, `event_type`, `processed_at`, `payload`).
    - `reconciliation_records`: Master records for bank statement imports and YouPI reconciliations (`source`, `imported_by`, `total_rows`, `matched_count`, `unmatched_count`, `discrepancy_count`).
    - `reconciliation_items`: Granular matching line items (`record_id`, `payment_id`, `utr`, `amount_paise`, `status`, `discrepancy_reason`).
  - Added columns to `refunds`: `refund_utr` (VARCHAR 12), `manual_processed_at` (TIMESTAMPTZ), `manual_notes` (TEXT).
- **Rollback Migration (`packages/backend/src/db/migrate-down.ts`):**
  - Reversible down-migration 17 $\to$ 16 dropping added tables and columns with clean schema rollback tested and verified.
- **ORM & TypeScript Schema (`packages/backend/src/db/schema.ts`):**
  - Synchronized Drizzle schema definitions, relations, and TypeScript interfaces for all new tables and columns.

### 2. Payment Adapter Layer & Architecture
- **Adapter Interface (`packages/backend/src/services/payment-adapter.ts`):**
  - `PaymentAdapter` contract: `createOrder(params)`, `getStatus(orderId)`, `verifyWebhook(payload, signature, headers, rawBody)`, `createRefund(params)`.
  - `YouPiPaymentAdapter`: Fully integrates with external YouPI-PG gateway endpoints (`POST /api/v1/payments`, `GET /api/v1/payments/:id`), signs and verifies HMAC-SHA256 V2/V1 webhooks.
  - `SimulatorPaymentAdapter`: Maintained for non-production environments with strict production lockdown.
- **Startup Guard (`packages/backend/src/services/startup-guard.ts`):**
  - Updated to validate `PAYMENT_PROVIDER` (`youpi` | `simulator` | `sandbox`) and ensure all monetary calculations strictly compute in integer paise from stored rows.

### 3. Fake YouPI Gateway Server for Automated Testing
- **Implementation (`tests/fakes/youpi-server.ts`):**
  - High-fidelity mock server simulating YouPI Payment API (:6100), Checkout UI (:7000), single-slot FIFO queue processing, simulated manual/instant settlements, and HMAC-SHA256 signed webhooks (`X-Gateway-Signature-V2` with `${timestamp}.${rawBody}` and V1 fallback).

### 4. Webhook Security & Order Lifecycle
- **Endpoints:** Root `POST /webhooks/payments/youpi` and versioned `POST /api/v1/webhooks/payments/youpi`.
- **Raw Buffer Handling:** Utilizes Fastify `addContentTypeParser` ensuring `req.rawBody` Buffer integrity without lossy re-serialization.
- **HMAC Verification:** Constant-time `crypto.timingSafeEqual` comparison against `YOUPI_WEBHOOK_SECRET` over `${timestamp}.${rawBody}` (V2) with V1 fallback.
- **Replay Protection:** Enforces 2-hour freshness window based on `X-Gateway-Timestamp`.
- **Deduplication:** Idempotent delivery tracking via `webhook_deliveries` using `X-Gateway-Delivery-Id`.
- **Settlement Verification:** Validates `SUCCESS` status, order ID, exact integer paise amount match, unique 12-digit UTR, and double-checks gateway status API before confirming booking. State mismatches safely divert to `VERIFICATION_QUEUE`.
- **Error Handling:** Gateway processing errors return 5xx to prompt YouPI's built-in retry backoff.

### 5. Single-Slot Queue, Hold Extension & Throughput Limits
- When a buyer's payment slot activates in YouPI, seat hold timer is automatically extended by 5 minutes (capped at 30 minutes from booking creation).
- Configurable `YOUPI_DAILY_LIMIT` (default 20 transactions/day) enforced on adapter level.
- Throughput status endpoint `GET /api/v1/payments/throughput` reports capacity and queue advisories.

### 6. Offline Manual Refunds & Anti-Self-Dealing
- Modeled as `REFUND_PENDING_MANUAL` because YouPI direct peer-to-peer UPI does not support automated wallet/API refunds.
- Organizers perform bank transfer and record 12-digit UTR via `POST /api/v1/organizer/refunds/:id/record-manual`.
- Checked-in ticket protection: Revocation and refunds blocked if any ticket in the booking has already been used for check-in.
- Anti-self-dealing guard: Organizers cannot approve, reject, or decide refunds requested by their own user account.

### 7. Bank Statement CSV Reconciliation
- **Service (`packages/backend/src/services/reconciliation.ts`):**
  - Dynamic CSV parser (`parseBankStatementCsv`) supporting variable column headers (`Date`, `UTR`, `Amount`, `Description`).
  - Auto-matching against database payments by UTR and exact paise amount. Flags unmatched rows and amount discrepancies.
  - Daily reconciliation runner `runDailyYouPiReconciliation` querying YouPI status.
  - Endpoints: `POST /api/v1/admin/reconciliation/import-csv` and `GET /api/v1/admin/reconciliation/reports`.

### 8. Deployment Documentation
- `docs/youpi-deploy.md`: Architectural documentation for deploying YouPI-PG alongside Eventora, Node $\ge 22.13$, Litestream SQLite backups, port isolation (6100 private, 7000 public, 6001 admin), UPI observer handset sync, and failover procedures.

### 9. Verification & Quality Gate
- **Test Suite (`tests/unit/phase-p12-payments-youpi.test.ts`):** 19 dedicated integration tests passing 100%.
- **IDOR Matrix (`tests/security/idor-matrix.test.ts`):** Anti-self-dealing refund check verified passing (12/12 tests).
- **Monorepo Test Suite (`pnpm test`):** 388/388 tests passing across 39 files.
- **Typecheck & Lint:** 0 TypeScript errors, 0 ESLint errors across shared, backend, and frontend.

---

## Phase P13 — Checkout UI with YouPI Checkout & Verification Queue

**Date:** 2026-10-27  
**Author:** Principal Full-Stack Engineer  
**Status:** Complete & Verified  

---

### 1. Checkout Page Overhaul (`packages/frontend/src/pages/CheckoutPage.tsx`)
- **API Client Hygiene:** All network calls route exclusively through `lib/api-client.ts`. Zero token storage in `localStorage`.
- **Prototype Logic Removal:** Deleted all prototype mock branches (`bookingId.startsWith('proto-')`, `bkg_demo_`, mock receipt generation).
- **DEV Simulator Lockdown:** Simulator test controls strictly isolated behind `import.meta.env.DEV && booking.isSimulated`. Completely omitted from production builds.
- **State Machine:**
  - `LOADING`: Initial state fetching booking and checkout session with screen-reader announcement.
  - `READY`: Active order summary, countdown timer (`Hold expires in: mm:ss`), UPI launch button, and mobile bottom sheet.
  - `QUEUED`: FIFO queue position badge (`#X in line`), hold timer paused notice, standing by for slot activation.
  - `CONFIRMING`: "Confirming Payment with Bank..." state with progress indicator awaiting authoritative webhook.
  - `VERIFICATION_QUEUE`: Friendly notice that payment is undergoing manual review ("Payment Verification in Progress").
  - `SUCCESS`: Renders digital tax invoice (`ReceiptView`) with ticket links and print action.
  - `FAILED`: Clear decline explanation with retry payment trigger.
  - `EXPIRED`: Informs user that seat hold lapsed and seats were freed, providing return to discovery.
  - `CANCELLED`: Notice of cancelled order.
- **Browser Invariant Enforced:** Browser handler callback is **NEVER** proof of payment. Payment transitions to `CONFIRMING` while polling `GET /payments/:id/status` (exponential backoff 2s $\to$ 10s, stops at terminal state).
- **Accessibility & Mobile-First:** Added `aria-live` polite region for screen readers, focus management via heading ref on state changes, and responsive mobile bottom-sheet action bar.

---

### 2. Dynamic YouPI Script Loader (`packages/frontend/src/lib/youpi-loader.ts`)
- Dynamically loads `youpi.js` only upon entering checkout from the configured YouPI checkout origin (`VITE_YOUPI_CHECKOUT_URL`).
- Auto-cleans up `<script>` tag upon component unmount.
- Fallback modal / redirection mechanism if the external script fails to load or window modal is blocked.

---

### 3. Digital Receipt & Tax Invoice (`packages/frontend/src/components/checkout/ReceiptView.tsx`)
- Tax invoice with compliant GST layout and placeholders (`GSTIN: 29AAAAA0000A1Z5`, SAC `9996`, 0% CGST/SGST).
- Server-side integer paise displayed formatted in ₹ and paise.
- Built-in `@media print` CSS rules hiding interactive chrome and navigation buttons for high-resolution printable PDF invoices.
- "View QR Tickets in Passport" button directly navigating attendee to their valid QR passes.

---

### 4. Organizer & Admin Verification Queue (`packages/frontend/src/components/admin/VerificationQueueView.tsx`)
- Filterable organizer & admin dashboard view listing payments in `VERIFICATION_QUEUE`.
- Displays amount in ₹/paise, UTR, flag reason, and inspect modal for raw webhook payload.
- **Approve Resolution:** Runs identical atomic transaction as webhook path: transitions payment to `SUCCESS`, transfers held inventory to sold, sets booking to `CONFIRMED`, generates tickets, and creates ledger entries.
- **Reject Resolution:** Transitions payment to `FAILED`, releases held seats back to ticket capacity, and cancels booking.
- Seamlessly mounted in `OrganizerDashboardPage.tsx` and `AdminPortalPage.tsx`.

---

### 5. Backend Route Authorization & Policy Fixes (`packages/backend/src/routes/api/v1/payments.ts`)
- **Status Route (`GET /payments/:id/status` & `GET /api/v1/payments/:id/status`):**
  - Enforced ownership via `checkPaymentStatusOwnership` (allows booking owner, admin, or organizer member of the event; denies other users with 403 `FORBIDDEN`).
  - Corrected ticket query to fetch valid tickets (`id, ticket_code, status, created_at`) without querying deprecated or non-existent columns.
- **Verification Queue Routes:**
  - `GET /api/v1/organizer/payments/verification-queue`: declared explicit `{ auth: true, policy: 'authenticated', objectCheck }`, filtering payments to those belonging to caller's active organizer memberships.
  - `POST /api/v1/organizer/payments/:id/resolve-verification`: declared explicit `{ auth: true, policy: 'authenticated', objectCheck }`, asserting organizer membership before processing resolution.
  - `POST /api/v1/organizer/refunds/:id/record-manual`: aligned policy and objectCheck for offline manual refund recordings.

---

### 6. Content Security Policy (CSP) Updates
- Updated `vercel.json`, `packages/frontend/vercel.json`, and backend `security-headers.ts` to allow YouPI origins in `script-src`, `frame-src`, and `connect-src` (`http://localhost:7000`, `http://127.0.0.1:7000`, `https://pay.eventora.org`).

---

### 7. Verification & Quality Gate
- **Dedicated Test Suite (`tests/unit/phase-p13-checkout-ui.test.ts`):** 10/10 automated tests passing (100%):
  1. Route ownership & IDOR isolation on `/payments/:id/status` (owner 200, stranger 403, organizer 200).
  2. Invariant: Browser callback alone never marks payment `SUCCESS` or confirms booking without webhook.
  3. Happy path: Webhook arrival -> authoritative fulfillment -> polling status returns `SUCCESS` with digital receipt & tickets.
  4. Flagged mismatch routes to `VERIFICATION_QUEUE`, organizer manual approval executes atomic fulfillment.
  5. Flagged mismatch organizer rejection cancels booking and releases held seats back to capacity pool.
  6. FIFO queue slot activation extends hold timer by 5 minutes.
  7. Expired hold reconciler frees seats and rejects checkout with `HOLD_EXPIRED`.
  8. Webhook idempotency: Duplicate webhook deliveries return 200 without double-crediting.
- **Monorepo Test Suite (`pnpm test`):** 40 test files, 398 tests passing (100%).
- **Static Analysis & Builds:**
  - `pnpm typecheck`: 0 errors across `@eventora/shared`, `@eventora/backend`, `@eventora/frontend`.
  - `pnpm lint`: 0 errors.

---

## [Phase P24] - 2026-10-29
### Student Portal Restoration & Audit Fixes

### 1. Database Migrations & Schema Architecture (Migration 26)
- **Migration 26 (`Phase 26: Event Materials for Registered Attendees`):**
  - Created `event_materials` table:
    - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
    - `event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE`
    - `title VARCHAR(255) NOT NULL`
    - `description TEXT`
    - `file_url TEXT NOT NULL`
    - `file_name VARCHAR(255) NOT NULL`
    - `file_size_bytes INT NOT NULL`
    - `mime_type VARCHAR(100) NOT NULL`
    - `uploaded_by UUID NOT NULL REFERENCES users(id)`
    - `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
    - `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
  - Added composite index: `CREATE INDEX IF NOT EXISTS idx_event_materials_event_id ON event_materials(event_id);`
  - Registered version 26 in `schema_migrations`.
- **Down-Migration Engine (`packages/backend/src/db/migrate-down.ts`):**
  - Added rollback step 26 $\to$ 25 dropping `idx_event_materials_event_id` and `event_materials` table and deleting version 26 from `schema_migrations`.
  - Verified live rollback and re-application against PostgreSQL.
- **Drizzle Schema Alignment (`packages/backend/src/db/schema.ts`):**
  - Defined `eventMaterials` pgTable, exported types `EventMaterial` and `NewEventMaterial`.

---

### 2. Backend Event Materials & Student Endpoints
- **Registered-Only Materials Access (`GET /api/v1/events/:id/materials`):**
  - Protected with `{ auth: true, policy: 'authenticated', objectCheck: false }`.
  - Enforces registered attendee authorization: caller must possess a booking on the event with `status = 'CONFIRMED'` OR be the creator/organizer member/admin.
  - Unregistered students receive `403 FORBIDDEN` with code `REGISTRATION_REQUIRED`.
- **Organizer Upload & Guardrails (`POST /api/v1/events/:id/materials`):**
  - Protected with `{ auth: true, policy: 'event:manage:owned', objectCheck: false }`.
  - Strict upload limit: max 25 MB file size. Files exceeding 25 MB rejected with `400 VALIDATION_ERROR`.
  - Whitelisted MIME types: PDF, Word (`.doc`, `.docx`), PowerPoint (`.ppt`, `.pptx`), ZIP, CSV, TXT, markdown, images (`.png`, `.jpg`, `.webp`). Executables/disallowed types rejected with `400 VALIDATION_ERROR`.
- **Organizer Deletion (`DELETE /api/v1/events/:id/materials/:materialId`):**
  - Protected with `{ auth: true, policy: 'event:manage:owned', objectCheck: false }`.
  - Deletes material from `event_materials` and logs audit log event.
- **Calendar Route Hardening (`GET /api/v1/calendar`):**
  - Accepted `month` (`YYYY-MM`) and `view` query parameters, calculating UTC month bounds automatically for frontend calendar queries.
- **User Teams Filtering (`GET /api/v1/teams?mine=true`):**
  - Supported `mine=true` query parameter for authenticated students to view only their joined teams.
- **Notification Preferences Storage:**
  - Fixed `updateUserNotificationPreferences` and `getUserNotificationPreferences` to store preferences in `user_preferences` table instead of non-existent `users.meta` column.

---

### 3. Frontend Student Portal Restorations & UI Enhancements
- **Audit Documentation (`docs/student-portal-audit.md`):**
  - Audited every route, button, link, and state across `StudentShell`, `MyBookingsPage`, `PassportPage`, `CalendarPage`, `TeamsPage`, `VolunteerHubPage`, `NotificationCenter`, and `ProfilePreferencesPage`.
- **MyBookingsPage (My Events):**
  - **Upcoming vs. Past Tabs:** Segmented registrations into `Upcoming Events` and `Past & Completed` tabs with dynamic count badges.
  - **Status Chips:** Rendered semantic badges for `CONFIRMED`, `PENDING PAYMENT`, `CHECKED IN`, and `CANCELLED`.
  - **Resume-Checkout Flow:** Added prominent "Resume Checkout ({formatINR(totalPaise)})" CTA button for bookings in `PENDING_PAYMENT` status routing to `/checkout/:bookingId`.
  - **Schedule + `.ics` Export:** Added "Add to Calendar (.ics)" button downloading standard RFC 5545 calendar files.
  - **Offline Caching:** Added `localStorage` caching key `eventora_offline_tickets_cache` with offline indicator and full dynamic QR rendering.
  - **Ticket Download:** Added "Download Pass" button.
  - **Refund / Cancellation Policy Modal:** Added clear policy disclosure for paid tickets (refund in paise via YouPI-PG) vs free passes.
  - **Event Materials Modal:** Added attendee materials viewer with file size formatting, MIME badges, and direct downloads.
- **NotificationCenter Route Path Alignment:**
  - Fixed endpoint paths from `/api/v1/users/me/notifications*` to `/api/v1/me/notifications*` and `/api/v1/me/notification-preferences`.
- **StudentShell:**
  - Added on-mount unread notifications fetch.
  - Added desktop sidebar navigation item for `Volunteers Hub`.
- **TeamsPage:**
  - Wired "Request to Join" button to `POST /api/v1/teams/:id/join-requests`.
  - Concurrently fetched discoverable and user-joined teams.
- **ProfilePreferencesPage / App.tsx:**
  - Wired "Sign Out" to await `logout()` from `useAuth()` before redirecting.

---

### 4. Verification & Quality Gate
- **Unit & Security Integration Suite (`tests/unit/phase-p24-student-portal.test.ts`):** 12/12 passing tests:
  1. Migration 26 down-migration to 25 and re-migration to 26.
  2. Organizer material upload within 25MB and MIME limits.
  3. Rejection of oversized files (>25MB) with 400.
  4. Rejection of unsupported MIME types with 400.
  5. Confirmed attendee access to event materials.
  6. Unregistered attendee rejection with 403 `REGISTRATION_REQUIRED`.
  7. Organizer and Admin materials access.
  8. Calendar query with `month` parameter and RFC 5545 `.ics` export.
  9. `GET /api/v1/me/bookings` with confirmed and pending bookings.
  10. `GET /api/v1/teams?mine=true` user teams filtering.
  11. `GET /api/v1/me/notifications` and `PATCH /api/v1/me/notification-preferences`.
  12. Organizer material deletion.
- **Playwright E2E Suite (`tests/e2e/student-portal-journey.spec.ts`):** End-to-end student journey covering Shell navigation, upcoming/past bookings, materials modal, resume payment CTA, calendar, teams, volunteer hub, notifications, and profile logout.
- **Monorepo Quality Gate:** All 50 test files and 525 tests passing (100%), `pnpm typecheck` 0 errors, `pnpm lint` 0 errors.


---

## Phase P14 — Ticket QR, Token Rotation, Downloads & Offline Mode

**Date:** 2026-10-27  
**Author:** Principal Full-Stack Engineer  
**Status:** Complete & Verified  

---

### 1. Database Migrations & Schema Architecture (Phase 18)
- **Migration 18 (`Phase 18: Ticket QR Tokens & Rotation Timestamp`):**
  - Added additive columns to `tickets` table:
    - `qr_token TEXT` (storing 32-byte URL-safe base64 token)
    - `qr_token_rotated_at TIMESTAMPTZ` (tracking rotation and invalidation timestamps)
  - Created partial index `idx_tickets_qr_token` on `tickets(qr_token) WHERE qr_token IS NOT NULL` for $O(1)$ fast gate lookup.
  - Added migration record 18 into `schema_migrations`.
- **Down-Migration Engine (`packages/backend/src/db/migrate-down.ts`):**
  - Implemented rollback step 18 -> 17: drops partial index `idx_tickets_qr_token`, drops columns `qr_token` and `qr_token_rotated_at` from `tickets`, and clears migration 18 record.
  - Verified live database rollback 18 -> 17 and re-application 17 -> 18.
- **Drizzle Schema Alignment (`packages/backend/src/db/schema.ts`):**
  - Synchronized `qrToken` and `qrTokenRotatedAt` in Drizzle `tickets` table definition.

---

### 2. QR Payload & Host Isolation Invariant
- **Config Lockdown (`packages/backend/src/config.ts`):**
  - Added `APP_HOST` (default `campus.eventora.org`) and `QR_HMAC_SECRET`.
  - **Host Header Injection Defense:** QR URL payload strictly constructed via `https://${config.APP_HOST}/t/${rawToken}?h=${sig}`. Ignores incoming request `Host` or `X-Forwarded-Host` headers completely.
  - Compact HMAC-SHA256 signature calculated over canonical URL ensuring tamper resistance.
  - High-entropy human ticket codes: `TCK-YYYY-TIMESTAMPBASE36-12HEXCHARS` (48 bits of entropy) with collision-safe retry loop catching Postgres 23505 unique constraint errors.

---

### 3. Backend QR Services & Route Authorization (`packages/backend/src/services/qr-ticket.ts`, `routes/api/v1/tickets.ts`)
- **Generation & Formats:**
  - `generateTicketQrSvg()`: Builds vector SVG with embedded human ticket code.
  - `generateTicketPdf()`: PDF pass via `pdfkit` containing event title, tier, attendee initials (Zero PII leak: initials `A. S.` only, no email/phone), human code, and QR PNG.
  - `generateTicketPng()`: Direct raster PNG QR buffer via `qrcode`.
- **Token Rotation & Revocation:**
  - `rotateTicketToken()`: Generates fresh token, rotates `qr_token`, `qr_token_hash`, `qr_payload_hash`, `qr_token_rotated_at`, increments version, and logs audit record. **The old QR code is immediately and permanently invalidated upon gate scan.**
  - `revokeTicket()`: Clears `qr_token = NULL`, sets `qr_token_rotated_at = NOW()`. Subsequent QR fetches return 410 `GONE` and scans are rejected.
- **Strict Route Authorization (`checkTicketAccess`):**
  - Declared deny-by-default object check protecting:
    - `GET /tickets/:id/qr.svg`
    - `GET /tickets/:id/download?format=pdf|png`
    - `POST /tickets/:id/regenerate-qr`
    - App root aliases `/tickets/:id/qr.svg` and `/tickets/:id/download`
  - Allows: Attendee owner, booking owner, platform admin, and event check-in staff / organizers.
  - Rejects: Unauthorized strangers with 403 `FORBIDDEN` and unauthenticated callers with 401.

---

### 4. Ticket Issuance Pipeline Modernization
- Updated all ticket issuance sites to use `createTicketWithRetry` and store `qr_token`:
  - `packages/backend/src/services/booking.ts` (instant free event registration).
  - `packages/backend/src/services/payment.ts` (3 sites: webhook settlement, simulator settlement, verification queue approval).
  - `packages/backend/src/services/waitlist.ts` (waitlist promotion).

---

### 5. Frontend Gate Pass & Offline Mode (`packages/frontend/src/components/ui/QRDisplay.tsx`)
- **Offline Gate Entry:**
  - Caches SVG vector QR in `localStorage.setItem('eventora_offline_qr_' + id, svg)`.
  - When network is offline, seamlessly loads cached pass and displays "Offline Ready • Gate Cached" badge for venues with zero cell reception.
- **Max-Brightness Gate Mode:**
  - Full-screen high-contrast modal with Screen Wake Lock API (`navigator.wakeLock.request('screen')`) to prevent mobile display sleep at gate check-in.
- **Ticket Downloads & Self-Service Token Rotation:**
  - One-click downloads for PDF Pass (`?format=pdf`) and PNG QR (`?format=png`).
  - Interactive "Rotate QR" button with confirmation modal calling `/api/v1/tickets/:id/regenerate-qr` to regenerate compromised passes.
  - Human ticket code display with copy-to-clipboard.

---

### 6. Verification & Quality Gate
- **Dedicated Test Suite (`tests/unit/phase-p14-ticket-qr.test.ts`):** 15/15 automated tests passing (100%):
  1. Ticket code format & 48-bit entropy validation.
  2. Host isolation: QR payload strictly uses `config.APP_HOST`, immune to Host header injection.
  3. Route authorization: Owner 200, check-in staff 200, organizer 200, stranger 403 `FORBIDDEN`, anonymous 401.
  4. Token rotation: Rotated token immediately invalidates old QR on gate scan.
  5. Revocation: Cleared token returns 410 `GONE` and fails scan.
  6. Downloads: Generates valid PDF pass (`%PDF-`) and PNG raster (`\x89PNG`).
  7. Migration 18 expand/contract: Rollback (18 -> 17) and re-run (17 -> 18) verified.
- **Monorepo Test Suite (`pnpm test`):** 41 test files, 413 tests passing (100%).
- **Static Analysis & Builds:**
  - `pnpm typecheck`: 0 errors across `@eventora/shared`, `@eventora/backend`, `@eventora/frontend`.
  - `pnpm lint`: 0 errors.

---

## [Phase P24] - 2026-10-29
### Student Portal Restoration & Audit Fixes

### 1. Database Migrations & Schema Architecture (Migration 26)
- **Migration 26 (`Phase 26: Event Materials for Registered Attendees`):**
  - Created `event_materials` table:
    - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
    - `event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE`
    - `title VARCHAR(255) NOT NULL`
    - `description TEXT`
    - `file_url TEXT NOT NULL`
    - `file_name VARCHAR(255) NOT NULL`
    - `file_size_bytes INT NOT NULL`
    - `mime_type VARCHAR(100) NOT NULL`
    - `uploaded_by UUID NOT NULL REFERENCES users(id)`
    - `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
    - `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
  - Added composite index: `CREATE INDEX IF NOT EXISTS idx_event_materials_event_id ON event_materials(event_id);`
  - Registered version 26 in `schema_migrations`.
- **Down-Migration Engine (`packages/backend/src/db/migrate-down.ts`):**
  - Added rollback step 26 $\to$ 25 dropping `idx_event_materials_event_id` and `event_materials` table and deleting version 26 from `schema_migrations`.
  - Verified live rollback and re-application against PostgreSQL.
- **Drizzle Schema Alignment (`packages/backend/src/db/schema.ts`):**
  - Defined `eventMaterials` pgTable, exported types `EventMaterial` and `NewEventMaterial`.

---

### 2. Backend Event Materials & Student Endpoints
- **Registered-Only Materials Access (`GET /api/v1/events/:id/materials`):**
  - Protected with `{ auth: true, policy: 'authenticated', objectCheck: false }`.
  - Enforces registered attendee authorization: caller must possess a booking on the event with `status = 'CONFIRMED'` OR be the creator/organizer member/admin.
  - Unregistered students receive `403 FORBIDDEN` with code `REGISTRATION_REQUIRED`.
- **Organizer Upload & Guardrails (`POST /api/v1/events/:id/materials`):**
  - Protected with `{ auth: true, policy: 'event:manage:owned', objectCheck: false }`.
  - Strict upload limit: max 25 MB file size. Files exceeding 25 MB rejected with `400 VALIDATION_ERROR`.
  - Whitelisted MIME types: PDF, Word (`.doc`, `.docx`), PowerPoint (`.ppt`, `.pptx`), ZIP, CSV, TXT, markdown, images (`.png`, `.jpg`, `.webp`). Executables/disallowed types rejected with `400 VALIDATION_ERROR`.
- **Organizer Deletion (`DELETE /api/v1/events/:id/materials/:materialId`):**
  - Protected with `{ auth: true, policy: 'event:manage:owned', objectCheck: false }`.
  - Deletes material from `event_materials` and logs audit log event.
- **Calendar Route Hardening (`GET /api/v1/calendar`):**
  - Accepted `month` (`YYYY-MM`) and `view` query parameters, calculating UTC month bounds automatically for frontend calendar queries.
- **User Teams Filtering (`GET /api/v1/teams?mine=true`):**
  - Supported `mine=true` query parameter for authenticated students to view only their joined teams.
- **Notification Preferences Storage:**
  - Fixed `updateUserNotificationPreferences` and `getUserNotificationPreferences` to store preferences in `user_preferences` table instead of non-existent `users.meta` column.

---

### 3. Frontend Student Portal Restorations & UI Enhancements
- **Audit Documentation (`docs/student-portal-audit.md`):**
  - Audited every route, button, link, and state across `StudentShell`, `MyBookingsPage`, `PassportPage`, `CalendarPage`, `TeamsPage`, `VolunteerHubPage`, `NotificationCenter`, and `ProfilePreferencesPage`.
- **MyBookingsPage (My Events):**
  - **Upcoming vs. Past Tabs:** Segmented registrations into `Upcoming Events` and `Past & Completed` tabs with dynamic count badges.
  - **Status Chips:** Rendered semantic badges for `CONFIRMED`, `PENDING PAYMENT`, `CHECKED IN`, and `CANCELLED`.
  - **Resume-Checkout Flow:** Added prominent "Resume Checkout ({formatINR(totalPaise)})" CTA button for bookings in `PENDING_PAYMENT` status routing to `/checkout/:bookingId`.
  - **Schedule + `.ics` Export:** Added "Add to Calendar (.ics)" button downloading standard RFC 5545 calendar files.
  - **Offline Caching:** Added `localStorage` caching key `eventora_offline_tickets_cache` with offline indicator and full dynamic QR rendering.
  - **Ticket Download:** Added "Download Pass" button.
  - **Refund / Cancellation Policy Modal:** Added clear policy disclosure for paid tickets (refund in paise via YouPI-PG) vs free passes.
  - **Event Materials Modal:** Added attendee materials viewer with file size formatting, MIME badges, and direct downloads.
- **NotificationCenter Route Path Alignment:**
  - Fixed endpoint paths from `/api/v1/users/me/notifications*` to `/api/v1/me/notifications*` and `/api/v1/me/notification-preferences`.
- **StudentShell:**
  - Added on-mount unread notifications fetch.
  - Added desktop sidebar navigation item for `Volunteers Hub`.
- **TeamsPage:**
  - Wired "Request to Join" button to `POST /api/v1/teams/:id/join-requests`.
  - Concurrently fetched discoverable and user-joined teams.
- **ProfilePreferencesPage / App.tsx:**
  - Wired "Sign Out" to await `logout()` from `useAuth()` before redirecting.

---

### 4. Verification & Quality Gate
- **Unit & Security Integration Suite (`tests/unit/phase-p24-student-portal.test.ts`):** 12/12 passing tests:
  1. Migration 26 down-migration to 25 and re-migration to 26.
  2. Organizer material upload within 25MB and MIME limits.
  3. Rejection of oversized files (>25MB) with 400.
  4. Rejection of unsupported MIME types with 400.
  5. Confirmed attendee access to event materials.
  6. Unregistered attendee rejection with 403 `REGISTRATION_REQUIRED`.
  7. Organizer and Admin materials access.
  8. Calendar query with `month` parameter and RFC 5545 `.ics` export.
  9. `GET /api/v1/me/bookings` with confirmed and pending bookings.
  10. `GET /api/v1/teams?mine=true` user teams filtering.
  11. `GET /api/v1/me/notifications` and `PATCH /api/v1/me/notification-preferences`.
  12. Organizer material deletion.
- **Playwright E2E Suite (`tests/e2e/student-portal-journey.spec.ts`):** End-to-end student journey covering Shell navigation, upcoming/past bookings, materials modal, resume payment CTA, calendar, teams, volunteer hub, notifications, and profile logout.
- **Monorepo Quality Gate:** All 50 test files and 525 tests passing (100%), `pnpm typecheck` 0 errors, `pnpm lint` 0 errors.


---

## Phase P15 — Camera Scanner & Scan Hardening

**Date:** 2026-10-27  
**Author:** Principal Full-Stack Engineer  
**Status:** Complete & Verified  

---

### 1. Camera Scanner Frontend Overhaul (`packages/frontend/src/pages/ScannerPage.tsx`)
- **Lazy-Loaded Optical Scanner:**
  - Integrated `html5-qrcode` loaded strictly on-demand via dynamic `import('html5-qrcode')` to prevent main bundle bloat.
- **Secure Context & Device Permissions:**
  - Added HTTPS and `mediaDevices.getUserMedia` capability checks.
  - Granular permission state machine:
    - `prompt`: Clean initial state prompting user to activate camera.
    - `denied`: Informative guidance explaining how to unblock camera in Chrome/Android, iOS Safari, and Desktop browser settings.
    - `no_camera`: Graceful alert when no hardware video inputs are available, falling back to manual entry.
    - `unsupported`: Security advisory when loaded over insecure HTTP contexts.
    - `active`: Live turnstile viewfinder with targeting reticle overlay.
- **Device Memory & Multi-Camera Switching:**
  - Camera enumeration defaulting to back/environment facing mode (`{ facingMode: { ideal: 'environment' } }`).
  - "Flip Camera" toggle cycling through all available video devices.
  - Selected camera device ID persisted to `localStorage.getItem('eventora_preferred_camera_id')`.
- **Torch (Flashlight) Control:**
  - Dynamic capability detection via `getRunningTrackCapabilities()?.torch`.
  - Toggle button controlling torch constraints when hardware flashlight is available.
- **3-Second Same-Code Debounce:**
  - Maintained `lastScannedCodeRef` to ignore rapid repetitive scans of the identical ticket within 3000ms.
- **Manual Code Entry:**
  - Monospace input for pasting ticket codes (`TCK-...`), raw tokens, or signed URLs with Enter-key submit and auto-clearing.
- **Lifecycle & Resource Cleanup:**
  - Stops all camera tracks on component unmount.
  - Listens to `document.visibilitychange`: immediately stops camera streaming when tab or mobile browser is backgrounded (`visibilityState === 'hidden'`) and resumes upon return (`visibilityState === 'visible'`).

---

### 2. Audio & Visual Feedback Engine (`packages/frontend/src/lib/audio.ts`)
- **Web Audio API Synthesizer:**
  - Zero external mp3 dependencies, zero network latency, 100% offline-compatible sound synthesizer using Web Audio oscillators:
    - **Success:** Ascending 2-tone chime (587 Hz $\to$ 880 Hz / D5 $\to$ A5).
    - **Duplicate / Warning:** 2 short warning beeps (440 Hz).
    - **Error / Rejected:** Descending sawtooth error buzz (220 Hz $\to$ 140 Hz).
  - Audio mute toggle in header persisted to `localStorage.getItem('eventora_scanner_muted')`.
- **Haptic Vibration:**
  - Integrated `navigator.vibrate` with distinct patterns: `[150]` for accepted, `[100, 80, 100]` for warning/duplicate, and `[250, 100, 250]` for invalid/error.
- **Full-Screen Visual Feedback:**
  - Banner/card feedback highlighting Green (`ACCEPTED` / `LOCALLY_VERIFIED`), Amber (`DUPLICATE`), and Red (`INVALID`, `WRONG_EVENT`, `REVOKED`, `OUTSIDE_WINDOW`, `EVENT_NOT_PUBLISHED`).

---

### 3. Backend Scan Hardening (`packages/backend/src/services/qr-ticket.ts`, `routes/api/v1/tickets.ts`)
- **Aborted-Transaction Bug Fix (Savepoint Isolation):**
  - Wrapped student attendance achievement inserts and certificate policy hooks in `SAVEPOINT ... ROLLBACK TO SAVEPOINT`.
  - Wrapped certificate generation and achievement inserts inside `issueCertificateIfEligibleInternal` in savepoints (`cert_insert_sp`, `cert_ach_sp`).
  - Previously, a swallowed exception in achievement or certificate auto-issuance left PostgreSQL in an aborted transaction state, silently rolling back valid `ACCEPTED` check-ins. Savepoints guarantee that non-fatal achievement errors are isolated and the ticket check-in transaction commits `ACCEPTED`.
- **Event Lifecycle & Window Guard:**
  - Check-in rejected with `EVENT_NOT_PUBLISHED` if event is draft, submitted, postponed, or cancelled.
  - Check-in rejected with `OUTSIDE_WINDOW` ("Check-in window is closed: Event has ended.") if current time exceeds `events.ends_at`.
- **Attendance Session Window & Validation:**
  - Unknown or non-existent `sessionId` rejected with `outcome: 'INVALID'`, `message: 'Unknown or invalid session ID for this event'`.
  - Scan outside session check-in window rejected with `outcome: 'OUTSIDE_WINDOW'`, `message: 'Check-in window is currently closed for this session'`.
- **Cross-Event Ticket ID Masking (Security ASVS L2):**
  - Tickets scanned at a gate for a different event return `WRONG_EVENT`.
  - When scanned by regular staff (`globalRole !== 'admin'`), `ticketId` is strictly omitted from the response to prevent foreign ticket discovery.
  - When scanned by an admin (`globalRole === 'admin'`), `ticketId` is included for auditing and forensics.

---

### 4. Verification & Quality Gate
- **Dedicated Test Suite (`tests/unit/phase-p15-scanner-hardening.test.ts`):** 11/11 tests passing (100%):
  1. Concurrency test: 20 parallel scans of one ticket $\to$ exactly 1 `ACCEPTED`, 19 `DUPLICATE`, exactly 1 checkin row in DB.
  2. Regression test: Achievement/certificate error does NOT abort check-in transaction; check-in commits `ACCEPTED`.
  3. Rejection of non-published events (`EVENT_NOT_PUBLISHED`).
  4. Rejection of concluded events outside window (`OUTSIDE_WINDOW`).
  5. Unknown `sessionId` rejected with `INVALID`.
  6. Session outside window rejected with `OUTSIDE_WINDOW`.
  7. Session within window accepted and session ID linked in `checkins`.
  8. Cross-event ticket scan by regular staff omits `ticketId`.
  9. Cross-event ticket scan by admin includes `ticketId`.
  10. Audio synthesizer mute toggle & state persistence.
  11. Audio synthesizer playback safety without errors.
- **Playwright E2E Test (`tests/e2e/phase-p15-camera-scanner.spec.ts`):** Passing with synthetic fake media stream (`--use-fake-ui-for-media-stream`, `--use-fake-device-for-media-stream`), verifying camera mount, mute toggle, manual entry, and visual feedback banners.
- **Monorepo Test Suite (`pnpm test`):** **42 test files, 424 tests passing (100%)**.
- **Static Analysis & Builds:**
  - `pnpm typecheck`: 0 errors across `@eventora/shared`, `@eventora/backend`, `@eventora/frontend`.
  - `pnpm lint`: 0 errors.

---

## [Phase P24] - 2026-10-29
### Student Portal Restoration & Audit Fixes

### 1. Database Migrations & Schema Architecture (Migration 26)
- **Migration 26 (`Phase 26: Event Materials for Registered Attendees`):**
  - Created `event_materials` table:
    - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
    - `event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE`
    - `title VARCHAR(255) NOT NULL`
    - `description TEXT`
    - `file_url TEXT NOT NULL`
    - `file_name VARCHAR(255) NOT NULL`
    - `file_size_bytes INT NOT NULL`
    - `mime_type VARCHAR(100) NOT NULL`
    - `uploaded_by UUID NOT NULL REFERENCES users(id)`
    - `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
    - `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
  - Added composite index: `CREATE INDEX IF NOT EXISTS idx_event_materials_event_id ON event_materials(event_id);`
  - Registered version 26 in `schema_migrations`.
- **Down-Migration Engine (`packages/backend/src/db/migrate-down.ts`):**
  - Added rollback step 26 $\to$ 25 dropping `idx_event_materials_event_id` and `event_materials` table and deleting version 26 from `schema_migrations`.
  - Verified live rollback and re-application against PostgreSQL.
- **Drizzle Schema Alignment (`packages/backend/src/db/schema.ts`):**
  - Defined `eventMaterials` pgTable, exported types `EventMaterial` and `NewEventMaterial`.

---

### 2. Backend Event Materials & Student Endpoints
- **Registered-Only Materials Access (`GET /api/v1/events/:id/materials`):**
  - Protected with `{ auth: true, policy: 'authenticated', objectCheck: false }`.
  - Enforces registered attendee authorization: caller must possess a booking on the event with `status = 'CONFIRMED'` OR be the creator/organizer member/admin.
  - Unregistered students receive `403 FORBIDDEN` with code `REGISTRATION_REQUIRED`.
- **Organizer Upload & Guardrails (`POST /api/v1/events/:id/materials`):**
  - Protected with `{ auth: true, policy: 'event:manage:owned', objectCheck: false }`.
  - Strict upload limit: max 25 MB file size. Files exceeding 25 MB rejected with `400 VALIDATION_ERROR`.
  - Whitelisted MIME types: PDF, Word (`.doc`, `.docx`), PowerPoint (`.ppt`, `.pptx`), ZIP, CSV, TXT, markdown, images (`.png`, `.jpg`, `.webp`). Executables/disallowed types rejected with `400 VALIDATION_ERROR`.
- **Organizer Deletion (`DELETE /api/v1/events/:id/materials/:materialId`):**
  - Protected with `{ auth: true, policy: 'event:manage:owned', objectCheck: false }`.
  - Deletes material from `event_materials` and logs audit log event.
- **Calendar Route Hardening (`GET /api/v1/calendar`):**
  - Accepted `month` (`YYYY-MM`) and `view` query parameters, calculating UTC month bounds automatically for frontend calendar queries.
- **User Teams Filtering (`GET /api/v1/teams?mine=true`):**
  - Supported `mine=true` query parameter for authenticated students to view only their joined teams.
- **Notification Preferences Storage:**
  - Fixed `updateUserNotificationPreferences` and `getUserNotificationPreferences` to store preferences in `user_preferences` table instead of non-existent `users.meta` column.

---

### 3. Frontend Student Portal Restorations & UI Enhancements
- **Audit Documentation (`docs/student-portal-audit.md`):**
  - Audited every route, button, link, and state across `StudentShell`, `MyBookingsPage`, `PassportPage`, `CalendarPage`, `TeamsPage`, `VolunteerHubPage`, `NotificationCenter`, and `ProfilePreferencesPage`.
- **MyBookingsPage (My Events):**
  - **Upcoming vs. Past Tabs:** Segmented registrations into `Upcoming Events` and `Past & Completed` tabs with dynamic count badges.
  - **Status Chips:** Rendered semantic badges for `CONFIRMED`, `PENDING PAYMENT`, `CHECKED IN`, and `CANCELLED`.
  - **Resume-Checkout Flow:** Added prominent "Resume Checkout ({formatINR(totalPaise)})" CTA button for bookings in `PENDING_PAYMENT` status routing to `/checkout/:bookingId`.
  - **Schedule + `.ics` Export:** Added "Add to Calendar (.ics)" button downloading standard RFC 5545 calendar files.
  - **Offline Caching:** Added `localStorage` caching key `eventora_offline_tickets_cache` with offline indicator and full dynamic QR rendering.
  - **Ticket Download:** Added "Download Pass" button.
  - **Refund / Cancellation Policy Modal:** Added clear policy disclosure for paid tickets (refund in paise via YouPI-PG) vs free passes.
  - **Event Materials Modal:** Added attendee materials viewer with file size formatting, MIME badges, and direct downloads.
- **NotificationCenter Route Path Alignment:**
  - Fixed endpoint paths from `/api/v1/users/me/notifications*` to `/api/v1/me/notifications*` and `/api/v1/me/notification-preferences`.
- **StudentShell:**
  - Added on-mount unread notifications fetch.
  - Added desktop sidebar navigation item for `Volunteers Hub`.
- **TeamsPage:**
  - Wired "Request to Join" button to `POST /api/v1/teams/:id/join-requests`.
  - Concurrently fetched discoverable and user-joined teams.
- **ProfilePreferencesPage / App.tsx:**
  - Wired "Sign Out" to await `logout()` from `useAuth()` before redirecting.

---

### 4. Verification & Quality Gate
- **Unit & Security Integration Suite (`tests/unit/phase-p24-student-portal.test.ts`):** 12/12 passing tests:
  1. Migration 26 down-migration to 25 and re-migration to 26.
  2. Organizer material upload within 25MB and MIME limits.
  3. Rejection of oversized files (>25MB) with 400.
  4. Rejection of unsupported MIME types with 400.
  5. Confirmed attendee access to event materials.
  6. Unregistered attendee rejection with 403 `REGISTRATION_REQUIRED`.
  7. Organizer and Admin materials access.
  8. Calendar query with `month` parameter and RFC 5545 `.ics` export.
  9. `GET /api/v1/me/bookings` with confirmed and pending bookings.
  10. `GET /api/v1/teams?mine=true` user teams filtering.
  11. `GET /api/v1/me/notifications` and `PATCH /api/v1/me/notification-preferences`.
  12. Organizer material deletion.
- **Playwright E2E Suite (`tests/e2e/student-portal-journey.spec.ts`):** End-to-end student journey covering Shell navigation, upcoming/past bookings, materials modal, resume payment CTA, calendar, teams, volunteer hub, notifications, and profile logout.
- **Monorepo Quality Gate:** All 50 test files and 525 tests passing (100%), `pnpm typecheck` 0 errors, `pnpm lint` 0 errors.



