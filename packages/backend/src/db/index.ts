import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

const { Pool } = pg;

export const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://postgres@127.0.0.1:5433/eventora_db';

export const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 20, // Bounded connection pool per non-negotiables
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export const db = drizzle(pool, { schema });
