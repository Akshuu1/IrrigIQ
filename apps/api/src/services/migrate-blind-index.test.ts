import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MessageChannelModel } from '../models/message-channel.model.js';
import { encryptExternalId, hashExternalId } from '../utils/crypto.js';
import { runBlindIndexMigration } from './migrate-blind-index.js';

describe('Blind Index Migration (scripts/migrate-blind-index.ts)', () => {
  let mongoServer: MongoMemoryServer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  it('runs idempotently with --dry-run and live updates', async () => {
    const rawExternalId = '9876543210';
    // Legacy plain SHA-256 hash
    const legacyPlainHash = crypto.createHash('sha256').update(rawExternalId).digest('hex');
    const encrypted = encryptExternalId(rawExternalId);

    const testChannel = await MessageChannelModel.create({
      userId: new Types.ObjectId(),
      provider: 'telegram',
      externalIdEncrypted: encrypted,
      externalIdHash: legacyPlainHash,
      status: 'active',
      optedIn: true,
    });

    const expectedNewBlindIndex = hashExternalId(rawExternalId);
    expect(legacyPlainHash).not.toBe(expectedNewBlindIndex);

    // 1. Dry run should report 1 would be migrated, but not alter document
    const dryRunResult = await runBlindIndexMigration({ dryRun: true, silent: true });
    expect(dryRunResult.total).toBe(1);
    expect(dryRunResult.migrated).toBe(1);
    expect(dryRunResult.unchanged).toBe(0);
    expect(dryRunResult.errors).toBe(0);
    expect(dryRunResult.dryRun).toBe(true);

    const docAfterDryRun = await MessageChannelModel.findById(testChannel._id);
    expect(docAfterDryRun?.externalIdHash).toBe(legacyPlainHash);

    // 2. Live migration should update document to expected HMAC-SHA256 blind index
    const liveResult = await runBlindIndexMigration({ dryRun: false, silent: true });
    expect(liveResult.total).toBe(1);
    expect(liveResult.migrated).toBe(1);
    expect(liveResult.unchanged).toBe(0);
    expect(liveResult.errors).toBe(0);
    expect(liveResult.dryRun).toBe(false);

    const docAfterLive = await MessageChannelModel.findById(testChannel._id);
    expect(docAfterLive?.externalIdHash).toBe(expectedNewBlindIndex);

    // 3. Second execution must be strictly idempotent (0 migrated, 1 unchanged)
    const secondRun = await runBlindIndexMigration({ dryRun: false, silent: true });
    expect(secondRun.total).toBe(1);
    expect(secondRun.migrated).toBe(0);
    expect(secondRun.unchanged).toBe(1);
    expect(secondRun.errors).toBe(0);
  });
});
