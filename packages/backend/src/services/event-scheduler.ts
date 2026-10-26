import { pool } from '../db/index.js';
import { transitionEventStatus } from './event-lifecycle.js';

export const EVENT_COMPLETER_ADVISORY_LOCK_ID = 4208002;

let completerInterval: NodeJS.Timeout | null = null;
let isRunning = false;

export interface EventCompleterJobResult {
  executed: boolean;
  acquired: boolean;
  completedCount?: number;
  eventIds?: string[];
  reason?: string;
  error?: any;
}

/**
 * Finds all published events whose end time is in the past (ends_at <= NOW())
 * and auto-transitions them to 'completed' with audit history.
 * Optionally targets a specific event ID for direct scheduling verification.
 */
export async function autoCompleteEndedEvents(targetEventId?: string): Promise<{ completedCount: number; eventIds: string[] }> {
  const client = await pool.connect();
  const completedIds: string[] = [];

  try {
    const expiredRes = targetEventId
      ? await client.query<{ id: string; status: string }>(
          `SELECT id, status FROM events
           WHERE id = $1 AND status = 'published' AND ends_at <= NOW();`,
          [targetEventId]
        )
      : await client.query<{ id: string; status: string }>(
          `SELECT id, status FROM events
           WHERE status = 'published' AND ends_at <= NOW()
           ORDER BY ends_at ASC
           LIMIT 200;`
        );

    for (const row of expiredRes.rows) {
      try {
        await transitionEventStatus(
          row.id,
          'published',
          'completed',
          {
            actorId: 'system',
            actorRole: 'system',
            note: 'Auto-completed by system scheduler after ends_at',
          }
        );
        completedIds.push(row.id);
      } catch (transErr: any) {
        console.warn(`[EventScheduler] Could not auto-complete event ${row.id}:`, transErr.message);
      }
    }

    return {
      completedCount: completedIds.length,
      eventIds: completedIds,
    };
  } finally {
    client.release();
  }
}

/**
 * Runs a single event auto-completion cycle protected by a PostgreSQL session-level advisory lock.
 * Guarantees exactly one leader node in a cluster processes event completions.
 */
export async function runEventCompletionLeaderJob(): Promise<EventCompleterJobResult> {
  const client = await pool.connect();
  let acquired = false;

  try {
    const lockRes = await client.query(
      `SELECT pg_try_advisory_lock($1) as acquired;`,
      [EVENT_COMPLETER_ADVISORY_LOCK_ID]
    );

    acquired = Boolean(lockRes.rows[0]?.acquired);

    if (!acquired) {
      return {
        executed: false,
        acquired: false,
        reason: 'LOCKED_BY_ANOTHER_LEADER',
      };
    }

    const result = await autoCompleteEndedEvents();
    return {
      executed: true,
      acquired: true,
      completedCount: result.completedCount,
      eventIds: result.eventIds,
    };
  } catch (err: any) {
    console.error('[EventScheduler] Error during auto-completion leader job:', err);
    return {
      executed: false,
      acquired,
      error: err,
    };
  } finally {
    if (acquired) {
      try {
        await client.query(`SELECT pg_advisory_unlock($1);`, [EVENT_COMPLETER_ADVISORY_LOCK_ID]);
      } catch (unlockErr) {
        console.warn('[EventScheduler] Warning releasing advisory lock:', unlockErr);
      }
    }
    client.release();
  }
}

/**
 * Starts the background event completer worker running periodically (default 60s).
 */
export function startEventCompleterWorker(intervalMs = 60000) {
  if (isRunning) return;
  isRunning = true;

  completerInterval = setInterval(async () => {
    try {
      await runEventCompletionLeaderJob();
    } catch {
      // Non-fatal in background interval
    }
  }, intervalMs);
}

/**
 * Gracefully stops the background event completer worker.
 */
export function stopEventCompleterWorker() {
  if (completerInterval) {
    clearInterval(completerInterval);
    completerInterval = null;
  }
  isRunning = false;
}
