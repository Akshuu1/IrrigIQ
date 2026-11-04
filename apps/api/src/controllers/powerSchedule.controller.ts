import { Request, Response, NextFunction } from 'express';
import {
  powerScheduleService,
  PowerScheduleService,
} from '../services/powerSchedule.service.js';
import {
  createPowerScheduleSchema,
  updatePowerScheduleSchema,
} from '@irrigiq/shared';
import { AppError } from '../errors/AppError.js';

export class PowerScheduleController {
  constructor(private readonly service: PowerScheduleService = powerScheduleService) {}

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }

      const validated = createPowerScheduleSchema.parse(req.body);
      const schedule = await this.service.createSchedule(req.user.id, validated);

      res.status(201).json({
        status: 'success',
        data: {
          schedule,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }

      const schedules = await this.service.getSchedulesByUser(req.user.id);

      res.json({
        status: 'success',
        data: {
          schedules,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }

      const schedule = await this.service.getScheduleById(req.user.id, req.params.id as string);

      res.json({
        status: 'success',
        data: {
          schedule,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }

      const validated = updatePowerScheduleSchema.parse(req.body);
      const schedule = await this.service.updateSchedule(
        req.user.id,
        req.params.id as string,
        validated,
      );

      res.json({
        status: 'success',
        data: {
          schedule,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  delete = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }

      await this.service.deleteSchedule(req.user.id, req.params.id as string);

      res.json({
        status: 'success',
        message: 'Power schedule deleted successfully',
      });
    } catch (err) {
      next(err);
    }
  };

  ensurePreset = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }

      const presetType = req.params.type as string;
      if (presetType !== 'night' && presetType !== 'day') {
        throw new AppError('Invalid preset type. Allowed: night, day', 400, 'INVALID_PRESET');
      }

      const schedule = await this.service.ensurePreset(req.user.id, presetType);

      res.json({
        status: 'success',
        data: {
          schedule,
        },
      });
    } catch (err) {
      next(err);
    }
  };
}

export const powerScheduleController = new PowerScheduleController();

