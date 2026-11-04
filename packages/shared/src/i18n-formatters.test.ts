import { describe, it, expect } from 'vitest';
import {
  formatNumber,
  formatDate,
  getScriptNumberingSystem,
  getLocaleForLanguage,
  pseudoLocalize,
  getCropName,
  CROPS,
  formatDuration,
  formatArea,
} from './index.js';

describe('Phase 22 i18n Formatters, Numbers & Pseudo-localisation Tests', () => {
  describe('Script Numbering Systems & Locales', () => {
    it('returns correct numbering system for each language', () => {
      expect(getScriptNumberingSystem('en')).toBe('latn');
      expect(getScriptNumberingSystem('hi')).toBe('deva');
      expect(getScriptNumberingSystem('mr')).toBe('deva');
      expect(getScriptNumberingSystem('pa')).toBe('guru');
      expect(getScriptNumberingSystem('te')).toBe('telu');
    });

    it('returns correct BCP-47 locale tags', () => {
      expect(getLocaleForLanguage('en')).toBe('en-IN');
      expect(getLocaleForLanguage('hi')).toBe('hi-IN');
      expect(getLocaleForLanguage('mr')).toBe('mr-IN');
      expect(getLocaleForLanguage('pa')).toBe('pa-IN');
      expect(getLocaleForLanguage('te')).toBe('te-IN');
    });
  });

  describe('formatNumber: Latin vs Native Digits', () => {
    const num = 12345.6;

    it('formats with Latin digits by default or when numberingSystem is latn', () => {
      expect(formatNumber(num, { lang: 'en' })).toBe('12,345.6');
      expect(formatNumber(num, { lang: 'hi', numberingSystem: 'latn' })).toBe('12,345.6');
      expect(formatNumber(num, { lang: 'mr', numberingSystem: 'latn' })).toBe('12,345.6');
      expect(formatNumber(num, { lang: 'pa', numberingSystem: 'latn' })).toBe('12,345.6');
      expect(formatNumber(num, { lang: 'te', numberingSystem: 'latn' })).toBe('12,345.6');
    });

    it('formats with Native script digits when useNativeDigits is true or numberingSystem is native', () => {
      // Devanagari (Hindi, Marathi)
      const hiNative = formatNumber(num, { lang: 'hi', useNativeDigits: true });
      expect(hiNative).toBe('१२,३४५.६');

      const mrNative = formatNumber(num, { lang: 'mr', numberingSystem: 'native' });
      expect(mrNative).toBe('१२,३४५.६');

      // Gurmukhi (Punjabi)
      const paNative = formatNumber(num, { lang: 'pa', useNativeDigits: true });
      expect(paNative).toBe('੧੨,੩੪੫.੬');

      // Telugu
      const teNative = formatNumber(num, { lang: 'te', numberingSystem: 'native' });
      expect(teNative).toBe('౧౨,౩౪౫.౬');
    });

    it('handles NaN and decimals correctly', () => {
      expect(formatNumber(NaN)).toBe('0');
      expect(formatNumber(10, { decimals: 2 })).toBe('10.00');
    });
  });

  describe('formatDate: Latin vs Native Digits', () => {
    const testDate = new Date('2026-11-04T12:00:00Z');

    it('formats date with Latin digits by default', () => {
      const enDate = formatDate(testDate, { lang: 'en' });
      expect(enDate).toContain('2026');
    });

    it('formats date with Native digits when requested', () => {
      // In Devanagari 2026 is २०२६
      const mrDate = formatDate(testDate, { lang: 'mr', numberingSystem: 'native' });
      expect(mrDate).toContain('२०२६');

      // In Gurmukhi 2026 is ੨੦੨੬
      const paDate = formatDate(testDate, { lang: 'pa', useNativeDigits: true });
      expect(paDate).toContain('੨੦੨੬');

      // In Telugu 2026 is ౨౦౨౬
      const teDate = formatDate(testDate, { lang: 'te', numberingSystem: 'native' });
      expect(teDate).toContain('౨౦౨౬');
    });
  });

  describe('Crop Localized Names (All 5 Languages)', () => {
    it('returns crop name in all 5 languages accurately', () => {
      const wheat = CROPS.find((c) => c.key === 'wheat')!;
      expect(getCropName(wheat, 'en')).toBe('Wheat');
      expect(getCropName(wheat, 'hi')).toBe('गेहूं');
      expect(getCropName(wheat, 'mr')).toBe('गहू');
      expect(getCropName(wheat, 'pa')).toBe('ਕਣਕ');
      expect(getCropName(wheat, 'te')).toBe('గోధుమ');

      const tomato = CROPS.find((c) => c.key === 'tomato')!;
      expect(getCropName(tomato, 'en')).toBe('Tomato');
      expect(getCropName(tomato, 'hi')).toBe('टमाटर');
      expect(getCropName(tomato, 'mr')).toBe('टोमॅटो');
      expect(getCropName(tomato, 'pa')).toBe('ਟਮਾਟਰ');
      expect(getCropName(tomato, 'te')).toBe('టమోటా');
    });
  });

  describe('formatDuration: All 5 Languages', () => {
    it('formats durations in mr, pa, and te', () => {
      // 107 minutes = 1h 47m
      expect(formatDuration(107, 'mr')).toBe('1 तास 47 मिनिटे');
      expect(formatDuration(107, 'pa')).toBe('1 ਘੰਟੇ 47 ਮਿੰਟ');
      expect(formatDuration(107, 'te')).toBe('1 గంటల 47 నిమిషాలు');

      // 60 minutes = 1h
      expect(formatDuration(60, 'mr')).toBe('1 तास');
      expect(formatDuration(60, 'pa')).toBe('1 ਘੰਟੇ');
      expect(formatDuration(60, 'te')).toBe('1 గంటలు');

      // 0 minutes = 0
      expect(formatDuration(0, 'mr')).toBe('0 मिनिटे');
      expect(formatDuration(0, 'pa')).toBe('0 ਮਿੰਟ');
      expect(formatDuration(0, 'te')).toBe('0 నిమిషాలు');
    });
  });

  describe('formatArea: All 5 Languages & Native Digits', () => {
    it('formats area with translated units across all languages', () => {
      expect(formatArea(1, 'acre', 'mr')).toBe('2.47 एकर');
      expect(formatArea(1, 'ha', 'mr')).toBe('1.00 हेक्टर');

      expect(formatArea(1, 'acre', 'pa')).toBe('2.47 ਏਕੜ');
      expect(formatArea(1, 'ha', 'pa')).toBe('1.00 ਹੈਕਟੇਅਰ');

      expect(formatArea(1, 'acre', 'te')).toBe('2.47 ఎకరాలు');
      expect(formatArea(1, 'ha', 'te')).toBe('1.00 హెక్టార్లు');
    });

    it('formats area with native script digits', () => {
      const res = formatArea(1, 'ha', { locale: 'mr-IN', useNativeDigits: true });
      expect(res).toBe('१.०० हेक्टर');
    });
  });

  describe('pseudoLocalize: Layout Testing Mode', () => {
    it('expands English text and wraps in delimiters', () => {
      const original = 'Irrigation Advisory';
      const pseudo = pseudoLocalize(original);
      expect(pseudo).toMatch(/^\[!!! .* !!!\]$/);
      expect(pseudo.length).toBeGreaterThan(original.length * 1.2);
    });

    it('preserves interpolation tokens intact', () => {
      const template = 'Run pump for {{duration}} minutes in {field}';
      const pseudo = pseudoLocalize(template);
      expect(pseudo).toContain('{{duration}}');
      expect(pseudo).toContain('{field}');
      expect(pseudo.startsWith('[!!!')).toBe(true);
    });
  });
});
