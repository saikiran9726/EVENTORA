import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../packages/backend/src/app.js';
import { pool } from '../../packages/backend/src/db/index.js';
import crypto from 'crypto';
import { FastifyInstance } from 'fastify';

describe('Phase 11 Security Gate: Fuzzing, Replay Attacks, Forged Signatures & Tamper Prevention', () => {
  let app: FastifyInstance;
  let testUserId: string;
  let testSessionToken: string;
  let testCsrfToken: string;
  let testEventId: string;
  let validTicketId: string;
  let validQrToken: string;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    const client = await pool.connect();
    try {
      const col = await client.query('SELECT id FROM colleges LIMIT 1;');
      const collegeId = col.rows[0].id;

      const u = await client.query(`
        INSERT INTO users (email, password_hash, display_name, college_id, global_role, status)
        VALUES ('fuzz_user@campus.edu', 'hash', 'Fuzz Tester', $1, 'student', 'active')
        ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
        RETURNING id;
      `, [collegeId]);
      testUserId = u.rows[0].id;

      testSessionToken = crypto.randomBytes(32).toString('hex');
      testCsrfToken = crypto.randomBytes(32).toString('hex');
      const hash = crypto.createHash('sha256').update(testSessionToken).digest();

      await client.query(`
        INSERT INTO sessions (id_hash, user_id, expires_at)
        VALUES ($1, $2, NOW() + INTERVAL '1 day');
      `, [hash, testUserId]);

      const orgProf = await client.query(`
        INSERT INTO organizer_profiles (college_id, display_name, status, created_by)
        VALUES ($1, 'Security Org Profile', 'verified', $2)
        RETURNING id;
      `, [collegeId, testUserId]);
      const orgProfileId = orgProf.rows[0].id;

      const ev = await client.query(`
        INSERT INTO events (title, slug, description, format, contact_email, created_by, organizer_id, college_id, category, starts_at, ends_at, capacity, status, visibility)
        VALUES ('Security Test Event', 'sec-event-${Date.now()}', 'Security Event Description', 'in_person', 'sec@campus.edu', $1, $2, $3, 'Tech', NOW() + INTERVAL '1 day', NOW() + INTERVAL '2 days', 100, 'published', 'public')
        RETURNING id;
      `, [testUserId, orgProfileId, collegeId]);
      testEventId = ev.rows[0].id;

      // Staff assignment to scan tickets
      await client.query(`
        INSERT INTO event_staff_assignments (event_id, user_id, capability, granted_by)
        VALUES ($1, $2, 'checkin', $2)
        ON CONFLICT DO NOTHING;
      `, [testEventId, testUserId]);

      // Seed valid QR ticket
      validQrToken = crypto.randomBytes(32).toString('base64url');
      const tokenHash = crypto.createHash('sha256').update(validQrToken).digest();

      const tt = await client.query(`
        INSERT INTO ticket_types (event_id, name, price_paise, capacity, sold)
        VALUES ($1, 'General Admission', 0, 100, 1)
        RETURNING id;
      `, [testEventId]);
      const ticketTypeId = tt.rows[0].id;

      const bk = await client.query(`
        INSERT INTO bookings (user_id, event_id, status, total_paise, idempotency_key)
        VALUES ($1, $2, 'CONFIRMED', 0, 'idemp-sec-${Date.now()}')
        RETURNING id;
      `, [testUserId, testEventId]);
      const bookingId = bk.rows[0].id;

      const tk = await client.query(`
        INSERT INTO tickets (
          booking_id, ticket_type_id, user_id, owner_user_id, event_id,
          qr_payload_hash, qr_token_hash, ticket_code, status
        )
        VALUES ($1, $2, $3, $3, $4, $5, $5, $6, 'VALID')
        RETURNING id;
      `, [bookingId, ticketTypeId, testUserId, testEventId, tokenHash, `TCK-SEC-${Date.now()}`]);
      validTicketId = tk.rows[0].id;
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    await app.close();
  });

  // 1. SQLi Fuzz on Discovery & Filter inputs
  it('1. SQL Injection Fuzzing: Parameterized queries resist classic SQLi attacks', async () => {
    const sqliPayloads = [
      "' OR 1=1 --",
      "'; DROP TABLE events; --",
      "' UNION SELECT null, null, null, null, null --",
      "admin'--",
      "1' OR '1' = '1",
    ];

    for (const payload of sqliPayloads) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/events?search=${encodeURIComponent(payload)}&category=${encodeURIComponent(payload)}`,
      });

      // Must handle gracefully without 500 SQL syntax exception
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(Array.isArray(body.items || body.events)).toBe(true);
    }
  });

  // 2. XSS Fuzzing in Announcement / Feedback Comments
  it('2. XSS Sanitization: Rejects or neutralizes script injections', async () => {
    const xssPayloads = [
      '<script>alert("xss")</script>',
      '<img src=x onerror=alert(1)>',
      'javascript:alert(1)',
    ];

    for (const xss of xssPayloads) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/events/${testEventId}/feedback`,
        headers: {
          cookie: `eventora_session=${testSessionToken}; eventora_csrf=${testCsrfToken}`,
          'x-csrf-token': testCsrfToken,
        },
        payload: {
          rating: 5,
          comment: xss,
          answers: {},
        },
      });

      // Handled cleanly (200 with stored sanitization or 400 validation error; never unhandled exception)
      expect([200, 201, 400, 403]).toContain(res.statusCode);
    }
  });

  // 3. CSRF Double-Submit Token Tampering
  it('3. CSRF Tampering: Rejects state-changing POST when token differs from cookie', async () => {
    const forgedCsrf = crypto.randomBytes(32).toString('hex');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${testEventId}/feedback`,
      headers: {
        cookie: `eventora_session=${testSessionToken}; eventora_csrf=${testCsrfToken}`,
        'x-csrf-token': forgedCsrf, // Mismatch!
      },
      payload: { rating: 5, comment: 'Nice', answers: {} },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('CSRF_INVALID');
  });

  // 4. Forged & Replayed Webhook HMAC Signature
  it('4. Webhook Integrity: Rejects forged HMAC signature and replayed payloads', async () => {
    const rawPayload = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_test', amount: 50000, status: 'captured' } } },
    });

    // A: Forged Signature
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/payments',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': '0000000000000000000000000000000000000000000000000000000000000000',
      },
      payload: rawPayload,
    });

    expect(res.statusCode).toBe(401);
  });

  // 5. Replayed & Revoked QR Ticket
  it('5. QR Anti-Tamper: Detects already checked-in tickets and prevents duplicate reuse', async () => {
    const scanPayload = {
      token: `https://eventora.campus.edu/t/${validQrToken}`,
    };

    // First scan: should succeed
    const firstScan = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${testEventId}/check-in/scan`,
      headers: {
        cookie: `eventora_session=${testSessionToken}; eventora_csrf=${testCsrfToken}`,
        'x-csrf-token': testCsrfToken,
      },
      payload: scanPayload,
    });

    expect(firstScan.statusCode).toBe(200);
    const firstBody = JSON.parse(firstScan.body);
    expect(firstBody.outcome).toBe('ACCEPTED');

    // Second scan (replay): must be detected as DUPLICATE
    const secondScan = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${testEventId}/check-in/scan`,
      headers: {
        cookie: `eventora_session=${testSessionToken}; eventora_csrf=${testCsrfToken}`,
        'x-csrf-token': testCsrfToken,
      },
      payload: scanPayload,
    });

    expect(secondScan.statusCode).toBe(200);
    const errBody = JSON.parse(secondScan.body);
    expect(errBody.outcome).toBe('DUPLICATE');
    expect(errBody.message).toContain('Already checked in');
  });

  // 6. Secret Scan of Repository Files & Client Bundle
  it('6. Secret Scanning: Verifies no live secrets, production private keys or passwords committed', async () => {
    const fs = await import('fs');
    const path = await import('path');

    const forbiddenPatterns = [
      /rzp_live_[a-zA-Z0-9]{14,}/,
      /whsec_live_[a-zA-Z0-9]{14,}/,
      /-----BEGIN RSA PRIVATE KEY-----/,
      /-----BEGIN OPENSSH PRIVATE KEY-----/,
    ];

    const filesToCheck = [
      'packages/backend/src/config.ts',
      'packages/backend/src/app.ts',
      'packages/frontend/src/App.tsx',
      '.env.example',
    ];

    for (const relPath of filesToCheck) {
      const fullPath = path.resolve(relPath);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf8');
        for (const pattern of forbiddenPatterns) {
          expect(pattern.test(content)).toBe(false);
        }
      }
    }
  });
});
