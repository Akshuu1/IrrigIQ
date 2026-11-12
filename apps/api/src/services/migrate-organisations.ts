import mongoose from 'mongoose';
import { UserModel } from '../models/user.model.js';
import { OrganisationModel } from '../models/organisation.model.js';
import { MembershipModel } from '../models/membership.model.js';
import { FarmerModel } from '../models/farmer.model.js';
import { FieldModel } from '../models/field.model.js';
import { getEnv } from '../config/env.js';
import { logger } from '../config/logger.js';

export interface MigrationOptions {
  dryRun?: boolean;
  mongoUri?: string;
  silent?: boolean;
}

export interface OrgMigrationResult {
  usersScanned: number;
  orgsCreated: number;
  membershipsCreated: number;
  farmersCreated: number;
  fieldsUpdated: number;
  unchanged: number;
  errors: number;
  dryRun: boolean;
}

export async function runOrganisationMigration(
  options: MigrationOptions = {},
): Promise<OrgMigrationResult> {
  const dryRun = options.dryRun ?? process.argv.includes('--dry-run');
  const env = getEnv();
  const mongoUri = options.mongoUri || env.MONGODB_URI;

  const shouldDisconnect = mongoose.connection.readyState === 0;
  if (shouldDisconnect) {
    await mongoose.connect(mongoUri);
  }

  const result: OrgMigrationResult = {
    usersScanned: 0,
    orgsCreated: 0,
    membershipsCreated: 0,
    farmersCreated: 0,
    fieldsUpdated: 0,
    unchanged: 0,
    errors: 0,
    dryRun,
  };

  try {
    const users = await UserModel.find({});
    result.usersScanned = users.length;

    for (const user of users) {
      try {
        let membership = await MembershipModel.findOne({
          userId: user._id,
        }).sort({ createdAt: 1 });

        let orgId = membership?.orgId;

        if (!membership) {
          const orgName = user.name ? `${user.name}'s Farm` : 'Personal Farm';
          if (!dryRun) {
            const org = await OrganisationModel.create({ name: orgName });
            membership = await MembershipModel.create({
              orgId: org._id,
              userId: user._id,
              role: 'admin',
            });
            orgId = org._id;
          }
          result.orgsCreated++;
          result.membershipsCreated++;
        }

        let farmer = orgId
          ? await FarmerModel.findOne({ orgId, userId: user._id, status: { $ne: 'deleted' } })
          : null;

        if (!farmer) {
          if (!dryRun && orgId) {
            farmer = await FarmerModel.create({
              orgId,
              userId: user._id,
              name: user.name || 'Owner',
              language: user.language || 'en',
              status: 'active',
            });
          }
          result.farmersCreated++;
        }

        // Migrate unlinked fields for this user
        const unmigratedFields = await FieldModel.find({
          userId: user._id,
          $or: [
            { orgId: null },
            { orgId: { $exists: false } },
            { farmerId: null },
            { farmerId: { $exists: false } },
          ],
        });

        if (unmigratedFields.length > 0) {
          if (!dryRun && orgId && farmer) {
            for (const field of unmigratedFields) {
              field.orgId = orgId;
              field.farmerId = farmer._id;
              await field.save();
              result.fieldsUpdated++;
            }
          } else {
            result.fieldsUpdated += unmigratedFields.length;
          }
        } else {
          result.unchanged++;
        }
      } catch (err) {
        result.errors++;
        if (!options.silent) {
          logger.error({ err, userId: user._id }, 'Error migrating user into organisation');
        }
      }
    }
  } finally {
    if (shouldDisconnect) {
      await mongoose.disconnect();
    }
  }

  if (!options.silent) {
    logger.info(
      result,
      `Organisation migration completed ${dryRun ? '(DRY RUN)' : '(COMMITTED)'}`,
    );
  }

  return result;
}

