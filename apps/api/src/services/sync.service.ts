import { Types } from 'mongoose';
import { SyncMutation, SyncResultItem, SyncMutationType } from '@irrigiq/shared';
import { SyncRecord } from '../models/sync-record.model.js';
import { FieldModel } from '../models/field.model.js';
import { FieldRepository } from '../repositories/field.repository.js';
import { IrrigationLogService } from './irrigation-log.service.js';
import { recomputeField } from './recommendation.service.js';
import { logger } from '../config/logger.js';

export class SyncService {
  private fieldRepo = new FieldRepository();
  private irrigationLogService = new IrrigationLogService();

  async processSyncBatch(userId: string, mutations: SyncMutation[]): Promise<SyncResultItem[]> {
    const results: SyncResultItem[] = [];

    for (const mutation of mutations) {
      try {
        // 1. Idempotency check: has this clientId already been processed for this user?
        const existingRecord = await SyncRecord.findOne({
          userId: new Types.ObjectId(userId),
          clientId: mutation.clientId,
        });

        if (existingRecord) {
          logger.info(
            { userId, clientId: mutation.clientId, status: existingRecord.status },
            'Idempotent sync record returned from cache',
          );
          results.push(existingRecord.response as unknown as SyncResultItem);
          continue;
        }

        // Validate fieldId format
        if (!Types.ObjectId.isValid(mutation.fieldId)) {
          const item: SyncResultItem = {
            clientId: mutation.clientId,
            type: mutation.type as SyncMutationType,
            status: 'error',
            fieldId: mutation.fieldId,
            error: 'Invalid field ID',
          };
          results.push(item);
          continue;
        }

        let itemResult: SyncResultItem;

        if (mutation.type === 'create_irrigation_log') {
          // Process irrigation log
          try {
            const log = await this.irrigationLogService.createLog(userId, mutation.fieldId, {
              date: mutation.payload.date,
              appliedMm: mutation.payload.appliedMm,
              source: mutation.payload.source || 'manual',
              note: mutation.payload.note,
            });

            itemResult = {
              clientId: mutation.clientId,
              type: 'create_irrigation_log',
              status: 'applied',
              fieldId: mutation.fieldId,
              appliedLog: log.toObject ? log.toObject() : log,
            };
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Failed to create irrigation log';
            itemResult = {
              clientId: mutation.clientId,
              type: 'create_irrigation_log',
              status: 'error',
              fieldId: mutation.fieldId,
              error: message,
            };
          }
        } else if (mutation.type === 'update_field') {
          // Process field update with optimistic concurrency control
          const baseVersion = mutation.baseVersion ?? 1;
          const updateResult = await this.fieldRepo.updateWithVersion(
            mutation.fieldId,
            userId,
            baseVersion,
            mutation.payload,
          );

          if (updateResult.status === 'NOT_FOUND') {
            itemResult = {
              clientId: mutation.clientId,
              type: 'update_field',
              status: 'error',
              fieldId: mutation.fieldId,
              error: 'Field not found',
            };
          } else if (updateResult.status === 'CONFLICT') {
            const serverField = await FieldModel.findOne({
              _id: new Types.ObjectId(mutation.fieldId),
              userId: new Types.ObjectId(userId),
            });
            itemResult = {
              clientId: mutation.clientId,
              type: 'update_field',
              status: 'conflict',
              fieldId: mutation.fieldId,
              serverVersion: updateResult.currentVersion,
              serverField: serverField ? serverField.toObject() : null,
              error: `Conflict: server version is ${updateResult.currentVersion}, draft baseVersion was ${baseVersion}`,
            };
          } else {
            // SUCCESS
            try {
              await recomputeField(new Types.ObjectId(mutation.fieldId));
            } catch (recErr) {
              logger.warn({ recErr, fieldId: mutation.fieldId }, 'Recompute failed after sync update');
            }

            itemResult = {
              clientId: mutation.clientId,
              type: 'update_field',
              status: 'applied',
              fieldId: mutation.fieldId,
              serverVersion: updateResult.field?.version,
              serverField: updateResult.field?.toObject(),
            };
          }
        } else {
          itemResult = {
            clientId: mutation.clientId,
            type: mutation.type as SyncMutationType,
            status: 'error',
            fieldId: mutation.fieldId,
            error: `Unsupported mutation type: ${mutation.type}`,
          };
        }

        // Store sync record for idempotency
        await SyncRecord.create({
          userId: new Types.ObjectId(userId),
          clientId: mutation.clientId,
          type: mutation.type,
          fieldId: new Types.ObjectId(mutation.fieldId),
          status: itemResult.status,
          response: itemResult,
        });

        results.push(itemResult);
      } catch (mutationErr: unknown) {
        const errorMsg =
          mutationErr instanceof Error ? mutationErr.message : 'Internal error processing mutation';
        logger.error({ mutationErr, clientId: mutation.clientId }, 'Error processing sync mutation');
        results.push({
          clientId: mutation.clientId,
          type: mutation.type as SyncMutationType,
          status: 'error',
          fieldId: mutation.fieldId,
          error: errorMsg,
        });
      }
    }

    return results;
  }
}

