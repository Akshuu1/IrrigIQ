import { z } from 'zod';
import { CROPS_MAP } from '@irrigiq/shared';

const geoJsonPolygonSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(z.array(z.array(z.number()))),
});

const sowingDateSchema = z
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

const cropKeySchema = z.string().refine((val) => CROPS_MAP.has(val), {
  message: 'Invalid crop key. Must match a supported crop.',
});

const baselineSchema = z.object({
  everyDays: z.number().int().min(1, 'Baseline everyDays must be at least 1 day'),
  depthMm: z.number().min(1, 'Baseline depthMm must be at least 1 mm'),
});

export const createFieldSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(100, 'Name must not exceed 100 characters'),
  geometry: geoJsonPolygonSchema,
  cropKey: cropKeySchema,
  sowingDate: sowingDateSchema,
  soilType: z.enum(['sandy', 'loam', 'clay'], {
    errorMap: () => ({ message: 'Soil type must be sandy, loam, or clay' }),
  }),
  method: z.enum(['drip', 'sprinkler', 'flood'], {
    errorMap: () => ({ message: 'Irrigation method must be drip, sprinkler, or flood' }),
  }),
  baseline: baselineSchema,
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
  soilType: z
    .enum(['sandy', 'loam', 'clay'], {
      errorMap: () => ({ message: 'Soil type must be sandy, loam, or clay' }),
    })
    .optional(),
  method: z
    .enum(['drip', 'sprinkler', 'flood'], {
      errorMap: () => ({ message: 'Irrigation method must be drip, sprinkler, or flood' }),
    })
    .optional(),
  baseline: baselineSchema.optional(),
});

export type UpdateFieldInput = z.infer<typeof updateFieldSchema>;

export const nearbyFieldsQuerySchema = z.object({
  lng: z.coerce.number().min(-180).max(180),
  lat: z.coerce.number().min(-90).max(90),
  km: z.coerce
    .number()
    .positive('km must be greater than 0')
    .max(50, 'Search radius cannot exceed 50 km')
    .default(10),
});

export type NearbyFieldsQuery = z.infer<typeof nearbyFieldsQuerySchema>;
