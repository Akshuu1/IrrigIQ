import { Types } from 'mongoose';
import { CreatePumpInput, UpdatePumpInput } from '@irrigiq/shared';
import { PumpModel, IPumpDocument } from '../models/pump.model.js';
import { FieldModel } from '../models/field.model.js';
import { recomputeField } from './recommendation.service.js';
import { AppError } from '../errors/AppError.js';
import { logger } from '../config/logger.js';

export class PumpService {
  async createPump(userId: string, input: CreatePumpInput): Promise<IPumpDocument> {
    const pump = await PumpModel.create({
      userId: new Types.ObjectId(userId),
      name: input.name,
      dischargeLph: input.dischargeLph,
      measuredOn: input.measuredOn ?? new Date(),
      costPerHour: input.costPerHour ?? null,
      scheduleId: input.scheduleId ? new Types.ObjectId(input.scheduleId) : null,
    });

    logger.info({ pumpId: pump._id.toString(), userId }, 'Pump created successfully');
    return pump;
  }

  async getPumpsByUser(userId: string): Promise<IPumpDocument[]> {
    return PumpModel.find({ userId: new Types.ObjectId(userId) }).sort({ createdAt: -1 });
  }

  async getPumpById(userId: string, pumpId: string): Promise<IPumpDocument> {
    if (!Types.ObjectId.isValid(pumpId)) {
      throw new AppError('Pump not found', 404, 'PUMP_NOT_FOUND');
    }

    const pump = await PumpModel.findById(pumpId);
    if (!pump) {
      throw new AppError('Pump not found', 404, 'PUMP_NOT_FOUND');
    }

    // Ownership check
    if (!pump.userId.equals(new Types.ObjectId(userId))) {
      throw new AppError('You do not have permission to access this pump', 403, 'FORBIDDEN');
    }

    return pump;
  }

  async updatePump(
    userId: string,
    pumpId: string,
    input: UpdatePumpInput,
  ): Promise<IPumpDocument> {
    const pump = await this.getPumpById(userId, pumpId);

    const dischargeChanged =
      input.dischargeLph !== undefined && input.dischargeLph !== pump.dischargeLph;
    const costChanged =
      input.costPerHour !== undefined && input.costPerHour !== pump.costPerHour;
    const scheduleChanged =
      input.scheduleId !== undefined &&
      String(input.scheduleId ?? '') !== String(pump.scheduleId ?? '');

    if (input.name !== undefined) {
      pump.name = input.name;
    }
    if (input.dischargeLph !== undefined) {
      pump.dischargeLph = input.dischargeLph;
    }
    if (input.measuredOn !== undefined) {
      pump.measuredOn = input.measuredOn;
    }
    if (input.costPerHour !== undefined) {
      pump.costPerHour = input.costPerHour;
    }
    if (input.scheduleId !== undefined) {
      pump.scheduleId = input.scheduleId ? new Types.ObjectId(input.scheduleId) : null;
    }

    await pump.save();

    // Recompute recommendations for all fields using this pump when specs change
    if (dischargeChanged || costChanged || scheduleChanged) {
      const linkedFields = await FieldModel.find({ pumpId: pump._id, userId: pump.userId });
      for (const field of linkedFields) {
        try {
          await recomputeField(field._id);
        } catch (err) {
          logger.warn(
            { err, fieldId: field._id, pumpId: pump._id },
            'Failed to recompute field recommendations after pump update',
          );
        }
      }
    }

    logger.info({ pumpId: pump._id.toString(), userId }, 'Pump updated successfully');
    return pump;
  }

  async deletePump(userId: string, pumpId: string): Promise<void> {
    const pump = await this.getPumpById(userId, pumpId);

    // Unlink pump from all fields and trigger recommendation recomputations
    const linkedFields = await FieldModel.find({ pumpId: pump._id, userId: pump.userId });
    if (linkedFields.length > 0) {
      await FieldModel.updateMany(
        { pumpId: pump._id },
        { $set: { pumpId: null } },
      );

      for (const field of linkedFields) {
        try {
          await recomputeField(field._id);
        } catch (err) {
          logger.warn(
            { err, fieldId: field._id, pumpId: pump._id },
            'Failed to recompute field recommendations after pump deletion',
          );
        }
      }
    }

    await PumpModel.findByIdAndDelete(pump._id);
    logger.info({ pumpId: pump._id.toString(), userId }, 'Pump deleted successfully');
  }
}

export const pumpService = new PumpService();

