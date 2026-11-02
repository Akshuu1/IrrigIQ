import { Request, Response } from 'express';
import { checkMongoHealth } from '../infra/db.js';
import { checkRedisHealth } from '../infra/redis.js';

export async function getHealth(_req: Request, res: Response): Promise<void> {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
}

export async function getReady(_req: Request, res: Response): Promise<void> {
  const [mongoOk, redisOk] = await Promise.all([checkMongoHealth(), checkRedisHealth()]);

  const allReady = mongoOk && redisOk;
  const statusCode = allReady ? 200 : 503;

  res.status(statusCode).json({
    status: allReady ? 'ready' : 'unhealthy',
    checks: {
      mongo: mongoOk ? 'up' : 'down',
      redis: redisOk ? 'up' : 'down',
    },
    timestamp: new Date().toISOString(),
  });
}
