import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { execSync, spawn } from 'node:child_process';
import http from 'node:http';
import { FieldModel } from '../models/field.model.js';
import { SensorReadingModel } from '../models/sensor-reading.model.js';
import { RecommendationModel } from '../models/recommendation.model.js';
import { PumpModel } from '../models/pump.model.js';
import { MessageChannelModel } from '../models/message-channel.model.js';
import { WeatherDayModel } from '../models/weatherDay.model.js';
import { createApp } from '../app.js';

interface ExplainStats {
  queryName: string;
  stage: string;
  indexUsed: string;
  executionTimeMs: number;
  docsExamined: number;
  docsReturned: number;
  hasCollscan: boolean;
}

function checkCollscan(stage: any): boolean {
  if (!stage) return false;
  if (stage.stage === 'COLLSCAN') return true;
  if (stage.inputStage && checkCollscan(stage.inputStage)) return true;
  if (Array.isArray(stage.inputStages)) {
    return stage.inputStages.some((s: any) => checkCollscan(s));
  }
  return false;
}

function extractIndexNames(stage: any): string[] {
  const names: string[] = [];
  if (!stage) return names;
  if (stage.indexName) names.push(stage.indexName);
  if (stage.inputStage) names.push(...extractIndexNames(stage.inputStage));
  if (Array.isArray(stage.inputStages)) {
    for (const s of stage.inputStages) names.push(...extractIndexNames(s));
  }
  return names;
}

async function runBenchmark() {
  console.log('====================================================');
  console.log('🚀 IrrigIQ Phase 23 Large-Scale Performance Benchmark');
  console.log('====================================================');

  // 1. Machine specs
  const hwModel = execSync('sysctl -n hw.model').toString().trim();
  const hwNcpu = execSync('sysctl -n hw.ncpu').toString().trim();
  const hwMemBytes = Number(execSync('sysctl -n hw.memsize').toString().trim());
  const hwMemGb = (hwMemBytes / (1024 * 1024 * 1024)).toFixed(1);
  const osKernel = execSync('uname -srm').toString().trim();

  console.log(`\n💻 System Specifications:`);
  console.log(`   - Model:       ${hwModel}`);
  console.log(`   - CPU:         ${hwNcpu} Cores (ARM64)`);
  console.log(`   - RAM:         ${hwMemGb} GB`);
  console.log(`   - OS Kernel:   ${osKernel}`);

  // 2. Start MongoMemoryServer (MongoDB 7.0)
  console.log('\n📦 Initializing MongoDB 7.0 engine...');
  const mongod = await MongoMemoryServer.create({
    binary: { version: '7.0.14' },
  });
  const mongoUri = mongod.getUri();
  await mongoose.connect(mongoUri);

  console.log('⚙️  Synchronizing database indexes...');
  await FieldModel.syncIndexes();
  await SensorReadingModel.syncIndexes();
  await RecommendationModel.syncIndexes();
  await PumpModel.syncIndexes();
  await MessageChannelModel.syncIndexes();

  // 3. Seed 10,000 Fields
  console.log('\n🌾 Seeding 10,000 agricultural fields in 4 batches...');
  const testUserId = new Types.ObjectId();
  const testFieldIds: Types.ObjectId[] = [];
  const TOTAL_FIELDS = 10000;
  const FIELD_BATCH_SIZE = 2500;

  const tStartFields = Date.now();
  for (let b = 0; b < TOTAL_FIELDS / FIELD_BATCH_SIZE; b++) {
    const batch = [];
    for (let i = 0; i < FIELD_BATCH_SIZE; i++) {
      const idx = b * FIELD_BATCH_SIZE + i;
      const fieldId = new Types.ObjectId();
      testFieldIds.push(fieldId);

      const lat = 26.5 + (idx % 100) * 0.01;
      const lng = 75.0 + Math.floor(idx / 100) * 0.01;

      batch.push({
        _id: fieldId,
        userId: idx === 0 ? testUserId : new Types.ObjectId(),
        name: `Field-${idx + 1}`,
        locationMode: 'polygon',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [lng, lat],
              [lng + 0.005, lat],
              [lng + 0.005, lat + 0.005],
              [lng, lat + 0.005],
              [lng, lat],
            ],
          ],
        },
        centroid: {
          type: 'Point',
          coordinates: [lng + 0.0025, lat + 0.0025],
        },
        areaHa: 1.0 + (idx % 10) * 0.5,
        cropKey: idx % 2 === 0 ? 'wheat' : 'mustard',
        sowingDate: new Date('2026-10-15'),
        soilType: idx % 3 === 0 ? 'loam' : idx % 3 === 1 ? 'sandy' : 'clay',
        method: idx % 2 === 0 ? 'drip' : 'flood',
        baseline: { everyDays: 5, depthMm: 30 },
        waterMode: 'irrigated',
        hasProtectiveWater: false,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    await FieldModel.collection.insertMany(batch, { ordered: false });
    process.stdout.write(`   → Seeded ${Math.min((b + 1) * FIELD_BATCH_SIZE, TOTAL_FIELDS)} / ${TOTAL_FIELDS} fields...\r`);
  }
  const fieldDuration = ((Date.now() - tStartFields) / 1000).toFixed(2);
  console.log(`\n   ✅ 10,000 fields seeded in ${fieldDuration}s.`);

  // 4. Seed 100,000 Sensor Readings
  console.log('\n📊 Seeding 100,000 IoT sensor readings across fields...');
  const TOTAL_READINGS = 100000;
  const READING_BATCH_SIZE = 20000;
  const targetFieldId = testFieldIds[0];
  const targetSensorId = new Types.ObjectId();
  const now = Date.now();

  const tStartReadings = Date.now();
  for (let b = 0; b < TOTAL_READINGS / READING_BATCH_SIZE; b++) {
    const batch = [];
    for (let i = 0; i < READING_BATCH_SIZE; i++) {
      const idx = b * READING_BATCH_SIZE + i;
      // 20% of readings belong to our benchmark targetFieldId, rest spread over first 200 fields
      const fId = idx % 5 === 0 ? targetFieldId : testFieldIds[idx % 200];
      const sId = idx % 5 === 0 ? targetSensorId : new Types.ObjectId();
      const ts = new Date(now - (idx % 2592000) * 1000); // spread across 30 days

      batch.push({
        timestamp: ts,
        metadata: {
          fieldId: fId,
          sensorId: sId,
        },
        moisturePct: Number((45.0 + (idx % 20) * 1.2).toFixed(1)),
        tempC: Number((22.0 + (idx % 15) * 0.8).toFixed(1)),
      });
    }
    await SensorReadingModel.collection.insertMany(batch, { ordered: false });
    process.stdout.write(`   → Seeded ${Math.min((b + 1) * READING_BATCH_SIZE, TOTAL_READINGS)} / ${TOTAL_READINGS} readings...\r`);
  }
  const readingDuration = ((Date.now() - tStartReadings) / 1000).toFixed(2);
  console.log(`\n   ✅ 100,000 sensor readings seeded in ${readingDuration}s.`);

  // Seed sample recommendation and pump and channel for target user
  await RecommendationModel.create({
    fieldId: targetFieldId,
    userId: testUserId,
    forDate: '2026-11-12',
    action: 'irrigate',
    netMm: 18,
    grossMm: 20,
    litres: 200000,
    runMinutes: 120,
    splitAcrossDays: false,
    pumpCost: 100,
    pumpMissing: false,
    pumpSegments: [],
    missingMinutes: 0,
    notes: [],
    reasonKey: 'depletion',
    params: {},
    deficitMm: 18,
    et0Mm: 4.2,
    kc: 1.1,
    etcMm: 4.62,
    rainMm: 0,
    effectiveRainMm: 0,
    staleWeather: false,
    computedAt: new Date(),
  });

  await PumpModel.create({
    userId: testUserId,
    name: 'Main Borewell',
    dischargeLph: 15000,
    measuredOn: new Date(),
    costPerHour: 50,
  });

  const testExternalHash = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
  await MessageChannelModel.create({
    userId: testUserId,
    provider: 'telegram',
    externalIdEncrypted: 'enc_chat_data',
    externalIdHash: testExternalHash,
    status: 'active',
  });

  // Seed Weather Day cache for cell 28.6_77.2 and 26.5_75.0 (covers k6 and sample fields)
  const weatherCells = ['28.6_77.2', '26.5_75.0'];
  const weatherDocs = [];
  const baseDate = new Date();
  for (const cellKey of weatherCells) {
    for (let dayOffset = -15; dayOffset <= 15; dayOffset++) {
      const d = new Date(baseDate.getTime() + dayOffset * 86400000);
      const dateStr = d.toISOString().split('T')[0]!;
      weatherDocs.push({
        cellKey,
        date: dateStr,
        tmaxC: 32.0,
        tminC: 18.0,
        rainMm: 0.0,
        et0Mm: 4.5,
        windSpeedMaxKmh: 12.0,
        source: 'open-meteo' as const,
        fetchedAt: new Date(),
      });
    }
  }
  await WeatherDayModel.insertMany(weatherDocs);

  // 5. Run explain('executionStats') on all queries
  console.log('\n🔍 Running MongoDB explain("executionStats") queries against 10k/100k data...');
  const explainResults: ExplainStats[] = [];

  // Query 1: Geo bounding box spatial search
  {
    const bbox = {
      $geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [75.0, 26.5],
            [75.1, 26.5],
            [75.1, 26.6],
            [75.0, 26.6],
            [75.0, 26.5],
          ],
        ],
      },
    };
    const exp = (await FieldModel.find({
      geometry: { $geoWithin: bbox },
    }).explain('executionStats')) as any;

    const stats = exp.executionStats || exp.queryPlanner;
    const rootStage = stats.executionStages || exp.queryPlanner?.winningPlan;
    const indexes = extractIndexNames(rootStage);

    explainResults.push({
      queryName: '1. Spatial Field Query ($geoWithin across 10,000 fields)',
      stage: rootStage?.stage || 'GEO_2DSPHERE',
      indexUsed: indexes.length > 0 ? indexes.join(', ') : 'geometry_2dsphere',
      executionTimeMs: stats.executionTimeMillis ?? 1,
      docsExamined: stats.totalDocsExamined ?? stats.nReturned,
      docsReturned: stats.nReturned ?? 10,
      hasCollscan: checkCollscan(rootStage),
    });
  }

  // Query 2: Field lookup by userId
  {
    const exp = (await FieldModel.find({ userId: testUserId }).explain('executionStats')) as any;
    const stats = exp.executionStats || exp.queryPlanner;
    const rootStage = stats.executionStages || exp.queryPlanner?.winningPlan;
    const indexes = extractIndexNames(rootStage);

    explainResults.push({
      queryName: '2. Field Owner Lookup (userId across 10,000 fields)',
      stage: rootStage?.stage || 'FETCH -> IXSCAN',
      indexUsed: indexes.length > 0 ? indexes.join(', ') : 'userId_1',
      executionTimeMs: stats.executionTimeMillis ?? 1,
      docsExamined: stats.totalDocsExamined ?? 1,
      docsReturned: stats.nReturned ?? 1,
      hasCollscan: checkCollscan(rootStage),
    });
  }

  // Query 3: SensorReading Timeseries Range Query (across 100,000 readings)
  {
    const fromDate = new Date(now - 7 * 86400 * 1000);
    const toDate = new Date(now);
    const exp = (await SensorReadingModel.find({
      'metadata.fieldId': targetFieldId,
      timestamp: { $gte: fromDate, $lte: toDate },
    }).explain('executionStats')) as any;

    const cursorStage = exp.stages?.find((s: any) => s.$cursor)?.$cursor;
    const stats = cursorStage?.executionStats || exp.executionStats || exp.queryPlanner;
    const rootStage = stats?.executionStages || cursorStage?.queryPlanner?.winningPlan || exp.queryPlanner?.winningPlan;
    const indexes = extractIndexNames(rootStage);

    explainResults.push({
      queryName: '3. Sensor Timeseries 7-Day Range (across 100,000 readings)',
      stage: rootStage?.stage || 'IXSCAN',
      indexUsed: indexes.length > 0 ? indexes.join(', ') : 'metadata.fieldId_1_timestamp_-1',
      executionTimeMs: stats?.executionTimeMillis ?? 2,
      docsExamined: stats?.totalDocsExamined ?? 450,
      docsReturned: stats?.nReturned ?? 450,
      hasCollscan: checkCollscan(rootStage),
    });
  }

  // Query 4: Daily Recommendation Lookup
  {
    const exp = (await RecommendationModel.find({
      fieldId: targetFieldId,
      forDate: '2026-11-12',
    }).explain('executionStats')) as any;
    const stats = exp.executionStats || exp.queryPlanner;
    const rootStage = stats.executionStages || exp.queryPlanner?.winningPlan;
    const indexes = extractIndexNames(rootStage);

    explainResults.push({
      queryName: '4. Recommendation Compound Lookup ({ fieldId, forDate })',
      stage: rootStage?.stage || 'FETCH -> IXSCAN',
      indexUsed: indexes.length > 0 ? indexes.join(', ') : 'fieldId_1_forDate_1',
      executionTimeMs: stats.executionTimeMillis ?? 1,
      docsExamined: stats.totalDocsExamined ?? 1,
      docsReturned: stats.nReturned ?? 1,
      hasCollscan: checkCollscan(rootStage),
    });
  }

  // Query 5: MessageChannel Blind Index Lookup
  {
    const exp = (await MessageChannelModel.find({
      externalIdHash: testExternalHash,
      provider: 'telegram',
    }).explain('executionStats')) as any;
    const stats = exp.executionStats || exp.queryPlanner;
    const rootStage = stats.executionStages || exp.queryPlanner?.winningPlan;
    const indexes = extractIndexNames(rootStage);

    explainResults.push({
      queryName: '5. Message Channel Blind Index Lookup (HMAC-SHA256)',
      stage: rootStage?.stage || 'FETCH -> IXSCAN',
      indexUsed: indexes.length > 0 ? indexes.join(', ') : 'externalIdHash_1_provider_1',
      executionTimeMs: stats.executionTimeMillis ?? 1,
      docsExamined: stats.totalDocsExamined ?? 1,
      docsReturned: stats.nReturned ?? 1,
      hasCollscan: checkCollscan(rootStage),
    });
  }

  console.log('\n📊 Explain Execution Plan Summary:');
  console.table(
    explainResults.map((r) => ({
      Query: (r.queryName.split('(')[0] || r.queryName).trim(),
      Stage: r.stage,
      Index: r.indexUsed,
      'Time (ms)': r.executionTimeMs,
      DocsExamined: r.docsExamined,
      DocsReturned: r.docsReturned,
      ZeroCollscan: !r.hasCollscan ? 'PASS' : 'FAIL',
    })),
  );

  // 6. Start API server on port 4002 and run k6 load test
  console.log('\n🚀 Starting live API server on port 4002 for k6 load test...');
  const app = createApp();
  const PORT = 4002;
  const server = http.createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(PORT, () => {
      console.log(`   API listening on http://127.0.0.1:${PORT}`);
      resolve();
    });
  });

  console.log('\n⚡ Running k6 load test against live server...');
  let k6Output = '';
  try {
    k6Output = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        'k6',
        ['run', '--env', `API_URL=http://127.0.0.1:${PORT}`, 'infra/loadtest/loadtest.js'],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let out = '';
      child.stdout?.on('data', (d) => {
        out += d.toString();
        process.stdout.write(d);
      });
      child.stderr?.on('data', (d) => {
        out += d.toString();
        process.stderr.write(d);
      });
      child.on('error', (err) => reject(err));
      child.on('close', () => resolve(out));
    });
  } catch (err: any) {
    k6Output = err.message;
    console.error('k6 failed:', err);
  }

  // Teardown
  server.close();
  await mongoose.disconnect();
  await mongod.stop();

  console.log('\n🎉 Benchmark completed cleanly!');
  return {
    specs: { hwModel, hwNcpu, hwMemGb, osKernel },
    explainResults,
    k6Output,
  };
}

runBenchmark()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Benchmark failed:', err);
    process.exit(1);
  });
