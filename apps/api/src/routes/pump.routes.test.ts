import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../app.js';
import { UserModel } from '../models/user.model.js';
import { FieldModel } from '../models/field.model.js';
import { PumpModel } from '../models/pump.model.js';
import { RecommendationModel } from '../models/recommendation.model.js';

describe('Pump API & Run-time Recommendation Integration Tests (/pumps & /fields)', () => {
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
    await RecommendationModel.deleteMany({});
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

  describe('Pump CRUD & Validation Limits', () => {
    it('creates a pump with valid attributes', async () => {
      const { token } = await createTestUser();

      const res = await request(app)
        .post('/pumps')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Main Tubewell 5HP',
          dischargeLph: 18000,
          costPerHour: 50,
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.pump).toMatchObject({
        name: 'Main Tubewell 5HP',
        dischargeLph: 18000,
        costPerHour: 50,
      });
      expect(res.body.data.pump.id).toBeDefined();
    });

    it('validates discharge limits (500 to 200,000 L/h)', async () => {
      const { token } = await createTestUser();

      // Too low (< 500)
      const resLow = await request(app)
        .post('/pumps')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Tiny Pump',
          dischargeLph: 400,
        });
      expect(resLow.status).toBe(400);

      // Too high (> 200,000)
      const resHigh = await request(app)
        .post('/pumps')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Mega River Pump',
          dischargeLph: 250000,
        });
      expect(resHigh.status).toBe(400);
    });

    it('lists only pumps belonging to the authenticated user', async () => {
      const user1 = await createTestUser('u1@test.com');
      const user2 = await createTestUser('u2@test.com');

      await request(app)
        .post('/pumps')
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ name: 'User 1 Pump', dischargeLph: 18000 });

      await request(app)
        .post('/pumps')
        .set('Authorization', `Bearer ${user2.token}`)
        .send({ name: 'User 2 Pump', dischargeLph: 12000 });

      const res1 = await request(app)
        .get('/pumps')
        .set('Authorization', `Bearer ${user1.token}`);

      expect(res1.status).toBe(200);
      expect(res1.body.data.pumps).toHaveLength(1);
      expect(res1.body.data.pumps[0].name).toBe('User 1 Pump');
    });

    it('enforces ownership checks on get, update, and delete', async () => {
      const user1 = await createTestUser('u1@test.com');
      const user2 = await createTestUser('u2@test.com');

      const pumpRes = await request(app)
        .post('/pumps')
        .set('Authorization', `Bearer ${user1.token}`)
        .send({ name: 'User 1 Private Pump', dischargeLph: 18000 });
      const pumpId = pumpRes.body.data.pump.id;

      // User 2 cannot GET User 1's pump
      const getRes = await request(app)
        .get(`/pumps/${pumpId}`)
        .set('Authorization', `Bearer ${user2.token}`);
      expect(getRes.status).toBe(403);

      // User 2 cannot PATCH User 1's pump
      const patchRes = await request(app)
        .patch(`/pumps/${pumpId}`)
        .set('Authorization', `Bearer ${user2.token}`)
        .send({ name: 'Hacked Pump' });
      expect(patchRes.status).toBe(403);

      // User 2 cannot DELETE User 1's pump
      const deleteRes = await request(app)
        .delete(`/pumps/${pumpId}`)
        .set('Authorization', `Bearer ${user2.token}`);
      expect(deleteRes.status).toBe(403);
    });
  });

  describe('Recommendation Pump Run Time & Recomputation', () => {
    it('sets pumpMissing = true when a field has no pump', async () => {
      const { token } = await createTestUser();

      const fieldRes = await request(app)
        .post('/fields')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Field without Pump',
          geometry: samplePolygon,
          cropKey: 'wheat',
          sowingDate: '2026-10-01',
          soilType: 'loam',
          method: 'drip',
          baseline: { everyDays: 4, depthMm: 25 },
        });

      const fieldId = fieldRes.body.data.field.id;
      const recRes = await request(app)
        .get(`/fields/${fieldId}/recommendations`)
        .set('Authorization', `Bearer ${token}`);

      expect(recRes.status).toBe(200);
      const recs = recRes.body.data.recommendations;
      expect(recs.length).toBeGreaterThan(0);
      expect(recs[0].pumpMissing).toBe(true);
      expect(recs[0].runMinutes).toBeNull();
      expect(recs[0].pumpCost).toBeNull();
      expect(typeof recs[0].litres).toBe('number');
    });

    it('computes runMinutes and pumpCost when field is linked to a pump', async () => {
      const { token } = await createTestUser();

      // Create pump with 18,000 L/h and 50/h cost
      const pumpRes = await request(app)
        .post('/pumps')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Tomato Field Tubewell',
          dischargeLph: 18000,
          costPerHour: 50,
        });
      const pumpId = pumpRes.body.data.pump.id;

      // Create field linked to this pump
      const fieldRes = await request(app)
        .post('/fields')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Tomato Block A',
          geometry: samplePolygon,
          cropKey: 'tomato',
          sowingDate: '2026-10-01',
          soilType: 'loam',
          method: 'drip',
          baseline: { everyDays: 3, depthMm: 20 },
          pumpId,
        });

      const fieldId = fieldRes.body.data.field.id;
      const recRes = await request(app)
        .get(`/fields/${fieldId}/recommendations`)
        .set('Authorization', `Bearer ${token}`);

      expect(recRes.status).toBe(200);
      const recs = recRes.body.data.recommendations;
      expect(recs.length).toBeGreaterThan(0);
      const firstRec = recs[0];
      expect(firstRec.pumpMissing).toBe(false);
      expect(typeof firstRec.runMinutes).toBe('number');
      expect(typeof firstRec.pumpCost).toBe('number');
    });

    it('recomputes recommendations when pump discharge or cost changes', async () => {
      const { token } = await createTestUser();

      // 1. Create pump with 18,000 L/h
      const pumpRes = await request(app)
        .post('/pumps')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Flexible Tubewell',
          dischargeLph: 18000,
          costPerHour: 60,
        });
      const pumpId = pumpRes.body.data.pump.id;

      // 2. Create field linked to pump
      const fieldRes = await request(app)
        .post('/fields')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Wheat North',
          geometry: samplePolygon,
          cropKey: 'wheat',
          sowingDate: '2026-10-01',
          soilType: 'loam',
          method: 'drip',
          baseline: { everyDays: 4, depthMm: 25 },
          pumpId,
        });
      const fieldId = fieldRes.body.data.field.id;

      const recsBefore = (
        await request(app)
          .get(`/fields/${fieldId}/recommendations`)
          .set('Authorization', `Bearer ${token}`)
      ).body.data.recommendations;

      // In case first day has irrigation
      const dayWithWater = recsBefore.find((r: { litres: number }) => r.litres > 0) || recsBefore[0];
      const initialMinutes = dayWithWater.runMinutes;

      // 3. Double pump discharge from 18,000 L/h to 36,000 L/h
      await request(app)
        .patch(`/pumps/${pumpId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ dischargeLph: 36000 });

      // 4. Fetch recommendations again
      const recsAfter = (
        await request(app)
          .get(`/fields/${fieldId}/recommendations`)
          .set('Authorization', `Bearer ${token}`)
      ).body.data.recommendations;

      const updatedDay = recsAfter.find((r: { forDate: string }) => r.forDate === dayWithWater.forDate);

      if (dayWithWater.litres > 0) {
        // Run time should be halved because discharge doubled
        expect(updatedDay.runMinutes).toBeLessThan(initialMinutes);
      }
      expect(updatedDay.pumpMissing).toBe(false);
    });

    it('unlinks pump and marks pumpMissing = true when pump is deleted', async () => {
      const { token } = await createTestUser();

      const pumpRes = await request(app)
        .post('/pumps')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Temporary Pump', dischargeLph: 15000 });
      const pumpId = pumpRes.body.data.pump.id;

      const fieldRes = await request(app)
        .post('/fields')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Field to Unlink',
          geometry: samplePolygon,
          cropKey: 'wheat',
          sowingDate: '2026-10-01',
          soilType: 'loam',
          method: 'drip',
          baseline: { everyDays: 4, depthMm: 25 },
          pumpId,
        });
      const fieldId = fieldRes.body.data.field.id;

      // Delete pump
      const delRes = await request(app)
        .delete(`/pumps/${pumpId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(delRes.status).toBe(200);

      // Verify field's pumpId was unlinked
      const updatedField = await FieldModel.findById(fieldId);
      expect(updatedField?.pumpId).toBeNull();

      // Verify recommendations now reflect pumpMissing = true
      const recs = (
        await request(app)
          .get(`/fields/${fieldId}/recommendations`)
          .set('Authorization', `Bearer ${token}`)
      ).body.data.recommendations;
      expect(recs[0].pumpMissing).toBe(true);
      expect(recs[0].runMinutes).toBeNull();
    });
  });
});
