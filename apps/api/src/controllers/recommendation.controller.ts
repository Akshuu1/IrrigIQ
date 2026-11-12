import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  getRecommendationsForField,
  recomputeField,
  rescheduleForNoPower,
} from '../services/recommendation.service.js';
import { checkFieldAccess } from '../services/rbac.service.js';
import { AppError } from '../errors/AppError.js';

const recommendationsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(14).default(7),
});

export class RecommendationController {
  getForField = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }

      const { days } = recommendationsQuerySchema.parse(req.query);
      const recommendations = await getRecommendationsForField(
        req.user.id,
        req.params.id as string,
        days,
        req.orgId,
        req.role,
      );

      res.json({
        status: 'success',
        data: {
          recommendations,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  recompute = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }

      const fieldId = req.params.id as string;
      const field = await checkFieldAccess(fieldId, req.user._id, req.orgId, req.role);
      const recommendations = await recomputeField(field._id);

      res.json({
        status: 'success',
        data: {
          recommendations,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  reportNoPower = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }

      const fieldId = req.params.id as string;
      const field = await checkFieldAccess(fieldId, req.user._id, req.orgId, req.role);

      const date = (req.body?.date as string) || (req.query?.date as string);
      const result = await rescheduleForNoPower(field._id, date);

      res.json({
        status: 'success',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };
}

export const recommendationController = new RecommendationController();
