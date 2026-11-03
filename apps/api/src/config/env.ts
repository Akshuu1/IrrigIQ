import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .env if not in production or test
if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: path.resolve(__dirname, '../../.env') });
}

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4001),
  MONGODB_URI: z.string().default('mongodb://localhost:27018/irrigiq'),
  REDIS_URL: z.string().default('redis://localhost:6380'),
  CORS_ORIGIN: z.string().default('http://localhost:3000,http://localhost:3001,http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  JWT_SECRET: z.string().min(32).default('development-super-secret-jwt-key-min-32-chars-long'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  REFRESH_TOKEN_EXPIRES_DAYS: z.coerce.number().default(7),
  CRON_SECRET: z.string().default('development-cron-secret-key-min-16-chars'),
  COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('strict'),
});

export type Env = z.infer<typeof EnvSchema>;

let cachedEnv: Env | null = null;

export function getEnv(): Env {
  if (cachedEnv) {
    return cachedEnv;
  }

  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    console.error('❌ Invalid environment variables:', result.error.format());
    throw new Error('Invalid environment configuration');
  }

  cachedEnv = result.data;
  return cachedEnv;
}
