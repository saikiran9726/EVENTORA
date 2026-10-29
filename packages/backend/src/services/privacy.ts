import crypto from 'node:crypto';
import { pool } from '../db/index.js';
import { logAuditEvent } from './audit.js';

const PRIVACY_SALT = process.env.PRIVACY_PEPPER || 'eventora-dpdp-privacy-pepper-2026';

/**
 * Truncates an IP address before hashing to prevent rainbow-table identification.
 * - IPv4: zero out the last octet (e.g. 192.168.1.123 -> 192.168.1.0/24)
 * - IPv6: keep only the first 48 bits (first 3 hextets)
 */
export function truncateIp(ip: string): string {
  if (!ip) return '0.0.0.0';
  const clean = ip.trim();

  // IPv4
  if (clean.includes('.')) {
    const parts = clean.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
    }
  }

  // IPv6
  if (clean.includes(':')) {
    const parts = clean.split(':').filter(Boolean);
    if (parts.length >= 3) {
      return `${parts[0]}:${parts[1]}:${parts[2]}::`;
    }
  }

  return clean;
}

/**
 * Privacy-preserving IP hashing: truncates subnet, then hashes with salt.
 */
export function anonymizeAndHashIp(ip: string): string {
  const truncated = truncateIp(ip);
  return crypto
    .createHash('sha256')
    .update(`${truncated}:${PRIVACY_SALT}`)
    .digest('hex');
}

/**
 * Compiles a comprehensive machine-readable personal data export (GDPR Art 20 / DPDP Art 12).
 */
export async function getUserDataExport(userId: string): Promise<Record<string, unknown>> {
  const userRes = await pool.query(
    `SELECT id, email, display_name, global_role, status, department, year, college_id, created_at
     FROM users WHERE id = $1;`,
    [userId]
  );

  if (userRes.rows.length === 0) {
    throw new Error('User not found');
  }
  const user = userRes.rows[0];

  const prefRes = await pool.query(`SELECT * FROM user_preferences WHERE user_id = $1;`, [userId]);

  const bookingsRes = await pool.query(
    `SELECT b.*, COALESCE(json_agg(bi.*) FILTER (WHERE bi.id IS NOT NULL), '[]'::json) as items
     FROM bookings b
     LEFT JOIN booking_items bi ON bi.booking_id = b.id
     WHERE b.user_id = $1
     GROUP BY b.id;`,
    [userId]
  );

  const ticketsRes = await pool.query(
    `SELECT id, booking_id, ticket_code, status, issued_at, checked_in_at
     FROM tickets WHERE user_id = $1;`,
    [userId]
  );

  const certRes = await pool.query(
    `SELECT id, event_id, verification_code, issued_at
     FROM certificates WHERE user_id = $1;`,
    [userId]
  );

  const feedbackRes = await pool.query(
    `SELECT id, event_id, rating, comment, submitted_at
     FROM event_feedback WHERE user_id = $1;`,
    [userId]
  );

  const waitlistRes = await pool.query(
    `SELECT id, event_id, ticket_type_id, status, created_at
     FROM waitlist_entries WHERE user_id = $1;`,
    [userId]
  );

  const notifRes = await pool.query(
    `SELECT id, type, title, body, severity, created_at
     FROM notifications WHERE user_id = $1;`,
    [userId]
  );

  const teamsRes = await pool.query(
    `SELECT tm.team_id, t.name as team_name, tm.role, tm.status
     FROM team_members tm
     LEFT JOIN teams t ON t.id = tm.team_id
     WHERE tm.user_id = $1;`,
    [userId]
  );

  return {
    exportDate: new Date().toISOString(),
    standard: 'DPDP-2023 / GDPR-Article-20-Portability',
    user,
    preferences: prefRes.rows[0] || null,
    bookings: bookingsRes.rows,
    tickets: ticketsRes.rows,
    certificates: certRes.rows,
    feedback: feedbackRes.rows,
    waitlistEntries: waitlistRes.rows,
    notifications: notifRes.rows,
    teamMemberships: teamsRes.rows,
  };
}

/**
 * Anonymises user personal data (Right to Erasure / GDPR Art 17 / DPDP Section 12).
 * Retains required financial ledger rows for statutory tax & audit obligations,
 * while stripping all personal identifiers and revoking active sessions.
 */
export async function anonymizeUserData(userId: string, reason = 'user_requested_erasure'): Promise<{ success: boolean; anonymizedId: string }> {
  const client = await pool.connect();
  const anonymizedSuffix = userId.slice(0, 8);
  const anonymizedDisplayName = `Anonymized User ${anonymizedSuffix}`;
  const anonymizedEmail = `anonymized-${userId}@privacy.deleted.eventora`;

  try {
    await client.query('BEGIN');

    // 1. Redact user identity
    await client.query(
      `UPDATE users
       SET display_name = $1,
           email = $2,
           department = NULL,
           year = NULL,
           status = 'suspended'
       WHERE id = $3;`,
      [anonymizedDisplayName, anonymizedEmail, userId]
    );

    // 2. Remove user preferences
    await client.query('DELETE FROM user_preferences WHERE user_id = $1;', [userId]);

    // 3. Redact custom registration form answers
    const userBookingsRes = await client.query('SELECT id FROM bookings WHERE user_id = $1;', [userId]);
    const bIds = userBookingsRes.rows.map((r: { id: string }) => r.id);

    if (bIds.length > 0) {
      await client.query(
        `UPDATE registration_answers
         SET value = '"[Redacted per Privacy Policy]"'::jsonb
         WHERE booking_id = ANY($1::uuid[]);`,
        [bIds]
      );
    }

    // 4. Revoke all active sessions
    await client.query(
      `UPDATE sessions
       SET revoked_at = NOW()
       WHERE user_id = $1 AND revoked_at IS NULL;`,
      [userId]
    );

    // 5. Invalidate active password resets
    await client.query(
      `UPDATE password_resets
       SET used_at = NOW()
       WHERE user_id = $1 AND used_at IS NULL;`,
      [userId]
    );

    await client.query('COMMIT');

    // 6. Audit log entry for erasure compliance
    await logAuditEvent({
      actorId: 'system',
      action: 'user.erased',
      resourceType: 'user',
      resourceId: userId,
      meta: { reason, anonymizedEmail },
    });

    return { success: true, anonymizedId: userId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
