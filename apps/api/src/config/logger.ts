import pino from 'pino';
import { getEnv } from './env.js';

const env = getEnv();

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'passwordHash',
      'token',
      'refreshToken',
      'secret',
      'apiKey',
      'apiKeyHash',
      'coordinates',
      'geometry.coordinates',
    ],
    remove: true,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
