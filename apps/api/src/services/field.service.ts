import { Types } from 'mongoose';
import {
  validatePolygon,
  toHectares,
  INDIA_BOUNDS,
  AREA_CONFIG,
  type GeoJSONPoint,
  type GeoJSONPolygon,
} from '@irrigiq/shared';
import { AppError } from '../errors/AppError.js';
import { FieldRepository, fieldRepository } from '../repositories/field.repository.js';
import { FieldModel, IField, IFieldDocument } from '../models/field.model.js';
import { FarmerModel } from '../models/farmer.model.js';
import { OrganisationRole } from '../models/membership.model.js';
import { checkFieldAccess } from './rbac.service.js';
import { CreateFieldInput, UpdateFieldInput } from '../schemas/field.schema.js';
import { recomputeField } from './recommendation.service.js';
import { logger } from '../config/logger.js';

export class FieldService {
  constructor(private readonly repo: FieldRepository = fieldRepository) {}

  async createField(
    userId: string,
    input: CreateFieldInput,
    orgId?: Types.ObjectId,
    role?: OrganisationRole,
  ): Promise<IFieldDocument> {
    const hasPolygon =
      input.geometry &&
      Array.isArray(input.geometry.coordinates) &&
      input.geometry.coordinates.length > 0;
    const isPinMode = input.locationMode === 'pin' || (!hasPolygon && Boolean(input.location));

    let areaHa: number;
    let centroid: GeoJSONPoint;
    let geometry: GeoJSONPolygon | null = null;
    let location: GeoJSONPoint | null = null;
    let areaWarning: string | null = null;

    if (hasPolygon) {
      // Polygon mode (polygon geodesic area wins)
      try {
        const geoResult = validatePolygon(input.geometry!);
        areaHa = geoResult.areaHa;
        centroid = geoResult.centroid;
        geometry = input.geometry!;
        location = centroid;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Invalid polygon geometry';
        throw new AppError(message, 400, 'INVALID_GEOMETRY');
      }
    } else if (isPinMode) {
      // Pin mode
      if (
        !input.location ||
        !Array.isArray(input.location.coordinates) ||
        input.location.coordinates.length < 2
      ) {
        throw new AppError(
          'Location coordinates [lng, lat] are required for pin fields',
          400,
          'INVALID_COORDINATES',
        );
      }
      const [lng, lat] = input.location.coordinates;
      if (
        typeof lng !== 'number' ||
        typeof lat !== 'number' ||
        isNaN(lng) ||
        isNaN(lat) ||
        lng < INDIA_BOUNDS.minLng ||
        lng > INDIA_BOUNDS.maxLng ||
        lat < INDIA_BOUNDS.minLat ||
        lat > INDIA_BOUNDS.maxLat
      ) {
        throw new AppError(
          `Coordinate [${lng}, ${lat}] is outside India's bounding box [${INDIA_BOUNDS.minLng}, ${INDIA_BOUNDS.minLat}, ${INDIA_BOUNDS.maxLng}, ${INDIA_BOUNDS.maxLat}]`,
          400,
          'INVALID_COORDINATES',
        );
      }

      if (!input.areaValue || isNaN(input.areaValue) || input.areaValue <= 0) {
        throw new AppError('Area value must be a positive number', 400, 'INVALID_AREA');
      }
      if (!input.areaUnit) {
        throw new AppError('Area unit is required', 400, 'INVALID_AREA');
      }

      try {
        areaHa = toHectares(input.areaValue, input.areaUnit, input.customAcresPerUnit ?? undefined);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Invalid area conversion';
        throw new AppError(msg, 400, 'INVALID_AREA');
      }

      if (areaHa < AREA_CONFIG.minAreaHa.value) {
        throw new AppError(
          `Field area is ${areaHa.toFixed(4)} ha, which is below the minimum allowed ${AREA_CONFIG.minAreaHa.value} ha`,
          400,
          'INVALID_AREA',
        );
      }
      if (areaHa > AREA_CONFIG.maxAreaHa.value) {
        throw new AppError(
          `Field area is ${areaHa.toFixed(2)} ha, which exceeds the maximum allowed ${AREA_CONFIG.maxAreaHa.value} ha`,
          400,
          'INVALID_AREA',
        );
      }

      centroid = {
        type: 'Point',
        coordinates: [Number(lng.toFixed(6)), Number(lat.toFixed(6))],
      };
      location = centroid;
      geometry = null;
    } else {
      throw new AppError(
        'Field must specify either a valid boundary polygon or a location pin with area',
        400,
        'INVALID_GEOMETRY',
      );
    }

    if (areaHa > AREA_CONFIG.largeAreaWarningHa.value) {
      areaWarning = `Field area (${areaHa.toFixed(2)} ha) exceeds ${AREA_CONFIG.largeAreaWarningHa.value} ha. Please verify the entered land size.`;
    }

    let farmerId: Types.ObjectId | null = null;
    if (orgId) {
      if (input.farmerId) {
        const farmer = await FarmerModel.findOne({
          _id: new Types.ObjectId(input.farmerId),
          orgId,
          status: { $ne: 'deleted' },
        });
        if (!farmer) {
          throw new AppError('Farmer not found in this organisation', 404, 'FARMER_NOT_FOUND');
        }
        if (role === 'agent' && farmer.assignedAgentId?.toString() !== userId.toString()) {
          throw new AppError('Forbidden: farmer not assigned to you', 403, 'FORBIDDEN');
        }
        farmerId = farmer._id;
      } else {
        let farmer = await FarmerModel.findOne({
          orgId,
          userId: new Types.ObjectId(userId),
          status: { $ne: 'deleted' },
        });
        if (!farmer) {
          farmer = await FarmerModel.create({
            orgId,
            userId: new Types.ObjectId(userId),
            name: 'Owner',
            language: 'en',
            status: 'active',
          });
        }
        farmerId = farmer._id;
      }
    }

    const fieldData: Partial<IField> = {
      userId: new Types.ObjectId(userId),
      orgId: orgId ?? null,
      farmerId,
      name: input.name,
      locationMode: hasPolygon ? 'polygon' : 'pin',
      geometry,
      location,
      centroid,
      areaHa,
      areaValue: input.areaValue ?? null,
      areaUnit: input.areaUnit ?? null,
      customAcresPerUnit: input.customAcresPerUnit ?? null,
      areaWarning,
      cropKey: input.cropKey,
      sowingDate:
        typeof input.sowingDate === 'string' ? new Date(input.sowingDate) : input.sowingDate,
      soilType: input.soilType,
      method: input.method,
      baseline: input.baseline,
      pumpId: input.pumpId ? new Types.ObjectId(input.pumpId) : null,
      waterMode: input.waterMode ?? 'irrigated',
      hasProtectiveWater: input.hasProtectiveWater ?? false,
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

  async getFields(
    userId: string,
    orgId?: Types.ObjectId,
    role?: OrganisationRole,
  ): Promise<IFieldDocument[]> {
    if (orgId) {
      if (role === 'agent') {
        const assignedFarmers = await FarmerModel.find({
          orgId,
          assignedAgentId: new Types.ObjectId(userId),
          status: { $ne: 'deleted' },
        }).select('_id');
        const farmerIds = assignedFarmers.map((f) => f._id);
        return FieldModel.find({
          orgId,
          farmerId: { $in: farmerIds },
        }).sort({ updatedAt: -1 });
      }

      // Admin sees all fields in this organisation
      return FieldModel.find({ orgId }).sort({ updatedAt: -1 });
    }

    return this.repo.findByUserId(userId);
  }

  async getFieldById(
    userId: string,
    fieldId: string,
    orgId?: Types.ObjectId,
    role?: OrganisationRole,
  ): Promise<IFieldDocument> {
    return checkFieldAccess(fieldId, userId, orgId, role);
  }

  async updateField(
    userId: string,
    fieldId: string,
    input: UpdateFieldInput,
    orgId?: Types.ObjectId,
    role?: OrganisationRole,
  ): Promise<IFieldDocument> {
    const existingField = await checkFieldAccess(fieldId, userId, orgId, role);

    const updateData: Partial<IField> = {};

    if (input.farmerId !== undefined) {
      if (role === 'agent' && input.farmerId !== existingField.farmerId?.toString()) {
        throw new AppError('Forbidden: agents cannot reassign fields to different farmers', 403, 'FORBIDDEN');
      }
      if (input.farmerId) {
        const targetFarmer = await FarmerModel.findOne({
          _id: new Types.ObjectId(input.farmerId),
          orgId: existingField.orgId || orgId,
          status: { $ne: 'deleted' },
        });
        if (!targetFarmer) {
          throw new AppError('Farmer not found in this organisation', 404, 'FARMER_NOT_FOUND');
        }
        updateData.farmerId = targetFarmer._id;
      } else {
        updateData.farmerId = null;
      }
    }

    if (input.name !== undefined) {
      updateData.name = input.name;
    }
    if (input.cropKey !== undefined) {
      updateData.cropKey = input.cropKey;
    }
    if (input.sowingDate !== undefined) {
      updateData.sowingDate =
        typeof input.sowingDate === 'string' ? new Date(input.sowingDate) : input.sowingDate;
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
    if (input.locationMode !== undefined) {
      updateData.locationMode = input.locationMode;
    }
    if (input.areaValue !== undefined) {
      updateData.areaValue = input.areaValue;
    }
    if (input.areaUnit !== undefined) {
      updateData.areaUnit = input.areaUnit;
    }
    if (input.customAcresPerUnit !== undefined) {
      updateData.customAcresPerUnit = input.customAcresPerUnit;
    }
    if (input.waterMode !== undefined) {
      updateData.waterMode = input.waterMode;
    }
    if (input.hasProtectiveWater !== undefined) {
      updateData.hasProtectiveWater = input.hasProtectiveWater;
    }

    // If geometry changed, re-validate and re-calculate area and centroid on server
    if (input.geometry !== undefined) {
      if (input.geometry && Array.isArray(input.geometry.coordinates) && input.geometry.coordinates.length > 0) {
        try {
          const geoResult = validatePolygon(input.geometry);
          updateData.geometry = input.geometry;
          updateData.areaHa = geoResult.areaHa;
          updateData.centroid = geoResult.centroid;
          updateData.location = geoResult.centroid;
          updateData.locationMode = 'polygon';
          updateData.areaWarning =
            geoResult.areaHa > AREA_CONFIG.largeAreaWarningHa.value
              ? `Field area (${geoResult.areaHa.toFixed(2)} ha) exceeds ${AREA_CONFIG.largeAreaWarningHa.value} ha.`
              : null;
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Invalid polygon geometry';
          throw new AppError(message, 400, 'INVALID_GEOMETRY');
        }
      } else {
        updateData.geometry = null;
      }
    } else if (input.location !== undefined || (input.locationMode === 'pin' && input.areaValue !== undefined)) {
      if (input.location) {
        const [lng, lat] = input.location.coordinates;
        if (
          typeof lng !== 'number' ||
          typeof lat !== 'number' ||
          isNaN(lng) ||
          isNaN(lat) ||
          lng < INDIA_BOUNDS.minLng ||
          lng > INDIA_BOUNDS.maxLng ||
          lat < INDIA_BOUNDS.minLat ||
          lat > INDIA_BOUNDS.maxLat
        ) {
          throw new AppError("Coordinate is outside India's bounding box", 400, 'INVALID_COORDINATES');
        }
        updateData.location = {
          type: 'Point',
          coordinates: [Number(lng.toFixed(6)), Number(lat.toFixed(6))],
        };
        updateData.centroid = updateData.location;
      }

      if (input.areaValue !== undefined && input.areaUnit !== undefined && input.areaValue !== null && input.areaUnit !== null) {
        const areaHa = toHectares(input.areaValue, input.areaUnit, input.customAcresPerUnit ?? undefined);
        if (areaHa < AREA_CONFIG.minAreaHa.value || areaHa > AREA_CONFIG.maxAreaHa.value) {
          throw new AppError('Field area is outside allowable limits (0.01 - 500 ha)', 400, 'INVALID_AREA');
        }
        updateData.areaHa = areaHa;
        updateData.areaWarning =
          areaHa > AREA_CONFIG.largeAreaWarningHa.value
            ? `Field area (${areaHa.toFixed(2)} ha) exceeds ${AREA_CONFIG.largeAreaWarningHa.value} ha.`
            : null;
      }
    }

    const result = await this.repo.updateWithVersion(fieldId, input.version, updateData);

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

  async deleteField(
    userId: string,
    fieldId: string,
    orgId?: Types.ObjectId,
    role?: OrganisationRole,
  ): Promise<void> {
    const field = await checkFieldAccess(fieldId, userId, orgId, role);
    const deleted = await this.repo.delete(field._id.toString());
    if (!deleted) {
      throw new AppError('Field not found', 404, 'FIELD_NOT_FOUND');
    }
  }

  async getNearbyFields(
    userId: string,
    lng: number,
    lat: number,
    km: number,
    orgId?: Types.ObjectId,
    role?: OrganisationRole,
  ): Promise<IFieldDocument[]> {
    const maxDistanceMeters = km * 1000;
    if (orgId) {
      if (role === 'agent') {
        const assignedFarmers = await FarmerModel.find({
          orgId,
          assignedAgentId: new Types.ObjectId(userId),
          status: { $ne: 'deleted' },
        }).select('_id');
        const farmerIds = assignedFarmers.map((f) => f._id);
        return FieldModel.find({
          orgId,
          farmerId: { $in: farmerIds },
          centroid: {
            $nearSphere: {
              $geometry: { type: 'Point', coordinates: [lng, lat] },
              $maxDistance: maxDistanceMeters,
            },
          },
        });
      }

      return FieldModel.find({
        orgId,
        centroid: {
          $nearSphere: {
            $geometry: { type: 'Point', coordinates: [lng, lat] },
            $maxDistance: maxDistanceMeters,
          },
        },
      });
    }

    return this.repo.findNearby(userId, lng, lat, maxDistanceMeters);
  }
}

export const fieldService = new FieldService();
