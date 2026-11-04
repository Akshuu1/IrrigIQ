import { Request, Response, NextFunction } from 'express';
import { pumpService, PumpService } from '../services/pump.service.js';
import { createPumpSchema, updatePumpSchema } from '@irrigiq/shared';
import { AppError } from '../errors/AppError.js';

export class PumpController {
  constructor(private readonly service: PumpService = pumpService) {}

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }

      const validated = createPumpSchema.parse(req.body);
      const pump = await this.service.createPump(req.user.id, validated);

      res.status(201).json({
        status: 'success',
        data: {
          pump,
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

      const pumps = await this.service.getPumpsByUser(req.user.id);

      res.json({
        status: 'success',
        data: {
          pumps,
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

      const pump = await this.service.getPumpById(req.user.id, req.params.id as string);

      res.json({
        status: 'success',
        data: {
          pump,
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

      const validated = updatePumpSchema.parse(req.body);
      const pump = await this.service.updatePump(
        req.user.id,
        req.params.id as string,
        validated,
      );

      res.json({
        status: 'success',
        data: {
          pump,
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

      await this.service.deletePump(req.user.id, req.params.id as string);

      res.json({
        status: 'success',
        message: 'Pump deleted successfully',
      });
    } catch (err) {
      next(err);
    }
  };
}

export const pumpController = new PumpController();

