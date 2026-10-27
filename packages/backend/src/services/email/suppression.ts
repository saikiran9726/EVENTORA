import { pool } from '../../db/index.js';

/**
 * Checks whether an email address is suppressed (due to hard bounce, complaint, or manual block).
 */
export async function isEmailSuppressed(email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  const res = await pool.query(
    'SELECT 1 FROM email_suppressions WHERE LOWER(email) = LOWER($1) LIMIT 1;',
    [normalized]
  );
  return res.rows.length > 0;
}

/**
 * Filters a list of email addresses, returning active and suppressed recipients.
 */
export async function filterSuppressedEmails(
  emails: string[]
): Promise<{ allowed: string[]; suppressed: string[] }> {
  if (emails.length === 0) {
    return { allowed: [], suppressed: [] };
  }

  const normalized = Array.from(new Set(emails.map((e) => e.trim().toLowerCase())));
  const res = await pool.query(
    'SELECT LOWER(email) as email FROM email_suppressions WHERE LOWER(email) = ANY($1::text[]);',
    [normalized]
  );

  const suppressedSet = new Set(res.rows.map((r) => r.email));
  const allowed = normalized.filter((e) => !suppressedSet.has(e));
  const suppressed = normalized.filter((e) => suppressedSet.has(e));

  return { allowed, suppressed };
}

/**
 * Records an email address suppression (e.g. from Resend webhook or bounce handling).
 */
export async function recordSuppression(params: {
  email: string;
  reason: 'hard_bounce' | 'complaint' | 'manual' | string;
  source?: string;
  details?: Record<string, any>;
}): Promise<void> {
  const normalized = params.email.trim().toLowerCase();
  await pool.query(
    `INSERT INTO email_suppressions (email, reason, source, details)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE
     SET reason = EXCLUDED.reason,
         source = EXCLUDED.source,
         details = EXCLUDED.details,
         created_at = NOW();`,
    [
      normalized,
      params.reason,
      params.source || 'resend',
      JSON.stringify(params.details || {}),
    ]
  );
}
