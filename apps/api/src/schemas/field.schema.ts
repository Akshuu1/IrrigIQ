import { z } from 'zod';
import {
  createFieldSchema,
  CreateFieldInput,
  updateFieldSchema,
  UpdateFieldInput,
} from '@irrigiq/shared';

export { createFieldSchema, updateFieldSchema };
export type { CreateFieldInput, UpdateFieldInput };

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
