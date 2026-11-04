import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import nock from 'nock';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import * as turf from '@turf/turf';
import { createApp } from '../app.js';
import { UserModel } from '../models/user.model.js';
import { FieldModel } from '../models/field.model.js';
import { RecommendationModel } from '../models/recommendation.model.js';
import { WeatherDayModel } from '../models/weatherDay.model.js';
import { recomputeField } from './recommendation.service.js';
import { processDailyRecommendations } from '../scheduler/recommendation.scheduler.js';

describe('Recommendations Service & Scheduler Integration Tests', () => {
  let mongod: MongoMemoryServer;
  let redisMock: Redis;
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

  beforeEach(async () => {
    nock.cleanAll();
    await UserModel.deleteMany({});
    await FieldModel.deleteMany({});
    await RecommendationModel.deleteMany({});
    await WeatherDayModel.deleteMany({});
    redisMock = new RedisMock() as unknown as Redis;
  });

  async function createTestUser(email = 'farmer_rec@example.com') {
    const res = await request(app).post('/auth/register').send({
      email,
      password: 'Password123!',
      name: 'Ramesh Farmer',
      language: 'en',
      areaUnit: 'ha',
    });
    return {
      token: res.body.data.accessToken as string,
      user: res.body.data.user,
    };
  }

  // 100m x 100m known square in Rajasthan (approx 75.8, 26.9)
  const origin = turf.point([75.8, 26.9]);
  const eastPoint = turf.destination(origin, 0.1, 90, { units: 'kilometers' });
  const northEastPoint = turf.destination(eastPoint, 0.1, 0, { units: 'kilometers' });
  const northPoint = turf.destination(origin, 0.1, 0, { units: 'kilometers' });

  const validSquarePolygon = {
    type: 'Polygon',
    coordinates: [
      [
        origin.geometry.coordinates,
        eastPoint.geometry.coordinates,
        northEastPoint.geometry.coordinates,
        northPoint.geometry.coordinates,
        origin.geometry.coordinates,
      ],
    ],
  };

  // Generates mock weather days starting today (optionally including past days)
  function generateMockWeatherResponse(options: {
    rainOnDayIndex?: number;
    rainMm?: number;
    pastDays?: number;
  } = {}) {
    const pastDaysCount = options.pastDays ?? 0;
    const dates: string[] = [];
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const current = new Date(`${today}T00:00:00.000Z`);
    if (pastDaysCount > 0) {
      current.setUTCDate(current.getUTCDate() - pastDaysCount);
    }

    const totalDays = pastDaysCount + 7;
    for (let i = 0; i < totalDays; i++) {
      dates.push(current.toISOString().split('T')[0]!);
      current.setUTCDate(current.getUTCDate() + 1);
    }

    const rainList = dates.map((_, i) =>
      options.rainOnDayIndex === i ? (options.rainMm ?? 12.0) : 0.0,
    );

    return {
      latitude: 26.9,
      longitude: 75.8,
      daily: {
        time: dates,
        temperature_2m_max: dates.map(() => 30.0),
        temperature_2m_min: dates.map(() => 18.0),
        precipitation_sum: rainList,
        et0_fao_evapotranspiration: dates.map(() => 5.0),
      },
    };
  }

  describe('recomputeField (Core Calculation & Idempotency)', () => {
    it('recompute twice gives identical rows', async () => {
      const { user } = await createTestUser();

      const field = await FieldModel.create({
        userId: user.id,
        name: 'Test Tomato Field',
        geometry: validSquarePolygon,
        centroid: { type: 'Point', coordinates: [75.8, 26.9] },
        areaHa: 0.5,
        cropKey: 'tomato',
        sowingDate: new Date('2026-08-19'), // Mid-season
        soilType: 'loam',
        method: 'drip',
        baseline: { everyDays: 4, depthMm: 25 },
        version: 1,
      });

      // Mock Open-Meteo
      nock('https://api.open-meteo.com')
        .get('/v1/forecast')
        .query(true)
        .reply(200, generateMockWeatherResponse());

      // First recompute
      const recs1 = await recomputeField(field._id, { redis: redisMock });
      expect(recs1).toHaveLength(7);

      // Second recompute (should be a cache hit for weather and produce identical recommendations)
      const recs2 = await recomputeField(field._id, { redis: redisMock });
      expect(recs2).toHaveLength(7);

      // Identical row count in database
      const totalDocs = await RecommendationModel.countDocuments({ fieldId: field._id });
      expect(totalDocs).toBe(7);

      for (let i = 0; i < 7; i++) {
        expect(recs1[i]?.forDate).toBe(recs2[i]?.forDate);
        expect(recs1[i]?.action).toBe(recs2[i]?.action);
        expect(recs1[i]?.netMm).toBe(recs2[i]?.netMm);
        expect(recs1[i]?.grossMm).toBe(recs2[i]?.grossMm);
        expect(recs1[i]?.litres).toBe(recs2[i]?.litres);
        expect(recs1[i]?.reasonKey).toBe(recs2[i]?.reasonKey);
      }
    });

    it('stale weather sets stale: true on recommendations', async () => {
      const { user } = await createTestUser();

      const field = await FieldModel.create({
        userId: user.id,
        name: 'Stale Field',
        geometry: validSquarePolygon,
        centroid: { type: 'Point', coordinates: [75.8, 26.9] },
        areaHa: 1.0,
        cropKey: 'wheat',
        sowingDate: new Date('2026-10-01'),
        soilType: 'clay',
        method: 'flood',
        baseline: { everyDays: 7, depthMm: 50 },
        version: 1,
      });

      // Pre-populate stale weather (> 6 hours old)
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      const current = new Date(`${today}T00:00:00.000Z`);
      const eightHoursAgo = new Date(Date.now() - 8 * 3600 * 1000);

      const staleWeatherDocs = [];
      for (let i = 0; i < 7; i++) {
        const d = current.toISOString().split('T')[0]!;
        staleWeatherDocs.push({
          cellKey: '26.9_75.8',
          date: d,
          tmaxC: 28.0,
          tminC: 16.0,
          rainMm: 0.0,
          et0Mm: 4.0,
          source: 'open-meteo',
          fetchedAt: eightHoursAgo,
        });
        current.setUTCDate(current.getUTCDate() + 1);
      }
      await WeatherDayModel.create(staleWeatherDocs);

      // Upstream Open-Meteo is down (returns 500)
      nock('https://api.open-meteo.com')
        .get('/v1/forecast')
        .query(true)
        .twice()
        .reply(500, { error: 'Upstream Down' });

      const recs = await recomputeField(field._id, {
        redis: redisMock,
        retryDelayMs: 20,
      });

      expect(recs).toHaveLength(7);
      for (const rec of recs) {
        expect(rec.staleWeather).toBe(true);
      }
    });
  });

  describe('BullMQ Scheduler: processDailyRecommendations', () => {
    it('the batch continues after one field fails', async () => {
      const { user } = await createTestUser();

      // Field 1: Valid field
      const field1 = await FieldModel.create({
        userId: user.id,
        name: 'Valid Field 1',
        geometry: validSquarePolygon,
        centroid: { type: 'Point', coordinates: [75.8, 26.9] },
        areaHa: 1.0,
        cropKey: 'wheat',
        sowingDate: new Date('2026-10-01'),
        soilType: 'clay',
        method: 'flood',
        baseline: { everyDays: 7, depthMm: 50 },
        version: 1,
      });

      // Field 2: Corrupted cropKey that fails in buildDailyNeeds
      const field2 = await FieldModel.create({
        userId: user.id,
        name: 'Invalid Crop Field 2',
        geometry: validSquarePolygon,
        centroid: { type: 'Point', coordinates: [75.8, 26.9] },
        areaHa: 1.0,
        cropKey: 'non_existent_crop',
        sowingDate: new Date('2026-10-01'),
        soilType: 'clay',
        method: 'flood',
        baseline: { everyDays: 7, depthMm: 50 },
        version: 1,
      });

      // Field 3: Valid field
      const field3 = await FieldModel.create({
        userId: user.id,
        name: 'Valid Field 3',
        geometry: validSquarePolygon,
        centroid: { type: 'Point', coordinates: [75.8, 26.9] },
        areaHa: 1.0,
        cropKey: 'maize',
        sowingDate: new Date('2026-10-01'),
        soilType: 'loam',
        method: 'drip',
        baseline: { everyDays: 4, depthMm: 30 },
        version: 1,
      });

      // Mock weather API
      nock('https://api.open-meteo.com')
        .get('/v1/forecast')
        .query(true)
        .reply(200, generateMockWeatherResponse());

      // Execute daily processing
      const summary = await processDailyRecommendations();

      expect(summary.distinctCells).toBe(1);
      expect(summary.processedFields).toBe(2); // field1 and field3 succeeded
      expect(summary.failedFields).toBe(1); // field2 failed and was skipped

      // Field 1 and Field 3 have recommendations saved
      const recs1 = await RecommendationModel.find({ fieldId: field1._id });
      expect(recs1).toHaveLength(7);

      const recs3 = await RecommendationModel.find({ fieldId: field3._id });
      expect(recs3).toHaveLength(7);

      // Field 2 has 0 recommendations
      const recs2 = await RecommendationModel.find({ fieldId: field2._id });
      expect(recs2).toHaveLength(0);
    });
  });

  describe('Endpoints & User Isolation', () => {
    it('GET /fields/:id/recommendations returns 7-day recommendations for field owner', async () => {
      const userA = await createTestUser('owner_a@example.com');
      const userB = await createTestUser('owner_b@example.com');

      // User A creates field
      nock('https://api.open-meteo.com')
        .get('/v1/forecast')
        .query(true)
        .reply(200, generateMockWeatherResponse());

      const createRes = await request(app)
        .post('/fields')
        .set('Authorization', `Bearer ${userA.token}`)
        .send({
          name: 'Owner Field',
          geometry: validSquarePolygon,
          cropKey: 'wheat',
          sowingDate: new Date('2026-10-01').toISOString(),
          soilType: 'loam',
          method: 'drip',
          baseline: { everyDays: 5, depthMm: 30 },
        });

      const fieldId = createRes.body.data.field.id;

      // User A retrieves recommendations
      const getResA = await request(app)
        .get(`/fields/${fieldId}/recommendations?days=7`)
        .set('Authorization', `Bearer ${userA.token}`);

      expect(getResA.status).toBe(200);
      expect(getResA.body.status).toBe('success');
      expect(getResA.body.data.recommendations).toHaveLength(7);

      // User B cannot access User A's field recommendations (returns 404)
      const getResB = await request(app)
        .get(`/fields/${fieldId}/recommendations?days=7`)
        .set('Authorization', `Bearer ${userB.token}`);

      expect(getResB.status).toBe(404);
    });

    it('POST /fields/:id/recommendations/recompute triggers recomputation', async () => {
      const userA = await createTestUser('recompute_a@example.com');

      nock('https://api.open-meteo.com')
        .get('/v1/forecast')
        .query(true)
        .twice()
        .reply(200, generateMockWeatherResponse());

      const createRes = await request(app)
        .post('/fields')
        .set('Authorization', `Bearer ${userA.token}`)
        .send({
          name: 'Recompute Field',
          geometry: validSquarePolygon,
          cropKey: 'potato',
          sowingDate: new Date('2026-10-01').toISOString(),
          soilType: 'sandy',
          method: 'sprinkler',
          baseline: { everyDays: 3, depthMm: 20 },
        });

      const fieldId = createRes.body.data.field.id;

      // Recompute endpoint
      const recomputeRes = await request(app)
        .post(`/fields/${fieldId}/recommendations/recompute`)
        .set('Authorization', `Bearer ${userA.token}`);

      expect(recomputeRes.status).toBe(200);
      expect(recomputeRes.body.status).toBe('success');
      expect(recomputeRes.body.data.recommendations).toHaveLength(7);
    });
  });

  describe('Acceptance Criteria: Field creation returns 7-day plan matching hand calculations', () => {
    it('creating a field returns a 7 day plan matching Scenario A in docs/science.md', async () => {
      // Scenario A from docs/science.md:
      // Tomato, mid-season (Kc = 1.15), Drip (eff = 0.90), area = 0.5 ha, ET0 = 5.0 mm, Rain = 0 mm
      // ETc = 5.0 * 1.15 = 5.75 mm
      // Net = 5.75 mm
      // Gross = 5.75 / 0.90 ≈ 6.39 mm
      // Litres = 6.39 * 0.5 * 10,000 ≈ 31,950 litres
      const user = await createTestUser('acceptance_farmer@example.com');

      // Sown on 2026-08-19 -> On 2026-11-02, das = 75 (mid stage, Kc = 1.15)
      const midSeasonDate = new Date();
      midSeasonDate.setDate(midSeasonDate.getDate() - 75);

      nock('https://api.open-meteo.com')
        .get('/v1/forecast')
        .query(true)
        .reply(200, generateMockWeatherResponse());

      const createRes = await request(app)
        .post('/fields')
        .set('Authorization', `Bearer ${user.token}`)
        .send({
          name: 'Acceptance Tomato Field',
          geometry: validSquarePolygon,
          cropKey: 'tomato',
          sowingDate: midSeasonDate.toISOString(),
          soilType: 'loam',
          method: 'drip',
          baseline: { everyDays: 4, depthMm: 25 },
        });

      expect(createRes.status).toBe(201);
      expect(createRes.body.data.field).toBeDefined();

      // Field creation returns a 7-day plan
      const plan = createRes.body.data.plan;
      expect(plan).toBeDefined();
      expect(plan).toHaveLength(7);

      // Verify science calculations match docs/science.md
      const day1 = plan[0];
      expect(day1.et0Mm).toBe(5.0);
      expect(day1.kc).toBe(1.15);
      expect(day1.etcMm).toBe(5.75);
      expect(day1.rainMm).toBe(0.0);
      expect(day1.effectiveRainMm).toBe(0.0);

      // Check irrigation amounts when loam trigger (20 mm) is reached (on day 4: 5.75 * 4 = 23 mm >= 20 mm)
      const day4 = plan[3];
      expect(day4.action).toBe('irrigate');
      expect(day4.reasonKey).toBe('reason.deficit_reached');
      // Gross need = net / 0.90
      expect(day4.grossMm).toBeCloseTo(day4.netMm / 0.9, 1);
      // Litres = grossMm * field.areaHa * 10,000
      const fieldAreaHa = createRes.body.data.field.areaHa;
      expect(day4.litres).toBeCloseTo(day4.grossMm * fieldAreaHa * 10000, -2);
    });
  });

  describe('Phase 19: Rain-fed Mode Recommendations', () => {
    it('creates a rainfed field and computes rainfed plan (0 litres, null runMinutes)', async () => {
      const { token } = await createTestUser('rainfed_farmer@example.com');

      // Centroid in Rajasthan (75.8, 26.9)
      nock('https://api.open-meteo.com')
        .get('/v1/forecast')
        .query(true)
        .reply(200, generateMockWeatherResponse({ pastDays: 14 }));

      const res = await request(app)
        .post('/fields')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Rainfed Cotton Field',
          geometry: validSquarePolygon,
          cropKey: 'cotton',
          sowingDate: new Date('2026-06-20').toISOString(),
          soilType: 'clay',
          method: 'flood',
          baseline: { everyDays: 5, depthMm: 30 },
          waterMode: 'rainfed',
          hasProtectiveWater: true,
        });

      expect(res.status).toBe(201);
      const field = res.body.data.field;
      expect(field.waterMode).toBe('rainfed');
      expect(field.hasProtectiveWater).toBe(true);

      const recs = await RecommendationModel.find({ fieldId: field.id }).sort({ forDate: 1 });
      expect(recs).toHaveLength(7);

      for (const rec of recs) {
        expect(rec.action).toBe('skip');
        expect(rec.netMm).toBe(0);
        expect(rec.grossMm).toBe(0);
        expect(rec.litres).toBe(0);
        expect(rec.runMinutes).toBeNull();
        expect(rec.pumpCost).toBeNull();
        expect(rec.waterMode).toBe('rainfed');
        expect(rec.rainfedPlan).toBeDefined();
        expect(rec.rainfedPlan?.statusKey).toMatch(/^rainfed\./);
        expect(rec.rainfedPlan?.params).toHaveProperty('rainLast7Days');
        expect(rec.rainfedPlan?.params).toHaveProperty('drySpellDays');
        expect(rec.rainfedPlan?.params).toHaveProperty('bucketPercent');
      }
    });

    it('recomputes correctly when switching from irrigated to rainfed and back', async () => {
      const { token } = await createTestUser('switch_farmer@example.com');

      nock('https://api.open-meteo.com')
        .get('/v1/forecast')
        .query(true)
        .reply(200, generateMockWeatherResponse({ pastDays: 14 }));

      // 1. Create irrigated field
      const createRes = await request(app)
        .post('/fields')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Switch Field',
          geometry: validSquarePolygon,
          cropKey: 'wheat',
          sowingDate: new Date('2026-10-01').toISOString(),
          soilType: 'loam',
          method: 'drip',
          baseline: { everyDays: 4, depthMm: 25 },
          waterMode: 'irrigated',
        });

      const fieldId = createRes.body.data.field.id;
      let fieldVersion = createRes.body.data.field.version;

      const irrigatedRecs = await RecommendationModel.find({ fieldId }).sort({ forDate: 1 });
      expect(irrigatedRecs.some((r) => r.action === 'irrigate')).toBe(true);
      expect(irrigatedRecs[0]?.waterMode).toBe('irrigated');
      expect(irrigatedRecs[0]?.rainfedPlan).toBeNull();

      // 2. Switch to rainfed
      nock('https://api.open-meteo.com')
        .get('/v1/forecast')
        .query(true)
        .reply(200, generateMockWeatherResponse({ pastDays: 14 }));

      const patchRes = await request(app)
        .patch(`/fields/${fieldId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          version: fieldVersion,
          waterMode: 'rainfed',
          hasProtectiveWater: false,
        });

      expect(patchRes.status).toBe(200);
      fieldVersion = patchRes.body.data.field.version;

      const rainfedRecs = await RecommendationModel.find({ fieldId }).sort({ forDate: 1 });
      expect(rainfedRecs).toHaveLength(7);
      expect(rainfedRecs.every((r) => r.action === 'skip')).toBe(true);
      expect(rainfedRecs.every((r) => r.litres === 0)).toBe(true);
      expect(rainfedRecs[0]?.waterMode).toBe('rainfed');
      expect(rainfedRecs[0]?.rainfedPlan).toBeDefined();

      // 3. Switch back to irrigated
      nock('https://api.open-meteo.com')
        .get('/v1/forecast')
        .query(true)
        .reply(200, generateMockWeatherResponse({ pastDays: 14 }));

      const patchBackRes = await request(app)
        .patch(`/fields/${fieldId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          version: fieldVersion,
          waterMode: 'irrigated',
        });

      expect(patchBackRes.status).toBe(200);

      const restoredRecs = await RecommendationModel.find({ fieldId }).sort({ forDate: 1 });
      expect(restoredRecs.some((r) => r.action === 'irrigate')).toBe(true);
      expect(restoredRecs[0]?.waterMode).toBe('irrigated');
      expect(restoredRecs[0]?.rainfedPlan).toBeNull();
    });

    it('returns rainfed.no_calendar for location without covered calendar state', async () => {
      const { token } = await createTestUser('no_calendar@example.com');

      // Pin location in sea / outside covered states (e.g. 72.0, 15.0 - Arabian Sea off Goa coast)
      nock('https://api.open-meteo.com')
        .get('/v1/forecast')
        .query(true)
        .reply(200, generateMockWeatherResponse({ pastDays: 14 }));

      const createRes = await request(app)
        .post('/fields')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Offshore Field',
          locationMode: 'pin',
          location: { type: 'Point', coordinates: [72.0, 15.0] },
          areaValue: 2,
          areaUnit: 'acre',
          cropKey: 'cotton',
          sowingDate: new Date('2026-06-20').toISOString(),
          soilType: 'loam',
          method: 'drip',
          baseline: { everyDays: 4, depthMm: 25 },
          waterMode: 'rainfed',
        });

      expect(createRes.status).toBe(201);
      const fieldId = createRes.body.data.field.id;

      const recs = await RecommendationModel.find({ fieldId }).sort({ forDate: 1 });
      expect(recs[0]?.reasonKey).toBe('rainfed.no_calendar');
      expect(recs[0]?.rainfedPlan?.statusKey).toBe('rainfed.no_calendar');
      expect(recs[0]?.notes).toContain('rainfed.advice.no_calendar');
    });
  });
});
