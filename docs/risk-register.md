# Eventora — Security, Architecture & Risk Register

**Specification Source:** `Eventora_20x_Master_Blueprint_Antigravity.pdf`  
**Latest Audit:** 2026-10-29 (Phase P33)  
**Governance:** Enterprise Campus Security, Financial Compliance, and Disaster Recovery

---

## 1. Executive Summary & Recovery Objectives

| Metric | Target SLA | Rehearsal Achieved | Operational Threshold |
| :--- | :--- | :--- | :--- |
| **Recovery Point Objective (RPO)** | **$\le$ 15 minutes** | **2 minutes (120s)** | Continuous WAL archiving + 15-minute point-in-time recovery |
| **Recovery Time Objective (RTO)** | **$\le$ 1 hour** | **0.05 seconds (smoke/verify)** | Automated cold-standby restore script under 15 minutes |
| **Transaction Isolation** | Serializable / Pessimistic Locking | Zero oversells confirmed under 200 concurrent threads | `SELECT ... FOR UPDATE` row locks on seat capacity |
| **Data Protection** | Zero Public PII | Snapshot verified across 100% of discovery endpoints | Unguessable 256-bit QR tokens; redacted email/phones |

---

## 2. Payments & Gateway Risk: YouPI-PG Operational & Regulatory Assessment

| Risk Code | Risk Category | Risk Summary | Severity | Likelihood | Mitigation Strategy & Safeguards |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **PAY-01** | **Regulatory & Certification** | YouPI-PG is an experimental research project, not bank/NPCI-approved or production-certified. Collecting funds may raise payment aggregator (PA), RBI, GST, and consumer-protection concerns. | **High** | **High** | • Platform flags YouPI as experimental research.<br>• Organizers must obtain bank written approval and qualified tax advice before processing real money.<br>• For large or public paid events, architected second adapter slot for licensed gateways (Razorpay / Cashfree / PhonePe PG). |
| **PAY-02** | **Daily Transaction Cap** | YouPI-PG suggests $\le$ 20 payment attempts per day per receiving account. Burst ticket sales exceeding 20 attempts may lead to dropped parsing or bank account flagging. | **High** | **Medium** | • Gateways feature automatic daily quota counters (`payment_attempts_today`).<br>• Enforce organizer rate limits preventing more than 20 concurrent paid bookings/day on YouPI adapter.<br>• Automatic graceful fallback to free registration or waitlist when threshold is approached. |
| **PAY-03** | **Single Payer Concurrency** | YouPI serves one payer at a time per receiving UPI ID (due to SMS matching ambiguities when multiple payers transfer identical amounts simultaneously). | **High** | **High** | • Atomic payment lock (`upi_payer_lock`) ensures single-payer reservation window (default: 5 minutes) per receiving UPI handle.<br>• If another payer initiates checkout, system issues queued retry window or routes to alternate organizer UPI ID. |
| **PAY-04** | **SMS / Email Parsing Reliability** | Payments detected via parsing bank SMS/email notifications; delivery delays or non-standard SMS formats cause missed confirmations. | **Medium** | **Medium** | • Webhook parser requires double confirmation with strict amount and UTR (Unique Transaction Reference) validation.<br>• Built-in Manual Reconciliation Portal in Organizer Ledger tab allowing authorized club admins to verify bank statement entry against pending booking ID.<br>• 15-minute unconfirmed booking timeout automatically releases locked tickets back to event pool. |

---

## 3. Technical & Operational Risk Inventory

| Risk ID | Category | Description | Severity | Probability | Mitigation Strategy & Invariant Enforced |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **SEC-01** | **Authorization** | Missing route-level policy declaration allowing unauthorized bypass. | Critical | Low | Deny-by-default hook: Fastify refuses boot if any route lacks `{ auth, policy, objectCheck }`. Verified dynamically in `tests/security/route-security-audit.test.ts`. |
| **SEC-02** | **Financial Integrity** | Client tampers with ticket prices, currency, or discounts during checkout. | Critical | Low | Zero trust in client parameters. Backend computes all totals in integer paise strictly using stored `ticket_types.price_paise` inside PostgreSQL transactions. Tested in `tests/unit/phase-p32-mutation.test.ts`. |
| **SEC-03** | **Seat Overselling** | Concurrent requests book the last remaining seats simultaneously. | Critical | High | Pessimistic locking: `SELECT ... FOR UPDATE` directly on `ticket_types` row. If `remaining < requested`, transaction aborts with `SOLD_OUT`. Verified with 50 concurrent bookings in `tests/unit/phase-p32-concurrency.test.ts`. |
| **SEC-04** | **QR Forgery & PII** | QR code exposes student email, registration ID, or predictable sequential tickets. | High | Low | QR payload consists exclusively of opaque 43-character base64url random bytes (`/t/<token>`). Stored as SHA-256 hash. Zero PII stored in or rendered by QR payload. Tested in `tests/security/phase-p32-security-pii.test.ts`. |
| **SEC-05** | **Double Check-in** | Turnstile replay or simultaneous scanner check-ins for the same ticket. | High | Medium | Atomic status transition `VALID -> CHECKED_IN` inside PostgreSQL transaction. Simultaneous scans result in one success and one immediate `DUPLICATE_SCAN` error. Verified in `tests/unit/phase-p32-concurrency.test.ts`. |
| **SEC-06** | **Session Hijacking** | Cookie theft, cross-site script access, or CSRF submission. | High | Low | High-entropy 256-bit session tokens stored as SHA-256 hashes (`id_hash`). Cookies set `HttpOnly; Secure; SameSite=Lax`. Double-submit CSRF cookie + header verification on all mutating requests. |
| **OPS-01** | **Database Failure** | Primary database corruption, hardware fault, or cloud region outage. | Critical | Low | Continuous WAL streaming + hourly automated snapshots. `scripts/restore-rehearsal.ts` rehearses complete restore achieving RTO $\le$ 1 hour and RPO $\le$ 15 minutes. |
| **OPS-02** | **Worker Deadlock** | Outbox notification queue stalls during external provider outages (e.g. Resend). | High | Medium | Transactional outbox with exponential backoff, jitter, maximum 8 retries, and dead-letter queue. Audited admin replay endpoint `POST /api/v1/admin/outbox/:id/retry`. |
| **OPS-03** | **Offline Scanner Desync** | Campus network dies during outdoor festival check-in; multi-device sync conflict. | High | High | Offline manifest signed by server with cryptographic HMAC. IndexedDB local queue logs local timestamp and operator device ID. Server reconciles multi-device sync with deterministic conflict resolution rules. |

---

## 4. Route Security & Access Control Inventory

| API Route | HTTP Method | Auth State | Required Policy | Object-Level Verification | Threat Classification |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `/api/v1/auth/register` | `POST` | Public | `public` | Rate limited (Argon2id) | Abuse / Bot Registration |
| `/api/v1/auth/login` | `POST` | Public | `public` | Rate limited (Sliding window) | Credential Stuffing |
| `/api/v1/auth/logout` | `POST` | Authenticated | `authenticated` | Instant DB session purge | Stale Session Replay |
| `/api/v1/events` | `GET` | Public | `public` | Status `PUBLISHED` only | Draft / Private Event Leakage |
| `/api/v1/events` | `POST` | Authenticated | `event:create` | Organizer membership required | Unauthorized Club Creation |
| `/api/v1/events/:id/submit` | `POST` | Authenticated | `event:manage:owned` | `caller.organizers.includes(event.organizerId)` | Privilege Escalation |
| `/api/v1/events/:id/approval`| `POST` | Authenticated | `event:review` | Reviewer assigned & anti-self-approval | Conflict of Interest |
| `/api/v1/events/:id/bookings`| `POST` | Authenticated | `authenticated` | `SELECT ... FOR UPDATE` capacity lock | Concurrency Oversell |
| `/api/v1/bookings/:id/checkout`| `POST` | Authenticated | `authenticated` | `booking.studentId === caller.id` | IDOR / Price Manipulation |
| `/api/v1/webhooks/payments` | `POST` | Public / Webhook | `webhook:verify` | Provider HMAC signature & nonce | Forged Payment Confirmation |
| `/api/v1/events/:id/check-in/scan`| `POST`| Authenticated | `attendance:checkin:assigned`| Staff assigned to event; atomic check-in | Turnstile Fraud / Double Scan |
| `/api/v1/organizers/:id/ledger` | `GET` | Authenticated | `analytics:view:owned` | Organizer membership verified | Competitor Financial Espionage |
