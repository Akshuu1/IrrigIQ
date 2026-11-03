import { Request, Response, NextFunction } from 'express';
import { getRedisClient } from '../infra/redis.js';
import { logger } from '../config/logger.js';
import { getEnv } from '../config/env.js';

interface RateLimitOptions {
  windowSeconds?: number;
  maxRequests?: number;
  prefix?: string;
  message?: string;
  keyGenerator?: (req: Request) => string;
}

// In-memory fallback if Redis is unavailable or in mock mode
const memoryStore = new Map<string, { count: number; expiresAt: number }>();

export function createRateLimiter(options: RateLimitOptions = {}) {
  const {
    windowSeconds = 60,
    maxRequests = 20,
    prefix = 'ratelimit',
    message = 'Too many requests, please try again later.',
    keyGenerator,
  } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const env = getEnv();

    // In test environment, bypass unless test explicitly wants to test rate limiting
    if (env.NODE_ENV === 'test' && !req.headers['x-test-rate-limit']) {
      return next();
    }

    const identifier = keyGenerator
      ? keyGenerator(req)
      : req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${prefix}:${identifier}`;

    try {
      const redis = getRedisClient();

      if (redis.status === 'ready' || redis.status === 'connect') {
        const count = await redis.incr(key);
        if (count === 1) {
          await redis.expire(key, windowSeconds);
        }

        const ttl = await redis.ttl(key);
        res.setHeader('X-RateLimit-Limit', maxRequests);
        res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - count));

        if (count > maxRequests) {
          res.setHeader('Retry-After', ttl > 0 ? ttl : windowSeconds);
          res.status(429).json({
            status: 'error',
            code: 'TOO_MANY_REQUESTS',
            message,
          });
          return;
        }

        return next();
      }
    } catch (err) {
      logger.warn({ err }, 'Redis rate limiter failed, falling back to memory counter');
    }

    // In-memory fallback
    const now = Date.now();
    const entry = memoryStore.get(key);

    if (!entry || entry.expiresAt <= now) {
      memoryStore.set(key, { count: 1, expiresAt: now + windowSeconds * 1000 });
      return next();
    }

    entry.count += 1;
    if (entry.count > maxRequests) {
      const retryAfter = Math.ceil((entry.expiresAt - now) / 1000);
      res.setHeader('Retry-After', retryAfter);
      res.status(429).json({
        status: 'error',
        code: 'TOO_MANY_REQUESTS',
        message,
      });
      return;
    }

    return next();
  };
}

export const createAuthRateLimiter = (options: RateLimitOptions = {}) =>
  createRateLimiter({
    prefix: 'ratelimit:auth',
    message: 'Too many authentication attempts, please try again later.',
    ...options,
  });

export const authRateLimiter = createAuthRateLimiter();

export const recomputeRateLimiter = createRateLimiter({
  windowSeconds: 60,
  maxRequests: 10,
  prefix: 'ratelimit:recompute',
  message: 'Too many recomputation requests, please try again later.',
});

export const sensorRateLimiter = createRateLimiter({
  windowSeconds: 60,
  maxRequests: 120,
  prefix: 'ratelimit:sensor',
  message: 'Too many sensor readings sent, please slow down.',
  keyGenerator: (req: Request) => {
    const sensorKey = (
      (req.headers['x-api-key'] as string) ||
      (req.headers['x-sensor-api-key'] as string) ||
      (req.headers['authorization'] as string)?.replace(/^Bearer\s+/i, '')
    )?.trim();
    if (sensorKey) return sensorKey;
    return req.ip || req.socket.remoteAddress || 'unknown';
  },
});
