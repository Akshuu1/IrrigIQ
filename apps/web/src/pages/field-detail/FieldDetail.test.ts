import { describe, it, expect, beforeAll } from 'vitest';
import i18n, { setAppLanguage } from '../../locales/i18n.js';
import { mmToLitres, computeSavings } from '@irrigiq/shared';
import { formatDepthMm, formatNumber } from '../../utils/formatters.js';

describe('Phase 10: Field Detail Page Science, Advisory & Telemetry Tests', () => {
  beforeAll(async () => {
    await i18n.init();
  });

  describe("Today's Big Answer & Advisory Timing", () => {
    it('formats today big answer with depth, volume in litres and best morning time', () => {
      const areaHa = 1.5;
      const grossMm = 18.0;
      const litres = mmToLitres(grossMm, areaHa); // 18 * 1.5 * 10000 = 270,000 litres

      // English
      setAppLanguage('en');
      const depthEn = formatDepthMm(grossMm, 'en');
      const litresEn = formatNumber(Math.round(litres), 'en');
      const sentenceEn = `Irrigate ${depthEn} (about ${litresEn} litres) today`;
      const bestTimeEn = i18n.t('fieldDetail.todayBestTime');

      expect(sentenceEn).toBe('Irrigate 18 mm (about 2,70,000 litres) today');
      expect(bestTimeEn).toBe('Best time: before 8:00 AM');

      // Hindi
      setAppLanguage('hi');
      const depthHi = formatDepthMm(grossMm, 'hi');
      const litresHi = formatNumber(Math.round(litres), 'hi');
      const sentenceHi = `आज ${depthHi} (लगभग ${litresHi} लीटर) सिंचाई करें`;
      const bestTimeHi = i18n.t('fieldDetail.todayBestTime');

      expect(sentenceHi).toBe('आज 18 मिमी (लगभग 2,70,000 लीटर) सिंचाई करें');
      expect(bestTimeHi).toBe('सर्वोत्तम समय: सुबह 8:00 बजे से पहले');
    });
  });

  describe('7-Day Plan Forecast & Scientific Reasons Table', () => {
    it('correctly maps crop need, forecast rain, and i18n reason parameters', () => {
      setAppLanguage('en');
      const rainExpected = i18n.t('reasons.rain_expected', { mm: 14 });
      expect(rainExpected).toBe(
        'Rain expected (14 mm) — soil moisture will replenish naturally.',
      );

      const deficitReached = i18n.t('reasons.deficit_reached', { mm: 25 });
      expect(deficitReached).toBe(
        'Soil moisture deficit has reached 25 mm trigger threshold.',
      );

      setAppLanguage('hi');
      const rainExpectedHi = i18n.t('reasons.rain_expected', { mm: 14 });
      expect(rainExpectedHi).toBe(
        'बारिश की संभावना है (14 मिमी) — मिट्टी की नमी प्राकृतिक रूप से पूरी होगी।',
      );

      const deficitReachedHi = i18n.t('reasons.deficit_reached', { mm: 25 });
      expect(deficitReachedHi).toBe(
        'मिट्टी में पानी की कमी 25 मिमी की सीमा तक पहुंच गई है।',
      );
    });
  });

  describe('Soil Moisture Telemetry & Threshold Status Chips', () => {
    function getMoistureStatusKey(moisturePct: number): string {
      if (moisturePct <= 40) return 'fieldDetail.moistureDryChip';
      if (moisturePct >= 80) return 'fieldDetail.moistureWetChip';
      return 'fieldDetail.moistureGoodChip';
    }

    it('assigns correct status chips for dry, optimal, and wet thresholds', () => {
      setAppLanguage('en');
      expect(i18n.t(getMoistureStatusKey(32) as any)).toBe('Dry (≤ 40%)');
      expect(i18n.t(getMoistureStatusKey(58) as any)).toBe('Optimal (40–80%)');
      expect(i18n.t(getMoistureStatusKey(85) as any)).toBe('Saturated (≥ 80%)');

      setAppLanguage('hi');
      expect(i18n.t(getMoistureStatusKey(32) as any)).toBe('सूखी (≤ 40%)');
      expect(i18n.t(getMoistureStatusKey(58) as any)).toBe('अनुकूल (40–80%)');
      expect(i18n.t(getMoistureStatusKey(85) as any)).toBe('अत्यधिक नम (≥ 80%)');
    });
  });

  describe('"I Irrigated" Volume & Plan Update Calculations', () => {
    it('computes exact applied volume in litres from farmer applied mm', () => {
      const areaHa = 2.0;
      const appliedMm = 35; // 35 * 2 * 10000 = 700,000 litres
      const litres = mmToLitres(appliedMm, areaHa);
      expect(litres).toBe(700000);
      expect(formatNumber(litres, 'en')).toBe('7,00,000');
    });
  });

  describe('Water Savings Card Calculations', () => {
    it('computes potential and realised savings, honestly reporting negative savings', () => {
      // Scenario 1: Water saved
      const savedScenario = computeSavings({
        daysInRange: 14,
        baseline: { everyDays: 4, depthMm: 40 }, // 3 irrigations * 40mm = 120mm gross = 120,000 L/ha
        areaHa: 1.0,
        recommendedGrossMmList: [30, 30], // 60mm gross = 60,000 L/ha (50% savings)
        actualGrossMmList: [35, 35], // 70mm gross = 70,000 L/ha (41.7% savings)
      });

      expect(savedScenario.potentialSaved.litres).toBe(600000);
      expect(savedScenario.potentialSaved.pct).toBe(50);
      expect(savedScenario.realisedSaved.litres).toBe(500000);
      expect(savedScenario.realisedSaved.pct).toBeCloseTo(41.7, 1);

      // Scenario 2: Over-irrigation (negative savings reported honestly)
      const overIrrigation = computeSavings({
        daysInRange: 10,
        baseline: { everyDays: 5, depthMm: 30 }, // 2 * 30mm = 60mm gross = 600,000 L/ha
        areaHa: 1.0,
        recommendedGrossMmList: [20], // 200,000 L/ha
        actualGrossMmList: [50, 50], // 100mm gross = 1,000,000 L/ha
      });

      expect(overIrrigation.realisedSaved.litres).toBe(-400000);
      expect(overIrrigation.realisedSaved.pct).toBeCloseTo(-66.7, 1);
    });
  });
});
