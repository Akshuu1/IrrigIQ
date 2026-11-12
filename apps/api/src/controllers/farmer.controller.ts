import { Request, Response, NextFunction } from 'express';
import { farmerService } from '../services/farmer.service.js';
import { createFarmerSchema, updateFarmerSchema } from '../schemas/farmer.schema.js';
import { AppError } from '../errors/AppError.js';

export class FarmerController {
  createFarmer = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user || !req.orgId || !req.role) {
        throw new AppError('Organisation context required', 401, 'UNAUTHORIZED');
      }

      const input = createFarmerSchema.parse(req.body);
      const farmer = await farmerService.createFarmer(req.orgId, req.user._id, req.role, input);

      res.status(201).json({
        status: 'success',
        data: {
          farmer,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  listFarmers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user || !req.orgId || !req.role) {
        throw new AppError('Organisation context required', 401, 'UNAUTHORIZED');
      }

      const farmers = await farmerService.listFarmers(req.orgId, req.user._id, req.role);

      res.status(200).json({
        status: 'success',
        data: {
          farmers,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  getFarmer = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user || !req.orgId || !req.role) {
        throw new AppError('Organisation context required', 401, 'UNAUTHORIZED');
      }

      const farmerId = req.params.id as string;
      const farmer = await farmerService.getFarmer(req.orgId, req.user._id, req.role, farmerId);

      res.status(200).json({
        status: 'success',
        data: {
          farmer,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  updateFarmer = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user || !req.orgId || !req.role) {
        throw new AppError('Organisation context required', 401, 'UNAUTHORIZED');
      }

      const farmerId = req.params.id as string;
      const input = updateFarmerSchema.parse(req.body);
      const updated = await farmerService.updateFarmer(
        req.orgId,
        req.user._id,
        req.role,
        farmerId,
        input,
      );

      res.status(200).json({
        status: 'success',
        data: {
          farmer: updated,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  deleteFarmer = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user || !req.role) {
        throw new AppError('Organisation context required', 401, 'UNAUTHORIZED');
      }

      const orgId = req.orgId!;
      const farmerId = req.params.id as string;
      await farmerService.deleteFarmer(orgId, req.user._id, req.role, farmerId);

      res.status(200).json({
        status: 'success',
        message: 'Farmer deleted successfully',
      });
    } catch (err) {
      next(err);
    }
  };
}

export const farmerController = new FarmerController();
