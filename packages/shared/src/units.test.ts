import { describe, it, expect } from 'vitest';
import {
  mmToLitres,
  litresToMm,
  haToAcre,
  acreToHa,
  toHectares,
  fromHectares,
  formatArea,
  AREA_CONFIG,
} from './units.js';

describe('FAO-56 Unit Conversion Helpers', () => {
  describe('mmToLitres', () => {
    const cases = [
      { depthMm: 0, areaHa: 1, expectedLitres: 0, description: 'zero depth gives 0 litres' },
      {
        depthMm: 1,
        areaHa: 1,
        expectedLitres: 10000,
        description: '1 mm over 1 ha is 10,000 litres',
      },
      {
        depthMm: 18,
        areaHa: 2,
        expectedLitres: 360000,
        description: '18 mm over 2 ha is 360,000 litres',
      },
      {
        depthMm: 6.39,
        areaHa: 0.5,
        expectedLitres: 31950,
        description: 'spec worked example (tomato mid-season): 6.39 mm on 0.5 ha ≈ 31,950 litres',
      },
    ];

    it.each(cases)('$description', ({ depthMm, areaHa, expectedLitres }) => {
      expect(mmToLitres(depthMm, areaHa)).toBe(expectedLitres);
    });

    it('throws on negative inputs', () => {
      expect(() => mmToLitres(-1, 1)).toThrow('Depth and area must be non-negative');
      expect(() => mmToLitres(1, -1)).toThrow('Depth and area must be non-negative');
    });
  });

  describe('litresToMm', () => {
    it('correctly inverts mmToLitres', () => {
      const areaHa = 0.5;
      const originalMm = 6.39;
      const litres = mmToLitres(originalMm, areaHa);
      expect(litresToMm(litres, areaHa)).toBe(originalMm);
    });

    it('throws on negative or zero area', () => {
      expect(() => litresToMm(100, 0)).toThrow();
      expect(() => litresToMm(-10, 1)).toThrow();
    });
  });

  describe('haToAcre and acreToHa', () => {
    it('converts between hectares and acres accurately', () => {
      const ha = 1;
      const acre = haToAcre(ha);
      expect(acre).toBeCloseTo(2.471, 2);

      const convertedBack = acreToHa(acre);
      expect(convertedBack).toBeCloseTo(1, 2);
    });

    it('throws on negative areas', () => {
      expect(() => haToAcre(-1)).toThrow();
      expect(() => acreToHa(-1)).toThrow();
    });
  });

  describe('Phase 18 Area Conversions', () => {
    describe('toHectares', () => {
      const cases = [
        { value: 1, unit: 'acre', custom: undefined, expected: 0.4047, desc: '1 acre = 0.4047 ha' },
        { value: 40, unit: 'guntha', custom: undefined, expected: 0.4047, desc: '40 guntha = 1 acre = 0.4047 ha' },
        { value: 2.5, unit: 'ha', custom: undefined, expected: 2.5, desc: '2.5 ha = 2.5 ha' },
        { value: 1, unit: 'hectare', custom: undefined, expected: 1.0, desc: '1 hectare = 1.0 ha' },
        { value: 2, unit: 'custom', custom: 0.5, expected: 0.4047, desc: 'custom unit (2 units at 0.5 acres/unit = 0.4047 ha)' },
      ];

      it.each(cases)('$desc', ({ value, unit, custom, expected }) => {
        expect(toHectares(value, unit, custom)).toBe(expected);
      });

      it('throws on zero or negative values', () => {
        expect(() => toHectares(0, 'acre')).toThrow('Area must be a positive number');
        expect(() => toHectares(-2, 'acre')).toThrow('Area must be a positive number');
        expect(() => toHectares(NaN, 'acre')).toThrow('Area must be a positive number');
      });

      it('throws on missing or invalid custom multiplier', () => {
        expect(() => toHectares(2, 'custom')).toThrow('Custom unit requires a valid acres-per-unit multiplier');
        expect(() => toHectares(2, 'custom', 0)).toThrow('Custom unit requires a valid acres-per-unit multiplier');
        expect(() => toHectares(2, 'custom', -1)).toThrow('Custom unit requires a valid acres-per-unit multiplier');
      });

      it('throws on unknown unit', () => {
        expect(() => toHectares(2, 'sqm')).toThrow('Unsupported area unit: sqm');
      });
    });

    describe('fromHectares', () => {
      it('1 ha = 2.471 acre', () => {
        expect(fromHectares(1, 'acre')).toBe(2.471);
      });

      it('converts hectares to guntha (40 guntha = 1 acre)', () => {
        // 0.4047 ha ≈ 1 acre ≈ 40 guntha
        expect(fromHectares(0.4047, 'guntha')).toBeCloseTo(40, 1);
      });

      it('converts hectares to hectare / ha directly', () => {
        expect(fromHectares(1.2345, 'ha')).toBe(1.2345);
        expect(fromHectares(1.2345, 'hectare')).toBe(1.2345);
      });

      it('converts to custom unit', () => {
        // 0.4047 ha ≈ 1 acre. If 1 custom unit = 0.5 acre, then 1 acre = 2 custom units.
        expect(fromHectares(0.4047, 'custom', 0.5)).toBeCloseTo(2.0, 1);
      });

      it('throws on negative hectare value or missing custom multiplier', () => {
        expect(() => fromHectares(-1, 'acre')).toThrow('Area must be a non-negative number');
        expect(() => fromHectares(1, 'custom')).toThrow('Custom unit requires a valid acres-per-unit multiplier');
      });
    });

    describe('formatArea', () => {
      it('formats in English by default', () => {
        expect(formatArea(0.4047, 'acre', 'en')).toBe('1.00 acre');
        expect(formatArea(1, 'ha', 'en')).toBe('1.00 ha');
      });

      it('formats in Hindi when specified', () => {
        expect(formatArea(0.4047, 'acre', 'hi')).toContain('एकड़');
        expect(formatArea(1, 'ha', 'hi')).toContain('हेक्टेयर');
        expect(formatArea(0.4047, 'guntha', 'hi')).toContain('गुंठा');
      });

      it('supports custom units formatting', () => {
        expect(formatArea(0.4047, 'custom', 'en', 0.5)).toBe('2.00 custom');
      });

      it('preserves backwards compatibility with legacy options object', () => {
        expect(formatArea(1, 'ha', { decimals: 1 })).toBe('1.0 ha');
      });
    });

    describe('AREA_CONFIG versioning and sources', () => {
      it('has version and unverified agronomic sources', () => {
        expect(AREA_CONFIG.version).toBe('1.0.0');
        expect(AREA_CONFIG.acreToHa.source).toBeDefined();
        expect(AREA_CONFIG.acreToHa.verified).toBe(false);
        expect(AREA_CONFIG.minAreaHa.value).toBe(0.01);
        expect(AREA_CONFIG.maxAreaHa.value).toBe(500.0);
        expect(AREA_CONFIG.largeAreaWarningHa.value).toBe(50.0);
      });
    });
  });
});
