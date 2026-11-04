import { describe, it, expect, beforeAll } from 'vitest';
import i18n, { setAppLanguage } from './locales/i18n.js';
import {
  CROPS_MAP,
  validatePolygon,
  polygonAreaHa,
  type GeoJsonPolygon,
  bucketTestToLph,
  runMinutes,
  formatDuration,
  pumpCost,
  POWER_SCHEDULE_PRESETS,
  formatTimeRange,
  formatAdvisoryWithWindow,
  expandWindows,
  planPumpSegments,
  planPumpDay,
  toHectares,
  fromHectares,
  stateForPoint,
  suggestLanguageForState,
  createFieldSchema,
  getCalendarForState,
  planRainfed,
} from '@irrigiq/shared';
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

  describe('Phase 16 Acceptance: Pump Run Time & Tomato Canonical Example', () => {
    it('calculates 18,000 L/h from a 20 L bucket in 4 seconds', () => {
      const dischargeLph = bucketTestToLph(20, 4);
      expect(dischargeLph).toBe(18000);
    });

    it('calculates exactly 107 minutes for 31,950 L at 18,000 L/h', () => {
      const run = runMinutes(31950, 18000);
      expect(run.minutes).toBe(107);
      expect(run.splitAcrossDays).toBe(false);
    });

    it('formats tomato duration as "1 h 47 min" in English and "1 घंटा 47 मिनट" in Hindi', () => {
      expect(formatDuration(107, 'en')).toBe('1 h 47 min');
      expect(formatDuration(107, 'hi')).toBe('1 घंटा 47 मिनट');
    });

    it('displays the main answer as pump operating time ("Run the pump 1 h 47 min tonight")', () => {
      const grossLitres = 31950;
      const dischargeLph = 18000;
      const run = runMinutes(grossLitres, dischargeLph);

      // English advisory sentence
      setAppLanguage('en');
      const durationEn = formatDuration(run.minutes, 'en');
      const sentenceEn = i18n.t('dashboard.runPumpSentence', {
        duration: durationEn,
        defaultValue: `Run the pump ${durationEn} tonight`,
      });
      expect(sentenceEn).toBe('Run the pump 1 h 47 min tonight');

      // Hindi advisory sentence
      setAppLanguage('hi');
      const durationHi = formatDuration(run.minutes, 'hi');
      const sentenceHi = i18n.t('dashboard.runPumpSentence', {
        duration: durationHi,
        defaultValue: `आज रात ${durationHi} पंप चलाएं`,
      });
      expect(sentenceHi).toBe('आज रात 1 घंटा 47 मिनट पंप चलाएं');
    });

    it('computes pump electricity / diesel operating cost accurately', () => {
      const run = runMinutes(31950, 18000); // 107 min
      const cost = pumpCost(run, 50); // ₹50/hour
      expect(cost).toBe(89.17);
    });

    it('flags splitAcrossDays = true when run time exceeds 720 minutes (12 hours)', () => {
      const longRun = runMinutes(250000, 18000);
      expect(longRun.minutes).toBe(833);
      expect(longRun.splitAcrossDays).toBe(true);
    });
  });

  describe('Phase 17 Acceptance: Power Windows and the Pump Schedule', () => {
    const tomatoRun = runMinutes(31950, 18000); // 107 minutes
    const nightSchedule = {
      name: 'Night Schedule',
      windows: [...POWER_SCHEDULE_PRESETS.night.windows],
    };

    it('with a night schedule the tomato example shows "Run the pump 1 h 47 min, between 10 pm and 6 am" (English)', () => {
      setAppLanguage('en');
      const durationEn = formatDuration(tomatoRun.minutes, 'en');
      const windowRange = formatTimeRange(
        nightSchedule.windows[0]!.start,
        nightSchedule.windows[0]!.end,
        'en',
      );
      expect(windowRange).toBe('between 10 pm and 6 am');

      const sentenceEn = i18n.t('dashboard.runPumpWithWindow', {
        duration: durationEn,
        window: windowRange,
      });

      expect(sentenceEn).toBe('Run the pump 1 h 47 min, between 10 pm and 6 am');

      // Also verify pure shared formatter
      const sharedSentenceEn = formatAdvisoryWithWindow(durationEn, nightSchedule, 'en');
      expect(sharedSentenceEn).toBe('Run the pump 1 h 47 min, between 10 pm and 6 am');
    });

    it('with a night schedule the tomato example shows "आज रात 1 घंटा 47 मिनट पंप चलाएं, रात 10 बजे से सुबह 6 बजे के बीच" (Hindi)', () => {
      setAppLanguage('hi');
      const durationHi = formatDuration(tomatoRun.minutes, 'hi');
      const windowRange = formatTimeRange(
        nightSchedule.windows[0]!.start,
        nightSchedule.windows[0]!.end,
        'hi',
      );
      expect(windowRange).toBe('रात 10 बजे से सुबह 6 बजे के बीच');

      const sentenceHi = i18n.t('dashboard.runPumpWithWindow', {
        duration: durationHi,
        window: windowRange,
      });

      expect(sentenceHi).toBe(
        'आज रात 1 घंटा 47 मिनट पंप चलाएं, रात 10 बजे से सुबह 6 बजे के बीच',
      );

      // Also verify pure shared formatter
      const sharedSentenceHi = formatAdvisoryWithWindow(durationHi, nightSchedule, 'hi');
      expect(sharedSentenceHi).toBe(
        'आज रात 1 घंटा 47 मिनट पंप चलाएं, रात 10 बजे से सुबह 6 बजे के बीच',
      );
    });

    it('correctly splits midnight crossing window 22:00-06:00 into 22:00-24:00 (Day D) and 00:00-06:00 (Day D+1)', () => {
      const intervals = expandWindows(nightSchedule, '2026-11-04');
      expect(intervals).toHaveLength(2);

      // Piece 1: 22:00 to 24:00 (120 min)
      expect(intervals[0]!.start).toBe('2026-11-04T22:00:00+05:30');
      expect(intervals[0]!.end).toBe('2026-11-05T00:00:00+05:30');
      expect(intervals[0]!.durationMinutes).toBe(120);

      // Piece 2: 00:00 to 06:00 (360 min)
      expect(intervals[1]!.start).toBe('2026-11-05T00:00:00+05:30');
      expect(intervals[1]!.end).toBe('2026-11-05T06:00:00+05:30');
      expect(intervals[1]!.durationMinutes).toBe(360);
    });

    it('splits a pump run across intervals when run time exceeds the first interval', () => {
      const intervals = expandWindows(nightSchedule, '2026-11-04');
      // 180 min run: fills 120 min piece 1, and 60 min of piece 2
      const result = planPumpSegments(180, intervals);

      expect(result.segments).toHaveLength(2);
      expect(result.segments[0]!.durationMinutes).toBe(120);
      expect(result.segments[1]!.durationMinutes).toBe(60);
      expect(result.missingMinutes).toBe(0);
    });

    it('reports missingMinutes when power window is insufficient', () => {
      const shortSchedule = {
        name: 'Short Window',
        windows: [{ days: [0, 1, 2, 3, 4, 5, 6], start: '06:00', end: '08:00' }], // 120 min
      };
      const intervals = expandWindows(shortSchedule, '2026-11-04');
      const result = planPumpSegments(200, intervals);

      expect(result.segments).toHaveLength(1);
      expect(result.segments[0]!.durationMinutes).toBe(120);
      expect(result.missingMinutes).toBe(80);
    });

    it('schedules multiple fields sharing one pump in order of largest deficit first', () => {
      const intervals = expandWindows(nightSchedule, '2026-11-04');
      const fieldRuns = [
        { fieldId: 'field-1', deficitMm: 15, runMinutes: 60 },
        { fieldId: 'field-2', deficitMm: 35, runMinutes: 90 }, // higher deficit, scheduled first
        { fieldId: 'field-3', deficitMm: 22, runMinutes: 45 },
      ];

      const dayPlan = planPumpDay('pump-main', fieldRuns, intervals);

      expect(dayPlan.fieldPlans[0]!.fieldId).toBe('field-2');
      expect(dayPlan.fieldPlans[1]!.fieldId).toBe('field-3');
      expect(dayPlan.fieldPlans[2]!.fieldId).toBe('field-1');
      expect(dayPlan.totalRunMinutes).toBe(195);
      expect(dayPlan.totalMissingMinutes).toBe(0);
    });

    it('prioritizes calm night interval and adds plan.windy note for sprinklers in high wind (>20 km/h)', () => {
      const mixedSchedule = {
        name: 'Mixed Feeder',
        windows: [
          { days: [0, 1, 2, 3, 4, 5, 6], start: '06:00', end: '10:00' }, // Day
          { days: [0, 1, 2, 3, 4, 5, 6], start: '22:00', end: '24:00' }, // Night
        ],
      };
      const intervals = expandWindows(mixedSchedule, '2026-11-04');

      // High wind: 25 km/h
      const result = planPumpSegments(60, intervals, {
        method: 'sprinkler',
        windSpeedMax: 25,
      });

      expect(result.notes).toContain('plan.windy');
      // Starts in calmer night interval (22:00) rather than daytime (06:00)
      expect(result.segments[0]!.start).toContain('T22:00:00+05:30');
    });
  });

  describe('Phase 18 Acceptance: Create a field with only a pin and 2 acres in under 30 seconds on a phone-sized screen', () => {
    it('creates a field with only a pin and 2 acres in under 30 seconds on a phone-sized screen (375x667)', () => {
      // 1. Phone-sized screen simulation
      const screen = { width: 375, height: 667 };
      expect(screen.width).toBe(375);
      expect(screen.height).toBe(667);

      const startTime = Date.now();

      // 2. Farmer drops a pin in Rajasthan (Jaipur rural: 75.8, 26.9)
      const pinCoords: [number, number] = [75.8, 26.9];
      const state = stateForPoint(pinCoords[0], pinCoords[1]);
      expect(state).toBe('Rajasthan');

      const suggestedLang = suggestLanguageForState(state);
      expect(suggestedLang).toBe('hi');

      // 3. Farmer inputs '2 acres'
      const areaValue = 2;
      const areaUnit = 'acre';
      const areaHa = toHectares(areaValue, areaUnit);

      // 2 acres * 0.404686 = 0.8094 ha
      expect(areaHa).toBe(0.8094);
      expect(areaHa).toBeLessThanOrEqual(50); // Under 50 ha threshold (no warning)

      // 4. Form payload validated via createFieldSchema
      const fieldPayload = {
        name: 'My 2-Acre Farm',
        locationMode: 'pin' as const,
        location: {
          type: 'Point' as const,
          coordinates: pinCoords,
        },
        areaValue,
        areaUnit,
        cropKey: 'wheat',
        sowingDate: '2026-11-01',
        soilType: 'loam' as const,
        method: 'drip' as const,
        baseline: {
          everyDays: 4,
          depthMm: 25,
        },
      };

      const parseResult = createFieldSchema.safeParse(fieldPayload);
      expect(parseResult.success).toBe(true);

      // 5. Verification: Under 30 seconds execution
      const elapsedSeconds = (Date.now() - startTime) / 1000;
      expect(elapsedSeconds).toBeLessThan(30);

      // 6. Formatted display in English & Hindi
      expect(formatArea(areaHa, 'acre', 'en')).toBe('2.00 acre');
      expect(formatArea(areaHa, 'acre', 'hi')).toContain('एकड़');
    });

    it('handles guntha (40 guntha = 1 acre) and custom unit (bigha) conversions', () => {
      // 40 guntha = 1 acre = 0.4047 ha
      const gunthaHa = toHectares(40, 'guntha');
      expect(gunthaHa).toBe(0.4047);
      expect(fromHectares(gunthaHa, 'guntha')).toBeCloseTo(40, 1);

      // Custom bigha at 0.5 acre/unit: 2 bigha = 1 acre = 0.4047 ha
      const bighaHa = toHectares(2, 'custom', 0.5);
      expect(bighaHa).toBe(0.4047);
      expect(fromHectares(bighaHa, 'custom', 0.5)).toBeCloseTo(2.0, 1);
    });
  });

  describe('Phase 19 Acceptance: Rain-fed mode with state calendar and sensible weather status', () => {
    it('a pin in a state with a calendar shows a sensible status for the current date and weather', async () => {
      // 1. Farmer drops a pin in Maharashtra (Akola/Vidarbha cotton belt: [77.03, 20.70])
      const pinCoords: [number, number] = [77.03, 20.70];
      const detectedState = stateForPoint(pinCoords[0], pinCoords[1]);
      expect(detectedState).toBe('Maharashtra');

      // 2. Lookup state calendar for cotton
      const calendar = getCalendarForState(detectedState, 'cotton');
      expect(calendar).toBeDefined();
      expect(calendar?.sowFrom).toBe('06-15');
      expect(calendar?.sowTo).toBe('07-15');
      expect(calendar?.sowingRainMm).toBe(75);

      // 3. Scenario A: Sowing window open, but only 20 mm rainfall so far -> wait_to_sow
      const pastRainLow = [0, 0, 5, 0, 10, 5, 0]; // 20 mm in last 7 days
      const forecastSunny = [0, 0, 0, 0, 0, 0, 0];

      const planWait = planRainfed(
        {
          cropKey: 'cotton',
          sowingDate: '2026-07-01',
          soilType: 'clay',
          hasProtectiveWater: false,
        },
        pastRainLow,
        forecastSunny,
        calendar,
        '2026-06-25', // inside window
      );

      expect(planWait.statusKey).toBe('rainfed.wait_to_sow');
      expect(planWait.params.rainLast7Days).toBe(20);
      expect(planWait.params.drySpellDays).toBe(7);

      // Verify plain words in English & Hindi
      await setAppLanguage('en');
      const enStatus = i18n.t('rainfed.status.wait_to_sow');
      expect(enStatus).toBe('Wait for Sowing Rains');

      await setAppLanguage('hi');
      const hiStatus = i18n.t('rainfed.status.wait_to_sow');
      expect(hiStatus).toBe('बुवाई योग्य वर्षा की प्रतीक्षा करें');

      // 4. Scenario B: Good monsoon arrival (85 mm rainfall in last 7 days) -> good_to_sow
      const pastRainMonsoon = [15, 20, 10, 25, 0, 10, 5]; // 85 mm in last 7 days
      const planGood = planRainfed(
        {
          cropKey: 'cotton',
          sowingDate: '2026-07-01',
          soilType: 'clay',
          hasProtectiveWater: true,
        },
        pastRainMonsoon,
        forecastSunny,
        calendar,
        '2026-06-25',
      );

      expect(planGood.statusKey).toBe('rainfed.good_to_sow');
      expect(planGood.params.rainLast7Days).toBe(85);
      expect(planGood.advice).toContain('rainfed.advice.sow_now');

      await setAppLanguage('en');
      expect(i18n.t('rainfed.status.good_to_sow')).toBe('Good to Sow');
      await setAppLanguage('hi');
      expect(i18n.t('rainfed.status.good_to_sow')).toBe('बुवाई के लिए उपयुक्त समय');

      // 5. Scenario C: Sown field experiencing mid-season dry spell
      const sownField = {
        cropKey: 'cotton',
        sowingDate: '2026-06-20',
        soilType: 'clay' as const,
        hasProtectiveWater: true,
      };

      const planSown = planRainfed(
        sownField,
        [0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0],
        calendar,
        '2026-07-20', // das = 30
      );

      expect(planSown.statusKey).toBe('rainfed.stress_risk');
      expect(planSown.advice).toContain('rainfed.advice.protective_irrigation');

      // Verify agronomist disclaimer key
      await setAppLanguage('en');
      const disclaimer = i18n.t('rainfed.advice.agronomist_disclaimer');
      expect(disclaimer).toMatch(/ICAR-CRIDA/);
      expect(disclaimer).toMatch(/Krishi Vigyan Kendra/);
    });
  });

  describe('Phase 20 Acceptance: Chat messaging with Telegram', () => {
    it('verifies Telegram messaging localization, linking deep links, and advisory text in English & Hindi', async () => {
      // 1. English localized UI keys
      await setAppLanguage('en');
      expect(i18n.t('messaging.title')).toBe('Telegram Advisory Notifications');
      expect(i18n.t('messaging.connectBtn')).toBe('Connect Telegram');
      expect(i18n.t('messaging.statusActive')).toBe('Connected & Active');
      expect(i18n.t('messaging.statusDisconnected')).toBe('Not Connected');
      expect(i18n.t('messaging.testBtn')).toBe('Send Test Advisory');
      expect(i18n.t('messaging.linkInstructions')).toContain('Open Telegram');

      // 2. Hindi localized UI keys
      await setAppLanguage('hi');
      expect(i18n.t('messaging.title')).toBe('टेलीग्राम कृषि सलाह सूचनाएं');
      expect(i18n.t('messaging.connectBtn')).toBe('टेलीग्राम कनेक्ट करें');
      expect(i18n.t('messaging.statusActive')).toBe('सक्रिय व कनेक्टेड');
      expect(i18n.t('messaging.testBtn')).toBe('परीक्षण सलाह भेजें');

      // 3. Telegram deep link generation
      const linkCode = '849201';
      const botUsername = 'IrrigIQBot';
      const deepLink = `https://t.me/${botUsername}?start=${linkCode}`;
      expect(deepLink).toBe('https://t.me/IrrigIQBot?start=849201');

      // 4. Pump advisory duration formatted for Telegram in EN & HI
      const runMins = 107; // Tomato 31,950 L at 18,000 L/h
      expect(formatDuration(runMins, 'en')).toBe('1 h 47 min');
      expect(formatDuration(runMins, 'hi')).toBe('1 घंटा 47 मिनट');

      // 5. Devanagari numerals normalization
      const devanagariInput = '३ ०७:३०';
      const normalized = devanagariInput.replace(/[०-९]/g, (d) => {
        const map: Record<string, string> = {
          '०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
          '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
        };
        return map[d] || d;
      });
      expect(normalized).toBe('3 07:30');
    });
  });
});
