# Student Portal Comprehensive Audit & Restoration Report

**Audit Date:** 2026-10-29  
**Engineer:** Principal Full-Stack Engineer  
**Scope:** `StudentShell`, `MyBookingsPage` (My Events), `PassportPage`, `CalendarPage`, `TeamsPage`, `VolunteerHubPage`, `NotificationCenter`, and `ProfilePreferencesPage`.

---

## 1. Executive Summary & Inventory of Subsystems

This audit covers every route, interactive button, navigation link, query parameter, and data flow across the student portal experience in Eventora. Prior to Phase P24, several key workflows contained disconnects between UI state and backend route signatures (e.g. notification endpoint path mismatches, calendar month parsing, unlinked team join requests, static mock team lists, missing event materials tables, and lack of pending payment resumption). All issues have been identified and remedied with full backend and frontend integration.

---

## 2. Detailed Component-by-Component Audit & Fix Matrix

### 2.1 StudentShell (`packages/frontend/src/components/shells/StudentShell.tsx`)
- **Routes & Links:**
  - `discover` $\to$ `/` (Discovery page) — Verified & working.
  - `calendar` $\to$ `/calendar` (Campus calendar) — Verified & working.
  - `tickets` $\to$ `/tickets` (My Tickets & Registrations) — Verified & working.
  - `passport` $\to$ `/passport` (Student Event Passport) — Verified & working.
  - `profile` $\to$ `/profile` (Account & Preferences) — Verified & working.
  - `teams` $\to$ `/teams` (Teams & Hackathon Hub) — Verified & working.
  - `volunteers` $\to$ `/volunteers` (Volunteer Hub) — **Finding:** Top header had volunteers button, but desktop sidebar omitted it. **Fix:** Added `Volunteers Hub` directly to the desktop sidebar navigation.
  - `components` $\to$ `/components` (UI Gallery) — Verified & working.
- **Controls & Notification Bell:**
  - **Finding:** Unread notification count badge stayed at 0 upon page load until the notification center modal was manually toggled open.
  - **Fix:** Added an on-mount fetch to `GET /api/v1/me/notifications` to populate `unreadCount` immediately on app launch.
  - Theme toggle (Dark / Light) — Verified & working.

### 2.2 MyBookingsPage / My Events (`packages/frontend/src/pages/MyBookingsPage.tsx`)
- **Upcoming vs. Past Categorization:**
  - **Finding:** All bookings were previously dumped into a single list without temporal classification.
  - **Fix:** Implemented tabbed segmentation (`Upcoming Events` vs `Past & Completed`) with dynamic count badges, separating upcoming events from past, completed, or cancelled registrations.
- **Status Chips:**
  - Added semantic status badges: `CONFIRMED` (green), `PENDING PAYMENT` (amber), `CHECKED IN` (brand blue), `CANCELLED` (neutral), `REFUNDED` (neutral).
- **Resume-Checkout Flow:**
  - **Finding:** Students with unpaid or pending bookings had no way to resume payment.
  - **Fix:** Implemented an amber alert banner and prominent "Resume Checkout ({formatINR(totalPaise)})" button routing directly to `/checkout/:bookingId`.
- **Schedule + `.ics` RFC 5545 Export:**
  - **Finding:** No calendar export on ticket cards.
  - **Fix:** Implemented "Add to Calendar (.ics)" button on each card triggering RFC 5545 file download via `/api/v1/events/:id/ics` with client-side fallback.
- **Digital Pass & QR Offline Caching:**
  - **Finding:** If attendee lost network connectivity at turnstiles, tickets could not be loaded.
  - **Fix:** Implemented local offline caching to `localStorage` (`eventora_offline_tickets_cache`). When offline or network requests fail, cached tickets are automatically rendered alongside a status notice informing the user that dynamic QR tokens remain valid for turnstile check-in.
- **Pass Download:**
  - Added "Download Pass" button opening `/api/v1/tickets/:id/download` for printable passes.
- **Cancellation & Refund Policy:**
  - Added dedicated cancellation dialog with dynamic policy messaging:
    - Paid bookings: Displays exact paise amount and clarifies automatic refund dispatch via YouPI-PG.
    - Free bookings: Clarifies immediate ticket release and promotion of waitlisted candidates.
- **Event Materials (`event_materials`):**
  - **Finding:** Course slides, decks, and workshop handouts had no dedicated database table or route.
  - **Fix:** Created `event_materials` table (Migration 26), registered-only access check (`REGISTRATION_REQUIRED` 403 for non-attendees), organizer upload endpoint with 25MB file size limit and MIME-type validation, and frontend Event Materials modal with formatted file sizes and direct download links.

### 2.3 PassportPage (`packages/frontend/src/pages/PassportPage.tsx`)
- **Routes & Tabs:**
  - `timeline` (verified attendance, volunteer hours, certificates, team participation).
  - `passes` (active admission passes and dynamic QR codes).
  - `certificates` (tamper-evident SHA-256 credentials with verification codes).
  - `settings` (instant privacy switches, public slug handle, cross-college discovery visibility).
- **Buttons & Verification Links:**
  - "Verify Certificate" routes to `/verify/:code`.
  - "View Public Handle" routes to `/p/:slug`.
  - "Instant Hide Everything" immediately sets `isPublic = false` and updates database preferences.
  - Audit status: All endpoints and buttons operational.

### 2.4 CalendarPage (`packages/frontend/src/pages/CalendarPage.tsx`)
- **Query Parameter Mismatch:**
  - **Finding:** `CalendarPage` sent `?month=YYYY-MM&view=month`, but backend `calendarQuerySchema` strictly expected ISO `start` and `end` datetime strings, causing validation rejection or missing month data.
  - **Fix:** Updated backend `packages/backend/src/routes/api/v1/calendar.ts` to accept `month: YYYY-MM` and `view`, computing month UTC bounds automatically.
- **RFC 5545 `.ics` Export:**
  - **Finding:** Frontend `handleExportIcs` attempted to parse JSON `{ data: { ics: string } }` from `/api/v1/events/:id/ics`, which actually streams a binary/text file attachment.
  - **Fix:** Switched frontend to download the streamed file attachment directly.

### 2.5 TeamsPage (`packages/frontend/src/pages/teams/TeamsPage.tsx`)
- **Team Discovery & My Teams:**
  - **Finding:** `myTeams` was initialized with static mock data and never queried backend teams.
  - **Fix:** Updated `GET /api/v1/teams` in backend to support `?mine=true` / `filter=my` for authenticated users. Frontend now loads both user-joined teams and discoverable teams concurrently.
- **Request to Join:**
  - **Finding:** "Request to Join" button in Discover Teams tab was completely static without an `onClick` handler.
  - **Fix:** Implemented `handleRequestJoin` calling `POST /api/v1/teams/:id/join-requests` with toast confirmations and loading state.
- **Readiness Checklist:**
  - Renders team size requirements (2-10 members), leader verification, and skills complement.

### 2.6 VolunteerHubPage (`packages/frontend/src/pages/VolunteerHubPage.tsx`)
- **Shift Browser & My Shifts:**
  - Verified `GET /api/v1/me/volunteering` integration.
  - Verified application submission (`POST /api/v1/shifts/:id/applications`).
- **Check-In Window Validation:**
  - Verifies that shift check-in is strictly constrained to $[startsAt - 15\text{m}, endsAt]$.
  - Displays remaining countdown time until window opens.
  - Integrated turnstile verification call (`POST /api/v1/applications/:id/check-in`).

### 2.7 NotificationCenter (`packages/frontend/src/components/notifications/NotificationCenter.tsx`)
- **Backend Route Mismatch:**
  - **Finding:** Component called `/api/v1/users/me/notifications*`, whereas backend routes were registered at `/api/v1/me/notifications*` and `/api/v1/me/notification-preferences`. This caused all requests to fail with 404, forcing fallback to mock notifications.
  - **Fix:** Corrected all endpoint URLs to `/api/v1/me/notifications`, `/api/v1/me/notifications/:id/read`, `/api/v1/me/notifications/read-all`, and `PATCH /api/v1/me/notification-preferences`.

### 2.8 ProfilePreferencesPage (`packages/frontend/src/pages/ProfilePreferencesPage.tsx`)
- **Sign Out Action:**
  - **Finding:** In `App.tsx`, `onLogout` only invoked `navigate('/')` without calling the `logout()` auth handler, leaving sessions active in cookies.
  - **Fix:** Updated `App.tsx` to await `logout()` before redirecting.
- **Academic Year & Department:**
  - Verified persistence through `PATCH /api/v1/me` for cross-college eligibility.
- **Appearance & Dark Mode:**
  - Verified synchronized theme state and `localStorage` persistence.

---

## 3. Database Migration Summary

- **Migration Version:** 26 (`Phase 26: Event Materials for Registered Attendees`)
- **Table Added:** `event_materials`
  - Columns: `id` (UUID PK), `event_id` (UUID FK $\to$ events), `title` (VARCHAR 255), `description` (TEXT), `file_url` (TEXT), `file_name` (VARCHAR 255), `file_size_bytes` (INT), `mime_type` (VARCHAR 100), `uploaded_by` (UUID FK $\to$ users), `created_at` (TIMESTAMPTZ), `updated_at` (TIMESTAMPTZ).
  - Index: `idx_event_materials_event_id` on `event_materials(event_id)`.
- **Down-Migration:** 26 $\to$ 25 in `packages/backend/src/db/migrate-down.ts` dropping table and index, registered and verified in PostgreSQL.

---

## 4. Verification Evidence & Test Coverage

- **Database Rollback & Re-application Test:** Verified down-migration 26 $\to$ 25 and upward migration 25 $\to$ 26 live against local database.
- **Access Control Matrix:** Verified that attendees with `CONFIRMED` or `CHECKED_IN` bookings have access to event materials, while unregistered users receive 403 `REGISTRATION_REQUIRED`.
- **Upload Guards:** Verified that files $>25\text{ MB}$ or invalid MIME types are rejected with 400 `VALIDATION_ERROR`.
- **Offline Caching:** Verified that `localStorage` ticket cache renders seamlessly when network requests are interrupted.
