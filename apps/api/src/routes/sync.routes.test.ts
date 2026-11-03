import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../app.js';
import { UserModel } from '../models/user.model.js';
import { FieldModel } from '../models/field.model.js';
import { IrrigationLogModel } from '../models/irrigation-log.model.js';
import { SyncRecord } from '../models/sync-record.model.js';
import { SyncMutation } from '@irrigiq/shared';

describe('Offline Sync Batch API Integration Tests (/sync)', () => {
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
    await SyncRecord.syncIndexes();
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
    await IrrigationLogModel.deleteMany({});
    await SyncRecord.deleteMany({});
  });

  async function createTestUser(email = 'farmer@example.com') {
    const res = await request(app).post('/auth/register').send({
      email,
      password: 'Password123!',
      name: 'Ramesh Patel',
      language: 'en',
      areaUnit: 'acre',
    });
    return {
      token: res.body.data.accessToken as string,
      user: res.body.data.user,
    };
  }

  async function createTestField(token: string) {
    const res = await request(app)
      .post('/fields')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Wheat North Field',
        cropKey: 'wheat',
        sowingDate: '2026-10-01',
        soilType: 'loam',
        method: 'drip',
        baseline: { everyDays: 5, depthMm: 25 },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [77.1, 28.5],
              [77.11, 28.5],
              [77.11, 28.51],
              [77.1, 28.51],
              [77.1, 28.5],
            ],
          ],
        },
      });
    return res.body.data.field;
  }

  it('successfully syncs an offline irrigation log mutation', async () => {
    const { token } = await createTestUser();
    const field = await createTestField(token);

    const mutation: SyncMutation = {
      clientId: 'mut-irrigation-001',
      type: 'create_irrigation_log',
      fieldId: field.id,
      payload: {
        date: '2026-10-15',
        appliedMm: 22,
        source: 'manual',
        note: 'Applied extra water due to warm afternoon',
      },
      timestamp: Date.now(),
    };

    const res = await request(app)
      .post('/sync')
      .set('Authorization', `Bearer ${token}`)
      .send({ mutations: [mutation] });

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].clientId).toBe('mut-irrigation-001');
    expect(res.body.results[0].status).toBe('applied');
    expect(res.body.results[0].appliedLog).toBeDefined();
    expect(res.body.results[0].appliedLog.appliedMm).toBe(22);

    // Verify persisted in database
    const logs = await IrrigationLogModel.find({ fieldId: field.id });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.appliedMm).toBe(22);
  });

  it('successfully syncs an offline field edit with matching baseVersion', async () => {
    const { token } = await createTestUser();
    const field = await createTestField(token);
    expect(field.version).toBe(1);

    const mutation: SyncMutation = {
      clientId: 'mut-field-edit-001',
      type: 'update_field',
      fieldId: field.id,
      baseVersion: 1,
      payload: {
        name: 'Wheat North Field Updated',
        soilType: 'clay',
      },
      timestamp: Date.now(),
    };

    const res = await request(app)
      .post('/sync')
      .set('Authorization', `Bearer ${token}`)
      .send({ mutations: [mutation] });

    expect(res.status).toBe(200);
    expect(res.body.results[0].clientId).toBe('mut-field-edit-001');
    expect(res.body.results[0].status).toBe('applied');
    expect(res.body.results[0].serverVersion).toBe(2);

    // Verify field updated in DB
    const updated = await FieldModel.findById(field.id);
    expect(updated?.name).toBe('Wheat North Field Updated');
    expect(updated?.soilType).toBe('clay');
    expect(updated?.version).toBe(2);
  });

  it('guarantees idempotency when re-sending the same batch', async () => {
    const { token } = await createTestUser();
    const field = await createTestField(token);

    const mutation: SyncMutation = {
      clientId: 'mut-idempotency-001',
      type: 'create_irrigation_log',
      fieldId: field.id,
      payload: {
        date: '2026-10-18',
        appliedMm: 15,
        source: 'recommended',
      },
      timestamp: Date.now(),
    };

    // First call
    const res1 = await request(app)
      .post('/sync')
      .set('Authorization', `Bearer ${token}`)
      .send({ mutations: [mutation] });

    expect(res1.status).toBe(200);
    expect(res1.body.results[0].status).toBe('applied');

    // Second call with same mutation clientId
    const res2 = await request(app)
      .post('/sync')
      .set('Authorization', `Bearer ${token}`)
      .send({ mutations: [mutation] });

    expect(res2.status).toBe(200);
    expect(res2.body.results[0].status).toBe('applied');
    expect(res2.body.results[0].clientId).toBe(mutation.clientId);

    // Database must have exactly ONE log, not two!
    const logs = await IrrigationLogModel.find({ fieldId: field.id });
    expect(logs).toHaveLength(1);
  });

  it('detects version conflict if server version is newer than baseVersion', async () => {
    const { token } = await createTestUser();
    const field = await createTestField(token);

    // Directly update field on server so it advances to version 2
    await request(app)
      .patch(`/fields/${field.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ version: 1, name: 'Server Update' });

    const serverField = await FieldModel.findById(field.id);
    expect(serverField?.version).toBe(2);

    // Now an offline client with baseVersion 1 attempts to sync an update
    const conflictMutation: SyncMutation = {
      clientId: 'mut-conflict-001',
      type: 'update_field',
      fieldId: field.id,
      baseVersion: 1, // Stale!
      payload: {
        name: 'Offline Edit That Should Conflict',
      },
      timestamp: Date.now(),
    };

    const res = await request(app)
      .post('/sync')
      .set('Authorization', `Bearer ${token}`)
      .send({ mutations: [conflictMutation] });

    expect(res.status).toBe(200);
    expect(res.body.results[0].status).toBe('conflict');
    expect(res.body.results[0].serverVersion).toBe(2);
    expect(res.body.results[0].serverField).toBeDefined();

    // Field in database remains the server version
    const after = await FieldModel.findById(field.id);
    expect(after?.name).toBe('Server Update');
    expect(after?.version).toBe(2);
  });

  it('enforces multi-tenant ownership: cannot sync another user field', async () => {
    const userA = await createTestUser('farmerA@example.com');
    const userB = await createTestUser('farmerB@example.com');

    const fieldA = await createTestField(userA.token);

    // User B tries to sync an irrigation log on User A's field
    const maliciousMutation: SyncMutation = {
      clientId: 'mut-unauth-001',
      type: 'create_irrigation_log',
      fieldId: fieldA.id,
      payload: {
        date: '2026-10-20',
        appliedMm: 50,
      },
      timestamp: Date.now(),
    };

    const res = await request(app)
      .post('/sync')
      .set('Authorization', `Bearer ${userB.token}`)
      .send({ mutations: [maliciousMutation] });

    expect(res.status).toBe(200);
    expect(res.body.results[0].status).toBe('error');
    expect(res.body.results[0].error).toContain('Field not found');

    // No log created
    const logs = await IrrigationLogModel.find({ fieldId: fieldA.id });
    expect(logs).toHaveLength(0);
  });
});
