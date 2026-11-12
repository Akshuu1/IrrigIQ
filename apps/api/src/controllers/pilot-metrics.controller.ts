import { Request, Response, NextFunction } from 'express';
import { pilotMetricsService, PilotMetricsQueryParams } from '../services/pilot-metrics.service.js';
import { AppError } from '../errors/AppError.js';

export class PilotMetricsController {
  private parseQueryParams(req: Request): PilotMetricsQueryParams {
    const hasCustom = Boolean(req.body?.customRecords);
    const orgId =
      (req.orgId ? req.orgId.toString() : undefined) ||
      (req.params.orgId as string) ||
      (req.query.orgId as string) ||
      (hasCustom ? 'custom-pilot-org' : undefined);

    if (!orgId) {
      throw new AppError('Organisation ID is required for pilot metrics', 400, 'ORG_ID_REQUIRED');
    }

    const lang = req.query.lang === 'hi' ? 'hi' : 'en';

    const unitPrices: Record<string, number> = {};
    if (req.query.costPerMessage) {
      unitPrices.costPerMessage = parseFloat(req.query.costPerMessage as string);
    }
    if (req.query.costPerGbStorage) {
      unitPrices.costPerGbStorage = parseFloat(req.query.costPerGbStorage as string);
    }
    if (req.query.costPerThousandRequests) {
      unitPrices.costPerThousandRequests = parseFloat(req.query.costPerThousandRequests as string);
    }

    return {
      orgId,
      agentId: req.user?._id ? req.user._id.toString() : undefined,
      role: req.role,
      baselineStart: req.query.baselineStart as string | undefined,
      baselineEnd: req.query.baselineEnd as string | undefined,
      advisedStart: req.query.advisedStart as string | undefined,
      advisedEnd: req.query.advisedEnd as string | undefined,
      lang,
      unitPrices: Object.keys(unitPrices).length > 0 ? unitPrices : undefined,
      customRecords: (req.body?.customRecords as PilotMetricsQueryParams['customRecords']) || undefined,
    };
  }

  getMetrics = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const params = this.parseQueryParams(req);
      const metrics = await pilotMetricsService.computeMetrics(params);
      res.status(200).json({
        status: 'success',
        data: metrics,
      });
    } catch (err) {
      next(err);
    }
  };

  getPdfReport = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const params = this.parseQueryParams(req);
      const metrics = await pilotMetricsService.computeMetrics(params);
      const pdfBuffer = await pilotMetricsService.generatePdf(metrics);

      const filename = `irrigiq-pilot-report-${params.lang || 'en'}-${new Date().toISOString().split('T')[0]}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(pdfBuffer);
    } catch (err) {
      next(err);
    }
  };

  getCsvExport = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const params = this.parseQueryParams(req);
      const metrics = await pilotMetricsService.computeMetrics(params);
      const csvString = pilotMetricsService.generateCsv(metrics);

      const filename = `irrigiq-pilot-raw-data-${new Date().toISOString().split('T')[0]}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csvString);
    } catch (err) {
      next(err);
    }
  };
}

export const pilotMetricsController = new PilotMetricsController();
