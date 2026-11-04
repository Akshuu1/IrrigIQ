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
  SOILGRIDS_ENABLED: z.coerce.boolean().default(true),
  TELEGRAM_BOT_TOKEN: z.string().default('test-bot-token'),
  TELEGRAM_BOT_USERNAME: z.string().default('IrrigIQBot'),
  TELEGRAM_WEBHOOK_SECRET: z.string().default('irrigiq-telegram-webhook-secret-token'),
  CHAT_ENCRYPTION_KEY: z.string().min(32).default('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'),
  // Phase 21: WhatsApp Cloud API (optional, enabled only when set)
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  // Phase 21: Web Push VAPID credentials
  VAPID_PUBLIC_KEY: z
    .string()
    .default('BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'),
  VAPID_PRIVATE_KEY: z.string().default('UUxI2A9Kz_6L4k9m3n8B2v1c5x7z9A8b7c6d5e4f3a2'),
  VAPID_SUBJECT: z.string().default('mailto:advisory@irrigiq.org'),
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
