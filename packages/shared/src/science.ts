import { Crop, CropStage } from './crops.js';

export type IrrigationMethod = 'drip' | 'sprinkler' | 'flood';

/**
 * Irrigation application efficiencies by method (FAO-56 standard values).
 * Drip: ~90% efficient, Sprinkler: ~75% efficient, Flood (surface): ~60% efficient.
 */
export const IRRIGATION_EFFICIENCY: Record<IrrigationMethod, number> = {
  drip: 0.9,
  sprinkler: 0.75,
  flood: 0.6,
} as const;

/**
 * Tunable soil water thresholds and single application depth limits.
 * - triggerMm: Accumulated water deficit required before scheduling an irrigation.
 * - maxDepthMm: Maximum single application depth to prevent deep percolation / runoff.
 */
export const SOIL_CONFIG = {
  maxDepthMm: {
    sandy: 25,
    loam: 40,
    clay: 50,
  },
  triggerMm: {
    sandy: 12,
    loam: 20,
    clay: 25,
  },
} as const;

export type SoilType = keyof typeof SOIL_CONFIG.maxDepthMm;

/**
 * Determines the FAO-56 crop growth stage based on elapsed days after sowing.
 *
 * @param crop - Crop parameters including stageDays (ini, dev, mid, late).
 * @param daysAfterSowing - Non-negative integer indicating days since sowing date.
 * @returns Growth stage: 'ini', 'dev', 'mid', 'late', or 'finished'.
 */
export function stageForDay(crop: Crop, daysAfterSowing: number): CropStage {
  if (isNaN(daysAfterSowing)) {
    throw new Error('Days after sowing must be a valid number');
  }
  if (daysAfterSowing < 0) {
    throw new Error('Days after sowing cannot be negative');
  }

  const { ini, dev, mid, late } = crop.stageDays;

  if (daysAfterSowing < ini) {
    return 'ini';
  }
  if (daysAfterSowing < ini + dev) {
    return 'dev';
  }
  if (daysAfterSowing < ini + dev + mid) {
    return 'mid';
  }
  if (daysAfterSowing < ini + dev + mid + late) {
    return 'late';
  }
  return 'finished';
}

/**
 * Calculates the crop coefficient (Kc) for a given day after sowing following the FAO-56 single crop curve:
 * - Constant Kc_ini across initial stage.
 * - Linear interpolation from Kc_ini to Kc_mid across development stage.
 * - Constant Kc_mid across mid-season stage.
 * - Linear interpolation from Kc_mid to Kc_end across late season stage.
 * - Returns null once crop has completed all growth stages ('finished').
 *
 * @param crop - Crop parameters containing Kc values and stage lengths.
 * @param daysAfterSowing - Non-negative integer indicating days since sowing date.
 * @returns Kc value rounded to 3 decimal places, or null if harvest/season finished.
 */
export function kcForDay(crop: Crop, daysAfterSowing: number): number | null {
  const stage = stageForDay(crop, daysAfterSowing);
  if (stage === 'finished') {
    return null;
  }

  const { ini, dev, mid, late } = crop.stageDays;
  const { ini: kcIni, mid: kcMid, end: kcEnd } = crop.kc;

  if (stage === 'ini') {
    return kcIni;
  }

  if (stage === 'dev') {
    // Development stage: smoothly ramps from kcIni (day ini - 1) to kcMid (day ini + dev)
    const t0 = ini - 1;
    const t1 = ini + dev;
    const fraction = (daysAfterSowing - t0) / (t1 - t0);
    const interpolated = kcIni + fraction * (kcMid - kcIni);
    return Number(interpolated.toFixed(3));
  }

  if (stage === 'mid') {
    return kcMid;
  }

  if (stage === 'late') {
    // Late season stage: smoothly ramps from kcMid (day ini + dev + mid - 1) to kcEnd (day total)
    const t0 = ini + dev + mid - 1;
    const t1 = ini + dev + mid + late;
    const fraction = (daysAfterSowing - t0) / (t1 - t0);
    const interpolated = kcMid + fraction * (kcEnd - kcMid);
    return Number(interpolated.toFixed(3));
  }

  return null;
}

/**
 * Calculates daily crop evapotranspiration (ETc) under standard conditions.
 * Formula: ETc = ET0 * Kc (FAO-56 Eq. 56).
 *
 * @param et0 - Reference evapotranspiration in mm/day.
 * @param kc - Crop coefficient multiplier.
 * @returns Crop water demand (ETc) in mm/day rounded to 2 decimal places.
 */
export function computeEtc(et0: number, kc: number): number {
  if (isNaN(et0) || isNaN(kc)) {
    throw new Error('ET0 and Kc must be valid numbers');
  }
  if (et0 < 0 || kc < 0) {
    throw new Error('ET0 and Kc must be non-negative');
  }
  return Number((et0 * kc).toFixed(2));
}

export interface EffectiveRainOptions {
  ignoreBelowMm?: number;
  factor?: number;
}

/**
 * Calculates effective rainfall available in the crop root zone.
 * Default rule: rainfall <= 5 mm evaporates without infiltrating (0 mm effective);
 * for rainfall > 5 mm, 80% of the excess is absorbed (20% lost to surface runoff/canopy interception).
 * Formula: 0 if rain <= ignoreBelowMm, else factor * (rain - ignoreBelowMm).
 *
 * @param rainMm - Total daily rainfall forecast in millimetres.
 * @param options - Configurable threshold and absorption factor.
 * @returns Usable rainfall in millimetres rounded to 2 decimal places.
 */
export function effectiveRain(rainMm: number, options: EffectiveRainOptions = {}): number {
  if (isNaN(rainMm)) {
    throw new Error('Rainfall must be a valid number');
  }
  if (rainMm < 0) {
    throw new Error('Rainfall cannot be negative');
  }

  const { ignoreBelowMm = 5, factor = 0.8 } = options;

  if (rainMm <= ignoreBelowMm) {
    return 0;
  }

  return Number((factor * (rainMm - ignoreBelowMm)).toFixed(2));
}

/**
 * Computes net irrigation requirement after accounting for effective rainfall.
 * Formula: netNeed = max(0, ETc - effectiveRain).
 *
 * @param etc - Crop water need in millimetres.
 * @param effRain - Usable rainfall in millimetres.
 * @returns Net water deficit in millimetres rounded to 2 decimal places.
 */
export function netNeed(etc: number, effRain: number): number {
  if (isNaN(etc) || isNaN(effRain)) {
    throw new Error('ETc and effective rainfall must be valid numbers');
  }
  if (etc < 0 || effRain < 0) {
    throw new Error('ETc and effective rainfall cannot be negative');
  }

  return Number(Math.max(0, etc - effRain).toFixed(2));
}

/**
 * Computes gross irrigation depth to apply through the irrigation system.
 * Takes into account distribution and evaporation losses (application efficiency).
 * Formula: grossNeed = netNeed / efficiency.
 *
 * @param netMm - Net irrigation required in millimetres.
 * @param method - Irrigation method: 'drip' (0.90), 'sprinkler' (0.75), or 'flood' (0.60).
 * @returns Gross depth to pump in millimetres rounded to 2 decimal places.
 */
export function grossNeed(netMm: number, method: IrrigationMethod): number {
  if (isNaN(netMm)) {
    throw new Error('Net irrigation need must be a valid number');
  }
  if (netMm < 0) {
    throw new Error('Net irrigation need cannot be negative');
  }

  const efficiency = IRRIGATION_EFFICIENCY[method];
  if (!efficiency) {
    throw new Error(`Unsupported irrigation method: ${method}`);
  }

  return Number((netMm / efficiency).toFixed(2));
}

/**
 * Calculates Reference Evapotranspiration (ET0) using the FAO-56 Hargreaves-Samani method.
 * Used as a dependable fallback when full solar radiation, wind speed, and humidity data
 * are unavailable from the forecast provider.
 *
 * Formula:
 * ET0 = 0.0023 * (Tmean + 17.8) * sqrt(Tmax - Tmin) * Ra (mm/day)
 * Where Ra is extraterrestrial radiation computed from latitude and day of year (FAO-56 Eqs. 21-28).
 *
 * @param tmaxC - Daily maximum air temperature in degrees Celsius.
 * @param tminC - Daily minimum air temperature in degrees Celsius.
 * @param latDeg - Latitude in decimal degrees (-90 to 90).
 * @param dayOfYear - Julian day of year (1 to 366).
 * @returns Reference ET0 in mm/day, clamped at 0.
 */
export function hargreavesEt0(
  tmaxC: number,
  tminC: number,
  latDeg: number,
  dayOfYear: number,
): number {
  if (isNaN(tmaxC) || isNaN(tminC) || isNaN(latDeg) || isNaN(dayOfYear)) {
    throw new Error('All Hargreaves parameters must be valid numbers');
  }
  if (tmaxC < tminC) {
    throw new Error('Tmax cannot be less than Tmin');
  }
  if (latDeg < -90 || latDeg > 90) {
    throw new Error('Latitude must be between -90 and 90 degrees');
  }
  if (dayOfYear < 1 || dayOfYear > 366) {
    throw new Error('Day of year must be between 1 and 366');
  }

  const tmean = (tmaxC + tminC) / 2;
  const tempRange = tmaxC - tminC;

  if (tempRange === 0 || tmean + 17.8 <= 0) {
    return 0;
  }

  // Latitude in radians
  const phi = (Math.PI / 180) * latDeg;

  // Inverse relative distance Earth-Sun (FAO-56 Eq. 23)
  const dr = 1 + 0.033 * Math.cos(((2 * Math.PI) / 365) * dayOfYear);

  // Solar declination in radians (FAO-56 Eq. 24)
  const delta = 0.409 * Math.sin(((2 * Math.PI) / 365) * dayOfYear - 1.39);

  // Sunset hour angle in radians (FAO-56 Eq. 25 & 26)
  const X = -Math.tan(phi) * Math.tan(delta);
  const clampedX = Math.max(-1, Math.min(1, X));
  const ws = Math.acos(clampedX);

  // Solar constant Gsc = 0.0820 MJ m^-2 min^-1
  const Gsc = 0.082;

  // Extraterrestrial radiation Ra in MJ m^-2 day^-1 (FAO-56 Eq. 21)
  const Ra_MJ =
    ((24 * 60) / Math.PI) *
    Gsc *
    dr *
    (ws * Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.sin(ws));

  // Convert Ra to equivalent evaporation in mm/day (1 MJ m^-2 day^-1 ≈ 0.408 mm/day)
  const Ra_mm = 0.408 * Math.max(0, Ra_MJ);

  // FAO-56 Eq. 52
  const et0 = 0.0023 * (tmean + 17.8) * Math.sqrt(tempRange) * Ra_mm;

  return Number(Math.max(0, et0).toFixed(2));
}
