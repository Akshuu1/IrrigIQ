import { createApp } from './app.js';
import { getEnv } from './config/env.js';
import { logger } from './config/logger.js';
import { connectDb, disconnectDb } from './infra/db.js';
import { connectRedis, disconnectRedis } from './infra/redis.js';

const env = getEnv();
const app = createApp();

async function startServer(): Promise<void> {
  try {
    // Attempt connecting to infra (non-blocking if DB/Redis are booting)
    connectDb().catch((err) => {
      logger.warn({ err }, 'MongoDB initial connection failed - will retry on demand');
    });

    connectRedis().catch((err) => {
      logger.warn({ err }, 'Redis initial connection failed - will retry on demand');
    });

    const server = app.listen(env.PORT, () => {
      logger.info(
        { port: env.PORT, env: env.NODE_ENV },
        `🚀 IrrigIQ API listening on port ${env.PORT}`,
      );
    });

    const shutdown = async (signal: string) => {
      logger.info(`${signal} received, shutting down gracefully...`);
      server.close(async () => {
        await Promise.allSettled([disconnectDb(), disconnectRedis()]);
        logger.info('Clean shutdown complete');
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    logger.fatal({ error }, 'Failed to start API server');
    process.exit(1);
  }
}

// Only start when invoked directly
if (process.env.NODE_ENV !== 'test') {
  startServer();
}
