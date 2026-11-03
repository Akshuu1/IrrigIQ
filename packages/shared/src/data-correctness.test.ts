import { describe, it, expect } from 'vitest';
import {
  CROPS_MAP,
  stageForDay,
  kcForDay,
  computeEtc,
  effectiveRain,
  netNeed,
  grossNeed,
  buildDailyNeeds,
  planIrrigation,
  WeatherDayData,
} from './index.js';

describe('Data-Correctness Check (5 Hand-Calculated Field Cases within 0.1 mm)', () => {
  /**
   * Case 1: Wheat in Loam soil with Drip irrigation
   * Sowing: 2026-10-01, Target: 2026-11-20 (DAS = 50 -> mid stage)
   * Wheat Kc_mid = 1.15
   * Weather: ET0 = 4.0 mm, Rain = 0 mm
   * Hand calculations:
   * ETc = 4.0 * 1.15 = 4.60 mm
   * Net need = 4.60 mm
   * Prior deficit = 17.00 mm
   * Total deficit = 17.00 + 4.60 = 21.60 mm
   * Loam trigger = 20 mm. 21.60 >= 20 -> Action = irrigate
   * Loam maxDepth = 40 mm -> Net application = min(21.60, 40) = 21.60 mm
   * Drip efficiency = 0.90 -> Gross = 21.60 / 0.90 = 24.00 mm
   */
  it('Case 1: Wheat in Loam soil with Drip reaches trigger and matches hand calculation within 0.1 mm', () => {
    const crop = CROPS_MAP.get('wheat')!;
    expect(crop).toBeDefined();

    const das = 50;
    const stage = stageForDay(crop, das);
    expect(stage).toBe('mid');

    const kc = kcForDay(crop, das)!;
    expect(kc).toBeCloseTo(1.15, 2);

    const et0 = 4.0;
    const etc = computeEtc(et0, kc);
    expect(etc).toBeCloseTo(4.6, 2);

    const effRain = effectiveRain(0);
    expect(effRain).toBe(0);

    const net = netNeed(etc, effRain);
    expect(net).toBeCloseTo(4.6, 2);

    // Weather days simulation: 5 days at 4.60 mm/day net need
    // Day 1: 4.60 mm (< 20 trigger)
    // Day 2: 9.20 mm
    // Day 3: 13.80 mm
    // Day 4: 18.40 mm
    // Day 5: 23.00 mm (>= 20 trigger -> action = 'irrigate')
    const weatherDays: WeatherDayData[] = [
      { date: '2026-11-17', et0Mm: 4.0, rainMm: 0 },
      { date: '2026-11-18', et0Mm: 4.0, rainMm: 0 },
      { date: '2026-11-19', et0Mm: 4.0, rainMm: 0 },
      { date: '2026-11-20', et0Mm: 4.0, rainMm: 0 },
      { date: '2026-11-21', et0Mm: 4.0, rainMm: 0 },
    ];

    const dailyNeeds = buildDailyNeeds(
      { cropKey: 'wheat', sowingDate: '2026-10-01' },
      weatherDays,
    );

    const plan = planIrrigation(
      { soilType: 'loam', method: 'drip', areaHa: 1.0 },
      dailyNeeds,
      '2026-11-16', // last irrigated day before simulation starts
    );

    const irrigDay = plan.find((p) => p.action === 'irrigate');
    expect(irrigDay).toBeDefined();
    expect(irrigDay!.date).toBe('2026-11-21');
    expect(irrigDay!.netMm).toBeCloseTo(23.0, 1);
    // Gross: 23.0 / 0.90 = 25.56 mm
    expect(Math.abs(irrigDay!.grossMm - 25.56)).toBeLessThanOrEqual(0.1);
  });

  /**
   * Case 2: Tomato in Sandy soil with Sprinkler irrigation (Development Stage Interpolation)
   * Sowing: 2026-10-01, Target: 2026-11-19 (DAS = 49 -> dev stage: 30 to 70)
   * t0 = 29, t1 = 70. fraction = (49 - 29) / (70 - 29) = 20 / 41 ≈ 0.4878
   * Kc_ini = 0.6, Kc_mid = 1.15. Kc = 0.6 + 0.4878 * 0.55 ≈ 0.868
   * Weather: ET0 = 5.0 mm, Rain = 0 mm
   * ETc = 5.0 * 0.868 = 4.34 mm
   * Sandy trigger = 12 mm, maxDepth = 25 mm
   * Sprinkler efficiency = 0.75
   * Prior deficit = 9.0 mm -> New deficit = 13.34 mm
   * Net application = min(13.34, 25) = 13.34 mm
   * Gross need = 13.34 / 0.75 = 17.79 mm
   */
  it('Case 2: Tomato in Sandy soil with Sprinkler during development stage matches within 0.1 mm', () => {
    const crop = CROPS_MAP.get('tomato')!;
    expect(crop).toBeDefined();

    const das = 49;
    const stage = stageForDay(crop, das);
    expect(stage).toBe('dev');

    const kc = kcForDay(crop, das)!;
    expect(Math.abs(kc - 0.868)).toBeLessThanOrEqual(0.01);

    const et0 = 5.0;
    const etc = computeEtc(et0, kc);
    expect(Math.abs(etc - 4.34)).toBeLessThanOrEqual(0.1);

    const netMm = 13.34;
    const grossMm = grossNeed(netMm, 'sprinkler');
    const expectedGross = 17.79;
    expect(Math.abs(grossMm - expectedGross)).toBeLessThanOrEqual(0.1);
  });

  /**
   * Case 3: Rice in Clay soil with Flood irrigation (High Deficit Capped by maxDepth)
   * Rice Kc_mid = 1.20
   * Clay soil: trigger = 25 mm, maxDepth = 50 mm, Flood efficiency = 0.60
   * Weather: ET0 = 6.0 mm, Rain = 0 mm
   * ETc = 6.0 * 1.20 = 7.20 mm
   * Prior deficit = 45.0 mm -> New deficit = 52.20 mm
   * Since 52.20 > maxDepth (50 mm), Net application is capped at exactly 50.00 mm
   * Gross application = 50.00 / 0.60 = 83.33 mm
   */
  it('Case 3: Rice in Clay soil with Flood caps irrigation at soil maxDepth within 0.1 mm', () => {
    const crop = CROPS_MAP.get('rice')!;
    expect(crop).toBeDefined();

    const das = 61;
    expect(stageForDay(crop, das)).toBe('mid');
    const kc = kcForDay(crop, das)!;
    expect(kc).toBeCloseTo(1.2, 2);

    const etc = computeEtc(6.0, kc);
    expect(etc).toBeCloseTo(7.2, 2);

    const cappedNetMm = Math.min(52.2, 50.0);
    expect(cappedNetMm).toBe(50.0);

    const gross = grossNeed(cappedNetMm, 'flood');
    const expectedGross = 83.33;
    expect(Math.abs(gross - expectedGross)).toBeLessThanOrEqual(0.1);
  });

  /**
   * Case 4: Rain Event Suppressing Irrigation (Maize in Loam with Sprinkler)
   * Sowing: 2026-10-15, Target: 2026-11-20
   * Weather: ET0 = 3.5 mm, Rain = 15.0 mm
   * Effective Rain: factor 0.8 * (15 - 5) = 8.0 mm
   * Even if prior accumulated deficit is 22.0 mm (which exceeds Loam trigger of 20 mm),
   * rainMm = 15.0 mm >= 5 mm trigger suppresses irrigation (action = 'skip', reason = 'reason.rain_expected').
   * Gross water applied = 0.0 mm.
   */
  it('Case 4: Rainfall >= 5mm suppresses irrigation despite deficit > trigger within 0.1 mm', () => {
    const rainMm = 15.0;
    const effRain = effectiveRain(rainMm);
    expect(effRain).toBeCloseTo(8.0, 2);

    const weatherDays: WeatherDayData[] = [
      { date: '2026-11-20', et0Mm: 3.5, rainMm: 15.0 },
    ];

    const dailyNeeds = buildDailyNeeds(
      { cropKey: 'maize', sowingDate: '2026-10-15' },
      weatherDays,
    );

    // Weather daily need has 0 net need because effective rain (8.0) > ETc
    expect(dailyNeeds[0]!.effectiveRainMm).toBeCloseTo(8.0, 2);
    expect(dailyNeeds[0]!.netNeedMm).toBe(0);

    const plan = planIrrigation(
      { soilType: 'loam', method: 'sprinkler', areaHa: 1.5 },
      dailyNeeds,
    );

    expect(plan[0]!.action).toBe('skip');
    expect(plan[0]!.reasonKey).toBe('reason.rain_expected');
    expect(plan[0]!.grossMm).toBe(0.0);
  });

  /**
   * Case 5: Soil Moisture Sensor Override (Dry Soil Force Irrigate vs Wet Soil Force Skip)
   * Cotton in Sandy soil (trigger = 12 mm, maxDepth = 25 mm, Drip efficiency = 0.90)
   * 5A: Sensor dry (moisture = 32% <= 40%) -> Forces irrigation even when weather deficit is small (5.4 mm).
   * Net application = min(max(5.4, 12), 25) = 12.0 mm
   * Gross need = 12.0 / 0.90 = 13.33 mm
   * 5B: Sensor wet (moisture = 85% >= 80%) -> Forces skip even when weather deficit is high (20 mm).
   */
  it('Case 5: Soil moisture sensor override triggers irrigation when dry (<=40%) and skips when wet (>=80%) within 0.1 mm', () => {
    const weatherDays: WeatherDayData[] = [
      { date: '2026-11-20', et0Mm: 4.0, rainMm: 0 },
    ];

    const dailyNeeds = buildDailyNeeds(
      { cropKey: 'cotton', sowingDate: '2026-11-10' }, // DAS = 10 (ini stage, Kc = 0.35, ETc = 1.4 mm)
      weatherDays,
    );
    expect(dailyNeeds[0]!.etcMm).toBeCloseTo(1.4, 2);

    // Sub-case 5A: Sensor dry
    const planDry = planIrrigation(
      { soilType: 'sandy', method: 'drip', areaHa: 1.0 },
      dailyNeeds,
      undefined,
      { moisturePct: 32 },
    );

    expect(planDry[0]!.action).toBe('irrigate');
    expect(planDry[0]!.reasonKey).toBe('reason.sensor_dry');
    // Net applied is min(max(1.4, soilTrigger=12), maxDepth=25) = 12.00 mm
    expect(planDry[0]!.netMm).toBeCloseTo(12.0, 2);
    // Gross need is 12.0 / 0.9 = 13.33 mm
    expect(Math.abs(planDry[0]!.grossMm - 13.33)).toBeLessThanOrEqual(0.1);

    // Sub-case 5B: Sensor wet
    const planWet = planIrrigation(
      { soilType: 'sandy', method: 'drip', areaHa: 1.0 },
      dailyNeeds,
      undefined,
      { moisturePct: 85 },
    );

    expect(planWet[0]!.action).toBe('skip');
    expect(planWet[0]!.reasonKey).toBe('reason.sensor_wet');
    expect(planWet[0]!.grossMm).toBe(0.0);
  });
});
