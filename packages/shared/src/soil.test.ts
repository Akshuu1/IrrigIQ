import { describe, it, expect } from 'vitest';
import {
  SOIL_TEXTURE_CONFIG,
  mapSoilTexture,
  parseSoilGridsResponse,
} from './soil.js';

describe('Soil Texture Pure Functions (FAO-56 / USDA)', () => {
  describe('SOIL_TEXTURE_CONFIG', () => {
    it('has version and unverified sources', () => {
      expect(SOIL_TEXTURE_CONFIG.version).toBe('1.0.0');
      expect(SOIL_TEXTURE_CONFIG.clayThresholdPct.value).toBe(40.0);
      expect(SOIL_TEXTURE_CONFIG.clayThresholdPct.verified).toBe(false);
      expect(SOIL_TEXTURE_CONFIG.isricApi.timeoutMs).toBe(5000);
      expect(SOIL_TEXTURE_CONFIG.isricApi.cacheTtlSeconds).toBe(2592000);
    });
  });

  describe('mapSoilTexture', () => {
    const tableCases = [
      { sand: 20, silt: 35, clay: 45, expected: 'clay', desc: 'clay >= 40% maps to clay' },
      { sand: 10, silt: 50, clay: 40, expected: 'clay', desc: 'boundary clay = 40% maps to clay' },
      { sand: 75, silt: 15, clay: 10, expected: 'sandy', desc: 'sand >= 70% and clay <= 15% maps to sandy' },
      { sand: 70, silt: 15, clay: 15, expected: 'sandy', desc: 'boundary sand = 70% and clay = 15% maps to sandy' },
      { sand: 75, silt: 5, clay: 20, expected: 'loam', desc: 'sand >= 70% but clay > 15% maps to loam' },
      { sand: 40, silt: 40, clay: 20, expected: 'loam', desc: 'balanced composition maps to loam' },
      { sand: 50, silt: 30, clay: 20, expected: 'loam', desc: 'typical agricultural loam' },
    ];

    it.each(tableCases)('$desc', ({ sand, silt, clay, expected }) => {
      expect(mapSoilTexture(sand, silt, clay)).toBe(expected);
    });

    it('throws on negative or NaN inputs', () => {
      expect(() => mapSoilTexture(-1, 50, 50)).toThrow();
      expect(() => mapSoilTexture(50, -1, 50)).toThrow();
      expect(() => mapSoilTexture(50, 50, -1)).toThrow();
      expect(() => mapSoilTexture(NaN, 50, 50)).toThrow();
    });
  });

  describe('parseSoilGridsResponse', () => {
    it('parses valid ISRIC response with g/kg values converted to percentages', () => {
      const mockResponse = {
        type: 'Feature',
        properties: {
          layers: [
            {
              name: 'clay',
              depths: [
                { values: { mean: 450 } }, // 45%
                { values: { mean: 470 } }, // 47% -> avg 46%
              ],
            },
            {
              name: 'sand',
              depths: [
                { values: { mean: 200 } }, // 20%
              ],
            },
            {
              name: 'silt',
              depths: [
                { values: { mean: 340 } }, // 34%
              ],
            },
          ],
        },
      };

      const result = parseSoilGridsResponse(mockResponse);
      expect(result).not.toBeNull();
      expect(result?.clayPct).toBe(46);
      expect(result?.sandPct).toBe(20);
      expect(result?.siltPct).toBe(34);
      expect(result?.texture).toBe('clay');
    });

    it('returns null on missing layers or corrupt payload', () => {
      expect(parseSoilGridsResponse(null)).toBeNull();
      expect(parseSoilGridsResponse({})).toBeNull();
      expect(parseSoilGridsResponse({ properties: {} })).toBeNull();
      expect(parseSoilGridsResponse({ properties: { layers: [] } })).toBeNull();
      expect(
        parseSoilGridsResponse({
          properties: {
            layers: [{ name: 'clay', depths: [{ values: { mean: 400 } }] }],
          },
        }),
      ).toBeNull();
    });
  });
});

