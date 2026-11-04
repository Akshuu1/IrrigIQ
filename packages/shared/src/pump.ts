export const PUMP_CONFIG = {
  version: '1.0.0',
  minDischargeLph: {
    value: 500,
    source: 'Phase 16 Pump Run Time specifications / Field guidelines for smallholder low-flow micro-pumps',
    verified: false,
  },
  maxDischargeLph: {
    value: 200000,
    source: 'Phase 16 Pump Run Time specifications / High-capacity agricultural tube-well and river lift pumps',
    verified: false,
  },
  maxSingleRunMinutes: {
    value: 720, // 12 hours
    source: 'Phase 16 specifications / Agricultural pump duty cycle limits before mandatory multi-day split',
    verified: false,
  },
} as const;

export interface PumpRunResult {
  minutes: number;
  splitAcrossDays: boolean;
  valueOf(): number;
  toString(): string;
}

export const DURATION_TEMPLATES = {
  en: {
    hoursAndMinutes: '{hours} h {minutes} min',
    hoursOnly: '{hours} h',
    minutesOnly: '{minutes} min',
    zero: '0 min',
  },
  hi: {
    hoursAndMinutes: '{hours} घंटा {minutes} मिनट',
    hoursOnly: '{hours} घंटा',
    minutesOnly: '{minutes} मिनट',
    zero: '0 मिनट',
  },
} as const;

export type SupportedLanguage = keyof typeof DURATION_TEMPLATES;

/**
 * Calculates pump flow rate (litres per hour) from a bucket test.
 * Litres per hour = (bucketLitres / seconds) * 3600.
 *
 * @param bucketLitres - Capacity of the container in litres (must be > 0).
 * @param seconds - Seconds taken to fill the container (must be > 0).
 * @returns Calculated discharge in L/h.
 * @throws Error if inputs are non-positive or resulting rate falls outside valid agronomic limits [500, 200000].
 */
export function bucketTestToLph(bucketLitres: number, seconds: number): number {
  if (isNaN(bucketLitres) || bucketLitres <= 0) {
    throw new Error('Bucket volume in litres must be greater than 0');
  }
  if (isNaN(seconds) || seconds <= 0) {
    throw new Error('Seconds must be greater than 0');
  }

  const dischargeLph = Math.round((bucketLitres / seconds) * 3600);

  if (
    dischargeLph < PUMP_CONFIG.minDischargeLph.value ||
    dischargeLph > PUMP_CONFIG.maxDischargeLph.value
  ) {
    throw new Error(
      `Discharge rate must be between ${PUMP_CONFIG.minDischargeLph.value} and ${PUMP_CONFIG.maxDischargeLph.value} L/h (calculated: ${dischargeLph} L/h)`,
    );
  }

  return dischargeLph;
}

/**
 * Calculates pump operating duration in minutes for a required gross irrigation volume.
 * Run time = (grossLitres / dischargeLph) * 60, rounded to nearest minute.
 * If run time exceeds 720 minutes (12 hours), flags splitAcrossDays = true.
 *
 * @param grossLitres - Total water volume needed in litres.
 * @param dischargeLph - Pump discharge capacity in litres per hour.
 * @returns PumpRunResult containing minutes and splitAcrossDays flag.
 */
export function runMinutes(grossLitres: number, dischargeLph: number): PumpRunResult {
  if (isNaN(dischargeLph) || dischargeLph <= 0) {
    throw new Error('Pump discharge rate must be greater than 0 L/h');
  }
  if (isNaN(grossLitres) || grossLitres <= 0) {
    return {
      minutes: 0,
      splitAcrossDays: false,
      valueOf() {
        return 0;
      },
      toString() {
        return '0';
      },
    };
  }

  const rawMinutes = (grossLitres / dischargeLph) * 60;
  const minutes = Math.round(rawMinutes);
  const splitAcrossDays = minutes > PUMP_CONFIG.maxSingleRunMinutes.value;

  return {
    minutes,
    splitAcrossDays,
    valueOf() {
      return this.minutes;
    },
    toString() {
      return String(this.minutes);
    },
  };
}

/**
 * Formats a duration in minutes into a human-readable string using i18n template keys.
 * No string concatenation in application logic; uses key substitution.
 *
 * @param minutes - Total duration in minutes.
 * @param lang - Target language ('en' or 'hi').
 * @returns Formatted duration string (e.g. '1 h 47 min' or '1 घंटा 47 मिनट').
 */
export function formatDuration(minutes: number, lang: SupportedLanguage = 'en'): string {
  const safeMins = Math.max(0, Math.round(isNaN(minutes) ? 0 : minutes));
  const templates = DURATION_TEMPLATES[lang] || DURATION_TEMPLATES.en;

  if (safeMins === 0) {
    return templates.zero;
  }

  const hours = Math.floor(safeMins / 60);
  const remMinutes = safeMins % 60;

  if (hours > 0 && remMinutes > 0) {
    return templates.hoursAndMinutes
      .replace('{hours}', String(hours))
      .replace('{minutes}', String(remMinutes));
  }

  if (hours > 0) {
    return templates.hoursOnly.replace('{hours}', String(hours));
  }

  return templates.minutesOnly.replace('{minutes}', String(remMinutes));
}

/**
 * Calculates estimated operational cost for a pump run based on farmer's cost per hour.
 * Cost = (runMinutes / 60) * costPerHour.
 *
 * @param runMinutes - Operating duration in minutes (or PumpRunResult object).
 * @param costPerHour - Optional cost per hour (e.g. electricity or diesel rate).
 * @returns Calculated cost rounded to 2 decimal places, or null if no rate is provided.
 */
export function pumpCost(
  runMinutes: number | { minutes: number },
  costPerHour?: number | null,
): number | null {
  if (costPerHour === undefined || costPerHour === null || isNaN(costPerHour)) {
    return null;
  }
  if (costPerHour < 0) {
    throw new Error('Cost per hour cannot be negative');
  }

  const mins = typeof runMinutes === 'number' ? runMinutes : runMinutes.minutes;
  if (isNaN(mins) || mins <= 0) {
    return 0;
  }

  const cost = (mins / 60) * costPerHour;
  return Math.round(cost * 100) / 100;
}

