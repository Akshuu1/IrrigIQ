import { Request, Response, NextFunction } from 'express';
import { reportService } from '../services/report.service.js';
import { scheduleOrRunReportGeneration } from '../scheduler/report.scheduler.js';
import { createReportSchema } from '../schemas/report.schema.js';
import { ReportModel } from '../models/report.model.js';
import { checkFieldAccess } from '../services/rbac.service.js';

export class ReportController {
  async createReport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const fieldId = req.params.id as string;
      const parsedBody = createReportSchema.parse(req.body);
      const userId = req.user!.id;

      const { report } = await reportService.createReport(
        userId,
        fieldId,
        parsedBody,
        req.orgId,
        req.role,
      );
      const generated = await scheduleOrRunReportGeneration(report._id.toString());

      if (generated.status === 'completed') {
        res.status(201).json({
          id: generated._id.toString(),
          status: 'completed',
          report: {
            id: generated._id.toString(),
            fieldId: generated.fieldId.toString(),
            from: generated.from,
            to: generated.to,
            language: generated.language,
            status: generated.status,
            data: generated.data,
            createdAt: generated.createdAt,
          },
        });
        return;
      }

      // If still processing after 2 seconds
      res.status(202).json({
        id: generated._id.toString(),
        status: 'processing',
        message: 'Report generation in progress',
      });
    } catch (err) {
      next(err);
    }
  }

  async getReport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const reportId = req.params.id as string;
      const userId = req.user!.id;

      const report = await reportService.getReportById(userId, reportId);

      res.status(200).json({
        id: report._id.toString(),
        fieldId: report.fieldId.toString(),
        status: report.status,
        from: report.from,
        to: report.to,
        language: report.language,
        data: report.data,
        error: report.error,
        createdAt: report.createdAt,
        updatedAt: report.updatedAt,
      });
    } catch (err) {
      next(err);
    }
  }

  async getReportPdf(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const reportId = req.params.id as string;
      const userId = req.user!.id;

      const { buffer, filename } = await reportService.getReportPdf(userId, reportId);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
      res.setHeader('Content-Length', buffer.length.toString());
      res.status(200).send(buffer);
    } catch (err) {
      next(err);
    }
  }

  async listFieldReports(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const fieldId = req.params.id as string;
      const field = await checkFieldAccess(fieldId, req.user!._id, req.orgId, req.role);

      const reports = await ReportModel.find({
        fieldId: field._id,
      })
        .select('-pdfBuffer')
        .sort({ createdAt: -1 })
        .limit(20);

      res.status(200).json({
        reports: reports.map((r) => ({
          id: r._id.toString(),
          fieldId: r.fieldId.toString(),
          status: r.status,
          from: r.from,
          to: r.to,
          language: r.language,
          createdAt: r.createdAt,
        })),
      });
    } catch (err) {
      next(err);
    }
  }
}

export const reportController = new ReportController();

