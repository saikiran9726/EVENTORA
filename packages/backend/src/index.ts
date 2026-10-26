import { buildApp } from './app.js';
import { startOutboxWorker, stopOutboxWorker } from './services/outbox-worker.js';
import { startHoldReconcilerWorker, stopHoldReconcilerWorker } from './services/hold-reconciler.js';
import { startEventCompleterWorker, stopEventCompleterWorker } from './services/event-scheduler.js';
import { pool } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { seedDatabase } from './db/seed.js';

const PORT = Number(process.env.PORT) || 4000;
const HOST = process.env.HOST || '0.0.0.0';

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
      if (version < 16) {
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

  // Register lifecycle hooks before starting the server
  server.addHook('onClose', async () => {
    stopOutboxWorker();
    stopHoldReconcilerWorker();
    stopEventCompleterWorker();
  });

  const shutdown = async (signal: string) => {
    console.log(`[Eventora Backend] Received ${signal}, shutting down gracefully...`);
    try {
      await server.close();
      process.exit(0);
    } catch (err) {
      server.log.error(err);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  try {
    await ensureDatabaseSchema();

    await server.listen({ port: PORT, host: HOST });
    console.log(`[Eventora Backend] Server listening at http://${HOST}:${PORT}`);

    // In single-service deployments (e.g. Render free tier), run background workers in-process
    startOutboxWorker();
    startHoldReconcilerWorker();
    startEventCompleterWorker();
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

start();
