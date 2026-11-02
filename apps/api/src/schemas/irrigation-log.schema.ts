import { z } from 'zod';

export const createIrrigationLogSchema = z.object({
  date: z
    .string({ required_error: 'Date is required' })
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  appliedMm: z
    .number({ required_error: 'appliedMm is required' })
    .min(0, 'Applied mm must be at least 0')
    .max(500, 'Applied mm cannot exceed 500 mm'),
  source: z.enum(['recommended', 'manual'], {
    required_error: 'Source must be either recommended or manual',
  }),
  note: z.string().trim().max(500, 'Note cannot exceed 500 characters').optional(),
});

export type CreateIrrigationLogInput = z.infer<typeof createIrrigationLogSchema>;

export const listLogsQuerySchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'from must be YYYY-MM-DD')
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'to must be YYYY-MM-DD')
    .optional(),
});

export const savingsQuerySchema = z
  .object({
    from: z
      .string({ required_error: 'from query parameter is required' })
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'from must be YYYY-MM-DD'),
    to: z
      .string({ required_error: 'to query parameter is required' })
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'to must be YYYY-MM-DD'),
  })
  .refine((data) => data.to >= data.from, {
    message: "'to' date must be greater than or equal to 'from' date",
    path: ['to'],
  });

export type SavingsQueryInput = z.infer<typeof savingsQuerySchema>;
