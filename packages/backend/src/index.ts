import { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { startOutboxWorker, stopOutboxWorker } from './services/outbox-worker.js';
import { startHoldReconcilerWorker, stopHoldReconcilerWorker } from './services/hold-reconciler.js';
import { startEventCompleterWorker, stopEventCompleterWorker } from './services/event-scheduler.js';
import { pool } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { seedDatabase } from './db/seed.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { captureException } from './lib/sentry.js';

const PORT = Number(process.env.PORT) || 4000;
const HOST = process.env.HOST || '0.0.0.0';

export function createGracefulShutdown(server: FastifyInstance, targetPool = pool) {
  let isShuttingDown = false;

  return async function shutdown(signal: string, exitCode = 0) {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info(`[Eventora Backend] Received ${signal}, initiating graceful shutdown sequence...`);

    // Safety timeout: force exit if cleanup takes longer than 10 seconds
    const forceExitTimer = setTimeout(() => {
      logger.fatal(`[Eventora Backend] Graceful shutdown timed out after 10s. Forcing exit.`);
      if (process.env.NODE_ENV !== 'test') {
        process.exit(1);
      }
    }, 10000);
    forceExitTimer.unref();

    try {
      // 1. Stop accepting new HTTP requests and drain in-flight connections
      logger.info('[Eventora Backend] 1/3 Stopping HTTP server and draining connections...');
      await server.close();

      // 2. Stop background scheduler and worker loops
      logger.info('[Eventora Backend] 2/3 Stopping background workers and schedulers...');
      stopOutboxWorker();
      stopHoldReconcilerWorker();
      stopEventCompleterWorker();

      // 3. Close database connection pool
      logger.info('[Eventora Backend] 3/3 Closing database connection pool...');
      await targetPool.end();

      clearTimeout(forceExitTimer);
      logger.info('[Eventora Backend] Graceful shutdown completed cleanly.');
      if (process.env.NODE_ENV !== 'test') {
        process.exit(exitCode);
      }
    } catch (err) {
      clearTimeout(forceExitTimer);
      logger.error({ err }, '[Eventora Backend] Error during graceful shutdown.');
      if (process.env.NODE_ENV !== 'test') {
        process.exit(1);
      }
    }
  };
}

async function ensureDatabaseSchema() {
  if (process.env.AUTO_MIGRATE === 'false') {
    return;
  }

  let needsMigration = false;
  let needsSeed = false;

  try {
    const client = await pool.connect();
    try {
      const migRes = await client.query<{ current_version: number | null }>(
        'SELECT MAX(version) as current_version FROM schema_migrations;'
      );
      const version = migRes.rows[0]?.current_version ?? 0;
      if (version < 17) {
        needsMigration = true;
      }
    } catch (err: any) {
      if (err.code === '42P01') {
        // Table schema_migrations does not exist
        needsMigration = true;
      } else {
        console.warn('[Eventora Backend] Migration probe warning:', err.message);
        needsMigration = true;
      }
    } finally {
      client.release();
    }
  } catch (connErr: any) {
    console.error('[Eventora Backend] Database connection check failed:', connErr.message);
    throw connErr;
  }

  if (needsMigration) {
    console.log('[Eventora Backend] Database schema uninitialized or pending. Applying migrations...');
    await runMigrations();
    console.log('[Eventora Backend] Migrations applied successfully.');
    needsSeed = true;
  }

  // Production startup must never automatically seed privileged accounts with default passwords
  const isProduction = process.env.NODE_ENV === 'production';
  const shouldSeed = isProduction ? process.env.AUTO_SEED === 'true' : (needsSeed || process.env.AUTO_SEED === 'true');

  if (shouldSeed) {
    try {
      console.log('[Eventora Backend] Running controlled database seed...');
      await seedDatabase();
      console.log('[Eventora Backend] Controlled database seed completed.');
    } catch (seedErr: any) {
      console.warn('[Eventora Backend] Seed warning (non-fatal):', seedErr?.message || seedErr);
    }
  }
}

async function start() {
  const server = buildApp();
  const shutdown = createGracefulShutdown(server);

  // Process lifecycle signals
  process.on('SIGTERM', () => shutdown('SIGTERM', 0));
  process.on('SIGINT', () => shutdown('SIGINT', 0));

  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, '[Eventora Backend] Uncaught exception encountered');
    captureException(err, { context: 'uncaughtException' });
    shutdown('uncaughtException', 1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, '[Eventora Backend] Unhandled promise rejection encountered');
    captureException(reason, { context: 'unhandledRejection' });
    shutdown('unhandledRejection', 1);
  });

  try {
    await ensureDatabaseSchema();

    await server.listen({ port: PORT, host: HOST });
    logger.info(`[Eventora Backend] Server listening at http://${HOST}:${PORT}`);

    // In production without RUN_IN_PROCESS_WORKER, background tasks are handled by Dockerfile.worker
    const isProduction = process.env.NODE_ENV === 'production';
    if (isProduction && !config.RUN_IN_PROCESS_WORKER) {
      logger.info('[Eventora Backend] Standalone worker mode enabled; skipping in-process workers.');
    } else {
      logger.info('[Eventora Backend] Starting background workers in-process...');
      startOutboxWorker();
      startHoldReconcilerWorker();
      startEventCompleterWorker();
    }
  } catch (err) {
    logger.fatal({ err }, '[Eventora Backend] Failed to initialize server');
    captureException(err, { context: 'serverStartup' });
    await shutdown('startupFailure', 1);
  }
}

// Wrap start() in a catch to guarantee fatal startup errors are caught and logged
start().catch((err) => {
  logger.fatal({ err }, '[Eventora Backend] Fatal unhandled error in start()');
  process.exit(1);
});
