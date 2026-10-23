import { buildApp } from './app.js';
import { startOutboxWorker, stopOutboxWorker } from './services/outbox-worker.js';

const PORT = Number(process.env.PORT) || 4000;
const HOST = process.env.HOST || '0.0.0.0';

async function start() {
  const server = buildApp();

  // Register lifecycle hooks before starting the server
  server.addHook('onClose', async () => {
    stopOutboxWorker();
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
    await server.listen({ port: PORT, host: HOST });
    console.log(`[Eventora Backend] Server listening at http://${HOST}:${PORT}`);

    // In single-service deployments (e.g. Render free tier), run background outbox processing in-process
    startOutboxWorker();
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

start();
