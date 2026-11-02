import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../app.js';
import { UserModel } from '../models/user.model.js';
import { RefreshTokenModel } from '../models/refreshToken.model.js';

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
});
