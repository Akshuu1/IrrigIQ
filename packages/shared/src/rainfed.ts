import { CROPS_MAP } from './crops.js';
import { SoilType, effectiveRain } from './science.js';
import { calculateDaysAfterSowing } from './recommendations.js';

import rainfedConfigJson from './config/rainfed.config.json' with { type: 'json' };
import maharashtraCalendarJson from './config/calendars/maharashtra.json' with { type: 'json' };
import karnatakaCalendarJson from './config/calendars/karnataka.json' with { type: 'json' };
import rajasthanCalendarJson from './config/calendars/rajasthan.json' with { type: 'json' };

export interface SowingCalendarEntry {
  state: string;
  crop: string;
  season: string;
  sowFrom: string; // 'MM-DD'
  sowTo: string; // 'MM-DD'
  sowingRainMm?: number;
  source: string;
  verified: boolean;
}

export interface StateCalendar {
  state: string;
  source: string;
  verified: boolean;
  crops: SowingCalendarEntry[];
}

export const RAINFED_CONFIG = rainfedConfigJson;

export const STATE_CALENDARS: Record<string, StateCalendar> = {
  maharashtra: maharashtraCalendarJson as StateCalendar,
  karnataka: karnatakaCalendarJson as StateCalendar,
  rajasthan: rajasthanCalendarJson as StateCalendar,
};

/**
 * Normalizes state name to match calendar lookup key.
 */
export function normalizeStateKey(stateName: string): string {
  return stateName.toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * Retrieves the sowing calendar for a specific state and crop.
 * Returns null if the state or crop is not present in the calendar database.
 */
export function getCalendarForState(
  stateName: string | null | undefined,
  cropKey: string,
): SowingCalendarEntry | null {
  if (!stateName || !cropKey) return null;
  const key = normalizeStateKey(stateName);
  const calendar = STATE_CALENDARS[key];
  if (!calendar) return null;
  const cropEntry = calendar.crops.find(
    (c) => c.crop.toLowerCase() === cropKey.toLowerCase(),
  );
  return cropEntry ?? null;
}

/**
 * Counts rainy days (rainfall >= thresholdMm) in an array of daily rainfall values.
 * IMD standard threshold is 2.5 mm.
 */
export function rainyDays(dailyRain: readonly number[], thresholdMm = 2.5): number {
  if (!Array.isArray(dailyRain) || dailyRain.length === 0) return 0;
  return dailyRain.filter((r) => typeof r === 'number' && !isNaN(r) && r >= thresholdMm).length;
}

/**
 * Calculates the dry spell length (maximum consecutive days with rainfall < thresholdMm).
 * If the array is empty, returns 0.
 */
export function drySpellLength(dailyRain: readonly number[], thresholdMm = 2.5): number {
  if (!Array.isArray(dailyRain) || dailyRain.length === 0) return 0;
  let maxStreak = 0;
  let currentStreak = 0;

  for (const rain of dailyRain) {
    const r = typeof rain === 'number' && !isNaN(rain) ? rain : 0;
    if (r < thresholdMm) {
      currentStreak++;
      if (currentStreak > maxStreak) {
        maxStreak = currentStreak;
      }
    } else {
      currentStreak = 0;
    }
  }

  return maxStreak;
}

/**
 * Sums rainfall for the specified number of days (defaulting to all elements).
 * If days is provided, sums the trailing `days` elements of the array.
 */
export function cumulativeRain(dailyRain: readonly number[], days?: number): number {
  if (!Array.isArray(dailyRain) || dailyRain.length === 0) return 0;
  const slice =
    typeof days === 'number' && days > 0
      ? dailyRain.slice(-days)
      : dailyRain;

  const total = slice.reduce((sum, r) => sum + (typeof r === 'number' && !isNaN(r) ? r : 0), 0);
  return Number(total.toFixed(2));
}

/**
 * Water bucket balance equation:
 * updateBucket(store, effectiveRainMm, etcMm, tawMm) = min(taw, max(0, store + rain - etc))
 */
export function updateBucket(
  store: number,
  effectiveRainMm: number,
  etcMm: number,
  tawMm: number,
): number {
  if (isNaN(store) || isNaN(effectiveRainMm) || isNaN(etcMm) || isNaN(tawMm)) return 0;
  if (tawMm <= 0) return 0;
  const balance = store + effectiveRainMm - etcMm;
  const clamped = Math.min(tawMm, Math.max(0, balance));
  return Number(clamped.toFixed(2));
}

/**
 * Returns water stress level ('ok' | 'watch' | 'stress') based on remaining store relative to TAW.
 * - stress: ratio < 0.3
 * - watch:  0.3 <= ratio < 0.5
 * - ok:     ratio >= 0.5
 */
export function stressLevel(
  store: number,
  tawMm: number,
  thresholds = RAINFED_CONFIG.stressThresholds,
): 'ok' | 'watch' | 'stress' {
  if (tawMm <= 0) return 'stress';
  const ratio = store / tawMm;
  if (ratio < thresholds.stress.value) {
    return 'stress';
  }
  if (ratio < thresholds.watch.value) {
    return 'watch';
  }
  return 'ok';
}

/**
 * Computes root depth for a given crop on a given day after sowing (DAS).
 */
export function rootDepthForDay(
  cropKey: string,
  daysAfterSowing: number,
  config = RAINFED_CONFIG,
): number {
  const crop = CROPS_MAP.get(cropKey);
  const cropDepths = (config.rootDepthPerCropAndStage as Record<string, Record<string, { value: number }>>)[
    cropKey
  ];

  if (!cropDepths) {
    // Sane generic fallback if crop not specifically configured
    return daysAfterSowing < 20 ? 0.3 : 1.0;
  }

  if (daysAfterSowing < 0) {
    return cropDepths['ini']?.value ?? 0.3;
  }

  if (!crop) {
    return cropDepths['mid']?.value ?? 1.0;
  }

  const { ini, dev, mid } = crop.stageDays;
  const iniDepth = cropDepths['ini']?.value ?? 0.3;
  const midDepth = cropDepths['mid']?.value ?? 1.0;
  const lateDepth = cropDepths['late']?.value ?? midDepth;

  if (daysAfterSowing < ini) {
    return iniDepth;
  }
  if (daysAfterSowing < ini + dev) {
    const fraction = dev > 0 ? (daysAfterSowing - ini) / dev : 1;
    return Number((iniDepth + (midDepth - iniDepth) * fraction).toFixed(2));
  }
  if (daysAfterSowing < ini + dev + mid) {
    return midDepth;
  }
  return lateDepth;
}

/**
 * Calculates Total Available Water (TAW in mm) for a field on a given day.
 */
export function tawFor(
  field: { soilType: SoilType; cropKey: string; sowingDate?: Date | string },
  day?: string | Date | number,
  config = RAINFED_CONFIG,
): number {
  const capacityPerMetre =
    config.soilWaterCapacityPerMetre[field.soilType]?.value ?? 140;

  let das = 30; // default mid-season estimation
  if (typeof day === 'number') {
    das = day;
  } else if (day && field.sowingDate) {
    das = calculateDaysAfterSowing(field.sowingDate, typeof day === 'string' ? day : day.toISOString().split('T')[0]!);
  }

  const depthM = rootDepthForDay(field.cropKey, das, config);
  return Number((capacityPerMetre * depthM).toFixed(2));
}

export type RainfedStatus =
  | 'rainfed.wait_to_sow'
  | 'rainfed.good_to_sow'
  | 'rainfed.outside_window'
  | 'rainfed.ok'
  | 'rainfed.watch_dry'
  | 'rainfed.stress_risk'
  | 'rainfed.no_calendar';

export interface RainfedPlanField {
  cropKey: string;
  sowingDate: Date | string;
  soilType: SoilType;
  hasProtectiveWater?: boolean;
}

export interface RainfedWeatherDay {
  date: string;
  rainMm: number;
  etcMm?: number;
}

export interface RainfedPlanResult {
  statusKey: RainfedStatus;
  params: {
    rainLast7Days: number;
    drySpellDays: number;
    bucketPercent: number;
    tawMm: number;
    currentStoreMm: number;
    sowingRainTargetMm?: number;
    das?: number;
  };
  advice: string[];
}

/**
 * Checks if a 'MM-DD' date falls within [sowFrom, sowTo].
 */
export function isDateInWindow(dateMmDd: string, sowFrom: string, sowTo: string): boolean {
  if (sowFrom <= sowTo) {
    return dateMmDd >= sowFrom && dateMmDd <= sowTo;
  }
  // Window crosses calendar year (e.g. 11-15 to 01-15)
  return dateMmDd >= sowFrom || dateMmDd <= sowTo;
}

/**
 * Core rainfed planning engine.
 * Evaluates rainfall, soil water bucket, dry spells, and sowing calendar windows.
 */
export function planRainfed(
  field: RainfedPlanField,
  pastRain: readonly (number | { rainMm: number })[],
  forecast: readonly (number | RainfedWeatherDay)[],
  calendar: SowingCalendarEntry | null,
  currentDateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
  config = RAINFED_CONFIG,
): RainfedPlanResult {
  const pastRainNums: number[] = pastRain.map((p) =>
    typeof p === 'number' ? p : p.rainMm,
  );
  const forecastRainNums: number[] = forecast.map((f) =>
    typeof f === 'number' ? f : f.rainMm,
  );

  const rainLast7Days = cumulativeRain(pastRainNums, config.sowingRainWindowDays.value);
  const drySpellDays = drySpellLength(forecastRainNums, config.rainyDayMm.value);
  const das = calculateDaysAfterSowing(field.sowingDate, currentDateStr);

  // If state has no calendar
  if (!calendar) {
    const taw = tawFor(field, das, config);
    return {
      statusKey: 'rainfed.no_calendar',
      params: {
        rainLast7Days,
        drySpellDays,
        bucketPercent: 0,
        tawMm: taw,
        currentStoreMm: 0,
        das,
      },
      advice: ['rainfed.advice.no_calendar'],
    };
  }

  const sowingRainTarget = calendar.sowingRainMm ?? config.sowingRainMm.value;
  const taw = tawFor(field, das, config);

  // Sowing window check
  const currentMmDd = currentDateStr.slice(5); // 'YYYY-MM-DD' -> 'MM-DD'
  const inWindow = isDateInWindow(currentMmDd, calendar.sowFrom, calendar.sowTo);

  // 1. Not yet sown or scheduled for future sowing date
  if (das < 0) {
    const advice: string[] = [];
    let statusKey: RainfedStatus;

    if (inWindow) {
      if (rainLast7Days >= sowingRainTarget) {
        statusKey = 'rainfed.good_to_sow';
        advice.push('rainfed.advice.sow_now');
      } else {
        statusKey = 'rainfed.wait_to_sow';
        advice.push('rainfed.advice.wait_for_soaking_rain');
      }
    } else {
      if (currentMmDd < calendar.sowFrom) {
        statusKey = 'rainfed.wait_to_sow';
        advice.push('rainfed.advice.prepare_land');
      } else {
        statusKey = 'rainfed.outside_window';
        advice.push('rainfed.advice.contingency_short_duration');
      }
    }

    return {
      statusKey,
      params: {
        rainLast7Days,
        drySpellDays,
        bucketPercent: rainLast7Days >= sowingRainTarget ? 100 : Math.round((rainLast7Days / sowingRainTarget) * 100),
        tawMm: taw,
        currentStoreMm: Math.min(taw, rainLast7Days),
        sowingRainTargetMm: sowingRainTarget,
        das,
      },
      advice,
    };
  }

  // 2. Crop is already sown (das >= 0)
  // Simulate soil moisture bucket: start with saturated profile after sowing rain
  let store = Math.min(taw, taw * 0.85); // standard initial post-sowing profile moisture

  // Apply past rain and ETc if available
  for (const item of pastRain) {
    const r = typeof item === 'number' ? item : item.rainMm;
    const etc = 3.5; // average daily ETc baseline for young/developing crops
    store = updateBucket(store, effectiveRain(r), etc, taw);
  }

  const bucketPercent = taw > 0 ? Math.round((store / taw) * 100) : 0;
  const level = stressLevel(store, taw, config.stressThresholds);
  const advice: string[] = [];
  let statusKey: RainfedStatus;

  if (level === 'stress' || (level === 'watch' && drySpellDays >= config.maxDrySpellAfterSowDays.value)) {
    statusKey = 'rainfed.stress_risk';
    advice.push('rainfed.advice.foliar_spray');
  } else if (level === 'watch' || drySpellDays >= 5) {
    statusKey = 'rainfed.watch_dry';
    advice.push('rainfed.advice.mulching');
  } else {
    statusKey = 'rainfed.ok';
    advice.push('rainfed.advice.weed_management');
  }

  if (field.hasProtectiveWater && (statusKey === 'rainfed.stress_risk' || statusKey === 'rainfed.watch_dry')) {
    advice.unshift('rainfed.advice.protective_irrigation');
  }

  return {
    statusKey,
    params: {
      rainLast7Days,
      drySpellDays,
      bucketPercent,
      tawMm: taw,
      currentStoreMm: store,
      sowingRainTargetMm: sowingRainTarget,
      das,
    },
    advice,
  };
}

