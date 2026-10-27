import { z } from 'zod';

const ConfigSchema = z.object({
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().default('postgres://postgres:postgres@localhost:5433/eventora'),
  REDIS_URL: z.string().optional().default(''),
  COOKIE_SECRET: z.string().min(16).default('development-cookie-secret-min-32-chars-long-secure-key'),
  JWT_SECRET: z.string().min(16).default('development-jwt-secret-min-32-chars-long-secure-key'),
  PAYMENT_ADAPTER: z.enum(['simulator', 'sandbox']).default('simulator'),
  PAYMENT_WEBHOOK_SECRET: z.string().default('whsec_simulated_test_secret_for_development'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  METRICS_SECRET: z.string().default('internal-metrics-token-for-prometheus-scraper'),
  DB_POOL_MAX: z.coerce.number().default(20),
  WORKER_HEARTBEAT_THRESHOLD_SECONDS: z.coerce.number().default(30),
  INTERNAL_NETWORK_CIDR: z.string().default('127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16'),
  AUTH_RATE_LIMIT_REGISTER_MAX: z.coerce.number().default(10),
  APP_HOST: z.string().default('campus.eventora.org'),
  APP_URL: z.string().default('http://localhost:5173'),
  QR_HMAC_SECRET: z.string().default('qr_hmac_secret_key_32_bytes_min_prod'),
  EMAIL_ADAPTER: z.enum(['resend', 'console', 'test']).default('test'),
  EMAIL_FROM: z.string().default('Eventora <notifications@eventora.org>'),
  RESEND_API_KEY: z.string().optional().default(''),
  RESEND_WEBHOOK_SECRET: z.string().optional().default(''),
  RUN_IN_PROCESS_WORKER: z.preprocess((v) => v === 'true' || v === true, z.boolean()).default(false),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

let parsedConfig: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (parsedConfig) return parsedConfig;

  const result = ConfigSchema.safeParse(process.env);
  if (!result.success) {
    console.error('❌ FATAL: Invalid application environment configuration:');
    console.error(result.error.format());
    throw new Error('Environment configuration validation failed at boot.');
  }

  parsedConfig = result.data;
  return parsedConfig;
}

export const config = loadConfig();
