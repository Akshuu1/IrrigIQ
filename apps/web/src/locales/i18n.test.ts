import { describe, it, expect } from 'vitest';
import i18n, { SUPPORTED_LANGUAGES, setAppLanguage } from './i18n.js';
import en from './en.json';
import hi from './hi.json';
import mr from './mr.json';
import pa from './pa.json';
import te from './te.json';

function getDeepKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  let keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      keys = keys.concat(getDeepKeys(value as Record<string, unknown>, fullPath));
    } else {
      keys.push(fullPath);
    }
  }
  return keys;
}

function checkNonEmpty(obj: Record<string, unknown>, langName: string, path = '') {
  for (const [k, v] of Object.entries(obj)) {
    const full = path ? `${path}.${k}` : k;
    if (typeof v === 'string') {
      expect(
        v.trim().length,
        `Empty translation for key "${full}" in ${langName}.json`,
      ).toBeGreaterThan(0);
    } else if (v && typeof v === 'object') {
      checkNonEmpty(v as Record<string, unknown>, langName, full);
    }
  }
}

describe('Phase 22 i18n Translation Parity & Fallback Tests', () => {
  const enKeys = getDeepKeys(en);
  const langPacks = { hi, mr, pa, te };

  it('verifies supported languages list contains all 5 required languages', () => {
    expect(SUPPORTED_LANGUAGES).toEqual(['en', 'hi', 'mr', 'pa', 'te']);
  });

  describe('Key Parity Across All 5 Languages', () => {
    Object.entries(langPacks).forEach(([lang, pack]) => {
      it(`fails if any key exists in en.json but not in ${lang}.json`, () => {
        const langKeys = getDeepKeys(pack);
        const missing = enKeys.filter((key) => !langKeys.includes(key));
        expect(
          missing,
          `Keys present in en.json but missing in ${lang}.json: ${missing.join(', ')}`,
        ).toEqual([]);
      });

      it(`fails if any key exists in ${lang}.json but not in en.json`, () => {
        const langKeys = getDeepKeys(pack);
        const extra = langKeys.filter((key) => !enKeys.includes(key));
        expect(
          extra,
          `Keys present in ${lang}.json but missing in en.json: ${extra.join(', ')}`,
        ).toEqual([]);
      });

      it(`ensures no translation values in ${lang}.json are empty strings`, () => {
        checkNonEmpty(pack, lang);
      });
    });
  });

  describe('Fallback Chain Tests', () => {
    it('falls back mr -> hi -> en when a key is absent in mr', () => {
      // In i18n instance, simulate a missing key in mr that exists in hi
      i18n.addResource('hi', 'translation', 'test_key_shared_hi', 'हिंदी सांझा टेक्स्ट');
      i18n.addResource('en', 'translation', 'test_key_shared_hi', 'English Fallback Text');

      setAppLanguage('mr');
      expect(i18n.t('test_key_shared_hi')).toBe('हिंदी सांझा टेक्स्ट');

      // Key missing in mr and hi, exists only in en
      i18n.addResource('en', 'translation', 'test_key_en_only', 'English Only Text');
      expect(i18n.t('test_key_en_only')).toBe('English Only Text');
    });

    it('falls back pa -> hi -> en when a key is absent in pa', () => {
      setAppLanguage('pa');
      expect(i18n.t('test_key_shared_hi')).toBe('हिंदी सांझा टेक्स्ट');
      expect(i18n.t('test_key_en_only')).toBe('English Only Text');
    });

    it('falls back te -> en when a key is absent in te (bypassing hi)', () => {
      setAppLanguage('te');
      // te does NOT fallback to hi, it falls directly back to en
      expect(i18n.t('test_key_shared_hi')).toBe('English Fallback Text');
      expect(i18n.t('test_key_en_only')).toBe('English Only Text');
    });
  });

  describe('Pseudo-localisation Mode', () => {
    it('renders pseudo-localised text when pseudo mode is enabled', () => {
      setAppLanguage('pseudo');
      const translated = i18n.t('nav.dashboard');
      expect(translated.startsWith('[!!!')).toBe(true);
      expect(translated.endsWith('!!!]')).toBe(true);
      expect(translated.length).toBeGreaterThan(en.nav.dashboard.length);
    });
  });
});
