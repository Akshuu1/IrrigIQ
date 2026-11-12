import { Types } from 'mongoose';
import { FarmerModel, IFarmerDocument, FarmerStatus } from '../models/farmer.model.js';
import { MembershipModel, OrganisationRole } from '../models/membership.model.js';
import { AppError } from '../errors/AppError.js';
import { hashExternalId, encryptExternalId } from '../utils/crypto.js';

export interface CreateFarmerInput {
  name: string;
  phone?: string;
  language?: string;
  village?: string;
  assignedAgentId?: string | null;
}

export interface UpdateFarmerInput {
  name?: string;
  phone?: string;
  language?: string;
  village?: string;
  assignedAgentId?: string | null;
  status?: FarmerStatus;
}

export class FarmerService {
  async createFarmer(
    orgId: Types.ObjectId,
    userId: Types.ObjectId,
    role: OrganisationRole,
    input: CreateFarmerInput,
  ): Promise<IFarmerDocument> {
    const trimmedName = input.name?.trim();
    if (!trimmedName) {
      throw new AppError('Farmer name is required', 400, 'INVALID_NAME');
    }

    let assignedAgentId: Types.ObjectId | null = null;

    if (role === 'admin') {
      if (input.assignedAgentId) {
        if (!Types.ObjectId.isValid(input.assignedAgentId)) {
          throw new AppError('Invalid assigned agent ID', 400, 'INVALID_AGENT_ID');
        }
        const agentObjId = new Types.ObjectId(input.assignedAgentId);
        // Verify target is a member of this organisation
        const isMember = await MembershipModel.findOne({
          orgId,
          userId: agentObjId,
        });
        if (!isMember) {
          throw new AppError('Assigned agent must be a member of this organisation', 400, 'AGENT_NOT_MEMBER');
        }
        assignedAgentId = agentObjId;
      }
    } else {
      // Role is 'agent' -> farmer is strictly assigned to the creating agent
      assignedAgentId = userId;
    }

    let phoneEncrypted = '';
    let phoneHash = '';

    if (input.phone && input.phone.trim()) {
      const cleanPhone = input.phone.trim();
      phoneHash = hashExternalId(cleanPhone);
      phoneEncrypted = encryptExternalId(cleanPhone);
    }

    const farmer = await FarmerModel.create({
      orgId,
      name: trimmedName,
      phoneEncrypted,
      phoneHash,
      language: input.language || 'en',
      village: input.village?.trim() || '',
      assignedAgentId,
      status: 'active',
    });

    return farmer;
  }

  async listFarmers(
    orgId: Types.ObjectId,
    userId: Types.ObjectId,
    role: OrganisationRole,
  ): Promise<IFarmerDocument[]> {
    const query: Record<string, unknown> = {
      orgId,
      status: { $ne: 'deleted' },
    };

    if (role === 'agent') {
      query.assignedAgentId = userId;
    }

    return await FarmerModel.find(query).sort({ createdAt: -1 });
  }

  async getFarmer(
    orgId: Types.ObjectId,
    userId: Types.ObjectId,
    role: OrganisationRole,
    farmerId: string | Types.ObjectId,
  ): Promise<IFarmerDocument> {
    if (!Types.ObjectId.isValid(farmerId)) {
      throw new AppError('Farmer not found', 404, 'FARMER_NOT_FOUND');
    }

    const farmer = await FarmerModel.findOne({
      _id: new Types.ObjectId(farmerId),
      orgId,
      status: { $ne: 'deleted' },
    });

    if (!farmer) {
      throw new AppError('Farmer not found in this organisation', 404, 'FARMER_NOT_FOUND');
    }

    if (role === 'agent') {
      if (!farmer.assignedAgentId || farmer.assignedAgentId.toString() !== userId.toString()) {
        throw new AppError('Forbidden: not assigned to this farmer', 403, 'FORBIDDEN');
      }
    }

    return farmer;
  }

  async updateFarmer(
    orgId: Types.ObjectId,
    userId: Types.ObjectId,
    role: OrganisationRole,
    farmerId: string | Types.ObjectId,
    input: UpdateFarmerInput,
  ): Promise<IFarmerDocument> {
    const farmer = await this.getFarmer(orgId, userId, role, farmerId);

    if (input.name !== undefined) {
      const trimmed = input.name.trim();
      if (!trimmed) {
        throw new AppError('Farmer name cannot be empty', 400, 'INVALID_NAME');
      }
      farmer.name = trimmed;
    }

    if (input.language !== undefined) {
      farmer.language = input.language;
    }

    if (input.village !== undefined) {
      farmer.village = input.village.trim();
    }

    if (input.phone !== undefined) {
      if (input.phone.trim()) {
        const cleanPhone = input.phone.trim();
        farmer.phoneHash = hashExternalId(cleanPhone);
        farmer.phoneEncrypted = encryptExternalId(cleanPhone);
      } else {
        farmer.phoneHash = '';
        farmer.phoneEncrypted = '';
      }
    }

    // Role-restricted field updates
    if (role === 'admin') {
      if (input.assignedAgentId !== undefined) {
        if (input.assignedAgentId === null || input.assignedAgentId === '') {
          farmer.assignedAgentId = null;
        } else {
          if (!Types.ObjectId.isValid(input.assignedAgentId)) {
            throw new AppError('Invalid assigned agent ID', 400, 'INVALID_AGENT_ID');
          }
          const agentObjId = new Types.ObjectId(input.assignedAgentId);
          const isMember = await MembershipModel.findOne({ orgId, userId: agentObjId });
          if (!isMember) {
            throw new AppError('Assigned agent must be a member of this organisation', 400, 'AGENT_NOT_MEMBER');
          }
          farmer.assignedAgentId = agentObjId;
        }
      }

      if (input.status !== undefined) {
        farmer.status = input.status;
      }
    } else {
      // Agent is attempting to change assignedAgentId or status
      if (input.assignedAgentId !== undefined && input.assignedAgentId !== farmer.assignedAgentId?.toString()) {
        throw new AppError('Agents cannot reassign farmers', 403, 'FORBIDDEN');
      }
      if (input.status !== undefined && input.status !== farmer.status) {
        throw new AppError('Agents cannot change farmer status', 403, 'FORBIDDEN');
      }
    }

    await farmer.save();
    return farmer;
  }

  async deleteFarmer(
    orgId: Types.ObjectId,
    userId: Types.ObjectId,
    role: OrganisationRole,
    farmerId: string | Types.ObjectId,
  ): Promise<{ success: boolean }> {
    if (role !== 'admin') {
      throw new AppError('Admin role required to delete a farmer record', 403, 'FORBIDDEN');
    }

    const farmer = await this.getFarmer(orgId, userId, role, farmerId);
    farmer.status = 'deleted';
    await farmer.save();

    return { success: true };
  }
}

export const farmerService = new FarmerService();
