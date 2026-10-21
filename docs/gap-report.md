# Eventora — Phase 0 Architectural Gap Report

**Specification Source:** `Eventora_20x_Master_Blueprint_Antigravity.pdf`

---

## 1. Baseline Assessment

| Blueprint Module | Blueprint Specification Requirement | Current Implementation Status | Resolution / Target Phase |
| :--- | :--- | :--- | :--- |
| **Authentication & Roles** | 6 Canonical roles, Argon2id, SHA-256 session rotation, CSRF protection | Not started (UI shell role switcher verified) | Phase 2 (`@eventora/backend` Fastify auth) |
| **Event Lifecycle** | Event CRUD, draft/submit/review/publish/cancel, venue conflict prevention | UI discovery & details verified with mock data | Phase 3 (Event domain services & migrations) |
| **Free Registration** | Concurrency-safe seat reservation (`FOR UPDATE`), instant QR issuance | Mock modal registration verified | Phase 4 (Transactional booking pipeline) |
| **Paid Checkout** | Test-mode only, integer paise, simulated ledger, refund workflow | UI pricing displayed in INR with test mode badges | Phase 5 (Simulated gateway & ledger entries) |
| **QR Check-in & Attendance** | 32-byte base64url QR, SHA-256 DB hash, single check-in guarantee | UI scanner shell created | Phase 6 (QR crypto verification & scan API) |
| **Teams & Competitions** | Team formation, invitations, join requests, size enforcement | Shell placeholders established | Phase 4 (Team domain & submission models) |
| **Campus Operations** | Venue conflict checks, volunteer shifts, equipment booking | Venue navigator UI card created | Phase 8 (Campus facilities & volunteer engine) |
| **Offline Mode** | Manifest caching, offline scan persistence, batch sync conflict checks | State machine & UI contract mapped | Phase 9 (IndexedDB sync worker & manifest API) |
| **Feedback & Ratings** | One review per eligible attendee, rating aggregation | Feedback states created | Phase 7 (Feedback service & moderation) |
| **Event Passport** | Verified achievements, student portfolio sharing | Passport view shell created | Phase 10 (Public handles & achievement queries) |
| **Outbox & Notifications** | Transactional outbox pattern, BullMQ retry dispatcher (8 retries) | Shared error envelope & schema established | Phase 2/9 (Worker process & queue integration) |

---

## 2. Gate Verification Summary

- **Typecheck**: `pnpm typecheck` exits with code 0 across all workspaces.
- **Lint**: `pnpm lint` exits with code 0 across all workspaces.
- **Unit Tests**: `pnpm test` (Vitest) executes 10 tests across 3 files with 100% pass rate.
- **Browser Tests**: `pnpm test:e2e` (Playwright) executes 15 tests across Mobile (375px), Tablet (768px), and Desktop (1280px) with 100% pass rate.
- **Accessibility**: Axe-core WCAG 2.2 AA scan reports 0 violations.
- **Container Infrastructure**: `docker-compose.yml` configured with PostgreSQL 16 Alpine and Redis 7 Alpine.
