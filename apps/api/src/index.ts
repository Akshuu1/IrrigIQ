import { createApp } from './app.js';
import { getEnv } from './config/env.js';
import { logger } from './config/logger.js';
import { connectDb, disconnectDb } from './infra/db.js';
import { connectRedis, disconnectRedis } from './infra/redis.js';
import {
  initRecommendationScheduler,
  stopRecommendationScheduler,
} from './scheduler/recommendation.scheduler.js';

const env = getEnv();
const app = createApp();

async function startServer(): Promise<void> {
  try {
    // Attempt connecting to infra (non-blocking if DB/Redis are booting)
    connectDb().catch((err) => {
      logger.warn({ err }, 'MongoDB initial connection failed - will retry on demand');
    });

    connectRedis()
      .then(async () => {
        // Initialize BullMQ recommendation scheduler when Redis is connected
        try {
          await initRecommendationScheduler();
          logger.info('BullMQ daily recommendation scheduler initialized (05:00 Asia/Kolkata)');
        } catch (schedulerErr) {
          logger.error({ err: schedulerErr }, 'Failed to initialize recommendation scheduler');
        }

        // Initialize BullMQ messages queue for WhatsApp / Telegram advisory delivery
        try {
          const { initMessagesQueue } = await import('./services/messaging/message.queue.js');
          initMessagesQueue();
          logger.info('BullMQ messages delivery queue initialized');
        } catch (msgQueueErr) {
          logger.error({ err: msgQueueErr }, 'Failed to initialize messages queue');
        }
      })
      .catch((err) => {
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
        await Promise.allSettled([
          stopRecommendationScheduler(),
          disconnectDb(),
          disconnectRedis(),
        ]);
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
