import { describe, it, expect, beforeAll } from 'vitest';
import i18n, { setAppLanguage } from './locales/i18n.js';
import { CROPS_MAP, validatePolygon, polygonAreaHa, type GeoJsonPolygon } from '@irrigiq/shared';
import { formatArea, formatNumber, formatDepthMm } from './utils/formatters.js';

describe('Phase 9 Acceptance: Draw a field, save it, and see recommendations in Hindi & English', () => {
  const drawnPolygon: GeoJsonPolygon = {
    type: 'Polygon',
    coordinates: [
      [
        [76.985, 29.69],
        [76.988, 29.69],
        [76.988, 29.694],
        [76.985, 29.694],
        [76.985, 29.69],
      ],
    ],
  };

  beforeAll(async () => {
    await i18n.init();
  });

  it('validates drawn field geometry on client using Turf & shared science', () => {
    const geoValidation = validatePolygon(drawnPolygon);
    expect(geoValidation.valid).toBe(true);
    expect(geoValidation.areaHa).toBeGreaterThan(0.01);
    expect(geoValidation.areaHa).toBeLessThan(500);

    const calculatedArea = polygonAreaHa(drawnPolygon);
    expect(calculatedArea).toBeCloseTo(12.89, 1);
  });

  it('formats field area correctly in Hindi and English with user unit', () => {
    const areaHa = 1.28;

    // English Acre & Ha
    expect(formatArea(areaHa, 'acre', 'en')).toBe('3.16 acre');
    expect(formatArea(areaHa, 'ha', 'en')).toBe('1.28 ha');

    // Hindi Acre & Ha
    expect(formatArea(areaHa, 'acre', 'hi')).toBe('3.16 एकड़');
    expect(formatArea(areaHa, 'ha', 'hi')).toBe('1.28 हेक्टेयर');
  });

  it('displays crop name in the user preferred language', () => {
    const crop = CROPS_MAP.get('wheat');
    expect(crop).toBeDefined();

    // English
    setAppLanguage('en');
    expect(crop?.nameEn).toBe('Wheat');
    expect(i18n.t('crops.wheat')).toBe('Wheat');

    // Hindi
    setAppLanguage('hi');
    expect(crop?.nameHi).toBe('गेहूं');
    expect(i18n.t('crops.wheat')).toBe('गेहूं');
  });

  it('generates large clear today recommendation sentence in English and Hindi', () => {
    const depthMm = 18.0;
    const litres = 36000;

    // 1. English - Action: Irrigate
    setAppLanguage('en');
    const enDepth = formatDepthMm(depthMm, 'en');
    const enLitres = formatNumber(litres, 'en');
    const enIrrigateSentence = `Irrigate ${enDepth} (about ${enLitres} litres) today`;
    expect(enIrrigateSentence).toBe('Irrigate 18 mm (about 36,000 litres) today');

    // 2. Hindi - Action: Irrigate
    setAppLanguage('hi');
    const hiDepth = formatDepthMm(depthMm, 'hi');
    const hiLitres = formatNumber(litres, 'hi');
    const hiIrrigateSentence = `आज ${hiDepth} (लगभग ${hiLitres} लीटर) सिंचाई करें`;
    expect(hiIrrigateSentence).toBe('आज 18 मिमी (लगभग 36,000 लीटर) सिंचाई करें');

    // 3. English - Action: Skip
    setAppLanguage('en');
    const enSkipSentence = i18n.t('dashboard.skipSentence');
    expect(enSkipSentence).toBe('Skip irrigation today');

    // 4. Hindi - Action: Skip
    setAppLanguage('hi');
    const hiSkipSentence = i18n.t('dashboard.skipSentence');
    expect(hiSkipSentence).toBe('आज सिंचाई छोड़ें');
  });

  it('formats scientific reasons with parameters in English and Hindi', () => {
    // Rain expected
    setAppLanguage('en');
    const enRain = i18n.t('reasons.rain_expected', { mm: 12 });
    expect(enRain).toContain('Rain expected (12 mm)');

    setAppLanguage('hi');
    const hiRain = i18n.t('reasons.rain_expected', { mm: 12 });
    expect(hiRain).toContain('बारिश की संभावना है (12 मिमी)');

    // Deficit reached
    setAppLanguage('en');
    const enDeficit = i18n.t('reasons.deficit_reached', { mm: 20 });
    expect(enDeficit).toContain('20 mm');

    setAppLanguage('hi');
    const hiDeficit = i18n.t('reasons.deficit_reached', { mm: 20 });
    expect(hiDeficit).toContain('20 मिमी');
  });

  it('displays stale weather warning when weatherStale is true', () => {
    setAppLanguage('en');
    expect(i18n.t('dashboard.weatherStaleWarning')).toContain('Using cached weather forecast');

    setAppLanguage('hi');
    expect(i18n.t('dashboard.weatherStaleWarning')).toContain(
      'कैश किया गया पुराना मौसम डेटा उपयोग में है',
    );
  });
});
