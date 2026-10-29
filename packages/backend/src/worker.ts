import { pool } from './db/index.js';
import { startOutboxWorker, stopOutboxWorker } from './services/outbox-worker.js';
import { startHoldReconcilerWorker, stopHoldReconcilerWorker } from './services/hold-reconciler.js';
import { startEventCompleterWorker, stopEventCompleterWorker } from './services/event-scheduler.js';
import { logger } from './logger.js';
import { initWorkerSentry, captureException } from './lib/sentry.js';

// Initialize Sentry for background worker
initWorkerSentry();

logger.info('[Eventora Worker] Initializing standalone background worker process...');

// Start background workers
startOutboxWorker();
startHoldReconcilerWorker();
startEventCompleterWorker();

logger.info('[Eventora Worker] Background workers started (Outbox, Hold Reconciler, Event Completer).');

let isShuttingDown = false;

const shutdown = async (signal: string, exitCode = 0) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`[Eventora Worker] Received ${signal}. Shutting down worker loops gracefully...`);

  // Stop background processing loops
  stopOutboxWorker();
  stopHoldReconcilerWorker();
  stopEventCompleterWorker();

  // Close database pool
  try {
    await pool.end();
  } catch (err) {
    logger.error({ err }, '[Eventora Worker] Error closing database pool:');
  }

  logger.info('[Eventora Worker] Worker process terminated gracefully.');
  if (process.env.NODE_ENV !== 'test') {
    process.exit(exitCode);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM', 0));
process.on('SIGINT', () => shutdown('SIGINT', 0));

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, '[Eventora Worker] Uncaught exception in worker process');
  captureException(err, { context: 'workerUncaughtException' });
  shutdown('uncaughtException', 1);
});

process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, '[Eventora Worker] Unhandled promise rejection in worker process');
  captureException(reason, { context: 'workerUnhandledRejection' });
  shutdown('unhandledRejection', 1);
});
