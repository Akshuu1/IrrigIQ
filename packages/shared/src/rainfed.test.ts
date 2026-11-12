import { describe, it, expect } from 'vitest';
import {
  rainyDays,
  drySpellLength,
  cumulativeRain,
  updateBucket,
  stressLevel,
  rootDepthForDay,
  tawFor,
  planRainfed,
  getCalendarForState,
  isDateInWindow,
  RAINFED_CONFIG,
} from './rainfed.js';

describe('Phase 19: Rain-fed Mode Pure Functions', () => {
  describe('rainyDays', () => {
    it('counts days with rainfall >= threshold (default 2.5 mm)', () => {
      expect(rainyDays([])).toBe(0);
      expect(rainyDays([0, 1.2, 2.4, 2.5, 10.0, 0.5])).toBe(2); // 2.5 and 10.0
      expect(rainyDays([2.5])).toBe(1);
      expect(rainyDays([2.49])).toBe(0);
    });

    it('supports custom rainfall thresholds', () => {
      expect(rainyDays([0, 5, 10, 15], 10)).toBe(2);
    });
  });

  describe('drySpellLength', () => {
    it('returns 0 for empty array', () => {
      expect(drySpellLength([])).toBe(0);
    });

    it('counts dry spell across 7 consecutive dry forecast days', () => {
      const forecastRain = [0, 0, 0, 0, 0, 0, 0];
      expect(drySpellLength(forecastRain)).toBe(7);
    });

    it('counts max consecutive dry days interrupted by rainfall >= 2.5 mm', () => {
      const rain = [0, 0, 0, 10.0, 0, 0, 1.0, 0];
      // First dry spell: 3 days. After rain (10.0): 0, 0, 1.0, 0 (all < 2.5 mm) = 4 days
      expect(drySpellLength(rain)).toBe(4);
    });

    it('returns 0 if every day exceeds rainy day threshold', () => {
      expect(drySpellLength([3.0, 5.0, 10.0])).toBe(0);
    });
  });

  describe('cumulativeRain', () => {
    it('sums all rainfall when days argument is omitted', () => {
      expect(cumulativeRain([])).toBe(0);
      expect(cumulativeRain([10, 20.5, 5.25])).toBe(35.75);
    });

    it('sums only the last N days when days argument is provided', () => {
      const rain14Days = [10, 10, 10, 10, 10, 10, 10, 5, 5, 5, 5, 5, 5, 5]; // first 7 days: 70mm, last 7 days: 35mm
      expect(cumulativeRain(rain14Days, 7)).toBe(35);
    });
  });

  describe('updateBucket', () => {
    const TAW = 100; // mm

    it('increases store with effective rain and decreases with ETc', () => {
      const initial = 50;
      const rain = 20;
      const etc = 10;
      expect(updateBucket(initial, rain, etc, TAW)).toBe(60);
    });

    it('never allows bucket store to drop below 0 (soil moisture floor)', () => {
      const initial = 10;
      const rain = 0;
      const etc = 30;
      expect(updateBucket(initial, rain, etc, TAW)).toBe(0);
    });

    it('never allows bucket store to exceed TAW (soil capacity ceiling / runoff)', () => {
      const initial = 90;
      const rain = 50;
      const etc = 5;
      expect(updateBucket(initial, rain, etc, TAW)).toBe(TAW);
    });
  });

  describe('stressLevel', () => {
    const TAW = 100;

    it('returns "ok" when moisture ratio >= 0.5', () => {
      expect(stressLevel(50, TAW)).toBe('ok');
      expect(stressLevel(80, TAW)).toBe('ok');
    });

    it('returns "watch" when moisture ratio is between 0.3 and 0.5', () => {
      expect(stressLevel(49, TAW)).toBe('watch');
      expect(stressLevel(30, TAW)).toBe('watch');
    });

    it('returns "stress" when moisture ratio < 0.3', () => {
      expect(stressLevel(29.9, TAW)).toBe('stress');
      expect(stressLevel(0, TAW)).toBe('stress');
    });

    it('returns "stress" when TAW is 0 or negative', () => {
      expect(stressLevel(0, 0)).toBe('stress');
    });
  });

  describe('rootDepthForDay & tawFor', () => {
    it('returns initial root depth during early stage', () => {
      const depth = rootDepthForDay('cotton', 10);
      expect(depth).toBe(0.3); // cotton ini
    });

    it('interpolates root depth during development stage', () => {
      // cotton: ini=30, dev=50, mid=60, iniDepth=0.3, midDepth=1.4
      const depth = rootDepthForDay('cotton', 55); // halfway through dev stage
      expect(depth).toBeGreaterThan(0.3);
      expect(depth).toBeLessThan(1.4);
    });

    it('returns max root depth during mid and late stage', () => {
      const depth = rootDepthForDay('cotton', 100);
      expect(depth).toBe(1.4);
    });

    it('computes TAW based on soil water capacity and root depth', () => {
      // sandy: 100 mm/m, rootDepth for cotton mid stage: 1.4m => 140 mm
      const tawSandy = tawFor({ soilType: 'sandy', cropKey: 'cotton' }, 100);
      expect(tawSandy).toBe(140);

      // clay: 180 mm/m, rootDepth for cotton mid stage: 1.4m => 252 mm
      const tawClay = tawFor({ soilType: 'clay', cropKey: 'cotton' }, 100);
      expect(tawClay).toBe(252);
    });
  });

  describe('getCalendarForState & isDateInWindow', () => {
    it('looks up calendar entries for supported states (Maharashtra, Karnataka, Rajasthan)', () => {
      const mhCotton = getCalendarForState('Maharashtra', 'cotton');
      expect(mhCotton).toBeDefined();
      expect(mhCotton?.crop).toBe('cotton');
      expect(mhCotton?.sowFrom).toBe('06-15');
      expect(mhCotton?.sowTo).toBe('07-15');
      expect(mhCotton?.sowingRainMm).toBe(75);

      const kaMaize = getCalendarForState('Karnataka', 'maize');
      expect(kaMaize).toBeDefined();
      expect(kaMaize?.crop).toBe('maize');

      const rjWheat = getCalendarForState('Rajasthan', 'wheat');
      expect(rjWheat).toBeDefined();
      expect(rjWheat?.crop).toBe('wheat');
    });

    it('returns null for missing calendar state or unsupported crop', () => {
      expect(getCalendarForState('Goa', 'cotton')).toBeNull();
      expect(getCalendarForState('Maharashtra', 'nonexistent_crop')).toBeNull();
    });

    it('checks date window inclusion', () => {
      expect(isDateInWindow('06-20', '06-15', '07-15')).toBe(true);
      expect(isDateInWindow('06-10', '06-15', '07-15')).toBe(false);
      expect(isDateInWindow('07-20', '06-15', '07-15')).toBe(false);
    });
  });

  describe('planRainfed', () => {
    const cottonField = {
      cropKey: 'cotton',
      sowingDate: '2026-07-01',
      soilType: 'loam' as const,
      hasProtectiveWater: false,
    };

    const calendar = getCalendarForState('Maharashtra', 'cotton');

    it('returns rainfed.no_calendar when calendar is null', () => {
      const plan = planRainfed(cottonField, [10, 20], [0, 0], null, '2026-06-20');
      expect(plan.statusKey).toBe('rainfed.no_calendar');
      expect(plan.advice).toContain('rainfed.advice.no_calendar');
    });

    it('evaluates sowing readiness exactly at the thresholds (75 mm)', () => {
      // 7 days of 10 mm = 70 mm (< 75 mm threshold)
      const rainUnder = [10, 10, 10, 10, 10, 10, 10];
      const planUnder = planRainfed(
        { ...cottonField, sowingDate: '2026-07-01' },
        rainUnder,
        [0, 0, 0, 0, 0, 0, 0],
        calendar,
        '2026-06-25', // before sowingDate, inside window (06-15 to 07-15)
      );
      expect(planUnder.statusKey).toBe('rainfed.wait_to_sow');
      expect(planUnder.params.rainLast7Days).toBe(70);

      // Exactly 75 mm (meeting threshold)
      const rainExact = [10, 10, 10, 10, 10, 10, 15]; // 75 mm
      const planExact = planRainfed(
        { ...cottonField, sowingDate: '2026-07-01' },
        rainExact,
        [0, 0, 0, 0, 0, 0, 0],
        calendar,
        '2026-06-25',
      );
      expect(planExact.statusKey).toBe('rainfed.good_to_sow');
      expect(planExact.params.rainLast7Days).toBe(75);
      expect(planExact.advice).toContain('rainfed.advice.sow_now');
    });

    it('detects outside sowing window before and after', () => {
      // Before window (e.g. 05-01 vs sowFrom 06-15)
      const planBefore = planRainfed(
        { ...cottonField, sowingDate: '2026-07-01' },
        [0, 0],
        [0, 0],
        calendar,
        '2026-05-01',
      );
      expect(planBefore.statusKey).toBe('rainfed.wait_to_sow');
      expect(planBefore.advice).toContain('rainfed.advice.prepare_land');

      // After window (e.g. 08-01 vs sowTo 07-15)
      const planAfter = planRainfed(
        { ...cottonField, sowingDate: '2026-08-05' },
        [0, 0],
        [0, 0],
        calendar,
        '2026-08-01',
      );
      expect(planAfter.statusKey).toBe('rainfed.outside_window');
      expect(planAfter.advice).toContain('rainfed.advice.contingency_short_duration');
    });

    it('evaluates sown field: ok vs watch_dry vs stress_risk', () => {
      // Sown on 2026-06-20, evaluating on 2026-07-10 (das = 20)
      const sownField = {
        cropKey: 'cotton',
        sowingDate: '2026-06-20',
        soilType: 'clay' as const,
        hasProtectiveWater: false,
      };

      // With recent rains and no forecast dry spell => rainfed.ok
      const planOk = planRainfed(
        sownField,
        [20, 15, 25, 10, 5, 20, 15],
        [5, 5, 10, 5, 0, 5, 5],
        calendar,
        '2026-07-10',
      );
      expect(planOk.statusKey).toBe('rainfed.ok');
      expect(planOk.advice).toContain('rainfed.advice.weed_management');

      // Zero past rain + 7-day forecast dry spell => rainfed.stress_risk
      const planStress = planRainfed(
        sownField,
        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0],
        calendar,
        '2026-07-10',
      );
      expect(planStress.statusKey).toBe('rainfed.stress_risk');
      expect(planStress.params.drySpellDays).toBe(7);
      expect(planStress.advice).toContain('rainfed.advice.foliar_spray');
    });

    it('suggests protective irrigation when hasProtectiveWater is true and stress is detected', () => {
      const fieldWithWater = {
        cropKey: 'cotton',
        sowingDate: '2026-06-20',
        soilType: 'loam' as const,
        hasProtectiveWater: true,
      };

      const plan = planRainfed(
        fieldWithWater,
        [0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0],
        calendar,
        '2026-07-10',
      );
      expect(plan.statusKey).toBe('rainfed.stress_risk');
      expect(plan.advice).toContain('rainfed.advice.protective_irrigation');
    });
  });

  describe('Config Integrity Rule', () => {
    it('verifies all config values have source and verified fields', () => {
      expect(RAINFED_CONFIG.rainyDayMm.source).toBeDefined();
      expect(typeof RAINFED_CONFIG.rainyDayMm.source).toBe('object');
      expect((RAINFED_CONFIG.rainyDayMm.source as any).status).toBe('ai-suggested');
      expect((RAINFED_CONFIG.rainyDayMm.source as any).document).toContain('IMD');
      expect(RAINFED_CONFIG.rainyDayMm.verified).toBe(false);
      expect(RAINFED_CONFIG.sowingRainMm.source).toBeDefined();
      expect(RAINFED_CONFIG.sowingRainMm.verified).toBe(false);
      expect(RAINFED_CONFIG.stressThresholds.watch.source).toBeDefined();
      expect(RAINFED_CONFIG.stressThresholds.stress.source).toBeDefined();
      expect(RAINFED_CONFIG.soilWaterCapacityPerMetre.loam.source).toBeDefined();
    });
  });
});

