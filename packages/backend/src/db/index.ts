import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

const { Pool } = pg;

const isProduction = process.env.NODE_ENV === 'production';

// Fail-fast in production if DATABASE_URL is not set (never fall back to localhost in production)
if (isProduction && (!process.env.DATABASE_URL || process.env.DATABASE_URL.trim() === '')) {
  console.error('[Database Config Error] DATABASE_URL is not set');
  process.exit(1);
}

export const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://postgres@127.0.0.1:5433/eventora_db';
const requiresSsl =
  isProduction ||
  DATABASE_URL.includes('supabase.co') ||
  DATABASE_URL.includes('supabase.com') ||
  DATABASE_URL.includes('sslmode=require');

export const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: requiresSsl ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.DB_POOL_MAX) || 20, // Bounded connection pool per non-negotiables
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export const db = drizzle(pool, { schema });
