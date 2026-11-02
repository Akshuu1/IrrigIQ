import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import nock from 'nock';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import {
  fetchForecast,
  normalizeForecast,
  weatherCellKey,
  parseWeatherCellKey,
  getWeatherForCell,
  getDayOfYear,
  getDateRange,
  WeatherServiceError,
} from './weather.service.js';
import { WeatherDayModel } from '../models/weatherDay.model.js';

describe('Weather Service & Open-Meteo Integration', () => {
  let mongod: MongoMemoryServer;
  let redisMock: Redis;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create({
      binary: {
        version: '7.0.14',
      },
    });
    const uri = mongod.getUri();
    await mongoose.connect(uri);
    await WeatherDayModel.syncIndexes();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongod) {
      await mongod.stop();
    }
  });

  beforeEach(async () => {
    nock.cleanAll();
    await WeatherDayModel.deleteMany({});
    redisMock = new RedisMock() as unknown as Redis;
  });

  const sampleOpenMeteoPayload = {
    latitude: 26.9,
    longitude: 75.8,
    daily: {
      time: ['2026-11-02', '2026-11-03', '2026-11-04'],
      temperature_2m_max: [30.5, 31.0, 29.8],
      temperature_2m_min: [18.2, 19.0, 17.5],
      precipitation_sum: [0.0, 2.5, 0.0],
      et0_fao_evapotranspiration: [4.2, 3.8, 4.0],
    },
  };

  describe('Pure Helpers (weatherCellKey, parseWeatherCellKey, getDayOfYear, getDateRange)', () => {
    it('weatherCellKey rounds coordinates to 0.1 degree', () => {
      expect(weatherCellKey(26.889, 75.831)).toBe('26.9_75.8');
      expect(weatherCellKey(26.04, 75.06)).toBe('26.0_75.1');
      expect(weatherCellKey(12.345, 77.567)).toBe('12.3_77.6');
    });

    it('parseWeatherCellKey extracts lat and lon', () => {
      const parsed = parseWeatherCellKey('26.9_75.8');
      expect(parsed.lat).toBe(26.9);
      expect(parsed.lon).toBe(75.8);
    });

    it('getDayOfYear computes correct day of year', () => {
      expect(getDayOfYear('2026-01-01')).toBe(1);
      expect(getDayOfYear('2026-01-31')).toBe(31);
      expect(getDayOfYear('2026-02-01')).toBe(32);
      expect(getDayOfYear('2026-12-31')).toBe(365);
    });

    it('getDateRange returns inclusive YYYY-MM-DD list', () => {
      const dates = getDateRange('2026-11-02', '2026-11-04');
      expect(dates).toEqual(['2026-11-02', '2026-11-03', '2026-11-04']);
    });
  });

  describe('normalizeForecast & Validation', () => {
    it('normalizes valid raw Open-Meteo response into WeatherDay[]', () => {
      const days = normalizeForecast(sampleOpenMeteoPayload);
      expect(days).toHaveLength(3);
      expect(days[0]).toEqual({
        date: '2026-11-02',
        tmaxC: 30.5,
        tminC: 18.2,
        rainMm: 0.0,
        et0Mm: 4.2,
        source: 'open-meteo',
      });
      expect(days[1]?.rainMm).toBe(2.5);
      expect(days[1]?.source).toBe('open-meteo');
    });

    it('missing ET0 uses Hargreaves formula and marks source as hargreaves', () => {
      const payloadWithMissingEt0 = {
        latitude: 26.9,
        longitude: 75.8,
        daily: {
          time: ['2026-11-02'],
          temperature_2m_max: [35.0],
          temperature_2m_min: [20.0],
          precipitation_sum: [0.0],
          et0_fao_evapotranspiration: [null],
        },
      };

      const days = normalizeForecast(payloadWithMissingEt0);
      expect(days).toHaveLength(1);
      const day = days[0]!;
      expect(day.source).toBe('hargreaves');
      expect(day.et0Mm).toBeGreaterThan(3.0);
      expect(day.et0Mm).toBeLessThan(12.0);
    });

    it('malformed and impossible values are rejected: negative precipitation', () => {
      const invalidRain = {
        latitude: 26.9,
        daily: {
          time: ['2026-11-02'],
          temperature_2m_max: [30.0],
          temperature_2m_min: [20.0],
          precipitation_sum: [-5.0], // IMPOSSIBLE
          et0_fao_evapotranspiration: [4.0],
        },
      };

      expect(() => normalizeForecast(invalidRain)).toThrow(/negative precipitation/i);
    });

    it('malformed and impossible values are rejected: ET0 above 15 mm', () => {
      const invalidEt0 = {
        latitude: 26.9,
        daily: {
          time: ['2026-11-02'],
          temperature_2m_max: [30.0],
          temperature_2m_min: [20.0],
          precipitation_sum: [0.0],
          et0_fao_evapotranspiration: [18.5], // IMPOSSIBLE (> 15)
        },
      };

      expect(() => normalizeForecast(invalidEt0)).toThrow(/above 15 mm/i);
    });

    it('malformed and impossible values are rejected: tmax below tmin', () => {
      const invalidTemps = {
        latitude: 26.9,
        daily: {
          time: ['2026-11-02'],
          temperature_2m_max: [18.0],
          temperature_2m_min: [24.0], // IMPOSSIBLE (tmin > tmax)
          precipitation_sum: [0.0],
          et0_fao_evapotranspiration: [4.0],
        },
      };

      expect(() => normalizeForecast(invalidTemps)).toThrow(/tmax is below tmin/i);
    });

    it('malformed and impossible values are rejected: mismatched array lengths', () => {
      const mismatched = {
        daily: {
          time: ['2026-11-02', '2026-11-03'],
          temperature_2m_max: [30.0], // only 1 element
          temperature_2m_min: [20.0, 21.0],
          precipitation_sum: [0.0, 0.0],
          et0_fao_evapotranspiration: [4.0, 4.0],
        },
      };

      expect(() => normalizeForecast(mismatched)).toThrow(/array length mismatch/i);
    });
  });

  describe('fetchForecast (Timeout & Retry)', () => {
    it('API slow triggers the timeout and retry, succeeding on second attempt', async () => {
      let callCount = 0;
      const customFetch: typeof fetch = async (_input, init) => {
        callCount++;
        if (callCount === 1) {
          // Simulate slow response that triggers AbortSignal timeout
          const signal = init?.signal;
          await new Promise<void>((_resolve, reject) => {
            if (signal) {
              signal.addEventListener('abort', () => {
                const abortErr = new Error('The operation was aborted due to timeout');
                abortErr.name = 'TimeoutError';
                reject(abortErr);
              });
            }
          });
        }
        // Second call (retry) returns successful response
        return new Response(JSON.stringify(sampleOpenMeteoPayload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      const days = await fetchForecast(26.9, 75.8, 3, {
        timeoutMs: 80,
        retryDelayMs: 30,
        fetchFn: customFetch,
      });

      expect(days).toHaveLength(3);
      expect(callCount).toBe(2);
    });

    it('throws WeatherServiceError when both attempts fail', async () => {
      nock('https://api.open-meteo.com')
        .get('/v1/forecast')
        .query(true)
        .reply(500, { error: 'Internal Server Error' })
        .get('/v1/forecast')
        .query(true)
        .reply(503, { error: 'Service Unavailable' });

      await expect(
        fetchForecast(26.9, 75.8, 3, { timeoutMs: 200, retryDelayMs: 30 }),
      ).rejects.toThrow(WeatherServiceError);
    });
  });

  describe('getWeatherForCell (Cache, Lock & Stampede Prevention)', () => {
    it('a cache hit makes no HTTP call', async () => {
      const cellKey = '26.9_75.8';
      const freshDate = new Date(); // now (< 6 hours old)

      await WeatherDayModel.create([
        {
          cellKey,
          date: '2026-11-02',
          tmaxC: 30.0,
          tminC: 18.0,
          rainMm: 0.0,
          et0Mm: 4.0,
          source: 'open-meteo',
          fetchedAt: freshDate,
        },
        {
          cellKey,
          date: '2026-11-03',
          tmaxC: 31.0,
          tminC: 19.0,
          rainMm: 1.0,
          et0Mm: 3.8,
          source: 'open-meteo',
          fetchedAt: freshDate,
        },
      ]);

      // No nock endpoint is registered: any HTTP call would fail
      const result = await getWeatherForCell(cellKey, '2026-11-02', '2026-11-03', {
        redis: redisMock,
      });

      expect(result.stale).toBe(false);
      expect(result.days).toHaveLength(2);
      expect(result.days[0]?.tmaxC).toBe(30.0);
      expect(result.days[1]?.rainMm).toBe(1.0);
    });

    it('API down returns stale cache', async () => {
      const cellKey = '26.9_75.8';
      const eightHoursAgo = new Date(Date.now() - 8 * 60 * 60 * 1000);

      // Populate stale cache (> 6 hours old)
      await WeatherDayModel.create([
        {
          cellKey,
          date: '2026-11-02',
          tmaxC: 32.0,
          tminC: 20.0,
          rainMm: 0.0,
          et0Mm: 4.5,
          source: 'open-meteo',
          fetchedAt: eightHoursAgo,
        },
      ]);

      // Mock upstream API down (500 for both initial call and retry)
      nock('https://api.open-meteo.com')
        .get('/v1/forecast')
        .query(true)
        .twice()
        .reply(500, { error: 'Upstream Down' });

      const result = await getWeatherForCell(cellKey, '2026-11-02', '2026-11-02', {
        redis: redisMock,
        retryDelayMs: 20,
      });

      expect(result.stale).toBe(true);
      expect(result.days).toHaveLength(1);
      expect(result.days[0]?.tmaxC).toBe(32.0);
    });

    it('API down throws clear domain error when no cached data exists (never crashes process)', async () => {
      const cellKey = '26.9_75.8';

      // No cached data exists in Mongo
      nock('https://api.open-meteo.com')
        .get('/v1/forecast')
        .query(true)
        .twice()
        .reply(500, { error: 'Gateway Timeout' });

      await expect(
        getWeatherForCell(cellKey, '2026-11-02', '2026-11-02', {
          redis: redisMock,
          retryDelayMs: 20,
        }),
      ).rejects.toThrow(/Weather service unavailable and no cached forecast exists/i);
    });

    it('100 concurrent requests for one cell make one API call', async () => {
      const cellKey = '26.9_75.8';
      let apiCallCount = 0;

      // Intercept Open-Meteo call and count invocations
      nock('https://api.open-meteo.com')
        .get('/v1/forecast')
        .query(true)
        .reply(() => {
          apiCallCount++;
          return [200, sampleOpenMeteoPayload];
        });

      // Launch 100 concurrent requests simultaneously for the same cell
      const promises = Array.from({ length: 100 }, () =>
        getWeatherForCell(cellKey, '2026-11-02', '2026-11-04', {
          redis: redisMock,
        }),
      );

      const results = await Promise.all(promises);

      // All 100 requests resolved successfully with fresh data
      expect(results).toHaveLength(100);
      for (const res of results) {
        expect(res.stale).toBe(false);
        expect(res.days).toHaveLength(3);
        expect(res.days[0]?.date).toBe('2026-11-02');
      }

      // Exactly ONE upstream call was made thanks to the Redis lock + double-checked cache!
      expect(apiCallCount).toBe(1);

      // Cache collection in MongoDB has the 3 days saved
      const savedCount = await WeatherDayModel.countDocuments({ cellKey });
      expect(savedCount).toBe(3);
    });
  });
});
