import { describe, it, expect } from 'vitest';
import { CROPS, CROPS_MAP } from './crops.js';
import {
  stageForDay,
  kcForDay,
  computeEtc,
  effectiveRain,
  netNeed,
  grossNeed,
  hargreavesEt0,
  SOIL_CONFIG,
  IRRIGATION_EFFICIENCY,
  IrrigationMethod,
} from './science.js';
import { mmToLitres, litresToMm, formatArea, haToAcre, acreToHa } from './units.js';

describe('IrrigIQ Irrigation Science (FAO-56)', () => {
  const tomato = CROPS_MAP.get('tomato')!;

  describe('Tomato Crop Curve (Key Spec Requirements)', () => {
    it('returns exact expected stage and Kc values across the season', () => {
      // Day 0 and 29 give 0.60
      expect(stageForDay(tomato, 0)).toBe('ini');
      expect(kcForDay(tomato, 0)).toBe(0.6);

      expect(stageForDay(tomato, 29)).toBe('ini');
      expect(kcForDay(tomato, 29)).toBe(0.6);

      // Day 30 starts rising (development stage)
      expect(stageForDay(tomato, 30)).toBe('dev');
      const kcDay30 = kcForDay(tomato, 30);
      expect(kcDay30).not.toBeNull();
      expect(kcDay30!).toBeGreaterThan(0.6);
      expect(kcDay30).toBe(0.613);

      // Day 70 gives 1.15 (start of mid-season stage)
      expect(stageForDay(tomato, 70)).toBe('mid');
      expect(kcForDay(tomato, 70)).toBe(1.15);

      // Day 109 gives 1.15 (end of mid-season stage)
      expect(stageForDay(tomato, 109)).toBe('mid');
      expect(kcForDay(tomato, 109)).toBe(1.15);

      // The last late day (day 134) is close to 0.80
      expect(stageForDay(tomato, 134)).toBe('late');
      const kcDay134 = kcForDay(tomato, 134);
      expect(kcDay134).not.toBeNull();
      expect(kcDay134!).toBeCloseTo(0.8, 1);
      expect(kcDay134).toBe(0.813);

      // Day 135 returns finished / null
      expect(stageForDay(tomato, 135)).toBe('finished');
      expect(kcForDay(tomato, 135)).toBeNull();
    });
  });

  describe('All Crops: Stage Progression, Continuity & Boundaries', () => {
    it('ensures Kc is continuous without jumps and bounded for every crop', () => {
      for (const crop of CROPS) {
        const totalDays =
          crop.stageDays.ini + crop.stageDays.dev + crop.stageDays.mid + crop.stageDays.late;

        const minAllowedKc = Math.min(crop.kc.ini, crop.kc.mid, crop.kc.end);
        const maxAllowedKc = Math.max(crop.kc.ini, crop.kc.mid, crop.kc.end);

        let previousKc = kcForDay(crop, 0)!;
        expect(previousKc).toBe(crop.kc.ini);

        for (let day = 1; day < totalDays; day++) {
          const currentKc = kcForDay(crop, day);
          expect(currentKc).not.toBeNull();

          // Kc stays bounded within crop's min and max values
          expect(currentKc!).toBeGreaterThanOrEqual(minAllowedKc - 0.001);
          expect(currentKc!).toBeLessThanOrEqual(maxAllowedKc + 0.001);

          // Continuity check: daily change must be smooth (no sudden jumps at boundaries)
          const dailyDiff = Math.abs(currentKc! - previousKc);
          expect(dailyDiff).toBeLessThan(0.05);

          previousKc = currentKc!;
        }

        // Post-harvest returns finished and null
        expect(stageForDay(crop, totalDays)).toBe('finished');
        expect(kcForDay(crop, totalDays)).toBeNull();
        expect(kcForDay(crop, totalDays + 10)).toBeNull();
      }
    });

    it('throws when daysAfterSowing is negative or NaN', () => {
      expect(() => stageForDay(tomato, -1)).toThrow('Days after sowing cannot be negative');
      expect(() => stageForDay(tomato, NaN)).toThrow('must be a valid number');
      expect(() => kcForDay(tomato, -5)).toThrow('Days after sowing cannot be negative');
    });
  });

  describe('effectiveRain', () => {
    const rainCases = [
      { rainMm: 3, expected: 0, description: '3 mm is <= 5 mm threshold -> 0' },
      { rainMm: 5, expected: 0, description: '5 mm is == 5 mm threshold -> 0' },
      {
        rainMm: 12,
        expected: 5.6,
        description: '12 mm -> 0.8 * (12 - 5) = 5.6 mm',
      },
      {
        rainMm: 25,
        expected: 16.0,
        description: '25 mm -> 0.8 * (25 - 5) = 16.0 mm',
      },
    ];

    it.each(rainCases)('$description', ({ rainMm, expected }) => {
      expect(effectiveRain(rainMm)).toBe(expected);
    });

    it('supports custom threshold and factor', () => {
      expect(effectiveRain(10, { ignoreBelowMm: 4, factor: 0.75 })).toBe(4.5);
    });

    it('rejects negative or NaN rainfall', () => {
      expect(() => effectiveRain(-1)).toThrow('Rainfall cannot be negative');
      expect(() => effectiveRain(NaN)).toThrow('must be a valid number');
    });
  });

  describe('Worked Example from Project Plan', () => {
    it('computes exact worked example: tomato mid-season, drip, 0.5 ha, no rain', () => {
      const et0 = 5.0;
      const kc = 1.15;
      const rain = 0;
      const areaHa = 0.5;

      // 1. ETc = ET0 * Kc = 5.0 * 1.15 = 5.75 mm
      const etc = computeEtc(et0, kc);
      expect(etc).toBe(5.75);

      // 2. Effective rain with no rain = 0
      const effRain = effectiveRain(rain);
      expect(effRain).toBe(0);

      // 3. Net need = max(0, ETc - effRain) = 5.75 mm
      const net = netNeed(etc, effRain);
      expect(net).toBe(5.75);

      // 4. Gross need with drip (efficiency 0.90) = 5.75 / 0.90 ≈ 6.39 mm
      const gross = grossNeed(net, 'drip');
      expect(gross).toBe(6.39);

      // 5. Total volume in litres = 6.39 mm * 0.5 ha * 10,000 ≈ 31,950 litres
      const litres = mmToLitres(gross, areaHa);
      expect(litres).toBe(31950);
    });

    it('computes rainy day scenario: 12 mm rain gives skip recommendation', () => {
      const etc = 5.75;
      const rain = 12;

      const effRain = effectiveRain(rain);
      expect(effRain).toBe(5.6);

      const net = netNeed(etc, effRain);
      expect(net).toBe(0.15); // Negligible need, triggers skip
    });
  });

  describe('Irrigation Methods & Efficiencies', () => {
    it('applies standard application efficiencies correctly', () => {
      const net = 10;
      expect(grossNeed(net, 'drip')).toBe(11.11); // 10 / 0.90
      expect(grossNeed(net, 'sprinkler')).toBe(13.33); // 10 / 0.75
      expect(grossNeed(net, 'flood')).toBe(16.67); // 10 / 0.60
      expect(IRRIGATION_EFFICIENCY.drip).toBe(0.9);
      expect(IRRIGATION_EFFICIENCY.sprinkler).toBe(0.75);
      expect(IRRIGATION_EFFICIENCY.flood).toBe(0.6);
    });

    it('validates grossNeed inputs', () => {
      expect(() => grossNeed(-5, 'drip')).toThrow();
      expect(() => grossNeed(10, 'invalid' as unknown as IrrigationMethod)).toThrow();
    });
  });

  describe('Hargreaves ET0 Fallback Calculation', () => {
    it('satisfies spec sanity checks for latitude 26.9, Tmax 38, Tmin 24, day 150', () => {
      const lat = 26.9;
      const tmax = 38;
      const tmin = 24;
      const dayOfYear = 150;

      const et0 = hargreavesEt0(tmax, tmin, lat, dayOfYear);

      // 1. Result must be between 5 and 10 mm/day
      expect(et0).toBeGreaterThanOrEqual(5.0);
      expect(et0).toBeLessThanOrEqual(10.0);
      expect(et0).toBe(6.94);

      // 2. Never negative
      expect(hargreavesEt0(0, -5, lat, dayOfYear)).toBeGreaterThanOrEqual(0);

      // 3. Increases with temperature range (greater diurnal difference means higher solar radiation)
      const higherRangeEt0 = hargreavesEt0(42, 20, lat, dayOfYear); // delta T = 22 vs 14
      expect(higherRangeEt0).toBeGreaterThan(et0);
    });

    it('validates Hargreaves inputs and edge cases', () => {
      expect(() => hargreavesEt0(20, 25, 26.9, 150)).toThrow('Tmax cannot be less than Tmin');
      expect(() => hargreavesEt0(30, 20, 95, 150)).toThrow('Latitude must be between -90 and 90');
      expect(() => hargreavesEt0(30, 20, 26.9, 400)).toThrow(
        'Day of year must be between 1 and 366',
      );
      expect(hargreavesEt0(25, 25, 26.9, 150)).toBe(0); // zero range
    });
  });

  describe('Soil Constants & Thresholds', () => {
    it('exports standard tunable values for sandy, loam, and clay', () => {
      expect(SOIL_CONFIG.maxDepthMm.sandy).toBe(25);
      expect(SOIL_CONFIG.maxDepthMm.loam).toBe(40);
      expect(SOIL_CONFIG.maxDepthMm.clay).toBe(50);

      expect(SOIL_CONFIG.triggerMm.sandy).toBe(12);
      expect(SOIL_CONFIG.triggerMm.loam).toBe(20);
      expect(SOIL_CONFIG.triggerMm.clay).toBe(25);
    });
  });

  describe('Units Conversion Helpers', () => {
    it('converts 1 mm over 1 ha to 10,000 litres and supports roundtrip', () => {
      expect(mmToLitres(1, 1)).toBe(10000);
      expect(litresToMm(10000, 1)).toBe(1);

      const roundtripMm = 14.5;
      const area = 2.4;
      const litres = mmToLitres(roundtripMm, area);
      expect(litresToMm(litres, area)).toBe(roundtripMm);
    });

    it('converts between ha and acres', () => {
      expect(haToAcre(1)).toBe(2.471);
      expect(acreToHa(2.47105)).toBe(1);
    });

    it('formats area with unit and locale', () => {
      expect(formatArea(1, 'ha')).toBe('1.00 ha');
      expect(formatArea(1, 'acre')).toBe('2.47 acre');
      expect(formatArea(2.5, 'ha', { decimals: 1 })).toBe('2.5 ha');
    });

    it('throws on invalid area formatting inputs', () => {
      expect(() => formatArea(-1)).toThrow('Area must be a non-negative number');
      expect(() => formatArea(NaN)).toThrow('Area must be a non-negative number');
    });
  });
});
