import { z } from 'zod';
import { CROPS_MAP } from './crops.js';
import { PUMP_CONFIG } from './pump.js';

export const SUPPORTED_LANGUAGES = ['en', 'hi', 'mr', 'pa', 'te'] as const;
export const LanguageSchema = z.enum(['en', 'hi', 'mr', 'pa', 'te']);
export type Language = z.infer<typeof LanguageSchema>;
export type SupportedLanguage = Language;

export const NumberingSystemSchema = z.enum(['latn', 'native']).default('latn');
export type NumberingSystem = z.infer<typeof NumberingSystemSchema>;

export const AreaUnitSchema = z.enum(['acre', 'ha', 'hectare', 'guntha', 'custom']);

export const UserPreferencesSchema = z.object({
  language: LanguageSchema.default('en'),
  areaUnit: AreaUnitSchema.default('acre'),
  numberingSystem: NumberingSystemSchema.default('latn'),
  useNativeDigits: z.boolean().default(false),
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
  numberingSystem: NumberingSystemSchema.optional().default('latn'),
  useNativeDigits: z.boolean().optional().default(false),
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
    numberingSystem: NumberingSystemSchema.optional(),
    useNativeDigits: z.boolean().optional(),
  })
  .strict();
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;

// Field schemas
export const geoJsonPolygonSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(z.array(z.array(z.number()))),
});
export type GeoJsonPolygon = z.infer<typeof geoJsonPolygonSchema>;

export const geoJsonPointSchema = z.object({
  type: z.literal('Point'),
  coordinates: z.tuple([z.number(), z.number()]),
});
export type GeoJsonPoint = z.infer<typeof geoJsonPointSchema>;

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

export const SoilTypeSchema = z.enum(['sandy', 'loam', 'clay'], {
  message: 'Soil type must be sandy, loam, or clay',
});

export const IrrigationMethodSchema = z.enum(['drip', 'sprinkler', 'flood'], {
  message: 'Irrigation method must be drip, sprinkler, or flood',
});

export const pumpIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid pump ID');

export const createFieldSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(100, 'Name must not exceed 100 characters'),
  locationMode: z.enum(['pin', 'polygon']).default('polygon'),
  geometry: geoJsonPolygonSchema.optional().nullable(),
  location: geoJsonPointSchema.optional().nullable(),
  areaValue: z.number().positive('Area must be positive').optional().nullable(),
  areaUnit: AreaUnitSchema.optional().nullable(),
  customAcresPerUnit: z.number().positive('Custom multiplier must be positive').optional().nullable(),
  cropKey: cropKeySchema,
  sowingDate: sowingDateSchema,
  soilType: SoilTypeSchema,
  method: IrrigationMethodSchema,
  baseline: baselineSchema,
  pumpId: pumpIdSchema.optional().nullable(),
  farmerId: z.string().optional().nullable(),
  waterMode: z.enum(['irrigated', 'rainfed']).default('irrigated'),
  hasProtectiveWater: z.boolean().default(false),
});
export type CreateFieldInput = z.input<typeof createFieldSchema>;

export const updateFieldSchema = z.object({
  version: z
    .number({ message: 'Version is required for optimistic concurrency control' })
    .int('Version must be an integer'),
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(100, 'Name must not exceed 100 characters')
    .optional(),
  locationMode: z.enum(['pin', 'polygon']).optional(),
  geometry: geoJsonPolygonSchema.optional().nullable(),
  location: geoJsonPointSchema.optional().nullable(),
  areaValue: z.number().positive('Area must be positive').optional().nullable(),
  areaUnit: AreaUnitSchema.optional().nullable(),
  customAcresPerUnit: z.number().positive('Custom multiplier must be positive').optional().nullable(),
  cropKey: cropKeySchema.optional(),
  sowingDate: sowingDateSchema.optional(),
  soilType: SoilTypeSchema.optional(),
  method: IrrigationMethodSchema.optional(),
  baseline: baselineSchema.optional(),
  pumpId: pumpIdSchema.optional().nullable(),
  farmerId: z.string().optional().nullable(),
  waterMode: z.enum(['irrigated', 'rainfed']).optional(),
  hasProtectiveWater: z.boolean().optional(),
});
export type UpdateFieldInput = z.input<typeof updateFieldSchema>;

// Pump schemas
export const createPumpSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Pump name is required')
    .max(100, 'Pump name must not exceed 100 characters'),
  dischargeLph: z
    .number({ message: 'Discharge rate is required' })
    .min(PUMP_CONFIG.minDischargeLph.value, `Discharge must be at least ${PUMP_CONFIG.minDischargeLph.value} L/h`)
    .max(PUMP_CONFIG.maxDischargeLph.value, `Discharge must not exceed ${PUMP_CONFIG.maxDischargeLph.value} L/h`),
  measuredOn: z
    .union([z.string(), z.date()])
    .transform((val) => new Date(val))
    .optional(),
  costPerHour: z.number().min(0, 'Cost per hour must be non-negative').optional().nullable(),
  scheduleId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid schedule ID').optional().nullable(),
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
  scheduleId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid schedule ID').optional().nullable(),
});
export type UpdatePumpInput = z.infer<typeof updatePumpSchema>;

// Power Schedule schemas
export const powerWindowSchema = z.object({
  days: z.array(z.number().int().min(0).max(6)).min(1, 'At least one day must be selected'),
  start: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Start time must be in HH:MM format'),
  end: z.string().regex(/^([01]\d|2[0-3]|24):([0-5]\d)$/, 'End time must be in HH:MM format'),
});

export const scheduleRotationSchema = z.object({
  weekA: z.array(powerWindowSchema).min(1, 'Week A must contain at least one window'),
  weekB: z.array(powerWindowSchema).min(1, 'Week B must contain at least one window'),
  anchorDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Anchor date must be YYYY-MM-DD'),
});

export const createPowerScheduleSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Schedule name is required')
    .max(100, 'Schedule name must not exceed 100 characters'),
  type: z.enum(['night', 'day', 'custom']).default('custom'),
  windows: z.array(powerWindowSchema).default([]),
  rotation: scheduleRotationSchema.optional().nullable(),
});
export type CreatePowerScheduleInput = z.infer<typeof createPowerScheduleSchema>;

export const updatePowerScheduleSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Schedule name is required')
    .max(100, 'Schedule name must not exceed 100 characters')
    .optional(),
  type: z.enum(['night', 'day', 'custom']).optional(),
  windows: z.array(powerWindowSchema).optional(),
  rotation: scheduleRotationSchema.optional().nullable(),
});
export type UpdatePowerScheduleInput = z.infer<typeof updatePowerScheduleSchema>;
