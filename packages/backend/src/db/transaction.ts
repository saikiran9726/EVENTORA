import { PoolClient } from 'pg';
import { pool } from './index.js';

export interface TransactionRetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  isolationLevel?: 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';
}

export const RETRYABLE_PG_CODES = new Set(['40001', '40P01']); // 40001: serialization_failure, 40P01: deadlock_detected

/**
 * Checks whether an error is a transient PostgreSQL transaction conflict
 * that can be safely retried.
 */
export function isRetryableTransactionError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const pgErr = err as { code?: string; message?: string };
  return RETRYABLE_PG_CODES.has(pgErr.code || '');
}

/**
 * Executes a callback within a managed PostgreSQL transaction,
 * automatically retrying with exponential backoff and jitter upon
 * encountering 40001 (serialization_failure) or 40P01 (deadlock_detected).
 */
export async function withTransactionRetry<T>(
  callback: (client: PoolClient) => Promise<T>,
  options: TransactionRetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 5;
  const baseDelayMs = options.baseDelayMs ?? 40;
  const maxDelayMs = options.maxDelayMs ?? 1000;
  const isolationLevel = options.isolationLevel ?? 'READ COMMITTED';

  let attempt = 0;

  while (true) {
    const client = await pool.connect();
    try {
      if (isolationLevel === 'READ COMMITTED') {
        await client.query('BEGIN');
      } else {
        await client.query(`BEGIN TRANSACTION ISOLATION LEVEL ${isolationLevel}`);
      }

      const result = await callback(client);

      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Rollback error ignored on dead socket
      }

      attempt++;
      if (attempt <= maxRetries && isRetryableTransactionError(err)) {
        // Full jitter exponential backoff: base * 2^attempt + jitter
        const exponentialDelay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1));
        const jitter = Math.floor(Math.random() * (exponentialDelay / 2));
        const totalDelay = exponentialDelay + jitter;

        await new Promise((resolve) => setTimeout(resolve, totalDelay));
        continue;
      }

      throw err;
    } finally {
      client.release();
    }
  }
}
