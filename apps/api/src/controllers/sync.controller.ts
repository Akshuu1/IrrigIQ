import { Request, Response, NextFunction } from 'express';
import { SyncBatchRequestSchema } from '@irrigiq/shared';
import { SyncService } from '../services/sync.service.js';
import { AppError } from '../errors/AppError.js';

export class SyncController {
  private syncService = new SyncService();

  batchSync = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }

      const validated = SyncBatchRequestSchema.parse(req.body);
      const results = await this.syncService.processSyncBatch(req.user.id, validated.mutations);

      res.status(200).json({
        status: 'success',
        results,
        data: {
          results,
        },
      });
    } catch (err) {
      next(err);
    }
  };
}

