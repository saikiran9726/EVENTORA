# Eventora — Phase 0: Repository Audit & Architectural Baseline

**Date:** 2026-10-21  
**Author:** CTO & Principal Architect  
**Project:** Eventora (Smart Campus Event Management System)  
**Specification Source:** `Eventora_20x_Master_Blueprint_Antigravity.pdf` (54 pages)

---

## 1. Executive Summary & Repository Inventory

An inspection of the root workspace `c:\sai projects\eventora` revealed that the repository was newly allocated and initially uninitialized (no `.git` directory, zero source files, clean state).

### Local Environment Verification
- **Operating System:** Windows 11 (build 10.0.26100)
- **Node.js:** `v20.19.6` (Complies with Stack requirement: Node 20)
- **Package Manager:** `pnpm` (`v12.4.2`) & `npm` (`v10.8.2`)
- **Database Server:** Local PostgreSQL service (`postgresql-x64-18`) detected running on port `5432`.
- **Redis Service:** Port `6379` not running as a persistent Windows service; BullMQ worker and Redis client will utilize a local Redis instance or in-memory Redis runner (`redis-memory-server` / `ioredis-mock`) for development and automated test runner execution.
- **Git Version:** `2.52.0.windows.1` initialized cleanly.

---

## 2. Blueprint Discrepancy & Alignment Register

As mandated by the execution specification, the blueprint was analyzed for internal conflicts and aligned with non-negotiable rules:

| Item | Blueprint Source (Page / Section) | Observed Conflict / Variance | Smallest Safe Resolution |
| :--- | :--- | :--- | :--- |
| **Role Taxonomy** | Page 5 lists "Student, Team leader, Club / organizer member, Faculty coordinator, Administrator, Check-in staff". Page 41 groups "Volunteer / check-in staff". | Prompt specifies exactly 6 roles: `student`, `organizer`, `reviewer`, `admin`, `volunteer`, `checkin_staff`. | Store `users.global_role` as an enum of the 6 canonical roles. Scoped grants (`organizer_members`, `event_staff_assignments`) handle club and event check-in staff delegation. Team leadership is managed at the team level (`team_members.role = 'LEADER'`). |
| **Concurrency & Account Target** | Page 4 & 15 specify 1,000 student accounts. Page 40, 42, 50 require resilience for 5,000+ concurrent users (`NFR-SCALE`). | Capacity planning target (accounts) vs. peak concurrent load. | Baseline campus seed contains 1,000 student accounts; database connection pooling, indexing, and k6 load scenarios target 5,000+ concurrent request resilience. |
| **Payment Handling** | Page 7, 8, 10, 26 describe payment simulation vs. provider sandbox options. Page 16 mentions webhook signature validation. | Real money vs simulated provider. | Implement a dedicated, secure payment simulator adapter with cryptographically signed webhook callbacks, idempotent processing, and zero external payment credentials. All UI interfaces explicitly display "TEST MODE – simulated money". |

---

## 3. Architecture & Monorepo Structure Plan

A modular monolith architecture with a separate background worker process is established:

```
eventora/
├── docs/
│   ├── rtm.csv                     # Requirements Traceability Matrix (23 items)
│   ├── audit-phase0.md             # This baseline report
│   └── architecture.md            # System architecture specification
├── packages/
│   ├── shared/                    # Shared TypeScript types, Zod schemas, error envelope
│   │   ├── src/
│   │   │   ├── error.ts           # Standard error envelope schema & helper
│   │   │   ├── roles.ts           # 6 Canonical roles & policy definitions
│   │   │   └── schema.ts          # Zod validation schemas
│   │   └── package.json
│   ├── backend/                   # Fastify Node 20 API + Drizzle ORM
│   │   ├── src/
│   │   │   ├── db/                # Drizzle schema, migrations, connection pool
│   │   │   ├── plugins/           # Auth, policy enforcement, CSRF, error handler
│   │   │   ├── routes/            # Deny-by-default protected API routes
│   │   │   └── services/          # Domain services (events, bookings, outbox, etc.)
│   │   └── package.json
│   ├── worker/                    # BullMQ background worker (separate process)
│   │   ├── src/
│   │   │   ├── index.ts           # Outbox processor, notification dispatcher
│   │   │   └── jobs/              # Email, waitlist expiry, certificates
│   │   └── package.json
│   └── frontend/                  # React + Vite + Tailwind + shadcn/ui PWA
│       ├── src/
│       │   ├── components/        # Accessible UI components (WCAG 2.2 AA)
│       │   ├── pages/             # Student, organizer, reviewer, admin views
│       │   └── lib/               # Typed API client, session management
│       └── package.json
├── tests/
│   ├── unit/                      # Vitest business logic & policy tests
│   ├── integration/               # Database transactional & concurrency tests
│   └── e2e/                       # Playwright browser end-to-end tests
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.base.json
└── README.md
```

---

## 4. Requirement Traceability Matrix (RTM) Baseline

The RTM is created at [`docs/rtm.csv`](./rtm.csv) with 23 requirements covering all functional and non-functional specifications:
- **FR-AUTH**: Sign-in, role access, Argon2id, SHA-256 session rotation, CSRF.
- **FR-EVENT**: Proposal, faculty review, lifecycle state transitions.
- **FR-DISC**: Public event discovery, calendar, filters.
- **FR-REG**: Concurrency-safe registration, ticket reservation.
- **FR-WAIT**: Deterministic waitlist queue, seat release offer & expiry.
- **FR-TEAM**: Team formation, invitations, join requests, competition registration.
- **FR-PAY**: Test-mode paid checkout (integer paise), receipts, simulated ledger.
- **FR-CHECKIN**: 32-byte base64url QR check-in, duplicate prevention, staff scanner.
- **FR-OFFLINE**: Offline check-in manifest, batch synchronization, conflict handling.
- **FR-CERT**: Verifiable certificate generation and eligibility enforcement.
- **FR-FEED**: Verified attendee feedback and rating moderation.
- **FR-INSIGHT**: Organizer event insights and scoped analytics.
- **FR-VOL**: Volunteer roles, shift capacities, assignments, and check-in.
- **FR-VENUE**: Campus event navigator, venue conflict detection, equipment booking.
- **FR-ALERT**: Event change and urgent alerts with in-app notification center.
- **FR-PASS**: Student Event Passport, verified achievements, privacy controls.
- **FR-XCOL**: Cross-college event discovery for verified participating colleges.
- **FR-OPS**: Platform administration, role moderation, audit log trails.
- **NFR-SCALE**: 5,000+ concurrent user resilience.
- **NFR-NOTIFY**: Transactional outbox dispatch with < 2 s latency.
- **NFR-UPTIME**: 99% availability with readiness/liveness health probes.
- **NFR-SEC**: Zero PII in QR, Argon2id, least-privilege DB, deny-by-default routing.
- **NFR-UX**: WCAG 2.2 AA, visible focus, responsive viewports (375px / 768px / 1280px), CLS ≈ 0.

---

## 5. Risk Register & Dependency Mitigation Plan

| Risk ID | Description | Impact | Mitigation Strategy |
| :--- | :--- | :--- | :--- |
| **R-01** | Port 6379 Redis service not installed as native Windows service | Moderate | Use `redis-memory-server` / `ioredis-mock` for automated testing and local developer convenience; support standard Redis connection URL via environment variable `REDIS_URL` for staging/production containers. |
| **R-02** | Concurrent seat overselling under high contention | Critical | Strict transaction isolation with `SELECT ... FOR UPDATE` directly on the ticket counter/type row; check constraints (`CHECK (price_paise >= 0)`). CI test verifies race conditions with simulated parallel checkouts. |
| **R-03** | Missing route authorization policies | High | Implement a route scanner test that traverses all Fastify registered routes and verifies the presence of `{ auth, policy, objectCheck }`. Fails CI build if any route is undeclared. |
| **R-04** | Client-tampered pricing or checkout amounts | Critical | Server completely ignores client-submitted price totals; authoritative calculation is derived from PostgreSQL `ticket_types.price_paise` inside the database transaction. |
| **R-05** | Double-scan or replay attacks on QR check-in | High | QR codes are opaque 32-byte base64url tokens whose SHA-256 hash is verified against the database. DB enforces single-use check-in with atomic update and status transition (`VALID` -> `CHECKED_IN`). |

---

## 6. Phase 0 Exit Criteria Verification

- [x] Repository audit completed and documented.
- [x] Blueprint discrepancies analyzed and documented with smallest safe resolutions.
- [x] Traceability matrix created at `/docs/rtm.csv` with all 23 requirement IDs.
- [x] Baseline architecture, risk register, and monorepo structure designed.
- [x] Clean Git repository initialized.
