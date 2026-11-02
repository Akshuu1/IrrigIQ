import { Request, Response, NextFunction } from 'express';
import { FieldService, fieldService } from '../services/field.service.js';
import {
  createFieldSchema,
  updateFieldSchema,
  nearbyFieldsQuerySchema,
} from '../schemas/field.schema.js';
import { RecommendationModel } from '../models/recommendation.model.js';
import { AppError } from '../errors/AppError.js';

export class FieldController {
  constructor(private readonly service: FieldService = fieldService) {}

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }

      const validated = createFieldSchema.parse(req.body);
      const field = await this.service.createField(req.user.id, validated);
      const plan = await RecommendationModel.find({ fieldId: field._id }).sort({ forDate: 1 });

      res.status(201).json({
        status: 'success',
        data: {
          field,
          plan,
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

      const fields = await this.service.getFields(req.user.id);

      res.json({
        status: 'success',
        data: {
          fields,
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

      const field = await this.service.getFieldById(req.user.id, req.params.id as string);

      res.json({
        status: 'success',
        data: {
          field,
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

      const validated = updateFieldSchema.parse(req.body);
      const field = await this.service.updateField(req.user.id, req.params.id as string, validated);

      res.json({
        status: 'success',
        data: {
          field,
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

      await this.service.deleteField(req.user.id, req.params.id as string);

      res.status(200).json({
        status: 'success',
        message: 'Field deleted successfully',
      });
    } catch (err) {
      next(err);
    }
  };

  getNearby = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }

      const validatedQuery = nearbyFieldsQuerySchema.parse(req.query);
      const fields = await this.service.getNearbyFields(
        req.user.id,
        validatedQuery.lng,
        validatedQuery.lat,
        validatedQuery.km,
      );

      res.json({
        status: 'success',
        data: {
          fields,
        },
      });
    } catch (err) {
      next(err);
    }
  };
}

export const fieldController = new FieldController();
