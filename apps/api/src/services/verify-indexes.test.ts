import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { FieldModel } from '../models/field.model.js';
import { RecommendationModel } from '../models/recommendation.model.js';
import { SensorReadingModel } from '../models/sensor-reading.model.js';
import { PumpModel } from '../models/pump.model.js';
import { MessageChannelModel } from '../models/message-channel.model.js';

describe('MongoDB Explain Execution Plan & Index Optimization', () => {
  let mongoServer: MongoMemoryServer | null = null;

  beforeAll(async () => {
    const defaultUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27018/irrigiq_index_test';
    try {
      await mongoose.connect(defaultUri, { serverSelectionTimeoutMS: 2000 });
    } catch {
      mongoServer = await MongoMemoryServer.create({
        binary: { version: '7.0.14' },
      });
      await mongoose.connect(mongoServer.getUri());
    }

    // Ensure all indexes on all models are compiled and created in MongoDB
    await FieldModel.syncIndexes();
    await RecommendationModel.syncIndexes();
    await SensorReadingModel.syncIndexes();
    await PumpModel.syncIndexes();
    await MessageChannelModel.syncIndexes();
  }, 30000);

  afterAll(async () => {
    try {
      await FieldModel.deleteMany({ name: 'Index Test Field' });
    } catch {
      // ignore cleanup errors
    }
    await mongoose.disconnect();
    if (mongoServer) {
      await mongoServer.stop();
    }
  }, 30000);

  function hasCollscan(stage: any): boolean {
    if (!stage) return false;
    if (stage.stage === 'COLLSCAN') return true;
    if (stage.inputStage && hasCollscan(stage.inputStage)) return true;
    if (Array.isArray(stage.inputStages)) {
      return stage.inputStages.some((s: any) => hasCollscan(s));
    }
    return false;
  }

  function findIndexScanStages(stage: any): string[] {
    const stages: string[] = [];
    if (!stage) return stages;
    if (['IXSCAN', 'GEO_NEAR_2DSPHERE', 'GEO_2DSPHERE'].includes(stage.stage)) {
      stages.push(stage.stage);
    }
    if (stage.inputStage) {
      stages.push(...findIndexScanStages(stage.inputStage));
    }
    if (Array.isArray(stage.inputStages)) {
      for (const s of stage.inputStages) {
        stages.push(...findIndexScanStages(s));
      }
    }
    return stages;
  }

  it('Geo query on FieldModel uses 2dsphere index without COLLSCAN', async () => {
    const testPolygon = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [77.1, 28.6],
          [77.2, 28.6],
          [77.2, 28.7],
          [77.1, 28.7],
          [77.1, 28.6],
        ],
      ],
    };

    // Seed a field
    await FieldModel.create({
      userId: new Types.ObjectId(),
      name: 'Index Test Field',
      geometry: testPolygon,
      centroid: { type: 'Point', coordinates: [77.15, 28.65] },
      areaHa: 1.5,
      cropKey: 'wheat',
      sowingDate: new Date('2026-10-01'),
      soilType: 'loam',
      method: 'drip',
      baseline: { everyDays: 7, depthMm: 25 },
    });

    const boundingBox = {
      $geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [77.0, 28.5],
            [77.3, 28.5],
            [77.3, 28.8],
            [77.0, 28.8],
            [77.0, 28.5],
          ],
        ],
      },
    };

    const explainResult = await FieldModel.find({
      geometry: { $geoWithin: boundingBox },
    }).explain('executionStats') as any;

    const stats = explainResult.executionStats || explainResult.queryPlanner;
    const rootStage = stats.executionStages || explainResult.queryPlanner?.winningPlan;

    expect(rootStage).toBeDefined();
    // Must NOT be a full collection scan
    expect(hasCollscan(rootStage)).toBe(false);

    // Must have used a 2dsphere or index scan
    const indexStages = findIndexScanStages(rootStage);
    expect(indexStages.length).toBeGreaterThan(0);
    expect(indexStages.some((s) => s.includes('2DSPHERE') || s === 'IXSCAN')).toBe(true);
  });

  it('Recommendation queries on RecommendationModel use compound index without COLLSCAN', async () => {
    const fieldId = new Types.ObjectId();
    const userId = new Types.ObjectId();

    await RecommendationModel.create({
      fieldId,
      userId,
      forDate: '2026-11-20',
      action: 'irrigate',
      netMm: 20,
      grossMm: 22.2,
      litres: 222000,
      reasonKey: 'reason.deficit_reached',
      params: { mm: 20 },
      deficitMm: 0,
      et0Mm: 4.5,
      kc: 1.15,
      etcMm: 5.17,
      rainMm: 0,
      effectiveRainMm: 0,
    });

    // 1. Single-day lookup: { fieldId, forDate }
    const singleDayExplain = await RecommendationModel.find({
      fieldId,
      forDate: '2026-11-20',
    }).explain('executionStats') as any;

    const singleStats = singleDayExplain.executionStats || singleDayExplain.queryPlanner;
    const singleStage = singleStats.executionStages || singleDayExplain.queryPlanner?.winningPlan;

    expect(hasCollscan(singleStage)).toBe(false);
    const singleIndexStages = findIndexScanStages(singleStage);
    expect(singleIndexStages).toContain('IXSCAN');

    // 2. Date-range query: { fieldId, forDate: { $gte, $lte } }
    const rangeExplain = await RecommendationModel.find({
      fieldId,
      forDate: { $gte: '2026-11-01', $lte: '2026-11-30' },
    }).explain('executionStats') as any;

    const rangeStats = rangeExplain.executionStats || rangeExplain.queryPlanner;
    const rangeStage = rangeStats.executionStages || rangeExplain.queryPlanner?.winningPlan;

    expect(hasCollscan(rangeStage)).toBe(false);
    const rangeIndexStages = findIndexScanStages(rangeStage);
    expect(rangeIndexStages).toContain('IXSCAN');
  });

  it('Time series / sensor queries on SensorReadingModel use indexes without COLLSCAN', async () => {
    const fieldId = new Types.ObjectId();
    const sensorId = new Types.ObjectId();
    const now = new Date();

    await SensorReadingModel.create({
      timestamp: now,
      metadata: { fieldId, sensorId },
      moisturePct: 45.5,
      tempC: 26.2,
    });

    const fromDate = new Date(now.getTime() - 3600 * 1000);
    const toDate = new Date(now.getTime() + 3600 * 1000);

    const explainResult = (await SensorReadingModel.find({
      'metadata.fieldId': fieldId,
      timestamp: { $gte: fromDate, $lte: toDate },
    }).explain('executionStats')) as any;

    // Time-series explain exposes aggregation pipeline stages with $cursor
    const cursorStage = explainResult.stages?.find((s: any) => s.$cursor)?.$cursor;
    const rootStage =
      cursorStage?.executionStats?.executionStages ||
      cursorStage?.queryPlanner?.winningPlan ||
      explainResult.executionStats?.executionStages ||
      explainResult.queryPlanner?.winningPlan;

    expect(rootStage).toBeDefined();
    // Time-series query should never result in a raw COLLSCAN
    expect(hasCollscan(rootStage)).toBe(false);
    const indexStages = findIndexScanStages(rootStage);
    expect(indexStages.length).toBeGreaterThan(0);
    expect(indexStages).toContain('IXSCAN');
  });

  it('Pump queries on PumpModel use { userId: 1, createdAt: -1 } index without COLLSCAN', async () => {
    const userId = new Types.ObjectId();
    await PumpModel.create({
      userId,
      name: 'Test Submersible Pump',
      dischargeLph: 18000,
      measuredOn: new Date(),
    });

    const explainResult = (await PumpModel.find({ userId })
      .sort({ createdAt: -1 })
      .explain('executionStats')) as any;

    const stats = explainResult.executionStats || explainResult.queryPlanner;
    const rootStage = stats.executionStages || explainResult.queryPlanner?.winningPlan;

    expect(rootStage).toBeDefined();
    expect(hasCollscan(rootStage)).toBe(false);
    const indexStages = findIndexScanStages(rootStage);
    expect(indexStages).toContain('IXSCAN');
  });

  it('Channel lookups on MessageChannelModel use indexes without COLLSCAN', async () => {
    const userId = new Types.ObjectId();
    const externalIdHash = new Types.ObjectId().toString();

    await MessageChannelModel.create({
      userId,
      provider: 'telegram',
      externalIdEncrypted: 'iv:tag:data',
      externalIdHash,
      status: 'active',
    });

    // 1. By externalIdHash and provider
    const hashExplain = (await MessageChannelModel.find({
      externalIdHash,
      provider: 'telegram',
    }).explain('executionStats')) as any;

    const hashStats = hashExplain.executionStats || hashExplain.queryPlanner;
    const hashStage = hashStats.executionStages || hashExplain.queryPlanner?.winningPlan;

    expect(hasCollscan(hashStage)).toBe(false);
    expect(findIndexScanStages(hashStage)).toContain('IXSCAN');

    // 2. By userId
    const userExplain = (await MessageChannelModel.find({ userId }).explain('executionStats')) as any;
    const userStats = userExplain.executionStats || userExplain.queryPlanner;
    const userStage = userStats.executionStages || userExplain.queryPlanner?.winningPlan;

    expect(hasCollscan(userStage)).toBe(false);
    expect(findIndexScanStages(userStage)).toContain('IXSCAN');
  });
});
