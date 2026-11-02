import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../errors/AppError.js';
import { logger } from '../config/logger.js';
import { getEnv } from '../config/env.js';

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const env = getEnv();
  const reqId = req.id || 'unknown';

  if (err instanceof ZodError) {
    logger.warn({ reqId, errors: err.issues }, 'Validation failed');
    res.status(400).json({
      status: 'error',
      code: 'VALIDATION_ERROR',
      message: 'Invalid request input',
      errors: err.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return;
  }

  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error({ reqId, err }, err.message);
    } else {
      logger.warn({ reqId, err }, err.message);
    }

    res.status(err.statusCode).json({
      status: 'error',
      code: err.code,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
    return;
  }

  // Unhandled / system errors
  logger.error({ reqId, err }, 'Unhandled exception');
  res.status(500).json({
    status: 'error',
    code: 'INTERNAL_SERVER_ERROR',
    message:
      env.NODE_ENV === 'production'
        ? 'An unexpected error occurred'
        : (err as Error)?.message || 'Internal error',
  });
}
