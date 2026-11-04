import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../app.js';
import { UserModel } from '../models/user.model.js';
import { RefreshTokenModel } from '../models/refreshToken.model.js';
import { MessageChannelModel } from '../models/message-channel.model.js';
import { LinkCodeModel } from '../models/link-code.model.js';
import { encryptExternalId, hashExternalId } from '../utils/crypto.js';
import { TelegramProvider } from '../services/messaging/telegram.provider.js';

describe('Messaging Routes Integration Tests', () => {
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
    await MessageChannelModel.deleteMany({});
    await LinkCodeModel.deleteMany({});
    vi.restoreAllMocks();
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

  it('POST /messaging/link-code generates a 6-digit link code and Telegram deep link', async () => {
    const { token } = await createTestUser();

    const res = await request(app)
      .post('/messaging/link-code')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('success');
    expect(res.body.data.code).toMatch(/^\d{6}$/);
    expect(res.body.data.deepLink).toContain(`start=${res.body.data.code}`);
    expect(res.body.data.expiresAt).toBeDefined();

    // Verify stored hashed code in MongoDB
    const codes = await LinkCodeModel.find({});
    expect(codes).toHaveLength(1);
    expect(codes[0]!.used).toBe(false);
  });

  it('GET /messaging/channel returns null when user has no channel, and returns channel when present', async () => {
    const { token, user } = await createTestUser();

    // No channel yet
    const res1 = await request(app)
      .get('/messaging/channel')
      .set('Authorization', `Bearer ${token}`);
    expect(res1.status).toBe(200);
    expect(res1.body.data).toBeNull();

    // Create channel
    await MessageChannelModel.create({
      userId: user.id,
      provider: 'telegram',
      externalIdEncrypted: encryptExternalId('998877'),
      externalIdHash: hashExternalId('998877'),
      status: 'active',
      optedIn: true,
      sendTime: '06:45',
    });

    const res2 = await request(app)
      .get('/messaging/channel')
      .set('Authorization', `Bearer ${token}`);
    expect(res2.status).toBe(200);
    expect(res2.body.data.status).toBe('active');
    expect(res2.body.data.sendTime).toBe('06:45');
    // Ensure encrypted ID and hash are NEVER exposed in JSON
    expect(res2.body.data.externalIdEncrypted).toBeUndefined();
    expect(res2.body.data.externalIdHash).toBeUndefined();
  });

  it('PATCH /messaging/channel updates send time, quiet hours, and daily cap', async () => {
    const { token, user } = await createTestUser();

    await MessageChannelModel.create({
      userId: user.id,
      provider: 'telegram',
      externalIdEncrypted: encryptExternalId('998877'),
      externalIdHash: hashExternalId('998877'),
      status: 'active',
      optedIn: true,
      sendTime: '06:00',
    });

    const res = await request(app)
      .patch('/messaging/channel')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sendTime: '07:15',
        quietHours: { start: '23:00', end: '05:00' },
        dailyCap: 5,
      });

    expect(res.status).toBe(200);
    expect(res.body.data.sendTime).toBe('07:15');
    expect(res.body.data.quietHours).toEqual({ start: '23:00', end: '05:00' });
    expect(res.body.data.dailyCap).toBe(5);

    const updated = await MessageChannelModel.findOne({ userId: user.id });
    expect(updated?.sendTime).toBe('07:15');
    expect(updated?.dailyCap).toBe(5);
  });

  it('DELETE /messaging/channel removes user channel and pending link codes', async () => {
    const { token, user } = await createTestUser();

    await MessageChannelModel.create({
      userId: user.id,
      provider: 'telegram',
      externalIdEncrypted: encryptExternalId('998877'),
      externalIdHash: hashExternalId('998877'),
      status: 'active',
      optedIn: true,
    });

    await LinkCodeModel.create({
      userId: user.id,
      codeHash: 'samplehash',
      expiresAt: new Date(Date.now() + 60000),
      used: false,
    });

    const res = await request(app)
      .delete('/messaging/channel')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const channels = await MessageChannelModel.find({ userId: user.id });
    const codes = await LinkCodeModel.find({ userId: user.id });
    expect(channels).toHaveLength(0);
    expect(codes).toHaveLength(0);
  });

  it('POST /messaging/test-message sends test advisory to active channel', async () => {
    const { token, user } = await createTestUser();

    await MessageChannelModel.create({
      userId: user.id,
      provider: 'telegram',
      externalIdEncrypted: encryptExternalId('998877'),
      externalIdHash: hashExternalId('998877'),
      status: 'active',
      optedIn: true,
    });

    // Mock telegram send
    vi.spyOn(TelegramProvider.prototype, 'send').mockResolvedValue({
      success: true,
      messageId: 888,
    });

    const res = await request(app)
      .post('/messaging/test-message')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('Test message sent');
  });
});
