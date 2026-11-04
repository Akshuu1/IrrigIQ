import { getRedisClient } from '../infra/redis.js';
import { getEnv } from '../config/env.js';
import { logger } from '../config/logger.js';
import {
  SOIL_TEXTURE_CONFIG,
  parseSoilGridsResponse,
  INDIA_BOUNDS,
  type SoilSuggestionResult,
} from '@irrigiq/shared';

export class SoilService {
  async getSoilSuggestion(lng: number, lat: number): Promise<SoilSuggestionResult | null> {
    const env = getEnv();
    if (!env.SOILGRIDS_ENABLED) {
      return null;
    }

    // Coordinate validation: within India bounds
    if (
      typeof lng !== 'number' ||
      typeof lat !== 'number' ||
      isNaN(lng) ||
      isNaN(lat) ||
      lng < INDIA_BOUNDS.minLng ||
      lng > INDIA_BOUNDS.maxLng ||
      lat < INDIA_BOUNDS.minLat ||
      lat > INDIA_BOUNDS.maxLat
    ) {
      return null;
    }

    const cellLat = lat.toFixed(2);
    const cellLng = lng.toFixed(2);
    const cacheKey = `soil:${cellLat}:${cellLng}`;

    // 1. Try reading from Redis cache
    try {
      const redis = getRedisClient();
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as SoilSuggestionResult;
      }
    } catch (err) {
      logger.warn({ err }, 'Redis read error in SoilService, proceeding to fetch');
    }

    // 2. Fetch from ISRIC SoilGrids v2 REST API with 5-second timeout
    try {
      const url = `${SOIL_TEXTURE_CONFIG.isricApi.url}?lon=${lng}&lat=${lat}&property=clay&property=sand&property=silt&depth=0-5cm&depth=5-15cm&value=mean`;

      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'IrrigIQ/1.0 (agronomy@irrigiq.org)',
        },
        signal: AbortSignal.timeout(SOIL_TEXTURE_CONFIG.isricApi.timeoutMs),
      });

      if (!response.ok) {
        logger.warn({ status: response.status, url }, 'ISRIC SoilGrids returned non-200');
        return null;
      }

      const json = await response.json();
      const suggestion = parseSoilGridsResponse(json);

      if (suggestion) {
        // Cache in Redis for 30 days
        try {
          const redis = getRedisClient();
          await redis.set(
            cacheKey,
            JSON.stringify(suggestion),
            'EX',
            SOIL_TEXTURE_CONFIG.isricApi.cacheTtlSeconds,
          );
        } catch (err) {
          logger.warn({ err }, 'Redis set error in SoilService');
        }
      }

      return suggestion;
    } catch (err) {
      // Graceful degradation: return null on any error / timeout
      logger.warn({ err, lng, lat }, 'Soil suggestion fetch failed or timed out; falling back to null');
      return null;
    }
  }
}

export const soilService = new SoilService();
