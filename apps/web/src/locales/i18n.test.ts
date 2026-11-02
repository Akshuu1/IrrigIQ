import { describe, it, expect } from 'vitest';
import en from './en.json';
import hi from './hi.json';

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

describe('i18n Translation Parity Tests', () => {
  const enKeys = getDeepKeys(en);
  const hiKeys = getDeepKeys(hi);

  it('fails if any key exists in en but not in hi', () => {
    const missingInHi = enKeys.filter((key) => !hiKeys.includes(key));
    expect(
      missingInHi,
      `Keys present in en.json but missing in hi.json: ${missingInHi.join(', ')}`,
    ).toEqual([]);
  });

  it('fails if any key exists in hi but not in en', () => {
    const missingInEn = hiKeys.filter((key) => !enKeys.includes(key));
    expect(
      missingInEn,
      `Keys present in hi.json but missing in en.json: ${missingInEn.join(', ')}`,
    ).toEqual([]);
  });

  it('ensures no translation values in hi.json are empty strings', () => {
    function checkNonEmpty(obj: Record<string, unknown>, path = '') {
      for (const [k, v] of Object.entries(obj)) {
        const full = path ? `${path}.${k}` : k;
        if (typeof v === 'string') {
          expect(v.trim().length, `Empty translation for key "${full}" in hi.json`).toBeGreaterThan(
            0,
          );
        } else if (v && typeof v === 'object') {
          checkNonEmpty(v as Record<string, unknown>, full);
        }
      }
    }
    checkNonEmpty(hi);
  });

  it('demonstrates that a key in en missing from hi triggers a failure', () => {
    const dummyEnKeys = [...enKeys, 'demo.missing_in_hi'];
    const missing = dummyEnKeys.filter((k) => !hiKeys.includes(k));
    expect(missing).toContain('demo.missing_in_hi');
  });
});
