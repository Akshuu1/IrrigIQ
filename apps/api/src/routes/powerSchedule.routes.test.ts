import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../app.js';
import { UserModel } from '../models/user.model.js';
import { FieldModel } from '../models/field.model.js';
import { PumpModel } from '../models/pump.model.js';
import { PowerScheduleModel } from '../models/powerSchedule.model.js';
import { RecommendationModel } from '../models/recommendation.model.js';
import * as weatherService from '../services/weather.service.js';

describe('Power Schedule API & Pump Scheduling Integration Tests (/power-schedules & /fields)', () => {
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
    await PowerScheduleModel.syncIndexes();
    await PumpModel.syncIndexes();
    await FieldModel.syncIndexes();
    await RecommendationModel.syncIndexes();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongod) {
      await mongod.stop();
    }
  });

  beforeEach(async () => {
    await UserModel.deleteMany({});
    await FieldModel.deleteMany({});
    await PumpModel.deleteMany({});
    await PowerScheduleModel.deleteMany({});
    await RecommendationModel.deleteMany({});
    vi.restoreAllMocks();
  });

  async function createTestUser(email = 'farmer@example.com', name = 'Ramesh Patel') {
    const res = await request(app).post('/auth/register').send({
      email,
      password: 'Password123!',
      name,
      language: 'en',
      areaUnit: 'acre',
    });
    return {
      token: res.body.data.accessToken as string,
      user: res.body.data.user,
    };
  }

  const samplePolygon = {
    type: 'Polygon',
    coordinates: [
      [
        [77.1025, 28.7041],
        [77.1035, 28.7041],
        [77.1035, 28.7051],
        [77.1025, 28.7051],
        [77.1025, 28.7041],
      ],
    ],
  };

  describe('Power Schedule CRUD & Presets', () => {
    it('creates a custom power schedule and lists schedules', async () => {
      const { token } = await createTestUser();

      const res = await request(app)
        .post('/power-schedules')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Feeder Line 4 Night',
          type: 'custom',
          windows: [
            {
              days: [0, 1, 2, 3, 4, 5, 6],
              start: '22:00',
              end: '06:00',
            },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.schedule.name).toBe('Feeder Line 4 Night');
      expect(res.body.data.schedule.windows).toHaveLength(1);

      const listRes = await request(app)
        .get('/power-schedules')
        .set('Authorization', `Bearer ${token}`);

      expect(listRes.status).toBe(200);
      expect(listRes.body.data.schedules).toHaveLength(1);
    });

    it('creates or retrieves preset schedules (night and day)', async () => {
      const { token } = await createTestUser();

      const nightRes = await request(app)
        .post('/power-schedules/preset/night')
        .set('Authorization', `Bearer ${token}`)
        .send();

      expect(nightRes.status).toBe(200);
      expect(nightRes.body.data.schedule.type).toBe('night');
      expect(nightRes.body.data.schedule.windows[0]).toMatchObject({
        start: '22:00',
        end: '06:00',
      });

      // Calling again returns the existing one (idempotent)
      const repeatRes = await request(app)
        .post('/power-schedules/preset/night')
        .set('Authorization', `Bearer ${token}`)
        .send();

      expect(repeatRes.status).toBe(200);
      expect(repeatRes.body.data.schedule._id).toBe(nightRes.body.data.schedule._id);

      const dayRes = await request(app)
        .post('/power-schedules/preset/day')
        .set('Authorization', `Bearer ${token}`)
        .send();

      expect(dayRes.status).toBe(200);
      expect(dayRes.body.data.schedule.type).toBe('day');
      expect(dayRes.body.data.schedule.windows[0]).toMatchObject({
        start: '06:00',
        end: '14:00',
      });
    });

    it('enforces multi-tenant ownership: cannot view or edit another user schedule', async () => {
      const userA = await createTestUser('userA@example.com', 'User A');
      const userB = await createTestUser('userB@example.com', 'User B');

      const createRes = await request(app)
        .post('/power-schedules')
        .set('Authorization', `Bearer ${userA.token}`)
        .send({
          name: 'Private Schedule',
          type: 'custom',
          windows: [{ days: [1, 2, 3], start: '08:00', end: '12:00' }],
        });

      const scheduleId = createRes.body.data.schedule.id || createRes.body.data.schedule._id;

      // User B cannot access
      const getRes = await request(app)
        .get(`/power-schedules/${scheduleId}`)
        .set('Authorization', `Bearer ${userB.token}`);

      expect(getRes.status).toBe(403);

      // User B cannot update
      const updateRes = await request(app)
        .patch(`/power-schedules/${scheduleId}`)
        .set('Authorization', `Bearer ${userB.token}`)
        .send({ name: 'Hacked Schedule' });

      expect(updateRes.status).toBe(403);

      // User B cannot delete
      const deleteRes = await request(app)
        .delete(`/power-schedules/${scheduleId}`)
        .set('Authorization', `Bearer ${userB.token}`);

      expect(deleteRes.status).toBe(403);
    });

    it('updates and deletes power schedule', async () => {
      const { token } = await createTestUser();

      const createRes = await request(app)
        .post('/power-schedules')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Initial Name',
          type: 'custom',
          windows: [{ days: [1, 2], start: '10:00', end: '14:00' }],
        });

      const scheduleId = createRes.body.data.schedule.id || createRes.body.data.schedule._id;

      const updateRes = await request(app)
        .patch(`/power-schedules/${scheduleId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Updated Name',
          windows: [{ days: [1, 2, 3], start: '09:00', end: '15:00' }],
        });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.data.schedule.name).toBe('Updated Name');
      expect(updateRes.body.data.schedule.windows[0].start).toBe('09:00');

      const delRes = await request(app)
        .delete(`/power-schedules/${scheduleId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(delRes.status).toBe(200);

      const verifyRes = await request(app)
        .get(`/power-schedules/${scheduleId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(verifyRes.status).toBe(404);
    });
  });

  describe('Pump Link & Recommendation Segments', () => {
    it('generates pumpSegments within the power window when schedule is linked to pump', async () => {
      const { token } = await createTestUser();

      // 1. Create night power schedule (22:00 - 06:00)
      const schedRes = await request(app)
        .post('/power-schedules/preset/night')
        .set('Authorization', `Bearer ${token}`)
        .send();
      const scheduleId = schedRes.body.data.schedule.id || schedRes.body.data.schedule._id;

      // 2. Create pump linked to schedule (18,000 L/h)
      const pumpRes = await request(app)
        .post('/pumps')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Tomato Tubewell',
          dischargeLph: 18000,
          costPerHour: 50,
          scheduleId,
        });
      const pumpId = pumpRes.body.data.pump.id;

      // Mock weather: dry weather with moderate wind (10 km/h)
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      vi.spyOn(weatherService, 'getWeatherForCell').mockResolvedValue({
        cellKey: '28.7:77.1',
        stale: false,
        fetchedAt: new Date(),
        days: Array.from({ length: 7 }, (_, i) => {
          const d = new Date(`${today}T00:00:00.000Z`);
          d.setUTCDate(d.getUTCDate() + i);
          const dateStr = d.toISOString().split('T')[0]!;
          return {
            date: dateStr,
            tmaxC: 32,
            tminC: 22,
            rainMm: 0,
            et0Mm: 5.5,
            windSpeedMaxKmh: 10,
            source: 'open-meteo' as const,
          };
        }),
      });

      // 3. Create tomato field linked to pump (baseline triggers deficit)
      const fieldRes = await request(app)
        .post('/fields')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Tomato North Parcel',
          geometry: samplePolygon,
          cropKey: 'tomato',
          sowingDate: '2026-10-01',
          soilType: 'loam',
          method: 'drip',
          baseline: { everyDays: 3, depthMm: 20 },
          pumpId,
        });

      const fieldId = fieldRes.body.data.field.id;

      // 4. Fetch recommendations
      const recRes = await request(app)
        .get(`/fields/${fieldId}/recommendations`)
        .set('Authorization', `Bearer ${token}`);

      expect(recRes.status).toBe(200);
      const recs = recRes.body.data.recommendations;
      expect(recs.length).toBeGreaterThan(0);

      // Find day with irrigation
      const irrigDay = recs.find((r: any) => r.action === 'irrigate');
      expect(irrigDay).toBeDefined();
      expect(irrigDay.runMinutes).toBeGreaterThan(0);
      expect(irrigDay.pumpSegments.length).toBeGreaterThan(0);
      expect(irrigDay.missingMinutes).toBeDefined();

      // Verify segment starts at 22:00 IST
      expect(irrigDay.pumpSegments[0].start).toContain('T22:00:00+05:30');
    });

    it('adds plan.windy note when wind > 20 km/h for sprinkler irrigation', async () => {
      const { token } = await createTestUser();

      // Create schedule
      const schedRes = await request(app)
        .post('/power-schedules')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Day/Night Mixed',
          windows: [
            { days: [0, 1, 2, 3, 4, 5, 6], start: '06:00', end: '12:00' },
            { days: [0, 1, 2, 3, 4, 5, 6], start: '22:00', end: '24:00' },
          ],
        });
      const scheduleId = schedRes.body.data.schedule.id || schedRes.body.data.schedule._id;

      const pumpRes = await request(app)
        .post('/pumps')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Sprinkler Pump',
          dischargeLph: 15000,
          scheduleId,
        });
      const pumpId = pumpRes.body.data.pump.id;

      // Mock high wind speed (28 km/h > 20 km/h threshold)
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      vi.spyOn(weatherService, 'getWeatherForCell').mockResolvedValue({
        cellKey: '28.7:77.1',
        stale: false,
        fetchedAt: new Date(),
        days: Array.from({ length: 7 }, (_, i) => {
          const d = new Date(`${today}T00:00:00.000Z`);
          d.setUTCDate(d.getUTCDate() + i);
          const dateStr = d.toISOString().split('T')[0]!;
          return {
            date: dateStr,
            tmaxC: 32,
            tminC: 22,
            rainMm: 0,
            et0Mm: 6.0,
            windSpeedMaxKmh: 28, // High wind
            source: 'open-meteo' as const,
          };
        }),
      });

      // Field using sprinkler
      const fieldRes = await request(app)
        .post('/fields')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Sprinkler Potato Field',
          geometry: samplePolygon,
          cropKey: 'potato',
          sowingDate: '2026-10-01',
          soilType: 'sandy',
          method: 'sprinkler',
          baseline: { everyDays: 2, depthMm: 15 },
          pumpId,
        });

      const fieldId = fieldRes.body.data.field.id;

      const recRes = await request(app)
        .get(`/fields/${fieldId}/recommendations`)
        .set('Authorization', `Bearer ${token}`);

      expect(recRes.status).toBe(200);
      const irrigDay = recRes.body.data.recommendations.find((r: any) => r.action === 'irrigate');
      expect(irrigDay).toBeDefined();
      expect(irrigDay.notes).toContain('plan.windy');
      // Calm night window (22:00) should be chosen over morning (06:00) due to high wind
      expect(irrigDay.pumpSegments[0].start).toContain('T22:00:00+05:30');
    });
  });

  describe('No Power Rescheduling (POST /fields/:id/no-power)', () => {
    it('shifts plan to next interval and preserves root zone soil moisture deficit', async () => {
      const { token } = await createTestUser();

      const schedRes = await request(app)
        .post('/power-schedules/preset/night')
        .set('Authorization', `Bearer ${token}`)
        .send();
      const scheduleId = schedRes.body.data.schedule.id || schedRes.body.data.schedule._id;

      const pumpRes = await request(app)
        .post('/pumps')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Main Tubewell',
          dischargeLph: 18000,
          scheduleId,
        });
      const pumpId = pumpRes.body.data.pump.id;

      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      vi.spyOn(weatherService, 'getWeatherForCell').mockResolvedValue({
        cellKey: '28.7:77.1',
        stale: false,
        fetchedAt: new Date(),
        days: Array.from({ length: 7 }, (_, i) => {
          const d = new Date(`${today}T00:00:00.000Z`);
          d.setUTCDate(d.getUTCDate() + i);
          const dateStr = d.toISOString().split('T')[0]!;
          return {
            date: dateStr,
            tmaxC: 33,
            tminC: 22,
            rainMm: 0,
            et0Mm: 5.5,
            windSpeedMaxKmh: 12,
            source: 'open-meteo' as const,
          };
        }),
      });

      const fieldRes = await request(app)
        .post('/fields')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Wheat Field',
          geometry: samplePolygon,
          cropKey: 'wheat',
          sowingDate: '2026-10-01',
          soilType: 'sandy',
          method: 'flood',
          baseline: { everyDays: 1, depthMm: 25 },
          pumpId,
        });

      const fieldId = fieldRes.body.data.field.id;

      // Initial compute
      const initialRecsRes = await request(app)
        .get(`/fields/${fieldId}/recommendations`)
        .set('Authorization', `Bearer ${token}`);
      const recs = initialRecsRes.body.data.recommendations;
      const irrigDay = recs.find((r: any) => r.action === 'irrigate');
      expect(irrigDay).toBeDefined();
      const targetDate = irrigDay.forDate;
      const initialDeficit = irrigDay.deficitMm;

      // Farmer reports no power on that day
      const noPowerRes = await request(app)
        .post(`/fields/${fieldId}/no-power`)
        .set('Authorization', `Bearer ${token}`)
        .send({ date: targetDate });

      expect(noPowerRes.status).toBe(200);
      expect(noPowerRes.body.status).toBe('success');

      const { currentRecommendation, rescheduledRecommendation } = noPowerRes.body.data;

      // Current day is skipped with power cut reason
      expect(currentRecommendation.action).toBe('skip');
      expect(currentRecommendation.reasonKey).toBe('reason.power_cut');
      expect(currentRecommendation.notes).toContain('plan.no_power');
      expect(currentRecommendation.pumpSegments).toEqual([]);
      expect(currentRecommendation.deficitMm).toBe(initialDeficit); // Deficit preserved!

      // Rescheduled to next day
      expect(rescheduledRecommendation).toBeDefined();
      expect(rescheduledRecommendation.action).toBe('irrigate');
      expect(rescheduledRecommendation.deficitMm).toBeGreaterThanOrEqual(initialDeficit);
      expect(rescheduledRecommendation.runMinutes).toBeGreaterThan(0);
    });
  });
});
