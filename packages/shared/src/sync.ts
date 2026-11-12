import { z } from 'zod';
import { SoilTypeSchema, IrrigationMethodSchema } from './schemas.js';

export type SyncMutationType = 'create_irrigation_log' | 'update_field' | 'create_field';

export const CreateIrrigationLogPayloadSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  appliedMm: z.number().positive('Applied mm must be greater than 0').max(200, 'Max single application is 200 mm'),
  source: z.enum(['recommended', 'manual']).default('manual'),
  note: z.string().max(200).optional(),
});

export type CreateIrrigationLogPayload = z.infer<typeof CreateIrrigationLogPayloadSchema>;

export const UpdateFieldPayloadSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  sowingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Sowing date must be YYYY-MM-DD').optional(),
  soilType: SoilTypeSchema.optional(),
  method: IrrigationMethodSchema.optional(),
  baseline: z
    .object({
      everyDays: z.number().int().min(1).max(30),
      depthMm: z.number().min(5).max(150),
    })
    .optional(),
});

export type UpdateFieldPayload = z.infer<typeof UpdateFieldPayloadSchema>;

export const SyncMutationSchema = z.object({
  clientId: z.string().min(1, 'clientId is required'),
  type: z.enum(['create_irrigation_log', 'update_field', 'create_field']),
  fieldId: z.string().optional(),
  baseVersion: z.number().int().nonnegative().optional(),
  payload: z.record(z.string(), z.any()),
  timestamp: z.number().int().positive().optional(),
});

export type SyncMutation = z.infer<typeof SyncMutationSchema>;

export const SyncBatchRequestSchema = z.object({
  mutations: z.array(SyncMutationSchema).max(50, 'Max 50 mutations per sync batch'),
});

export type SyncBatchRequest = z.infer<typeof SyncBatchRequestSchema>;

export type SyncResultStatus = 'applied' | 'conflict' | 'error';

export interface SyncResultItem {
  clientId: string;
  type: SyncMutationType;
  status: SyncResultStatus;
  fieldId?: string;
  error?: string;
  serverVersion?: number;
  serverField?: unknown;
  appliedLog?: unknown;
}

export interface SyncBatchResponse {
  results: SyncResultItem[];
}
