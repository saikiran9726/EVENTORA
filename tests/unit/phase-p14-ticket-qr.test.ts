import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { pool } from '../../packages/backend/src/db/index.js';
import { buildApp } from '../../packages/backend/src/app.js';
import {
  generateTicketCode,
  createTicketWithRetry,
  buildTicketQrPayload,
  scanTicket,
  revokeTicket,
} from '../../packages/backend/src/services/qr-ticket.js';
import { runRollbackToVersion } from '../../packages/backend/src/db/migrate-down.js';
import { runMigrations } from '../../packages/backend/src/db/migrate.js';
import { config } from '../../packages/backend/src/config.js';
import { FastifyInstance } from 'fastify';

describe('Phase P14: Ticket QR, Token Rotation & Downloads', () => {
  let app: FastifyInstance;

  let collegeId: string;
  let orgOwnerUserId: string;
  let staffUserId: string;
  let attendeeUserId: string;
  let strangerUserId: string;

  let organizerId: string;
  let eventId: string;
  let ticketTypeId: string;
  let bookingId: string;

  let attendeeHeaders: Record<string, string>;
  let staffHeaders: Record<string, string>;
  let strangerHeaders: Record<string, string>;
  let orgOwnerHeaders: Record<string, string>;

  async function createSessionForUser(userId: string): Promise<Record<string, string>> {
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const csrfToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(sessionToken).digest();

    await pool.query(
      `INSERT INTO sessions (id_hash, user_id, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '1 day');`,
      [tokenHash, userId]
    );

    return {
      cookie: `eventora_session=${sessionToken}; eventora_csrf=${csrfToken}`,
      'x-csrf-token': csrfToken,
    };
  }

  async function createUser(role: string, name: string) {
    const client = await pool.connect();
    try {
      const email = `p14.${name.toLowerCase().replace(/\s+/g, '.')}.${Date.now()}.${Math.floor(Math.random() * 100000)}@campus.edu`;
      const res = await client.query(
        `INSERT INTO users (college_id, email, password_hash, display_name, global_role, status)
         VALUES ($1, $2, 'hash', $3, $4, 'active')
         RETURNING id;`,
        [collegeId, email, name, role]
      );
      const userId = res.rows[0].id;
      const headers = await createSessionForUser(userId);
      return { userId, headers, email, name };
    } finally {
      client.release();
    }
  }

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    const client = await pool.connect();
    try {
      const cRes = await client.query('SELECT id FROM colleges LIMIT 1;');
      collegeId = cRes.rows[0].id;

      // Users
      const orgOwner = await createUser('student', 'P14 Club President');
      orgOwnerUserId = orgOwner.userId;
      orgOwnerHeaders = orgOwner.headers;

      const staff = await createUser('student', 'P14 Gate Scanner Staff');
      staffUserId = staff.userId;
      staffHeaders = staff.headers;

      const attendee = await createUser('student', 'P14 Ticket Holder');
      attendeeUserId = attendee.userId;
      attendeeHeaders = attendee.headers;

      const stranger = await createUser('student', 'P14 Unrelated Stranger');
      strangerUserId = stranger.userId;
      strangerHeaders = stranger.headers;
      expect(strangerUserId).toBeDefined();

      // Organizer Profile & Membership
      const orgRes = await client.query(
        `INSERT INTO organizer_profiles (college_id, display_name, status, created_by)
         VALUES ($1, 'P14 Technical Society', 'verified', $2)
         RETURNING id;`,
        [collegeId, orgOwnerUserId]
      );
      organizerId = orgRes.rows[0].id;

      await client.query(
        `INSERT INTO organizer_members (organizer_id, user_id, role, status)
         VALUES ($1, $2, 'owner', 'active');`,
        [organizerId, orgOwnerUserId]
      );

      // Event
      const slug = `p14-symposium-${Date.now()}`;
      const evRes = await client.query(
        `INSERT INTO events (
           college_id, organizer_id, title, slug, description, category,
           format, starts_at, ends_at, capacity, pricing_type, status, contact_email, created_by
         ) VALUES (
           $1, $2, 'P14 Quantum Computing Conference', $3, 'Annual Tech Event', 'technology',
           'in_person', NOW() + INTERVAL '5 days', NOW() + INTERVAL '6 days', 200, 'free', 'published', 'contact@p14.org', $4
         ) RETURNING id;`,
        [collegeId, organizerId, slug, orgOwnerUserId]
      );
      eventId = evRes.rows[0].id;

      // Assign staff to event
      await client.query(
        `INSERT INTO event_staff_assignments (event_id, user_id, capability, granted_by)
         VALUES ($1, $2, 'checkin', $3);`,
        [eventId, staffUserId, orgOwnerUserId]
      );

      // Ticket type
      const ttRes = await client.query(
        `INSERT INTO ticket_types (event_id, name, capacity, price_paise, held, sold)
         VALUES ($1, 'Delegate All-Access Pass', 200, 0, 0, 0)
         RETURNING id;`,
        [eventId]
      );
      ticketTypeId = ttRes.rows[0].id;

      // Booking
      const idemKey = `idem-p14-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      const bRes = await client.query(
        `INSERT INTO bookings (event_id, user_id, status, total_paise, idempotency_key, expires_at)
         VALUES ($1, $2, 'CONFIRMED', 0, $3, NOW() + INTERVAL '1 hour')
         RETURNING id;`,
        [eventId, attendeeUserId, idemKey]
      );
      bookingId = bRes.rows[0].id;
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    await app.close();
  });

  // 1. Ticket Codes: Longer random part & collision-safe retry
  describe('1. Ticket Code Generation & Entropy Security', () => {
    it('generates high-entropy ticket codes with format TCK-YYYY-TIME-RANDOM', () => {
      const code1 = generateTicketCode();
      const code2 = generateTicketCode();

      expect(code1).not.toBe(code2);
      expect(code1).toMatch(/^TCK-\d{4}-[A-Z0-9]+-[A-F0-9]{12}$/);
      expect(code2).toMatch(/^TCK-\d{4}-[A-Z0-9]+-[A-F0-9]{12}$/);
    });

    it('creates ticket with collision retry and stores raw qr_token', async () => {
      const client = await pool.connect();
      try {
        const ticket = await createTicketWithRetry(client, {
          bookingId,
          ticketTypeId,
          userId: attendeeUserId,
          eventId,
        });

        expect(ticket.id).toBeDefined();
        expect(ticket.ticket_code).toMatch(/^TCK-\d{4}-[A-Z0-9]+-[A-F0-9]{12}$/);
        expect(ticket.qr_token).toBeDefined();
        expect(ticket.qr_token.length).toBe(43); // 32 bytes base64url

        // Verify in DB
        const dbRes = await client.query('SELECT qr_token, qr_token_hash FROM tickets WHERE id = $1;', [ticket.id]);
        expect(dbRes.rows[0].qr_token).toBe(ticket.qr_token);
        expect(dbRes.rows[0].qr_token_hash).toBeDefined();
      } finally {
        client.release();
      }
    });
  });

  // 2. QR Payload Host & HMAC Security
  describe('2. QR Encoding Security: Host Isolation & HMAC-Signed Compact Payload', () => {
    it('strictly binds QR payload to config.APP_HOST and ignores spoofed Host headers', async () => {
      const client = await pool.connect();
      let ticketId: string;
      try {
        const ticket = await createTicketWithRetry(client, {
          bookingId,
          ticketTypeId,
          userId: attendeeUserId,
          eventId,
        });
        ticketId = ticket.id;
      } finally {
        client.release();
      }

      // Attacker sends spoofed Host header
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/tickets/${ticketId}/qr.svg`,
        headers: {
          ...attendeeHeaders,
          host: 'attacker-poisoned-host.evil.com',
          'x-forwarded-host': 'attacker-poisoned-host.evil.com',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('image/svg+xml');

      // The SVG must not contain the attacker's host
      expect(res.body).not.toContain('attacker-poisoned-host.evil.com');

      // The QR payload generated by the service strictly uses config.APP_HOST
      const dbTicket = await pool.query('SELECT qr_token, ticket_code FROM tickets WHERE id = $1;', [ticketId]);
      const payload = buildTicketQrPayload(ticketId, dbTicket.rows[0].qr_token, dbTicket.rows[0].ticket_code);
      const expectedHost = config.APP_HOST || 'campus.eventora.org';
      expect(payload).toContain(`https://${expectedHost}/t/`);
      expect(payload).not.toContain('attacker-poisoned-host.evil.com');
    });
  });

  // 3. Authorization & IDOR Security on GET /tickets/:id/qr.svg
  describe('3. Route Authorization: Owner & Assigned Staff Access (IDOR Defense)', () => {
    let testTicketId: string;
    let testTicketCode: string;

    beforeAll(async () => {
      const client = await pool.connect();
      try {
        const ticket = await createTicketWithRetry(client, {
          bookingId,
          ticketTypeId,
          userId: attendeeUserId,
          eventId,
        });
        testTicketId = ticket.id;
        testTicketCode = ticket.ticket_code;
      } finally {
        client.release();
      }
    });

    it('allows ticket owner to fetch QR svg (200 OK)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/tickets/${testTicketId}/qr.svg`,
        headers: attendeeHeaders,
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('image/svg+xml');
      expect(res.body).toContain('<svg');
      expect(res.body).toContain(testTicketCode);
    });

    it('allows assigned check-in staff to fetch attendee QR svg (200 OK)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/tickets/${testTicketId}/qr.svg`,
        headers: staffHeaders,
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('image/svg+xml');
      expect(res.body).toContain('<svg');
    });

    it('allows event organizer owner to inspect attendee QR svg (200 OK)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/tickets/${testTicketId}/qr.svg`,
        headers: orgOwnerHeaders,
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('image/svg+xml');
    });

    it('strictly blocks unauthorized stranger student with 403 FORBIDDEN (IDOR Protection)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/tickets/${testTicketId}/qr.svg`,
        headers: strangerHeaders,
      });

      expect(res.statusCode).toBe(403);
      const data = JSON.parse(res.body);
      expect(data.error.code).toBe('FORBIDDEN');
    });

    it('rejects unauthenticated caller with 401 UNAUTHORIZED', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/tickets/${testTicketId}/qr.svg`,
      });

      expect(res.statusCode).toBe(401);
    });
  });

  // 4. Token Rotation & QR Invalidation Invariant
  describe('4. Token Rotation & Invalidation: Rotated Token Permanently Invalidates Old QR', () => {
    it('invalidates old QR code immediately when token is regenerated', async () => {
      const client = await pool.connect();
      let ticketId: string;
      let rawToken1: string;

      try {
        const ticket = await createTicketWithRetry(client, {
          bookingId,
          ticketTypeId,
          userId: attendeeUserId,
          eventId,
        });
        ticketId = ticket.id;
        rawToken1 = ticket.rawToken;
      } finally {
        client.release();
      }

      // Step A: Token 1 before rotation is VALID and accepted
      const scan1 = await scanTicket({
        tokenOrUrl: `https://${config.APP_HOST}/t/${rawToken1}`,
        eventId,
        staffId: staffUserId,
      });
      expect(scan1.outcome).toBe('ACCEPTED');

      // Reset ticket status back to VALID for testing rotation
      await pool.query("UPDATE tickets SET status = 'VALID', checked_in_at = NULL WHERE id = $1;", [ticketId]);

      // Step B: Attendee regenerates / rotates QR token
      const rotateRes = await app.inject({
        method: 'POST',
        url: `/api/v1/tickets/${ticketId}/regenerate-qr`,
        headers: attendeeHeaders,
      });

      expect(rotateRes.statusCode).toBe(200);
      const rotateData = JSON.parse(rotateRes.body);
      expect(rotateData.success).toBe(true);
      expect(rotateData.rotatedAt).toBeDefined();

      // Step C: Try scanning OLD Token 1 -> MUST BE REJECTED with INVALID!
      const scanOld = await scanTicket({
        tokenOrUrl: `https://${config.APP_HOST}/t/${rawToken1}`,
        eventId,
        staffId: staffUserId,
      });
      expect(scanOld.outcome).toBe('INVALID');

      // Step D: Extract new token from DB and scan -> MUST BE ACCEPTED!
      const dbRes = await pool.query('SELECT qr_token FROM tickets WHERE id = $1;', [ticketId]);
      const rawToken2 = dbRes.rows[0].qr_token;
      expect(rawToken2).not.toBe(rawToken1);

      const scanNew = await scanTicket({
        tokenOrUrl: `https://${config.APP_HOST}/t/${rawToken2}`,
        eventId,
        staffId: staffUserId,
      });
      expect(scanNew.outcome).toBe('ACCEPTED');
    });

    it('blocks unauthorized stranger from rotating another student token (403 FORBIDDEN)', async () => {
      const client = await pool.connect();
      let ticketId: string;
      try {
        const ticket = await createTicketWithRetry(client, {
          bookingId,
          ticketTypeId,
          userId: attendeeUserId,
          eventId,
        });
        ticketId = ticket.id;
      } finally {
        client.release();
      }

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/tickets/${ticketId}/regenerate-qr`,
        headers: strangerHeaders,
      });

      expect(res.statusCode).toBe(403);
    });
  });

  // 5. Revocation Invalidation
  describe('5. Revocation: Revoking Ticket Clears Active QR & Rejects Scans', () => {
    it('revokes ticket, clears qr_token, and blocks QR fetch with 410', async () => {
      const client = await pool.connect();
      let ticketId: string;
      let rawToken: string;
      try {
        const ticket = await createTicketWithRetry(client, {
          bookingId,
          ticketTypeId,
          userId: attendeeUserId,
          eventId,
        });
        ticketId = ticket.id;
        rawToken = ticket.rawToken;
      } finally {
        client.release();
      }

      // Organizer revokes ticket
      const revokeResult = await revokeTicket({
        ticketId,
        actorId: orgOwnerUserId,
        reason: 'Student requested pass cancellation',
      });
      expect(revokeResult.status).toBe('REVOKED');

      // DB check: qr_token cleared
      const checkRes = await pool.query('SELECT qr_token, status FROM tickets WHERE id = $1;', [ticketId]);
      expect(checkRes.rows[0].status).toBe('REVOKED');
      expect(checkRes.rows[0].qr_token).toBeNull();

      // QR SVG fetch returns 410 TICKET_REVOKED
      const qrRes = await app.inject({
        method: 'GET',
        url: `/api/v1/tickets/${ticketId}/qr.svg`,
        headers: attendeeHeaders,
      });
      expect(qrRes.statusCode).toBe(410);

      // Scanner scan returns outcome REVOKED
      const scanRes = await scanTicket({
        tokenOrUrl: rawToken,
        eventId,
        staffId: staffUserId,
      });
      expect(scanRes.outcome).toBe('REVOKED');
    });
  });

  // 6. Download Endpoints (PDF & PNG)
  describe('6. Ticket Downloads: PDF Pass & PNG Export', () => {
    let testTicketId: string;

    beforeAll(async () => {
      const client = await pool.connect();
      try {
        const ticket = await createTicketWithRetry(client, {
          bookingId,
          ticketTypeId,
          userId: attendeeUserId,
          eventId,
        });
        testTicketId = ticket.id;
      } finally {
        client.release();
      }
    });

    it('generates valid PDF pass download with application/pdf and %PDF header', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/tickets/${testTicketId}/download?format=pdf`,
        headers: attendeeHeaders,
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toContain('.pdf');

      const bodyBuffer = Buffer.from(res.rawPayload);
      expect(bodyBuffer.slice(0, 4).toString('ascii')).toBe('%PDF');
      expect(bodyBuffer.length).toBeGreaterThan(500);
    });

    it('generates valid PNG QR download with image/png and PNG magic bytes', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/tickets/${testTicketId}/download?format=png`,
        headers: attendeeHeaders,
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
      expect(res.headers['content-disposition']).toContain('.png');

      const bodyBuffer = Buffer.from(res.rawPayload);
      // PNG magic number: 0x89 'P' 'N' 'G'
      expect(bodyBuffer[0]).toBe(0x89);
      expect(bodyBuffer[1]).toBe(0x50);
      expect(bodyBuffer[2]).toBe(0x4e);
      expect(bodyBuffer[3]).toBe(0x47);
      expect(bodyBuffer.length).toBeGreaterThan(300);
    });

    it('blocks unauthorized stranger from downloading another student pass (403 FORBIDDEN)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/tickets/${testTicketId}/download?format=pdf`,
        headers: strangerHeaders,
      });

      expect(res.statusCode).toBe(403);
    });
  });

  // 7. Migration 18 Rollback & Re-application
  describe('7. Schema Migration 18 Expand / Contract Rollback', () => {
    it('verifies rollback from 18 to 17 drops qr_token and re-running 18 restores it cleanly', async () => {
      // Rollback to 17
      await runRollbackToVersion(17);

      const client1 = await pool.connect();
      try {
        const vRes = await client1.query('SELECT MAX(version) as ver FROM schema_migrations;');
        expect(vRes.rows[0].ver).toBe(17);

        // Verify column dropped
        const colRes = await client1.query(
          `SELECT column_name FROM information_schema.columns WHERE table_name = 'tickets' AND column_name = 'qr_token';`
        );
        expect(colRes.rows.length).toBe(0);
      } finally {
        client1.release();
      }

      // Re-apply migration 18
      await runMigrations();

      const client2 = await pool.connect();
      try {
        const vRes = await client2.query('SELECT MAX(version) as ver FROM schema_migrations;');
        expect(vRes.rows[0].ver).toBe(18);

        // Verify column restored
        const colRes = await client2.query(
          `SELECT column_name FROM information_schema.columns WHERE table_name = 'tickets' AND column_name = 'qr_token';`
        );
        expect(colRes.rows.length).toBe(1);
      } finally {
        client2.release();
      }
    });
  });
});
