import { z } from 'zod';
import { LanguageSchema, AreaUnitSchema } from '@irrigiq/shared';

export const RegisterSchema = z.object({
  email: z.string().email('Invalid email address').toLowerCase().trim(),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
  name: z.string().min(2, 'Name must be at least 2 characters long').trim(),
  language: LanguageSchema.default('en'),
  areaUnit: AreaUnitSchema.default('acre'),
});

export type RegisterInput = z.infer<typeof RegisterSchema>;

export const LoginSchema = z.object({
  email: z.string().email('Invalid email address').toLowerCase().trim(),
  password: z.string().min(1, 'Password is required'),
});

export type LoginInput = z.infer<typeof LoginSchema>;

export const UpdateProfileSchema = z
  .object({
    name: z.string().min(2, 'Name must be at least 2 characters long').trim().optional(),
    language: LanguageSchema.optional(),
    areaUnit: AreaUnitSchema.optional(),
  })
  .strict('Only name, language, and areaUnit can be updated');

export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;
