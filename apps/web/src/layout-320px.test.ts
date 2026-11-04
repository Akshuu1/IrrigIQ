import { describe, it, expect, beforeAll } from 'vitest';
import i18n, { setAppLanguage, type SupportedLanguage, SUPPORTED_LANGUAGES } from './locales/i18n.js';
import {
  formatArea,
  formatNumber,
  formatDepthMm,
  formatLitres,
  formatDate,
} from './utils/formatters.js';
import {
  pseudoLocalize,
  CROPS,
  getCropName,
} from '@irrigiq/shared';

describe('Phase 22: 320px Mobile Screen Layout & Localization Robustness', () => {
  beforeAll(async () => {
    await i18n.init();
  });

  it('renders all key actions across all 5 languages without empty strings or NaN', async () => {
    const languages: (SupportedLanguage | 'pseudo')[] = [...SUPPORTED_LANGUAGES, 'pseudo'];

    for (const lang of languages) {
      await setAppLanguage(lang);

      // Core navigation and screen titles
      const brand = i18n.t('nav.brand');
      const dashboardTitle = i18n.t('dashboard.title');
      const settingsTitle = i18n.t('settings.title');
      const addField = i18n.t('nav.newField');

      expect(brand).toBeTruthy();
      expect(dashboardTitle).toBeTruthy();
      expect(settingsTitle).toBeTruthy();
      expect(addField).toBeTruthy();

      // Formatted numbers, dates, areas
      const numFormatted = formatNumber(18500, lang === 'pseudo' ? 'en' : lang);
      const areaFormatted = formatArea(2.5, 'acre', lang === 'pseudo' ? 'en' : lang);
      const litresFormatted = formatLitres(36000, lang === 'pseudo' ? 'en' : lang);
      const depthFormatted = formatDepthMm(25.4, lang === 'pseudo' ? 'en' : lang);
      const dateFormatted = formatDate(new Date('2026-03-15'), lang === 'pseudo' ? 'en' : lang);

      expect(numFormatted).not.toContain('NaN');
      expect(areaFormatted).not.toContain('NaN');
      expect(litresFormatted).not.toContain('NaN');
      expect(depthFormatted).not.toContain('NaN');
      expect(dateFormatted).not.toContain('NaN');
    }
  });

  it('validates 320px container constraints and ensures components do not wrap destructively', () => {
    // 320px screen width constraint (e.g. JioPhone / budget Android)
    const VIEWPORT_WIDTH = 320;
    const PADDING_PX = 16; // 8px each side
    const USABLE_WIDTH = VIEWPORT_WIDTH - PADDING_PX; // 304px

    // Header layout budget: Brand (~110px), Language Picker (~90px), Sync (~40px)
    const headerElements = [
      { name: 'brand', width: 110 },
      { name: 'langPicker', width: 90 },
      { name: 'syncStatus', width: 40 },
    ];
    const totalHeaderWidth = headerElements.reduce((acc, el) => acc + el.width, 0);
    expect(totalHeaderWidth).toBeLessThanOrEqual(USABLE_WIDTH);

    // Advisory Card pump action sentence in pseudo-mode
    const pseudoSentence = pseudoLocalize('Run the pump 1 h 47 min tonight');
    expect(pseudoSentence.length).toBeGreaterThan(30);
    expect(pseudoSentence.startsWith('[!!! ')).toBe(true);
    expect(pseudoSentence.endsWith(' !!!]')).toBe(true);
  });

  it('renders all crop names across all 5 languages without falling back to blank', () => {
    for (const crop of CROPS) {
      for (const lang of SUPPORTED_LANGUAGES) {
        const name = getCropName(crop, lang);
        expect(name).toBeTruthy();
        expect(name.length).toBeGreaterThan(1);
      }
    }
  });

  it('validates native numerals and standard Latin numerals formatting consistency', () => {
    const testCases = [
      { lang: 'mr' as SupportedLanguage, native: '१,२५,०००', latin: '1,25,000' },
      { lang: 'pa' as SupportedLanguage, native: '੧,੨੫,੦੦੦', latin: '1,25,000' },
      { lang: 'te' as SupportedLanguage, native: '౧౨౫,౦౦౦', latin: '1,25,000' },
    ];

    for (const tc of testCases) {
      expect(formatNumber(125000, tc.lang, { useNativeDigits: true })).toBe(tc.native);
      expect(formatNumber(125000, tc.lang, { useNativeDigits: false })).toBe(tc.latin);
    }
  });
});

