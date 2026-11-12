import { Types } from 'mongoose';
import { OrganisationModel, IOrganisationDocument } from '../models/organisation.model.js';
import { MembershipModel, IMembershipDocument, OrganisationRole } from '../models/membership.model.js';
import { UserModel } from '../models/user.model.js';
import { AppError } from '../errors/AppError.js';

export interface MemberInfo {
  id: string;
  userId: string;
  orgId: string;
  role: OrganisationRole;
  user: {
    id: string;
    name: string;
    email: string;
  };
  createdAt: Date;
}

export class OrganisationService {
  async createOrganisation(
    userId: string | Types.ObjectId,
    name: string,
  ): Promise<{ organisation: IOrganisationDocument; membership: IMembershipDocument }> {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new AppError('Organisation name is required', 400, 'INVALID_NAME');
    }

    const org = await OrganisationModel.create({ name: trimmedName });
    const membership = await MembershipModel.create({
      orgId: org._id,
      userId: new Types.ObjectId(userId),
      role: 'admin',
    });

    return { organisation: org, membership };
  }

  async listUserOrganisations(
    userId: string | Types.ObjectId,
  ): Promise<Array<{ organisation: IOrganisationDocument; role: OrganisationRole }>> {
    const memberships = await MembershipModel.find({ userId: new Types.ObjectId(userId) }).sort({
      createdAt: 1,
    });

    if (memberships.length === 0) {
      return [];
    }

    const orgIds = memberships.map((m) => m.orgId);
    const orgs = await OrganisationModel.find({ _id: { $in: orgIds } });
    const orgMap = new Map<string, IOrganisationDocument>(orgs.map((o) => [o._id.toString(), o]));

    const result: Array<{ organisation: IOrganisationDocument; role: OrganisationRole }> = [];
    for (const m of memberships) {
      const org = orgMap.get(m.orgId.toString());
      if (org) {
        result.push({ organisation: org, role: m.role });
      }
    }

    return result;
  }

  async getOrganisation(
    orgId: string | Types.ObjectId,
    userId: string | Types.ObjectId,
  ): Promise<{ organisation: IOrganisationDocument; role: OrganisationRole }> {
    const membership = await MembershipModel.findOne({
      orgId: new Types.ObjectId(orgId),
      userId: new Types.ObjectId(userId),
    });

    if (!membership) {
      throw new AppError('Not a member of this organisation', 403, 'FORBIDDEN');
    }

    const org = await OrganisationModel.findById(orgId);
    if (!org) {
      throw new AppError('Organisation not found', 404, 'ORG_NOT_FOUND');
    }

    return { organisation: org, role: membership.role };
  }

  async updateOrganisation(
    orgId: string | Types.ObjectId,
    userId: string | Types.ObjectId,
    name: string,
  ): Promise<IOrganisationDocument> {
    const membership = await MembershipModel.findOne({
      orgId: new Types.ObjectId(orgId),
      userId: new Types.ObjectId(userId),
    });

    if (!membership || membership.role !== 'admin') {
      throw new AppError('Admin role required to update organisation', 403, 'FORBIDDEN');
    }

    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new AppError('Organisation name cannot be empty', 400, 'INVALID_NAME');
    }

    const org = await OrganisationModel.findByIdAndUpdate(
      orgId,
      { name: trimmedName },
      { new: true },
    );

    if (!org) {
      throw new AppError('Organisation not found', 404, 'ORG_NOT_FOUND');
    }

    return org;
  }

  async listMembers(
    orgId: string | Types.ObjectId,
    userId: string | Types.ObjectId,
  ): Promise<MemberInfo[]> {
    const userMembership = await MembershipModel.findOne({
      orgId: new Types.ObjectId(orgId),
      userId: new Types.ObjectId(userId),
    });

    if (!userMembership) {
      throw new AppError('Not a member of this organisation', 403, 'FORBIDDEN');
    }

    const memberships = await MembershipModel.find({
      orgId: new Types.ObjectId(orgId),
    }).sort({ createdAt: 1 });

    const userIds = memberships.map((m) => m.userId);
    const users = await UserModel.find({ _id: { $in: userIds } });
    const userMap = new Map(users.map((u) => [u._id.toString(), u]));

    return memberships.map((m) => {
      const u = userMap.get(m.userId.toString());
      return {
        id: m._id.toString(),
        userId: m.userId.toString(),
        orgId: m.orgId.toString(),
        role: m.role,
        user: {
          id: m.userId.toString(),
          name: u?.name || 'Unknown',
          email: u?.email || '',
        },
        createdAt: m.createdAt,
      };
    });
  }

  async addMember(
    orgId: string | Types.ObjectId,
    adminUserId: string | Types.ObjectId,
    input: { email: string; role: OrganisationRole },
  ): Promise<MemberInfo> {
    const adminMembership = await MembershipModel.findOne({
      orgId: new Types.ObjectId(orgId),
      userId: new Types.ObjectId(adminUserId),
    });

    if (!adminMembership || adminMembership.role !== 'admin') {
      throw new AppError('Admin role required to manage members', 403, 'FORBIDDEN');
    }

    const targetUser = await UserModel.findOne({ email: input.email.trim().toLowerCase() });
    if (!targetUser) {
      throw new AppError('User not found with provided email', 404, 'USER_NOT_FOUND');
    }

    const existing = await MembershipModel.findOne({
      orgId: new Types.ObjectId(orgId),
      userId: targetUser._id,
    });

    if (existing) {
      throw new AppError('User is already a member of this organisation', 409, 'ALREADY_MEMBER');
    }

    const membership = await MembershipModel.create({
      orgId: new Types.ObjectId(orgId),
      userId: targetUser._id,
      role: input.role,
    });

    return {
      id: membership._id.toString(),
      userId: targetUser._id.toString(),
      orgId: membership.orgId.toString(),
      role: membership.role,
      user: {
        id: targetUser._id.toString(),
        name: targetUser.name,
        email: targetUser.email,
      },
      createdAt: membership.createdAt,
    };
  }

  async updateMemberRole(
    orgId: string | Types.ObjectId,
    adminUserId: string | Types.ObjectId,
    targetUserId: string | Types.ObjectId,
    newRole: OrganisationRole,
  ): Promise<IMembershipDocument> {
    const adminMembership = await MembershipModel.findOne({
      orgId: new Types.ObjectId(orgId),
      userId: new Types.ObjectId(adminUserId),
    });

    if (!adminMembership || adminMembership.role !== 'admin') {
      throw new AppError('Admin role required to update member roles', 403, 'FORBIDDEN');
    }

    const targetMembership = await MembershipModel.findOne({
      orgId: new Types.ObjectId(orgId),
      userId: new Types.ObjectId(targetUserId),
    });

    if (!targetMembership) {
      throw new AppError('Member not found in organisation', 404, 'MEMBER_NOT_FOUND');
    }

    // Safety: ensure at least one admin remains
    if (targetMembership.role === 'admin' && newRole === 'agent') {
      const adminCount = await MembershipModel.countDocuments({
        orgId: new Types.ObjectId(orgId),
        role: 'admin',
      });
      if (adminCount <= 1) {
        throw new AppError('Cannot demote the only admin of an organisation', 400, 'CANNOT_DEMOTE_SOLE_ADMIN');
      }
    }

    targetMembership.role = newRole;
    await targetMembership.save();
    return targetMembership;
  }

  async removeMember(
    orgId: string | Types.ObjectId,
    adminUserId: string | Types.ObjectId,
    targetUserId: string | Types.ObjectId,
  ): Promise<{ success: boolean }> {
    const adminMembership = await MembershipModel.findOne({
      orgId: new Types.ObjectId(orgId),
      userId: new Types.ObjectId(adminUserId),
    });

    if (!adminMembership || adminMembership.role !== 'admin') {
      throw new AppError('Admin role required to remove members', 403, 'FORBIDDEN');
    }

    const targetMembership = await MembershipModel.findOne({
      orgId: new Types.ObjectId(orgId),
      userId: new Types.ObjectId(targetUserId),
    });

    if (!targetMembership) {
      throw new AppError('Member not found in organisation', 404, 'MEMBER_NOT_FOUND');
    }

    if (targetMembership.role === 'admin') {
      const adminCount = await MembershipModel.countDocuments({
        orgId: new Types.ObjectId(orgId),
        role: 'admin',
      });
      if (adminCount <= 1) {
        throw new AppError('Cannot remove the only admin of an organisation', 400, 'CANNOT_REMOVE_SOLE_ADMIN');
      }
    }

    await MembershipModel.deleteOne({ _id: targetMembership._id });
    return { success: true };
  }
}

export const organisationService = new OrganisationService();

