import { z } from 'zod';

export const createOrgSchema = z.object({
  name: z.string().trim().min(1, 'Organisation name is required').max(100),
});
export type CreateOrgInput = z.infer<typeof createOrgSchema>;

export const updateOrgSchema = z.object({
  name: z.string().trim().min(1, 'Organisation name is required').max(100),
});
export type UpdateOrgInput = z.infer<typeof updateOrgSchema>;

export const addMemberSchema = z.object({
  email: z.string().email('Invalid email address').toLowerCase().trim(),
  role: z.enum(['admin', 'agent']).default('agent'),
});
export type AddMemberInput = z.infer<typeof addMemberSchema>;

export const updateMemberRoleSchema = z.object({
  role: z.enum(['admin', 'agent']),
});
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;
