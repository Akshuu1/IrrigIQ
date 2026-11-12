import { z } from 'zod';

export const createFarmerSchema = z.object({
  name: z.string().trim().min(1, 'Farmer name is required').max(100),
  phone: z.string().trim().optional(),
  language: z.enum(['en', 'hi', 'mr', 'pa', 'te']).default('en'),
  village: z.string().trim().max(100).optional(),
  assignedAgentId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid agent ID').optional().nullable(),
});
export type CreateFarmerInput = z.infer<typeof createFarmerSchema>;

export const updateFarmerSchema = z.object({
  name: z.string().trim().min(1, 'Farmer name cannot be empty').max(100).optional(),
  phone: z.string().trim().optional(),
  language: z.enum(['en', 'hi', 'mr', 'pa', 'te']).optional(),
  village: z.string().trim().max(100).optional(),
  assignedAgentId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid agent ID').optional().nullable(),
  status: z.enum(['active', 'stopped', 'deleted']).optional(),
});
export type UpdateFarmerInput = z.infer<typeof updateFarmerSchema>;
