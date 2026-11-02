import { mmToLitres } from './units.js';

export interface BaselineConfig {
  everyDays: number;
  depthMm: number;
}

export interface BaselineTotalResult {
  count: number;
  depthMm: number;
  totalMm: number;
  litres: number;
}

export interface WaterMetric {
  count: number;
  totalMm: number;
  litres: number;
}

export interface SavingsComparison {
  mm: number;
  litres: number;
  pct: number;
}

export interface SavingsTotals {
  days: number;
  baseline: BaselineTotalResult;
  recommended: WaterMetric;
  actual: WaterMetric;
  potentialSaved: SavingsComparison;
  realisedSaved: SavingsComparison;
}

/**
 * Calculates the number of calendar days between from and to, inclusive.
 * Validates that to >= from.
 */
export function calculateDaysInRange(from: string | Date, to: string | Date): number {
  const fromStr =
    typeof from === 'string' ? from.split('T')[0]! : from.toISOString().split('T')[0]!;
  const toStr = typeof to === 'string' ? to.split('T')[0]! : to.toISOString().split('T')[0]!;

  const fromMs = new Date(`${fromStr}T00:00:00.000Z`).getTime();
  const toMs = new Date(`${toStr}T00:00:00.000Z`).getTime();

  if (isNaN(fromMs) || isNaN(toMs)) {
    throw new Error(`Invalid date format for range: from=${fromStr}, to=${toStr}`);
  }

  if (toMs < fromMs) {
    throw new Error(`Invalid date range: 'to' (${toStr}) is before 'from' (${fromStr})`);
  }

  return Math.round((toMs - fromMs) / (24 * 60 * 60 * 1000)) + 1;
}

/**
 * Computes the number of baseline irrigations expected in a given number of days.
 * Formula: floor(days / everyDays).
 */
export function countBaselineIrrigations(daysInRange: number, everyDays: number): number {
  if (daysInRange <= 0 || everyDays <= 0) {
    return 0;
  }
  return Math.floor(daysInRange / everyDays);
}

/**
 * Computes baseline total depth (mm) and volume (litres) for a given date range.
 */
export function baselineTotal(
  daysInRange: number,
  baseline: BaselineConfig,
  areaHa: number,
): BaselineTotalResult {
  if (areaHa < 0) {
    throw new Error(`areaHa must be non-negative: ${areaHa}`);
  }
  if (baseline.depthMm < 0 || baseline.everyDays < 0) {
    throw new Error(
      `Baseline parameters must be non-negative: everyDays=${baseline.everyDays}, depthMm=${baseline.depthMm}`,
    );
  }

  const count = countBaselineIrrigations(daysInRange, baseline.everyDays);
  const totalMm = Number((count * baseline.depthMm).toFixed(2));
  const litres = mmToLitres(totalMm, areaHa);

  return {
    count,
    depthMm: baseline.depthMm,
    totalMm,
    litres,
  };
}

export interface ComputeSavingsInput {
  daysInRange: number;
  baseline: BaselineConfig;
  areaHa: number;
  recommendedGrossMmList: number[];
  actualGrossMmList: number[];
}

/**
 * Computes complete savings metrics comparing baseline, recommended, and actual irrigation.
 * Honest reporting: negative savings are never clamped or hidden.
 */
export function computeSavings(input: ComputeSavingsInput): SavingsTotals {
  const { daysInRange, baseline, areaHa, recommendedGrossMmList, actualGrossMmList } = input;

  // 1. Baseline
  const baselineRes = baselineTotal(daysInRange, baseline, areaHa);

  // 2. Recommended
  const recommendedCount = recommendedGrossMmList.length;
  const recommendedMm = Number(
    recommendedGrossMmList.reduce((acc, mm) => acc + mm, 0).toFixed(2),
  );
  const recommendedLitres = mmToLitres(recommendedMm, areaHa);

  // 3. Actual
  const actualCount = actualGrossMmList.length;
  const actualMm = Number(actualGrossMmList.reduce((acc, mm) => acc + mm, 0).toFixed(2));
  const actualLitres = mmToLitres(actualMm, areaHa);

  // 4. Potential Savings (Baseline - Recommended)
  const potentialSavedMm = Number((baselineRes.totalMm - recommendedMm).toFixed(2));
  const potentialSavedLitres = Math.round(baselineRes.litres - recommendedLitres);
  const potentialSavedPct =
    baselineRes.totalMm > 0
      ? Number((((baselineRes.totalMm - recommendedMm) / baselineRes.totalMm) * 100).toFixed(2))
      : 0;

  // 5. Realised Savings (Baseline - Actual)
  // Negative savings are reported honestly
  const realisedSavedMm = Number((baselineRes.totalMm - actualMm).toFixed(2));
  const realisedSavedLitres = Math.round(baselineRes.litres - actualLitres);
  const realisedSavedPct =
    baselineRes.totalMm > 0
      ? Number((((baselineRes.totalMm - actualMm) / baselineRes.totalMm) * 100).toFixed(2))
      : 0;

  return {
    days: daysInRange,
    baseline: baselineRes,
    recommended: {
      count: recommendedCount,
      totalMm: recommendedMm,
      litres: recommendedLitres,
    },
    actual: {
      count: actualCount,
      totalMm: actualMm,
      litres: actualLitres,
    },
    potentialSaved: {
      mm: potentialSavedMm,
      litres: potentialSavedLitres,
      pct: potentialSavedPct,
    },
    realisedSaved: {
      mm: realisedSavedMm,
      litres: realisedSavedLitres,
      pct: realisedSavedPct,
    },
  };
}
