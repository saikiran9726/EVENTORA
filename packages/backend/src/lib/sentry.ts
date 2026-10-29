import * as Sentry from '@sentry/node';
import { logger } from '../logger.js';

let isBackendSentryInitialized = false;
let isWorkerSentryInitialized = false;

// In-memory alert history for testing, audits and telemetry
export interface AlertEvent {
  kind: '5xx_rate' | 'p95_latency' | 'dead_letter' | 'payment_mismatch' | 'reconciliation_drift' | 'worker_heartbeat';
  message: string;
  details: Record<string, any>;
  timestamp: string;
}

export const alertHistory: AlertEvent[] = [];

export function getAlertHistory(): AlertEvent[] {
  return [...alertHistory];
}

export function clearAlertHistory(): void {
  alertHistory.length = 0;
}

/**
 * Initializes Sentry for Fastify backend API process.
 */
export function initBackendSentry(dsn = process.env.SENTRY_DSN) {
  if (isBackendSentryInitialized) return;

  const release = process.env.SENTRY_RELEASE || process.env.npm_package_version || '1.0.0';
  const environment = process.env.NODE_ENV || 'development';

  if (dsn) {
    Sentry.init({
      dsn,
      release,
      environment,
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
      attachStacktrace: true,
    });
    logger.info({ release, environment }, '[Sentry] Backend monitoring initialized.');
  } else {
    logger.debug('[Sentry] SENTRY_DSN not provided; Sentry backend in no-op simulation mode.');
  }

  isBackendSentryInitialized = true;
}

/**
 * Initializes Sentry for standalone background worker process.
 */
export function initWorkerSentry(dsn = process.env.SENTRY_DSN) {
  if (isWorkerSentryInitialized) return;

  const release = process.env.SENTRY_RELEASE || process.env.npm_package_version || '1.0.0';
  const environment = process.env.NODE_ENV || 'development';

  if (dsn) {
    Sentry.init({
      dsn,
      release,
      environment,
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    });
    logger.info({ release, environment }, '[Sentry] Worker monitoring initialized.');
  }

  isWorkerSentryInitialized = true;
}

/**
 * Captures an exception with requestId and contextual tags.
 */
export function captureException(error: unknown, context: { requestId?: string; userId?: string; [key: string]: any } = {}) {
  const { requestId, userId, ...extra } = context;

  logger.error(
    {
      err: error,
      requestId,
      userId,
      ...extra,
    },
    `[Exception Captured] ${error instanceof Error ? error.message : String(error)}`
  );

  if (process.env.SENTRY_DSN) {
    Sentry.withScope((scope) => {
      if (requestId) scope.setTag('requestId', requestId);
      if (userId) scope.setUser({ id: userId });
      for (const [key, val] of Object.entries(extra)) {
        scope.setExtra(key, val);
      }
      Sentry.captureException(error);
    });
  }
}

// -----------------------------------------------------------------------------
// Operational Alerts
// -----------------------------------------------------------------------------

function recordAlert(kind: AlertEvent['kind'], message: string, details: Record<string, any>) {
  const alert: AlertEvent = {
    kind,
    message,
    details,
    timestamp: new Date().toISOString(),
  };

  alertHistory.push(alert);
  if (alertHistory.length > 500) {
    alertHistory.shift();
  }

  logger.error(
    { alertKind: kind, alertDetails: details },
    `[CRITICAL ALERT] ${kind.toUpperCase()}: ${message}`
  );

  if (process.env.SENTRY_DSN) {
    Sentry.captureMessage(`[CRITICAL ALERT] ${kind}: ${message}`, {
      level: 'fatal',
      tags: { alertKind: kind },
      extra: details,
    });
  }

  return alert;
}

/**
 * Alert: 5xx error rate exceeds threshold over sliding window.
 */
export function trigger5xxAlert(rate: number, windowSeconds = 300) {
  return recordAlert('5xx_rate', `5xx error rate exceeded threshold: ${(rate * 100).toFixed(2)}% over ${windowSeconds}s`, {
    rate,
    windowSeconds,
  });
}

/**
 * Alert: p95 latency exceeds threshold.
 */
export function triggerP95Alert(p95Ms: number, thresholdMs = 1000) {
  return recordAlert('p95_latency', `p95 latency ${p95Ms.toFixed(1)}ms exceeded threshold ${thresholdMs}ms`, {
    p95Ms,
    thresholdMs,
  });
}

/**
 * Alert: Outbox message marked as dead letter.
 */
export function triggerDeadLetterAlert(messageId: string | number, reason: string) {
  return recordAlert('dead_letter', `Outbox message ${messageId} reached max retry limit: ${reason}`, {
    messageId,
    reason,
  });
}

/**
 * Alert: Payment amount or currency mismatch between local ledger and gateway.
 */
export function triggerPaymentMismatchAlert(details: Record<string, any>) {
  return recordAlert('payment_mismatch', `Payment reconciliation mismatch detected`, details);
}

/**
 * Alert: Inventory or financial drift discovered during reconciliation.
 */
export function triggerDriftAlert(details: Record<string, any>) {
  return recordAlert('reconciliation_drift', `Ledger or ticket inventory drift detected`, details);
}

/**
 * Alert: Worker heartbeat threshold breached.
 */
export function triggerWorkerHeartbeatAlert(lastHeartbeatSecondsAgo: number, thresholdSeconds = 30) {
  return recordAlert('worker_heartbeat', `Worker heartbeat missed: ${lastHeartbeatSecondsAgo}s ago (threshold: ${thresholdSeconds}s)`, {
    lastHeartbeatSecondsAgo,
    thresholdSeconds,
  });
}
