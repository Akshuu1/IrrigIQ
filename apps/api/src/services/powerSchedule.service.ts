import { Types } from 'mongoose';
import {
  CreatePowerScheduleInput,
  UpdatePowerScheduleInput,
  POWER_SCHEDULE_PRESETS,
} from '@irrigiq/shared';
import {
  PowerScheduleModel,
  IPowerScheduleDocument,
} from '../models/powerSchedule.model.js';
import { PumpModel } from '../models/pump.model.js';
import { FieldModel } from '../models/field.model.js';
import { recomputeField } from './recommendation.service.js';
import { AppError } from '../errors/AppError.js';
import { logger } from '../config/logger.js';

export class PowerScheduleService {
  async createSchedule(
    userId: string,
    input: CreatePowerScheduleInput,
  ): Promise<IPowerScheduleDocument> {
    const schedule = await PowerScheduleModel.create({
      userId: new Types.ObjectId(userId),
      name: input.name,
      type: input.type || 'custom',
      windows: input.windows || [],
      rotation: input.rotation || null,
    });

    logger.info(
      { scheduleId: schedule._id.toString(), userId },
      'Power schedule created successfully',
    );
    return schedule;
  }

  async getSchedulesByUser(userId: string): Promise<IPowerScheduleDocument[]> {
    return PowerScheduleModel.find({
      userId: new Types.ObjectId(userId),
    }).sort({ createdAt: -1 });
  }

  async getScheduleById(userId: string, scheduleId: string): Promise<IPowerScheduleDocument> {
    if (!Types.ObjectId.isValid(scheduleId)) {
      throw new AppError('Power schedule not found', 404, 'SCHEDULE_NOT_FOUND');
    }

    const schedule = await PowerScheduleModel.findById(scheduleId);
    if (!schedule) {
      throw new AppError('Power schedule not found', 404, 'SCHEDULE_NOT_FOUND');
    }

    // Ownership check
    if (!schedule.userId.equals(new Types.ObjectId(userId))) {
      throw new AppError('You do not have permission to access this schedule', 403, 'FORBIDDEN');
    }

    return schedule;
  }

  async updateSchedule(
    userId: string,
    scheduleId: string,
    input: UpdatePowerScheduleInput,
  ): Promise<IPowerScheduleDocument> {
    const schedule = await this.getScheduleById(userId, scheduleId);

    if (input.name !== undefined) {
      schedule.name = input.name;
    }
    if (input.type !== undefined) {
      schedule.type = input.type;
    }
    if (input.windows !== undefined) {
      schedule.windows = input.windows;
    }
    if (input.rotation !== undefined) {
      schedule.rotation = input.rotation;
    }

    await schedule.save();

    // Recompute recommendations for all fields linked to pumps using this schedule
    await this.recomputeFieldsForSchedule(schedule._id, schedule.userId);

    logger.info(
      { scheduleId: schedule._id.toString(), userId },
      'Power schedule updated successfully',
    );
    return schedule;
  }

  async deleteSchedule(userId: string, scheduleId: string): Promise<void> {
    const schedule = await this.getScheduleById(userId, scheduleId);

    // Unlink this schedule from any pumps
    const linkedPumps = await PumpModel.find({ scheduleId: schedule._id, userId: schedule.userId });
    if (linkedPumps.length > 0) {
      await PumpModel.updateMany(
        { scheduleId: schedule._id },
        { $set: { scheduleId: null } },
      );

      // Recompute recommendations for affected fields
      for (const pump of linkedPumps) {
        const fields = await FieldModel.find({ pumpId: pump._id, userId: pump.userId });
        for (const field of fields) {
          try {
            await recomputeField(field._id);
          } catch (err) {
            logger.warn({ err, fieldId: field._id }, 'Failed to recompute field after schedule deletion');
          }
        }
      }
    }

    await PowerScheduleModel.findByIdAndDelete(schedule._id);
    logger.info(
      { scheduleId: schedule._id.toString(), userId },
      'Power schedule deleted successfully',
    );
  }

  /**
   * Helper to ensure presets exist or create on demand.
   */
  async ensurePreset(
    userId: string,
    presetType: 'night' | 'day',
  ): Promise<IPowerScheduleDocument> {
    const userObjectId = new Types.ObjectId(userId);
    const existing = await PowerScheduleModel.findOne({
      userId: userObjectId,
      type: presetType,
    });

    if (existing) {
      return existing;
    }

    const preset = POWER_SCHEDULE_PRESETS[presetType];
    return PowerScheduleModel.create({
      userId: userObjectId,
      name: `${preset.name} Schedule`,
      type: preset.type,
      windows: preset.windows,
      rotation: null,
    });
  }

  private async recomputeFieldsForSchedule(
    scheduleId: Types.ObjectId,
    userId: Types.ObjectId,
  ): Promise<void> {
    const linkedPumps = await PumpModel.find({ scheduleId, userId });
    for (const pump of linkedPumps) {
      const linkedFields = await FieldModel.find({ pumpId: pump._id, userId });
      for (const field of linkedFields) {
        try {
          await recomputeField(field._id);
        } catch (err) {
          logger.warn(
            { err, fieldId: field._id, scheduleId },
            'Failed to recompute field recommendations after schedule update',
          );
        }
      }
    }
  }
}

export const powerScheduleService = new PowerScheduleService();

