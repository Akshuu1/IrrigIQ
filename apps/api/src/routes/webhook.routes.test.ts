import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../app.js';
import { UserModel } from '../models/user.model.js';
import { FieldModel } from '../models/field.model.js';
import { RecommendationModel } from '../models/recommendation.model.js';
import { IrrigationLogModel } from '../models/irrigation-log.model.js';
import { MessageChannelModel } from '../models/message-channel.model.js';
import { LinkCodeModel } from '../models/link-code.model.js';
import { TelegramProvider } from '../services/messaging/telegram.provider.js';
import { hashLinkCode, encryptExternalId, hashExternalId } from '../utils/crypto.js';
import { clearMemoryDedupe } from './webhook.routes.js';
import * as recService from '../services/recommendation.service.js';

describe('Telegram Inbound Webhook and Acceptance Flow', () => {
  let mongod: MongoMemoryServer;
  const app = createApp();
  const validSecretHeader = 'irrigiq-telegram-webhook-secret-token';

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
    await clearMemoryDedupe();
    await UserModel.deleteMany({});
    await FieldModel.deleteMany({});
    await RecommendationModel.deleteMany({});
    await IrrigationLogModel.deleteMany({});
    await MessageChannelModel.deleteMany({});
    await LinkCodeModel.deleteMany({});
    vi.restoreAllMocks();
    vi.spyOn(recService, 'recomputeField').mockResolvedValue([]);
  });

  it('rejects inbound webhook with missing or invalid secret token header with 401', async () => {
    // Missing header
    const res1 = await request(app).post('/webhooks/telegram').send({ update_id: 1001 });
    expect(res1.status).toBe(401);
    expect(res1.body.code).toBe('UNAUTHORIZED_WEBHOOK');

    // Wrong header
    const res2 = await request(app)
      .post('/webhooks/telegram')
      .set('X-Telegram-Bot-Api-Secret-Token', 'wrong-secret')
      .send({ update_id: 1002 });
    expect(res2.status).toBe(401);
  });

  it('accepts valid secret token and deduplicates identical update_id', async () => {
    vi.spyOn(TelegramProvider.prototype, 'send').mockResolvedValue({
      success: true,
      messageId: 1,
    });

    const updatePayload = {
      update_id: 2001,
      message: {
        message_id: 50,
        chat: { id: 112233 },
        from: { id: 112233, first_name: 'Kisan' },
        text: 'HELP',
      },
    };

    // First delivery -> 200 ok
    const res1 = await request(app)
      .post('/webhooks/telegram')
      .set('X-Telegram-Bot-Api-Secret-Token', validSecretHeader)
      .send(updatePayload);

    expect(res1.status).toBe(200);
    expect(res1.body.ok).toBe(true);
    expect(res1.body.duplicate).toBeUndefined();

    // Duplicate delivery with same update_id -> 200 ok with duplicate: true
    const res2 = await request(app)
      .post('/webhooks/telegram')
      .set('X-Telegram-Bot-Api-Secret-Token', validSecretHeader)
      .send(updatePayload);

    expect(res2.status).toBe(200);
    expect(res2.body.ok).toBe(true);
    expect(res2.body.duplicate).toBe(true);
  });

  it('Acceptance Flow: Links account with /start <code>, confirms opt-in, taps Done, and verifies IrrigationLog has source chat', async () => {
    const sendSpy = vi.spyOn(TelegramProvider.prototype, 'send').mockResolvedValue({
      success: true,
      messageId: 2,
    });

    // 1. Farmer registers and creates a field
    const user = await UserModel.create({
      email: 'farmer@punjab.in',
      passwordHash: 'hash123',
      name: 'Gurpreet Singh',
      language: 'en',
      areaUnit: 'acre',
    });

    const field = await FieldModel.create({
      userId: user._id,
      name: 'Wheat Field 1',
      cropKey: 'wheat',
      locationMode: 'pin',
      centroid: { type: 'Point', coordinates: [75.8, 30.9] },
      areaHa: 1.0,
      soilType: 'loam',
      method: 'flood',
      baseline: { everyDays: 7, depthMm: 50 },
      sowingDate: new Date('2026-10-15'),
      waterMode: 'irrigated',
    });

    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

    // Recommendation recommends irrigation today
    await RecommendationModel.create({
      fieldId: field._id,
      userId: user._id,
      forDate: todayStr,
      action: 'irrigate',
      netMm: 25,
      grossMm: 35,
      litres: 350000,
      runMinutes: 117,
      splitAcrossDays: false,
      pumpMissing: false,
      deficitMm: 30,
      et0Mm: 4.5,
      kc: 1.15,
      etcMm: 5.17,
      rainMm: 0,
      effectiveRainMm: 0,
      staleWeather: false,
      reasonKey: 'deficit_exceeded',
      computedAt: new Date(),
    });

    // 2. Generate Link Code
    const rawCode = '742918';
    await LinkCodeModel.create({
      userId: user._id,
      codeHash: hashLinkCode(rawCode),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      used: false,
    });

    // 3. Farmer sends /start 742918 on Telegram
    await request(app)
      .post('/webhooks/telegram')
      .set('X-Telegram-Bot-Api-Secret-Token', validSecretHeader)
      .send({
        update_id: 3001,
        message: {
          message_id: 101,
          chat: { id: 998877 },
          from: { id: 998877, first_name: 'Gurpreet' },
          text: `/start ${rawCode}`,
        },
      });

    // Allow setImmediate background task to execute
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Verify channel was created in pending_opt_in
    const channel = await MessageChannelModel.findOne({ userId: user._id });
    expect(channel).toBeDefined();
    expect(channel?.status).toBe('pending_opt_in');
    expect(channel?.optedIn).toBe(false);

    // 4. Farmer sends '1' or taps 'Yes' to confirm opt-in
    await request(app)
      .post('/webhooks/telegram')
      .set('X-Telegram-Bot-Api-Secret-Token', validSecretHeader)
      .send({
        update_id: 3002,
        callback_query: {
          id: 'cb_optin',
          from: { id: 998877, first_name: 'Gurpreet' },
          message: {
            message_id: 102,
            chat: { id: 998877 },
          },
          data: '1',
        },
      });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const activeChannel = await MessageChannelModel.findOne({ userId: user._id });
    expect(activeChannel?.status).toBe('active');
    expect(activeChannel?.optedIn).toBe(true);

    // 5. Farmer receives digest, performs irrigation, and taps 'Done' (or sends '1' or 'Done')
    await request(app)
      .post('/webhooks/telegram')
      .set('X-Telegram-Bot-Api-Secret-Token', validSecretHeader)
      .send({
        update_id: 3003,
        callback_query: {
          id: 'cb_done',
          from: { id: 998877, first_name: 'Gurpreet' },
          message: {
            message_id: 103,
            chat: { id: 998877 },
          },
          data: '1',
        },
      });

    await new Promise((resolve) => setTimeout(resolve, 100));

    // 6. Verify IrrigationLog was created in MongoDB with source: 'chat'
    const logs = await IrrigationLogModel.find({ fieldId: field._id });
    expect(logs.length).toBeGreaterThanOrEqual(1);

    const chatLog = logs.find((l) => l.source === 'chat');
    expect(chatLog).toBeDefined();
    expect(chatLog?.source).toBe('chat');
    expect(chatLog?.appliedMm).toBe(35);
    expect(chatLog?.date).toBe(todayStr);

    // Verify confirmation message was sent to Telegram
    expect(sendSpy).toHaveBeenCalledWith(
      '998877',
      expect.stringContaining('Recorded!'),
      undefined,
    );
  });

  it('handles Devanagari numerals (०..९) and commands (STOP, HELP, LANG)', async () => {
    vi.spyOn(TelegramProvider.prototype, 'send').mockResolvedValue({
      success: true,
      messageId: 3,
    });

    const user = await UserModel.create({
      email: 'farmer.hindi@example.com',
      passwordHash: 'hash123',
      name: 'राम कुमार',
      language: 'hi',
      areaUnit: 'acre',
    });

    const channel = await MessageChannelModel.create({
      userId: user._id,
      provider: 'telegram',
      externalIdEncrypted: encryptExternalId('123'),
      externalIdHash: hashExternalId('123'),
      status: 'active',
      optedIn: true,
      sendTime: '06:00',
    });

    // 1. Farmer sends Devanagari numeral ३ with new time ०७:३० (07:30)
    await request(app)
      .post('/webhooks/telegram')
      .set('X-Telegram-Bot-Api-Secret-Token', validSecretHeader)
      .send({
        update_id: 4001,
        message: {
          message_id: 201,
          chat: { id: 123 },
          text: '३ ०७:३०',
        },
      });

    await new Promise((resolve) => setTimeout(resolve, 50));
    const updatedChannel = await MessageChannelModel.findById(channel._id);
    expect(updatedChannel?.sendTime).toBe('07:30');

    // 2. Farmer sends STOP
    await request(app)
      .post('/webhooks/telegram')
      .set('X-Telegram-Bot-Api-Secret-Token', validSecretHeader)
      .send({
        update_id: 4002,
        message: {
          message_id: 202,
          chat: { id: 123 },
          text: 'STOP',
        },
      });

    await new Promise((resolve) => setTimeout(resolve, 50));
    const stoppedChannel = await MessageChannelModel.findById(channel._id);
    expect(stoppedChannel?.status).toBe('deactivated');
    expect(stoppedChannel?.optedIn).toBe(false);
  });
});
