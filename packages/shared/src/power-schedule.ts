import type { SupportedLanguage } from './schemas.js';

export const POWER_SCHEDULE_CONFIG = {
  version: '1.0.0',
  windLimitKmh: {
    value: 20,
    source: 'FAO-56 Irrigation and Drainage Paper No. 56 / Sprinkler droplet drift threshold (starter 20 km/h)',
    verified: false,
  },
  defaultMaxSplits: {
    value: 2,
    source: 'Phase 17 specifications / Maximum 2 operational splits per daily irrigation plan',
    verified: false,
  },
} as const;

export interface PowerWindow {
  days: readonly number[] | number[]; // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  start: string;  // 'HH:MM' (24-hour, e.g. '22:00')
  end: string;    // 'HH:MM' (24-hour, e.g. '06:00')
}

export interface ScheduleRotation {
  weekA: readonly PowerWindow[] | PowerWindow[];
  weekB: readonly PowerWindow[] | PowerWindow[];
  anchorDate: string; // YYYY-MM-DD
}

export interface PowerSchedule {
  id?: string;
  userId?: string;
  name: string;
  type?: 'night' | 'day' | 'custom';
  windows: readonly PowerWindow[] | PowerWindow[];
  rotation?: ScheduleRotation | null;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export const POWER_SCHEDULE_PRESETS = {
  night: {
    name: 'Night',
    type: 'night' as const,
    windows: [
      {
        days: [0, 1, 2, 3, 4, 5, 6],
        start: '22:00',
        end: '06:00',
      },
    ],
  },
  day: {
    name: 'Day',
    type: 'day' as const,
    windows: [
      {
        days: [0, 1, 2, 3, 4, 5, 6],
        start: '06:00',
        end: '14:00',
      },
    ],
  },
} as const;

export interface ConcreteInterval {
  start: string; // ISO string with IST offset, e.g. "2026-11-04T22:00:00+05:30"
  end: string;   // ISO string with IST offset, e.g. "2026-11-05T00:00:00+05:30"
  durationMinutes: number;
  period: 'night' | 'morning' | 'day' | 'any';
  day: string;   // YYYY-MM-DD
  startTime: string; // '22:00'
  endTime: string;   // '24:00' or '06:00'
}

export interface PlannedSegment {
  start: string;
  end: string;
  durationMinutes: number;
  fieldId?: string;
}

export interface PumpPlanningPreferences {
  prefer?: 'night' | 'morning' | 'any';
  maxSplits?: number;
  windSpeedMax?: number; // km/h
  windLimit?: number;    // km/h
  method?: 'drip' | 'sprinkler' | 'flood';
}

export interface PumpPlanResult {
  segments: PlannedSegment[];
  missingMinutes: number;
  notes: string[];
}

export interface FieldPumpRun {
  fieldId: string;
  fieldName?: string;
  deficitMm: number;
  runMinutes: number;
  cropKey?: string;
  method?: 'drip' | 'sprinkler' | 'flood';
}

export interface FieldScheduleResult {
  fieldId: string;
  segments: PlannedSegment[];
  missingMinutes: number;
  notes: string[];
}

export interface PumpDayPlan {
  pumpId: string;
  fieldPlans: FieldScheduleResult[];
  totalRunMinutes: number;
  totalMissingMinutes: number;
}

/**
 * Parses 'HH:MM' string to total minutes from midnight.
 */
export function timeStringToMinutes(hhmm: string): number {
  const [hStr, mStr] = hhmm.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (isNaN(h) || isNaN(m) || h < 0 || h > 24 || m < 0 || m > 59) {
    throw new Error(`Invalid time format: ${hhmm}`);
  }
  return h * 60 + m;
}

/**
 * Returns the weekday (0 = Sunday, ..., 6 = Saturday) for an ISO date 'YYYY-MM-DD'.
 */
export function getWeekdayFromIsoDate(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  const utc = Date.UTC(y!, m! - 1, d!);
  return new Date(utc).getUTCDay();
}

/**
 * Adds an integer number of days to an ISO date 'YYYY-MM-DD'.
 */
export function addDaysToIsoDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const utc = Date.UTC(y!, m! - 1, d!);
  const nextUtc = utc + days * 86400000;
  return new Date(nextUtc).toISOString().split('T')[0]!;
}

/**
 * Converts a date and minutes-from-midnight into an IST ISO string 'YYYY-MM-DDTHH:MM:SS+05:30'.
 */
function makeIstIso(dateStr: string, minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hh = String(h).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  return `${dateStr}T${hh}:${mm}:00+05:30`;
}

/**
 * Adds minutes to an IST ISO string and returns the new IST ISO string.
 */
function addMinutesToIstIso(istIso: string, minutesToAdd: number): string {
  // istIso format: "YYYY-MM-DDTHH:MM:SS+05:30"
  const datePart = istIso.slice(0, 10);
  const timePart = istIso.slice(11, 16);
  const currentMins = timeStringToMinutes(timePart);
  const totalMins = currentMins + minutesToAdd;

  if (totalMins < 1440) {
    return makeIstIso(datePart, totalMins);
  }

  // Crosses to next day
  const daysToAdd = Math.floor(totalMins / 1440);
  const remMins = totalMins % 1440;
  const nextDate = addDaysToIsoDate(datePart, daysToAdd);
  return makeIstIso(nextDate, remMins);
}

/**
 * Expands a power schedule into concrete IST intervals for a target date and the next day.
 * A window whose end is earlier than its start (e.g. 22:00 to 06:00) becomes:
 * - 22:00 to 24:00 on day D
 * - 00:00 to 06:00 on day D+1
 */
export function expandWindows(schedule: PowerSchedule, targetDate: string): ConcreteInterval[] {
  let windowsToUse: readonly PowerWindow[] = schedule.windows || [];

  // Determine active windows if weekly rotation is enabled
  if (schedule.rotation) {
    const { weekA, weekB, anchorDate } = schedule.rotation;
    const [yT, mT, dT] = targetDate.split('-').map(Number);
    const [yA, mA, dA] = anchorDate.split('-').map(Number);
    const targetUtc = Date.UTC(yT!, mT! - 1, dT!);
    const anchorUtc = Date.UTC(yA!, mA! - 1, dA!);
    const diffDays = Math.floor((targetUtc - anchorUtc) / 86400000);
    const diffWeeks = Math.floor(diffDays / 7);
    const isWeekA = ((diffWeeks % 2) + 2) % 2 === 0;
    windowsToUse = isWeekA ? weekA : weekB;
  }

  const weekday = getWeekdayFromIsoDate(targetDate);
  const nextDate = addDaysToIsoDate(targetDate, 1);
  const intervals: ConcreteInterval[] = [];

  // Filter windows applicable to the target weekday
  const matchingWindows = windowsToUse.filter((w) => w.days.includes(weekday));

  for (const win of matchingWindows) {
    const startMins = timeStringToMinutes(win.start);
    const endMins = timeStringToMinutes(win.end);

    if (endMins > startMins) {
      // Normal single-day window (e.g. 06:00 to 14:00)
      const duration = endMins - startMins;
      let period: 'night' | 'morning' | 'day' | 'any' = 'day';
      if (startMins >= 360 && endMins <= 720) {
        period = 'morning';
      } else if (startMins >= 1320 || endMins <= 360) {
        period = 'night';
      }

      intervals.push({
        start: makeIstIso(targetDate, startMins),
        end: makeIstIso(targetDate, endMins),
        durationMinutes: duration,
        period,
        day: targetDate,
        startTime: win.start,
        endTime: win.end,
      });
    } else {
      // Midnight crossing (end is earlier than start, e.g. 22:00 to 06:00)
      // Piece 1: 22:00 to 24:00 on Day D
      const piece1Duration = 1440 - startMins;
      intervals.push({
        start: makeIstIso(targetDate, startMins),
        end: makeIstIso(nextDate, 0), // 24:00 on Day D == 00:00 on Day D+1
        durationMinutes: piece1Duration,
        period: 'night',
        day: targetDate,
        startTime: win.start,
        endTime: '24:00',
      });

      // Piece 2: 00:00 to end on Day D+1
      const piece2Duration = endMins;
      intervals.push({
        start: makeIstIso(nextDate, 0),
        end: makeIstIso(nextDate, endMins),
        durationMinutes: piece2Duration,
        period: 'night',
        day: nextDate,
        startTime: '00:00',
        endTime: win.end,
      });
    }
  }

  return intervals;
}

/**
 * Plans pump segments for a single field run across available concrete power intervals.
 * Fills the preferred interval first (e.g. night or morning), then the next, with at most 2 splits.
 * For sprinklers in high wind (> 20 km/h), prefers calmer (night) interval and adds note key 'plan.windy'.
 */
export function planPumpSegments(
  runMinutes: number,
  intervals: ConcreteInterval[],
  preferences?: PumpPlanningPreferences,
): PumpPlanResult {
  const notes: string[] = [];
  const windLimit = preferences?.windLimit ?? POWER_SCHEDULE_CONFIG.windLimitKmh.value;

  let effectivePrefer = preferences?.prefer || 'any';

  // Sprinklers and wind rule: prefer calmer night window if wind exceeds limit
  if (
    preferences?.method === 'sprinkler' &&
    typeof preferences.windSpeedMax === 'number' &&
    preferences.windSpeedMax > windLimit
  ) {
    effectivePrefer = 'night';
    notes.push('plan.windy');
  }

  if (runMinutes <= 0) {
    return {
      segments: [],
      missingMinutes: 0,
      notes,
    };
  }

  if (!intervals || intervals.length === 0) {
    return {
      segments: [],
      missingMinutes: runMinutes,
      notes,
    };
  }

  // Sort intervals by preference
  const orderedIntervals = [...intervals];
  if (effectivePrefer === 'night') {
    orderedIntervals.sort((a, b) => {
      const aIsNight = a.period === 'night' ? 0 : 1;
      const bIsNight = b.period === 'night' ? 0 : 1;
      return aIsNight - bIsNight;
    });
  } else if (effectivePrefer === 'morning') {
    orderedIntervals.sort((a, b) => {
      const aIsMorning = a.period === 'morning' ? 0 : 1;
      const bIsMorning = b.period === 'morning' ? 0 : 1;
      return aIsMorning - bIsMorning;
    });
  }

  const maxSplits = preferences?.maxSplits ?? POWER_SCHEDULE_CONFIG.defaultMaxSplits.value;
  let remaining = runMinutes;
  const segments: PlannedSegment[] = [];

  for (const interval of orderedIntervals) {
    if (remaining <= 0 || segments.length >= maxSplits) {
      break;
    }

    const alloc = Math.min(remaining, interval.durationMinutes);
    if (alloc > 0) {
      const segStart = interval.start;
      const segEnd = addMinutesToIstIso(segStart, alloc);
      segments.push({
        start: segStart,
        end: segEnd,
        durationMinutes: alloc,
      });
      remaining -= alloc;
    }
  }

  const missingMinutes = Math.max(0, remaining);

  return {
    segments,
    missingMinutes,
    notes,
  };
}

/**
 * Plans pump schedule for multiple fields served by a single pump.
 * Sorts fields by urgency (largest water deficit first) and schedules them back-to-back across intervals.
 */
export function planPumpDay(
  pumpId: string,
  fieldRuns: FieldPumpRun[],
  intervals: ConcreteInterval[],
): PumpDayPlan {
  // 1. Order fields by urgency (largest deficit first)
  const sortedRuns = [...fieldRuns].sort((a, b) => b.deficitMm - a.deficitMm);

  const fieldPlans: FieldScheduleResult[] = [];
  let totalRun = 0;
  let totalMissing = 0;

  // Track remaining capacity in intervals
  const intervalTracker = intervals.map((inv) => ({
    ...inv,
    offsetMinutes: 0,
    remainingMinutes: inv.durationMinutes,
  }));

  let currentIntervalIdx = 0;

  for (const run of sortedRuns) {
    totalRun += run.runMinutes;
    let fieldRemaining = run.runMinutes;
    const fieldSegments: PlannedSegment[] = [];
    const notes: string[] = [];

    while (fieldRemaining > 0 && currentIntervalIdx < intervalTracker.length) {
      const currentInv = intervalTracker[currentIntervalIdx]!;

      if (currentInv.remainingMinutes <= 0) {
        currentIntervalIdx++;
        continue;
      }

      const take = Math.min(fieldRemaining, currentInv.remainingMinutes);
      const segStart = addMinutesToIstIso(currentInv.start, currentInv.offsetMinutes);
      const segEnd = addMinutesToIstIso(segStart, take);

      fieldSegments.push({
        start: segStart,
        end: segEnd,
        durationMinutes: take,
        fieldId: run.fieldId,
      });

      fieldRemaining -= take;
      currentInv.offsetMinutes += take;
      currentInv.remainingMinutes -= take;

      if (currentInv.remainingMinutes <= 0) {
        currentIntervalIdx++;
      }
    }

    const missingMinutes = Math.max(0, fieldRemaining);
    totalMissing += missingMinutes;

    fieldPlans.push({
      fieldId: run.fieldId,
      segments: fieldSegments,
      missingMinutes,
      notes,
    });
  }

  return {
    pumpId,
    fieldPlans,
    totalRunMinutes: totalRun,
    totalMissingMinutes: totalMissing,
  };
}

/**
 * Formats a 24-hour time string 'HH:MM' into 12-hour am/pm format.
 * Examples: '22:00' -> '10 pm', '06:00' -> '6 am', '14:00' -> '2 pm'.
 */
export function formatHourAmPm(hhmm: string, lang: SupportedLanguage = 'en'): string {
  const [hStr, mStr] = hhmm.split(':');
  let h = Number(hStr);
  const m = Number(mStr);
  const isPm = h >= 12;
  const ampm = isPm ? 'pm' : 'am';

  if (h === 0) h = 12;
  else if (h > 12) h -= 12;

  const minPart = m > 0 ? `:${String(m).padStart(2, '0')}` : '';

  if (lang === 'hi') {
    let period = 'रात';
    if (isPm) {
      period = h === 12 || h < 4 ? 'दोपहर' : h < 8 ? 'शाम' : 'रात';
    } else {
      period = h === 12 || h < 4 ? 'रात' : 'सुबह';
    }
    return `${period} ${h}${minPart} बजे`;
  }

  if (lang === 'mr') {
    let period = 'रात्री';
    if (isPm) {
      period = h === 12 || h < 4 ? 'दुपारी' : h < 8 ? 'संध्याकाळी' : 'रात्री';
    } else {
      period = h === 12 || h < 4 ? 'रात्री' : 'सकाळी';
    }
    return `${period} ${h}${minPart} वाजता`;
  }

  if (lang === 'pa') {
    let period = 'ਰਾਤ';
    if (isPm) {
      period = h === 12 || h < 4 ? 'ਦੁਪਹਿਰੇ' : h < 8 ? 'ਸ਼ਾਮ' : 'ਰਾਤ';
    } else {
      period = h === 12 || h < 4 ? 'ਰਾਤ' : 'ਸਵੇਰੇ';
    }
    return `${period} ${h}${minPart} ਵਜੇ`;
  }

  if (lang === 'te') {
    let period = 'రాత్రి';
    if (isPm) {
      period = h === 12 || h < 4 ? 'మధ్యాహ్నం' : h < 8 ? 'సాయంత్రం' : 'రాత్రి';
    } else {
      period = h === 12 || h < 4 ? 'రాత్రి' : 'ఉదయం';
    }
    return `${period} ${h}${minPart} గంటలకు`;
  }

  return `${h}${minPart} ${ampm}`;
}

/**
 * Formats a power window time range (e.g. 'between 10 pm and 6 am').
 */
export function formatTimeRange(
  startHhmm: string,
  endHhmm: string,
  lang: SupportedLanguage = 'en',
): string {
  if (lang === 'hi') {
    const s = formatHourAmPm(startHhmm, 'hi');
    const e = formatHourAmPm(endHhmm, 'hi');
    return `${s} से ${e} के बीच`;
  }

  if (lang === 'mr') {
    const s = formatHourAmPm(startHhmm, 'mr');
    const e = formatHourAmPm(endHhmm, 'mr');
    return `${s} ते ${e} दरम्यान`;
  }

  if (lang === 'pa') {
    const s = formatHourAmPm(startHhmm, 'pa');
    const e = formatHourAmPm(endHhmm, 'pa');
    return `${s} ਤੋਂ ${e} ਵਿਚਕਾਰ`;
  }

  if (lang === 'te') {
    const s = formatHourAmPm(startHhmm, 'te');
    const e = formatHourAmPm(endHhmm, 'te');
    return `${s} నుండి ${e} మధ్య`;
  }

  const s = formatHourAmPm(startHhmm, 'en');
  const e = formatHourAmPm(endHhmm, 'en');
  return `between ${s} and ${e}`;
}

/**
 * Formats a full recommendation advisory with duration and power schedule window.
 * Matches canonical acceptance: 'Run the pump 1 h 47 min, between 10 pm and 6 am'
 */
export function formatAdvisoryWithWindow(
  durationFormatted: string,
  schedule: PowerSchedule,
  lang: SupportedLanguage = 'en',
): string {
  const primaryWindow = schedule.windows[0];
  if (!primaryWindow) {
    if (lang === 'hi') return `आज रात ${durationFormatted} पंप चलाएं`;
    if (lang === 'mr') return `आज रात्री ${durationFormatted} पंप चालवा`;
    if (lang === 'pa') return `ਅੱਜ ਰਾਤ ${durationFormatted} ਪੰਪ ਚਲਾਓ`;
    if (lang === 'te') return `ఈ రాత్రి ${durationFormatted} పంపును నడపండి`;
    return `Run the pump ${durationFormatted} tonight`;
  }

  const range = formatTimeRange(primaryWindow.start, primaryWindow.end, lang);

  if (lang === 'hi') return `आज रात ${durationFormatted} पंप चलाएं, ${range}`;
  if (lang === 'mr') return `आज रात्री ${durationFormatted} पंप चालवा, ${range}`;
  if (lang === 'pa') return `ਅੱਜ ਰਾਤ ${durationFormatted} ਪੰਪ ਚਲਾਓ, ${range}`;
  if (lang === 'te') return `ఈ రాత్రి ${durationFormatted} పంపును నడపండి, ${range}`;

  return `Run the pump ${durationFormatted}, ${range}`;
}
