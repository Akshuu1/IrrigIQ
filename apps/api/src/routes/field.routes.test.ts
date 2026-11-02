import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import * as turf from '@turf/turf';
import { createApp } from '../app.js';
import { UserModel } from '../models/user.model.js';
import { RefreshTokenModel } from '../models/refreshToken.model.js';
import { FieldModel } from '../models/field.model.js';

describe('Fields and Crops Integration Tests (MongoDB 7+)', () => {
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
    await FieldModel.syncIndexes();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongod) {
      await mongod.stop();
    }
  });

  beforeEach(async () => {
    await UserModel.deleteMany({});
    await RefreshTokenModel.deleteMany({});
    await FieldModel.deleteMany({});
  });

  // Helper to register user and obtain bearer token
  async function createTestUser(email = 'farmer@example.com') {
    const res = await request(app)
      .post('/auth/register')
      .send({
        email,
        password: 'Password123!',
        name: 'Test Farmer',
        language: 'en',
        areaUnit: 'acre',
      });
    return {
      token: res.body.data.accessToken as string,
      user: res.body.data.user,
    };
  }

  // 100m x 100m known square in Rajasthan (0.01 km2 = 1.0 ha)
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

  const validFieldPayload = {
    name: 'Khasra 42 North',
    geometry: validSquarePolygon,
    cropKey: 'wheat',
    sowingDate: new Date().toISOString(),
    soilType: 'loam',
    method: 'drip',
    baseline: {
      everyDays: 5,
      depthMm: 30,
    },
  };

  describe('GET /crops', () => {
    it('returns list of supported crops without authentication', async () => {
      const res = await request(app).get('/crops');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(Array.isArray(res.body.data.crops)).toBe(true);
      expect(res.body.data.crops.length).toBeGreaterThanOrEqual(8);
      const wheat = res.body.data.crops.find((c: { key: string }) => c.key === 'wheat');
      expect(wheat).toBeDefined();
      expect(wheat.nameEn).toBe('Wheat');
      expect(wheat.nameHi).toBe('गेहूं');
      expect(wheat.kc).toHaveProperty('ini');
      expect(wheat.kc).toHaveProperty('mid');
      expect(wheat.kc).toHaveProperty('end');
    });
  });

  describe('POST /fields (Creation & Geometry Validation)', () => {
    it('creates a field, computes areaHa and centroid on server, and ignores any spoofed values', async () => {
      const { token } = await createTestUser();

      const spoofedPayload = {
        ...validFieldPayload,
        areaHa: 99999, // client attempt to fake area
        centroid: { type: 'Point', coordinates: [0, 0] }, // client attempt to fake centroid
      };

      const res = await request(app)
        .post('/fields')
        .set('Authorization', `Bearer ${token}`)
        .send(spoofedPayload);

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      const field = res.body.data.field;
      expect(field).toBeDefined();
      expect(field.id).toBeDefined();
      expect(field.name).toBe('Khasra 42 North');
      expect(field.version).toBe(1);

      // Area matches known rectangle within 1% (1.0 ha)
      expect(field.areaHa).toBeGreaterThanOrEqual(0.99);
      expect(field.areaHa).toBeLessThanOrEqual(1.01);

      // Centroid is computed on server
      expect(field.centroid.type).toBe('Point');
      expect(field.centroid.coordinates[0]).toBeCloseTo(75.8, 2);
      expect(field.centroid.coordinates[1]).toBeCloseTo(26.9, 2);
    });

    it('area matches a known rectangle within 1 percent', async () => {
      const { token } = await createTestUser();
      const res = await request(app)
        .post('/fields')
        .set('Authorization', `Bearer ${token}`)
        .send(validFieldPayload);

      expect(res.status).toBe(201);
      const area = res.body.data.field.areaHa;
      expect(area).toBeGreaterThanOrEqual(0.99);
      expect(area).toBeLessThanOrEqual(1.01);
    });

    it('rejects self-intersecting polygon (bowtie) with 400', async () => {
      const { token } = await createTestUser();
      const bowtiePolygon = {
        type: 'Polygon',
        coordinates: [
          [
            [75.0, 20.0],
            [75.02, 20.02],
            [75.02, 20.0],
            [75.0, 20.02],
            [75.0, 20.0],
          ],
        ],
      };

      const res = await request(app)
        .post('/fields')
        .set('Authorization', `Bearer ${token}`)
        .send({
          ...validFieldPayload,
          geometry: bowtiePolygon,
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_GEOMETRY');
      expect(res.body.message).toMatch(/self-intersecting|kinks/i);
    });

    it('rejects polygon outside India bounding box with 400', async () => {
      const { token } = await createTestUser();
      const londonPolygon = {
        type: 'Polygon',
        coordinates: [
          [
            [-0.12, 51.5],
            [-0.11, 51.5],
            [-0.11, 51.51],
            [-0.12, 51.51],
            [-0.12, 51.5],
          ],
        ],
      };

      const res = await request(app)
        .post('/fields')
        .set('Authorization', `Bearer ${token}`)
        .send({
          ...validFieldPayload,
          geometry: londonPolygon,
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_GEOMETRY');
      expect(res.body.message).toMatch(/outside India's bounding box/i);
    });

    it('rejects polygon that is too small (< 0.01 ha) with 400', async () => {
      const { token } = await createTestUser();
      const tinyOrigin = turf.point([75.8, 26.9]);
      const p1 = turf.destination(tinyOrigin, 0.002, 90, { units: 'kilometers' });
      const p2 = turf.destination(p1, 0.002, 0, { units: 'kilometers' });
      const p3 = turf.destination(tinyOrigin, 0.002, 0, { units: 'kilometers' });

      const tinyPolygon = {
        type: 'Polygon',
        coordinates: [
          [
            tinyOrigin.geometry.coordinates,
            p1.geometry.coordinates,
            p2.geometry.coordinates,
            p3.geometry.coordinates,
            tinyOrigin.geometry.coordinates,
          ],
        ],
      };

      const res = await request(app)
        .post('/fields')
        .set('Authorization', `Bearer ${token}`)
        .send({
          ...validFieldPayload,
          geometry: tinyPolygon,
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_GEOMETRY');
      expect(res.body.message).toMatch(/below the minimum allowed 0.01 ha/i);
    });

    it('rejects polygon that is too large (> 500 ha) with 400', async () => {
      const { token } = await createTestUser();
      const hugeOrigin = turf.point([75.8, 26.9]);
      const p1 = turf.destination(hugeOrigin, 3.0, 90, { units: 'kilometers' });
      const p2 = turf.destination(p1, 3.0, 0, { units: 'kilometers' });
      const p3 = turf.destination(hugeOrigin, 3.0, 0, { units: 'kilometers' });

      const hugePolygon = {
        type: 'Polygon',
        coordinates: [
          [
            hugeOrigin.geometry.coordinates,
            p1.geometry.coordinates,
            p2.geometry.coordinates,
            p3.geometry.coordinates,
            hugeOrigin.geometry.coordinates,
          ],
        ],
      };

      const res = await request(app)
        .post('/fields')
        .set('Authorization', `Bearer ${token}`)
        .send({
          ...validFieldPayload,
          geometry: hugePolygon,
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_GEOMETRY');
      expect(res.body.message).toMatch(/exceeds the maximum allowed 500 ha/i);
    });

    it('rejects polygon with over 100 vertices with 400', async () => {
      const { token } = await createTestUser();
      const circle = turf.circle([75.8, 26.9], 0.2, { steps: 102, units: 'kilometers' });
      const res = await request(app)
        .post('/fields')
        .set('Authorization', `Bearer ${token}`)
        .send({
          ...validFieldPayload,
          geometry: {
            type: 'Polygon',
            coordinates: circle.geometry.coordinates,
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_GEOMETRY');
      expect(res.body.message).toMatch(/too many vertices/i);
    });

    it('rejects invalid cropKey not in seed data with 400', async () => {
      const { token } = await createTestUser();
      const res = await request(app)
        .post('/fields')
        .set('Authorization', `Bearer ${token}`)
        .send({
          ...validFieldPayload,
          cropKey: 'pineapples_not_in_seed',
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects sowingDate more than 30 days in future with 400', async () => {
      const { token } = await createTestUser();
      const farFutureDate = new Date();
      farFutureDate.setDate(farFutureDate.getDate() + 35);

      const res = await request(app)
        .post('/fields')
        .set('Authorization', `Bearer ${token}`)
        .send({
          ...validFieldPayload,
          sowingDate: farFutureDate.toISOString(),
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('PATCH /fields/:id (Optimistic Concurrency Control)', () => {
    it('increments version on update and rejects stale version with 409', async () => {
      const { token } = await createTestUser();

      // Create initial field (version 1)
      const createRes = await request(app)
        .post('/fields')
        .set('Authorization', `Bearer ${token}`)
        .send(validFieldPayload);

      const fieldId = createRes.body.data.field.id;
      expect(createRes.body.data.field.version).toBe(1);

      // First update with matching version 1
      const updateRes1 = await request(app)
        .patch(`/fields/${fieldId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          version: 1,
          name: 'Updated Name Phase 4',
        });

      expect(updateRes1.status).toBe(200);
      expect(updateRes1.body.data.field.version).toBe(2);
      expect(updateRes1.body.data.field.name).toBe('Updated Name Phase 4');

      // Stale update using old version 1 -> Must return 409 Conflict
      const staleRes = await request(app)
        .patch(`/fields/${fieldId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          version: 1,
          name: 'Stale Attempt',
        });

      expect(staleRes.status).toBe(409);
      expect(staleRes.body.code).toBe('VERSION_CONFLICT');

      // Updating with correct version 2 succeeds and increments to 3
      const updateRes2 = await request(app)
        .patch(`/fields/${fieldId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          version: 2,
          method: 'sprinkler',
        });

      expect(updateRes2.status).toBe(200);
      expect(updateRes2.body.data.field.version).toBe(3);
      expect(updateRes2.body.data.field.method).toBe('sprinkler');
    });
  });

  describe('User Isolation (Multi-tenant Ownership)', () => {
    it('user B cannot read, edit, or delete user A field', async () => {
      const userA = await createTestUser('farmerA@example.com');
      const userB = await createTestUser('farmerB@example.com');

      // User A creates field
      const createRes = await request(app)
        .post('/fields')
        .set('Authorization', `Bearer ${userA.token}`)
        .send(validFieldPayload);

      const fieldAId = createRes.body.data.field.id;

      // User B attempts to read User A's field
      const readRes = await request(app)
        .get(`/fields/${fieldAId}`)
        .set('Authorization', `Bearer ${userB.token}`);
      expect(readRes.status).toBe(404);

      // User B attempts to edit User A's field
      const editRes = await request(app)
        .patch(`/fields/${fieldAId}`)
        .set('Authorization', `Bearer ${userB.token}`)
        .send({
          version: 1,
          name: 'Malicious Change',
        });
      expect(editRes.status).toBe(404);

      // User B attempts to delete User A's field
      const deleteRes = await request(app)
        .delete(`/fields/${fieldAId}`)
        .set('Authorization', `Bearer ${userB.token}`);
      expect(deleteRes.status).toBe(404);

      // User B's list does NOT contain User A's field
      const listBRes = await request(app)
        .get('/fields')
        .set('Authorization', `Bearer ${userB.token}`);
      expect(listBRes.status).toBe(200);
      expect(listBRes.body.data.fields).toHaveLength(0);

      // User A's field is intact
      const listARes = await request(app)
        .get('/fields')
        .set('Authorization', `Bearer ${userA.token}`);
      expect(listARes.status).toBe(200);
      expect(listARes.body.data.fields).toHaveLength(1);
      expect(listARes.body.data.fields[0].id).toBe(fieldAId);
    });

    it('allows User A to delete their own field', async () => {
      const userA = await createTestUser('delete_test@example.com');
      const createRes = await request(app)
        .post('/fields')
        .set('Authorization', `Bearer ${userA.token}`)
        .send(validFieldPayload);

      const fieldId = createRes.body.data.field.id;

      const deleteRes = await request(app)
        .delete(`/fields/${fieldId}`)
        .set('Authorization', `Bearer ${userA.token}`);
      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.message).toMatch(/deleted successfully/i);

      // Subsequent read returns 404
      const readRes = await request(app)
        .get(`/fields/${fieldId}`)
        .set('Authorization', `Bearer ${userA.token}`);
      expect(readRes.status).toBe(404);
    });
  });

  describe('GET /fields/nearby (Geospatial & Ownership Filtering)', () => {
    it('returns only own fields within radius and excludes another user fields at the exact same location', async () => {
      const userA = await createTestUser('nearby_a@example.com');
      const userB = await createTestUser('nearby_b@example.com');

      // User A creates field near Jaipur (75.8, 26.9)
      const fieldARes = await request(app)
        .post('/fields')
        .set('Authorization', `Bearer ${userA.token}`)
        .send({
          ...validFieldPayload,
          name: 'User A Jaipur Field',
        });
      const fieldAId = fieldARes.body.data.field.id;

      // User B creates field at the exact same location
      await request(app)
        .post('/fields')
        .set('Authorization', `Bearer ${userB.token}`)
        .send({
          ...validFieldPayload,
          name: 'User B Jaipur Field',
        });

      // User A queries nearby within 5 km of Jaipur center (75.8, 26.9)
      const nearbyResA = await request(app)
        .get('/fields/nearby?lng=75.8&lat=26.9&km=5')
        .set('Authorization', `Bearer ${userA.token}`);

      expect(nearbyResA.status).toBe(200);
      expect(nearbyResA.body.data.fields).toHaveLength(1);
      expect(nearbyResA.body.data.fields[0].id).toBe(fieldAId);
      expect(nearbyResA.body.data.fields[0].name).toBe('User A Jaipur Field');

      // User A queries a faraway location (Delhi: ~240 km away) with 5 km radius -> Should return 0
      const nearbyDelhi = await request(app)
        .get('/fields/nearby?lng=77.2&lat=28.6&km=5')
        .set('Authorization', `Bearer ${userA.token}`);

      expect(nearbyDelhi.status).toBe(200);
      expect(nearbyDelhi.body.data.fields).toHaveLength(0);

      // Queries with radius > 50 km are rejected with 400
      const invalidRadiusRes = await request(app)
        .get('/fields/nearby?lng=75.8&lat=26.9&km=60')
        .set('Authorization', `Bearer ${userA.token}`);

      expect(invalidRadiusRes.status).toBe(400);
      expect(invalidRadiusRes.body.code).toBe('VALIDATION_ERROR');
    });
  });
});
