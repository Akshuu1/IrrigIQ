import { Types } from 'mongoose';
import { FieldModel, IFieldDocument } from '../models/field.model.js';
import { MembershipModel, OrganisationRole } from '../models/membership.model.js';
import { FarmerModel } from '../models/farmer.model.js';
import { AppError } from '../errors/AppError.js';

export async function checkFieldAccess(
  fieldId: string | Types.ObjectId,
  userId: string | Types.ObjectId,
  orgId?: string | Types.ObjectId,
  role?: OrganisationRole,
): Promise<IFieldDocument> {
  if (!Types.ObjectId.isValid(fieldId)) {
    throw new AppError('Field not found', 404, 'FIELD_NOT_FOUND');
  }

  const fId = new Types.ObjectId(fieldId);
  const uId = new Types.ObjectId(userId);
  const field = await FieldModel.findById(fId);

  if (!field) {
    throw new AppError('Field not found', 404, 'FIELD_NOT_FOUND');
  }

  // 1. Scoped to an organisation
  if (field.orgId) {
    if (orgId && field.orgId.toString() !== orgId.toString()) {
      throw new AppError('Field not found in this organisation', 404, 'FIELD_NOT_FOUND');
    }

    // Determine user's membership and role in this field's organisation
    let userRole = role;
    if (!userRole || (orgId && field.orgId.toString() !== orgId.toString())) {
      const membership = await MembershipModel.findOne({
        orgId: field.orgId,
        userId: uId,
      });
      if (!membership) {
        throw new AppError('Field not found in this organisation', 404, 'FIELD_NOT_FOUND');
      }
      userRole = membership.role;
    }

    if (userRole === 'admin') {
      return field;
    }

    // Role is 'agent' -> can only access fields belonging to assigned farmers
    if (field.farmerId) {
      const farmer = await FarmerModel.findOne({
        _id: field.farmerId,
        orgId: field.orgId,
        status: { $ne: 'deleted' },
      });

      if (!farmer) {
        throw new AppError('Farmer not found or deleted', 404, 'FARMER_NOT_FOUND');
      }

      if (
        farmer.assignedAgentId?.toString() === uId.toString() ||
        field.userId?.toString() === uId.toString()
      ) {
        return field;
      }

      throw new AppError('Forbidden: field belongs to a farmer not assigned to you', 403, 'FORBIDDEN');
    }

    if (field.userId?.toString() === uId.toString()) {
      return field;
    }

    throw new AppError('Forbidden: field not assigned to you', 403, 'FORBIDDEN');
  }

  // 2. Legacy / unmigrated field
  if (field.userId.toString() !== uId.toString()) {
    throw new AppError('Field not found', 404, 'FIELD_NOT_FOUND');
  }

  return field;
}

