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

export function createApp(): Express {
  const env = getEnv();
  const app = express();

  // Security headers
  app.use(helmet() as unknown as RequestHandler);

  // CORS allowlist
  const origins = env.CORS_ORIGIN.split(',').map((origin) => origin.trim());
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (e.g. mobile apps, curl)
        if (!origin || origins.includes(origin) || origins.includes('*')) {
          callback(null, true);
        } else {
          callback(new Error(`Origin ${origin} not allowed by CORS`));
        }
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

  // Parse JSON bodies
  app.use(express.json() as unknown as RequestHandler);

  // Mount routes
  app.use('/', healthRouter);
  app.use('/auth', authRouter);
  app.use('/fields', fieldRouter);
  app.use('/crops', cropRouter);

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
