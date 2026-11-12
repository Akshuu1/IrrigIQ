import { Request, Response, NextFunction } from 'express';
import { farmerService } from '../services/farmer.service.js';
import { farmerImportService, parseCSV } from '../services/farmer-import.service.js';
import { consentService } from '../services/consent.service.js';
import { whatsappShareService } from '../services/whatsapp-share.service.js';
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

  importFarmers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user || !req.orgId || !req.role) {
        throw new AppError('Organisation context required', 401, 'UNAUTHORIZED');
      }

      let rows = req.body.rows;
      if (!rows && req.body.csv) {
        rows = parseCSV(req.body.csv);
      } else if (typeof req.body === 'string') {
        rows = parseCSV(req.body);
      }

      const dryRun =
        req.query.dryRun === 'true' ||
        req.body.dryRun === true ||
        req.query['--dry-run'] !== undefined ||
        req.body['--dry-run'] === true;

      const result = await farmerImportService.processImport(
        req.orgId,
        req.user._id,
        req.role,
        rows || [],
        dryRun,
      );

      res.status(200).json({
        status: 'success',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  recordConsent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user || !req.orgId) {
        throw new AppError('Organisation context required', 401, 'UNAUTHORIZED');
      }

      const farmerId = req.params.id as string;
      const { method, language, textVersion } = req.body;

      if (!method) {
        throw new AppError('Consent method is required', 400, 'INVALID_METHOD');
      }

      const consent = await consentService.recordConsent({
        farmerId,
        recordedBy: req.user._id,
        method,
        language,
        textVersion,
      });

      res.status(201).json({
        status: 'success',
        data: {
          consent,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  getConsent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const farmerId = req.params.id as string;
      const hasActiveConsent = await consentService.hasActiveConsent(farmerId);
      const consent = await consentService.getLatestConsent(farmerId);

      res.status(200).json({
        status: 'success',
        data: {
          hasActiveConsent,
          consent,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  withdrawConsent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const farmerId = req.params.id as string;
      const modifiedCount = await consentService.withdrawConsent(farmerId);

      res.status(200).json({
        status: 'success',
        data: {
          withdrawn: true,
          count: modifiedCount,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  shareWhatsApp = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user || !req.orgId) {
        throw new AppError('Organisation context required', 401, 'UNAUTHORIZED');
      }

      const farmerId = req.params.id as string;
      const { digestText } = req.body;

      const result = await whatsappShareService.generateShareUrl(
        req.orgId,
        req.user._id,
        farmerId,
        digestText,
      );

      res.status(200).json({
        status: 'success',
        data: {
          url: result.url,
          digestText: result.digestText,
          sharedAt: result.shareLog.sharedAt,
        },
      });
    } catch (err) {
      next(err);
    }
  };
}

export const farmerController = new FarmerController();

