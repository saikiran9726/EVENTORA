import { pool } from '../db/index.js';

export interface RetentionPurgeOptions {
  scanLogRetentionDays?: number;
  outboxRetentionDays?: number;
  sessionRetentionDays?: number;
  tokenRetentionDays?: number;
  metricsRetentionDays?: number;
}

export interface RetentionPurgeResult {
  scanLogPurged: number;
  outboxPurged: number;
  sessionsPurged: number;
  tokensPurged: number;
  metricsPurged: number;
  startedAt: string;
  completedAt: string;
}

/**
 * Executes statutory data retention cleanup jobs across scan logs,
 * outbox messages, sessions, expired auth tokens, and metrics.
 */
export async function runDataRetentionPurge(
  options: RetentionPurgeOptions = {}
): Promise<RetentionPurgeResult> {
  const scanLogDays = options.scanLogRetentionDays ?? 90;
  const outboxDays = options.outboxRetentionDays ?? 30;
  const sessionDays = options.sessionRetentionDays ?? 30;
  const tokenDays = options.tokenRetentionDays ?? 7;
  const metricsDays = options.metricsRetentionDays ?? 90;

  const startedAt = new Date().toISOString();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Purge scan_log
    const scanLogRes = await client.query(
      `DELETE FROM scan_log
       WHERE at < NOW() - ($1 || ' days')::INTERVAL;`,
      [scanLogDays]
    );
    const scanLogPurged = scanLogRes.rowCount || 0;

    // 2. Purge processed / dead outbox records
    const outboxRes = await client.query(
      `DELETE FROM outbox
       WHERE status IN ('DONE', 'DEAD')
         AND (processed_at < NOW() - ($1 || ' days')::INTERVAL
              OR (processed_at IS NULL AND created_at < NOW() - ($1 || ' days')::INTERVAL));`,
      [outboxDays]
    );
    const outboxPurged = outboxRes.rowCount || 0;

    // 3. Purge expired / revoked sessions
    const sessionRes = await client.query(
      `DELETE FROM sessions
       WHERE expires_at < NOW() - ($1 || ' days')::INTERVAL
          OR (revoked_at IS NOT NULL AND revoked_at < NOW() - ($1 || ' days')::INTERVAL);`,
      [sessionDays]
    );
    const sessionsPurged = sessionRes.rowCount || 0;

    // 4. Purge expired password resets and auth tokens
    const resetRes = await client.query(
      `DELETE FROM password_resets
       WHERE expires_at < NOW() - ($1 || ' days')::INTERVAL
          OR (used_at IS NOT NULL AND used_at < NOW() - ($1 || ' days')::INTERVAL);`,
      [tokenDays]
    );
    const tokensPurged = resetRes.rowCount || 0;

    // 5. Purge old ops_runs metrics
    const metricsRes = await client.query(
      `DELETE FROM ops_runs
       WHERE kind = 'retention_purge'
         AND started_at < NOW() - ($1 || ' days')::INTERVAL;`,
      [metricsDays]
    );
    const metricsPurged = metricsRes.rowCount || 0;

    const completedAt = new Date().toISOString();

    // 6. Record run outcome in ops_runs
    await client.query(
      `INSERT INTO ops_runs (kind, started_at, finished_at, outcome, evidence_ref)
       VALUES ('retention_purge', $1, $2, 'SUCCESS', $3);`,
      [
        startedAt,
        completedAt,
        JSON.stringify({
          scanLogPurged,
          outboxPurged,
          sessionsPurged,
          tokensPurged,
          metricsPurged,
        }),
      ]
    );

    await client.query('COMMIT');

    return {
      scanLogPurged,
      outboxPurged,
      sessionsPurged,
      tokensPurged,
      metricsPurged,
      startedAt,
      completedAt,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
