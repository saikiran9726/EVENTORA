import { pool } from '../db/index.js';
import { reconcileExpiredHolds } from './payment.js';

export const HOLD_RECONCILER_ADVISORY_LOCK_ID = 4208001;

let reconcilerInterval: NodeJS.Timeout | null = null;
let isRunning = false;

export interface ReconcilerJobResult {
  executed: boolean;
  acquired: boolean;
  reconciledCount?: number;
  reason?: string;
  error?: any;
}

/**
 * Runs a single hold reconciliation cycle protected by a PostgreSQL session-level advisory lock.
 * Ensures exactly one backend instance acts as leader across clustered deployments.
 */
export async function runHoldReconciliationLeaderJob(): Promise<ReconcilerJobResult> {
  const client = await pool.connect();
  let acquired = false;

  try {
    const lockRes = await client.query(
      `SELECT pg_try_advisory_lock($1) as acquired;`,
      [HOLD_RECONCILER_ADVISORY_LOCK_ID]
    );

    acquired = Boolean(lockRes.rows[0]?.acquired);

    if (!acquired) {
      return {
        executed: false,
        acquired: false,
        reason: 'LOCKED_BY_ANOTHER_LEADER',
      };
    }

    const result = await reconcileExpiredHolds();
    return {
      executed: true,
      acquired: true,
      reconciledCount: result.reconciledCount,
    };
  } catch (err: any) {
    console.error('[HoldReconciler] Error during hold reconciliation job:', err);
    return {
      executed: false,
      acquired,
      error: err,
    };
  } finally {
    if (acquired) {
      try {
        await client.query(`SELECT pg_advisory_unlock($1);`, [HOLD_RECONCILER_ADVISORY_LOCK_ID]);
      } catch (unlockErr) {
        console.warn('[HoldReconciler] Warning releasing advisory lock:', unlockErr);
      }
    }
    client.release();
  }
}

/**
 * Starts the background hold reconciler worker running periodically (default 60s).
 */
export function startHoldReconcilerWorker(intervalMs = 60000) {
  if (isRunning) return;
  isRunning = true;

  reconcilerInterval = setInterval(async () => {
    try {
      await runHoldReconciliationLeaderJob();
    } catch {
      // Non-fatal in background loop
    }
  }, intervalMs);
}

/**
 * Stops the background hold reconciler worker gracefully.
 */
export function stopHoldReconcilerWorker() {
  if (reconcilerInterval) {
    clearInterval(reconcilerInterval);
    reconcilerInterval = null;
  }
  isRunning = false;
}
