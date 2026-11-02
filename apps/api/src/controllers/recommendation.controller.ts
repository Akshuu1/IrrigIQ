import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  getRecommendationsForField,
  recomputeField,
} from '../services/recommendation.service.js';
import { FieldModel } from '../models/field.model.js';
import { AppError } from '../errors/AppError.js';
import { Types } from 'mongoose';

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
      if (!Types.ObjectId.isValid(fieldId)) {
        throw new AppError('Field not found', 404, 'FIELD_NOT_FOUND');
      }

      // Strict ownership check
      const field = await FieldModel.findOne({
        _id: new Types.ObjectId(fieldId),
        userId: new Types.ObjectId(req.user.id),
      });

      if (!field) {
        throw new AppError('Field not found', 404, 'FIELD_NOT_FOUND');
      }

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
}

export const recommendationController = new RecommendationController();
