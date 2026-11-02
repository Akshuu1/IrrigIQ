import { Router, RequestHandler } from 'express';
import { sensorController } from '../controllers/sensor.controller.js';
import { sensorRateLimiter } from '../middleware/rateLimiter.js';

const router = Router();

// Ingest sensor readings authenticated via API key
router.post(
  '/',
  sensorRateLimiter as unknown as RequestHandler,
  sensorController.ingestReadings,
);

export { router as sensorReadingRouter };
