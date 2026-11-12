import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../app.js';
import { UserModel } from '../models/user.model.js';
import { RefreshTokenModel } from '../models/refreshToken.model.js';
import { FieldModel } from '../models/field.model.js';
import { PumpModel } from '../models/pump.model.js';
import { MessageChannelModel } from '../models/message-channel.model.js';
import { IrrigationLogModel } from '../models/irrigation-log.model.js';
import { RecommendationModel } from '../models/recommendation.model.js';
import { LinkCodeModel } from '../models/link-code.model.js';
import { SensorModel } from '../models/sensor.model.js';
import { SensorReadingModel } from '../models/sensor-reading.model.js';
import { ReportModel } from '../models/report.model.js';
import { PowerScheduleModel } from '../models/powerSchedule.model.js';
import { InboundMessageModel } from '../models/inbound-message.model.js';
import { OutboundMessageModel } from '../models/outbound-message.model.js';
import { PushSubscriptionModel } from '../models/push-subscription.model.js';

describe('Auth Integration Tests (MongoDB 7+)', () => {
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
  });

  const extractCookie = (res: request.Response, cookieName: string): string => {
    const cookies = res.headers['set-cookie'];
    if (!cookies) return '';
    const cookieArray = Array.isArray(cookies) ? cookies : [cookies];
    for (const cookie of cookieArray) {
      if (cookie.startsWith(`${cookieName}=`)) {
        return cookie.split(';')[0]?.replace(`${cookieName}=`, '') || '';
      }
    }
    return '';
  };

  describe('POST /auth/register', () => {
    it('successfully registers a user, sets httpOnly cookie, and NEVER returns passwordHash', async () => {
      const payload = {
        email: 'ramesh@example.com',
        password: 'Password123!',
        name: 'Ramesh Patel',
        language: 'hi',
        areaUnit: 'acre',
      };

      const res = await request(app).post('/auth/register').send(payload);

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.user).toBeDefined();
      expect(res.body.data.user.email).toBe('ramesh@example.com');
      expect(res.body.data.user.name).toBe('Ramesh Patel');
      expect(res.body.data.user.language).toBe('hi');
      expect(res.body.data.user.areaUnit).toBe('acre');
      expect(res.body.data.accessToken).toBeDefined();

      // STRICT CHECK: passwordHash must NEVER be returned in response
      expect(res.body.data.user.passwordHash).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain('passwordHash');

      // Verify httpOnly cookie
      const rawCookies = res.headers['set-cookie'];
      expect(rawCookies).toBeDefined();
      const cookieStr = Array.isArray(rawCookies) ? rawCookies.join('; ') : rawCookies;
      expect(cookieStr).toContain('refreshToken=');
      expect(cookieStr).toContain('HttpOnly');
      expect(cookieStr).toContain('SameSite=Strict');

      // Verify user in database
      const userInDb = await UserModel.findOne({ email: 'ramesh@example.com' });
      expect(userInDb).not.toBeNull();
      expect(userInDb?.passwordHash).toBeDefined();
      expect(userInDb?.passwordHash).not.toBe('Password123!');
      expect(
        userInDb?.passwordHash.startsWith('$2b$12$') ||
          userInDb?.passwordHash.startsWith('$2a$12$'),
      ).toBe(true);
    });

    it('rejects duplicate email registration with 409 Conflict', async () => {
      const payload = {
        email: 'farmer@example.com',
        password: 'StrongPassword123',
        name: 'Suresh Kumar',
      };

      await request(app).post('/auth/register').send(payload);
      const duplicateRes = await request(app).post('/auth/register').send(payload);

      expect(duplicateRes.status).toBe(409);
      expect(duplicateRes.body).toMatchObject({
        status: 'error',
        code: 'EMAIL_EXISTS',
      });
    });

    it('validates minimum password length and invalid emails', async () => {
      const shortPassRes = await request(app).post('/auth/register').send({
        email: 'valid@example.com',
        password: '123',
        name: 'Test Farmer',
      });
      expect(shortPassRes.status).toBe(400);
      expect(shortPassRes.body.code).toBe('VALIDATION_ERROR');

      const invalidEmailRes = await request(app).post('/auth/register').send({
        email: 'not-an-email',
        password: 'ValidPassword123',
        name: 'Test Farmer',
      });
      expect(invalidEmailRes.status).toBe(400);
      expect(invalidEmailRes.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /auth/login', () => {
    beforeEach(async () => {
      await request(app).post('/auth/register').send({
        email: 'login-test@example.com',
        password: 'CorrectPassword123',
        name: 'Sunita Devi',
      });
    });

    it('logs in successfully and never returns passwordHash', async () => {
      const res = await request(app).post('/auth/login').send({
        email: 'login-test@example.com',
        password: 'CorrectPassword123',
      });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.user.email).toBe('login-test@example.com');
      expect(res.body.data.user.name).toBe('Sunita Devi');
      expect(res.body.data.user.passwordHash).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain('passwordHash');
      expect(res.body.data.accessToken).toBeDefined();

      const token = extractCookie(res, 'refreshToken');
      expect(token).toBeTruthy();
    });

    it('rejects incorrect password with 401', async () => {
      const res = await request(app).post('/auth/login').send({
        email: 'login-test@example.com',
        password: 'WrongPassword!',
      });

      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({
        status: 'error',
        code: 'INVALID_CREDENTIALS',
      });
    });

    it('rejects non-existent email with 401', async () => {
      const res = await request(app).post('/auth/login').send({
        email: 'unknown@example.com',
        password: 'AnyPassword123',
      });

      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({
        status: 'error',
        code: 'INVALID_CREDENTIALS',
      });
    });
  });

  describe('POST /auth/refresh & Rotation', () => {
    it('rotates refresh token on every refresh call', async () => {
      const regRes = await request(app).post('/auth/register').send({
        email: 'refresh-test@example.com',
        password: 'Password123!',
        name: 'Ajeet Singh',
      });

      const initialRefreshToken = extractCookie(regRes, 'refreshToken');
      expect(initialRefreshToken).toBeTruthy();

      // First refresh
      const refreshRes1 = await request(app)
        .post('/auth/refresh')
        .set('Cookie', `refreshToken=${initialRefreshToken}`);

      expect(refreshRes1.status).toBe(200);
      expect(refreshRes1.body.data.accessToken).toBeDefined();

      const rotatedRefreshToken = extractCookie(refreshRes1, 'refreshToken');
      expect(rotatedRefreshToken).toBeTruthy();
      expect(rotatedRefreshToken).not.toBe(initialRefreshToken);

      // Second refresh with the NEW rotated token
      const refreshRes2 = await request(app)
        .post('/auth/refresh')
        .set('Cookie', `refreshToken=${rotatedRefreshToken}`);

      expect(refreshRes2.status).toBe(200);
      expect(refreshRes2.body.data.accessToken).toBeDefined();

      const thirdRefreshToken = extractCookie(refreshRes2, 'refreshToken');
      expect(thirdRefreshToken).not.toBe(rotatedRefreshToken);
    });
  });

  describe('Reuse Detection', () => {
    it('revokes ALL user sessions when an already-used refresh token is presented', async () => {
      // 1. Register user and get Token 1
      const regRes = await request(app).post('/auth/register').send({
        email: 'reuse-test@example.com',
        password: 'Password123!',
        name: 'Manoj Kumar',
      });

      const token1 = extractCookie(regRes, 'refreshToken');

      // 2. Normal rotation: Token 1 rotated -> Token 2 issued
      const refreshRes = await request(app)
        .post('/auth/refresh')
        .set('Cookie', `refreshToken=${token1}`);

      expect(refreshRes.status).toBe(200);
      const token2 = extractCookie(refreshRes, 'refreshToken');
      expect(token2).not.toBe(token1);

      // 3. REUSE ATTEMPT: Attacker / replay of old Token 1
      const reuseRes = await request(app)
        .post('/auth/refresh')
        .set('Cookie', `refreshToken=${token1}`);

      expect(reuseRes.status).toBe(401);
      expect(reuseRes.body).toMatchObject({
        status: 'error',
        code: 'TOKEN_REUSE',
      });

      // 4. VERIFY CASCADE REVOCATION: Token 2 (which was valid) must now also fail!
      const subsequentRes = await request(app)
        .post('/auth/refresh')
        .set('Cookie', `refreshToken=${token2}`);

      expect(subsequentRes.status).toBe(401);
      expect(subsequentRes.body.code).toBe('TOKEN_REUSE');
    });
  });

  describe('GET & PATCH /auth/me (User Isolation & Validation)', () => {
    let userAToken: string;
    let userBToken: string;
    let userAId: string;
    let userBId: string;

    beforeEach(async () => {
      const resA = await request(app).post('/auth/register').send({
        email: 'usera@example.com',
        password: 'Password123!',
        name: 'Farmer A',
        language: 'en',
        areaUnit: 'acre',
      });
      userAToken = resA.body.data.accessToken;
      userAId = resA.body.data.user.id;

      const resB = await request(app).post('/auth/register').send({
        email: 'userb@example.com',
        password: 'Password123!',
        name: 'Farmer B',
        language: 'hi',
        areaUnit: 'ha',
      });
      userBToken = resB.body.data.accessToken;
      userBId = resB.body.data.user.id;
    });

    it('GET /auth/me returns the authenticated user data and NEVER returns another user data', async () => {
      // User A request
      const resA = await request(app).get('/auth/me').set('Authorization', `Bearer ${userAToken}`);

      expect(resA.status).toBe(200);
      expect(resA.body.data.user.id).toBe(userAId);
      expect(resA.body.data.user.email).toBe('usera@example.com');
      expect(resA.body.data.user.name).toBe('Farmer A');
      expect(resA.body.data.user.passwordHash).toBeUndefined();

      // User B request
      const resB = await request(app).get('/auth/me').set('Authorization', `Bearer ${userBToken}`);

      expect(resB.status).toBe(200);
      expect(resB.body.data.user.id).toBe(userBId);
      expect(resB.body.data.user.email).toBe('userb@example.com');
      expect(resB.body.data.user.name).toBe('Farmer B');

      // Strict non-leakage check
      expect(resA.body.data.user.id).not.toBe(resB.body.data.user.id);
    });

    it('PATCH /auth/me updates name, language, and areaUnit only', async () => {
      const updatePayload = {
        name: 'Farmer A Updated',
        language: 'hi',
        areaUnit: 'ha',
      };

      const res = await request(app)
        .patch('/auth/me')
        .set('Authorization', `Bearer ${userAToken}`)
        .send(updatePayload);

      expect(res.status).toBe(200);
      expect(res.body.data.user.name).toBe('Farmer A Updated');
      expect(res.body.data.user.language).toBe('hi');
      expect(res.body.data.user.areaUnit).toBe('ha');
      expect(res.body.data.user.passwordHash).toBeUndefined();

      // Verify in DB
      const dbUser = await UserModel.findById(userAId);
      expect(dbUser?.name).toBe('Farmer A Updated');
      expect(dbUser?.language).toBe('hi');
      expect(dbUser?.areaUnit).toBe('ha');
    });

    it('PATCH /auth/me rejects updates to unauthorized fields (e.g. email, role, password)', async () => {
      const unauthorizedPayload = {
        email: 'hacker@example.com',
        role: 'admin',
      };

      const res = await request(app)
        .patch('/auth/me')
        .set('Authorization', `Bearer ${userAToken}`)
        .send(unauthorizedPayload);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');

      // Verify User A's email was untouched
      const dbUser = await UserModel.findById(userAId);
      expect(dbUser?.email).toBe('usera@example.com');
    });

    it('PATCH /auth/me rejects invalid language or areaUnit values', async () => {
      const invalidLang = await request(app)
        .patch('/auth/me')
        .set('Authorization', `Bearer ${userAToken}`)
        .send({ language: 'french' });

      expect(invalidLang.status).toBe(400);

      const invalidUnit = await request(app)
        .patch('/auth/me')
        .set('Authorization', `Bearer ${userAToken}`)
        .send({ areaUnit: 'sqm' });

      expect(invalidUnit.status).toBe(400);
    });

    it('rejects unauthenticated requests to protected endpoints', async () => {
      const noAuth = await request(app).get('/auth/me');
      expect(noAuth.status).toBe(401);
      expect(noAuth.body.code).toBe('UNAUTHORIZED');

      const badToken = await request(app)
        .get('/auth/me')
        .set('Authorization', 'Bearer invalid.token.payload');
      expect(badToken.status).toBe(401);
      expect(badToken.body.code).toBe('INVALID_TOKEN');
    });
  });

  describe('POST /auth/logout', () => {
    it('revokes refresh token and clears cookie', async () => {
      const regRes = await request(app).post('/auth/register').send({
        email: 'logout-test@example.com',
        password: 'Password123!',
        name: 'Vikas Kumar',
      });

      const refreshToken = extractCookie(regRes, 'refreshToken');

      const logoutRes = await request(app)
        .post('/auth/logout')
        .set('Cookie', `refreshToken=${refreshToken}`);

      expect(logoutRes.status).toBe(200);

      // Subsequent refresh with the logged-out token must fail
      const refreshAfterLogout = await request(app)
        .post('/auth/refresh')
        .set('Cookie', `refreshToken=${refreshToken}`);

      expect(refreshAfterLogout.status).toBe(401);
    });
  });

  describe('DELETE /auth/me and DELETE /me (Complete Account Deletion)', () => {
    it('removes fields, logs, recommendations, sensors, readings, reports, pumps, channels, link codes, inbound/outbound messages, and user', async () => {
      // 1. Register User A
      const userARes = await request(app).post('/auth/register').send({
        email: 'farmer-a@example.com',
        password: 'Password123!',
        name: 'Farmer A',
      });
      const userAToken = userARes.body.data.accessToken;
      const userAId = new mongoose.Types.ObjectId(userARes.body.data.user.id);

      // 2. Register User B
      const userBRes = await request(app).post('/auth/register').send({
        email: 'farmer-b@example.com',
        password: 'Password123!',
        name: 'Farmer B',
      });
      const userBId = new mongoose.Types.ObjectId(userBRes.body.data.user.id);

      // 3. Create User A's data
      const fieldA = await FieldModel.create({
        userId: userAId,
        name: 'Field A',
        locationMode: 'pin',
        centroid: { type: 'Point', coordinates: [75.8, 26.9] },
        areaHa: 1.5,
        cropKey: 'wheat',
        sowingDate: new Date('2024-11-01'),
        soilType: 'loam',
        method: 'drip',
        baseline: { everyDays: 3, depthMm: 25 },
        waterMode: 'irrigated',
        hasProtectiveWater: false,
      });

      await PumpModel.create({
        userId: userAId,
        name: 'Pump A',
        dischargeLph: 12000,
        measuredOn: new Date(),
        costPerHour: 50,
      });

      const sensorA = await SensorModel.create({
        userId: userAId,
        fieldId: fieldA._id,
        name: 'Sensor A',
        apiKeyHash: 'hash_sensor_a_12345',
        isSimulated: false,
      });

      await SensorReadingModel.create({
        timestamp: new Date(),
        tempC: 28,
        moisturePct: 32,
        metadata: { sensorId: sensorA._id, fieldId: fieldA._id },
      });

      await IrrigationLogModel.create({
        userId: userAId,
        fieldId: fieldA._id,
        date: '2024-11-10',
        appliedMm: 20,
        source: 'manual',
      });

      await RecommendationModel.create({
        fieldId: fieldA._id,
        userId: userAId,
        forDate: '2024-11-11',
        action: 'irrigate',
        netMm: 15,
        grossMm: 20,
        litres: 30000,
        runMinutes: 150,
        splitAcrossDays: false,
        pumpCost: 125,
        pumpMissing: false,
        pumpSegments: [],
        missingMinutes: 0,
        notes: [],
        reasonKey: 'depletion',
        params: {},
        deficitMm: 15,
        et0Mm: 4.5,
        kc: 1.1,
        etcMm: 4.95,
        rainMm: 0,
        effectiveRainMm: 0,
        staleWeather: false,
        computedAt: new Date(),
      });

      await ReportModel.create({
        userId: userAId,
        fieldId: fieldA._id,
        status: 'completed',
        from: '2024-11-01',
        to: '2024-11-07',
        language: 'hi',
        data: {
          field: {
            id: fieldA._id.toString(),
            name: 'Field A',
            farmerName: 'Farmer A',
            cropKey: 'wheat',
            cropNameEn: 'Wheat',
            cropNameHi: 'गेहूं',
            cropName: 'Wheat',
            sowingDate: '2024-11-01',
            soilType: 'loam',
            irrigationMethod: 'drip',
            areaHa: 1.5,
          },
          assumptions: {
            method: 'drip',
            efficiency: 0.9,
            areaHa: 1.5,
            baselineEveryDays: 3,
            baselineDepthMm: 25,
            dataSources: 'FAO-56',
            baselineNote: '',
            disclaimer: '',
          },
          totals: {
            baseline: { count: 10, depthMm: 250, totalMm: 250, litres: 375000 },
            recommended: { count: 8, totalMm: 180, litres: 270000 },
            savings: { depthMm: 70, litres: 105000, percent: 28 },
          },
          days: [],
          chartData: [],
        },
      });

      await PowerScheduleModel.create({
        userId: userAId,
        name: 'Schedule A',
        type: 'day',
        windows: [{ days: [1, 2, 3, 4, 5], start: '06:00', end: '12:00' }],
      });

      const channelA = await MessageChannelModel.create({
        userId: userAId,
        provider: 'telegram',
        externalIdEncrypted: 'enc_chat_id_a',
        externalIdHash: 'hash_chat_id_a',
        optedIn: true,
        status: 'active',
        sendTime: '06:30',
        quietHours: { start: '22:00', end: '06:00' },
        dailyCap: 3,
        messagesSentToday: 1,
        planChangeAlertsEnabled: true,
      });

      await LinkCodeModel.create({
        userId: userAId,
        codeHash: 'hash_link_del_99',
        expiresAt: new Date(Date.now() + 600000),
      });

      await InboundMessageModel.create({
        provider: 'telegram',
        updateId: 998877,
        channelId: channelA._id,
        rawUpdate: { update_id: 998877, message: { text: 'Done' } },
        processed: true,
      });

      await OutboundMessageModel.create({
        channelId: channelA._id,
        userId: userAId,
        provider: 'telegram',
        text: 'Daily recommendation for Field A',
        status: 'sent',
      });

      await PushSubscriptionModel.create({
        userId: userAId,
        endpoint: 'https://fcm.googleapis.com/fcm/send/del-test-token',
        keys: { p256dh: 'p256key', auth: 'authkey' },
      });

      // 4. Create User B's data (must survive User A deletion)
      const fieldB = await FieldModel.create({
        userId: userBId,
        name: 'Field B',
        locationMode: 'pin',
        centroid: { type: 'Point', coordinates: [75.9, 26.8] },
        areaHa: 2.0,
        cropKey: 'mustard',
        sowingDate: new Date('2024-11-01'),
        soilType: 'clay',
        method: 'flood',
        baseline: { everyDays: 7, depthMm: 50 },
        waterMode: 'irrigated',
        hasProtectiveWater: false,
      });

      const pumpB = await PumpModel.create({
        userId: userBId,
        name: 'Pump B',
        dischargeLph: 20000,
        measuredOn: new Date(),
        costPerHour: 80,
      });

      // 5. Delete User A's account via DELETE /auth/me
      const delRes = await request(app)
        .delete('/auth/me')
        .set('Authorization', `Bearer ${userAToken}`);

      expect(delRes.status).toBe(200);
      expect(delRes.body.status).toBe('success');
      expect(delRes.body.data.success).toBe(true);
      expect(delRes.body.data.deletedCounts.fields).toBe(1);
      expect(delRes.body.data.deletedCounts.pumps).toBe(1);
      expect(delRes.body.data.deletedCounts.sensors).toBe(1);
      expect(delRes.body.data.deletedCounts.readings).toBe(1);
      expect(delRes.body.data.deletedCounts.logs).toBe(1);
      expect(delRes.body.data.deletedCounts.recommendations).toBe(1);
      expect(delRes.body.data.deletedCounts.reports).toBe(1);
      expect(delRes.body.data.deletedCounts.channels).toBe(1);
      expect(delRes.body.data.deletedCounts.linkCodes).toBe(1);
      expect(delRes.body.data.deletedCounts.inboundMessages).toBe(1);
      expect(delRes.body.data.deletedCounts.outboundMessages).toBe(1);
      expect(delRes.body.data.deletedCounts.pushSubscriptions).toBe(1);
      expect(delRes.body.data.deletedCounts.user).toBe(1);

      // 6. Assert User A data is completely wiped
      expect(await UserModel.findById(userAId)).toBeNull();
      expect(await RefreshTokenModel.countDocuments({ userId: userAId })).toBe(0);
      expect(await FieldModel.countDocuments({ userId: userAId })).toBe(0);
      expect(await PumpModel.countDocuments({ userId: userAId })).toBe(0);
      expect(await SensorModel.countDocuments({ userId: userAId })).toBe(0);
      expect(await SensorReadingModel.countDocuments({ 'metadata.fieldId': fieldA._id })).toBe(0);
      expect(await IrrigationLogModel.countDocuments({ userId: userAId })).toBe(0);
      expect(await RecommendationModel.countDocuments({ userId: userAId })).toBe(0);
      expect(await ReportModel.countDocuments({ userId: userAId })).toBe(0);
      expect(await PowerScheduleModel.countDocuments({ userId: userAId })).toBe(0);
      expect(await MessageChannelModel.countDocuments({ userId: userAId })).toBe(0);
      expect(await LinkCodeModel.countDocuments({ userId: userAId })).toBe(0);
      expect(await InboundMessageModel.countDocuments({ channelId: channelA._id })).toBe(0);
      expect(await OutboundMessageModel.countDocuments({ userId: userAId })).toBe(0);
      expect(await PushSubscriptionModel.countDocuments({ userId: userAId })).toBe(0);

      // 7. Assert User B data remains intact
      const survivingField = await FieldModel.findById(fieldB._id);
      expect(survivingField).not.toBeNull();
      expect(survivingField?.userId.toString()).toBe(userBId.toString());

      const survivingPump = await PumpModel.findById(pumpB._id);
      expect(survivingPump).not.toBeNull();
      expect(survivingPump?.userId.toString()).toBe(userBId.toString());
    });

    it('DELETE /me alias route works identically with valid authentication', async () => {
      const regRes = await request(app).post('/auth/register').send({
        email: 'farmer-alias@example.com',
        password: 'Password123!',
        name: 'Alias Farmer',
      });
      const token = regRes.body.data.accessToken;
      const uid = regRes.body.data.user.id;

      const delRes = await request(app)
        .delete('/me')
        .set('Authorization', `Bearer ${token}`);

      expect(delRes.status).toBe(200);
      expect(delRes.body.status).toBe('success');
      expect(await UserModel.findById(uid)).toBeNull();
    });

    it('rejects unauthenticated DELETE /me requests with 401', async () => {
      const res = await request(app).delete('/me');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });
  });
});
