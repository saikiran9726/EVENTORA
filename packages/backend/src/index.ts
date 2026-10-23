import { buildApp } from './app.js';
import { startOutboxWorker, stopOutboxWorker } from './services/outbox-worker.js';

const PORT = Number(process.env.PORT) || 4000;
const HOST = process.env.HOST || '0.0.0.0';

async function start() {
  const server = buildApp();
  try {
    await server.listen({ port: PORT, host: HOST });
    console.log(`[Eventora Backend] Server listening at http://${HOST}:${PORT}`);

    // In single-service deployments (e.g. Render free tier), run background outbox processing in-process
    startOutboxWorker();

    server.addHook('onClose', async () => {
      stopOutboxWorker();
    });
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

start();
