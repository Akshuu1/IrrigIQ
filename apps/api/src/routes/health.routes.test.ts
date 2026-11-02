import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import * as dbInfra from '../infra/db.js';
import * as redisInfra from '../infra/redis.js';

describe('Health & Readiness Routes', () => {
  const app = createApp();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /health (Liveness)', () => {
    it('returns 200 with status ok and x-request-id header', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.headers).toHaveProperty('x-request-id');
    });
  });

  describe('GET /ready (Readiness)', () => {
    it('returns 200 when both Mongo and Redis are healthy', async () => {
      vi.spyOn(dbInfra, 'checkMongoHealth').mockResolvedValue(true);
      vi.spyOn(redisInfra, 'checkRedisHealth').mockResolvedValue(true);

      const response = await request(app).get('/ready');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: 'ready',
        checks: {
          mongo: 'up',
          redis: 'up',
        },
        timestamp: expect.any(String),
      });
    });

    it('returns 503 when MongoDB is down', async () => {
      vi.spyOn(dbInfra, 'checkMongoHealth').mockResolvedValue(false);
      vi.spyOn(redisInfra, 'checkRedisHealth').mockResolvedValue(true);

      const response = await request(app).get('/ready');

      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        status: 'unhealthy',
        checks: {
          mongo: 'down',
          redis: 'up',
        },
        timestamp: expect.any(String),
      });
    });

    it('returns 503 when Redis is down', async () => {
      vi.spyOn(dbInfra, 'checkMongoHealth').mockResolvedValue(true);
      vi.spyOn(redisInfra, 'checkRedisHealth').mockResolvedValue(false);

      const response = await request(app).get('/ready');

      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        status: 'unhealthy',
        checks: {
          mongo: 'up',
          redis: 'down',
        },
        timestamp: expect.any(String),
      });
    });
  });

  describe('404 Handler', () => {
    it('returns 404 for unknown endpoints', async () => {
      const response = await request(app).get('/api/unknown-endpoint');

      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({
        status: 'error',
        code: 'NOT_FOUND',
      });
    });
  });
});
