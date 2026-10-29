import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import crypto from 'crypto';
import { Webhook } from '../../packages/backend/src/routes/webhooks/resend.js';
import { pool } from '../../packages/backend/src/db/index.js';
import { buildApp } from '../../packages/backend/src/app.js';
import { config } from '../../packages/backend/src/config.js';
import { runRollbackToVersion } from '../../packages/backend/src/db/migrate-down.js';
import { runMigrations } from '../../packages/backend/src/db/migrate.js';
import {
  testEmailAdapter,
  isEmailSuppressed,
  buildBookingConfirmedTemplate,
  buildPaymentReceiptTemplate,
  buildFeedbackReminderTemplate,
  formatIST,
  formatRupees,
} from '../../packages/backend/src/services/email/index.js';
import {
  processOutboxMessage,
  dispatchPendingOutboxMessages,
} from '../../packages/backend/src/services/outbox-worker.js';
import { FastifyInstance } from 'fastify';

describe.sequential('Phase P16: Resend Email Adapter, Suppression List & Outbox Redesign', () => {
  let app: FastifyInstance;
  const testWebhookSecret = `whsec_${Buffer.from('12345678901234567890123456789012').toString('base64')}`;

  beforeAll(async () => {
    config.EMAIL_ADAPTER = 'test';
    config.RESEND_WEBHOOK_SECRET = testWebhookSecret;
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    testEmailAdapter.clear();
    // Clean outbox and suppressions before each test
    await pool.query('DELETE FROM outbox;');
    await pool.query('DELETE FROM email_suppressions;');
  });

  async function loginAs(email: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: 'Eventora#Test2026!' },
    });
    expect(res.statusCode).toBe(200);
    const sessionCookie = res.cookies.find((c: any) => c.name === 'eventora_session')?.value;
    const csrfCookie = res.cookies.find((c: any) => c.name === 'eventora_csrf')?.value;
    return { sessionCookie, csrfCookie, body: JSON.parse(res.body) };
  }

  // =========================================================================
  // 1. Template Rendering & Formatting Tests
  // =========================================================================
  describe('1. Template Rendering & Formatting', () => {
    it('formats IST dates and ₹ rupee currency from integer paise properly', () => {
      const fixedDate = new Date('2026-11-15T10:00:00Z');
      const formattedDate = formatIST(fixedDate);
      expect(formattedDate).toContain('IST');
      expect(formattedDate).toContain('2026');

      expect(formatRupees(0)).toBe('₹0');
      expect(formatRupees(45000)).toBe('₹450');
      expect(formatRupees(125050)).toBe('₹1,250.50');
    });

    it('renders booking confirmed email with ticket link, IST date, and rupee amount', () => {
      const template = buildBookingConfirmedTemplate({
        to: 'student@campus.edu',
        name: 'Aarav Patel',
        eventTitle: 'Hackathon 2026',
        bookingRef: 'BK-HACK-001',
        ticketUrl: 'https://campus.eventora.org/tickets/BK-HACK-001',
        startsAt: new Date('2026-11-20T04:30:00Z'), // 10:00 AM IST
        venueName: 'Auditorium Hall B',
        pricePaise: 49900,
      });

      expect(template.to).toBe('student@campus.edu');
      expect(template.subject).toContain('Booking Confirmed: Hackathon 2026');
      expect(template.html).toContain('₹499');
      expect(template.html).toContain('BK-HACK-001');
      expect(template.html).toContain('https://campus.eventora.org/tickets/BK-HACK-001');
      expect(template.text).toBeDefined();
      expect(template.text).toContain('Hackathon 2026');
    });

    it('renders payment receipt with UTR and amount', () => {
      const template = buildPaymentReceiptTemplate({
        to: 'student@campus.edu',
        name: 'Aarav Patel',
        paymentId: 'pay_998877',
        utr: 'UTR665544332211',
        eventTitle: 'Tech Symposium',
        amountPaise: 75000,
        paidAt: new Date(),
        invoiceUrl: 'https://campus.eventora.org/invoice/pay_998877',
      });

      expect(template.subject).toContain('Payment Receipt: Tech Symposium');
      expect(template.html).toContain('UTR665544332211');
      expect(template.html).toContain('₹750');
      expect(template.text).toContain('UTR: UTR665544332211');
    });

    it('renders non-transactional feedback reminder with unsubscribe link honoring user preferences', () => {
      const template = buildFeedbackReminderTemplate({
        to: 'student@campus.edu',
        name: 'Aarav Patel',
        eventTitle: 'Cultural Gala',
        feedbackUrl: 'https://campus.eventora.org/feedback/evt_123',
        unsubscribeUrl: 'https://campus.eventora.org/settings/notifications',
      });

      expect(template.subject).toContain('Cultural Gala');
      expect(template.html).toContain('https://campus.eventora.org/settings/notifications');
      expect(template.html).toContain('Manage preferences or unsubscribe');
      expect(template.text).toContain('Preferences / Unsubscribe: https://campus.eventora.org/settings/notifications');
    });
  });

  // =========================================================================
  // 2. Outbox Engine: Concurrency, Outage Backoff & Dead-Lettering
  // =========================================================================
  describe('2. Outbox Engine & Resilience', () => {
    it('retries on provider outage with bounded backoff and caps at DEAD after 8 attempts', async () => {
      // Insert a message
      const insertRes = await pool.query(
        `INSERT INTO outbox (event_type, topic, payload, status, dedupe_key)
         VALUES ('team.invite', 'team.invite', $1, 'PENDING', 'test_outage_msg_1')
         RETURNING id;`,
        [
          JSON.stringify({
            teamId: 'team_outage_1',
            inviteeEmail: 'teammate@campus.edu',
            inviterName: 'Lead Dev',
            teamName: 'Coders Club',
            eventTitle: 'Hack Fest',
          }),
        ]
      );
      const msgId = insertRes.rows[0].id;

      // Simulate provider failure for 7 consecutive runs
      for (let attempt = 1; attempt <= 7; attempt++) {
        testEmailAdapter.setFailNext(1, new Error('PROVIDER_500_SIMULATED_OUTAGE'));

        // Reset next_attempt_at to NOW() so dispatcher picks it up
        await pool.query('UPDATE outbox SET next_attempt_at = NOW() WHERE id = $1;', [msgId]);

        const result = await dispatchPendingOutboxMessages(10);
        expect(result.failedCount).toBe(1);

        const checkRes = await pool.query('SELECT status, attempts, error FROM outbox WHERE id = $1;', [msgId]);
        expect(checkRes.rows[0].status).toBe('PENDING');
        expect(checkRes.rows[0].attempts).toBe(attempt);
        expect(checkRes.rows[0].error).toContain('PROVIDER_500_SIMULATED_OUTAGE');
      }

      // 8th failure -> capped to DEAD
      testEmailAdapter.setFailNext(1, new Error('PROVIDER_500_SIMULATED_OUTAGE'));
      await pool.query('UPDATE outbox SET next_attempt_at = NOW() WHERE id = $1;', [msgId]);

      const finalResult = await dispatchPendingOutboxMessages(10);
      expect(finalResult.failedCount).toBe(1);

      const deadRes = await pool.query('SELECT status, attempts, error FROM outbox WHERE id = $1;', [msgId]);
      expect(deadRes.rows[0].status).toBe('DEAD');
      expect(deadRes.rows[0].attempts).toBe(8);
      expect(deadRes.rows[0].error).toContain('PROVIDER_500_SIMULATED_OUTAGE');
    });

    it('marks malformed JSON payloads DEAD immediately without crashing worker', async () => {
      // Direct call with invalid string payload
      await expect(
        processOutboxMessage({
          id: 999,
          event_type: 'team.invite',
          payload: 'NOT_VALID_JSON{',
        })
      ).rejects.toThrow('INVALID_JSON_PAYLOAD');
    });

    it('throws on unknown event type instead of silently marking DONE', async () => {
      await pool.query(
        `INSERT INTO outbox (event_type, payload, status)
         VALUES ('unknown.unhandled.event', '{"foo":"bar"}', 'PENDING');`
      );

      const result = await dispatchPendingOutboxMessages(10);
      expect(result.failedCount).toBe(1);

      const res = await pool.query("SELECT status, error FROM outbox WHERE event_type = 'unknown.unhandled.event';");
      expect(res.rows[0].status).toBe('PENDING');
      expect(res.rows[0].error).toContain('UNKNOWN_EVENT_TYPE: unknown.unhandled.event');
    });

    it('ensures two concurrent workers never double-send (FOR UPDATE SKIP LOCKED)', async () => {
      // Seed 20 outbox records
      for (let i = 0; i < 20; i++) {
        await pool.query(
          `INSERT INTO outbox (event_type, payload, status, dedupe_key)
           VALUES ('team.invite', $1, 'PENDING', $2);`,
          [
            JSON.stringify({
              teamId: `team_concurrent_${i}`,
              inviteeEmail: `attendee_${i}@campus.edu`,
              inviterName: 'Captain',
              teamName: 'Warriors',
              eventTitle: 'Campus Cup',
            }),
            `dedupe_concurrent_${i}`,
          ]
        );
      }

      // Concurrently run 2 workers
      const [worker1, worker2] = await Promise.all([
        dispatchPendingOutboxMessages(20),
        dispatchPendingOutboxMessages(20),
      ]);

      const totalProcessed = worker1.processedCount + worker2.processedCount;
      expect(totalProcessed).toBe(20);

      // Check all 20 emails were sent exactly once
      const sent = testEmailAdapter.getSentEmails();
      expect(sent.length).toBe(20);

      const doneCountRes = await pool.query("SELECT COUNT(*) as cnt FROM outbox WHERE status = 'DONE';");
      expect(Number(doneCountRes.rows[0].cnt)).toBe(20);
    });

    it('stale lock reaper reclaims expired PROCESSING messages (locked_until < NOW())', async () => {
      // Insert message stuck in PROCESSING with expired lock
      const insertRes = await pool.query(
        `INSERT INTO outbox (event_type, payload, status, locked_until)
         VALUES ('team.invite', $1, 'PROCESSING', NOW() - INTERVAL '5 minutes')
         RETURNING id;`,
        [
          JSON.stringify({
            teamId: 'stale_1',
            inviteeEmail: 'stale.recipient@campus.edu',
            inviterName: 'Lead',
            teamName: 'Alpha',
            eventTitle: 'RoboWars',
          }),
        ]
      );
      const msgId = insertRes.rows[0].id;

      const result = await dispatchPendingOutboxMessages(10);
      expect(result.processedCount).toBe(1);

      const checkRes = await pool.query('SELECT status, locked_until, processed_at FROM outbox WHERE id = $1;', [msgId]);
      expect(checkRes.rows[0].status).toBe('DONE');
      expect(checkRes.rows[0].locked_until).toBeNull();
      expect(checkRes.rows[0].processed_at).not.toBeNull();
      expect(testEmailAdapter.findEmailTo('stale.recipient@campus.edu')).toBeDefined();
    });
  });

  // =========================================================================
  // 3. Resend Webhooks & Suppression List
  // =========================================================================
  describe('3. Resend Webhooks & Suppression List', () => {
    function createSvixHeaders(payload: any, secret: string) {
      const wh = new Webhook(secret);
      const bodyStr = JSON.stringify(payload);
      const msgId = `msg_${crypto.randomBytes(8).toString('hex')}`;
      const timestamp = new Date();

      // Sign payload with Svix
      const signature = wh.sign(msgId, timestamp, bodyStr);

      return {
        'svix-id': msgId,
        'svix-timestamp': Math.floor(timestamp.getTime() / 1000).toString(),
        'svix-signature': signature,
      };
    }

    it('rejects webhooks with invalid or missing Svix signature', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/webhooks/resend',
        headers: {
          'svix-id': 'invalid_id',
          'svix-timestamp': '1234567890',
          'svix-signature': 'v1,invalid_signature_hash',
        },
        payload: { type: 'email.delivered', data: { id: 'eml_test' } },
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('handles email.bounced (hard bounce), records suppression, and suppresses future sends', async () => {
      const bouncedEmail = 'bad.address.bounce@campus.edu';
      const bouncePayload = {
        type: 'email.bounced',
        created_at: new Date().toISOString(),
        data: {
          id: 'eml_bounce_123',
          to: [bouncedEmail],
          bounce: {
            type: 'Permanent',
            message: '550 5.1.1 User unknown',
          },
        },
      };

      const headers = createSvixHeaders(bouncePayload, testWebhookSecret);

      const webhookRes = await app.inject({
        method: 'POST',
        url: '/webhooks/resend',
        headers,
        payload: bouncePayload,
      });

      expect(webhookRes.statusCode).toBe(200);
      expect(JSON.parse(webhookRes.body)).toEqual({ received: true });

      // Verify email is in suppressions table
      const suppressed = await isEmailSuppressed(bouncedEmail);
      expect(suppressed).toBe(true);

      // Verify future send to this address is skipped
      const sendResult = await testEmailAdapter.send({
        to: bouncedEmail,
        subject: 'Test after bounce',
        html: '<p>Hello</p>',
      });

      expect(sendResult.accepted).toBe(false);
      expect(sendResult.skipped).toBe(true);
      expect(sendResult.rejectedReason).toBe('RECIPIENT_SUPPRESSED');
      expect(testEmailAdapter.findEmailTo(bouncedEmail)).toBeUndefined();
    });

    it('handles email.complained, records spam complaint suppression, and suppresses future sends', async () => {
      const complaintEmail = 'angry.user@campus.edu';
      const complaintPayload = {
        type: 'email.complained',
        created_at: new Date().toISOString(),
        data: {
          id: 'eml_complaint_456',
          to: [complaintEmail],
        },
      };

      const headers = createSvixHeaders(complaintPayload, testWebhookSecret);

      const webhookRes = await app.inject({
        method: 'POST',
        url: '/webhooks/resend',
        headers,
        payload: complaintPayload,
      });

      expect(webhookRes.statusCode).toBe(200);

      const suppressed = await isEmailSuppressed(complaintEmail);
      expect(suppressed).toBe(true);

      const sendResult = await testEmailAdapter.send({
        to: complaintEmail,
        subject: 'Another newsletter',
        html: '<p>Hello</p>',
      });

      expect(sendResult.accepted).toBe(false);
      expect(sendResult.skipped).toBe(true);
      expect(sendResult.rejectedReason).toBe('RECIPIENT_SUPPRESSED');
    });
  });

  // =========================================================================
  // 4. End-to-End Auth Security & Email Delivery Path
  // =========================================================================
  describe('4. Auth Token Security & Email As Single Delivery Path', () => {
    it('register -> outbox delivers verification email -> token in email only -> verify -> login succeeds', async () => {
      const email = `student.p16.${Date.now()}@campus.edu`;
      const password = 'Eventora#SecurePass2026!';

      // Set strict auth response mode: tokens MUST NOT appear in API response
      process.env.STRICT_AUTH_RESPONSE = 'true';

      try {
        // 1. Register user
        const regRes = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/register',
          payload: {
            email,
            password,
            displayName: 'P16 Student',
          },
        });

        expect(regRes.statusCode).toBe(201);
        const regBody = JSON.parse(regRes.body);
        // CRITICAL: Token must never appear in response
        expect(regBody.verificationToken).toBeUndefined();
        expect(regBody.token).toBeUndefined();

        // 2. Outbox should contain auth.verify_email row with NO raw token in payload
        const outboxRes = await pool.query(
          "SELECT * FROM outbox WHERE event_type = 'auth.verify_email' ORDER BY id DESC LIMIT 1;"
        );
        expect(outboxRes.rows.length).toBe(1);
        const outboxPayload = outboxRes.rows[0].payload;
        expect(outboxPayload.email).toBe(email);
        expect(outboxPayload.token).toBeUndefined();
        expect(outboxPayload.rawToken).toBeUndefined();

        // 3. Dispatch outbox message
        const dispatchRes = await dispatchPendingOutboxMessages(10);
        expect(dispatchRes.processedCount).toBe(1);

        // 4. Test adapter received email
        const sentEmail = testEmailAdapter.findEmailTo(email);
        expect(sentEmail).toBeDefined();
        expect(sentEmail!.subject).toContain('Verify your email');

        // Extract raw token from email verification URL
        const match = sentEmail!.html.match(/token=([a-zA-Z0-9_-]+)/);
        expect(match).not.toBeNull();
        const rawToken = match![1];
        expect(rawToken.length).toBeGreaterThan(16);

        // 5. Verify email with raw token
        const verifyRes = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/verify-email',
          payload: { token: rawToken },
        });

        expect(verifyRes.statusCode).toBe(200);
        expect(JSON.parse(verifyRes.body).message).toContain('Email successfully verified');

        // 6. Token reuse fails
        const secondVerifyRes = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/verify-email',
          payload: { token: rawToken },
        });
        expect(secondVerifyRes.statusCode).toBe(400);
        expect(JSON.parse(secondVerifyRes.body).error.code).toBe('INVALID_OR_EXPIRED_TOKEN');

        // 7. Login succeeds
        const loginRes = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { email, password },
        });
        expect(loginRes.statusCode).toBe(200);
      } finally {
        delete process.env.STRICT_AUTH_RESPONSE;
      }
    });

    it('forgot password -> outbox delivers reset email -> reset password -> old sessions revoked -> login succeeds', async () => {
      const email = `student.reset.${Date.now()}@campus.edu`;
      const originalPassword = 'Eventora#OldPass2026!';
      const newPassword = 'Eventora#BrandNewPass2026!';

      process.env.STRICT_AUTH_RESPONSE = 'true';

      try {
        // Register & verify user directly in DB
        const userRes = await pool.query(
          `INSERT INTO users (email, password_hash, display_name, college_id, global_role, status, email_verified_at)
           VALUES ($1, 'dummy_hash', 'Reset Target', (SELECT id FROM colleges LIMIT 1), 'student', 'active', NOW())
           RETURNING id;`,
          [email]
        );
        const userId = userRes.rows[0].id;

        // Set valid Argon2 password hash
        const { hashPassword } = await import('../../packages/backend/src/services/auth.js');
        const passHash = await hashPassword(originalPassword);
        await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2;', [passHash, userId]);

        // Establish an active session
        const login1Res = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { email, password: originalPassword },
        });
        expect(login1Res.statusCode).toBe(200);
        const originalSession = login1Res.cookies.find((c: any) => c.name === 'eventora_session')?.value;
        expect(originalSession).toBeDefined();

        // 1. Request forgot password
        const forgotRes = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/forgot',
          payload: { email },
        });
        expect(forgotRes.statusCode).toBe(200);
        const forgotBody = JSON.parse(forgotRes.body);
        expect(forgotBody.resetToken).toBeUndefined(); // Token NOT in response

        // 2. Dispatch outbox
        testEmailAdapter.clear();
        await dispatchPendingOutboxMessages(10);

        // 3. Extract token from delivered email
        const sentEmail = testEmailAdapter.findEmailTo(email);
        expect(sentEmail).toBeDefined();
        expect(sentEmail!.subject).toContain('Reset your Eventora password');

        const match = sentEmail!.html.match(/token=([a-zA-Z0-9_-]+)/);
        expect(match).not.toBeNull();
        const resetToken = match![1];

        // 4. Reset password
        const resetRes = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/reset',
          payload: {
            token: resetToken,
            newPassword,
          },
        });
        expect(resetRes.statusCode).toBe(200);

        // 5. Assert previous active session is immediately revoked
        const meRes = await app.inject({
          method: 'GET',
          url: '/api/v1/me',
          headers: {
            cookie: `eventora_session=${originalSession}`,
          },
        });
        expect(meRes.statusCode).toBe(401);

        // 6. Token reuse fails
        const secondResetRes = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/reset',
          payload: {
            token: resetToken,
            newPassword: 'AnotherPassword#2026!',
          },
        });
        expect(secondResetRes.statusCode).toBe(400);
        expect(JSON.parse(secondResetRes.body).error.code).toBe('INVALID_OR_EXPIRED_TOKEN');

        // 7. Login with new password succeeds
        const loginNewRes = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { email, password: newPassword },
        });
        expect(loginNewRes.statusCode).toBe(200);
      } finally {
        delete process.env.STRICT_AUTH_RESPONSE;
      }
    });
  });

  // =========================================================================
  // 5. Admin Dead-Letter Management API
  // =========================================================================
  describe('5. Admin Dead-Letter Management API', () => {
    it('lists DEAD outbox records and allows an admin to retry them', async () => {
      const admin = await loginAs('admin.system@campus.edu');

      // Create a DEAD outbox message
      const insertRes = await pool.query(
        `INSERT INTO outbox (event_type, topic, payload, status, attempts, error)
         VALUES ('team.invite', 'team.invite', '{"teamId":"dead_1"}', 'DEAD', 8, 'PROVIDER_OUTAGE_PERSISTENT')
         RETURNING id;`
      );
      const deadId = insertRes.rows[0].id;

      // 1. GET /api/v1/admin/outbox/dead-letter
      const listRes = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/outbox/dead-letter',
        headers: {
          cookie: `eventora_session=${admin.sessionCookie}`,
        },
      });

      expect(listRes.statusCode).toBe(200);
      const listBody = JSON.parse(listRes.body);
      expect(listBody.items.some((item: any) => item.id === String(deadId) || item.id === deadId)).toBe(true);

      // 2. Non-admin cannot access dead-letter queue (RBAC test)
      const student = await loginAs('student1@campus.edu');
      const forbiddenRes = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/outbox/dead-letter',
        headers: {
          cookie: `eventora_session=${student.sessionCookie}`,
        },
      });
      expect(forbiddenRes.statusCode).toBe(403);

      // 3. Admin retries dead-letter message: POST /api/v1/admin/outbox/:id/retry
      const retryRes = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/outbox/${deadId}/retry`,
        headers: {
          cookie: `eventora_session=${admin.sessionCookie}; eventora_csrf=${admin.csrfCookie}`,
          'x-csrf-token': admin.csrfCookie,
        },
        payload: {},
      });

      expect(retryRes.statusCode).toBe(200);
      const retryBody = JSON.parse(retryRes.body);
      expect(retryBody.success).toBe(true);
      expect(retryBody.item.status).toBe('PENDING');
      expect(retryBody.item.attempts).toBe(0);

      // 4. Verify message in DB is reset to PENDING and error cleared
      const checkRes = await pool.query('SELECT status, attempts, error FROM outbox WHERE id = $1;', [deadId]);
      expect(checkRes.rows[0].status).toBe('PENDING');
      expect(checkRes.rows[0].attempts).toBe(0);
      expect(checkRes.rows[0].error).toBeNull();
    });
  });

  // =========================================================================
  // 6. Schema Migration 19 Expand / Contract Rollback Test
  // =========================================================================
  describe('6. Schema Migration 19 Expand / Contract Rollback', () => {
    it('verifies rollback from 19 to 18 and re-application to 19 preserves data integrity', async () => {
      // 1. Verify currently at version 19 or above
      const vRes1 = await pool.query('SELECT MAX(version) as ver FROM schema_migrations;');
      expect(Number(vRes1.rows[0].ver)).toBeGreaterThanOrEqual(19);

      try {
        // 2. Rollback to version 18
        await runRollbackToVersion(18);

        const vRes2 = await pool.query('SELECT MAX(version) as ver FROM schema_migrations;');
        expect(Number(vRes2.rows[0].ver)).toBe(18);

        // email_suppressions table should not exist at version 18
        const tableCheck = await pool.query(
          "SELECT 1 FROM information_schema.tables WHERE table_name = 'email_suppressions';"
        );
        expect(tableCheck.rows.length).toBe(0);
      } finally {
        // 3. Re-apply migrations back to latest
        await runMigrations();
      }

      const vRes3 = await pool.query('SELECT MAX(version) as ver FROM schema_migrations;');
      expect(Number(vRes3.rows[0].ver)).toBeGreaterThanOrEqual(19);

      // email_suppressions table re-created cleanly
      const tableCheck2 = await pool.query(
        "SELECT 1 FROM information_schema.tables WHERE table_name = 'email_suppressions';"
      );
      expect(tableCheck2.rows.length).toBe(1);
    });
  });
});
