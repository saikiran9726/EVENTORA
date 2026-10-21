import crypto from 'crypto';
import { pool } from '../db/index.js';

// Crockford Base32 alphabet (32 characters, excludes I, L, O, U to avoid visual ambiguity)
const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export class TicketScanError extends Error {
  constructor(
    public outcome: 'INVALID' | 'WRONG_EVENT' | 'REVOKED' | 'OUTSIDE_WINDOW' | 'DUPLICATE' | 'NOT_ASSIGNED',
    message: string,
    public statusCode: number = 400,
    public details: Record<string, any> = {}
  ) {
    super(message);
    this.name = 'TicketScanError';
  }
}

// In-memory sliding window rate limiters
const scanRateLimitMap = new Map<string, number[]>(); // staffId -> timestamps[]
const verifyRateLimitMap = new Map<string, number[]>(); // ip -> timestamps[]

/**
 * Enforces scan rate limit: 120 scans/min per staff user.
 */
export function checkScanRateLimit(staffId: string): void {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const timestamps = (scanRateLimitMap.get(staffId) || []).filter((t) => now - t < windowMs);

  if (timestamps.length >= 120) {
    throw new TicketScanError('INVALID', 'Staff check-in rate limit exceeded (max 120 scans/min)', 429);
  }

  timestamps.push(now);
  scanRateLimitMap.set(staffId, timestamps);
}

/**
 * Enforces certificate verification rate limit: 30 verifies/min per IP.
 */
export function checkVerifyRateLimit(ip: string): void {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const timestamps = (verifyRateLimitMap.get(ip) || []).filter((t) => now - t < windowMs);

  if (timestamps.length >= 30) {
    throw new Error('Certificate verification rate limit exceeded (max 30 requests/min per IP)');
  }

  timestamps.push(now);
  verifyRateLimitMap.set(ip, timestamps);
}

/**
 * Generates an opaque, cryptographically secure 43-character base64url QR token.
 * Zero PII guarantee: ticket ID, user ID, roll, and email are never derivable.
 */
export function generateQrToken(host: string = 'eventora.campus.edu'): {
  token: string;
  tokenHash: Buffer;
  qrUrl: string;
} {
  const rawBytes = crypto.randomBytes(32);
  const token = rawBytes.toString('base64url'); // 43 characters
  const tokenHash = crypto.createHash('sha256').update(token).digest();
  const qrUrl = `https://${host}/t/${token}`;

  return { token, tokenHash, qrUrl };
}

/**
 * Generates a 12-character Crockford Base32 verification code formatted with hyphens.
 * e.g. 7H9K-2M4N-8PQR
 */
export function generateCrockfordCode(length: number = 12): string {
  const bytes = crypto.randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    const idx = bytes[i] % CROCKFORD_ALPHABET.length;
    result += CROCKFORD_ALPHABET[idx];
  }

  // Format into chunks of 4 characters: XXXX-XXXX-XXXX
  return `${result.substring(0, 4)}-${result.substring(4, 8)}-${result.substring(8, 12)}`;
}

/**
 * Normalizes Crockford Base32 string by removing hyphens/spaces and uppercasing.
 */
export function normalizeCrockfordCode(input: string): string {
  return input.replace(/[-\s]/g, '').toUpperCase();
}

/**
 * Computes SHA-256 cryptographic integrity hash for a certificate.
 */
export function computeCertificateHash(params: {
  userId: string;
  eventId: string;
  verificationCode: string;
  issuedAt: string;
}): Buffer {
  const canonical = `${params.userId}:${params.eventId}:${params.verificationCode}:${params.issuedAt}`;
  return crypto.createHash('sha256').update(canonical).digest();
}

/**
 * Converts a student display name into privacy-preserving initials (Zero PII leak).
 * e.g. "Aarav Sharma" -> "A. S."
 */
export function getInitials(name?: string | null): string {
  if (!name || !name.trim()) return 'Anonymous';
  const parts = name.trim().split(/\s+/);
  return parts.map((p) => `${p[0]?.toUpperCase()}.`).join(' ');
}

export interface ScanTicketParams {
  tokenOrUrl: string;
  eventId: string;
  staffId: string;
  sessionId?: string;
  deviceId?: string;
}

export interface ScanOutcomeResult {
  outcome: 'ACCEPTED' | 'DUPLICATE' | 'INVALID' | 'WRONG_EVENT' | 'REVOKED' | 'OUTSIDE_WINDOW';
  message: string;
  ticketId?: string;
  checkedInAt?: string;
  attendeeInitials?: string;
  ticketTierName?: string;
  firstScannedAt?: string;
  firstScannedBy?: string;
}

/**
 * Atomic Check-in Scanner implementation (§4B, Phase 6).
 * Scan runs a single primary UPDATE statement with RETURNING *;
 * if 0 rows returned, classifies outcome deterministically.
 */
export async function scanTicket(params: ScanTicketParams): Promise<ScanOutcomeResult> {
  const { tokenOrUrl, eventId, staffId, sessionId, deviceId } = params;

  // 1. Rate Limit Guard
  checkScanRateLimit(staffId);

  // 2. Extract 43-character token from URL or raw string
  let token = tokenOrUrl.trim();
  const urlMatch = token.match(/\/t\/([A-Za-z0-9_-]{43})/);
  if (urlMatch && urlMatch[1]) {
    token = urlMatch[1];
  }

  const qrTokenHash = crypto.createHash('sha256').update(token).digest();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 3. Optional Session Window Guard
    if (sessionId) {
      const sessRes = await client.query(
        `SELECT checkin_opens_at, checkin_closes_at FROM attendance_sessions WHERE id = $1 AND event_id = $2;`,
        [sessionId, eventId]
      );
      if (sessRes.rows.length > 0) {
        const sess = sessRes.rows[0];
        const now = new Date();
        if (now < new Date(sess.checkin_opens_at) || now > new Date(sess.checkin_closes_at)) {
          await client.query(
            `INSERT INTO scan_log (event_id, staff_id, outcome, at) VALUES ($1, $2, 'OUTSIDE_WINDOW', NOW());`,
            [eventId, staffId]
          );
          await client.query('COMMIT');
          return {
            outcome: 'OUTSIDE_WINDOW',
            message: 'Check-in window is currently closed for this session',
          };
        }
      }
    }

    // 4. Primary Atomic Single-Statement Check-In Execution
    const updateRes = await client.query(
      `UPDATE tickets
       SET status = 'CHECKED_IN',
           checked_in_at = NOW(),
           checked_in_by = $1,
           version = version + 1
       WHERE qr_token_hash = $2
         AND event_id = $3
         AND status = 'VALID'
       RETURNING id, booking_id, ticket_type_id, user_id, event_id, status, checked_in_at;`,
      [staffId, qrTokenHash, eventId]
    );

    if (updateRes.rows.length === 1) {
      // SUCCESS: Ticket marked CHECKED_IN
      const ticket = updateRes.rows[0];

      // Insert checkins record (with dedupe constraint)
      await client.query(
        `INSERT INTO checkins (ticket_id, event_id, session_id, staff_id, source, device_id, scanned_at)
         VALUES ($1, $2, $3, $4, 'online', $5, NOW())
         ON CONFLICT DO NOTHING;`,
        [ticket.id, eventId, sessionId || null, staffId, deviceId || 'scanner-pwa']
      );

      // Audit scan_log
      await client.query(
        `INSERT INTO scan_log (ticket_id, event_id, staff_id, outcome, at)
         VALUES ($1, $2, $3, 'ACCEPTED', NOW());`,
        [ticket.id, eventId, staffId]
      );

      // Fetch attendee initials & ticket tier
      const metaRes = await client.query(
        `SELECT u.display_name, tt.name as tier_name
         FROM users u
         JOIN tickets t ON t.user_id = u.id
         JOIN ticket_types tt ON t.ticket_type_id = tt.id
         WHERE t.id = $1;`,
        [ticket.id]
      );

      const attendeeName = metaRes.rows[0]?.display_name;
      const tierName = metaRes.rows[0]?.tier_name || 'Standard Admission';
      const attendeeInitials = getInitials(attendeeName);

      // Record Attendance Achievement (FR-PASS)
      try {
        await client.query(
          `INSERT INTO student_achievements (user_id, type, source_event_id, source_ref_id, verification_status, visibility)
           VALUES ($1, 'ATTENDANCE', $2, $3, 'VERIFIED', 'public')
           ON CONFLICT (type, source_ref_id) DO NOTHING;`,
          [ticket.user_id, eventId, ticket.id]
        );
      } catch {
        // Non-blocking
      }

      // Check certificate policy auto-issuance hook
      try {
        await issueCertificateIfEligibleInternal(ticket.user_id, eventId, client);
      } catch {
        // Non-blocking for scan transaction
      }

      await client.query('COMMIT');

      return {
        outcome: 'ACCEPTED',
        message: `Accepted: ${attendeeInitials} (${tierName})`,
        ticketId: ticket.id,
        checkedInAt: ticket.checked_in_at ? new Date(ticket.checked_in_at).toISOString() : new Date().toISOString(),
        attendeeInitials,
        ticketTierName: tierName,
      };
    }

    // 5. Zero rows updated -> classify outcome deterministically
    const lookupRes = await client.query(
      `SELECT t.id, t.event_id, t.status, t.checked_in_at, t.checked_in_by, u.display_name as staff_name
       FROM tickets t
       LEFT JOIN users u ON t.checked_in_by = u.id
       WHERE t.qr_token_hash = $1;`,
      [qrTokenHash]
    );

    if (lookupRes.rows.length === 0) {
      // Ticket doesn't exist
      await client.query(
        `INSERT INTO scan_log (event_id, staff_id, outcome, at) VALUES ($1, $2, 'INVALID', NOW());`,
        [eventId, staffId]
      );
      await client.query('COMMIT');
      return {
        outcome: 'INVALID',
        message: 'Invalid ticket QR token. Code not recognized.',
      };
    }

    const t = lookupRes.rows[0];

    // Wrong event check
    if (t.event_id !== eventId) {
      await client.query(
        `INSERT INTO scan_log (ticket_id, event_id, staff_id, outcome, at)
         VALUES ($1, $2, $3, 'WRONG_EVENT', NOW());`,
        [t.id, eventId, staffId]
      );
      await client.query('COMMIT');
      return {
        outcome: 'WRONG_EVENT',
        message: 'Wrong Event: This ticket is for a different campus event.',
        ticketId: t.id,
      };
    }

    // Revoked / Cancelled
    if (t.status === 'REVOKED' || t.status === 'CANCELLED') {
      await client.query(
        `INSERT INTO scan_log (ticket_id, event_id, staff_id, outcome, at)
         VALUES ($1, $2, $3, 'REVOKED', NOW());`,
        [t.id, eventId, staffId]
      );
      await client.query('COMMIT');
      return {
        outcome: 'REVOKED',
        message: 'Revoked Ticket: This registration has been cancelled or revoked.',
        ticketId: t.id,
      };
    }

    // Duplicate check-in
    if (t.status === 'CHECKED_IN') {
      // Find first check-in details
      const cRes = await client.query(
        `SELECT c.scanned_at, u.display_name as staff_name
         FROM checkins c
         LEFT JOIN users u ON c.staff_id = u.id
         WHERE c.ticket_id = $1
         ORDER BY c.scanned_at ASC
         LIMIT 1;`,
        [t.id]
      );

      const firstTime = cRes.rows[0]?.scanned_at
        ? new Date(cRes.rows[0].scanned_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
        : t.checked_in_at
        ? new Date(t.checked_in_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
        : 'earlier';
      const scannedByStaff = cRes.rows[0]?.staff_name || t.staff_name || 'Assigned Staff';

      await client.query(
        `INSERT INTO scan_log (ticket_id, event_id, staff_id, outcome, at)
         VALUES ($1, $2, $3, 'DUPLICATE', NOW());`,
        [t.id, eventId, staffId]
      );
      await client.query('COMMIT');

      return {
        outcome: 'DUPLICATE',
        message: `Already checked in at ${firstTime} by ${scannedByStaff}`,
        ticketId: t.id,
        firstScannedAt: t.checked_in_at ? new Date(t.checked_in_at).toISOString() : undefined,
        firstScannedBy: scannedByStaff,
      };
    }

    // Fallback invalid
    await client.query(
      `INSERT INTO scan_log (ticket_id, event_id, staff_id, outcome, at)
       VALUES ($1, $2, $3, 'INVALID', NOW());`,
      [t.id, eventId, staffId]
    );
    await client.query('COMMIT');

    return {
      outcome: 'INVALID',
      message: `Ticket in unexpected state: ${t.status}`,
      ticketId: t.id,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Revokes a ticket (Organizer or Admin), updating ticket status, recording audit,
 * and propagating revocation to any issued certificate.
 */
export async function revokeTicket(params: {
  ticketId: string;
  actorId: string;
  reason: string;
}) {
  const { ticketId, actorId, reason } = params;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const tRes = await client.query(
      `UPDATE tickets
       SET status = 'REVOKED',
           revoked_at = NOW(),
           revoke_reason = $1,
           version = version + 1
       WHERE id = $2
       RETURNING id, event_id, user_id, status;`,
      [reason, ticketId]
    );

    if (tRes.rows.length === 0) {
      throw new Error('Ticket not found');
    }

    const ticket = tRes.rows[0];

    // Propagate revocation to certificate if one was issued
    await client.query(
      `UPDATE certificates
       SET revoked_at = NOW(),
           revoke_reason = $1
       WHERE user_id = $2 AND event_id = $3;`,
      [reason, ticket.user_id, ticket.event_id]
    );

    // Propagate revocation to student_achievements (FR-PASS)
    await client.query(
      `UPDATE student_achievements
       SET verification_status = 'REVOKED'
       WHERE source_event_id = $1 AND user_id = $2;`,
      [ticket.event_id, ticket.user_id]
    );

    // Audit log
    await client.query(
      `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, meta)
       VALUES ($1, 'ticket:revoke', 'ticket', $2, $3);`,
      [actorId, ticketId, JSON.stringify({ reason })]
    );

    await client.query('COMMIT');
    return { success: true, ticketId, status: 'REVOKED' };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Internal helper to issue certificate if policies are satisfied.
 */
async function issueCertificateIfEligibleInternal(
  userId: string,
  eventId: string,
  client: any
) {
  // 1. Check if policy exists
  const polRes = await client.query(
    `SELECT min_sessions, requires_checkin FROM certificate_policies WHERE event_id = $1;`,
    [eventId]
  );

  // If no certificate policy configured, skip
  if (polRes.rows.length === 0) return null;

  const policy = polRes.rows[0];

  // 2. Check idempotency: if already issued, return existing
  const existingRes = await client.query(
    `SELECT id, verification_code, issued_at, revoked_at FROM certificates WHERE user_id = $1 AND event_id = $2;`,
    [userId, eventId]
  );

  if (existingRes.rows.length > 0) {
    return existingRes.rows[0];
  }

  // 3. Verify checkin requirement
  if (policy.requires_checkin) {
    const chkRes = await client.query(
      `SELECT count(*)::int as count FROM checkins WHERE event_id = $1 AND ticket_id IN (SELECT id FROM tickets WHERE user_id = $2);`,
      [eventId, userId]
    );
    if ((chkRes.rows[0]?.count || 0) < 1) {
      throw new Error('Ineligible: Attendee has not checked in to this event');
    }
  }

  // 4. Verify min_sessions requirement
  if (policy.min_sessions > 1) {
    const sessRes = await client.query(
      `SELECT count(DISTINCT session_id)::int as count FROM checkins WHERE event_id = $1 AND ticket_id IN (SELECT id FROM tickets WHERE user_id = $2) AND session_id IS NOT NULL;`,
      [eventId, userId]
    );
    if ((sessRes.rows[0]?.count || 0) < policy.min_sessions) {
      throw new Error(`Ineligible: Minimum ${policy.min_sessions} sessions required`);
    }
  }

  // 5. Generate 12-character Crockford code
  const code = generateCrockfordCode(12);
  const now = new Date().toISOString();
  const hash = computeCertificateHash({
    userId,
    eventId,
    verificationCode: code,
    issuedAt: now,
  });

  const certRes = await client.query(
    `INSERT INTO certificates (user_id, event_id, verification_code, issued_at, hash)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, event_id) DO UPDATE SET verification_code = EXCLUDED.verification_code
     RETURNING id, user_id, event_id, verification_code, issued_at;`,
    [userId, eventId, code, now, hash]
  );

  const cert = certRes.rows[0];

  // Record Certificate Achievement (FR-PASS)
  try {
    await client.query(
      `INSERT INTO student_achievements (user_id, type, source_event_id, source_ref_id, verification_status, visibility)
       VALUES ($1, 'CERTIFICATE', $2, $3, 'VERIFIED', 'public')
       ON CONFLICT (type, source_ref_id) DO NOTHING;`,
      [userId, eventId, cert.id]
    );
  } catch {
    // Non-blocking
  }

  return cert;
}

/**
 * Public export to issue certificate with standalone client transaction.
 */
export async function issueCertificateIfEligible(userId: string, eventId: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cert = await issueCertificateIfEligibleInternal(userId, eventId, client);
    await client.query('COMMIT');
    return cert;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Public certificate verification (Zero PII leak: returns only initials, event, date, validity).
 */
export async function verifyCertificateByCode(rawCode: string, ip: string) {
  // 1. Rate limit
  checkVerifyRateLimit(ip);

  // 2. Normalize code
  const normalized = normalizeCrockfordCode(rawCode);

  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT c.id, c.verification_code, c.issued_at, c.revoked_at, c.revoke_reason,
              e.title as event_title, e.starts_at as event_date,
              u.display_name as user_name
       FROM certificates c
       JOIN events e ON c.event_id = e.id
       JOIN users u ON c.user_id = u.id
       WHERE REPLACE(c.verification_code, '-', '') = $1;`,
      [normalized]
    );

    if (res.rows.length === 0) {
      return {
        found: false,
        valid: false,
        message: 'Certificate not found. The code does not match any authentic campus credential.',
      };
    }

    const cert = res.rows[0];
    const isRevoked = Boolean(cert.revoked_at);
    const attendeeInitials = getInitials(cert.user_name);

    return {
      found: true,
      valid: !isRevoked,
      status: isRevoked ? 'REVOKED' : 'VALID',
      verificationCode: cert.verification_code,
      issuedAt: cert.issued_at,
      eventTitle: cert.event_title,
      eventDate: cert.event_date,
      attendeeInitials,
      revokeReason: cert.revoke_reason || (isRevoked ? 'Certificate revoked by institution' : null),
    };
  } finally {
    client.release();
  }
}

/**
 * Retrieves tickets belonging to a specific student user.
 */
export async function getUserTickets(userId: string) {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT t.id, t.ticket_code, t.status, t.issued_at, t.checked_in_at, t.created_at,
              e.id as event_id, e.title as event_title, e.starts_at as event_starts_at, e.ends_at as event_ends_at,
              tt.name as tier_name, tt.price_paise,
              b.id as booking_id,
              v.name as venue_name
       FROM tickets t
       JOIN events e ON t.event_id = e.id
       JOIN ticket_types tt ON t.ticket_type_id = tt.id
       JOIN bookings b ON t.booking_id = b.id
       LEFT JOIN venues v ON e.venue_id = v.id
       WHERE t.user_id = $1 OR t.owner_user_id = $1
       ORDER BY t.created_at DESC;`,
      [userId]
    );
    return res.rows;
  } finally {
    client.release();
  }
}

/**
 * Retrieves a single ticket by ID.
 */
export async function getTicketById(ticketId: string) {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT t.id, t.ticket_code, t.status, t.issued_at, t.checked_in_at, t.created_at, t.user_id, t.owner_user_id,
              e.id as event_id, e.title as event_title, e.starts_at as event_starts_at, e.ends_at as event_ends_at,
              tt.name as tier_name, tt.price_paise,
              b.id as booking_id,
              u.display_name as attendee_name,
              v.name as venue_name, v.building, v.directions
       FROM tickets t
       JOIN events e ON t.event_id = e.id
       JOIN ticket_types tt ON t.ticket_type_id = tt.id
       JOIN bookings b ON t.booking_id = b.id
       JOIN users u ON t.user_id = u.id
       LEFT JOIN venues v ON e.venue_id = v.id
       WHERE t.id = $1;`,
      [ticketId]
    );
    return res.rows[0] || null;
  } finally {
    client.release();
  }
}

/**
 * Retrieves event attendance sessions, counters, tier breakdown, and recent scan logs.
 */
export async function getEventAttendance(eventId: string) {
  const client = await pool.connect();
  try {
    // 1. Sessions
    const sessionsRes = await client.query(
      `SELECT id, name, starts_at, ends_at, checkin_opens_at, checkin_closes_at
       FROM attendance_sessions
       WHERE event_id = $1
       ORDER BY starts_at ASC;`,
      [eventId]
    );

    // 2. Summary stats
    const statsRes = await client.query(
      `SELECT
         COUNT(*) FILTER (WHERE status != 'CANCELLED')::int as total_registered,
         COUNT(*) FILTER (WHERE status = 'CHECKED_IN')::int as total_checked_in,
         COUNT(*) FILTER (WHERE status = 'VALID')::int as total_valid_unredeemed,
         COUNT(*) FILTER (WHERE status = 'REVOKED')::int as total_revoked
       FROM tickets
       WHERE event_id = $1;`,
      [eventId]
    );

    const dupRes = await client.query(
      `SELECT COUNT(*)::int as duplicate_attempts
       FROM scan_log
       WHERE event_id = $1 AND outcome = 'DUPLICATE';`,
      [eventId]
    );

    // 3. Tiers breakdown
    const tiersRes = await client.query(
      `SELECT tt.id, tt.name,
              COUNT(t.id)::int as total_tickets,
              COUNT(t.id) FILTER (WHERE t.status = 'CHECKED_IN')::int as checked_in_count
       FROM ticket_types tt
       LEFT JOIN tickets t ON t.ticket_type_id = tt.id AND t.event_id = $1
       WHERE tt.event_id = $1
       GROUP BY tt.id, tt.name
       ORDER BY tt.name ASC;`,
      [eventId]
    );

    // 4. Recent scans
    const scansRes = await client.query(
      `SELECT sl.id, sl.outcome, sl.at, sl.ticket_id,
              u.display_name as staff_name
       FROM scan_log sl
       LEFT JOIN users u ON sl.staff_id = u.id
       WHERE sl.event_id = $1
       ORDER BY sl.at DESC
       LIMIT 50;`,
      [eventId]
    );

    return {
      sessions: sessionsRes.rows,
      summary: {
        totalRegistered: statsRes.rows[0]?.total_registered || 0,
        totalCheckedIn: statsRes.rows[0]?.total_checked_in || 0,
        totalValidUnredeemed: statsRes.rows[0]?.total_valid_unredeemed || 0,
        totalRevoked: statsRes.rows[0]?.total_revoked || 0,
        duplicateAttempts: dupRes.rows[0]?.duplicate_attempts || 0,
      },
      tierBreakdown: tiersRes.rows,
      recentScans: scansRes.rows,
    };
  } finally {
    client.release();
  }
}

/**
 * Retrieves certificates issued to a specific student user.
 */
export async function getUserCertificates(userId: string) {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT c.id, c.verification_code, c.issued_at, c.revoked_at, c.revoke_reason,
              e.id as event_id, e.title as event_title, e.starts_at as event_date
       FROM certificates c
       JOIN events e ON c.event_id = e.id
       WHERE c.user_id = $1
       ORDER BY c.issued_at DESC;`,
      [userId]
    );
    return res.rows;
  } finally {
    client.release();
  }
}

/**
 * Downloads / verifies full certificate representation for owner or admin.
 */
export async function getCertificateDownload(certId: string, userId: string) {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT c.id, c.verification_code, c.issued_at, c.revoked_at, c.hash,
              e.id as event_id, e.title as event_title, e.starts_at as event_date,
              u.id as user_id, u.display_name as attendee_name
       FROM certificates c
       JOIN events e ON c.event_id = e.id
       JOIN users u ON c.user_id = u.id
       WHERE c.id = $1 AND (c.user_id = $2 OR EXISTS (
         SELECT 1 FROM users WHERE id = $2 AND global_role = 'admin'
       ));`,
      [certId, userId]
    );

    if (res.rows.length === 0) return null;
    const cert = res.rows[0];
    return {
      id: cert.id,
      verificationCode: cert.verification_code,
      issuedAt: cert.issued_at,
      revokedAt: cert.revoked_at,
      hashHex: cert.hash ? cert.hash.toString('hex') : null,
      eventTitle: cert.event_title,
      eventDate: cert.event_date,
      attendeeName: cert.attendee_name,
      verifyUrl: `https://eventora.campus.edu/verify/${cert.verification_code}`,
    };
  } finally {
    client.release();
  }
}
