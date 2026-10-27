import { pool } from './db/index.js';
import { startOutboxWorker, stopOutboxWorker } from './services/outbox-worker.js';
import { startHoldReconcilerWorker, stopHoldReconcilerWorker } from './services/hold-reconciler.js';
import { startEventCompleterWorker, stopEventCompleterWorker } from './services/event-scheduler.js';

console.log('[Eventora Worker] Initializing standalone background worker process...');

// Start background workers
startOutboxWorker();
startHoldReconcilerWorker();
startEventCompleterWorker();

console.log('[Eventora Worker] Background workers started (Outbox, Hold Reconciler, Event Completer).');

const shutdown = async (signal: string) => {
  console.log(`[Eventora Worker] Received ${signal}. Shutting down worker loops gracefully...`);
  stopOutboxWorker();
  stopHoldReconcilerWorker();
  stopEventCompleterWorker();
  try {
    await pool.end();
  } catch (err) {
    console.error('[Eventora Worker] Error closing database pool:', err);
  }
  console.log('[Eventora Worker] Worker process terminated gracefully.');
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
