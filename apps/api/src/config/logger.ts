import pino from 'pino';
import { getEnv } from './env.js';

const env = getEnv();

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-api-key"]',
      'req.headers["x-sensor-api-key"]',
      'req.headers["x-cron-secret"]',
      'req.body.password',
      'req.body.token',
      'req.body.refreshToken',
      'req.body.apiKey',
      'password',
      'passwordHash',
      'token',
      'refreshToken',
      'secret',
      'apiKey',
      'apiKeyHash',
      'coordinates',
      'geometry.coordinates',
      'polygon.coordinates',
      'centroid.coordinates',
      'req.body.coordinates',
      'req.body.geometry.coordinates',
      'req.body.polygon.coordinates',
      'req.body.centroid.coordinates',
    ],
    remove: true,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
