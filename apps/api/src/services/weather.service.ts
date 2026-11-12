import { Redis } from 'ioredis';
import { hargreavesEt0 } from '@irrigiq/shared';
import { getRedisClient } from '../infra/redis.js';
import { AppError } from '../errors/AppError.js';
import { WeatherDayModel, IWeatherDayDocument, WeatherSource } from '../models/weatherDay.model.js';

export interface WeatherDay {
  date: string; // YYYY-MM-DD
  tmaxC: number;
  tminC: number;
  rainMm: number;
  et0Mm: number;
  windSpeedMaxKmh?: number;
  source: WeatherSource;
}

export interface CellWeatherResult {
  cellKey: string;
  days: WeatherDay[];
  stale: boolean;
  fetchedAt: Date;
}

export interface OpenMeteoDailyData {
  time?: string[];
  temperature_2m_max?: (number | null)[];
  temperature_2m_min?: (number | null)[];
  precipitation_sum?: (number | null)[];
  et0_fao_evapotranspiration?: (number | null)[];
  wind_speed_10m_max?: (number | null)[];
}

export interface OpenMeteoResponse {
  latitude?: number;
  longitude?: number;
  daily?: OpenMeteoDailyData;
}

export class WeatherServiceError extends AppError {
  constructor(message: string, code = 'WEATHER_ERROR', statusCode = 503) {
    super(message, statusCode, code);
    this.name = 'WeatherServiceError';
  }
}

/**
 * Rounds latitude and longitude to 0.1 degree grid resolution (~11 km).
 * Format: "${lat.toFixed(1)}_${lon.toFixed(1)}"
 */
export function weatherCellKey(lat: number, lon: number): string {
  if (typeof lat !== 'number' || typeof lon !== 'number' || isNaN(lat) || isNaN(lon)) {
    throw new WeatherServiceError('Invalid coordinates for cellKey', 'INVALID_COORDINATES', 400);
  }
  const roundedLat = (Math.round(lat * 10) / 10).toFixed(1);
  const roundedLon = (Math.round(lon * 10) / 10).toFixed(1);
  return `${roundedLat}_${roundedLon}`;
}

/**
 * Parses latitude and longitude from a cellKey string.
 */
export function parseWeatherCellKey(cellKey: string): { lat: number; lon: number } {
  const parts = cellKey.split('_');
  if (parts.length !== 2 || parts[0] === undefined || parts[1] === undefined) {
    throw new WeatherServiceError(`Invalid cellKey format: ${cellKey}`, 'INVALID_CELL_KEY', 400);
  }
  const lat = parseFloat(parts[0]);
  const lon = parseFloat(parts[1]);
  if (isNaN(lat) || isNaN(lon)) {
    throw new WeatherServiceError(
      `Invalid coordinates in cellKey: ${cellKey}`,
      'INVALID_CELL_KEY',
      400,
    );
  }
  return { lat, lon };
}

/**
 * Calculates day of the year (1-366) from YYYY-MM-DD.
 */
export function getDayOfYear(dateStr: string): number {
  const parts = dateStr.split('-');
  if (
    parts.length !== 3 ||
    parts[0] === undefined ||
    parts[1] === undefined ||
    parts[2] === undefined
  ) {
    throw new WeatherServiceError(
      `Invalid date format: ${dateStr}. Expected YYYY-MM-DD.`,
      'INVALID_DATE',
      400,
    );
  }
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  const date = new Date(Date.UTC(year, month, day));
  const startOfYear = new Date(Date.UTC(year, 0, 1));
  const diffMs = date.getTime() - startOfYear.getTime();
  return Math.floor(diffMs / (24 * 60 * 60 * 1000)) + 1;
}

/**
 * Generates an array of YYYY-MM-DD date strings from 'from' to 'to' inclusive.
 */
export function getDateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const current = new Date(`${from}T00:00:00.000Z`);
  const endDate = new Date(`${to}T00:00:00.000Z`);

  if (isNaN(current.getTime()) || isNaN(endDate.getTime())) {
    throw new WeatherServiceError('Invalid date range format', 'INVALID_DATE', 400);
  }

  while (current <= endDate) {
    const formatted = current.toISOString().split('T')[0];
    if (formatted) {
      dates.push(formatted);
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

/**
 * Normalizes raw forecast from Open-Meteo, validating every value:
 * - Rejects impossible values (negative rain, ET0 above 15 mm, tmax below tmin).
 * - When ET0 is missing for a day, computes using hargreavesEt0 from @irrigiq/shared and sets source to 'hargreaves'.
 */
export function normalizeForecast(raw: OpenMeteoResponse, latDeg?: number): WeatherDay[] {
  if (!raw || typeof raw !== 'object') {
    throw new WeatherServiceError(
      'Malformed forecast: response is not an object',
      'INVALID_WEATHER_DATA',
      422,
    );
  }

  const daily = raw.daily;
  if (!daily || !Array.isArray(daily.time) || daily.time.length === 0) {
    throw new WeatherServiceError(
      'Malformed forecast: daily.time is missing or empty',
      'INVALID_WEATHER_DATA',
      422,
    );
  }

  const {
    time,
    temperature_2m_max: tmaxList,
    temperature_2m_min: tminList,
    precipitation_sum: rainList,
    et0_fao_evapotranspiration: et0List,
  } = daily;

  if (!Array.isArray(tmaxList) || !Array.isArray(tminList) || !Array.isArray(rainList)) {
    throw new WeatherServiceError(
      'Malformed forecast: missing daily metric arrays',
      'INVALID_WEATHER_DATA',
      422,
    );
  }

  const len = time.length;
  if (tmaxList.length !== len || tminList.length !== len || rainList.length !== len) {
    throw new WeatherServiceError(
      'Malformed forecast: daily array length mismatch',
      'INVALID_WEATHER_DATA',
      422,
    );
  }

  const effectiveLat = latDeg ?? (typeof raw.latitude === 'number' ? raw.latitude : 20.0);
  const result: WeatherDay[] = [];

  for (let i = 0; i < len; i++) {
    const date = time[i];
    const tmax = tmaxList[i];
    const tmin = tminList[i];
    const rain = rainList[i];
    const et0Raw = Array.isArray(et0List) ? et0List[i] : null;

    if (!date) {
      throw new WeatherServiceError(
        `Invalid forecast data: missing date at index ${i}`,
        'INVALID_WEATHER_DATA',
        422,
      );
    }
    if (typeof tmax !== 'number' || isNaN(tmax) || !isFinite(tmax)) {
      throw new WeatherServiceError(
        `Invalid forecast data: tmax at index ${i} is not a valid number`,
        'INVALID_WEATHER_DATA',
        422,
      );
    }
    if (typeof tmin !== 'number' || isNaN(tmin) || !isFinite(tmin)) {
      throw new WeatherServiceError(
        `Invalid forecast data: tmin at index ${i} is not a valid number`,
        'INVALID_WEATHER_DATA',
        422,
      );
    }
    if (typeof rain !== 'number' || isNaN(rain) || !isFinite(rain)) {
      throw new WeatherServiceError(
        `Invalid forecast data: precipitation at index ${i} is not a valid number`,
        'INVALID_WEATHER_DATA',
        422,
      );
    }

    // Validation checks for impossible values
    if (tmax < tmin) {
      throw new WeatherServiceError(
        `Invalid forecast: tmax is below tmin (${tmax}°C < ${tmin}°C) for ${date}`,
        'INVALID_WEATHER_DATA',
        422,
      );
    }
    if (rain < 0) {
      throw new WeatherServiceError(
        `Invalid forecast: negative precipitation (${rain} mm) for ${date}`,
        'INVALID_WEATHER_DATA',
        422,
      );
    }

    let et0Mm: number;
    let source: WeatherSource;

    if (et0Raw !== null && et0Raw !== undefined && !isNaN(et0Raw)) {
      if (typeof et0Raw !== 'number' || !isFinite(et0Raw)) {
        throw new WeatherServiceError(
          `Invalid forecast: non-numeric ET0 for ${date}`,
          'INVALID_WEATHER_DATA',
          422,
        );
      }
      if (et0Raw > 15) {
        throw new WeatherServiceError(
          `Invalid forecast: ET0 (${et0Raw} mm) above 15 mm for ${date}`,
          'INVALID_WEATHER_DATA',
          422,
        );
      }
      if (et0Raw < 0) {
        throw new WeatherServiceError(
          `Invalid forecast: negative ET0 (${et0Raw} mm) for ${date}`,
          'INVALID_WEATHER_DATA',
          422,
        );
      }
      et0Mm = Number(et0Raw.toFixed(2));
      source = 'open-meteo';
    } else {
      // Missing ET0: use Hargreaves fallback pure function
      const doy = getDayOfYear(date);
      const hargreavesValue = hargreavesEt0(tmax, tmin, effectiveLat, doy);
      et0Mm = Number(hargreavesValue.toFixed(2));
      source = 'hargreaves';
    }

    const rawWind = daily.wind_speed_10m_max?.[i];
    const windSpeedMaxKmh =
      typeof rawWind === 'number' && !isNaN(rawWind) && rawWind >= 0
        ? Number(rawWind.toFixed(1))
        : 0;

    result.push({
      date,
      tmaxC: Number(tmax.toFixed(1)),
      tminC: Number(tmin.toFixed(1)),
      rainMm: Number(rain.toFixed(2)),
      et0Mm,
      windSpeedMaxKmh,
      source,
    });
  }

  return result;
}

export interface FetchForecastOptions {
  timeoutMs?: number;
  retryDelayMs?: number;
  fetchFn?: typeof fetch;
  pastDays?: number;
}

/**
 * Calls Open-Meteo forecast API for daily ET0 (FAO), precipitation sum, max and min temperature,
 * with timezone Asia/Kolkata. Enforces 5-second timeout and 1 retry with short delay.
 */
export async function fetchForecast(
  lat: number,
  lon: number,
  days = 7,
  options?: FetchForecastOptions,
): Promise<WeatherDay[]> {
  const timeoutMs = options?.timeoutMs ?? 5000;
  const retryDelayMs = options?.retryDelayMs ?? 300;
  const fetcher = options?.fetchFn ?? globalThis.fetch;
  const pastDays = options?.pastDays ?? 14;

  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', lat.toString());
  url.searchParams.set('longitude', lon.toString());
  url.searchParams.set(
    'daily',
    'temperature_2m_max,temperature_2m_min,precipitation_sum,et0_fao_evapotranspiration,wind_speed_10m_max',
  );
  url.searchParams.set('timezone', 'Asia/Kolkata');
  url.searchParams.set('forecast_days', days.toString());
  if (pastDays > 0) {
    url.searchParams.set('past_days', pastDays.toString());
  }

  async function executeCall(): Promise<OpenMeteoResponse> {
    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetcher(url.toString(), {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Open-Meteo HTTP error: status ${response.status} ${response.statusText}`);
      }

      return (await response.json()) as OpenMeteoResponse;
    } finally {
      clearTimeout(timeoutTimer);
    }
  }

  try {
    const raw = await executeCall();
    return normalizeForecast(raw, lat);
  } catch (firstError: unknown) {
    // If the data was received and rejected as impossible, don't retry upstream
    if (firstError instanceof WeatherServiceError && firstError.code === 'INVALID_WEATHER_DATA') {
      throw firstError;
    }

    // One retry with a short delay
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));

    try {
      const raw = await executeCall();
      return normalizeForecast(raw, lat);
    } catch (retryError: unknown) {
      if (retryError instanceof WeatherServiceError) {
        throw retryError;
      }
      const message = retryError instanceof Error ? retryError.message : String(retryError);
      throw new WeatherServiceError(`Failed to fetch weather forecast after retry: ${message}`);
    }
  }
}

/**
 * Acquires a distributed Redis mutex for a specific weather grid cell.
 */
export async function acquireRedisLock(
  redis: Redis,
  lockKey: string,
  ttlMs = 10000,
  waitTimeoutMs = 6000,
): Promise<string | null> {
  const token = `${Date.now()}_${Math.random().toString(36).substring(2)}`;
  if (redis.status !== 'ready') {
    return token;
  }
  const startTime = Date.now();

  while (Date.now() - startTime < waitTimeoutMs) {
    if (redis.status !== 'ready') {
      return token;
    }
    try {
      const res = await redis.set(lockKey, token, 'PX', ttlMs, 'NX');
      if (res === 'OK') {
        return token;
      }
    } catch {
      return token;
    }
    // Sleep briefly before next attempt
    await new Promise((resolve) => setTimeout(resolve, 30));
  }

  return null;
}

/**
 * Safely releases a Redis mutex using a Lua script to ensure token match.
 */
export async function releaseRedisLock(
  redis: Redis,
  lockKey: string,
  token: string,
): Promise<boolean> {
  if (redis.status !== 'ready') {
    return true;
  }
  const lua = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;
  try {
    const result = await redis.eval(lua, 1, lockKey, token);
    return result === 1;
  } catch {
    return false;
  }
}

function docToWeatherDay(doc: IWeatherDayDocument): WeatherDay {
  return {
    date: doc.date,
    tmaxC: doc.tmaxC,
    tminC: doc.tminC,
    rainMm: doc.rainMm,
    et0Mm: doc.et0Mm,
    windSpeedMaxKmh: doc.windSpeedMaxKmh ?? 0,
    source: doc.source,
  };
}

export interface GetWeatherOptions extends FetchForecastOptions {
  redis?: Redis;
}

/**
 * Serves weather for a grid cell from MongoDB cache when fetchedAt is under 6 hours old;
 * otherwise acquires a Redis lock to ensure concurrent requests cause exactly one upstream call,
 * fetches, upserts into MongoDB, and returns.
 * If the API fails: returns latest cached days with stale: true.
 * If nothing is cached: returns a clear domain error (never crashes the process).
 */
export async function getWeatherForCell(
  cellKey: string,
  from?: string,
  to?: string,
  options?: GetWeatherOptions,
): Promise<CellWeatherResult> {
  const { lat, lon } = parseWeatherCellKey(cellKey);

  // Default range: 7 days starting today (Asia/Kolkata date)
  const defaultFrom = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const fromDate = from ?? defaultFrom;

  let toDate = to;
  if (!toDate) {
    const d = new Date(`${fromDate}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + 6);
    toDate = d.toISOString().split('T')[0] ?? fromDate;
  }

  const neededDates = getDateRange(fromDate, toDate);
  const neededDateSet = new Set(neededDates);
  const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

  // 1. Check existing cache
  const cachedDocs = await WeatherDayModel.find({
    cellKey,
    date: { $gte: fromDate, $lte: toDate },
  }).sort({ date: 1 });

  const hasAllDates = neededDates.every((d) => cachedDocs.some((doc) => doc.date === d));
  const nowMs = Date.now();
  const allFresh =
    cachedDocs.length > 0 &&
    cachedDocs.every((doc) => nowMs - doc.fetchedAt.getTime() < SIX_HOURS_MS);

  if (hasAllDates && allFresh && cachedDocs[0] !== undefined) {
    return {
      cellKey,
      days: cachedDocs.map(docToWeatherDay),
      stale: false,
      fetchedAt: cachedDocs[0].fetchedAt,
    };
  }

  // 2. Cache miss or stale: acquire Redis lock per cell to prevent duplicate upstream calls
  const redis = options?.redis ?? getRedisClient();
  const lockKey = `lock:weather:${cellKey}`;
  const lockToken = await acquireRedisLock(redis, lockKey, 10000, 8000);

  try {
    // 3. Double-check cache (another concurrent request might have just populated it)
    const recheckDocs = await WeatherDayModel.find({
      cellKey,
      date: { $gte: fromDate, $lte: toDate },
    }).sort({ date: 1 });

    const recheckHasAll = neededDates.every((d) => recheckDocs.some((doc) => doc.date === d));
    const recheckAllFresh =
      recheckDocs.length > 0 &&
      recheckDocs.every((doc) => Date.now() - doc.fetchedAt.getTime() < SIX_HOURS_MS);

    if (recheckHasAll && recheckAllFresh && recheckDocs[0] !== undefined) {
      return {
        cellKey,
        days: recheckDocs.map(docToWeatherDay),
        stale: false,
        fetchedAt: recheckDocs[0].fetchedAt,
      };
    }

    // 4. Fetch fresh forecast from upstream
    const daysToFetch = Math.max(7, Math.min(16, neededDates.length));
    let freshDays: WeatherDay[];

    try {
      freshDays = await fetchForecast(lat, lon, daysToFetch, options);
    } catch (err: unknown) {
      // API call failed: fallback to whatever is cached for this cell
      const fallbackDocs = await WeatherDayModel.find({
        cellKey,
        date: { $gte: fromDate, $lte: toDate },
      }).sort({ date: 1 });

      if (fallbackDocs.length > 0 && fallbackDocs[0] !== undefined) {
        return {
          cellKey,
          days: fallbackDocs.map(docToWeatherDay),
          stale: true,
          fetchedAt: fallbackDocs[0].fetchedAt,
        };
      }

      // Nothing cached at all: throw clear domain error
      const message = err instanceof Error ? err.message : String(err);
      throw new WeatherServiceError(
        `Weather service unavailable and no cached forecast exists for cell ${cellKey}: ${message}`,
        'WEATHER_UNAVAILABLE',
        503,
      );
    }

    // 5. Upsert fetched days into WeatherDay cache collection
    const fetchTimestamp = new Date();
    const bulkOps = freshDays.map((day) => ({
      updateOne: {
        filter: { cellKey, date: day.date },
        update: {
          $set: {
            tmaxC: day.tmaxC,
            tminC: day.tminC,
            rainMm: day.rainMm,
            et0Mm: day.et0Mm,
            windSpeedMaxKmh: day.windSpeedMaxKmh ?? 0,
            source: day.source,
            fetchedAt: fetchTimestamp,
          },
        },
        upsert: true,
      },
    }));

    if (bulkOps.length > 0) {
      await WeatherDayModel.bulkWrite(bulkOps);
    }

    const filteredDays = freshDays.filter((d) => neededDateSet.has(d.date));

    return {
      cellKey,
      days: filteredDays,
      stale: false,
      fetchedAt: fetchTimestamp,
    };
  } finally {
    if (lockToken) {
      await releaseRedisLock(redis, lockKey, lockToken);
    }
  }
}

export interface PastAndForecastWeatherResult {
  cellKey: string;
  pastDays: WeatherDay[];
  forecastDays: WeatherDay[];
  allDays: WeatherDay[];
  stale: boolean;
  fetchedAt: Date;
}

/**
 * Retrieves past days (default 14) and forecast days (default 7) for a grid cell.
 * Cached in MongoDB per cell, with same 6-hour TTL and fallback to stale cached data on failure.
 */
export async function getPastAndForecastWeather(
  cellKey: string,
  pastDaysCount = 14,
  forecastDaysCount = 7,
  options?: GetWeatherOptions,
): Promise<PastAndForecastWeatherResult> {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  // Calculate past start date
  const pastStartObj = new Date(`${today}T00:00:00.000Z`);
  pastStartObj.setUTCDate(pastStartObj.getUTCDate() - pastDaysCount);
  const fromDate = pastStartObj.toISOString().split('T')[0]!;

  // Calculate forecast end date
  const forecastEndObj = new Date(`${today}T00:00:00.000Z`);
  forecastEndObj.setUTCDate(forecastEndObj.getUTCDate() + (forecastDaysCount - 1));
  const toDate = forecastEndObj.toISOString().split('T')[0]!;

  const result = await getWeatherForCell(cellKey, fromDate, toDate, {
    ...options,
    pastDays: pastDaysCount,
  });

  const pastDays = result.days.filter((d) => d.date < today);
  const forecastDays = result.days.filter((d) => d.date >= today);

  return {
    cellKey: result.cellKey,
    pastDays,
    forecastDays,
    allDays: result.days,
    stale: result.stale,
    fetchedAt: result.fetchedAt,
  };
}
