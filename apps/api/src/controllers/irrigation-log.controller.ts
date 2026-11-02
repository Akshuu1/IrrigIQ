import { Request, Response, NextFunction } from 'express';
import {
  IrrigationLogService,
  irrigationLogService,
} from '../services/irrigation-log.service.js';
import {
  createIrrigationLogSchema,
  listLogsQuerySchema,
  savingsQuerySchema,
} from '../schemas/irrigation-log.schema.js';
import { AppError } from '../errors/AppError.js';

export class IrrigationLogController {
  constructor(private readonly service: IrrigationLogService = irrigationLogService) {}

  createLog = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }

      const validated = createIrrigationLogSchema.parse(req.body);
      const log = await this.service.createLog(
        req.user.id,
        req.params.id as string,
        validated,
      );

      res.status(201).json({
        status: 'success',
        data: {
          log,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  listLogs = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }

      const query = listLogsQuerySchema.parse(req.query);
      const logs = await this.service.getLogs(
        req.user.id,
        req.params.id as string,
        query,
      );

      res.json({
        status: 'success',
        data: {
          logs,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  deleteLog = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }

      await this.service.deleteLog(
        req.user.id,
        req.params.id as string,
        req.params.logId as string,
      );

      res.json({
        status: 'success',
        message: 'Irrigation log deleted successfully',
      });
    } catch (err) {
      next(err);
    }
  };

  getSavings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }

      const { from, to } = savingsQuerySchema.parse(req.query);
      const savings = await this.service.calcSavings(
        req.user.id,
        req.params.id as string,
        from,
        to,
      );

      res.json({
        status: 'success',
        data: savings,
      });
    } catch (err) {
      next(err);
    }
  };
}

export const irrigationLogController = new IrrigationLogController();
