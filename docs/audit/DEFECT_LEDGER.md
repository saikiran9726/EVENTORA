# EVENTORA PRODUCTION DEFECT LEDGER
**Phase**: `PHASE 2 — AUTOMATED TEST COVERAGE ENGINE`  
**Generated Date**: October 25, 2026  
**Accountable Team**: Principal Software Architect & Release Reliability Engineering  
**Methodology**: Automated forensic test execution, AST code inspection, PostgreSQL database log analysis, and network trace reproduction.

---

## 1. Executive Defect Summary

| Defect ID | Domain | Severity | Defect Name | Root Cause Discovered in Code | Reproduction Evidence | Current Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`DEF-01`** | `BKG` / `PAS` | **BLOCKER** | Registration-to-Passport Ticket Flow Missing | 1) `EventDetailsPage.tsx` mocked registration with `setTimeout` instead of calling `POST /api/v1/events/:id/bookings`.<br/>2) `MyBookingsPage.tsx` mapped `ticket_id` to undefined camelCase.<br/>3) `PassportPage.tsx` queried only achievements, ignoring active tickets.<br/>4) PostgreSQL 42883 on `MAX(t.id)` in `/me/bookings` SQL query. | `tests/unit/known-defects-forensics.test.ts` (1.1, 1.2)<br/>`tests/e2e/final-journeys.spec.ts` (J1) | **REMEDIATED** in `3ece1d7` & `1086a77` |
| **`DEF-02`** | `ADM` / `EVT` | **HIGH** | Club Charter Verification Fails in Admin Portal | `AdminPortalPage.tsx` (line 280) dispatched `POST /api/v1/organizers/${clubId}/verification`. In backend, the verification endpoint was registered at `POST /api/v1/admin/organizers/:id/verify`. Fastify returned `404 Route Not Found`. | `tests/unit/known-defects-forensics.test.ts` (2.1, 2.2)<br/>`tests/unit/identity-auth-repair.test.ts` (2.1, 2.2, 2.3) | **REMEDIATED** (Frontend URL aligned & backend compatibility alias added) |
| **`DEF-03`** | `EVT` / `VEN` | **HIGH** | Event Proposal Form Rejection on Non-UUID Venues | Fallback venue list in `CreateEventPage.tsx` hardcoded string IDs (`v-auditorium`), violating backend Zod schema (`venueId: z.string().uuid()`), returning 400 Bad Request. | `tests/unit/known-defects-forensics.test.ts` (3.1: 400 Validation Error, 3.2: 201 on UUID) | **REMEDIATED** in `3ece1d7` |
| **`DEF-04`** | `EVT` / `AUTH` | **MEDIUM** | Faculty Review Authorization Error (`Reviewer or admin role required for event:review`) | Frontend `App.tsx` and `ReviewQueuePage.tsx` did not gate review decisions by role. When a student or unauthenticated guest clicked "Approve", Fastify correctly rejected the request with 403 Forbidden (`Reviewer or admin role required for event:review`). | `tests/unit/known-defects-forensics.test.ts` (4.1, 4.2)<br/>`tests/unit/identity-auth-repair.test.ts` (1.1, 1.2, 1.3) | **REMEDIATED** (Client-side role guard, faculty login shortcut & modal protection added) |
| **`DEF-05`** | `EVT` / `NFR` | **HIGH** | Proposal Submission Timeout & Duplicate Creation | 1) Fastify empty body parser crash on `POST /events/:id/submit`.<br/>2) 15s client timeout too low for free-tier database latency.<br/>3) Missing idempotency key handling caused duplicate event draft records on retry. | `tests/unit/known-defects-forensics.test.ts` (5.1: empty body parsed, 5.2: idempotency deduplication verified) | **REMEDIATED** in `4a27696` |
| **`DEF-06`** | `BKG` / `UX` | **LOW** | Guest Mode Empty Booking State in My Tickets | `MyBookingsPage.tsx` received 401 when queried without credentials and set bookings to an empty array instead of displaying a preview demo ticket for guest evaluation. | `tests/e2e/booking-waitlist-teams.spec.ts` | **REMEDIATED** in `3ece1d7` |
| **`DEF-07`** | `BUILD` | **LOW** | Unused Import TypeScript Compiler Errors | Unused Lucide icons and UI components in `AdminPortalPage.tsx` and `App.tsx` failed `tsc --noEmit`. | `pnpm typecheck` exit code 0 | **REMEDIATED** in `1086a77` |
| **`DEF-08`** | `BKG` / `FORM` | **HIGH** | Registration Form Custom Answers Rejection & Unreliable Text Retention | `EventDetailsPage.tsx` passed `'attendee-name'` and `'attendee-roll'` as non-UUID `questionId` in `answers`, violating backend Zod schema (`questionId: z.string().uuid()`) and foreign key to `registration_form_questions`. Fastify rejected bookings with 400 Bad Request (`VALIDATION_ERROR`). Also, fields were unpopulated on mount for logged-in students. | `tests/unit/form-workflow-repair.test.ts` (3.1, 3.2, 3.3) | **REMEDIATED** (Answers schema aligned, `useAuth` user.displayName auto-fill added, local storage profile persistence implemented) |
| **`DEF-09`** | `FDB` / `FORM` | **MEDIUM** | Feedback Sheet Client Token Null Check Short-Circuit | `FeedbackSheet.tsx` checked `localStorage.getItem('eventora_auth_token')`. For standard sessions with HTTP cookies, token was null, causing `FeedbackSheet.tsx` to short-circuit into mock toast simulation and skip real `POST /api/v1/events/:id/feedback` API calls. | `tests/unit/form-workflow-repair.test.ts` (4.1, 4.2) | **REMEDIATED** (UUID event verification enabled with cookie authentication support) |
| **`DEF-10`** | `PAS` / `BKG` | **MEDIUM** | Checked-In Ticket Badge Representation in Passport & My Bookings | Database enum `ticket_status` defines `['VALID', 'CHECKED_IN', 'CANCELLED', 'TRANSFERRED']`. `MyBookingsPage.tsx` and `PassportPage.tsx` previously checked legacy `'USED'`, causing checked-in turnstile attendees to display inactive status. | `tests/unit/booking-passport-integrity.test.ts` (7.1-7.4) | **REMEDIATED** (Mapped `CHECKED_IN` to `ATTENDED` brand badge) |
| **`DEF-11`** | `EVT` / `DB` | **HIGH** | Drizzle Schema Missing Reverse Relations for Event Sub-Resources | `schema.ts` defined `many(eventFaqs)` and `many(eventAnnouncements)` in `eventsRelations`, but lacked child relation definitions (`eventFaqsRelations`, `eventAnnouncementsRelations`). When `GET /api/v1/events/:slug` executed `db.query.events.findFirst({ with: { faqs: true, announcements: true } })`, Drizzle threw runtime error: `There is not enough information to infer relation "events.faqs"`, failing requests with 500 Internal Server Error. | `tests/unit/remaining-feature-repair.test.ts` (4.3) | **REMEDIATED** (Added `eventFaqsRelations`, `eventAnnouncementsRelations`, `eventStatusHistoryRelations`, `eventApprovalsRelations`, `venueBookingsRelations` in `schema.ts`) |

---

## 2. Detailed Forensic Analysis of the Five Known Failures

### 2.1. DEF-01: Registration-to-Passport Ticket Flow Disconnection
- **Symptom**: User registered for an event; registration indicated success, but no ticket pass was visible in Passport or My Bookings.
- **Forensic Investigation**:
  1. *UI Submission Gap*: In `EventDetailsPage.tsx`, `handleRegisterSubmit` originally used a prototype `setTimeout` simulation that never invoked `POST /api/v1/events/:id/bookings`.
  2. *Data Ingestion Crash*: When wired to the backend, `packages/backend/src/routes/api/v1/bookings.ts` line 520 executed:
     ```sql
     SELECT b.id, MAX(t.id) as ticket_id, MAX(t.status) as ticket_status FROM bookings b ...
     ```
     PostgreSQL has no `MAX(uuid)` or `MAX(custom_enum)` aggregation operator without an explicit cast. The query failed with PostgreSQL error code `42883` (`undefined_function`), causing `GET /api/v1/me/bookings` to crash with 500 Internal Server Error.
  3. *Client Mappings*: `MyBookingsPage.tsx` mapped snake_case database fields (`created_at`, `ticket_id`) to undefined camelCase properties (`createdAt`, `ticketId`).
  4. *Passport View Exclusion*: `PassportPage.tsx` exclusively queried `/student_achievements`, with no logic to retrieve or display active QR event admission passes.
- **Verification Evidence**:
  - `tests/unit/known-defects-forensics.test.ts` (Tests 1.1 and 1.2 passed).
  - Explicit cast `MAX(t.id::text) as ticket_id` and `MAX(t.status::text) as ticket_status` applied in commit `1086a77`.
  - "Active Event Passes" tab with turnstile QR rendering integrated into `PassportPage.tsx` in commit `3ece1d7`.
  - Verified across all viewports in Playwright Journey 1.

---

### 2.2. DEF-02: Club Charter Verification Fails in Admin Portal
- **Symptom**: Platform administrators navigating to Admin Portal -> Club Charters could not verify campus clubs; clicking "Verify Charter" failed.
- **Forensic Investigation**:
  1. *Frontend Dispatch Call*: In `packages/frontend/src/pages/admin/AdminPortalPage.tsx` line 280:
     ```ts
     await apiClient.post(`/api/v1/organizers/${clubId}/verification`, {
       status: nextStatus,
       evidenceRef: 'Official Campus Dean Charter Approval 2026',
     });
     ```
  2. *Backend Route Mount*: In `packages/backend/src/routes/api/v1/crosscollege-passport.ts` line 150:
     ```ts
     fastify.post('/admin/organizers/:id/verify', ...);
     ```
     When mounted with prefix `/api/v1`, the real endpoint is:
     `POST /api/v1/admin/organizers/:id/verify`
  3. *Missing Route Conflict*: Route `POST /api/v1/organizers/:id/verification` does not exist in Fastify. Only a public `GET /api/v1/organizers/:id/verification` exists (line 87). Fastify returned HTTP 404 Route Not Found.
- **Verification Evidence**:
  - `tests/unit/known-defects-forensics.test.ts` Test 2.1: `POST /api/v1/organizers/:id/verification` returns 404 `NOT_FOUND`.
  - `tests/unit/known-defects-forensics.test.ts` Test 2.2: `POST /api/v1/admin/organizers/:id/verify` successfully executes with admin credentials and returns 200 with updated verification status.
- **Planned Remediation (Phase 3)**:
  - In `AdminPortalPage.tsx` line 280, change the endpoint URL to `/api/v1/admin/organizers/${clubId}/verify`.

---

### 2.3. DEF-03: Registration Form Venue ID Schema Rejection
- **Symptom**: Submitting an event proposal in `CreateEventPage.tsx` resulted in a silent failure or validation error popup.
- **Forensic Investigation**:
  1. When venues failed to load or when fallback data was used, `CreateEventPage.tsx` populated the venue selector with string identifiers: `v-auditorium`, `v-open-air`, `v-seminar-hall`.
  2. The Fastify backend controller validates payloads against `createEventSchema`:
     ```ts
     venueId: z.string().uuid().optional().nullable(),
     ```
  3. Non-UUID strings failed Zod schema parsing, returning `400 Bad Request` with error code `VALIDATION_ERROR`.
- **Verification Evidence**:
  - `tests/unit/known-defects-forensics.test.ts` Test 3.1: Submitting `venueId: 'v-auditorium'` returns 400 Bad Request (`VALIDATION_ERROR`).
  - `tests/unit/known-defects-forensics.test.ts` Test 3.2: Submitting a genuine seeded UUID (`44d2a71e-f6af-4764-8793-b116f9439a30`) returns 201 Created.
  - Remediated in commit `3ece1d7`.

---

### 2.4. DEF-04: Faculty Review Authorization 403 Forbidden
- **Symptom**: Users navigating to `/review-queue` and approving a proposal encountered error: `Reviewer or admin role required for event:review`.
- **Forensic Investigation**:
  1. *Backend Policy*: Route `POST /api/v1/events/:id/approval` enforces policy `event:review`:
     ```ts
     case 'event:review':
       if (userRole !== 'reviewer' && userRole !== 'admin') {
         return reply.code(403).send({
           error: {
             code: 'FORBIDDEN',
             message: 'Reviewer or admin role required for event:review',
             details: { requiredPolicy: 'event:review', userRole },
             requestId: req.id,
           },
         });
       }
       break;
     ```
  2. *Frontend Route Exposure*: In `packages/frontend/src/App.tsx`, route state `review-queue` rendered `<ReviewQueuePage />` directly without checking whether the active user had `globalRole === 'reviewer'` or `globalRole === 'admin'`.
  3. When an attendee or student logged in as `student1@campus.edu` accessed `/review-queue` and clicked "Approve", the request was rejected with 403 Forbidden.
- **Verification Evidence**:
  - `tests/unit/known-defects-forensics.test.ts` Test 4.1: Student account submitting approval returns HTTP 403 with exact error string `Reviewer or admin role required for event:review`.
  - `tests/unit/known-defects-forensics.test.ts` Test 4.2: Faculty account (`reviewer.faculty@campus.edu`) passes policy guard cleanly.
- **Planned Remediation (Phase 3)**:
  - Add client-side authorization banner / redirection in `App.tsx` and `ReviewQueuePage.tsx` informing non-reviewers to log in with faculty credentials.

---

### 2.5. DEF-05: Proposal Submission Timeout & Duplicate Creation
- **Symptom**: Event proposal submission timed out after 15 seconds, and retrying caused duplicate draft events to be created in the database.
- **Forensic Investigation**:
  1. *Empty Body Crash*: `POST /api/v1/events/:id/submit` was invoked with an empty body `{}`. Fastify's content-type parser did not handle empty bodies safely, leading to uncaught promise rejections or timeout hangs.
  2. *Client Timeout*: `apiClient.ts` originally had a 15-second default timeout, which was exceeded when Render container instances cold-started or performed cold database queries.
  3. *Missing Idempotency*: Multiple clicks on the "Submit Proposal" button generated distinct event drafts with different IDs because the frontend did not persist an `Idempotency-Key` across the draft creation and submission phases.
- **Verification Evidence**:
  - `tests/unit/known-defects-forensics.test.ts` Test 5.1: `POST /api/v1/events/:id/submit` with empty body `{}` is parsed cleanly without crashing or timing out.
  - `tests/unit/known-defects-forensics.test.ts` Test 5.2: Replaying identical proposal payload with the same `Idempotency-Key` returns the existing event draft ID without creating duplicate database rows.
  - Remediated in commit `4a27696`.

---

## 3. Defect Remediation Status Summary

| Priority | Defect ID | Affected Component / File | Applied Remediation | Test Gate | Status |
| :---: | :--- | :--- | :--- | :--- | :---: |
| **P0** | **`DEF-01`** | `packages/backend/src/routes/api/v1/bookings.ts` | Explicit SQL text casts `MAX(t.id::text)` & `MAX(t.status::text)` to resolve PostgreSQL 42883. Active tickets wired to Passport. | `tests/unit/known-defects-forensics.test.ts` (1.1, 1.2) | **REMEDIATED** |
| **P0** | **`DEF-02`** | `AdminPortalPage.tsx` & `crosscollege-passport.ts` | Frontend updated to canonical `/api/v1/admin/organizers/${clubId}/verify`; backend added compatibility alias `POST /organizers/:id/verification`. | `tests/unit/identity-auth-repair.test.ts` (2.1, 2.2) | **REMEDIATED** |
| **P1** | **`DEF-03`** | `CreateEventPage.tsx` | Replaced mock venue strings (`v-auditorium`) with seeded database UUIDs. | `tests/unit/known-defects-forensics.test.ts` (3.1, 3.2) | **REMEDIATED** |
| **P1** | **`DEF-04`** | `ReviewQueuePage.tsx` & `App.tsx` | Integrated `useAuth`, added reviewer status banner, quick login action (`reviewer.faculty@campus.edu`), and decision modal protection. | `tests/unit/identity-auth-repair.test.ts` (1.1-1.5) | **REMEDIATED** |
| **P1** | **`DEF-05`** | `events.ts` & `api-client.ts` | Fastify empty body parser safe handling, client timeout increased to 60s, and draft idempotency deduplication. | `tests/unit/known-defects-forensics.test.ts` (5.1, 5.2) | **REMEDIATED** |
| **P2** | **`DEF-06`** | `MyBookingsPage.tsx` | Fallback preview ticket preserved on 401 unauthenticated guest visits. | Playwright guest mode test pass. | **REMEDIATED** |
| **P2** | **`DEF-07`** | Workspace manifests & pages | Cleaned up unused imports in `App.tsx` and `AdminPortalPage.tsx`. | `pnpm typecheck` exit code 0 | **REMEDIATED** |
| **P1** | **`DEF-08`** | `EventDetailsPage.tsx` | Cleaned up non-UUID `answers` submission, added `useAuth` user.displayName auto-fill, and implemented persistent local input caching. | `tests/unit/form-workflow-repair.test.ts` (3.1-3.3) | **REMEDIATED** |
| **P2** | **`DEF-09`** | `FeedbackSheet.tsx` | Replaced token-only check with UUID verification to dispatch live feedback requests with session credentials. | `tests/unit/form-workflow-repair.test.ts` (4.1-4.2) | **REMEDIATED** |
| **P2** | **`DEF-10`** | `PassportPage.tsx` & `MyBookingsPage.tsx` | Aligned ticket status handling: added `CHECKED_IN` support rendering `ATTENDED` badge. | `tests/unit/booking-passport-integrity.test.ts` (1.1-7.4) | **REMEDIATED** |
| **P1** | **`DEF-11`** | `packages/backend/src/db/schema.ts` | Added missing reverse relations (`eventFaqsRelations`, `eventAnnouncementsRelations`, etc.) in Drizzle schema to eliminate 500 query crash on `GET /api/v1/events/:slug`. | `tests/unit/remaining-feature-repair.test.ts` (4.3) | **REMEDIATED** |
| **P0** | **`SEC-01`** | `packages/backend/src/routes/api/v1/` | OWASP ASVS V4 Object-Level Authorization (IDOR) on tickets, bookings, and organizer event moderation verified with strict 403 `FORBIDDEN` guards. | `tests/unit/phase7-security-integrity.test.ts` (1.1-1.4) | **VERIFIED** |
| **P0** | **`SEC-02`** | `packages/backend/src/plugins/auth-policy.ts` | Double-Submit CSRF cookie & header validation (`CSRF_INVALID`) and instant session revocation upon user suspension verified. | `tests/unit/phase7-security-integrity.test.ts` (2.1-2.3) | **VERIFIED** |
| **P0** | **`SEC-03`** | `packages/backend/src/services/venue.ts` & `booking.ts` | PostgreSQL GiST exclusion constraint (`409 VENUE_CONFLICT`) and high-concurrency capacity boundary gate (`sold <= capacity`) verified under concurrent load. | `tests/unit/phase7-security-integrity.test.ts` (3.1-3.2) | **VERIFIED** |
| **P1** | **`SEC-04`** | `qr-ticket.ts` & `exports.ts` | Zero-PII public certificate verification endpoint (`/verify/:code`) and CSV formula injection neutralization (CWE-1236) verified. | `tests/unit/phase7-security-integrity.test.ts` (4.1-4.2) | **VERIFIED** |
| **P1** | **`SEC-05`** | PostgreSQL DB & Outbox worker | Immutability of append-only audit trail and transactional outbox dead-letter isolation (`FAILED`/`DEAD` status with bounded retry attempts) verified. | `tests/unit/phase7-security-integrity.test.ts` (5.1-5.2) | **VERIFIED** |
