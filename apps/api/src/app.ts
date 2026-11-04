import express, { Express, RequestHandler } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { getEnv } from './config/env.js';
import { logger } from './config/logger.js';
import { requestIdMiddleware } from './middleware/requestId.js';
import { errorHandler } from './middleware/errorHandler.js';
import { healthRouter } from './routes/health.routes.js';
import { authRouter } from './routes/auth.routes.js';
import { fieldRouter } from './routes/field.routes.js';
import { cropRouter } from './routes/crop.routes.js';
import { sensorReadingRouter } from './routes/sensor-reading.routes.js';
import { syncRouter } from './routes/sync.routes.js';
import { reportRouter } from './routes/report.routes.js';
import { pumpRouter } from './routes/pump.routes.js';
import { processDailyRecommendations } from './scheduler/recommendation.scheduler.js';

export function createApp(): Express {
  const env = getEnv();
  const app = express();

  // Security headers with crossOriginResourcePolicy for PDF & asset streaming
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }) as unknown as RequestHandler,
  );

  // CORS allowlist supporting specific origins, wildcards, and vercel.app domains
  const origins = env.CORS_ORIGIN.split(',').map((origin) => origin.trim());
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
        if (!origin || origins.includes(origin) || origins.includes('*')) {
          callback(null, true);
          return;
        }

        try {
          const parsed = new URL(origin);
          if (parsed.hostname.endsWith('.vercel.app')) {
            callback(null, true);
            return;
          }
        } catch {
          // ignore parsing error
        }

        callback(new Error(`Origin ${origin} not allowed by CORS`));
      },
      credentials: true,
    }),
  );

  // Request ID
  app.use(requestIdMiddleware);

  // Cookie parser
  app.use(cookieParser() as unknown as RequestHandler);

  // Request logging with pino (skip in test to keep output clean unless LOG_LEVEL is set)
  if (env.NODE_ENV !== 'test') {
    app.use(
      pinoHttp({
        logger,
        genReqId: (req) => req.id || 'unknown',
        customLogLevel: (_req, res, err) => {
          if (res.statusCode >= 500 || err) return 'error';
          if (res.statusCode >= 400) return 'warn';
          return 'info';
        },
      }),
    );
  }

  // Parse JSON bodies with request size limit protection
  app.use(express.json({ limit: '100kb' }) as unknown as RequestHandler);

  // Mount routes
  app.use('/', healthRouter);
  app.use('/auth', authRouter);
  app.use('/fields', fieldRouter);
  app.use('/crops', cropRouter);
  app.use('/sensor-readings', sensorReadingRouter);
  app.use('/sync', syncRouter);
  app.use('/reports', reportRouter);
  app.use('/pumps', pumpRouter);

  // External cron trigger for waking up free-tier cloud instances (e.g. Render/Fly.io)
  app.post('/scheduler/trigger-daily-recommendations', async (req, res) => {
    const authHeader = req.headers.authorization;
    const bearerSecret = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const customHeader = req.headers['x-cron-secret'] as string | undefined;
    const providedSecret = bearerSecret || customHeader;

    if (env.NODE_ENV === 'production' && providedSecret !== env.CRON_SECRET) {
      res.status(401).json({
        status: 'error',
        code: 'UNAUTHORIZED_CRON',
        message: 'Invalid or missing CRON_SECRET header',
      });
      return;
    }

    try {
      logger.info('External cron trigger received for daily recommendations');
      const stats = await processDailyRecommendations();
      res.status(200).json({
        status: 'success',
        message: 'Daily recommendations processed successfully via external trigger',
        data: stats,
      });
    } catch (err: unknown) {
      logger.error({ err }, 'External cron daily recommendations failed');
      res.status(500).json({
        status: 'error',
        code: 'CRON_EXECUTION_FAILED',
        message: 'Failed to process daily recommendations',
      });
    }
  });

  // 404 handler
  app.use((_req, res) => {
    res.status(404).json({
      status: 'error',
      code: 'NOT_FOUND',
      message: 'Resource not found',
    });
  });

  // Central error handler
  app.use(errorHandler);

  return app;
}
