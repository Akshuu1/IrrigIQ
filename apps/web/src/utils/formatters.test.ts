import { describe, it, expect } from 'vitest';
import { formatNumber, formatDate, formatArea, formatLitres, formatDepthMm } from './formatters.js';

describe('Localization Formatters', () => {
  it('formats numbers with Indian grouping in English and Hindi', () => {
    const num = 125000;
    const enFormatted = formatNumber(num, 'en');
    const hiFormatted = formatNumber(num, 'hi');
    expect(enFormatted).toBe('1,25,000');
    expect(hiFormatted).toBe('1,25,000');
  });

  it('formats dates in English and Hindi', () => {
    const date = new Date('2026-03-15T00:00:00.000Z');
    const enFormatted = formatDate(date, 'en');
    const hiFormatted = formatDate(date, 'hi');
    expect(enFormatted).toContain('2026');
    expect(hiFormatted).toContain('2026');
  });

  it('formats land area in acre and hectare for both languages', () => {
    // 1 ha = ~2.471 acres
    const enAcre = formatArea(1, 'acre', 'en');
    const hiAcre = formatArea(1, 'acre', 'hi');
    const enHa = formatArea(1, 'ha', 'en');
    const hiHa = formatArea(1, 'ha', 'hi');

    expect(enAcre).toBe('2.47 acre');
    expect(hiAcre).toBe('2.47 एकड़');
    expect(enHa).toBe('1.00 ha');
    expect(hiHa).toBe('1.00 हेक्टेयर');
  });

  it('formats water volume in litres across languages', () => {
    expect(formatLitres(36000, 'en')).toBe('36,000 litres');
    expect(formatLitres(36000, 'hi')).toBe('36,000 लीटर');
    expect(formatLitres(36000, 'mr')).toBe('36,000 लिटर');
    expect(formatLitres(36000, 'pa')).toBe('36,000 ਲੀਟਰ');
    expect(formatLitres(36000, 'te')).toBe('36,000 లీటర్లు');
  });

  it('formats depth in mm across languages', () => {
    expect(formatDepthMm(18.5, 'en')).toBe('18.5 mm');
    expect(formatDepthMm(18.5, 'hi')).toBe('18.5 मिमी');
    expect(formatDepthMm(18.5, 'mr')).toBe('18.5 मिमी');
    expect(formatDepthMm(18.5, 'pa')).toBe('18.5 ਮਿ.ਮੀ.');
    expect(formatDepthMm(18.5, 'te')).toBe('18.5 మిమీ');
  });

  it('supports native digits in Marathi, Punjabi, Telugu', () => {
    expect(formatNumber(125000, 'mr', { useNativeDigits: true })).toBe('१,२५,०००');
    expect(formatNumber(125000, 'pa', { useNativeDigits: true })).toBe('੧,੨੫,੦੦੦');
    expect(formatNumber(125000, 'te', { useNativeDigits: true })).toBe('౧౨౫,౦౦౦');
  });
});
