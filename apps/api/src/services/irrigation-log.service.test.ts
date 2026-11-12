import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import nock from 'nock';
import { createApp } from '../app.js';
import { UserModel } from '../models/user.model.js';
import { FieldModel } from '../models/field.model.js';
import { RecommendationModel } from '../models/recommendation.model.js';
import { IrrigationLogModel } from '../models/irrigation-log.model.js';
import { WeatherDayModel } from '../models/weatherDay.model.js';

describe('Irrigation Log & Savings Service Integration Tests', () => {
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
      RecommendationModel.syncIndexes(),
      IrrigationLogModel.syncIndexes(),
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
    nock.enableNetConnect();
    await UserModel.deleteMany({});
    await FieldModel.deleteMany({});
    await RecommendationModel.deleteMany({});
    await IrrigationLogModel.deleteMany({});
    await WeatherDayModel.deleteMany({});

    // Seed cached weather fallback so test never hangs on external network
    const today = new Date().toISOString().split('T')[0]!;
    await WeatherDayModel.create({
      cellKey: '26.9_75.8',
      date: today,
      tmaxC: 30,
      tminC: 18,
      rainMm: 0,
      et0Mm: 4.5,
      source: 'open-meteo',
      fetchedAt: new Date(),
    });
  });

  async function createTestUser(email: string, name = 'Farmer Ram') {
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

  // Helper to create a 1.0 ha field
  async function createField(token: string, overrides = {}) {
    // 100m x 100m rectangle in Punjab = ~1.0 ha
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
        name: 'Savings Test Field',
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
        ...overrides,
      });

    return res.body.data.field;
  }

  describe('Irrigation Logging CRUD & Deficit Reset', () => {
    it('creates an irrigation log, resets deficit, and recomputes recommendations', async () => {
      const user = await createTestUser('ramesh_log@example.com');
      const field = await createField(user.token);

      const logRes = await request(app)
        .post(`/fields/${field.id}/logs`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({
          date: '2026-11-02',
          appliedMm: 25.5,
          source: 'recommended',
          note: 'Drip ran for 2 hours in morning',
        });

      expect(logRes.status).toBe(201);
      expect(logRes.body.status).toBe('success');
      expect(logRes.body.data.log.appliedMm).toBe(25.5);
      expect(logRes.body.data.log.source).toBe('recommended');
      expect(logRes.body.data.log.note).toBe('Drip ran for 2 hours in morning');

      // Verify log was saved in database
      const savedLog = await IrrigationLogModel.findById(logRes.body.data.log.id);
      expect(savedLog).not.toBeNull();
      expect(savedLog?.date).toBe('2026-11-02');

      // Verify GET /fields/:id/logs returns the log
      const listRes = await request(app)
        .get(`/fields/${field.id}/logs`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(listRes.status).toBe(200);
      expect(listRes.body.data.logs.length).toBe(1);
      expect(listRes.body.data.logs[0].id).toBe(logRes.body.data.log.id);

      // Verify DELETE /fields/:id/logs/:logId removes the log
      const deleteRes = await request(app)
        .delete(`/fields/${field.id}/logs/${logRes.body.data.log.id}`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.message).toContain('deleted');

      const afterDelete = await IrrigationLogModel.findById(logRes.body.data.log.id);
      expect(afterDelete).toBeNull();
    });

    it('rejects invalid inputs on POST /fields/:id/logs', async () => {
      const user = await createTestUser('invalid_log@example.com');
      const field = await createField(user.token);

      // Negative appliedMm
      const res1 = await request(app)
        .post(`/fields/${field.id}/logs`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({
          date: '2026-11-02',
          appliedMm: -10,
          source: 'manual',
        });
      expect(res1.status).toBe(400);

      // Invalid date format
      const res2 = await request(app)
        .post(`/fields/${field.id}/logs`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({
          date: '02-11-2026',
          appliedMm: 20,
          source: 'manual',
        });
      expect(res2.status).toBe(400);

      // Invalid source
      const res3 = await request(app)
        .post(`/fields/${field.id}/logs`)
        .set('Authorization', `Bearer ${user.token}`)
        .send({
          date: '2026-11-02',
          appliedMm: 20,
          source: 'automated',
        });
      expect(res3.status).toBe(400);
    });
  });

  describe('Savings Calculation & Scenarios', () => {
    it('worked example with known numbers matching hand calculations', async () => {
      const user = await createTestUser('worked_savings@example.com');
      const field = await createField(user.token, {
        baseline: { everyDays: 3, depthMm: 30 },
      });
      const areaHa = field.areaHa; // calculated on server

      const from = '2026-11-01';
      const to = '2026-11-09'; // 9 days inclusive: 3 baseline irrigations @ 30mm = 90mm

      // Delete auto-computed initial recommendations so we can seed exact test scenarios
      await RecommendationModel.deleteMany({ fieldId: field.id });

      // Seed 2 recommendations with action 'irrigate' (20mm gross each = 40mm gross)
      await RecommendationModel.create([
        {
          fieldId: field.id,
          userId: user.user.id,
          forDate: '2026-11-03',
          action: 'irrigate',
          netMm: 18,
          grossMm: 20,
          litres: Math.round(20 * areaHa * 10000),
          reasonKey: 'reason.deficit_reached',
          deficitMm: 18,
          et0Mm: 4.5,
          kc: 1.0,
          etcMm: 4.5,
          rainMm: 0,
          effectiveRainMm: 0,
        },
        {
          fieldId: field.id,
          userId: user.user.id,
          forDate: '2026-11-07',
          action: 'irrigate',
          netMm: 18,
          grossMm: 20,
          litres: Math.round(20 * areaHa * 10000),
          reasonKey: 'reason.deficit_reached',
          deficitMm: 18,
          et0Mm: 4.5,
          kc: 1.0,
          etcMm: 4.5,
          rainMm: 0,
          effectiveRainMm: 0,
        },
        // A skip day
        {
          fieldId: field.id,
          userId: user.user.id,
          forDate: '2026-11-05',
          action: 'skip',
          netMm: 0,
          grossMm: 0,
          litres: 0,
          reasonKey: 'reason.not_needed',
          deficitMm: 5,
          et0Mm: 4.5,
          kc: 1.0,
          etcMm: 4.5,
          rainMm: 0,
          effectiveRainMm: 0,
        },
      ]);

      // Seed 1 actual log of 35mm
      await IrrigationLogModel.create({
        fieldId: field.id,
        userId: user.user.id,
        date: '2026-11-04',
        appliedMm: 35,
        source: 'manual',
      });

      const res = await request(app)
        .get(`/fields/${field.id}/savings?from=${from}&to=${to}`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(res.status).toBe(200);
      const data = res.body.data;

      expect(data.days).toBe(9);

      // Baseline: 3 irrigations * 30mm = 90mm
      const expectedBaselineLitres = Math.round(90 * areaHa * 10000);
      expect(data.totals.baseline.count).toBe(3);
      expect(data.totals.baseline.totalMm).toBe(90);
      expect(data.totals.baseline.litres).toBe(expectedBaselineLitres);

      // Recommended: 2 irrigations * 20mm = 40mm
      const expectedRecLitres = Math.round(40 * areaHa * 10000);
      expect(data.totals.recommended.count).toBe(2);
      expect(data.totals.recommended.totalMm).toBe(40);
      expect(data.totals.recommended.litres).toBe(expectedRecLitres);

      // Actual: 1 log * 35mm = 35mm
      const expectedActualLitres = Math.round(35 * areaHa * 10000);
      expect(data.totals.actual.count).toBe(1);
      expect(data.totals.actual.totalMm).toBe(35);
      expect(data.totals.actual.litres).toBe(expectedActualLitres);

      // Potential savings = baseline - recommended
      // 90 - 40 = 50 mm, 50/90 = 55.56%
      expect(data.totals.potentialSaved.mm).toBe(50);
      expect(data.totals.potentialSaved.litres).toBe(expectedBaselineLitres - expectedRecLitres);
      expect(data.totals.potentialSaved.pct).toBe(55.56);

      // Realised savings = baseline - actual
      // 90 - 35 = 55 mm, 55/90 = 61.11%
      expect(data.totals.realisedSaved.mm).toBe(55);
      expect(data.totals.realisedSaved.litres).toBe(expectedBaselineLitres - expectedActualLitres);
      expect(data.totals.realisedSaved.pct).toBe(61.11);

      // Assumptions & note
      expect(data.assumptions.method).toBe('drip');
      expect(data.assumptions.efficiency).toBe(0.9);
      expect(data.assumptions.baseline.everyDays).toBe(3);
      expect(data.assumptions.baseline.depthMm).toBe(30);
      expect(data.assumptions.baselineNote).toContain("farmer's own stated routine");
    });

    it('baseline with zero irrigations when range is shorter than baseline interval', async () => {
      const user = await createTestUser('zero_irrig@example.com');
      const field = await createField(user.token, {
        baseline: { everyDays: 4, depthMm: 25 },
      });

      // Range is 2 days (less than everyDays=4) -> 0 baseline irrigations
      const res = await request(app)
        .get(`/fields/${field.id}/savings?from=2026-11-01&to=2026-11-02`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(res.status).toBe(200);
      const data = res.body.data;

      expect(data.days).toBe(2);
      expect(data.totals.baseline.count).toBe(0);
      expect(data.totals.baseline.totalMm).toBe(0);
      expect(data.totals.baseline.litres).toBe(0);
      expect(data.totals.potentialSaved.litres).toBe(0);
      expect(data.totals.realisedSaved.litres).toBe(0);
    });

    it('handles scenario with no actual logs (100% realised savings)', async () => {
      const user = await createTestUser('no_logs@example.com');
      const field = await createField(user.token, {
        baseline: { everyDays: 3, depthMm: 30 },
      });

      // 9 days range, no logs created
      const res = await request(app)
        .get(`/fields/${field.id}/savings?from=2026-11-01&to=2026-11-09`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(res.status).toBe(200);
      const data = res.body.data;

      expect(data.totals.actual.count).toBe(0);
      expect(data.totals.actual.totalMm).toBe(0);
      expect(data.totals.actual.litres).toBe(0);

      // Realised savings is 100% of baseline
      expect(data.totals.realisedSaved.mm).toBe(90);
      expect(data.totals.realisedSaved.litres).toBe(data.totals.baseline.litres);
      expect(data.totals.realisedSaved.pct).toBe(100);
    });

    it('reports negative savings honestly when actual logs exceed baseline', async () => {
      const user = await createTestUser('negative_savings@example.com');
      const field = await createField(user.token, {
        baseline: { everyDays: 3, depthMm: 30 },
      });
      const areaHa = field.areaHa;

      // Baseline: 9 days, every 3 days @ 30mm = 90mm
      // Create actual logs totaling 120mm (exceeding baseline by 30mm)
      await IrrigationLogModel.create([
        {
          fieldId: field.id,
          userId: user.user.id,
          date: '2026-11-02',
          appliedMm: 40,
          source: 'manual',
        },
        {
          fieldId: field.id,
          userId: user.user.id,
          date: '2026-11-05',
          appliedMm: 40,
          source: 'manual',
        },
        {
          fieldId: field.id,
          userId: user.user.id,
          date: '2026-11-08',
          appliedMm: 40,
          source: 'manual',
        },
      ]);

      const res = await request(app)
        .get(`/fields/${field.id}/savings?from=2026-11-01&to=2026-11-09`)
        .set('Authorization', `Bearer ${user.token}`);

      expect(res.status).toBe(200);
      const data = res.body.data;

      expect(data.totals.actual.count).toBe(3);
      expect(data.totals.actual.totalMm).toBe(120);

      // Realised savings must be negative: 90 - 120 = -30 mm
      const expectedBaselineLitres = Math.round(90 * areaHa * 10000);
      const expectedActualLitres = Math.round(120 * areaHa * 10000);
      expect(data.totals.realisedSaved.mm).toBe(-30);
      expect(data.totals.realisedSaved.litres).toBe(expectedBaselineLitres - expectedActualLitres);
      expect(data.totals.realisedSaved.litres).toBeLessThan(0);
      expect(data.totals.realisedSaved.pct).toBe(-33.33);
    });
  });

  describe('Multi-tenant Ownership Isolation', () => {
    it('user B cannot create, list, or delete logs on user A field', async () => {
      const userA = await createTestUser('user_a@example.com');
      const userB = await createTestUser('user_b@example.com');
      const fieldA = await createField(userA.token);

      // User A creates a log
      const logA = await request(app)
        .post(`/fields/${fieldA.id}/logs`)
        .set('Authorization', `Bearer ${userA.token}`)
        .send({
          date: '2026-11-01',
          appliedMm: 20,
          source: 'manual',
        });
      expect(logA.status).toBe(201);
      const logId = logA.body.data.log.id;

      // User B tries to create log on User A field -> 404
      const bCreate = await request(app)
        .post(`/fields/${fieldA.id}/logs`)
        .set('Authorization', `Bearer ${userB.token}`)
        .send({
          date: '2026-11-02',
          appliedMm: 25,
          source: 'manual',
        });
      expect(bCreate.status).toBe(404);

      // User B tries to list logs of User A field -> 404
      const bList = await request(app)
        .get(`/fields/${fieldA.id}/logs`)
        .set('Authorization', `Bearer ${userB.token}`);
      expect(bList.status).toBe(404);

      // User B tries to delete User A log -> 404
      const bDelete = await request(app)
        .delete(`/fields/${fieldA.id}/logs/${logId}`)
        .set('Authorization', `Bearer ${userB.token}`);
      expect(bDelete.status).toBe(404);

      // User B tries to read User A savings -> 404
      const bSavings = await request(app)
        .get(`/fields/${fieldA.id}/savings?from=2026-11-01&to=2026-11-09`)
        .set('Authorization', `Bearer ${userB.token}`);
      expect(bSavings.status).toBe(404);

      // User A can still delete own log -> 200
      const aDelete = await request(app)
        .delete(`/fields/${fieldA.id}/logs/${logId}`)
        .set('Authorization', `Bearer ${userA.token}`);
      expect(aDelete.status).toBe(200);
    });
  });
});
