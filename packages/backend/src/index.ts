import { buildApp } from './app.js';

const PORT = Number(process.env.PORT) || 4000;
const HOST = process.env.HOST || '0.0.0.0';

async function start() {
  const server = buildApp();
  try {
    await server.listen({ port: PORT, host: HOST });
    console.log(`[Eventora Backend] Server listening at http://${HOST}:${PORT}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

start();
