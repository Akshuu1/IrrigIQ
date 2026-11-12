import mongoose from 'mongoose';
import { MessageChannelModel } from '../models/message-channel.model.js';
import { decryptExternalId, hashExternalId } from '../utils/crypto.js';
import { getEnv } from '../config/env.js';

export interface MigrationOptions {
  dryRun?: boolean;
  mongoUri?: string;
  silent?: boolean;
}

export interface MigrationResult {
  total: number;
  migrated: number;
  unchanged: number;
  errors: number;
  dryRun: boolean;
}

export async function runBlindIndexMigration(options: MigrationOptions = {}): Promise<MigrationResult> {
  const dryRun = options.dryRun ?? process.argv.includes('--dry-run');
  const env = getEnv();
  const mongoUri = options.mongoUri || env.MONGODB_URI;

  const shouldDisconnect = mongoose.connection.readyState === 0;
  if (shouldDisconnect) {
    await mongoose.connect(mongoUri);
  }

  const result: MigrationResult = {
    total: 0,
    migrated: 0,
    unchanged: 0,
    errors: 0,
    dryRun,
  };

  try {
    const channels = await MessageChannelModel.find({});
    result.total = channels.length;

    for (const channel of channels) {
      try {
        if (!channel.externalIdEncrypted) {
          result.unchanged++;
          continue;
        }

        const plainExternalId = decryptExternalId(channel.externalIdEncrypted);
        const newBlindIndex = hashExternalId(plainExternalId);

        if (channel.externalIdHash === newBlindIndex) {
          result.unchanged++;
          continue;
        }

        if (!options.silent) {
          console.log(
            `${dryRun ? '[DRY-RUN] Would migrate' : 'Migrating'} channel ${channel._id}: old hash ${channel.externalIdHash.slice(0, 8)}... -> new hash ${newBlindIndex.slice(0, 8)}...`,
          );
        }

        if (!dryRun) {
          channel.externalIdHash = newBlindIndex;
          await channel.save();
        }
        result.migrated++;
      } catch (err) {
        result.errors++;
        if (!options.silent) {
          console.error(`Failed to migrate channel ${channel._id}:`, err instanceof Error ? err.message : err);
        }
      }
    }

    if (!options.silent) {
      console.log('----------------------------------------------------');
      console.log(`Migration Complete (${dryRun ? 'DRY RUN' : 'LIVE'}):`);
      console.log(`  Total Channels:    ${result.total}`);
      console.log(`  Migrated:          ${result.migrated}`);
      console.log(`  Already Up-to-date:${result.unchanged}`);
      console.log(`  Errors:            ${result.errors}`);
      console.log('----------------------------------------------------');
    }

    return result;
  } finally {
    if (shouldDisconnect && mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }
}

