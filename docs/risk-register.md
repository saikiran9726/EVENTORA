# Eventora — Security, Architecture & Risk Register

**Specification Source:** `Eventora_20x_Master_Blueprint_Antigravity.pdf` (Pages 14, 35, 41, 46)

---

## 1. Route Auth State & Vulnerability Inventory

Every API endpoint must declare `{ auth, policy, objectCheck }`. Routes lacking declared policies or object-level authorization are classified as security defects.

| API Endpoint | Method | Expected Auth State | Required Policy | Object-Level Check | Defect / Risk Classification |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `/api/auth/register` | `POST` | Public | `auth:public` | N/A | None (Rate-limited, Argon2id) |
| `/api/auth/login` | `POST` | Public | `auth:public` | N/A | None (Rate-limited, brute-force guarded) |
| `/api/auth/logout` | `POST` | Authenticated | `auth:authenticated` | N/A | Session invalidated in DB & cookie cleared |
| `/api/auth/session` | `GET` | Authenticated | `auth:authenticated` | `caller.id == session.userId` | None |
| `/api/auth/csrf` | `GET` | Public | `auth:public` | N/A | Generates double-submit CSRF cookie |
| `/api/events` | `GET` | Public | `public` | Filter to `status == 'PUBLISHED'` | Defect if draft events leaked to anonymous users |
| `/api/events` | `POST` | Authenticated | `event:create` | Caller is member of target club | Defect if non-club member creates event |
| `/api/events/:id/submit` | `POST` | Authenticated | `event:manage:owned` | `event.organizerId in caller.organizers` | Defect if unauthorized user submits event |
| `/api/events/:id/approval`| `POST`| Authenticated | `event:review` | Reviewer assigned or authorized for dept | Defect if organizer self-approves own event |
| `/api/events/:id/bookings`| `POST`| Authenticated | `auth:authenticated` | Concurrency check (`FOR UPDATE` on tickets)| Defect if client amount trusted or capacity oversold |
| `/api/bookings/:id` | `GET` | Authenticated | `auth:authenticated` | `booking.studentId == caller.id OR hasPolicy('event:manage:owned')` | Defect (IDOR) if student A reads student B booking |
| `/api/bookings/:id/checkout`|`POST`| Authenticated | `auth:authenticated` | `booking.studentId == caller.id` | Defect if amount altered from DB `price_paise` |
| `/api/payments/verify` | `POST` | Authenticated | `auth:authenticated` | Verify signed simulator callback payload | Defect if browser redirect URL trusted blindly |
| `/api/webhooks/payments`| `POST` | Public / Webhook | `webhook:verify` | Verify provider HMAC signature & dedupe ID | Defect if unsigned webhook triggers ticket issuance |
| `/api/tickets/:id/check-in`|`POST`| Authenticated | `attendance:checkin:assigned`| Staff assigned to event AND ticket not checked in | Defect if staff checks in ticket for another event |
| `/api/organizers/:id/sales`|`GET`| Authenticated | `analytics:view:owned` | `caller in organizer_members(organizer_id)`| Defect if Club A views Club B sales / ledger |
| `/api/teams/:id/events/:eventId/register`|`POST`| Authenticated | `team:lead:owned` | Caller is team leader AND event allows teams | Defect if team member registers without leader authority |

---

## 2. Technical Risk Register & Action Plan

| Risk ID | Category | Description | Severity | Probability | Mitigation Strategy & Safeguard |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **SEC-01** | Authorization | Missing route-level policy declaration allowing unauthorized bypass. | Critical | Low | CI test dynamically enumerates 100% of Fastify registered routes and fails if any route lacks `{ auth, policy, objectCheck }`. |
| **SEC-02** | Financial | Client sends tampered prices or currencies in booking checkout. | Critical | Medium | Zero trust in client pricing. Backend computes all totals in integer paise strictly using stored `ticket_types.price_paise`. All payments clearly marked `TEST MODE`. |
| **SEC-03** | Concurrency | Two concurrent registrations book the last available seat simultaneously. | Critical | High | Database transaction with `SELECT ... FOR UPDATE` directly on the ticket counter/type row. Rollback if `remaining_capacity < requested`. |
| **SEC-04** | QR Forgery | QR payload containing student personal data or predictable ticket IDs. | High | Medium | QR payload contains exclusively `base64url(32 random bytes)`. Database stores SHA-256 hash. Zero PII in QR. Instant server-side revocation supported. |
| **SEC-05** | Double Check-in | Replay or simultaneous scans of the same ticket on two turnstiles. | High | Medium | Atomic status transition `VALID -> CHECKED_IN` inside PostgreSQL transaction. Repeat scan immediately returns `DUPLICATE_SCAN` error. |
| **SEC-06** | Session Hijack | Session hijacking or CSRF attacks on student and organizer accounts. | High | Medium | Opaque 256-bit random tokens in HttpOnly, Secure, SameSite=Lax cookies, SHA-256 hashed in database. Double-submit token + Origin verification on all non-GET requests. |
| **OPS-01** | Environment | Docker command not recognized natively on host system. | Moderate | High | Full `docker-compose.yml` provided for containerized CI/CD. Local Windows host utilizes running native PostgreSQL service on port 5432 and embedded Redis mock adapter. |
| **OPS-02** | Reliability | Outbox notifications lost during network glitches or provider downtime. | High | Low | Side effects written to `outbox` within the same DB transaction. BullMQ worker dispatches with exponential backoff + jitter (max 8 retries) and dead-letter queue. |
