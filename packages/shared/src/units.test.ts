import { describe, it, expect } from 'vitest';
import { mmToLitres, litresToMm, haToAcre, acreToHa } from './units.js';

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
});
