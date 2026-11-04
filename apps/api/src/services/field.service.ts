import { Types } from 'mongoose';
import { validatePolygon, type GeoJSONPoint } from '@irrigiq/shared';
import { AppError } from '../errors/AppError.js';
import { FieldRepository, fieldRepository } from '../repositories/field.repository.js';
import { IField, IFieldDocument } from '../models/field.model.js';
import { CreateFieldInput, UpdateFieldInput } from '../schemas/field.schema.js';
import { recomputeField } from './recommendation.service.js';
import { logger } from '../config/logger.js';

export class FieldService {
  constructor(private readonly repo: FieldRepository = fieldRepository) {}

  async createField(userId: string, input: CreateFieldInput): Promise<IFieldDocument> {
    // Validate polygon and compute area and centroid on server - NEVER trust client values
    let areaHa: number;
    let centroid: GeoJSONPoint;

    try {
      const geoResult = validatePolygon(input.geometry);
      areaHa = geoResult.areaHa;
      centroid = geoResult.centroid;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Invalid polygon geometry';
      throw new AppError(message, 400, 'INVALID_GEOMETRY');
    }

    const fieldData: Partial<IField> = {
      userId: new Types.ObjectId(userId),
      name: input.name,
      geometry: input.geometry,
      centroid,
      areaHa,
      cropKey: input.cropKey,
      sowingDate: input.sowingDate,
      soilType: input.soilType,
      method: input.method,
      baseline: input.baseline,
      pumpId: input.pumpId ? new Types.ObjectId(input.pumpId) : null,
      version: 1,
    };

    const field = await this.repo.create(fieldData);

    // Recompute recommendations when a field is created
    try {
      await recomputeField(field._id);
    } catch (err: unknown) {
      logger.warn({ err, fieldId: field._id }, 'Initial recommendation recompute failed on create');
    }

    return field;
  }

  async getFields(userId: string): Promise<IFieldDocument[]> {
    return this.repo.findByUserId(userId);
  }

  async getFieldById(userId: string, fieldId: string): Promise<IFieldDocument> {
    if (!Types.ObjectId.isValid(fieldId)) {
      throw new AppError('Field not found', 404, 'FIELD_NOT_FOUND');
    }

    const field = await this.repo.findById(fieldId, userId);
    if (!field) {
      throw new AppError('Field not found', 404, 'FIELD_NOT_FOUND');
    }

    return field;
  }

  async updateField(
    userId: string,
    fieldId: string,
    input: UpdateFieldInput,
  ): Promise<IFieldDocument> {
    if (!Types.ObjectId.isValid(fieldId)) {
      throw new AppError('Field not found', 404, 'FIELD_NOT_FOUND');
    }

    const updateData: Partial<IField> = {};

    if (input.name !== undefined) {
      updateData.name = input.name;
    }
    if (input.cropKey !== undefined) {
      updateData.cropKey = input.cropKey;
    }
    if (input.sowingDate !== undefined) {
      updateData.sowingDate = input.sowingDate;
    }
    if (input.soilType !== undefined) {
      updateData.soilType = input.soilType;
    }
    if (input.method !== undefined) {
      updateData.method = input.method;
    }
    if (input.baseline !== undefined) {
      updateData.baseline = input.baseline;
    }
    if (input.pumpId !== undefined) {
      updateData.pumpId = input.pumpId ? new Types.ObjectId(input.pumpId) : null;
    }

    // If geometry changed, re-validate and re-calculate area and centroid on server
    if (input.geometry !== undefined) {
      try {
        const geoResult = validatePolygon(input.geometry);
        updateData.geometry = input.geometry;
        updateData.areaHa = geoResult.areaHa;
        updateData.centroid = geoResult.centroid;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Invalid polygon geometry';
        throw new AppError(message, 400, 'INVALID_GEOMETRY');
      }
    }

    const result = await this.repo.updateWithVersion(fieldId, userId, input.version, updateData);

    if (result.status === 'NOT_FOUND') {
      throw new AppError('Field not found', 404, 'FIELD_NOT_FOUND');
    }

    if (result.status === 'CONFLICT') {
      throw new AppError(
        `Field version conflict: current version is ${result.currentVersion}. Reload and try again.`,
        409,
        'VERSION_CONFLICT',
      );
    }

    const updatedField = result.field;

    // Recompute recommendations when a field is updated
    try {
      await recomputeField(updatedField._id);
    } catch (err: unknown) {
      logger.warn({ err, fieldId: updatedField._id }, 'Recommendation recompute failed on update');
    }

    return updatedField;
  }

  async deleteField(userId: string, fieldId: string): Promise<void> {
    if (!Types.ObjectId.isValid(fieldId)) {
      throw new AppError('Field not found', 404, 'FIELD_NOT_FOUND');
    }

    const deleted = await this.repo.delete(fieldId, userId);
    if (!deleted) {
      throw new AppError('Field not found', 404, 'FIELD_NOT_FOUND');
    }
  }

  async getNearbyFields(
    userId: string,
    lng: number,
    lat: number,
    km: number,
  ): Promise<IFieldDocument[]> {
    const maxDistanceMeters = km * 1000;
    return this.repo.findNearby(userId, lng, lat, maxDistanceMeters);
  }
}

export const fieldService = new FieldService();
