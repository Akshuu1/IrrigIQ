import { describe, it, expect } from 'vitest';
import {
  buildDailyNeeds,
  planIrrigation,
  explain,
  type DailyNeed,
} from './recommendations.js';

describe('Irrigation Planning & Recommendations Pure Functions', () => {
  describe('buildDailyNeeds', () => {
    it('computes daily needs correctly for each day', () => {
      // Tomato sown on 2026-10-01. On 2026-11-02, das = 32 (development stage)
      const field = {
        cropKey: 'tomato',
        sowingDate: '2026-10-01',
      };
      const weatherDays = [
        { date: '2026-11-02', et0Mm: 5.0, rainMm: 0.0 },
        { date: '2026-11-03', et0Mm: 5.0, rainMm: 12.0 },
      ];

      const needs = buildDailyNeeds(field, weatherDays);
      expect(needs).toHaveLength(2);

      // Day 1: rain 0 -> effective rain 0 -> net need = etc
      expect(needs[0]?.stage).toBe('dev');
      expect(needs[0]?.kc).toBeGreaterThan(0.6);
      expect(needs[0]?.etcMm).toBeGreaterThan(3.0);
      expect(needs[0]?.rainMm).toBe(0.0);
      expect(needs[0]?.effectiveRainMm).toBe(0.0);
      expect(needs[0]?.netNeedMm).toBe(needs[0]?.etcMm);

      // Day 2: rain 12 -> effective rain = 0.8 * (12 - 5) = 5.6 mm
      expect(needs[1]?.rainMm).toBe(12.0);
      expect(needs[1]?.effectiveRainMm).toBe(5.6);
      expect(needs[1]?.netNeedMm).toBe(
        Number(Math.max(0, needs[1]!.etcMm - 5.6).toFixed(2)),
      );
    });

    it('matches hand calculation in docs/science.md (Scenario A: Tomato mid-season, dry day)', () => {
      // Tomato mid-season: day 75 (stageDays: ini 30, dev 40, mid 40)
      // Sown on 2026-08-19, date 2026-11-02 -> das = 75 (mid stage, Kc = 1.15)
      const field = {
        cropKey: 'tomato',
        sowingDate: '2026-08-19',
      };
      const weatherDays = [{ date: '2026-11-02', et0Mm: 5.0, rainMm: 0.0 }];

      const needs = buildDailyNeeds(field, weatherDays);
      expect(needs[0]?.stage).toBe('mid');
      expect(needs[0]?.kc).toBe(1.15);
      expect(needs[0]?.etcMm).toBe(5.75); // 5.0 * 1.15
      expect(needs[0]?.netNeedMm).toBe(5.75);
    });
  });

  describe('planIrrigation & explain', () => {
    it('a rain day gives skip with reason.rain_expected', () => {
      const field = {
        soilType: 'loam' as const,
        method: 'drip' as const,
        areaHa: 1.0,
      };

      const dailyNeeds: DailyNeed[] = [
        {
          date: '2026-11-02',
          das: 75,
          stage: 'mid',
          et0Mm: 5.0,
          kc: 1.15,
          etcMm: 5.75,
          rainMm: 12.0, // Significant rain (> 5mm)
          effectiveRainMm: 5.6,
          netNeedMm: 0.15,
        },
      ];

      const plan = planIrrigation(field, dailyNeeds);
      expect(plan).toHaveLength(1);
      expect(plan[0]?.action).toBe('skip');
      expect(plan[0]?.reasonKey).toBe('reason.rain_expected');
      expect(plan[0]?.params).toEqual({ mm: 12.0 });

      const explanation = explain(plan[0]!);
      expect(explanation.reasonKey).toBe('reason.rain_expected');
      expect(explanation.params.mm).toBe(12.0);
    });

    it('a dry week triggers irrigation on the right day when deficit reaches soil trigger', () => {
      // Sandy soil: trigger is 12 mm, max depth is 25 mm
      const field = {
        soilType: 'sandy' as const,
        method: 'drip' as const,
        areaHa: 1.0,
      };

      // 7 dry days with 4.0 mm daily net need
      const dailyNeeds: DailyNeed[] = Array.from({ length: 7 }, (_, i) => ({
        date: `2026-11-0${i + 1}`,
        das: 50 + i,
        stage: 'mid',
        et0Mm: 4.0,
        kc: 1.0,
        etcMm: 4.0,
        rainMm: 0.0,
        effectiveRainMm: 0.0,
        netNeedMm: 4.0,
      }));

      const plan = planIrrigation(field, dailyNeeds);

      // Day 1: deficit 4 mm < 12 mm -> skip
      expect(plan[0]?.action).toBe('skip');
      expect(plan[0]?.reasonKey).toBe('reason.not_needed');

      // Day 2: deficit 8 mm < 12 mm -> skip
      expect(plan[1]?.action).toBe('skip');

      // Day 3: deficit 12 mm >= 12 mm -> irrigate!
      expect(plan[2]?.action).toBe('irrigate');
      expect(plan[2]?.reasonKey).toBe('reason.deficit_reached');
      expect(plan[2]?.netMm).toBe(12.0);
      // Drip efficiency is 0.90 -> gross = 12 / 0.90 = 13.33 mm
      expect(plan[2]?.grossMm).toBeCloseTo(13.33, 1);
      // 1 ha = 10,000 sqm -> litres = 13.33 * 10,000 = 133,300
      expect(plan[2]?.litres).toBeGreaterThan(130000);

      // Day 4: deficit accumulated back to 4 mm -> skip
      expect(plan[3]?.action).toBe('skip');

      // Day 5: deficit 8 mm -> skip
      expect(plan[4]?.action).toBe('skip');

      // Day 6: deficit 12 mm -> irrigate again!
      expect(plan[5]?.action).toBe('irrigate');
    });

    it('the amount is capped at maxDepth', () => {
      // Sandy soil: trigger 12 mm, maxDepth 25 mm
      const field = {
        soilType: 'sandy' as const,
        method: 'drip' as const,
        areaHa: 1.0,
      };

      // Huge deficit day: net need 35 mm
      const dailyNeeds: DailyNeed[] = [
        {
          date: '2026-11-02',
          das: 60,
          stage: 'mid',
          et0Mm: 35.0,
          kc: 1.0,
          etcMm: 35.0,
          rainMm: 0.0,
          effectiveRainMm: 0.0,
          netNeedMm: 35.0,
        },
      ];

      const plan = planIrrigation(field, dailyNeeds);
      expect(plan[0]?.action).toBe('irrigate');
      // Must be capped at maxDepth (25 mm)
      expect(plan[0]?.netMm).toBe(25);
    });

    it('clay and sandy differ in trigger thresholds', () => {
      // With same 3 days of 5 mm net need (total 15 mm):
      // Sandy trigger is 12 mm -> triggers on day 3
      // Clay trigger is 25 mm -> does NOT trigger on day 3
      const dailyNeeds: DailyNeed[] = Array.from({ length: 3 }, (_, i) => ({
        date: `2026-11-0${i + 1}`,
        das: 50 + i,
        stage: 'mid',
        et0Mm: 5.0,
        kc: 1.0,
        etcMm: 5.0,
        rainMm: 0.0,
        effectiveRainMm: 0.0,
        netNeedMm: 5.0,
      }));

      const sandyPlan = planIrrigation(
        { soilType: 'sandy', method: 'drip', areaHa: 1.0 },
        dailyNeeds,
      );
      const clayPlan = planIrrigation(
        { soilType: 'clay', method: 'drip', areaHa: 1.0 },
        dailyNeeds,
      );

      // On day 3 (total deficit = 15 mm):
      expect(sandyPlan[2]?.action).toBe('irrigate'); // 15 >= 12
      expect(clayPlan[2]?.action).toBe('skip'); // 15 < 25
    });

    it('sensor wet override (moisture >= 80%) skips today even if deficit reached trigger', () => {
      const field = {
        soilType: 'sandy' as const,
        method: 'drip' as const,
        areaHa: 1.0,
      };

      const dailyNeeds: DailyNeed[] = [
        {
          date: '2026-11-02',
          das: 60,
          stage: 'mid',
          et0Mm: 15.0,
          kc: 1.0,
          etcMm: 15.0,
          rainMm: 0.0,
          effectiveRainMm: 0.0,
          netNeedMm: 15.0, // Exceeds sandy trigger (12 mm)
        },
      ];

      // Sensor reports 85% moisture
      const plan = planIrrigation(field, dailyNeeds, undefined, {
        moisturePct: 85,
      });

      expect(plan[0]?.action).toBe('skip');
      expect(plan[0]?.reasonKey).toBe('reason.sensor_wet');
      expect(plan[0]?.params).toEqual({ pct: 85 });
    });

    it('sensor dry override (moisture <= 40%) irrigates now even if deficit is low', () => {
      const field = {
        soilType: 'clay' as const, // trigger is 25 mm
        method: 'drip' as const,
        areaHa: 1.0,
      };

      const dailyNeeds: DailyNeed[] = [
        {
          date: '2026-11-02',
          das: 60,
          stage: 'mid',
          et0Mm: 3.0,
          kc: 1.0,
          etcMm: 3.0,
          rainMm: 0.0,
          effectiveRainMm: 0.0,
          netNeedMm: 3.0, // Low deficit (3 mm << 25 mm trigger)
        },
      ];

      // Sensor reports 35% moisture (dry root zone)
      const plan = planIrrigation(field, dailyNeeds, undefined, {
        moisturePct: 35,
      });

      expect(plan[0]?.action).toBe('irrigate');
      expect(plan[0]?.reasonKey).toBe('reason.sensor_dry');
      expect(plan[0]?.params).toEqual({ pct: 35 });
      expect(plan[0]?.netMm).toBeGreaterThan(0);
    });
  });
});

