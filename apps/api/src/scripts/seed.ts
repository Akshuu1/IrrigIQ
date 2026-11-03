import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import { connectDb, disconnectDb } from '../infra/db.js';
import { connectRedis, disconnectRedis } from '../infra/redis.js';
import { UserModel } from '../models/user.model.js';
import { FieldModel } from '../models/field.model.js';
import { SensorModel } from '../models/sensor.model.js';
import { SensorReadingModel } from '../models/sensor-reading.model.js';
import { IrrigationLogModel } from '../models/irrigation-log.model.js';
import { recomputeField } from '../services/recommendation.service.js';
import { polygonAreaHa, polygonCentroid, CROPS } from '@irrigiq/shared';
import { logger } from '../config/logger.js';

function hashApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

export async function runSeed(): Promise<void> {
  console.log('🌱 Starting IrrigIQ Database Seeding...');

  await connectDb();
  await connectRedis();

  console.log(`🌾 Verified ${CROPS.length} FAO-56 scientific crops in catalog:`);
  CROPS.forEach((c) => console.log(`   - ${c.nameEn} / ${c.nameHi} (${c.key})`));

  // 1. Seed Demo User
  const demoEmail = 'demo@irrigiq.org';
  const demoPassword = 'DemoPassword123!';
  const passwordHash = await bcrypt.hash(demoPassword, 10);

  let user = await UserModel.findOne({ email: demoEmail });
  if (!user) {
    user = await UserModel.create({
      email: demoEmail,
      passwordHash,
      name: 'Ramesh Kumar (रमेश कुमार)',
      language: 'hi',
      areaUnit: 'acre',
    });
    console.log(`✅ Created Demo User: ${user.email} (${user._id})`);
  } else {
    user.name = 'Ramesh Kumar (रमेश कुमार)';
    user.language = 'hi';
    user.areaUnit = 'acre';
    user.passwordHash = passwordHash;
    await user.save();
    console.log(`ℹ️ Updated Existing Demo User: ${user.email} (${user._id})`);
  }

  const now = new Date();
  const formatYMD = (d: Date) => d.toISOString().split('T')[0]!;

  // 2. Seed Field 1: Karnal Wheat Farm (करनाल गेहूं फार्म)
  // Location: Karnal, Haryana (North India wheat belt)
  const karnalCoords: [number, number][] = [
    [76.985, 29.68],
    [76.995, 29.68],
    [76.995, 29.69],
    [76.985, 29.69],
    [76.985, 29.68],
  ];
  const karnalGeometry = { type: 'Polygon' as const, coordinates: [karnalCoords] };
  const karnalAreaHa = polygonAreaHa(karnalGeometry);
  const karnalCentroid = polygonCentroid(karnalGeometry);

  let field1 = await FieldModel.findOne({
    userId: user._id,
    name: 'करनाल गेहूं फार्म (Karnal Wheat Farm)',
  });

  const field1Data = {
    userId: user._id,
    name: 'करनाल गेहूं फार्म (Karnal Wheat Farm)',
    geometry: karnalGeometry,
    centroid: karnalCentroid,
    areaHa: karnalAreaHa,
    cropKey: 'wheat',
    sowingDate: new Date(now.getTime() - 35 * 86400000), // 35 days ago (development stage)
    soilType: 'loam' as const,
    method: 'drip' as const,
    baseline: {
      everyDays: 10,
      depthMm: 45,
    },
    version: 1,
  };

  if (!field1) {
    field1 = await FieldModel.create(field1Data);
    console.log(`✅ Created Field 1: ${field1.name} (${field1._id})`);
  } else {
    Object.assign(field1, field1Data);
    await field1.save();
    console.log(`ℹ️ Updated Field 1: ${field1.name} (${field1._id})`);
  }

  // Seed Sensor for Field 1
  const sensorKey1 = 'karnal_demo_sensor_secret_key_1';
  let sensor1 = await SensorModel.findOne({ fieldId: field1._id });
  if (!sensor1) {
    sensor1 = await SensorModel.create({
      fieldId: field1._id,
      userId: user._id,
      name: 'करनाल मृदा सेंसर 1 (Karnal Soil Moisture)',
      apiKeyHash: hashApiKey(sensorKey1),
      isSimulated: true,
      lastSeenAt: now,
    });
    console.log(`   📡 Sensor created for Field 1 (Key: ${sensorKey1})`);
  }

  // Seed sample sensor readings for Field 1 (healthy moisture 55%)
  await SensorReadingModel.create({
    timestamp: new Date(now.getTime() - 15 * 60000),
    metadata: { sensorId: sensor1._id, fieldId: field1._id },
    moisturePct: 55,
    tempC: 22.5,
  });

  // Seed irrigation log from 5 days ago (45mm)
  const logDate1 = formatYMD(new Date(now.getTime() - 5 * 86400000));
  await IrrigationLogModel.findOneAndUpdate(
    { fieldId: field1._id, date: logDate1 },
    {
      fieldId: field1._id,
      userId: user._id,
      date: logDate1,
      appliedMm: 45,
      source: 'manual',
      note: 'Routine flood/drip cycle before cold spell',
    },
    { upsert: true, new: true },
  );

  // 3. Seed Field 2: Jaipur Farm Plot (जयपुर आलू / सब्जी खेत)
  // Location: Jaipur, Rajasthan
  const jaipurCoords: [number, number][] = [
    [75.78, 26.91],
    [75.79, 26.91],
    [75.79, 26.92],
    [75.78, 26.92],
    [75.78, 26.91],
  ];
  const jaipurGeometry = { type: 'Polygon' as const, coordinates: [jaipurCoords] };
  const jaipurAreaHa = polygonAreaHa(jaipurGeometry);
  const jaipurCentroid = polygonCentroid(jaipurGeometry);

  let field2 = await FieldModel.findOne({
    userId: user._id,
    name: 'जयपुर आलू खेत (Jaipur Potato Plot)',
  });

  const field2Data = {
    userId: user._id,
    name: 'जयपुर आलू खेत (Jaipur Potato Plot)',
    geometry: jaipurGeometry,
    centroid: jaipurCentroid,
    areaHa: jaipurAreaHa,
    cropKey: 'potato',
    sowingDate: new Date(now.getTime() - 20 * 86400000), // 20 days ago
    soilType: 'sandy' as const,
    method: 'sprinkler' as const,
    baseline: {
      everyDays: 7,
      depthMm: 35,
    },
    version: 1,
  };

  if (!field2) {
    field2 = await FieldModel.create(field2Data);
    console.log(`✅ Created Field 2: ${field2.name} (${field2._id})`);
  } else {
    Object.assign(field2, field2Data);
    await field2.save();
    console.log(`ℹ️ Updated Field 2: ${field2.name} (${field2._id})`);
  }

  // Seed Sensor for Field 2
  const sensorKey2 = 'jaipur_demo_sensor_secret_key_2';
  let sensor2 = await SensorModel.findOne({ fieldId: field2._id });
  if (!sensor2) {
    sensor2 = await SensorModel.create({
      fieldId: field2._id,
      userId: user._id,
      name: 'जयपुर मृदा सेंसर 2 (Jaipur Soil Moisture)',
      apiKeyHash: hashApiKey(sensorKey2),
      isSimulated: true,
      lastSeenAt: now,
    });
    console.log(`   📡 Sensor created for Field 2 (Key: ${sensorKey2})`);
  }

  // Seed sample sensor readings for Field 2 (dry moisture 36% -> trigger advisory!)
  await SensorReadingModel.create({
    timestamp: new Date(now.getTime() - 10 * 60000),
    metadata: { sensorId: sensor2._id, fieldId: field2._id },
    moisturePct: 36,
    tempC: 28.0,
  });

  // Seed irrigation log from 8 days ago (35mm)
  const logDate2 = formatYMD(new Date(now.getTime() - 8 * 86400000));
  await IrrigationLogModel.findOneAndUpdate(
    { fieldId: field2._id, date: logDate2 },
    {
      fieldId: field2._id,
      userId: user._id,
      date: logDate2,
      appliedMm: 35,
      source: 'manual',
      note: 'Pre-sowing sprinkler run',
    },
    { upsert: true, new: true },
  );

  // 4. Recompute Recommendations for Both Fields
  console.log('🔄 Recomputing 7-day weather & recommendations for both fields...');
  try {
    await recomputeField(field1._id);
    console.log(`   ✓ Field 1 recommendations computed successfully`);
  } catch (err) {
    logger.warn({ err }, 'Field 1 recompute had weather fallback');
  }

  try {
    await recomputeField(field2._id);
    console.log(`   ✓ Field 2 recommendations computed successfully`);
  } catch (err) {
    logger.warn({ err }, 'Field 2 recompute had weather fallback');
  }

  console.log('\n======================================================');
  console.log('🎉 IrrigIQ Database Seeding Completed Successfully!');
  console.log('======================================================');
  console.log('Farmer Demo Account:');
  console.log(`  Email:    ${demoEmail}`);
  console.log(`  Password: ${demoPassword}`);
  console.log(`  Name:     Ramesh Kumar (रमेश कुमार)`);
  console.log(`  Language: Hindi (hi) | Area: Acre`);
  console.log('Sample Fields:');
  console.log(`  1. करनाल गेहूं फार्म (Karnal Wheat Farm) - Loam, Drip, Wheat (35d)`);
  console.log(`  2. जयपुर आलू खेत (Jaipur Potato Plot)  - Sandy, Sprinkler, Potato (20d)`);
  console.log('IoT Sensor Keys:');
  console.log(`  - Field 1 Sensor: ${sensorKey1}`);
  console.log(`  - Field 2 Sensor: ${sensorKey2}`);
  console.log('======================================================\n');

  await disconnectRedis();
  await disconnectDb();
}

// Direct execution
if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  runSeed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Seeding failed:', err);
      process.exit(1);
    });
}
