import { z } from 'zod';
import { CROPS_MAP } from './crops.js';
import type { SoilType, IrrigationMethod } from './science.js';
import { PUMP_CONFIG } from './pump.js';

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

// Auth schemas
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

// Field schemas
export const geoJsonPolygonSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(z.array(z.array(z.number()))),
});
export type GeoJsonPolygon = z.infer<typeof geoJsonPolygonSchema>;

export const sowingDateSchema = z
  .union([z.string(), z.date()])
  .transform((val) => new Date(val))
  .refine((date) => !isNaN(date.getTime()), {
    message: 'Invalid sowing date format',
  })
  .refine(
    (date) => {
      const maxFutureDate = new Date();
      maxFutureDate.setDate(maxFutureDate.getDate() + 30);
      return date.getTime() <= maxFutureDate.getTime();
    },
    {
      message: 'Sowing date cannot be more than 30 days in the future',
    },
  );

export const cropKeySchema = z.string().refine((val) => CROPS_MAP.has(val), {
  message: 'Invalid crop key. Must match a supported crop.',
});

export const baselineSchema = z.object({
  everyDays: z.number().int().min(1, 'Baseline everyDays must be at least 1 day'),
  depthMm: z.number().min(1, 'Baseline depthMm must be at least 1 mm'),
});
export type BaselineInput = z.infer<typeof baselineSchema>;

export const SoilTypeSchema: z.ZodType<SoilType> = z.enum(['sandy', 'loam', 'clay'], {
  errorMap: () => ({ message: 'Soil type must be sandy, loam, or clay' }),
});

export const IrrigationMethodSchema: z.ZodType<IrrigationMethod> = z.enum(
  ['drip', 'sprinkler', 'flood'],
  {
    errorMap: () => ({ message: 'Irrigation method must be drip, sprinkler, or flood' }),
  },
);

export const pumpIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid pump ID');

export const createFieldSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(100, 'Name must not exceed 100 characters'),
  geometry: geoJsonPolygonSchema,
  cropKey: cropKeySchema,
  sowingDate: sowingDateSchema,
  soilType: SoilTypeSchema,
  method: IrrigationMethodSchema,
  baseline: baselineSchema,
  pumpId: pumpIdSchema.optional().nullable(),
});
export type CreateFieldInput = z.infer<typeof createFieldSchema>;

export const updateFieldSchema = z.object({
  version: z
    .number({ required_error: 'Version is required for optimistic concurrency control' })
    .int('Version must be an integer'),
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(100, 'Name must not exceed 100 characters')
    .optional(),
  geometry: geoJsonPolygonSchema.optional(),
  cropKey: cropKeySchema.optional(),
  sowingDate: sowingDateSchema.optional(),
  soilType: SoilTypeSchema.optional(),
  method: IrrigationMethodSchema.optional(),
  baseline: baselineSchema.optional(),
  pumpId: pumpIdSchema.optional().nullable(),
});
export type UpdateFieldInput = z.infer<typeof updateFieldSchema>;

// Pump schemas
export const createPumpSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Pump name is required')
    .max(100, 'Pump name must not exceed 100 characters'),
  dischargeLph: z
    .number({ required_error: 'Discharge rate is required' })
    .min(PUMP_CONFIG.minDischargeLph.value, `Discharge must be at least ${PUMP_CONFIG.minDischargeLph.value} L/h`)
    .max(PUMP_CONFIG.maxDischargeLph.value, `Discharge must not exceed ${PUMP_CONFIG.maxDischargeLph.value} L/h`),
  measuredOn: z
    .union([z.string(), z.date()])
    .transform((val) => new Date(val))
    .optional(),
  costPerHour: z.number().min(0, 'Cost per hour must be non-negative').optional().nullable(),
});
export type CreatePumpInput = z.infer<typeof createPumpSchema>;

export const updatePumpSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Pump name is required')
    .max(100, 'Pump name must not exceed 100 characters')
    .optional(),
  dischargeLph: z
    .number()
    .min(PUMP_CONFIG.minDischargeLph.value, `Discharge must be at least ${PUMP_CONFIG.minDischargeLph.value} L/h`)
    .max(PUMP_CONFIG.maxDischargeLph.value, `Discharge must not exceed ${PUMP_CONFIG.maxDischargeLph.value} L/h`)
    .optional(),
  measuredOn: z
    .union([z.string(), z.date()])
    .transform((val) => new Date(val))
    .optional(),
  costPerHour: z.number().min(0, 'Cost per hour must be non-negative').optional().nullable(),
});
export type UpdatePumpInput = z.infer<typeof updatePumpSchema>;
