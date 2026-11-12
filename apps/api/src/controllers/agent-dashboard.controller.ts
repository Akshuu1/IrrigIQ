import { Request, Response, NextFunction } from 'express';
import { agentDashboardService } from '../services/agent-dashboard.service.js';
import { processOutboundMessage } from '../services/messaging/message.queue.js';
import { AppError } from '../errors/AppError.js';

export class AgentDashboardController {
  getTodayDashboard = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.user || !req.orgId || !req.role) {
        throw new AppError('Organisation context required', 401, 'UNAUTHORIZED');
      }

      const queryParams = {
        date: typeof req.query.date === 'string' ? req.query.date : undefined,
        village: typeof req.query.village === 'string' ? req.query.village : undefined,
        needsWater: req.query.needsWater === 'true',
        notYetSent: req.query.notYetSent === 'true',
        noReply2Days: req.query.noReply2Days === 'true',
        search: typeof req.query.search === 'string' ? req.query.search : undefined,
      };

      const result = await agentDashboardService.getTodayDashboard(
        req.orgId,
        req.user._id,
        req.role,
        queryParams,
      );

      res.status(200).json({
        status: 'success',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  markStatus = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.user || !req.orgId || !req.role) {
        throw new AppError('Organisation context required', 401, 'UNAUTHORIZED');
      }

      const farmerId = (req.params.id || req.body.farmerId) as string;
      const { fieldId, status, reason, text, date } = req.body;

      if (!status || !['followed', 'not followed', 'note'].includes(status)) {
        throw new AppError('Valid status is required', 400, 'INVALID_STATUS');
      }

      const note = await agentDashboardService.markStatus(
        req.orgId,
        req.user._id,
        req.role,
        {
          farmerId,
          fieldId,
          status,
          reason,
          text,
          date,
        },
      );

      res.status(200).json({
        status: 'success',
        data: {
          note,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  bulkSendPending = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.user || !req.orgId || !req.role) {
        throw new AppError('Organisation context required', 401, 'UNAUTHORIZED');
      }

      const result = await agentDashboardService.bulkSendPending(
        req.orgId,
        req.user._id,
        req.role,
      );

      res.status(200).json({
        status: 'success',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  getFarmerTimeline = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.user || !req.orgId || !req.role) {
        throw new AppError('Organisation context required', 401, 'UNAUTHORIZED');
      }

      const farmerId = req.params.id as string;
      const result = await agentDashboardService.getFarmerTimeline(
        req.orgId,
        req.user._id,
        req.role,
        farmerId,
      );

      res.status(200).json({
        status: 'success',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };

  sendFarmerAdvisory = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.user || !req.orgId || !req.role) {
        throw new AppError('Organisation context required', 401, 'UNAUTHORIZED');
      }

      const farmerId = req.params.id as string;
      const { channelId, text } = req.body;

      if (!channelId || !text) {
        throw new AppError('channelId and text are required', 400, 'BAD_REQUEST');
      }

      const result = await processOutboundMessage({
        channelId,
        userId: req.user._id.toString(),
        text,
        farmerId,
        ignoreQuietHours: true,
      });

      res.status(200).json({
        status: 'success',
        data: result,
      });
    } catch (err) {
      next(err);
    }
  };
}

export const agentDashboardController = new AgentDashboardController();

