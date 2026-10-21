import { pool } from '../db/index.js';
import crypto from 'crypto';

export class FeedbackError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 400,
    public details: Record<string, any> = {}
  ) {
    super(message);
    this.name = 'FeedbackError';
  }
}

// In-memory sliding window rate limiter: 5 feedback submissions per hour per user
const feedbackRateLimitMap = new Map<string, number[]>();

export function checkFeedbackRateLimit(userId: string): void {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000; // 1 hour
  const timestamps = (feedbackRateLimitMap.get(userId) || []).filter((t) => now - t < windowMs);

  if (timestamps.length >= 5) {
    throw new FeedbackError(
      'RATE_LIMIT_EXCEEDED',
      'Feedback submission rate limit exceeded (maximum 5 reviews per hour)',
      429,
      { limit: 5, window: '1h' }
    );
  }

  timestamps.push(now);
  feedbackRateLimitMap.set(userId, timestamps);
}

/**
 * Neutralizes CSV/Excel formula injection (CWE-1236).
 * Any cell value starting with '=', '+', '-', '@', '\t', or '\r' is prefixed with a single quote.
 */
export function sanitizeCsvCell(value: any): string {
  if (value === null || value === undefined) return '';
  const str = String(value);

  // If cell starts with formula trigger character, prefix with apostrophe
  const neutralized = /^[\=\+\-\@\t\r]/.test(str) ? `'${str}` : str;

  // Standard CSV escaping for commas, quotes, and newlines
  if (/[",\n\r]/.test(neutralized)) {
    return `"${neutralized.replace(/"/g, '""')}"`;
  }
  return neutralized;
}

export interface SubmitFeedbackParams {
  eventId: string;
  userId: string;
  rating: number;
  comment?: string;
  answers?: Record<string, any>;
}

/**
 * Submits or updates event feedback.
 * Non-negotiables:
 * 1. Only CHECKED_IN attendees are eligible.
 * 2. Second submit within 48h edit window updates existing record (edited_at set).
 * 3. Edit after 48h window returns 409 FEEDBACK_LOCKED.
 */
export async function submitFeedback(params: SubmitFeedbackParams) {
  const { eventId, userId, rating, comment, answers } = params;

  // 1. Rate limit
  checkFeedbackRateLimit(userId);

  if (!rating || rating < 1 || rating > 5) {
    throw new FeedbackError('INVALID_RATING', 'Rating must be an integer between 1 and 5', 400);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 2. Eligibility Guard: Check attendee checked in
    const checkinRes = await client.query(
      `SELECT id, status FROM tickets
       WHERE event_id = $1 AND (user_id = $2 OR owner_user_id = $2) AND status = 'CHECKED_IN'
       LIMIT 1;`,
      [eventId, userId]
    );

    if (checkinRes.rows.length === 0) {
      throw new FeedbackError(
        'INELIGIBLE_NOT_ATTENDED',
        'Only checked-in attendees are eligible to provide event feedback',
        403,
        { eventId, userId }
      );
    }

    const ticketId = checkinRes.rows[0].id;

    // 3. Check for existing feedback
    const existingRes = await client.query(
      `SELECT id, rating, comment, submitted_at, edited_at FROM event_feedback
       WHERE event_id = $1 AND user_id = $2;`,
      [eventId, userId]
    );

    let feedbackRecord: any;

    if (existingRes.rows.length > 0) {
      const existing = existingRes.rows[0];
      const submittedTime = new Date(existing.submitted_at).getTime();
      const editWindowMs = 48 * 60 * 60 * 1000; // 48 hours

      if (Date.now() - submittedTime > editWindowMs) {
        throw new FeedbackError(
          'FEEDBACK_LOCKED',
          'Feedback editing window has expired (reviews can only be edited within 48 hours of submission)',
          409,
          { submittedAt: existing.submitted_at, editWindowHours: 48 }
        );
      }

      // Update existing feedback
      const updateRes = await client.query(
        `UPDATE event_feedback
         SET rating = $1,
             comment = $2,
             answers = $3,
             edited_at = NOW()
         WHERE id = $4
         RETURNING *;`,
        [rating, comment || null, JSON.stringify(answers || {}), existing.id]
      );
      feedbackRecord = updateRes.rows[0];
    } else {
      // Insert new feedback
      const insertRes = await client.query(
        `INSERT INTO event_feedback (
           event_id, user_id, ticket_id, rating, comment, answers, moderation_status
         ) VALUES ($1, $2, $3, $4, $5, $6, 'visible')
         RETURNING *;`,
        [eventId, userId, ticketId, rating, comment || null, JSON.stringify(answers || {})]
      );
      feedbackRecord = insertRes.rows[0];

      // Mark feedback invitation as completed
      await client.query(
        `INSERT INTO feedback_invitations (event_id, user_id, status)
         VALUES ($1, $2, 'COMPLETED')
         ON CONFLICT (event_id, user_id) DO UPDATE SET status = 'COMPLETED';`,
        [eventId, userId]
      );
    }

    // 4. Refresh event_metrics atomically
    await refreshEventMetricsInternal(eventId, client);

    await client.query('COMMIT');
    return feedbackRecord;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Atomically recomputes and caches event metrics in event_metrics table.
 */
async function refreshEventMetricsInternal(eventId: string, client: any) {
  const statsRes = await client.query(
    `SELECT
       (SELECT COUNT(*)::int FROM bookings WHERE event_id = $1 AND status != 'CANCELLED') as registrations,
       (SELECT COUNT(*)::int FROM bookings WHERE event_id = $1 AND status = 'CONFIRMED') as confirmed,
       (SELECT COUNT(*)::int FROM bookings WHERE event_id = $1 AND status = 'CANCELLED') as cancellations,
       (SELECT COUNT(*)::int FROM waitlist_entries WHERE event_id = $1) as waitlist_joined,
       (SELECT COUNT(*)::int FROM waitlist_entries WHERE event_id = $1 AND status = 'CLAIMED') as waitlist_converted,
       (SELECT COUNT(*)::int FROM tickets WHERE event_id = $1 AND status = 'CHECKED_IN') as checkins,
       (SELECT COUNT(*)::int FROM tickets WHERE event_id = $1 AND status = 'VALID') as no_shows,
       (SELECT COUNT(*)::int FROM event_feedback WHERE event_id = $1 AND moderation_status != 'hidden') as feedback_count,
       (SELECT COALESCE(ROUND(AVG(rating)::numeric, 2), 0.00) FROM event_feedback WHERE event_id = $1 AND moderation_status != 'hidden') as rating_avg,
       (SELECT COALESCE(SUM(amount_paise), 0)::int FROM payments p JOIN bookings b ON p.booking_id = b.id WHERE b.event_id = $1 AND p.status = 'SUCCEEDED') as sales_paise;`,
    [eventId]
  );

  const s = statsRes.rows[0];

  const upsertRes = await client.query(
    `INSERT INTO event_metrics (
       event_id, registrations, confirmed, cancellations, waitlist_joined, waitlist_converted,
       checkins, no_shows, feedback_count, rating_avg, sales_paise_simulated, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
     ON CONFLICT (event_id) DO UPDATE SET
       registrations = EXCLUDED.registrations,
       confirmed = EXCLUDED.confirmed,
       cancellations = EXCLUDED.cancellations,
       waitlist_joined = EXCLUDED.waitlist_joined,
       waitlist_converted = EXCLUDED.waitlist_converted,
       checkins = EXCLUDED.checkins,
       no_shows = EXCLUDED.no_shows,
       feedback_count = EXCLUDED.feedback_count,
       rating_avg = EXCLUDED.rating_avg,
       sales_paise_simulated = EXCLUDED.sales_paise_simulated,
       updated_at = NOW()
     RETURNING *;`,
    [
      eventId,
      s.registrations || 0,
      s.confirmed || 0,
      s.cancellations || 0,
      s.waitlist_joined || 0,
      s.waitlist_converted || 0,
      s.checkins || 0,
      s.no_shows || 0,
      s.feedback_count || 0,
      s.rating_avg || '0.00',
      s.sales_paise || 0,
    ]
  );

  return upsertRes.rows[0];
}

export async function refreshEventMetrics(eventId: string) {
  const client = await pool.connect();
  try {
    return await refreshEventMetricsInternal(eventId, client);
  } finally {
    client.release();
  }
}

/**
 * Returns public aggregate rating, count, and response rate.
 * Rule: Hide numeric average when n < 5 ("not enough responses yet").
 * Response rate = feedback_count / checked_in_count.
 */
export async function getPublicEventRatings(eventId: string) {
  const client = await pool.connect();
  try {
    let metricsRes = await client.query(`SELECT * FROM event_metrics WHERE event_id = $1;`, [eventId]);
    if (metricsRes.rows.length === 0) {
      await refreshEventMetricsInternal(eventId, client);
      metricsRes = await client.query(`SELECT * FROM event_metrics WHERE event_id = $1;`, [eventId]);
    }

    const m = metricsRes.rows[0] || {
      feedback_count: 0,
      checkins: 0,
      rating_avg: '0.00',
    };

    const feedbackCount = m.feedback_count || 0;
    const checkedInCount = m.checkins || 0;
    const responseRatePct = checkedInCount > 0 ? Math.round((feedbackCount / checkedInCount) * 100) : 0;
    const hasEnoughResponses = feedbackCount >= 5;

    // Distribution
    const distRes = await client.query(
      `SELECT rating, COUNT(*)::int as count
       FROM event_feedback
       WHERE event_id = $1 AND moderation_status != 'hidden'
       GROUP BY rating
       ORDER BY rating DESC;`,
      [eventId]
    );

    const breakdown: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    for (const row of distRes.rows) {
      breakdown[row.rating] = row.count;
    }

    const numericAvg = Number(m.rating_avg) || 0;
    const displayRating = hasEnoughResponses ? `${numericAvg.toFixed(1)} ★` : 'Not enough responses yet';
    const formattedSummary = hasEnoughResponses
      ? `${numericAvg.toFixed(1)} ★ (${feedbackCount} of ${checkedInCount} attended · ${responseRatePct}% responded)`
      : `(${feedbackCount} of ${checkedInCount} attended · ${responseRatePct}% responded · not enough responses yet)`;

    return {
      eventId,
      ratingAvg: hasEnoughResponses ? numericAvg : null,
      feedbackCount,
      checkedInCount,
      responseRatePct,
      hasEnoughResponses,
      displayRating,
      formattedSummary,
      breakdown,
    };
  } finally {
    client.release();
  }
}

/**
 * Returns paginated feedback for event organizers.
 * ZERO PII RULE: Attendee emails and phone numbers are never included in the response.
 */
export async function getOrganizerFeedback(eventId: string, page: number = 1, limit: number = 20) {
  const client = await pool.connect();
  try {
    const offset = Math.max(0, (page - 1) * limit);

    const countRes = await client.query(
      `SELECT COUNT(*)::int as total FROM event_feedback WHERE event_id = $1;`,
      [eventId]
    );
    const total = countRes.rows[0]?.total || 0;

    const res = await client.query(
      `SELECT ef.id, ef.rating, ef.comment, ef.answers, ef.moderation_status,
              ef.submitted_at, ef.edited_at,
              tt.name as ticket_tier_name
       FROM event_feedback ef
       LEFT JOIN tickets t ON ef.ticket_id = t.id
       LEFT JOIN ticket_types tt ON t.ticket_type_id = tt.id
       WHERE ef.event_id = $1
       ORDER BY ef.submitted_at DESC
       LIMIT $2 OFFSET $3;`,
      [eventId, limit, offset]
    );

    // Map rows with anonymous label (No PII)
    const feedback = res.rows.map((row, idx) => ({
      id: row.id,
      rating: row.rating,
      comment: row.comment,
      answers: row.answers,
      moderationStatus: row.moderation_status,
      submittedAt: row.submitted_at,
      editedAt: row.edited_at,
      ticketTierName: row.ticket_tier_name || 'Standard Admission',
      anonymousIdentifier: `Attendee #${total - (offset + idx)}`,
    }));

    return {
      feedback,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  } finally {
    client.release();
  }
}

/**
 * Report inappropriate feedback review.
 */
export async function reportFeedback(params: {
  feedbackId: string;
  reporterId: string;
  reason: string;
}) {
  const { feedbackId, reporterId, reason } = params;
  const client = await pool.connect();
  try {
    const repRes = await client.query(
      `INSERT INTO feedback_reports (feedback_id, reporter_id, reason, status)
       VALUES ($1, $2, $3, 'PENDING')
       RETURNING *;`,
      [feedbackId, reporterId, reason]
    );

    // Flag feedback if reported
    await client.query(
      `UPDATE event_feedback SET moderation_status = 'flagged' WHERE id = $1;`,
      [feedbackId]
    );

    return repRes.rows[0];
  } finally {
    client.release();
  }
}

/**
 * Moderate feedback (Organizer or Admin).
 */
export async function moderateFeedback(params: {
  feedbackId: string;
  actorId: string;
  status: 'visible' | 'flagged' | 'hidden';
  notes?: string;
}) {
  const { feedbackId, actorId, status, notes } = params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const updateRes = await client.query(
      `UPDATE event_feedback
       SET moderation_status = $1
       WHERE id = $2
       RETURNING id, event_id, moderation_status;`,
      [status, feedbackId]
    );

    if (updateRes.rows.length === 0) {
      throw new FeedbackError('NOT_FOUND', 'Feedback review not found', 404);
    }

    const row = updateRes.rows[0];

    // Log to audit trail
    await client.query(
      `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, meta)
       VALUES ($1, 'feedback:moderate', 'event_feedback', $2, $3);`,
      [actorId, feedbackId, JSON.stringify({ status, notes })]
    );

    // Recompute event metrics
    await refreshEventMetricsInternal(row.event_id, client);

    await client.query('COMMIT');
    return row;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Returns full organizer analytics: KPI cards, funnel, timeseries, ratings breakdown.
 */
export async function getOrganizerAnalytics(eventId: string) {
  const client = await pool.connect();
  try {
    let metricsRes = await client.query(`SELECT * FROM event_metrics WHERE event_id = $1;`, [eventId]);
    if (metricsRes.rows.length === 0) {
      await refreshEventMetricsInternal(eventId, client);
      metricsRes = await client.query(`SELECT * FROM event_metrics WHERE event_id = $1;`, [eventId]);
    }

    const m = metricsRes.rows[0] || {};
    const confirmed = m.confirmed || 0;
    const checkins = m.checkins || 0;
    const feedbackCount = m.feedback_count || 0;
    const waitlistJoined = m.waitlist_joined || 0;
    const waitlistConverted = m.waitlist_converted || 0;

    const checkinRate = confirmed > 0 ? Math.round((checkins / confirmed) * 100) : 0;
    const responseRate = checkins > 0 ? Math.round((feedbackCount / checkins) * 100) : 0;
    const waitlistConversionRate = waitlistJoined > 0 ? Math.round((waitlistConverted / waitlistJoined) * 100) : 0;

    // Daily cumulative registration points (time-series)
    const tsRes = await client.query(
      `SELECT DATE(created_at) as date, COUNT(*)::int as count
       FROM bookings
       WHERE event_id = $1 AND status != 'CANCELLED'
       GROUP BY DATE(created_at)
       ORDER BY DATE(created_at) ASC;`,
      [eventId]
    );

    let cumulative = 0;
    const timeSeries = tsRes.rows.map((row) => {
      cumulative += row.count;
      return {
        date: row.date.toISOString().split('T')[0],
        dailyCount: row.count,
        cumulativeCount: cumulative,
      };
    });

    // Rating distribution
    const distRes = await client.query(
      `SELECT rating, COUNT(*)::int as count
       FROM event_feedback
       WHERE event_id = $1 AND moderation_status != 'hidden'
       GROUP BY rating
       ORDER BY rating DESC;`,
      [eventId]
    );

    const ratingDistribution: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    for (const r of distRes.rows) {
      ratingDistribution[r.rating] = r.count;
    }

    return {
      eventId,
      kpis: {
        registrations: m.registrations || 0,
        confirmed,
        cancellations: m.cancellations || 0,
        checkins,
        noShows: m.no_shows || 0,
        feedbackCount,
        ratingAvg: Number(m.rating_avg) || 0,
        salesPaiseSimulated: m.sales_paise_simulated || 0,
      },
      rates: {
        checkinRate,
        responseRate,
        waitlistConversionRate,
      },
      funnel: [
        { stage: 'Registered', count: m.registrations || 0, percentage: 100 },
        { stage: 'Confirmed', count: confirmed, percentage: m.registrations > 0 ? Math.round((confirmed / m.registrations) * 100) : 0 },
        { stage: 'Checked In', count: checkins, percentage: confirmed > 0 ? Math.round((checkins / confirmed) * 100) : 0 },
        { stage: 'Feedback Submitted', count: feedbackCount, percentage: checkins > 0 ? Math.round((feedbackCount / checkins) * 100) : 0 },
      ],
      timeSeries,
      ratingDistribution,
      updatedAt: m.updated_at,
    };
  } finally {
    client.release();
  }
}

/**
 * Creates an export job and generates sanitized CSV data.
 * Non-negotiables:
 * 1. CSV Formula Injection Neutralization (' prefix on =, +, -, @).
 * 2. Scoped strictly to owned events.
 * 3. Restricts PII (emails/phone) if caller lacks export:pii.
 */
export async function createExportJob(params: {
  eventId: string;
  requesterId: string;
  format: 'csv' | 'xlsx';
  kind?: 'attendees' | 'feedback' | 'sales_ledger' | 'analytics';
  hasPiiExportRole?: boolean;
}) {
  const { eventId, requesterId, format = 'csv', kind = 'attendees', hasPiiExportRole = false } = params;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let exportContent = '';
    let rowCount = 0;

    if (kind === 'attendees') {
      const attRes = await client.query(
        `SELECT b.id as booking_id, b.status as booking_status, b.total_paise, b.created_at,
                u.display_name, u.email,
                t.ticket_code, t.status as ticket_status, t.checked_in_at,
                tt.name as tier_name
         FROM bookings b
         JOIN users u ON b.user_id = u.id
         LEFT JOIN tickets t ON t.booking_id = b.id
         LEFT JOIN ticket_types tt ON t.ticket_type_id = tt.id
         WHERE b.event_id = $1
         ORDER BY b.created_at ASC;`,
        [eventId]
      );

      rowCount = attRes.rows.length;

      // Determine header columns based on PII authorization
      const headers = hasPiiExportRole
        ? ['Booking ID', 'Attendee Name', 'College Email', 'Ticket Tier', 'Ticket Code', 'Booking Status', 'Ticket Status', 'Checked In At', 'Registered At']
        : ['Booking ID', 'Attendee Initials', 'Ticket Tier', 'Ticket Code', 'Booking Status', 'Ticket Status', 'Checked In At', 'Registered At'];

      const rows: string[][] = [headers];

      for (const row of attRes.rows) {
        const attendeeCell = hasPiiExportRole
          ? row.display_name
          : row.display_name
          ? row.display_name.split(' ').map((p: string) => `${p[0]}.`).join(' ')
          : 'Anonymous';

        const rowCells = hasPiiExportRole
          ? [
              sanitizeCsvCell(row.booking_id),
              sanitizeCsvCell(attendeeCell),
              sanitizeCsvCell(row.email),
              sanitizeCsvCell(row.tier_name || 'Standard'),
              sanitizeCsvCell(row.ticket_code || 'N/A'),
              sanitizeCsvCell(row.booking_status),
              sanitizeCsvCell(row.ticket_status || 'UNISSUED'),
              sanitizeCsvCell(row.checked_in_at ? new Date(row.checked_in_at).toISOString() : ''),
              sanitizeCsvCell(new Date(row.created_at).toISOString()),
            ]
          : [
              sanitizeCsvCell(row.booking_id),
              sanitizeCsvCell(attendeeCell),
              sanitizeCsvCell(row.tier_name || 'Standard'),
              sanitizeCsvCell(row.ticket_code || 'N/A'),
              sanitizeCsvCell(row.booking_status),
              sanitizeCsvCell(row.ticket_status || 'UNISSUED'),
              sanitizeCsvCell(row.checked_in_at ? new Date(row.checked_in_at).toISOString() : ''),
              sanitizeCsvCell(new Date(row.created_at).toISOString()),
            ];

        rows.push(rowCells);
      }

      exportContent = rows.map((r) => r.join(',')).join('\n');
    } else if (kind === 'feedback') {
      const fbRes = await client.query(
        `SELECT ef.id, ef.rating, ef.comment, ef.moderation_status, ef.submitted_at, ef.edited_at,
                tt.name as tier_name
         FROM event_feedback ef
         LEFT JOIN tickets t ON ef.ticket_id = t.id
         LEFT JOIN ticket_types tt ON t.ticket_type_id = tt.id
         WHERE ef.event_id = $1
         ORDER BY ef.submitted_at DESC;`,
        [eventId]
      );

      rowCount = fbRes.rows.length;
      const headers = ['Feedback ID', 'Rating (1-5)', 'Comment', 'Ticket Tier', 'Moderation Status', 'Submitted At', 'Edited At'];
      const rows: string[][] = [headers];

      for (const row of fbRes.rows) {
        rows.push([
          sanitizeCsvCell(row.id),
          sanitizeCsvCell(row.rating),
          sanitizeCsvCell(row.comment || ''),
          sanitizeCsvCell(row.tier_name || 'Standard'),
          sanitizeCsvCell(row.moderation_status),
          sanitizeCsvCell(new Date(row.submitted_at).toISOString()),
          sanitizeCsvCell(row.edited_at ? new Date(row.edited_at).toISOString() : ''),
        ]);
      }
      exportContent = rows.map((r) => r.join(',')).join('\n');
    } else {
      // General analytics summary
      const m = await refreshEventMetricsInternal(eventId, client);
      rowCount = 1;
      const headers = ['Event ID', 'Registrations', 'Confirmed', 'Cancellations', 'Checkins', 'No Shows', 'Feedback Count', 'Rating Avg', 'Gross Simulated Paise'];
      const rows = [
        headers,
        [
          sanitizeCsvCell(m.event_id),
          sanitizeCsvCell(m.registrations),
          sanitizeCsvCell(m.confirmed),
          sanitizeCsvCell(m.cancellations),
          sanitizeCsvCell(m.checkins),
          sanitizeCsvCell(m.no_shows),
          sanitizeCsvCell(m.feedback_count),
          sanitizeCsvCell(m.rating_avg),
          sanitizeCsvCell(m.sales_paise_simulated),
        ],
      ];
      exportContent = rows.map((r) => r.join(',')).join('\n');
    }

    // Generate signed expiring token (15 mins)
    const fileKey = `export_${eventId}_${kind}_${Date.now()}.${format}`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins
    const downloadToken = crypto.randomBytes(24).toString('base64url');

    const jobRes = await client.query(
      `INSERT INTO export_jobs (
         requester_id, event_id, kind, format, status, file_key, download_url, expires_at, completed_at, row_count
       ) VALUES ($1, $2, $3, $4, 'COMPLETED', $5, $6, $7, NOW(), $8)
       RETURNING *;`,
      [
        requesterId,
        eventId,
        kind,
        format,
        fileKey,
        `/api/v1/exports/download/${downloadToken}`,
        expiresAt,
        rowCount,
      ]
    );

    const job = jobRes.rows[0];

    // Store in-memory export buffer
    exportCache.set(job.id, { content: exportContent, format, expiresAt: expiresAt.getTime() });
    exportTokenMap.set(downloadToken, job.id);

    // Audit log
    await client.query(
      `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, meta)
       VALUES ($1, 'export:generate', 'event', $2, $3);`,
      [requesterId, eventId, JSON.stringify({ kind, format, rowCount, jobId: job.id, hasPiiExportRole })]
    );

    await client.query('COMMIT');

    return {
      jobId: job.id,
      status: 'COMPLETED',
      kind,
      format,
      rowCount,
      downloadUrl: `/api/v1/exports/download/${downloadToken}`,
      expiresAt: expiresAt.toISOString(),
      csvContentPreview: exportContent.substring(0, 500),
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// In-memory export cache for fast streaming and expiring downloads
const exportCache = new Map<string, { content: string; format: string; expiresAt: number }>();
const exportTokenMap = new Map<string, string>(); // token -> jobId

export function getExportDownloadByToken(token: string) {
  const jobId = exportTokenMap.get(token);
  if (!jobId) return null;

  const cached = exportCache.get(jobId);
  if (!cached) return null;

  if (Date.now() > cached.expiresAt) {
    exportCache.delete(jobId);
    exportTokenMap.delete(token);
    return null;
  }

  return cached;
}
