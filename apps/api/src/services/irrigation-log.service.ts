import { Types } from 'mongoose';
import {
  calculateDaysInRange,
  computeSavings,
  IRRIGATION_EFFICIENCY,
  IrrigationMethod,
} from '@irrigiq/shared';
import { FieldModel } from '../models/field.model.js';
import {
  IrrigationLogModel,
  IIrrigationLogDocument,
} from '../models/irrigation-log.model.js';
import { RecommendationModel } from '../models/recommendation.model.js';
import { CreateIrrigationLogInput } from '../schemas/irrigation-log.schema.js';
import { recomputeField } from './recommendation.service.js';
import { AppError } from '../errors/AppError.js';
import { logger } from '../config/logger.js';

export interface SavingsResponse {
  fieldId: string;
  from: string;
  to: string;
  days: number;
  totals: {
    baseline: {
      count: number;
      depthMm: number;
      totalMm: number;
      litres: number;
    };
    recommended: {
      count: number;
      totalMm: number;
      litres: number;
    };
    actual: {
      count: number;
      totalMm: number;
      litres: number;
    };
    potentialSaved: {
      mm: number;
      litres: number;
      pct: number;
    };
    realisedSaved: {
      mm: number;
      litres: number;
      pct: number;
    };
  };
  assumptions: {
    method: string;
    efficiency: number;
    areaHa: number;
    baseline: {
      everyDays: number;
      depthMm: number;
    };
    baselineNote: string;
  };
}

export class IrrigationLogService {
  /**
   * Logs an irrigation event on a field.
   * Resets the soil deficit and triggers recommendation recomputation.
   */
  async createLog(
    userId: string,
    fieldId: string,
    input: CreateIrrigationLogInput,
  ): Promise<IIrrigationLogDocument> {
    if (!Types.ObjectId.isValid(fieldId)) {
      throw new AppError('Field not found', 404, 'FIELD_NOT_FOUND');
    }

    const field = await FieldModel.findOne({
      _id: new Types.ObjectId(fieldId),
      userId: new Types.ObjectId(userId),
    });

    if (!field) {
      throw new AppError('Field not found', 404, 'FIELD_NOT_FOUND');
    }

    const log = await IrrigationLogModel.create({
      fieldId: field._id,
      userId: field.userId,
      date: input.date,
      appliedMm: input.appliedMm,
      source: input.source,
      note: input.note,
    });

    // Logging irrigation resets the deficit and triggers recomputeField
    try {
      await recomputeField(field._id);
    } catch (err: unknown) {
      logger.warn({ err, fieldId: field._id }, 'Recompute failed after creating irrigation log');
    }

    return log;
  }

  /**
   * Lists irrigation logs for a field, optionally filtered by date range.
   */
  async getLogs(
    userId: string,
    fieldId: string,
    query?: { from?: string; to?: string },
  ): Promise<IIrrigationLogDocument[]> {
    if (!Types.ObjectId.isValid(fieldId)) {
      throw new AppError('Field not found', 404, 'FIELD_NOT_FOUND');
    }

    const field = await FieldModel.findOne({
      _id: new Types.ObjectId(fieldId),
      userId: new Types.ObjectId(userId),
    });

    if (!field) {
      throw new AppError('Field not found', 404, 'FIELD_NOT_FOUND');
    }

    const filter: Record<string, unknown> = {
      fieldId: field._id,
      userId: new Types.ObjectId(userId),
    };

    if (query?.from || query?.to) {
      const dateFilter: Record<string, string> = {};
      if (query.from) dateFilter.$gte = query.from;
      if (query.to) dateFilter.$lte = query.to;
      filter.date = dateFilter;
    }

    return IrrigationLogModel.find(filter).sort({ date: -1, createdAt: -1 });
  }

  /**
   * Deletes an irrigation log and recomputes field recommendations.
   */
  async deleteLog(userId: string, fieldId: string, logId: string): Promise<void> {
    if (!Types.ObjectId.isValid(fieldId)) {
      throw new AppError('Field not found', 404, 'FIELD_NOT_FOUND');
    }
    if (!Types.ObjectId.isValid(logId)) {
      throw new AppError('Irrigation log not found', 404, 'LOG_NOT_FOUND');
    }

    const field = await FieldModel.findOne({
      _id: new Types.ObjectId(fieldId),
      userId: new Types.ObjectId(userId),
    });

    if (!field) {
      throw new AppError('Field not found', 404, 'FIELD_NOT_FOUND');
    }

    const log = await IrrigationLogModel.findOneAndDelete({
      _id: new Types.ObjectId(logId),
      fieldId: field._id,
      userId: new Types.ObjectId(userId),
    });

    if (!log) {
      throw new AppError('Irrigation log not found', 404, 'LOG_NOT_FOUND');
    }

    // Trigger recomputation since previous/future baseline deficit state changes
    try {
      await recomputeField(field._id);
    } catch (err: unknown) {
      logger.warn({ err, fieldId: field._id }, 'Recompute failed after deleting irrigation log');
    }
  }

  /**
   * Calculates water savings over a given date range comparing:
   * - Baseline: routine schedule reported by the farmer
   * - Recommended: IrrigIQ recommendations
   * - Actual: actual recorded irrigation logs
   * Reports negative savings honestly.
   */
  async calcSavings(
    userId: string,
    fieldId: string,
    from: string,
    to: string,
  ): Promise<SavingsResponse> {
    if (!Types.ObjectId.isValid(fieldId)) {
      throw new AppError('Field not found', 404, 'FIELD_NOT_FOUND');
    }

    const field = await FieldModel.findOne({
      _id: new Types.ObjectId(fieldId),
      userId: new Types.ObjectId(userId),
    });

    if (!field) {
      throw new AppError('Field not found', 404, 'FIELD_NOT_FOUND');
    }

    const daysInRange = calculateDaysInRange(from, to);

    // 1. Fetch recommendations in date range where action === 'irrigate'
    const recommendations = await RecommendationModel.find({
      fieldId: field._id,
      forDate: { $gte: from, $lte: to },
      action: 'irrigate',
    });
    const recommendedGrossMmList = recommendations.map((r) => r.grossMm);

    // 2. Fetch actual irrigation logs in date range
    const logs = await IrrigationLogModel.find({
      fieldId: field._id,
      date: { $gte: from, $lte: to },
    });
    const actualGrossMmList = logs.map((l) => l.appliedMm);

    // 3. Compute savings totals via shared pure function
    const savings = computeSavings({
      daysInRange,
      baseline: {
        everyDays: field.baseline.everyDays,
        depthMm: field.baseline.depthMm,
      },
      areaHa: field.areaHa,
      recommendedGrossMmList,
      actualGrossMmList,
    });

    const efficiency =
      IRRIGATION_EFFICIENCY[field.method as IrrigationMethod] ?? 0.75;

    return {
      fieldId: field._id.toString(),
      from,
      to,
      days: daysInRange,
      totals: {
        baseline: savings.baseline,
        recommended: savings.recommended,
        actual: savings.actual,
        potentialSaved: savings.potentialSaved,
        realisedSaved: savings.realisedSaved,
      },
      assumptions: {
        method: field.method,
        efficiency,
        areaHa: field.areaHa,
        baseline: {
          everyDays: field.baseline.everyDays,
          depthMm: field.baseline.depthMm,
        },
        baselineNote:
          "Baseline water use is based on the farmer's own stated routine prior to using IrrigIQ.",
      },
    };
  }
}

export const irrigationLogService = new IrrigationLogService();

