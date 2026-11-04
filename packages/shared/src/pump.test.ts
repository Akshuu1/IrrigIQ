import { describe, it, expect } from 'vitest';
import {
  bucketTestToLph,
  runMinutes,
  formatDuration,
  pumpCost,
  PUMP_CONFIG,
} from './pump.js';

describe('Phase 16: Pump Pure Functions & Limits', () => {
  describe('PUMP_CONFIG Agronomy & Hardware Limits', () => {
    it('contains versioned agronomic sources and verification flags', () => {
      expect(PUMP_CONFIG.version).toBe('1.0.0');
      expect(PUMP_CONFIG.minDischargeLph.value).toBe(500);
      expect(PUMP_CONFIG.minDischargeLph.source).toBeTruthy();
      expect(PUMP_CONFIG.minDischargeLph.verified).toBe(false);

      expect(PUMP_CONFIG.maxDischargeLph.value).toBe(200000);
      expect(PUMP_CONFIG.maxDischargeLph.source).toBeTruthy();
      expect(PUMP_CONFIG.maxDischargeLph.verified).toBe(false);

      expect(PUMP_CONFIG.maxSingleRunMinutes.value).toBe(720);
      expect(PUMP_CONFIG.maxSingleRunMinutes.source).toBeTruthy();
      expect(PUMP_CONFIG.maxSingleRunMinutes.verified).toBe(false);
    });
  });

  describe('bucketTestToLph (Table-driven tests)', () => {
    const validCases = [
      { bucketLitres: 20, seconds: 4, expectedLph: 18000, desc: 'canonical 20L in 4s' },
      { bucketLitres: 15, seconds: 5, expectedLph: 10800, desc: '15L in 5s' },
      { bucketLitres: 20, seconds: 144, expectedLph: 500, desc: 'lower limit boundary: 500 L/h' },
      { bucketLitres: 100, seconds: 1.8, expectedLph: 200000, desc: 'upper limit boundary: 200,000 L/h' },
      { bucketLitres: 10, seconds: 6, expectedLph: 6000, desc: '10L in 6s' },
    ];

    validCases.forEach(({ bucketLitres, seconds, expectedLph, desc }) => {
      it(`calculates correct L/h for ${desc}`, () => {
        const lph = bucketTestToLph(bucketLitres, seconds);
        expect(lph).toBe(expectedLph);
      });
    });

    it('rejects invalid or non-positive seconds', () => {
      expect(() => bucketTestToLph(20, 0)).toThrow('Seconds must be greater than 0');
      expect(() => bucketTestToLph(20, -5)).toThrow('Seconds must be greater than 0');
      expect(() => bucketTestToLph(20, NaN)).toThrow('Seconds must be greater than 0');
    });

    it('rejects non-positive bucket capacity', () => {
      expect(() => bucketTestToLph(0, 4)).toThrow('Bucket volume in litres must be greater than 0');
      expect(() => bucketTestToLph(-10, 4)).toThrow('Bucket volume in litres must be greater than 0');
    });

    it('rejects discharge rates below minimum threshold (< 500 L/h)', () => {
      // 5 L in 60 s = 300 L/h
      expect(() => bucketTestToLph(5, 60)).toThrow(/Discharge rate must be between 500 and 200000 L\/h/);
    });

    it('rejects discharge rates above maximum threshold (> 200,000 L/h)', () => {
      // 1000 L in 10 s = 360,000 L/h
      expect(() => bucketTestToLph(1000, 10)).toThrow(/Discharge rate must be between 500 and 200000 L\/h/);
    });
  });

  describe('runMinutes (Table-driven tests)', () => {
    const cases = [
      {
        grossLitres: 31950,
        dischargeLph: 18000,
        expectedMinutes: 107,
        expectedSplit: false,
        desc: 'Tomato canonical example: 31,950 L at 18,000 L/h = 106.5m -> 107m',
      },
      {
        grossLitres: 0,
        dischargeLph: 18000,
        expectedMinutes: 0,
        expectedSplit: false,
        desc: '0 litres gives 0 minutes',
      },
      {
        grossLitres: 216000,
        dischargeLph: 18000,
        expectedMinutes: 720,
        expectedSplit: false,
        desc: 'Exactly 720 minutes (12 hours) does not trigger splitAcrossDays',
      },
      {
        grossLitres: 216300,
        dischargeLph: 18000,
        expectedMinutes: 721,
        expectedSplit: true,
        desc: '721 minutes (> 720 min) sets splitAcrossDays = true',
      },
      {
        grossLitres: 360000,
        dischargeLph: 18000,
        expectedMinutes: 1200,
        expectedSplit: true,
        desc: 'Long run (1200 min) sets splitAcrossDays = true',
      },
    ];

    cases.forEach(({ grossLitres, dischargeLph, expectedMinutes, expectedSplit, desc }) => {
      it(desc, () => {
        const result = runMinutes(grossLitres, dischargeLph);
        expect(result.minutes).toBe(expectedMinutes);
        expect(result.splitAcrossDays).toBe(expectedSplit);
        // Numeric coercion works as expected
        expect(Number(result)).toBe(expectedMinutes);
      });
    });

    it('handles negative gross litres gracefully by returning 0', () => {
      const result = runMinutes(-500, 18000);
      expect(result.minutes).toBe(0);
      expect(result.splitAcrossDays).toBe(false);
    });

    it('rejects invalid or non-positive dischargeLph', () => {
      expect(() => runMinutes(10000, 0)).toThrow('Pump discharge rate must be greater than 0 L/h');
      expect(() => runMinutes(10000, -100)).toThrow('Pump discharge rate must be greater than 0 L/h');
    });
  });

  describe('formatDuration (i18n and key substitution)', () => {
    const cases = [
      { minutes: 107, lang: 'en' as const, expected: '1 h 47 min', desc: 'canonical tomato 107 min in English' },
      { minutes: 107, lang: 'hi' as const, expected: '1 घंटा 47 मिनट', desc: 'canonical tomato 107 min in Hindi' },
      { minutes: 0, lang: 'en' as const, expected: '0 min', desc: '0 min in English' },
      { minutes: 0, lang: 'hi' as const, expected: '0 मिनट', desc: '0 min in Hindi' },
      { minutes: 60, lang: 'en' as const, expected: '1 h', desc: 'exact 1 hour in English' },
      { minutes: 120, lang: 'hi' as const, expected: '2 घंटा', desc: 'exact 2 hours in Hindi' },
      { minutes: 45, lang: 'en' as const, expected: '45 min', desc: 'minutes only in English' },
      { minutes: 45, lang: 'hi' as const, expected: '45 मिनट', desc: 'minutes only in Hindi' },
      { minutes: 725, lang: 'en' as const, expected: '12 h 5 min', desc: '12h 5min in English' },
    ];

    cases.forEach(({ minutes, lang, expected, desc }) => {
      it(`formats ${desc}`, () => {
        expect(formatDuration(minutes, lang)).toBe(expected);
      });
    });
  });

  describe('pumpCost', () => {
    it('calculates cost from minutes and cost per hour', () => {
      // 107 minutes at 50/hour = (107/60)*50 = 89.1666... -> 89.17
      const cost = pumpCost(107, 50);
      expect(cost).toBe(89.17);
    });

    it('accepts PumpRunResult object directly', () => {
      const run = runMinutes(31950, 18000); // 107 minutes
      const cost = pumpCost(run, 60); // (107/60)*60 = 107
      expect(cost).toBe(107);
    });

    it('returns 0 if runMinutes is 0', () => {
      expect(pumpCost(0, 100)).toBe(0);
    });

    it('returns null if costPerHour is null or undefined', () => {
      expect(pumpCost(107, undefined)).toBeNull();
      expect(pumpCost(107, null)).toBeNull();
    });

    it('rejects negative costPerHour', () => {
      expect(() => pumpCost(107, -20)).toThrow('Cost per hour cannot be negative');
    });
  });
});

