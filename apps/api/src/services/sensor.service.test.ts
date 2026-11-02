import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import nock from 'nock';
import { createApp } from '../app.js';
import { UserModel } from '../models/user.model.js';
import { FieldModel } from '../models/field.model.js';
import { SensorModel } from '../models/sensor.model.js';
import { SensorReadingModel } from '../models/sensor-reading.model.js';
import { RecommendationModel } from '../models/recommendation.model.js';
import { WeatherDayModel } from '../models/weatherDay.model.js';
import { subscribeFieldMoisture } from '../infra/event-bus.js';

describe('Sensors, Moisture Ingestion, SSE & Downsampling Integration Tests', () => {
  let mongod: MongoMemoryServer;
  const app = createApp();

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create({
      binary: {
        version: '7.0.14',
      },
    });
    const uri = mongod.getUri();
    await mongoose.connect(uri);
    await Promise.all([
      FieldModel.syncIndexes(),
      SensorModel.syncIndexes(),
      RecommendationModel.syncIndexes(),
      WeatherDayModel.syncIndexes(),
    ]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongod) {
      await mongod.stop();
    }
  });

  function generateMockWeatherResponse() {
    const dates: string[] = [];
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const current = new Date(`${today}T00:00:00.000Z`);

    for (let i = 0; i < 14; i++) {
      dates.push(current.toISOString().split('T')[0]!);
      current.setUTCDate(current.getUTCDate() + 1);
    }

    return {
      latitude: 26.9,
      longitude: 75.8,
      daily: {
        time: dates,
        temperature_2m_max: dates.map(() => 31.0),
        temperature_2m_min: dates.map(() => 18.0),
        precipitation_sum: dates.map(() => 0.0),
        et0_fao_evapotranspiration: dates.map(() => 5.0),
      },
    };
  }

  beforeEach(async () => {
    nock.cleanAll();
    nock('https://api.open-meteo.com')
      .get('/v1/forecast')
      .query(true)
      .reply(200, () => generateMockWeatherResponse())
      .persist();

    await UserModel.deleteMany({});
    await FieldModel.deleteMany({});
    await SensorModel.deleteMany({});
    await SensorReadingModel.deleteMany({});
    await RecommendationModel.deleteMany({});
    await WeatherDayModel.deleteMany({});
  });

  async function createTestUser(email: string, name = 'Farmer sensor') {
    const res = await request(app).post('/auth/register').send({
      email,
      password: 'Password123!',
      name,
      language: 'en',
      areaUnit: 'ha',
    });
    return {
      token: res.body.data.accessToken as string,
      user: res.body.data.user,
    };
  }

  async function createField(token: string, name = 'Sensor Field') {
    const polyCoords = [
      [75.8, 26.9],
      [75.801, 26.9],
      [75.801, 26.901],
      [75.8, 26.901],
      [75.8, 26.9],
    ];

    const res = await request(app)
      .post('/fields')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name,
        cropKey: 'wheat',
        sowingDate: '2026-10-01',
        soilType: 'loam',
        method: 'drip',
        baseline: {
          everyDays: 3,
          depthMm: 30,
        },
        geometry: {
          type: 'Polygon',
          coordinates: [polyCoords],
        },
      });

    return res.body.data.field;
  }

  describe('Sensor Creation & Key Management', () => {
    it('creates a sensor, returns raw apiKey once, and stores only its hash', async () => {
      const user = await createTestUser('sensor_admin@example.com');
      const field = await createField(user.token);

      const res = await request(app)
        .post(`/fields/${field.id}/sensors`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({
          name: 'North Soil Moisture Probe',
          isSimulated: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.sensor.name).toBe('North Soil Moisture Probe');
      expect(res.body.data.sensor.isSimulated).toBe(true);
      expect(res.body.data.sensor.apiKeyHash).toBeUndefined(); // Never returned

      const rawApiKey = res.body.data.apiKey;
      expect(rawApiKey).toBeDefined();
      expect(rawApiKey.startsWith('iq_sn_')).toBe(true);

      // Verify database stores only the hash, not the raw key
      const sensorInDb = await SensorModel.findById(res.body.data.sensor.id);
      expect(sensorInDb).not.toBeNull();
      expect(sensorInDb?.apiKeyHash).toBeDefined();
      expect(sensorInDb?.apiKeyHash).not.toBe(rawApiKey);
    });

    it('lists sensors for a field and enforces ownership', async () => {
      const userA = await createTestUser('owner_a@example.com');
      const userB = await createTestUser('owner_b@example.com');
      const fieldA = await createField(userA.token);

      await request(app)
        .post(`/fields/${fieldA.id}/sensors`)
        .set('Authorization', `Bearer ${userA.token}`)
        .send({ name: 'Probe 1' });

      // User A can list
      const listA = await request(app)
        .get(`/fields/${fieldA.id}/sensors`)
        .set('Authorization', `Bearer ${userA.token}`);
      expect(listA.status).toBe(200);
      expect(listA.body.data.sensors.length).toBe(1);

      // User B cannot list User A's sensors
      const listB = await request(app)
        .get(`/fields/${fieldA.id}/sensors`)
        .set('Authorization', `Bearer ${userB.token}`);
      expect(listB.status).toBe(404);
    });
  });

  describe('POST /sensor-readings Ingestion & Validation', () => {
    it('rejects wrong or missing API keys with 401', async () => {
      // Missing key
      const res1 = await request(app).post('/sensor-readings').send({ moisturePct: 45, tempC: 25 });
      expect(res1.status).toBe(401);
      expect(res1.body.code).toBe('INVALID_API_KEY');

      // Wrong key
      const res2 = await request(app)
        .post('/sensor-readings')
        .set('x-api-key', 'iq_sn_wrong_key_12345')
        .send({ moisturePct: 45, tempC: 25 });
      expect(res2.status).toBe(401);
      expect(res2.body.code).toBe('INVALID_API_KEY');
    });

    it('rejects invalid payloads (moisture out of range, temp out of range, future/past timestamps)', async () => {
      const user = await createTestUser('val_user@example.com');
      const field = await createField(user.token);

      const sensorRes = await request(app)
        .post(`/fields/${field.id}/sensors`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({ name: 'Test Probe' });
      const apiKey = sensorRes.body.data.apiKey;

      // Moisture > 100
      const res1 = await request(app)
        .post('/sensor-readings')
        .set('x-api-key', apiKey)
        .send({ moisturePct: 105, tempC: 25 });
      expect(res1.status).toBe(400);

      // Moisture < 0
      const res2 = await request(app)
        .post('/sensor-readings')
        .set('x-api-key', apiKey)
        .send({ moisturePct: -5, tempC: 25 });
      expect(res2.status).toBe(400);

      // Temp < -10
      const res3 = await request(app)
        .post('/sensor-readings')
        .set('x-api-key', apiKey)
        .send({ moisturePct: 50, tempC: -15 });
      expect(res3.status).toBe(400);

      // Temp > 60
      const res4 = await request(app)
        .post('/sensor-readings')
        .set('x-api-key', apiKey)
        .send({ moisturePct: 50, tempC: 65 });
      expect(res4.status).toBe(400);

      // Timestamp > 5 minutes in future
      const futureTime = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const res5 = await request(app)
        .post('/sensor-readings')
        .set('x-api-key', apiKey)
        .send({ moisturePct: 50, tempC: 25, timestamp: futureTime });
      expect(res5.status).toBe(400);

      // Timestamp > 24 hours in past
      const pastTime = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
      const res6 = await request(app)
        .post('/sensor-readings')
        .set('x-api-key', apiKey)
        .send({ moisturePct: 50, tempC: 25, timestamp: pastTime });
      expect(res6.status).toBe(400);
    });

    it('successfully ingests valid single and batch offline readings', async () => {
      const user = await createTestUser('ingest_user@example.com');
      const field = await createField(user.token);

      const sensorRes = await request(app)
        .post(`/fields/${field.id}/sensors`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({ name: 'Batch Probe' });
      const apiKey = sensorRes.body.data.apiKey;

      // Ingest single reading
      const singleRes = await request(app)
        .post('/sensor-readings')
        .set('x-api-key', apiKey)
        .send({ moisturePct: 52.4, tempC: 24.6 });
      expect(singleRes.status).toBe(200);
      expect(singleRes.body.data.ingestedCount).toBe(1);

      // Ingest batch offline readings
      const now = Date.now();
      const batchRes = await request(app)
        .post('/sensor-readings')
        .set('x-api-key', apiKey)
        .send([
          { moisturePct: 51.0, tempC: 23.0, timestamp: new Date(now - 3600000).toISOString() },
          { moisturePct: 50.5, tempC: 23.5, timestamp: new Date(now - 1800000).toISOString() },
        ]);
      expect(batchRes.status).toBe(200);
      expect(batchRes.body.data.ingestedCount).toBe(2);
    });
  });

  describe('Multi-field Isolation', () => {
    it('one sensor key cannot write to another field', async () => {
      const userA = await createTestUser('field_a@example.com');
      const userB = await createTestUser('field_b@example.com');

      const fieldA = await createField(userA.token, 'Field A');
      const fieldB = await createField(userB.token, 'Field B');

      const sensorARes = await request(app)
        .post(`/fields/${fieldA.id}/sensors`)
        .set('Authorization', `Bearer ${userA.token}`)
        .send({ name: 'Sensor A' });
      const keyA = sensorARes.body.data.apiKey;

      // Sensor A attempts to post reading with spoofed fieldId
      const postRes = await request(app).post('/sensor-readings').set('x-api-key', keyA).send({
        moisturePct: 48.0,
        tempC: 22.0,
        fieldId: fieldB.id, // spoofed!
      });
      expect(postRes.status).toBe(200);

      // Check Field B's moisture history -> must be empty
      const historyB = await request(app)
        .get(`/fields/${fieldB.id}/moisture`)
        .set('Authorization', `Bearer ${userB.token}`);
      expect(historyB.status).toBe(200);
      expect(historyB.body.data.readings.length).toBe(0);

      // Check Field A's moisture history -> contains the reading
      const historyA = await request(app)
        .get(`/fields/${fieldA.id}/moisture`)
        .set('Authorization', `Bearer ${userA.token}`);
      expect(historyA.status).toBe(200);
      expect(historyA.body.data.readings.length).toBe(1);
      expect(historyA.body.data.readings[0].moisturePct).toBe(48.0);
    });
  });

  describe('Server-Sent Events (SSE) Live Stream', () => {
    it('an SSE client receives a new reading when ingested', async () => {
      const user = await createTestUser('sse_user@example.com');
      const field = await createField(user.token);

      const sensorRes = await request(app)
        .post(`/fields/${field.id}/sensors`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({ name: 'SSE Probe' });
      const apiKey = sensorRes.body.data.apiKey;

      // Listen directly via subscribeFieldMoisture to verify event dispatch
      let receivedReading: { fieldId: string; moisturePct: number; tempC: number } | null = null;
      const unsubscribe = subscribeFieldMoisture(field.id, (reading) => {
        receivedReading = reading as { fieldId: string; moisturePct: number; tempC: number };
      });

      // Ingest reading
      const postRes = await request(app)
        .post('/sensor-readings')
        .set('x-api-key', apiKey)
        .send({ moisturePct: 62.5, tempC: 27.2 });
      expect(postRes.status).toBe(200);

      expect(receivedReading).not.toBeNull();
      expect(receivedReading!.fieldId).toBe(field.id);
      expect(receivedReading!.moisturePct).toBe(62.5);
      expect(receivedReading!.tempC).toBe(27.2);

      unsubscribe();
    });
  });

  describe('Downsampling Aggregation', () => {
    it('downsampling returns bounded points for wide date ranges', async () => {
      const user = await createTestUser('downsample_user@example.com');
      const field = await createField(user.token);

      const sensor = await SensorModel.create({
        fieldId: field.id,
        userId: user.user.id,
        name: 'Historic Probe',
        apiKeyHash: 'dummy_hash',
      });

      // Insert 72 readings across 3 days (1 reading every hour)
      const baseDate = new Date('2026-10-01T00:00:00.000Z');
      const readings = [];
      for (let i = 0; i < 72; i++) {
        readings.push({
          timestamp: new Date(baseDate.getTime() + i * 3600 * 1000),
          metadata: {
            sensorId: sensor._id,
            fieldId: field.id,
          },
          moisturePct: 40 + (i % 20),
          tempC: 25 + (i % 5),
        });
      }
      await SensorReadingModel.insertMany(readings);

      // Query wide date range (3 days)
      const fromStr = '2026-10-01T00:00:00.000Z';
      const toStr = '2026-10-04T00:00:00.000Z';

      const res = await request(app)
        .get(`/fields/${field.id}/moisture?from=${fromStr}&to=${toStr}`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(res.status).toBe(200);
      const points = res.body.data.readings;

      // Downsampled points must be bounded
      expect(points.length).toBeLessThanOrEqual(72);
      expect(points[0]).toHaveProperty('timestamp');
      expect(points[0]).toHaveProperty('moisturePct');
      expect(points[0]).toHaveProperty('tempC');
    });
  });

  describe('Threshold Crossing & Debounced Recompute', () => {
    it('a threshold crossing enqueues exactly one recompute within the debounce window', async () => {
      const user = await createTestUser('threshold_user@example.com');
      const field = await createField(user.token);

      const sensorRes = await request(app)
        .post(`/fields/${field.id}/sensors`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({ name: 'Threshold Probe' });
      const apiKey = sensorRes.body.data.apiKey;

      // First reading: normal moisture (50%) -> no threshold crossing
      const r1 = await request(app)
        .post('/sensor-readings')
        .set('x-api-key', apiKey)
        .send({ moisturePct: 50.0, tempC: 25.0 });
      expect(r1.status).toBe(200);

      // Clear recommendation collection to test if recompute generates recommendations
      await RecommendationModel.deleteMany({ fieldId: field.id });
      const beforeCross = await RecommendationModel.countDocuments({ fieldId: field.id });
      expect(beforeCross).toBe(0);

      // Second reading: moisture drops to 35% (crosses 40% threshold!)
      const r2 = await request(app)
        .post('/sensor-readings')
        .set('x-api-key', apiKey)
        .send({ moisturePct: 35.0, tempC: 25.0 });
      expect(r2.status).toBe(200);

      // Recompute was triggered and generated 7 days of recommendations
      const afterCross = await RecommendationModel.countDocuments({ fieldId: field.id });
      expect(afterCross).toBe(7);

      // Verify that day 0 recommendation has reason.sensor_dry (action: irrigate)
      const todayRec = await RecommendationModel.findOne({ fieldId: field.id }).sort({
        forDate: 1,
      });
      expect(todayRec?.action).toBe('irrigate');
      expect(todayRec?.reasonKey).toBe('reason.sensor_dry');

      // Third reading immediately after (34%): still in stress, but inside 60-second debounce window
      // It should NOT recompute again
      const r3 = await request(app)
        .post('/sensor-readings')
        .set('x-api-key', apiKey)
        .send({ moisturePct: 34.0, tempC: 25.0 });
      expect(r3.status).toBe(200);

      const finalCount = await RecommendationModel.countDocuments({ fieldId: field.id });
      expect(finalCount).toBe(7);
    });
  });
});
