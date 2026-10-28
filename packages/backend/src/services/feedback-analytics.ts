import { pool } from '../db/index.js';
import crypto from 'crypto';
import ExcelJS from 'exceljs';

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
export function sanitizeCellValue(value: any): any {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  const str = String(value);
  return /^[\=\+\-\@\t\r]/.test(str) ? `'${str}` : str;
}

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
      `SELECT t.id, t.status FROM tickets t
       WHERE t.event_id = $1 AND (t.user_id = $2 OR t.owner_user_id = $2)
         AND (t.status = 'CHECKED_IN' OR EXISTS (SELECT 1 FROM checkins c WHERE c.ticket_id = t.id))
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

    const res = await client.query<{
      id: string;
      rating: number;
      comment: string | null;
      answers: unknown;
      moderation_status: string;
      submitted_at: Date | string;
      edited_at: Date | string | null;
      ticket_tier_name: string | null;
    }>(
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
 * Returns full organizer analytics: KPI cards, funnel, timeseries, ratings breakdown,
 * revenue reconciliation from organizer_ledger_entries, sales velocity (Asia/Kolkata),
 * capacity utilization, tier breakdown, refund rates, waitlist length,
 * and demographics from custom form answers with strict suppression of cohorts < 5 responses.
 */
export async function getOrganizerAnalytics(eventId: string) {
  const client = await pool.connect();
  try {
    // 1. Verify Event Exists & Fetch Capacity
    const eventRes = await client.query(
      `SELECT id, organizer_id, title, capacity FROM events WHERE id = $1;`,
      [eventId]
    );
    if (eventRes.rows.length === 0) {
      throw new FeedbackError('NOT_FOUND', 'Event not found', 404);
    }
    const eventRow = eventRes.rows[0];
    const totalCapacity = Number(eventRow.capacity) || 0;

    // 2. Metrics & Bookings / Tickets Summary
    let metricsRes = await client.query(`SELECT * FROM event_metrics WHERE event_id = $1;`, [eventId]);
    if (metricsRes.rows.length === 0) {
      await refreshEventMetricsInternal(eventId, client);
      metricsRes = await client.query(`SELECT * FROM event_metrics WHERE event_id = $1;`, [eventId]);
    }

    const m = metricsRes.rows[0] || {};
    const feedbackCount = m.feedback_count || 0;
    const ratingAvg = Number(m.rating_avg) || 0;

    // Booking counts
    const bookingsRes = await client.query(
      `SELECT 
         COUNT(*)::int AS total_bookings,
         COUNT(*) FILTER (WHERE status = 'CONFIRMED')::int AS confirmed_bookings,
         COUNT(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled_bookings,
         COUNT(*) FILTER (WHERE status = 'PENDING_PAYMENT')::int AS pending_bookings
       FROM bookings
       WHERE event_id = $1;`,
      [eventId]
    );
    const bCounts = bookingsRes.rows[0] || {
      total_bookings: 0,
      confirmed_bookings: 0,
      cancelled_bookings: 0,
      pending_bookings: 0,
    };

    // Ticket counts
    const ticketsRes = await client.query(
      `SELECT 
         COUNT(*)::int AS total_tickets,
         COUNT(*) FILTER (WHERE status IN ('VALID', 'CHECKED_IN'))::int AS confirmed_attendees,
         COUNT(*) FILTER (WHERE status = 'CHECKED_IN')::int AS checked_in_tickets
       FROM tickets
       WHERE event_id = $1;`,
      [eventId]
    );
    const tCounts = ticketsRes.rows[0] || {
      total_tickets: 0,
      confirmed_attendees: 0,
      checked_in_tickets: 0,
    };

    const confirmed = bCounts.confirmed_bookings;
    const totalRegistered = tCounts.confirmed_attendees > 0 ? tCounts.confirmed_attendees : confirmed;
    const checkins = tCounts.checked_in_tickets;
    const cancellations = bCounts.cancelled_bookings;
    const pending = bCounts.pending_bookings;
    const noShows = Math.max(0, confirmed - checkins);

    const capacityUtilizationPct = totalCapacity > 0
      ? Number(((totalRegistered / totalCapacity) * 100).toFixed(2))
      : 0;
    const remainingSeats = Math.max(0, totalCapacity - totalRegistered);

    // 3. Server-side Revenue from organizer_ledger_entries (exact reconciliation)
    const ledgerRes = await client.query(
      `SELECT 
         ole.entry_type,
         COALESCE(SUM(ole.amount_paise), 0)::bigint AS total_paise,
         COUNT(*)::int AS count
       FROM organizer_ledger_entries ole
       JOIN bookings b ON ole.booking_id = b.id
       WHERE b.event_id = $1
       GROUP BY ole.entry_type;`,
      [eventId]
    );

    let grossPaise = 0;
    let refundsPaise = 0;
    let salesCount = 0;
    let refundsCount = 0;

    for (const row of ledgerRes.rows) {
      if (row.entry_type === 'SALE') {
        grossPaise = Number(row.total_paise);
        salesCount = Number(row.count);
      } else if (row.entry_type === 'REFUND') {
        refundsPaise = Number(row.total_paise);
        refundsCount = Number(row.count);
      }
    }

    const netPaise = grossPaise - refundsPaise;
    const refundRateCountPct = salesCount > 0
      ? Number(((refundsCount / salesCount) * 100).toFixed(2))
      : 0;
    const refundRatePaisePct = grossPaise > 0
      ? Number(((refundsPaise / grossPaise) * 100).toFixed(2))
      : 0;

    // 4. Sales Velocity Aggregation (Asia/Kolkata Time Zone)
    const hourlyVelocityRes = await client.query(
      `SELECT 
         to_char(date_trunc('hour', created_at AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD"T"HH24:00:00') AS bucket,
         COUNT(*)::int AS bookings_count,
         COALESCE(SUM(total_paise), 0)::bigint AS gross_paise
       FROM bookings
       WHERE event_id = $1 AND status != 'CANCELLED'
       GROUP BY date_trunc('hour', created_at AT TIME ZONE 'Asia/Kolkata')
       ORDER BY bucket ASC;`,
      [eventId]
    );

    const hourlyVelocity = hourlyVelocityRes.rows.map((r) => ({
      bucket: r.bucket,
      bookingsCount: Number(r.bookings_count),
      grossPaise: Number(r.gross_paise),
    }));

    const dailyVelocityRes = await client.query(
      `SELECT 
         to_char(date_trunc('day', created_at AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD') AS bucket,
         COUNT(*)::int AS bookings_count,
         COALESCE(SUM(total_paise), 0)::bigint AS gross_paise
       FROM bookings
       WHERE event_id = $1 AND status != 'CANCELLED'
       GROUP BY date_trunc('day', created_at AT TIME ZONE 'Asia/Kolkata')
       ORDER BY bucket ASC;`,
      [eventId]
    );

    const dailyVelocity = dailyVelocityRes.rows.map((r) => ({
      bucket: r.bucket,
      bookingsCount: Number(r.bookings_count),
      grossPaise: Number(r.gross_paise),
    }));

    // Daily cumulative registration points (time-series for legacy charts)
    let cumulative = 0;
    const timeSeries = dailyVelocity.map((r) => {
      cumulative += r.bookingsCount;
      return {
        date: r.bucket,
        dailyCount: r.bookingsCount,
        cumulativeCount: cumulative,
      };
    });

    // 5. Ticket Tier Breakdown
    const tiersRes = await client.query(
      `SELECT 
         tt.id,
         tt.name,
         tt.price_paise,
         tt.capacity,
         (SELECT COUNT(*)::int FROM tickets t WHERE t.ticket_type_id = tt.id AND t.status IN ('VALID', 'CHECKED_IN')) AS sold,
         (SELECT COALESCE(SUM(bi.quantity), 0)::int 
          FROM booking_items bi 
          JOIN bookings b ON bi.booking_id = b.id 
          WHERE bi.ticket_type_id = tt.id AND b.status = 'PENDING_PAYMENT' AND (b.expires_at IS NULL OR b.expires_at > NOW())) AS held
       FROM ticket_types tt
       WHERE tt.event_id = $1
       ORDER BY tt.price_paise ASC;`,
      [eventId]
    );

    const totalSoldAllTiers = tiersRes.rows.reduce((sum, r) => sum + Number(r.sold), 0);
    const tierBreakdown = tiersRes.rows.map((r) => {
      const sold = Number(r.sold);
      const held = Number(r.held);
      const cap = Number(r.capacity);
      const price = Number(r.price_paise);
      const tierGross = sold * price;
      return {
        tierId: r.id,
        name: r.name,
        pricePaise: price,
        capacity: cap,
        sold,
        held,
        remaining: Math.max(0, cap - sold - held),
        grossPaise: tierGross,
        pctOfTotalRevenue: grossPaise > 0 ? Number(((tierGross / grossPaise) * 100).toFixed(2)) : 0,
        pctOfTotalSold: totalSoldAllTiers > 0 ? Number(((sold / totalSoldAllTiers) * 100).toFixed(2)) : 0,
      };
    });

    // 6. Waitlist Length
    const waitlistRes = await client.query(
      `SELECT 
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'WAITING')::int AS waiting,
         COUNT(*) FILTER (WHERE status = 'CLAIMED')::int AS claimed,
         COUNT(*) FILTER (WHERE status IN ('EXPIRED', 'DECLINED', 'LEFT'))::int AS dropped
       FROM waitlist_entries
       WHERE event_id = $1;`,
      [eventId]
    );

    const wl = waitlistRes.rows[0] || { total: 0, waiting: 0, claimed: 0, dropped: 0 };
    const waitlist = {
      total: Number(wl.total),
      waiting: Number(wl.waiting),
      claimed: Number(wl.claimed),
      dropped: Number(wl.dropped),
    };

    // 7. Demographics from Custom Form Answers with Strict Suppression (< 5 responses)
    const answersRes = await client.query(
      `SELECT 
         eff.id AS field_id,
         eff.label,
         eff.type,
         eff.position,
         ra.value,
         ra.answer
       FROM event_form_fields eff
       JOIN registration_answers ra ON eff.id = ra.field_id
       WHERE eff.event_id = $1
       ORDER BY eff.position ASC;`,
      [eventId]
    );

    // Group answers by field
    const fieldMap = new Map<string, { label: string; type: string; answers: string[] }>();
    for (const row of answersRes.rows) {
      if (!fieldMap.has(row.field_id)) {
        fieldMap.set(row.field_id, {
          label: row.label,
          type: row.type,
          answers: [],
        });
      }
      let rawVal: any = row.value;
      if (rawVal === null || rawVal === undefined) {
        rawVal = row.answer;
      }
      if (rawVal !== null && rawVal !== undefined) {
        if (Array.isArray(rawVal)) {
          for (const item of rawVal) {
            fieldMap.get(row.field_id)!.answers.push(String(item));
          }
        } else if (typeof rawVal === 'object') {
          fieldMap.get(row.field_id)!.answers.push(JSON.stringify(rawVal));
        } else {
          fieldMap.get(row.field_id)!.answers.push(String(rawVal).trim());
        }
      }
    }

    const demographics = Array.from(fieldMap.entries()).map(([fieldId, fData]) => {
      const counts = new Map<string, number>();
      for (const ans of fData.answers) {
        counts.set(ans, (counts.get(ans) || 0) + 1);
      }

      const buckets: Array<{ value: string; count: number | null; countDisplay?: string; suppressed: boolean }> = [];
      let suppressedSum = 0;
      let suppressedValuesCount = 0;

      for (const [val, count] of counts.entries()) {
        if (count >= 5) {
          buckets.push({
            value: val,
            count,
            suppressed: false,
          });
        } else {
          suppressedSum += count;
          suppressedValuesCount++;
        }
      }

      // Strict suppression of small buckets (< 5) to prevent de-anonymization
      if (suppressedSum > 0) {
        buckets.push({
          value: 'Other (< 5)',
          count: suppressedSum,
          countDisplay: '< 5',
          suppressed: true,
        });
      }

      return {
        fieldId,
        label: fData.label,
        type: fData.type,
        totalResponses: fData.answers.length,
        buckets,
        suppressedCount: suppressedSum,
        suppressedValuesCount,
      };
    });

    // 8. Rating distribution
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

    const checkinRate = confirmed > 0 ? Math.round((checkins / confirmed) * 100) : 0;
    const responseRate = checkins > 0 ? Math.round((feedbackCount / checkins) * 100) : 0;
    const waitlistConversionRate = waitlist.total > 0 ? Math.round((waitlist.claimed / waitlist.total) * 100) : 0;

    return {
      eventId,
      kpis: {
        registrations: totalRegistered,
        confirmed,
        cancellations,
        checkins,
        noShows,
        feedbackCount,
        ratingAvg,
        salesPaiseSimulated: grossPaise,
        grossPaise,
        refundsPaise,
        netPaise,
        capacityUtilizationPct,
        remainingSeats,
        checkinRate,
        responseRate,
        waitlistConversionRate,
      },
      revenue: {
        grossPaise,
        refundsPaise,
        netPaise,
        salesCount,
        refundsCount,
        refundRateCountPct,
        refundRatePaisePct,
      },
      salesVelocity: {
        hourly: hourlyVelocity,
        daily: dailyVelocity,
      },
      capacity: {
        totalCapacity,
        totalRegistered,
        confirmed,
        cancelled: cancellations,
        pending,
        capacityUtilizationPct,
        remainingSeats,
      },
      tierBreakdown,
      refunds: {
        refundsCount,
        refundsPaise,
        refundRateCountPct,
        refundRatePaisePct,
      },
      waitlist,
      demographics,
      rates: {
        checkinRate,
        responseRate,
        waitlistConversionRate,
      },
      funnel: [
        { stage: 'Registered', count: totalRegistered, percentage: 100 },
        { stage: 'Confirmed', count: confirmed, percentage: totalRegistered > 0 ? Math.round((confirmed / totalRegistered) * 100) : 0 },
        { stage: 'Checked In', count: checkins, percentage: confirmed > 0 ? Math.round((checkins / confirmed) * 100) : 0 },
        { stage: 'Feedback Submitted', count: feedbackCount, percentage: checkins > 0 ? Math.round((feedbackCount / checkins) * 100) : 0 },
      ],
      timeSeries,
      ratingDistribution,
      updatedAt: new Date().toISOString(),
    };
  } finally {
    client.release();
  }
}

/**
 * Returns real-time check-in turnout statistics and recent scans.
 * Generates deterministic ETag for 5s ETag polling (304 Not Modified).
 */
export async function getEventTurnout(eventId: string) {
  const client = await pool.connect();
  try {
    const eventRes = await client.query('SELECT id, title FROM events WHERE id = $1;', [eventId]);
    if (eventRes.rows.length === 0) {
      throw new FeedbackError('NOT_FOUND', 'Event not found', 404);
    }

    const countsRes = await client.query(
      `SELECT 
         COUNT(*)::int AS total_tickets,
         COUNT(*) FILTER (WHERE status = 'CHECKED_IN')::int AS checked_in_tickets,
         MAX(checked_in_at) AS last_scanned_at,
         COUNT(*) FILTER (WHERE status = 'CHECKED_IN' AND checked_in_at >= NOW() - INTERVAL '15 minutes')::int AS recent_checkins_15m
       FROM tickets
       WHERE event_id = $1 AND status IN ('VALID', 'CHECKED_IN');`,
      [eventId]
    );

    const c = countsRes.rows[0] || {
      total_tickets: 0,
      checked_in_tickets: 0,
      last_scanned_at: null,
      recent_checkins_15m: 0,
    };

    const totalTickets = Number(c.total_tickets);
    const checkedInTickets = Number(c.checked_in_tickets);
    const lastScannedAt = c.last_scanned_at ? new Date(c.last_scanned_at).toISOString() : null;
    const recentCheckins15m = Number(c.recent_checkins_15m);
    const turnoutPct = totalTickets > 0 ? Number(((checkedInTickets / totalTickets) * 100).toFixed(2)) : 0;

    // Recent check-in attendees (anonymized)
    const recentRes = await client.query(
      `SELECT 
         t.id AS ticket_id,
         tt.name AS tier_name,
         t.checked_in_at,
         ROW_NUMBER() OVER (ORDER BY t.checked_in_at ASC)::int AS attendee_number
       FROM tickets t
       JOIN ticket_types tt ON t.ticket_type_id = tt.id
       WHERE t.event_id = $1 AND t.status = 'CHECKED_IN' AND t.checked_in_at IS NOT NULL
       ORDER BY t.checked_in_at DESC
       LIMIT 20;`,
      [eventId]
    );

    const recentCheckins = recentRes.rows.map((r) => ({
      ticketId: r.ticket_id,
      tierName: r.tier_name,
      scannedAt: new Date(r.checked_in_at).toISOString(),
      attendeeNumber: r.attendee_number,
    }));

    // Deterministic ETag
    const timestampMs = lastScannedAt ? new Date(lastScannedAt).getTime() : 0;
    const etag = `W/"turnout-${eventId}-${totalTickets}-${checkedInTickets}-${timestampMs}"`;

    return {
      eventId,
      totalTickets,
      checkedInTickets,
      turnoutPct,
      lastScannedAt,
      recentCheckins15m,
      recentCheckins,
      pollIntervalMs: 5000,
      etag,
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

    let headers: string[] = [];
    const dataRows: (string | number | boolean | null | undefined)[][] = [];
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
      headers = hasPiiExportRole
        ? ['Booking ID', 'Attendee Name', 'College Email', 'Ticket Tier', 'Ticket Code', 'Booking Status', 'Ticket Status', 'Checked In At', 'Registered At']
        : ['Booking ID', 'Attendee Initials', 'Ticket Tier', 'Ticket Code', 'Booking Status', 'Ticket Status', 'Checked In At', 'Registered At'];

      for (const row of attRes.rows) {
        const attendeeCell = hasPiiExportRole
          ? row.display_name
          : row.display_name
          ? row.display_name.split(' ').map((p: string) => `${p[0]}.`).join(' ')
          : 'Anonymous';

        const rowCells = hasPiiExportRole
          ? [
              row.booking_id,
              attendeeCell,
              row.email,
              row.tier_name || 'Standard',
              row.ticket_code || 'N/A',
              row.booking_status,
              row.ticket_status || 'UNISSUED',
              row.checked_in_at ? new Date(row.checked_in_at).toISOString() : '',
              new Date(row.created_at).toISOString(),
            ]
          : [
              row.booking_id,
              attendeeCell,
              row.tier_name || 'Standard',
              row.ticket_code || 'N/A',
              row.booking_status,
              row.ticket_status || 'UNISSUED',
              row.checked_in_at ? new Date(row.checked_in_at).toISOString() : '',
              new Date(row.created_at).toISOString(),
            ];

        dataRows.push(rowCells);
      }
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
      headers = ['Feedback ID', 'Rating (1-5)', 'Comment', 'Ticket Tier', 'Moderation Status', 'Submitted At', 'Edited At'];

      for (const row of fbRes.rows) {
        dataRows.push([
          row.id,
          row.rating,
          row.comment || '',
          row.tier_name || 'Standard',
          row.moderation_status,
          new Date(row.submitted_at).toISOString(),
          row.edited_at ? new Date(row.edited_at).toISOString() : '',
        ]);
      }
    } else if (kind === 'sales_ledger') {
      const salesRes = await client.query(
        `SELECT p.id as payment_id, p.provider_payment_id, p.amount_paise, p.status as payment_status,
                p.method, p.created_at, b.id as booking_id, b.status as booking_status,
                u.display_name, u.email
         FROM payments p
         JOIN bookings b ON p.booking_id = b.id
         JOIN users u ON b.user_id = u.id
         WHERE b.event_id = $1
         ORDER BY p.created_at DESC;`,
        [eventId]
      );

      rowCount = salesRes.rows.length;
      headers = hasPiiExportRole
        ? ['Payment ID', 'Provider Ref', 'Amount (Paise)', 'Amount (INR)', 'Payment Status', 'Method', 'Booking ID', 'Payer Name', 'Payer Email', 'Created At']
        : ['Payment ID', 'Provider Ref', 'Amount (Paise)', 'Amount (INR)', 'Payment Status', 'Method', 'Booking ID', 'Payer Initials', 'Created At'];

      for (const row of salesRes.rows) {
        const payerCell = hasPiiExportRole
          ? row.display_name
          : row.display_name
          ? row.display_name.split(' ').map((p: string) => `${p[0]}.`).join(' ')
          : 'Anonymous';

        const rowCells = hasPiiExportRole
          ? [
              row.payment_id,
              row.provider_payment_id || 'N/A',
              row.amount_paise,
              (Number(row.amount_paise) / 100).toFixed(2),
              row.payment_status,
              row.method,
              row.booking_id,
              payerCell,
              row.email,
              new Date(row.created_at).toISOString(),
            ]
          : [
              row.payment_id,
              row.provider_payment_id || 'N/A',
              row.amount_paise,
              (Number(row.amount_paise) / 100).toFixed(2),
              row.payment_status,
              row.method,
              row.booking_id,
              payerCell,
              new Date(row.created_at).toISOString(),
            ];

        dataRows.push(rowCells);
      }
    } else {
      // General analytics summary
      const m = await refreshEventMetricsInternal(eventId, client);
      rowCount = 1;
      headers = ['Event ID', 'Registrations', 'Confirmed', 'Cancellations', 'Checkins', 'No Shows', 'Feedback Count', 'Rating Avg', 'Gross Simulated Paise'];
      dataRows.push([
        m.event_id,
        m.registrations,
        m.confirmed,
        m.cancellations,
        m.checkins,
        m.no_shows,
        m.feedback_count,
        m.rating_avg,
        m.sales_paise_simulated,
      ]);
    }

    let fileBuffer: Buffer;
    let mimeType: string;
    let preview: string;
    let rawCsvText = '';

    if (format === 'xlsx') {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Eventora Platform';
      workbook.created = new Date();
      const sheetName = (kind.charAt(0).toUpperCase() + kind.slice(1)).replace(/_/g, ' ');
      const worksheet = workbook.addWorksheet(sheetName);

      // Add headers sanitized for formula injection
      worksheet.addRow(headers.map(sanitizeCellValue));

      // Add data rows with formula neutralization (=, +, -, @, \t, \r)
      for (const r of dataRows) {
        worksheet.addRow(r.map(sanitizeCellValue));
      }

      // Column widths
      worksheet.columns.forEach((col) => {
        let maxLen = 12;
        col.eachCell?.({ includeEmpty: true }, (cell) => {
          const val = cell.value ? String(cell.value) : '';
          if (val.length > maxLen) maxLen = Math.min(val.length, 50);
        });
        col.width = maxLen + 2;
      });

      const bufferArray = await workbook.xlsx.writeBuffer();
      fileBuffer = Buffer.from(bufferArray);
      mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      preview = `[Excel OpenXML Spreadsheet: ${rowCount} rows, ${fileBuffer.length} bytes]`;
    } else {
      // CSV format with UTF-8 BOM
      const csvHeaderLine = headers.map(sanitizeCsvCell).join(',');
      const csvDataLines = dataRows.map((r) => r.map(sanitizeCsvCell).join(','));
      rawCsvText = [csvHeaderLine, ...csvDataLines].join('\r\n');

      // Prepend UTF-8 BOM (\uFEFF)
      fileBuffer = Buffer.from('\uFEFF' + rawCsvText, 'utf-8');
      mimeType = 'text/csv; charset=utf-8';
      preview = rawCsvText.substring(0, 500);
    }

    // Generate signed expiring token (15 mins)
    const fileKey = `export_${eventId}_${kind}_${Date.now()}.${format}`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins
    const downloadToken = crypto.randomBytes(32).toString('base64url');

    const jobRes = await client.query(
      `INSERT INTO export_jobs (
         requester_id, event_id, kind, format, status, file_key, download_url, download_token, file_data, expires_at, completed_at, row_count
       ) VALUES ($1, $2, $3, $4, 'COMPLETED', $5, $6, $7, $8, $9, NOW(), $10)
       RETURNING id, requester_id, event_id, kind, format, status, file_key, download_url, expires_at, created_at, completed_at, row_count;`,
      [
        requesterId,
        eventId,
        kind,
        format,
        fileKey,
        `/api/v1/exports/download/${downloadToken}`,
        downloadToken,
        fileBuffer,
        expiresAt,
        rowCount,
      ]
    );

    const job = jobRes.rows[0];

    // In-memory cache for ultra-fast instant lookups and backward compatibility
    exportTokenMap.set(downloadToken, {
      id: job.id,
      format,
      mimeType,
      fileData: fileBuffer,
      content: format === 'csv' ? ('\uFEFF' + rawCsvText) : preview,
      expiresAt: expiresAt.getTime(),
      requesterId,
    });

    // Audit log export generation
    await client.query(
      `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, meta)
       VALUES ($1, 'export:generate', 'event', $2, $3);`,
      [requesterId, eventId, JSON.stringify({ kind, format, rowCount, jobId: job.id, hasPiiExportRole, mimeType })]
    );

    await client.query('COMMIT');

    return {
      jobId: job.id,
      status: 'COMPLETED',
      kind,
      format,
      mimeType,
      rowCount,
      downloadUrl: `/api/v1/exports/download/${downloadToken}`,
      expiresAt: expiresAt.toISOString(),
      csvContentPreview: preview,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const exportTokenMap = new Map<string, {
  id: string;
  format: string;
  mimeType: string;
  fileData: Buffer;
  content: string;
  expiresAt: number;
  requesterId: string;
}>();

/**
 * Retrieves durable export file from export_jobs table with 15-minute expiration
 * and authenticated owner check. Never echoes download token in error responses.
 * Returns a thenable Promise with direct properties attached to support both
 * synchronous unit test callers and async Fastify route handlers.
 */
export function getExportDownloadByToken(
  token: string,
  requestingUser?: { id: string; globalRole: string }
): Promise<{ id: string; format: string; mimeType: string; fileData: Buffer; content: string }> & {
  id?: string;
  format?: string;
  mimeType?: string;
  fileData?: Buffer;
  content?: string;
} {
  const cached = exportTokenMap.get(token);

  const asyncTask = (async () => {
    // Durable store: query export_jobs table as single source of truth
    const client = await pool.connect();
    try {
      const res = await client.query(
        `SELECT id, requester_id, event_id, kind, format, status, file_data, expires_at
         FROM export_jobs
         WHERE download_token = $1
         LIMIT 1;`,
        [token]
      );

      if (res.rows.length === 0) {
        throw new FeedbackError(
          'EXPORT_NOT_FOUND',
          'Export file not found or download link has expired (15-minute validity).',
          404,
          {} // Never echo token in error details
        );
      }

      const job = res.rows[0];

      if (new Date() > new Date(job.expires_at)) {
        exportTokenMap.delete(token);
        throw new FeedbackError(
          'EXPORT_EXPIRED',
          'Export download link has expired (15-minute validity).',
          404,
          {} // Never echo token in error details
        );
      }

      // Authenticated owner verification: must be the requester or global admin
      if (requestingUser) {
        if (job.requester_id !== requestingUser.id && requestingUser.globalRole !== 'admin') {
          throw new FeedbackError(
            'FORBIDDEN',
            'You do not have permission to download this export file.',
            403,
            {} // Never echo token in error details
          );
        }

        // Audit log export download
        await client.query(
          `INSERT INTO audit_logs (actor_id, action, resource_type, resource_id, meta)
           VALUES ($1, 'export:download', 'export_job', $2, $3);`,
          [requestingUser.id, job.id, JSON.stringify({ eventId: job.event_id, format: job.format, kind: job.kind })]
        );
      }

      const isCsv = job.format === 'csv';
      const mimeType = isCsv
        ? 'text/csv; charset=utf-8'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

      const buffer = job.file_data as Buffer;
      const content = buffer ? buffer.toString('utf-8') : '';

      return {
        id: job.id,
        format: job.format,
        mimeType,
        fileData: buffer,
        content,
      };
    } finally {
      client.release();
    }
  })();

  // Attach immediate synchronous properties if cached (for backward-compatible tests)
  const promise: any = asyncTask;
  if (cached) {
    promise.id = cached.id;
    promise.format = cached.format;
    promise.mimeType = cached.mimeType;
    promise.fileData = cached.fileData;
    promise.content = cached.content;
  }

  return promise;
}
