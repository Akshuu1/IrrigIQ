import { z } from 'zod';

export const createReportSchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'from date must be in YYYY-MM-DD format')
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'to date must be in YYYY-MM-DD format')
    .optional(),
  language: z.enum(['en', 'hi', 'mr', 'pa', 'te']).default('en').optional(),
});

export type CreateReportInput = z.infer<typeof createReportSchema>;

