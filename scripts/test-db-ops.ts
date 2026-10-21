import { pool } from '../packages/backend/src/db/index.js';

async function main() {
  const client = await pool.connect();
  try {
    const a = await client.query('SELECT COUNT(*) FROM audit_logs;');
    const s = await client.query('SELECT COUNT(*) FROM scan_log;');
    console.log(`audit_logs count: ${a.rows[0].count}, scan_log count: ${s.rows[0].count}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
