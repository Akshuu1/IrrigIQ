import { Types } from 'mongoose';
import { FieldModel, IField, IFieldDocument } from '../models/field.model.js';

export type UpdateResult =
  | { status: 'SUCCESS'; field: IFieldDocument }
  | { status: 'NOT_FOUND' }
  | { status: 'CONFLICT'; currentVersion: number };

export class FieldRepository {
  async create(data: Partial<IField>): Promise<IFieldDocument> {
    const field = new FieldModel(data);
    return field.save();
  }

  async findById(id: string, userId: string): Promise<IFieldDocument | null> {
    if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(userId)) {
      return null;
    }
    return FieldModel.findOne({
      _id: new Types.ObjectId(id),
      userId: new Types.ObjectId(userId),
    });
  }

  async findByUserId(userId: string): Promise<IFieldDocument[]> {
    if (!Types.ObjectId.isValid(userId)) {
      return [];
    }
    return FieldModel.find({
      userId: new Types.ObjectId(userId),
    }).sort({ updatedAt: -1 });
  }

  async updateWithVersion(
    id: string,
    userId: string,
    version: number,
    updateData: Partial<IField>,
  ): Promise<UpdateResult> {
    if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(userId)) {
      return { status: 'NOT_FOUND' };
    }

    const objectId = new Types.ObjectId(id);
    const userObjectId = new Types.ObjectId(userId);

    // First check if the field exists for this user
    const existing = await FieldModel.findOne({
      _id: objectId,
      userId: userObjectId,
    });

    if (!existing) {
      return { status: 'NOT_FOUND' };
    }

    // Check version match (optimistic concurrency control)
    if (existing.version !== version) {
      return { status: 'CONFLICT', currentVersion: existing.version };
    }

    // Atomically increment version while updating
    const updated = await FieldModel.findOneAndUpdate(
      {
        _id: objectId,
        userId: userObjectId,
        version,
      },
      {
        ...updateData,
        $inc: { version: 1 },
      },
      {
        new: true,
        runValidators: true,
      },
    );

    if (!updated) {
      // Race condition occurred between find and findOneAndUpdate
      const fresh = await FieldModel.findOne({ _id: objectId, userId: userObjectId });
      return { status: 'CONFLICT', currentVersion: fresh?.version ?? version };
    }

    return { status: 'SUCCESS', field: updated };
  }

  async delete(id: string, userId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(userId)) {
      return false;
    }
    const result = await FieldModel.deleteOne({
      _id: new Types.ObjectId(id),
      userId: new Types.ObjectId(userId),
    });
    return (result.deletedCount ?? 0) > 0;
  }

  async findNearby(
    userId: string,
    lng: number,
    lat: number,
    maxDistanceMeters: number,
  ): Promise<IFieldDocument[]> {
    if (!Types.ObjectId.isValid(userId)) {
      return [];
    }

    // Earth's radius in meters approx 6,378,137m
    const radiusInRadians = maxDistanceMeters / 6378137;

    return FieldModel.find({
      userId: new Types.ObjectId(userId),
      geometry: {
        $geoWithin: {
          $centerSphere: [[lng, lat], radiusInRadians],
        },
      },
    });
  }
}

export const fieldRepository = new FieldRepository();
