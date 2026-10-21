# Eventora — Formal State Machine Specifications

**Specification Source:** `Eventora_20x_Master_Blueprint_Antigravity.pdf` (Pages 7, 9, 11, 23, 43, 44)

---

## 1. Event State Machine

| From | To | Actor | Guard | Side-Effect |
| :--- | :--- | :--- | :--- | :--- |
| `[Initial]` | `DRAFT` | Organizer | User has `event:create` grant for club | Create event record in draft state |
| `DRAFT` | `PENDING_APPROVAL` | Organizer | Form valid, title, dates, venue & ticket tiers set | Create outbox task to notify faculty reviewer queue |
| `PENDING_APPROVAL` | `APPROVED` | Faculty Reviewer | User has `event:review` grant, no venue conflicts | Write approval record in `event_approvals`, audit log |
| `PENDING_APPROVAL` | `CHANGES_REQUESTED` | Faculty Reviewer | User has `event:review` grant, notes provided | Write reviewer notes, notify organizer via outbox |
| `CHANGES_REQUESTED` | `PENDING_APPROVAL` | Organizer | Organizer edits event and re-submits | Re-queue for faculty review |
| `PENDING_APPROVAL` | `REJECTED` | Faculty Reviewer | User has `event:review` grant | Record rejection reason, audit log |
| `APPROVED` | `PUBLISHED` | Organizer / Admin | Event approved, publication time reached | Event becomes visible in student discovery & calendar |
| `PUBLISHED` | `POSTPONED` | Organizer | Valid future dates provided | Trigger urgent alert to all registered attendees via outbox |
| `PUBLISHED` | `CANCELLED` | Organizer / Admin | Policy allows cancellation | Initiate refund pipeline for paid bookings, notify attendees |
| `PUBLISHED` | `COMPLETED` | System | Event end time elapsed + 2 hours | Open feedback collection window; trigger certificate jobs |

---

## 2. Booking State Machine

| From | To | Actor | Guard | Side-Effect |
| :--- | :--- | :--- | :--- | :--- |
| `[Initial]` | `CONFIRMED` | Student | Free event (`price_paise == 0`), capacity available via `FOR UPDATE` | Decrement capacity counter, issue ticket with QR, enqueue confirmation |
| `[Initial]` | `PENDING_PAYMENT` | Student | Paid event (`price_paise > 0`), capacity available via `FOR UPDATE` | Create seat hold timer (`expires_at = NOW() + 15 min`) |
| `PENDING_PAYMENT` | `CONFIRMED` | System / Webhook | Valid test payment verification or simulator callback | Issue ticket, write organizer ledger entry in single transaction |
| `PENDING_PAYMENT` | `EXPIRED` | Worker / Reconciler| Current time > `expires_at` AND payment is not pending/succeeded | Release seat hold, trigger waitlist promotion check |
| `PENDING_PAYMENT` | `PAYMENT_FAILED` | Gateway Simulator | Payment simulator returns failure response | Release hold, log failure details |
| `CONFIRMED` | `CANCELLED` | Student / Organizer| Cancellation allowed by event policy | Release capacity, invalidate tickets, trigger waitlist promotion |

---

## 3. Payment State Machine (Test Mode Only)

| From | To | Actor | Guard | Side-Effect |
| :--- | :--- | :--- | :--- | :--- |
| `[Initial]` | `CREATED` | System | Booking is `PENDING_PAYMENT` | Create test payment order reference |
| `CREATED` | `PENDING` | Student | Sandbox simulator launched | Wait for simulator signature or webhook callback |
| `PENDING` | `SUCCEEDED` | Gateway Simulator | Webhook payload cryptographically signed, unique event ID | Confirm linked booking, issue QR ticket, write ledger entry |
| `PENDING` | `FAILED` | Gateway Simulator | Simulator outcome failure / card declined / timeout | Update booking to `PAYMENT_FAILED`, release held seats |
| `SUCCEEDED` | `REFUND_PENDING` | Organizer / Admin | Refund initiated within event policy | Create refund request record in `refunds` |
| `REFUND_PENDING` | `REFUNDED` | System Simulator | Test simulator confirms refund operation | Mark payment refunded, record negative ledger entry, revoke ticket |

---

## 4. Refund State Machine

| From | To | Actor | Guard | Side-Effect |
| :--- | :--- | :--- | :--- | :--- |
| `[Initial]` | `REQUESTED` | Student / Organizer| Booking is confirmed and eligible for refund | Enqueue review or auto-approval check |
| `REQUESTED` | `APPROVED` | Organizer / Admin | Request satisfies cancellation cutoff window | Transition payment to `REFUND_PENDING` |
| `REQUESTED` | `REJECTED` | Organizer / Admin | Request violates event cancellation terms | Record reason, notify student |
| `APPROVED` | `PROCESSING` | System | Simulator adapter starts refund execution | Lock refund row |
| `PROCESSING` | `SUCCEEDED` | System Simulator | Test refund simulated successfully | Record ledger reversal, notify student |
| `PROCESSING` | `FAILED` | System Simulator | Simulator error / connection glitch | Alert organizer, log retryable error |

---

## 5. Ticket State Machine

| From | To | Actor | Guard | Side-Effect |
| :--- | :--- | :--- | :--- | :--- |
| `[Initial]` | `VALID` | System | Booking confirmed | Generate base64url(32 random bytes), store SHA-256 hash in DB |
| `VALID` | `CHECKED_IN` | Check-in Staff | User has `attendance:checkin:assigned`, scan match, not scanned before | Record check-in timestamp and staff ID, emit attendance event |
| `CHECKED_IN` | `CHECKED_IN` (Repeat)| Check-in Staff | Re-scan attempt of already checked-in ticket | Reject scan with structured duplicate error, log scan conflict |
| `VALID` | `CANCELLED` | Student / System | Booking cancelled before check-in | Invalidate QR token hash |
| `VALID` / `CHECKED_IN` | `REVOKED` | Admin / Organizer | Disciplinary or administrative override | Revoke ticket access, invalidate associated certificate |

---

## 6. Team Membership State Machine

| From | To | Actor | Guard | Side-Effect |
| :--- | :--- | :--- | :--- | :--- |
| `[Initial]` | `INVITED` | Team Leader | Invitee exists, team current size < `max_size` | Create invitation record, send in-app notification |
| `INVITED` | `ACTIVE` | Student Invitee | Invitee accepts before token expiration | Add to active `team_members`, audit log |
| `INVITED` | `DECLINED` | Student Invitee | Invitee declines invitation | Invalidate invitation record |
| `[Initial]` | `REQUESTED` | Student | Student requests to join public discoverable team | Notify team leader of join request |
| `REQUESTED` | `ACTIVE` | Team Leader | Leader approves request AND team < `max_size` | Add to active `team_members`, audit log |
| `REQUESTED` | `REJECTED` | Team Leader | Leader rejects request | Update request status to `REJECTED` |
| `ACTIVE` | `REMOVED` | Team Leader | Team rules allow removal, not locked for active submission | Remove from active roster, update membership history |

---

## 7. Volunteer Lifecycle State Machine

| From | To | Actor | Guard | Side-Effect |
| :--- | :--- | :--- | :--- | :--- |
| `[Initial]` | `APPLIED` | Student | Shift capacity not exceeded, applicant eligible | Record application in `volunteer_applications` |
| `APPLIED` | `APPROVED` | Organizer | Shift capacity remaining | Update application status to `APPROVED` |
| `APPROVED` | `ASSIGNED` | Organizer | Shift confirmed | Create `volunteer_assignments` record, notify student |
| `ASSIGNED` | `CHECKED_IN` | Organizer / Lead | Volunteer reports for shift | Record check-in timestamp |
| `CHECKED_IN` | `COMPLETED` | Organizer | Volunteer completes shift hours | Write verified volunteer record to Student Event Passport |
| `ASSIGNED` | `CANCELLED` | Student / Organizer| Cancelled before shift start | Release shift capacity, notify organizer |

---

## 8. Waitlist State Machine

| From | To | Actor | Guard | Side-Effect |
| :--- | :--- | :--- | :--- | :--- |
| `[Initial]` | `QUEUED` | Student | Event capacity full, user not already registered/queued | Add to `waitlist_entries` with deterministic sequence order |
| `QUEUED` | `OFFERED` | System Worker | A seat is released; candidate is next in deterministic queue | Set `offer_expires_at = NOW() + window`, send urgent offer notice |
| `OFFERED` | `CLAIMED` | Student | Claim attempted before `offer_expires_at` | Transition to booking flow with guaranteed seat reservation |
| `OFFERED` | `EXPIRED` | System Worker | Current time > `offer_expires_at` without claim | Invalidate offer, promote next student in deterministic queue |
| `QUEUED` | `LEFT` | Student | Student withdraws from waitlist | Remove from active queue |

---

## 9. Offline Operation State Machine

| From | To | Actor | Guard | Side-Effect |
| :--- | :--- | :--- | :--- | :--- |
| `[Initial]` | `RECORDED_OFFLINE` | Check-in Staff | Device has valid downloaded manifest snapshot | Save encrypted scan event to local storage with local timestamp |
| `RECORDED_OFFLINE` | `SYNC_PENDING` | Check-in Device | Network connectivity re-established | Package scans into batch, send to `/events/:id/check-in/sync-batch` |
| `SYNC_PENDING` | `SYNCED` | Server | Valid ticket, not checked-in on server, event matches | Update server ticket to `CHECKED_IN`, return success outcome |
| `SYNC_PENDING` | `CONFLICT` | Server | Ticket already scanned on another device | Flag conflict in `scan_conflicts`, require staff manual review |
| `SYNC_PENDING` | `REJECTED` | Server | Ticket revoked, invalid hash, or wrong event | Return structured error code, preserve audit entry |
