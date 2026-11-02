import { describe, it, expect } from 'vitest';
import {
  calculateDaysInRange,
  countBaselineIrrigations,
  baselineTotal,
  computeSavings,
} from './savings.js';

describe('Savings Pure Science & Helpers', () => {
  describe('calculateDaysInRange', () => {
    it('calculates inclusive calendar days correctly', () => {
      expect(calculateDaysInRange('2026-11-01', '2026-11-09')).toBe(9);
      expect(calculateDaysInRange('2026-11-01', '2026-11-01')).toBe(1);
      expect(calculateDaysInRange('2026-11-01', '2026-11-30')).toBe(30);
    });

    it('works with Date objects', () => {
      const from = new Date('2026-11-01T00:00:00.000Z');
      const to = new Date('2026-11-05T00:00:00.000Z');
      expect(calculateDaysInRange(from, to)).toBe(5);
    });

    it('throws error when to is before from', () => {
      expect(() => calculateDaysInRange('2026-11-10', '2026-11-01')).toThrow(/Invalid date range/i);
    });

    it('throws error on invalid date strings', () => {
      expect(() => calculateDaysInRange('invalid-date', '2026-11-01')).toThrow(
        /Invalid date format/i,
      );
    });
  });

  describe('countBaselineIrrigations', () => {
    it('returns 0 when days in range is less than everyDays', () => {
      expect(countBaselineIrrigations(2, 4)).toBe(0);
      expect(countBaselineIrrigations(0, 3)).toBe(0);
      expect(countBaselineIrrigations(-5, 3)).toBe(0);
    });

    it('returns floor of days divided by everyDays', () => {
      expect(countBaselineIrrigations(9, 3)).toBe(3);
      expect(countBaselineIrrigations(10, 3)).toBe(3);
      expect(countBaselineIrrigations(11, 4)).toBe(2);
      expect(countBaselineIrrigations(12, 4)).toBe(3);
    });
  });

  describe('baselineTotal', () => {
    it('calculates baseline mm and litres for a worked example', () => {
      // 9 days, every 3 days, 30 mm depth, 1.0 ha
      const res = baselineTotal(9, { everyDays: 3, depthMm: 30 }, 1.0);
      expect(res.count).toBe(3);
      expect(res.depthMm).toBe(30);
      expect(res.totalMm).toBe(90);
      expect(res.litres).toBe(900000); // 90 mm * 1.0 ha * 10,000 = 900,000 L
    });

    it('returns 0 irrigations when daysInRange is shorter than everyDays', () => {
      // 2 days, every 4 days, 25 mm, 0.5 ha
      const res = baselineTotal(2, { everyDays: 4, depthMm: 25 }, 0.5);
      expect(res.count).toBe(0);
      expect(res.totalMm).toBe(0);
      expect(res.litres).toBe(0);
    });

    it('validates negative inputs', () => {
      expect(() => baselineTotal(5, { everyDays: 3, depthMm: 20 }, -1)).toThrow(
        /areaHa must be non-negative/i,
      );
      expect(() => baselineTotal(5, { everyDays: -3, depthMm: 20 }, 1)).toThrow(
        /Baseline parameters must be non-negative/i,
      );
    });
  });

  describe('computeSavings', () => {
    it('matches manual calculation for worked example with savings', () => {
      // Field: 1.0 ha. Range: 9 days.
      // Baseline: every 3 days @ 30 mm -> 3 irrigations = 90 mm, 900,000 L.
      // Recommended: 2 irrigations [20, 20] -> 40 mm, 400,000 L.
      // Actual logs: 1 irrigation [35] -> 35 mm, 350,000 L.
      const savings = computeSavings({
        daysInRange: 9,
        baseline: { everyDays: 3, depthMm: 30 },
        areaHa: 1.0,
        recommendedGrossMmList: [20, 20],
        actualGrossMmList: [35],
      });

      expect(savings.days).toBe(9);

      // Baseline
      expect(savings.baseline.count).toBe(3);
      expect(savings.baseline.totalMm).toBe(90);
      expect(savings.baseline.litres).toBe(900000);

      // Recommended
      expect(savings.recommended.count).toBe(2);
      expect(savings.recommended.totalMm).toBe(40);
      expect(savings.recommended.litres).toBe(400000);

      // Actual
      expect(savings.actual.count).toBe(1);
      expect(savings.actual.totalMm).toBe(35);
      expect(savings.actual.litres).toBe(350000);

      // Potential savings (900,000 - 400,000 = 500,000 L, 55.56%)
      expect(savings.potentialSaved.mm).toBe(50);
      expect(savings.potentialSaved.litres).toBe(500000);
      expect(savings.potentialSaved.pct).toBe(55.56);

      // Realised savings (900,000 - 350,000 = 550,000 L, 61.11%)
      expect(savings.realisedSaved.mm).toBe(55);
      expect(savings.realisedSaved.litres).toBe(550000);
      expect(savings.realisedSaved.pct).toBe(61.11);
    });

    it('handles baseline with zero irrigations correctly', () => {
      // 2 days range, every 4 days -> 0 baseline irrigations
      const savings = computeSavings({
        daysInRange: 2,
        baseline: { everyDays: 4, depthMm: 25 },
        areaHa: 1.0,
        recommendedGrossMmList: [],
        actualGrossMmList: [],
      });

      expect(savings.baseline.count).toBe(0);
      expect(savings.baseline.totalMm).toBe(0);
      expect(savings.baseline.litres).toBe(0);
      expect(savings.potentialSaved.litres).toBe(0);
      expect(savings.potentialSaved.pct).toBe(0);
      expect(savings.realisedSaved.litres).toBe(0);
      expect(savings.realisedSaved.pct).toBe(0);
    });

    it('handles scenario with no actual logs (100% realised savings)', () => {
      // 9 days, 1.0 ha, baseline 90 mm (900,000 L), recommended 40 mm (400,000 L), 0 logs
      const savings = computeSavings({
        daysInRange: 9,
        baseline: { everyDays: 3, depthMm: 30 },
        areaHa: 1.0,
        recommendedGrossMmList: [20, 20],
        actualGrossMmList: [],
      });

      expect(savings.actual.count).toBe(0);
      expect(savings.actual.totalMm).toBe(0);
      expect(savings.actual.litres).toBe(0);

      // Realised saved is 100% of baseline
      expect(savings.realisedSaved.mm).toBe(90);
      expect(savings.realisedSaved.litres).toBe(900000);
      expect(savings.realisedSaved.pct).toBe(100);
    });

    it('reports negative savings honestly when actual logs exceed baseline', () => {
      // Baseline: 9 days, every 3 days @ 30 mm = 90 mm (900,000 L).
      // Actual logs: 3 irrigations of 40 mm each = 120 mm (1,200,000 L).
      const savings = computeSavings({
        daysInRange: 9,
        baseline: { everyDays: 3, depthMm: 30 },
        areaHa: 1.0,
        recommendedGrossMmList: [20, 20],
        actualGrossMmList: [40, 40, 40],
      });

      expect(savings.actual.count).toBe(3);
      expect(savings.actual.totalMm).toBe(120);
      expect(savings.actual.litres).toBe(1200000);

      // Realised savings: 900,000 - 1,200,000 = -300,000 L (-33.33%)
      expect(savings.realisedSaved.mm).toBe(-30);
      expect(savings.realisedSaved.litres).toBe(-300000);
      expect(savings.realisedSaved.pct).toBe(-33.33);
    });
  });
});
