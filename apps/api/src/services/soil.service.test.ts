import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SoilService } from './soil.service.js';
import * as redisModule from '../infra/redis.js';
import * as envModule from '../config/env.js';

describe('SoilService (ISRIC SoilGrids v2 Integration)', () => {
  let soilService: SoilService;
  let mockRedis: {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    mockRedis = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
    };
    vi.spyOn(redisModule, 'getRedisClient').mockReturnValue(
      mockRedis as unknown as ReturnType<typeof redisModule.getRedisClient>,
    );
    vi.spyOn(envModule, 'getEnv').mockReturnValue({
      SOILGRIDS_ENABLED: true,
    } as unknown as ReturnType<typeof envModule.getEnv>);

    soilService = new SoilService();
  });

  it('returns cached soil suggestion when available in Redis', async () => {
    const cachedData = {
      sandPct: 75,
      siltPct: 15,
      clayPct: 10,
      texture: 'sandy',
      source: 'ISRIC SoilGrids 250m v2.0',
    };
    mockRedis.get.mockResolvedValueOnce(JSON.stringify(cachedData));

    const result = await soilService.getSoilSuggestion(75.8, 26.9);

    expect(result).toEqual(cachedData);
    expect(mockRedis.get).toHaveBeenCalledWith('soil:26.90:75.80');
  });

  it('fetches from ISRIC REST API on cache miss and populates Redis with 30-day TTL', async () => {
    const mockApiResponse = {
      type: 'Feature',
      properties: {
        layers: [
          {
            name: 'clay',
            depths: [{ values: { mean: 450 } }], // 45%
          },
          {
            name: 'sand',
            depths: [{ values: { mean: 200 } }], // 20%
          },
          {
            name: 'silt',
            depths: [{ values: { mean: 350 } }], // 35%
          },
        ],
      },
    };

    const globalFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => mockApiResponse,
    });
    vi.stubGlobal('fetch', globalFetch);

    const result = await soilService.getSoilSuggestion(75.8, 26.9);

    expect(result).not.toBeNull();
    expect(result?.texture).toBe('clay');
    expect(result?.clayPct).toBe(45);
    expect(mockRedis.set).toHaveBeenCalledWith(
      'soil:26.90:75.80',
      expect.any(String),
      'EX',
      2592000,
    );
  });

  it('gracefully returns null if ISRIC returns non-200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 503,
      }),
    );

    const result = await soilService.getSoilSuggestion(75.8, 26.9);
    expect(result).toBeNull();
  });

  it('gracefully returns null if request times out or aborts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValueOnce(new Error('The operation was aborted due to timeout')),
    );

    const result = await soilService.getSoilSuggestion(75.8, 26.9);
    expect(result).toBeNull();
  });

  it('returns null if coordinates are outside India bounds', async () => {
    const result = await soilService.getSoilSuggestion(-0.12, 51.5); // London
    expect(result).toBeNull();
  });

  it('returns null when SOILGRIDS_ENABLED feature flag is false', async () => {
    vi.spyOn(envModule, 'getEnv').mockReturnValue({
      SOILGRIDS_ENABLED: false,
    } as unknown as ReturnType<typeof envModule.getEnv>);

    const result = await soilService.getSoilSuggestion(75.8, 26.9);
    expect(result).toBeNull();
  });
});

