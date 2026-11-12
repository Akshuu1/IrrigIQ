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
    versionOrUserId: number | string,
    updateDataOrVersion: Partial<IField> | number,
    optionalUpdateData?: Partial<IField>,
  ): Promise<UpdateResult> {
    if (!Types.ObjectId.isValid(id)) {
      return { status: 'NOT_FOUND' };
    }

    const objectId = new Types.ObjectId(id);
    let version: number;
    let updateData: Partial<IField>;
    const query: Record<string, unknown> = { _id: objectId };

    if (typeof versionOrUserId === 'string') {
      if (Types.ObjectId.isValid(versionOrUserId)) {
        query.userId = new Types.ObjectId(versionOrUserId);
      }
      version = updateDataOrVersion as number;
      updateData = optionalUpdateData || {};
    } else {
      version = versionOrUserId;
      updateData = updateDataOrVersion as Partial<IField>;
    }

    // First check if the field exists
    const existing = await FieldModel.findOne(query);

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
        ...query,
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
      const fresh = await FieldModel.findOne(query);
      return { status: 'CONFLICT', currentVersion: fresh?.version ?? version };
    }

    return { status: 'SUCCESS', field: updated };
  }

  async delete(id: string, userId?: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) {
      return false;
    }
    const query: Record<string, unknown> = { _id: new Types.ObjectId(id) };
    if (userId && Types.ObjectId.isValid(userId)) {
      query.userId = new Types.ObjectId(userId);
    }
    const result = await FieldModel.deleteOne(query);
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
      $or: [
        {
          geometry: {
            $geoWithin: {
              $centerSphere: [[lng, lat], radiusInRadians],
            },
          },
        },
        {
          centroid: {
            $geoWithin: {
              $centerSphere: [[lng, lat], radiusInRadians],
            },
          },
        },
      ],
    });
  }
}

export const fieldRepository = new FieldRepository();
