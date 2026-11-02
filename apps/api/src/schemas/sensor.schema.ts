import { z } from 'zod';

export const createSensorSchema = z.object({
  name: z.string({ required_error: 'Sensor name is required' }).trim().min(1).max(100),
  isSimulated: z.boolean().default(true),
});

export type CreateSensorInput = z.infer<typeof createSensorSchema>;

const baseReadingSchema = z.object({
  moisturePct: z
    .number({ required_error: 'moisturePct is required' })
    .min(0, 'moisturePct must be between 0 and 100')
    .max(100, 'moisturePct must be between 0 and 100'),
  tempC: z
    .number({ required_error: 'tempC is required' })
    .min(-10, 'tempC must be at least -10°C')
    .max(60, 'tempC cannot exceed 60°C'),
  timestamp: z
    .string()
    .datetime({ offset: true })
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?)?$/))
    .or(z.date())
    .optional(),
});

export const singleReadingSchema = baseReadingSchema.refine(
  (data) => {
    if (!data.timestamp) return true;
    const date = new Date(data.timestamp);
    if (isNaN(date.getTime())) return false;

    const now = Date.now();
    const futureLimit = now + 5 * 60 * 1000; // 5 minutes in future
    const pastLimit = now - 24 * 60 * 60 * 1000; // 24 hours in past

    return date.getTime() <= futureLimit && date.getTime() >= pastLimit;
  },
  {
    message: 'Timestamp must be within 5 minutes of now, and no older than 24 hours',
    path: ['timestamp'],
  },
);

export const ingestReadingSchema = z.union([
  singleReadingSchema,
  z.array(singleReadingSchema).min(1, 'Batch readings array cannot be empty'),
]);

export type IngestReadingInput = z.infer<typeof ingestReadingSchema>;

export const moistureQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

export type MoistureQueryInput = z.infer<typeof moistureQuerySchema>;
