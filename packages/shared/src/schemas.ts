import { z } from 'zod';

export const LanguageSchema = z.enum(['en', 'hi']);
export type Language = z.infer<typeof LanguageSchema>;

export const AreaUnitSchema = z.enum(['acre', 'ha']);
export type AreaUnit = z.infer<typeof AreaUnitSchema>;

export const UserPreferencesSchema = z.object({
  language: LanguageSchema.default('en'),
  areaUnit: AreaUnitSchema.default('acre'),
});
export type UserPreferences = z.infer<typeof UserPreferencesSchema>;

export const CoordinatesSchema = z.object({
  lng: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
});
export type Coordinates = z.infer<typeof CoordinatesSchema>;
