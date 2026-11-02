import { CROPS_MAP, CropStage } from './crops.js';
import {
  stageForDay,
  kcForDay,
  computeEtc,
  effectiveRain,
  netNeed,
  grossNeed,
  SOIL_CONFIG,
  SoilType,
  IrrigationMethod,
} from './science.js';
import { mmToLitres } from './units.js';

export interface FieldCropData {
  cropKey: string;
  sowingDate: Date | string;
}

export interface WeatherDayData {
  date: string; // YYYY-MM-DD
  et0Mm: number;
  rainMm: number;
  tmaxC?: number;
  tminC?: number;
}

export interface DailyNeed {
  date: string;
  das: number; // Days after sowing
  stage: CropStage | 'before_sowing';
  et0Mm: number;
  kc: number;
  etcMm: number;
  rainMm: number;
  effectiveRainMm: number;
  netNeedMm: number;
}

export interface FieldPlanningData {
  soilType: SoilType;
  method: IrrigationMethod;
  areaHa: number;
}

export interface SensorReadingData {
  moisturePct: number;
  recordedAt?: Date | string;
}

export interface IrrigationPlanItem {
  date: string;
  action: 'irrigate' | 'skip';
  netMm: number;
  grossMm: number;
  litres: number;
  reasonKey: string;
  params: Record<string, number | string>;
  deficitMm: number;
}

/**
 * Computes elapsed days after sowing from sowingDate to targetDate (YYYY-MM-DD).
 */
export function calculateDaysAfterSowing(sowingDate: Date | string, targetDate: string): number {
  const sowingStr =
    typeof sowingDate === 'string'
      ? sowingDate.split('T')[0]!
      : sowingDate.toISOString().split('T')[0]!;

  const sowingMs = new Date(`${sowingStr}T00:00:00.000Z`).getTime();
  const targetMs = new Date(`${targetDate}T00:00:00.000Z`).getTime();
  return Math.round((targetMs - sowingMs) / (24 * 60 * 60 * 1000));
}

/**
 * Builds daily water requirements (ET0, Kc, ETc, effective rain, net need)
 * for each weather day based on the field crop and sowing date.
 */
export function buildDailyNeeds(
  field: FieldCropData,
  weatherDays: readonly WeatherDayData[],
): DailyNeed[] {
  const crop = CROPS_MAP.get(field.cropKey);
  if (!crop) {
    throw new Error(`Unknown crop key: ${field.cropKey}`);
  }

  return weatherDays.map((w) => {
    const das = calculateDaysAfterSowing(field.sowingDate, w.date);

    if (das < 0) {
      // Prior to sowing
      const effRain = effectiveRain(w.rainMm);
      return {
        date: w.date,
        das,
        stage: 'before_sowing',
        et0Mm: w.et0Mm,
        kc: 0,
        etcMm: 0,
        rainMm: w.rainMm,
        effectiveRainMm: effRain,
        netNeedMm: 0,
      };
    }

    const stage = stageForDay(crop, das);
    const kc = kcForDay(crop, das) ?? 0;
    const etcMm = computeEtc(w.et0Mm, kc);
    const effectiveRainMm = effectiveRain(w.rainMm);
    const netNeedMm = netNeed(etcMm, effectiveRainMm);

    return {
      date: w.date,
      das,
      stage,
      et0Mm: w.et0Mm,
      kc,
      etcMm,
      rainMm: w.rainMm,
      effectiveRainMm,
      netNeedMm,
    };
  });
}

/**
 * Plans daily irrigation actions over the forecast window:
 * - Accumulates net deficit since last irrigation.
 * - When deficit reaches soil trigger, schedules irrigation for min(deficit, maxDepth).
 * - Converts to gross depth via method efficiency and to litres via field area.
 * - Sensor rule: moisture >= 80% skips today; moisture <= 40% irrigates now (capped at maxDepth).
 * - Rain rule: significant rainfall expected (>= 5 mm) skips today.
 */
export function planIrrigation(
  field: FieldPlanningData,
  dailyNeeds: readonly DailyNeed[],
  lastIrrigationDate?: Date | string,
  sensorReading?: SensorReadingData,
): IrrigationPlanItem[] {
  const soilLimits = SOIL_CONFIG.maxDepthMm[field.soilType];
  const soilTrigger = SOIL_CONFIG.triggerMm[field.soilType];

  if (soilLimits === undefined || soilTrigger === undefined) {
    throw new Error(`Unsupported soil type: ${field.soilType}`);
  }

  const lastIrrigStr = lastIrrigationDate
    ? typeof lastIrrigationDate === 'string'
      ? lastIrrigationDate.split('T')[0]
      : lastIrrigationDate.toISOString().split('T')[0]
    : undefined;

  let deficit = 0;
  const plan: IrrigationPlanItem[] = [];

  for (let i = 0; i < dailyNeeds.length; i++) {
    const day = dailyNeeds[i]!;

    // If day is before or on last irrigation date, deficit was reset
    if (lastIrrigStr && day.date <= lastIrrigStr) {
      deficit = 0;
      plan.push({
        date: day.date,
        action: 'skip',
        netMm: 0,
        grossMm: 0,
        litres: 0,
        reasonKey: 'reason.not_needed',
        params: { mm: 0 },
        deficitMm: 0,
      });
      continue;
    }

    deficit = Number((deficit + day.netNeedMm).toFixed(2));

    let action: 'irrigate' | 'skip' = 'skip';
    let netMm = 0;
    let reasonKey = 'reason.not_needed';
    let params: Record<string, number | string> = {};

    // 1. Sensor rule (applies on day 0 / today if sensor reading is provided)
    if (i === 0 && sensorReading !== undefined) {
      if (sensorReading.moisturePct >= 80) {
        action = 'skip';
        reasonKey = 'reason.sensor_wet';
        params = { pct: sensorReading.moisturePct };
        deficit = 0; // Soil is soaked
      } else if (sensorReading.moisturePct <= 40) {
        action = 'irrigate';
        netMm = Math.min(Math.max(deficit, soilTrigger), soilLimits);
        reasonKey = 'reason.sensor_dry';
        params = { pct: sensorReading.moisturePct };
        deficit = 0; // Replenished by irrigation
      }
    }

    // 2. If sensor did not trigger an action, evaluate weather and deficit rules
    if (reasonKey === 'reason.not_needed') {
      if (day.rainMm >= 5) {
        // Rain expected today: skip irrigation to save water
        action = 'skip';
        netMm = 0;
        reasonKey = 'reason.rain_expected';
        params = { mm: day.rainMm };
      } else if (deficit >= soilTrigger) {
        // Deficit has reached the soil irrigation trigger
        action = 'irrigate';
        netMm = Math.min(deficit, soilLimits);
        reasonKey = 'reason.deficit_reached';
        params = { mm: Number(deficit.toFixed(1)) };
        deficit = Number(Math.max(0, deficit - netMm).toFixed(2));
      } else {
        // Soil moisture deficit is below trigger
        action = 'skip';
        netMm = 0;
        reasonKey = 'reason.not_needed';
        params = { mm: Number(deficit.toFixed(1)) };
      }
    }

    let grossMm = 0;
    let litres = 0;

    if (action === 'irrigate' && netMm > 0) {
      grossMm = grossNeed(netMm, field.method);
      litres = mmToLitres(grossMm, field.areaHa);
    }

    plan.push({
      date: day.date,
      action,
      netMm,
      grossMm,
      litres,
      reasonKey,
      params,
      deficitMm: deficit,
    });
  }

  return plan;
}

/**
 * Explains an irrigation recommendation item by extracting its i18n reasonKey and parameters.
 */
export function explain(planItem: IrrigationPlanItem): {
  reasonKey: string;
  params: Record<string, number | string>;
} {
  return {
    reasonKey: planItem.reasonKey,
    params: planItem.params,
  };
}
