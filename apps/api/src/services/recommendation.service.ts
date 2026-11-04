import { Types } from 'mongoose';
import {
  buildDailyNeeds,
  planIrrigation,
  SoilType,
  IrrigationMethod,
  runMinutes,
  pumpCost,
  expandWindows,
  planPumpSegments,
  addDaysToIsoDate,
  grossNeed,
  mmToLitres,
  SOIL_CONFIG,
  PowerSchedule,
  stateForPoint,
  getCalendarForState,
  planRainfed,
} from '@irrigiq/shared';
import { FieldModel } from '../models/field.model.js';
import { PumpModel } from '../models/pump.model.js';
import { PowerScheduleModel } from '../models/powerSchedule.model.js';
import { RecommendationModel, IRecommendationDocument } from '../models/recommendation.model.js';
import { IrrigationLogModel } from '../models/irrigation-log.model.js';
import {
  weatherCellKey,
  getWeatherForCell,
  getPastAndForecastWeather,
  GetWeatherOptions,
} from './weather.service.js';
import { AppError } from '../errors/AppError.js';
import { logger } from '../config/logger.js';

export interface RecomputeOptions extends GetWeatherOptions {
  sensorReading?: {
    moisturePct: number;
    recordedAt?: Date | string;
  };
  lastIrrigationDate?: Date | string;
}

/**
 * Loads a field, retrieves weather for its 0.1 degree grid cell,
 * computes the 7-day irrigation plan, and upserts recommendations (idempotent).
 */
export async function recomputeField(
  fieldId: string | Types.ObjectId,
  options?: RecomputeOptions,
): Promise<IRecommendationDocument[]> {
  const objectId = typeof fieldId === 'string' ? new Types.ObjectId(fieldId) : fieldId;
  const field = await FieldModel.findById(objectId);

  if (!field) {
    throw new AppError('Field not found', 404, 'FIELD_NOT_FOUND');
  }

  // GeoJSON Point coordinates: [longitude, latitude]
  const lon = field.centroid.coordinates[0];
  const lat = field.centroid.coordinates[1];
  if (typeof lat !== 'number' || typeof lon !== 'number') {
    throw new AppError('Field centroid is missing valid coordinates', 400, 'INVALID_GEOMETRY');
  }

  const cellKey = weatherCellKey(lat, lon);

  // 7-day window starting today in Asia/Kolkata
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  // Handle Rain-fed Mode
  if (field.waterMode === 'rainfed') {
    // 1. Retrieve past 14 days and forecast weather
    const weatherResult = await getPastAndForecastWeather(cellKey, 14, 7, options);
    const staleWeather = weatherResult.stale;

    // 2. Lookup state and crop calendar
    const state = stateForPoint(lon, lat);
    const calendar = getCalendarForState(state, field.cropKey);

    // 3. Plan rainfed advisory
    const rainfedPlan = planRainfed(
      {
        cropKey: field.cropKey,
        sowingDate: field.sowingDate,
        soilType: field.soilType as SoilType,
        hasProtectiveWater: field.hasProtectiveWater ?? false,
      },
      weatherResult.pastDays,
      weatherResult.forecastDays,
      calendar,
      today,
    );

    // 4. Upsert rainfed recommendations for the 7 forecast days
    const now = new Date();
    const bulkOps = weatherResult.forecastDays.map((fDay) => ({
      updateOne: {
        filter: { fieldId: field._id, forDate: fDay.date },
        update: {
          $set: {
            userId: field.userId,
            action: 'skip' as const,
            netMm: 0,
            grossMm: 0,
            litres: 0,
            runMinutes: null,
            splitAcrossDays: false,
            pumpCost: null,
            pumpMissing: false,
            pumpSegments: [],
            missingMinutes: 0,
            notes: rainfedPlan.advice,
            reasonKey: rainfedPlan.statusKey,
            params: rainfedPlan.params,
            waterMode: 'rainfed' as const,
            rainfedPlan: {
              statusKey: rainfedPlan.statusKey,
              params: rainfedPlan.params,
              advice: rainfedPlan.advice,
            },
            deficitMm: 0,
            et0Mm: fDay.et0Mm,
            kc: 0,
            etcMm: 0,
            rainMm: fDay.rainMm,
            effectiveRainMm: fDay.rainMm,
            staleWeather,
            computedAt: now,
          },
        },
        upsert: true,
      },
    }));

    if (bulkOps.length > 0) {
      await RecommendationModel.bulkWrite(bulkOps);
    }

    logger.info(
      { fieldId: field._id.toString(), waterMode: 'rainfed', statusKey: rainfedPlan.statusKey, staleWeather },
      'Rain-fed recommendations recomputed successfully',
    );

    return RecommendationModel.find({ fieldId: field._id })
      .sort({ forDate: 1 })
      .limit(7);
  }

  const endDateObj = new Date(`${today}T00:00:00.000Z`);
  endDateObj.setUTCDate(endDateObj.getUTCDate() + 6);
  const toDate = endDateObj.toISOString().split('T')[0]!;

  // Retrieve weather from cache or upstream
  const weatherResult = await getWeatherForCell(cellKey, today, toDate, options);
  const staleWeather = weatherResult.stale;

  // Build daily crop water needs using shared FAO-56 pure function
  const dailyNeeds = buildDailyNeeds(
    {
      cropKey: field.cropKey,
      sowingDate: field.sowingDate,
    },
    weatherResult.days,
  );

  // Determine latest irrigation date to reset deficit if not explicitly provided
  let lastIrrigationDate = options?.lastIrrigationDate;
  if (!lastIrrigationDate) {
    const latestLog = await IrrigationLogModel.findOne({
      fieldId: field._id,
      date: { $lte: today },
    }).sort({ date: -1 });

    if (latestLog) {
      lastIrrigationDate = latestLog.date;
    }
  }

  // Generate irrigation plan using shared pure function
  const plan = planIrrigation(
    {
      soilType: field.soilType as SoilType,
      method: field.method as IrrigationMethod,
      areaHa: field.areaHa,
    },
    dailyNeeds,
    lastIrrigationDate,
    options?.sensorReading,
  );

  // Look up pump configuration if assigned to field
  const pump = field.pumpId ? await PumpModel.findById(field.pumpId) : null;
  const pumpMissing = !pump;
  const powerSchedule = pump?.scheduleId
    ? await PowerScheduleModel.findById(pump.scheduleId)
    : null;

  // Bulk upsert into Recommendation collection
  const now = new Date();
  const bulkOps = plan.map((item) => {
    const need = dailyNeeds.find((d) => d.date === item.date);

    let runMinutesVal: number | null = null;
    let splitAcrossDaysVal = false;
    let pumpCostVal: number | null = null;
    let pumpSegmentsVal: { start: string; end: string; durationMinutes: number }[] = [];
    let missingMinutesVal = 0;
    let notesVal: string[] = [];

    if (pump) {
      const run = runMinutes(item.litres, pump.dischargeLph);
      runMinutesVal = run.minutes;
      splitAcrossDaysVal = run.splitAcrossDays;
      pumpCostVal = pumpCost(run.minutes, pump.costPerHour);

      if (powerSchedule && run.minutes > 0) {
        const intervals = expandWindows(powerSchedule as unknown as PowerSchedule, item.date);
        const weatherDay = weatherResult.days.find((d) => d.date === item.date);
        const planResult = planPumpSegments(run.minutes, intervals, {
          method: field.method as 'drip' | 'sprinkler' | 'flood',
          windSpeedMax: weatherDay?.windSpeedMaxKmh,
        });
        pumpSegmentsVal = planResult.segments;
        missingMinutesVal = planResult.missingMinutes;
        notesVal = planResult.notes;
      }
    }

    return {
      updateOne: {
        filter: { fieldId: field._id, forDate: item.date },
        update: {
          $set: {
            userId: field.userId,
            action: item.action,
            netMm: item.netMm,
            grossMm: item.grossMm,
            litres: item.litres,
            runMinutes: runMinutesVal,
            splitAcrossDays: splitAcrossDaysVal,
            pumpCost: pumpCostVal,
            pumpMissing,
            pumpSegments: pumpSegmentsVal,
            missingMinutes: missingMinutesVal,
            notes: notesVal,
            reasonKey: item.reasonKey,
            params: item.params,
            waterMode: 'irrigated' as const,
            rainfedPlan: null,
            deficitMm: item.deficitMm,
            et0Mm: need?.et0Mm ?? 0,
            kc: need?.kc ?? 0,
            etcMm: need?.etcMm ?? 0,
            rainMm: need?.rainMm ?? 0,
            effectiveRainMm: need?.effectiveRainMm ?? 0,
            staleWeather,
            computedAt: now,
          },
        },
        upsert: true,
      },
    };
  });

  if (bulkOps.length > 0) {
    await RecommendationModel.bulkWrite(bulkOps);
  }

  logger.info(
    { fieldId: field._id.toString(), days: plan.length, staleWeather },
    'Recommendations recomputed successfully',
  );

  return RecommendationModel.find({
    fieldId: field._id,
    forDate: { $gte: today, $lte: toDate },
  }).sort({ forDate: 1 });
}

/**
 * Retrieves recommendations for a given field and verified owner.
 */
export async function getRecommendationsForField(
  userId: string,
  fieldId: string,
  days = 7,
): Promise<IRecommendationDocument[]> {
  if (!Types.ObjectId.isValid(fieldId)) {
    throw new AppError('Field not found', 404, 'FIELD_NOT_FOUND');
  }

  const field = await FieldModel.findOne({
    _id: new Types.ObjectId(fieldId),
    userId: new Types.ObjectId(userId),
  });

  if (!field) {
    throw new AppError('Field not found', 404, 'FIELD_NOT_FOUND');
  }

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const endDateObj = new Date(`${today}T00:00:00.000Z`);
  endDateObj.setUTCDate(endDateObj.getUTCDate() + (days - 1));
  const toDate = endDateObj.toISOString().split('T')[0]!;

  const recs = await RecommendationModel.find({
    fieldId: field._id,
    userId: new Types.ObjectId(userId),
    forDate: { $gte: today, $lte: toDate },
  }).sort({ forDate: 1 });

  // If no recommendations exist yet, calculate them on demand
  if (recs.length === 0) {
    return recomputeField(field._id);
  }

  return recs;
}

/**
 * Reschedules irrigation for a field when there is a power cut on `date`.
 * Moves planned pump segments to the next power window / next interval
 * while retaining the accumulated root-zone deficit.
 */
export async function rescheduleForNoPower(
  fieldId: string | Types.ObjectId,
  date?: string,
): Promise<{
  currentRecommendation: IRecommendationDocument;
  rescheduledRecommendation?: IRecommendationDocument | null;
}> {
  const objectId = typeof fieldId === 'string' ? new Types.ObjectId(fieldId) : fieldId;
  const field = await FieldModel.findById(objectId);
  if (!field) {
    throw new AppError('Field not found', 404, 'FIELD_NOT_FOUND');
  }

  const targetDate =
    date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  let rec = await RecommendationModel.findOne({ fieldId: field._id, forDate: targetDate });
  if (!rec) {
    await recomputeField(field._id);
    rec = await RecommendationModel.findOne({ fieldId: field._id, forDate: targetDate });
  }

  if (!rec) {
    throw new AppError('Recommendation not found for the specified date', 404, 'RECOMMENDATION_NOT_FOUND');
  }

  const keptDeficit = rec.deficitMm;
  const wasIrrigating = rec.action === 'irrigate' || (rec.runMinutes ?? 0) > 0;
  const runMins = rec.runMinutes ?? 0;

  // Mark the outage on the current date: keep the deficit!
  rec.action = 'skip';
  rec.reasonKey = 'reason.power_cut';
  rec.notes = Array.from(new Set([...(rec.notes || []), 'plan.no_power']));
  rec.pumpSegments = [];
  rec.missingMinutes = wasIrrigating ? runMins : 0;
  rec.litres = 0;
  rec.grossMm = 0;
  rec.netMm = 0;
  rec.runMinutes = 0;
  rec.pumpCost = 0;
  rec.deficitMm = keptDeficit;
  await rec.save();

  // Move to next interval (next day)
  const nextDate = addDaysToIsoDate(targetDate, 1);
  const nextRec = await RecommendationModel.findOne({ fieldId: field._id, forDate: nextDate });

  if (nextRec && wasIrrigating) {
    const pump = field.pumpId ? await PumpModel.findById(field.pumpId) : null;
    const powerSchedule = pump?.scheduleId
      ? await PowerScheduleModel.findById(pump.scheduleId)
      : null;

    nextRec.deficitMm = Number((nextRec.deficitMm + keptDeficit).toFixed(2));
    nextRec.action = 'irrigate';

    const soilLimits = SOIL_CONFIG.maxDepthMm[field.soilType as SoilType] ?? 50;
    nextRec.netMm = Math.min(nextRec.deficitMm, soilLimits);
    nextRec.grossMm = grossNeed(nextRec.netMm, field.method as IrrigationMethod);
    nextRec.litres = mmToLitres(nextRec.grossMm, field.areaHa);
    nextRec.reasonKey = 'reason.deficit_reached';
    nextRec.params = { mm: Number(nextRec.deficitMm.toFixed(1)) };

    if (pump) {
      const run = runMinutes(nextRec.litres, pump.dischargeLph);
      nextRec.runMinutes = run.minutes;
      nextRec.splitAcrossDays = run.splitAcrossDays;
      nextRec.pumpCost = pumpCost(run.minutes, pump.costPerHour);
      nextRec.pumpMissing = false;

      if (powerSchedule && run.minutes > 0) {
        const intervals = expandWindows(powerSchedule as unknown as PowerSchedule, nextDate);
        const planResult = planPumpSegments(run.minutes, intervals, {
          method: field.method as 'drip' | 'sprinkler' | 'flood',
        });
        nextRec.pumpSegments = planResult.segments;
        nextRec.missingMinutes = planResult.missingMinutes;
        nextRec.notes = planResult.notes;
      }
    }

    await nextRec.save();
  }

  logger.info(
    { fieldId: field._id.toString(), targetDate, nextDate, keptDeficit },
    'Field irrigation rescheduled due to power outage',
  );

  return {
    currentRecommendation: rec,
    rescheduledRecommendation: nextRec,
  };
}
