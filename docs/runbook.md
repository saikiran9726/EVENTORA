# Eventora Operations Runbook & Incident Playbook

This runbook defines critical procedures, operational levers, circuit breakers, credential rotation schedules, and incident response protocols for the Eventora Smart Campus Platform.

---

## 1. Circuit Breakers & Kill Switches

### 1.1 Disable a Payment Provider
In the event of webhook failure, provider degradation, or simulator anomalies:
1. **Immediate API Lever:**
   Set environment variable:
   ```env
   PAYMENT_ADAPTER=simulator # Fall back to local simulator
   ```
   Or in database:
   ```sql
   UPDATE system_settings SET value = '{"disabled": true}' WHERE key = 'payment_gateway_status';
   ```
2. **Reload API containers:**
   ```bash
   docker-compose -f docker-compose.prod-like.yml restart api
   ```
3. **Verify:** Check `GET /health` and `POST /bookings/:id/checkout` (returns fallback simulated invoice).

### 1.2 Waitlist Promotion Kill Switch
To halt automatic waitlist promotions during ticket capacity adjustments or venue changes:
```sql
-- Disable automatic promotion worker across all active events
UPDATE outbox SET status = 'DEAD' WHERE topic = 'waitlist.promotion' AND status = 'PENDING';

-- Pause waitlist background processor
INSERT INTO ops_runs (kind, started_at, outcome, evidence_ref)
VALUES ('kill_switch', NOW(), 'SUCCESS', '{"target": "waitlist_promotion", "status": "PAUSED"}');
```

---

## 2. Credential Rotation Procedures

### 2.1 Database Password Rotation
1. Create new password hash on Postgres instance:
   ```sql
   ALTER USER app_rw WITH PASSWORD 'NewCryptographicallySecurePassword2026!';
   ```
2. Update PgBouncer user list `userlist.txt`.
3. Reload PgBouncer without dropping active sessions:
   ```bash
   kill -HUP $(pidof pgbouncer)
   ```
4. Update `DATABASE_URL` in container environment and perform rolling restart of API pods.

### 2.2 JWT & Session Secret Zero-Downtime Rotation
The platform supports dual-key rotation:
- `JWT_SECRET_CURRENT`: Primary key for signing new tokens.
- `JWT_SECRET_PREVIOUS`: Verification fallback for active unexpired sessions.
Rotate annually or immediately upon suspected credential exposure.

---

## 3. Incident Management Template

### Incident Classification

| Severity | Definition | Target Response (MTTD) | Target Mitigation (MTTR) |
| :--- | :--- | :--- | :--- |
| **SEV-1 (Critical)** | Core outage: Check-in offline, payment failure, platform unavailable | < 5 minutes | < 30 minutes |
| **SEV-2 (High)** | Degradation: Notifications delayed, reports slow, non-blocking bug | < 15 minutes | < 2 hours |
| **SEV-3 (Medium)** | Minor issue: Export formatting, individual user error | < 1 hour | < 1 business day |
| **SEV-4 (Low)** | Cosmetic or documentation discrepancy | < 1 business day | Next sprint |

### Incident Incident Timeline Template
```markdown
# Incident Report: [INC-YEAR-NUMBER] - [Brief Title]

**Date & Time (UTC):** YYYY-MM-DD HH:MM  
**Severity:** SEV-1 | SEV-2 | SEV-3  
**Incident Commander:** [Name]  
**Lead Engineer:** [Name]  
**User Communications Lead:** [Name]  

## 1. Summary of Impact
- Total impacted students/organizers: 
- Affected services: [Checkin / Bookings / Discovery]
- Revenue / Registration impact: 0 oversells (guaranteed by atomic locks)

## 2. Incident Timeline
- **10:00 UTC** - Anomaly detected via alert / metrics spike.
- **10:05 UTC** - Incident declared; war room opened.
- **10:15 UTC** - Root cause isolated (e.g. database pool saturation).
- **10:22 UTC** - Mitigation applied (e.g. PgBouncer pool expanded).
- **10:30 UTC** - Recovery verified; all health checks green.

## 3. Root Cause Analysis (5 Whys)
1. Why did ... happen?
2. Why was that not caught by tests?
3. ...

## 4. Corrective & Preventative Actions
- [ ] Add Prometheus alert threshold on DB pool waiting count > 5.
- [ ] Update k6 load test script to simulate peak burst scenario.
```

---

## 4. User Communications Ownership

- **Lead Communications Owner:** Dean of Student Affairs IT Liaison / Head of Campus Communications.
- **Channels:** In-app Notification Broadcast, Campus SMS Broadcast, Student Portal Banner.
- **Approved Status Update Templates:**
  - *Outage Announcement:* "Eventora is currently undergoing scheduled emergency database maintenance. Offline turnstile check-in remains active at all physical venue gates."
  - *Resolution Announcement:* "All campus event services have been fully restored. Verified achievement timelines and tickets have reconciled."

---

## 5. PgBouncer Sizing & Connection Math

To prevent Postgres backend connection exhaustion (`too many clients already`):
$$\text{Total Connections} = (\text{API Instances} \times \text{pool\_max}) + (\text{Worker Instances} \times \text{worker\_pool\_max})$$

Rule:
$$\text{Total Connections} \le \text{Postgres } \text{max\_connections} - \text{superuser\_reserved}$$

Production Specification:
- API Instances: 4 pods
- `pool_max`: 20 connections per pod (80 total)
- Background Worker: 1 instance (10 connections)
- Postgres `max_connections`: 100
- Reserved for admin/migrations: 10
- Total allocation: $80 + 10 = 90 \le 90$ (Guaranteed headroom).
