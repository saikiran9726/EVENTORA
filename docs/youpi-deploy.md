# YouPI-PG Gateway Deployment & Operational Guide

## 1. Overview & Architecture

[YouPI-PG](https://github.com/youpi-pg/YouPI-PG) is a lightweight, self-hosted UPI payment gateway tailored for direct peer-to-peer bank settlements. In Eventora, YouPI-PG runs as an **autonomous external service** decoupled from both the Eventora backend (Render API) and frontend (Vercel SPA).

```
                      +---------------------------------------+
                      |       Attendee Web Browser            |
                      +-------------------+-------------------+
                                          |
                        Checkout Redirect | (Port 7000 HTTPS)
                                          v
+------------------+   Internal API       +---------------------+   Bank Push / SMS   +-------------------+
|                  | ------------------> |                     | <----------------- |                   |
| Eventora Backend |   (Port 6100 HTTPS) |   YouPI-PG Host     |                    | Observer Android  |
|   (Render API)   | <------------------ | (Dedicated Linux VM)|                    |  (Dedicated Phone |
|                  |   Signed Webhooks   +---------------------+                    |   with Bank SIM)  |
+------------------+  (X-Gateway-Sig-V2)            |                               +-------------------+
                                                    v
                                         +---------------------+
                                         | Persistent SQLite DB|
                                         |  (Litestream to S3) |
                                         +---------------------+
```

### Critical Constraints
1. **Direct Peer-to-Peer Settlement**: Money moves directly into the organization's or college's bank account. YouPI does **not** intermediate funds and does **not** provide an automated refund API. Refunds must be performed manually and recorded in Eventora with the bank refund UTR.
2. **Single-Slot FIFO Queue**: Because UPI transfers are validated by observing SMS or push notifications from the bank, only **one buyer can pay at any given moment** per receiving VPA (Virtual Payment Address). Each buyer receives a strict 5-minute window.
3. **Daily Transaction Limits**: To prevent banks or NPCI heuristics from flagging personal or current accounts with automated fraud blocks, YouPI-PG recommends keeping payment attempts $\le 20$ per day per receiving account. Eventora enforces this via `YOUPI_DAILY_LIMIT=20`.

---

## 2. Infrastructure & Host Requirements

> [!CAUTION]
> **Do NOT run YouPI-PG on ephemeral disks or serverless platforms (e.g., Vercel, Render free tier without persistent disks, AWS Lambda).**
> YouPI uses SQLite as its primary database. Ephemeral container restarts will erase state, drop pending order verifications, and disrupt observer phone pairing.

### Recommended Host
- **Platform**: Dedicated cloud VM (Hetzner Cloud, DigitalOcean Droplet, AWS EC2 t4g.small, Linode) or on-premise dedicated bare metal (e.g., campus mini-PC / Intel NUC).
- **Operating System**: Ubuntu 24.04 LTS or Debian 12.
- **Node.js**: **$\ge 22.13.0$ LTS** (Strictly required for built-in WebSockets and crypto primitives).
- **Storage**: Persistent SSD with ext4 filesystem, $\ge 20$ GB.
- **Network**: Static IPv4 address, HTTPS domain with valid Let's Encrypt certificates (managed via Caddy or Nginx).

---

## 3. Network Isolation & Port Configuration

YouPI-PG exposes three distinct services. They must be isolated according to the principle of least privilege:

| Port | Service | Visibility | Access Policy |
| :--- | :--- | :--- | :--- |
| **7000** | Checkout Portal | **Public (Internet)** | Attendees access this URL (`https://pay.yourdomain.org`) to scan the dynamic UPI QR code. Reverse proxied with HTTPS. |
| **6100** | Payment API | **Restricted** | Used exclusively by Eventora backend to create orders and query payment status. Whitelist Eventora egress IPs or require `X-Gateway-Secret`. |
| **6001** | Merchant Admin | **Private (Local Only)**| Configuration, observer phone pairing, and secret keys. **Never expose to the public internet**. Bind to `127.0.0.1` and access via SSH tunnel or WireGuard/Tailscale VPN. |

### Caddy Reverse Proxy Example (`/etc/caddy/Caddyfile`)

```caddy
# Public Checkout Portal
pay.yourdomain.org {
    reverse_proxy 127.0.0.1:7000
}

# Restricted Payment API
api-pay.yourdomain.org {
    # Restrict to Eventora backend IP addresses
    @allowed_clients {
        remote_ip 203.0.113.50 203.0.113.51 127.0.0.1
    }
    handle @allowed_clients {
        reverse_proxy 127.0.0.1:6100
    }
    respond "Access Denied" 403
}
```

---

## 4. Observer Phone Setup

1. **Hardware**: Dedicated Android phone (Android 10+ recommended), connected to constant AC power and stable Wi-Fi.
2. **SIM & Bank Account**: Physical SIM card receiving real-time SMS alerts from the merchant bank account, or active banking app notification channel.
3. **App Configuration**:
   - Install the YouPI Notification Listener APK.
   - Disable **Battery Optimization** (Set to "Unrestricted" so Android OS does not kill background services).
   - Enable "Allow background data" and grant Notification Access permissions.
   - Scan the pairing QR code from the private Merchant Admin console (`http://localhost:6001`).

---

## 5. Security & Secret Rotation

### Webhook Signatures
Every webhook delivery from YouPI-PG to Eventora contains:
- `X-Gateway-Signature-V2`: `HMAC-SHA256(secret, "${timestamp}.${rawBody}")`
- `X-Gateway-Timestamp`: Unix epoch milliseconds
- `X-Gateway-Delivery-Id`: Unique UUID for idempotency deduplication

Eventora enforces:
- Strict constant-time timing-safe comparison (`crypto.timingSafeEqual`).
- 2-hour timestamp freshness window to tolerate network delays and offline retries.
- Preservation of raw bytes Buffer (`app.addContentTypeParser`) without JSON re-serialization.

### Secret Rotation Procedure
1. Generate a new high-entropy secret:
   ```bash
   openssl rand -hex 32
   ```
2. Update the webhook secret in YouPI-PG admin.
3. Update `YOUPI_WEBHOOK_SECRET` in the Eventora backend environment variables.
4. Restart the Eventora backend.

---

## 6. SQLite Database Backup Strategy

YouPI-PG stores order and queue states in SQLite. Backups must be taken continuously or on an automated schedule:

### Continuous Replication with Litestream (Recommended)
Install [Litestream](https://litestream.io/) on the host to stream WAL changes directly to an S3 bucket or Cloudflare R2:

```yaml
# /etc/litestream.yml
dbs:
  - path: /opt/youpi-pg/data/youpi.sqlite
    replicas:
      - type: s3
        bucket: my-eventora-backups
        path: youpi-sqlite
        endpoint: https://s3.amazonaws.com
```

Run as a systemd service alongside YouPI-PG.

### Daily Offline Backup (Cron)
```bash
# /etc/cron.daily/backup-youpi-sqlite
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
sqlite3 /opt/youpi-pg/data/youpi.sqlite ".backup '/var/backups/youpi/youpi_${DATE}.sqlite'"
gzip /var/backups/youpi/youpi_${DATE}.sqlite
find /var/backups/youpi/ -type f -mtime +14 -delete
```

---

## 7. Eventora Environment Configuration

Configure the following variables in Eventora's `.env` (Render backend):

```env
# Payment Provider Selection ('youpi' | 'sandbox' | 'free_only')
PAYMENT_PROVIDER=youpi

# YouPI-PG Host URLs
YOUPI_API_BASE_URL=https://api-pay.yourdomain.org
YOUPI_CHECKOUT_BASE_URL=https://pay.yourdomain.org

# Gateway Webhook Verification Secret
YOUPI_WEBHOOK_SECRET=your_high_entropy_webhook_secret_here

# Daily Payment Rate Limiting
YOUPI_DAILY_LIMIT=20

# Optional API Token if configured on YouPI-PG API reverse proxy
YOUPI_API_KEY=your_optional_bearer_token

# Test simulator lockdown (Must remain false in production)
ENABLE_TEST_SIMULATOR=false
```

---

## 8. Operational Runbook

### Issue: Payment Stuck in `VERIFICATION_QUEUE`
- **Symptom**: Webhook received with status `SUCCESS` but amount mismatch, duplicate UTR, or status API disagreement.
- **Action**:
  1. Organizer or Admin opens `/organizer/payments/verification-queue`.
  2. Inspect the raw webhook payload and bank account statement.
  3. If payment was genuinely settled, select **APPROVE** with audit notes. The seats will be converted from held to sold and tickets issued immediately.
  4. If payment was fraudulent or invalid, select **REJECT**. Seat holds will be released back to the event inventory.

### Issue: Daily Limit Reached (`DAILY_LIMIT_EXCEEDED`)
- **Symptom**: New attendees receive a notice that the daily UPI limit has been reached for the account.
- **Action**:
  - The limit resets automatically at 00:00 UTC daily.
  - An administrator can override the daily limit by updating `YOUPI_DAILY_LIMIT` or passing `adminOverride: true` in emergency situations.
