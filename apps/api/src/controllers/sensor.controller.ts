import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { SensorService, sensorService } from '../services/sensor.service.js';
import {
  createSensorSchema,
  ingestReadingSchema,
  moistureQuerySchema,
} from '../schemas/sensor.schema.js';
import { FieldModel } from '../models/field.model.js';
import { userRepository } from '../repositories/user.repository.js';
import { subscribeFieldMoisture } from '../infra/event-bus.js';
import { getEnv } from '../config/env.js';
import { AppError } from '../errors/AppError.js';
import { logger } from '../config/logger.js';

export class SensorController {
  constructor(private readonly service: SensorService = sensorService) {}

  createSensor = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }

      const validated = createSensorSchema.parse(req.body);
      const result = await this.service.createSensor(
        req.user.id,
        req.params.id as string,
        validated,
      );

      res.status(201).json({
        status: 'success',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  getSensors = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }

      const sensors = await this.service.getSensors(
        req.user.id,
        req.params.id as string,
      );

      res.json({
        status: 'success',
        data: {
          sensors,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  ingestReadings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Authenticate via x-api-key header or Authorization: Bearer <key>
      let apiKey = req.header('x-api-key');
      if (!apiKey) {
        const authHeader = req.header('authorization');
        if (authHeader && authHeader.startsWith('Bearer ')) {
          apiKey = authHeader.substring(7).trim();
        }
      }

      if (!apiKey) {
        throw new AppError('Sensor API key required in x-api-key or Authorization header', 401, 'INVALID_API_KEY');
      }

      const validated = ingestReadingSchema.parse(req.body);
      const result = await this.service.ingestReadings(apiKey, validated);

      res.status(200).json({
        status: 'success',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  getMoisture = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }

      const query = moistureQuerySchema.parse(req.query);
      const readings = await this.service.getMoistureHistory(
        req.user.id,
        req.params.id as string,
        query.from,
        query.to,
      );

      res.json({
        status: 'success',
        data: {
          readings,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  moistureStream = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Support both header auth and ?token= query auth for EventSource clients
      let userId: string | null = req.user ? req.user.id : null;

      if (!userId) {
        const tokenQuery = req.query.token as string | undefined;
        if (tokenQuery) {
          const env = getEnv();
          try {
            const decoded = jwt.verify(tokenQuery, env.JWT_SECRET) as { sub?: string };
            if (decoded.sub) {
              const user = await userRepository.findById(decoded.sub);
              if (user) {
                userId = user._id.toString();
              }
            }
          } catch {
            throw new AppError('Invalid or expired stream token', 401, 'UNAUTHORIZED');
          }
        }
      }

      if (!userId) {
        throw new AppError('Authentication required for moisture stream', 401, 'UNAUTHORIZED');
      }

      const fieldId = req.params.id as string;
      if (!Types.ObjectId.isValid(fieldId)) {
        throw new AppError('Field not found', 404, 'FIELD_NOT_FOUND');
      }

      // Verify field ownership
      const field = await FieldModel.findOne({
        _id: new Types.ObjectId(fieldId),
        userId: new Types.ObjectId(userId),
      });

      if (!field) {
        throw new AppError('Field not found', 404, 'FIELD_NOT_FOUND');
      }

      // Set up Server-Sent Events headers
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders?.();

      // Send initial connection event
      res.write(`event: connected\ndata: ${JSON.stringify({ status: 'connected', fieldId })}\n\n`);

      // Send latest reading if available
      const latest = await this.service.getLatestReading(field._id);
      if (latest) {
        res.write(`data: ${JSON.stringify(latest)}\n\n`);
      }

      // Heartbeat every 25 seconds to keep connection alive through proxies
      const heartbeat = setInterval(() => {
        try {
          res.write(': heartbeat\n\n');
        } catch {
          clearInterval(heartbeat);
        }
      }, 25000);

      // Subscribe to field's live moisture events
      const unsubscribe = subscribeFieldMoisture(fieldId, (reading) => {
        try {
          res.write(`data: ${JSON.stringify(reading)}\n\n`);
        } catch (err: unknown) {
          logger.debug({ err, fieldId }, 'Failed writing to SSE stream');
        }
      });

      // Cleanup on disconnect
      req.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
        res.end();
      });
    } catch (err) {
      next(err);
    }
  };
}

export const sensorController = new SensorController();
