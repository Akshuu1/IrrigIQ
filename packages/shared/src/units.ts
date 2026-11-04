/**
 * IrrigIQ Scientific Unit Conversion Helpers (FAO-56 standard)
 */

export const AREA_CONFIG = {
  version: '1.0.0',
  acreToHa: {
    value: 0.404686,
    source: 'National Institute of Standards and Technology (NIST) / Metric Conversion Act (1 acre = 0.40468564224 ha)',
    verified: false,
  },
  gunthaToAcre: {
    value: 0.025, // 1/40
    source: 'Standard Indian Land Measurement (1 Guntha = 1/40 Acre = 1,089 sq ft)',
    verified: false,
  },
  minAreaHa: {
    value: 0.01,
    source: 'Phase 18 validation limits (minimum 0.01 ha ≈ 100 m²)',
    verified: false,
  },
  maxAreaHa: {
    value: 500.0,
    source: 'Phase 18 validation limits (maximum 500 ha ≈ 5 km²)',
    verified: false,
  },
  largeAreaWarningHa: {
    value: 50.0,
    source: 'Phase 18 specification / Warn when farmer enters area exceeding 50 ha',
    verified: false,
  },
} as const;

export type AreaUnit = 'acre' | 'hectare' | 'ha' | 'guntha' | 'custom';

/**
 * Converts water depth in millimetres over an area in hectares to volume in litres.
 * 1 mm of water over 1 square metre = 1 litre.
 * 1 hectare = 10,000 square metres.
 * Formula: litres = depth(mm) * area(ha) * 10,000.
 */
export function mmToLitres(depthMm: number, areaHa: number): number {
  if (isNaN(depthMm) || isNaN(areaHa)) {
    throw new Error('Inputs must be valid numbers');
  }
  if (depthMm < 0 || areaHa < 0) {
    throw new Error('Depth and area must be non-negative');
  }
  return Math.round(depthMm * areaHa * 10000);
}

/**
 * Converts water volume in litres over an area in hectares to depth in millimetres.
 * Formula: depth(mm) = litres / (area(ha) * 10,000).
 */
export function litresToMm(litres: number, areaHa: number): number {
  if (isNaN(litres) || isNaN(areaHa)) {
    throw new Error('Inputs must be valid numbers');
  }
  if (litres < 0) {
    throw new Error('Litres must be non-negative');
  }
  if (areaHa <= 0) {
    throw new Error('Area must be strictly greater than zero');
  }
  return Number((litres / (areaHa * 10000)).toFixed(2));
}

/**
 * Converts area from hectares to acres (1 ha ≈ 2.47105 acres).
 */
export function haToAcre(ha: number): number {
  if (isNaN(ha) || ha < 0) {
    throw new Error('Area must be a non-negative number');
  }
  return Number((ha * 2.47105).toFixed(3));
}

/**
 * Converts area from acres to hectares (1 acre ≈ 0.404686 ha).
 */
export function acreToHa(acre: number): number {
  if (isNaN(acre) || acre < 0) {
    throw new Error('Area must be a non-negative number');
  }
  return Number((acre * 0.404686).toFixed(3));
}

/**
 * Converts an area value in any supported unit (acre, hectare, guntha, custom) to hectares.
 * Canonical Phase 18 ratios:
 * - 1 acre = 0.4047 ha
 * - 40 guntha = 1 acre = 0.4047 ha
 * - custom unit uses customAcresPerUnit (e.g. bigha)
 */
export function toHectares(
  value: number,
  unit: AreaUnit | string,
  customAcresPerUnit?: number,
): number {
  if (isNaN(value) || value <= 0) {
    throw new Error('Area must be a positive number');
  }

  const normalized = unit.toLowerCase();

  switch (normalized) {
    case 'hectare':
    case 'ha':
      return Number(value.toFixed(4));
    case 'acre':
      return Number((value * 0.404686).toFixed(4));
    case 'guntha':
      return Number(((value / 40) * 0.404686).toFixed(4));
    case 'custom': {
      if (!customAcresPerUnit || isNaN(customAcresPerUnit) || customAcresPerUnit <= 0) {
        throw new Error('Custom unit requires a valid acres-per-unit multiplier');
      }
      return Number((value * customAcresPerUnit * 0.404686).toFixed(4));
    }
    default:
      throw new Error(`Unsupported area unit: ${unit}`);
  }
}

/**
 * Converts an area in hectares to a target area unit.
 * Canonical Phase 18 ratio:
 * - 1 ha = 2.471 acre
 */
export function fromHectares(
  areaHa: number,
  unit: AreaUnit | string,
  customAcresPerUnit?: number,
): number {
  if (isNaN(areaHa) || areaHa < 0) {
    throw new Error('Area must be a non-negative number');
  }

  const normalized = unit.toLowerCase();

  switch (normalized) {
    case 'hectare':
    case 'ha':
      return Number(areaHa.toFixed(4));
    case 'acre':
      return Number((areaHa * 2.47105).toFixed(3));
    case 'guntha':
      return Number((areaHa * 2.47105 * 40).toFixed(2));
    case 'custom': {
      if (!customAcresPerUnit || isNaN(customAcresPerUnit) || customAcresPerUnit <= 0) {
        throw new Error('Custom unit requires a valid acres-per-unit multiplier');
      }
      return Number(((areaHa * 2.47105) / customAcresPerUnit).toFixed(2));
    }
    default:
      throw new Error(`Unsupported area unit: ${unit}`);
  }
}

import type { SupportedLanguage } from './schemas.js';
import { formatNumber } from './formatters.js';

/**
 * Formats field area with support for multiple units, language translation, native digits, and custom units.
 */
export function formatArea(
  areaHa: number,
  unit: AreaUnit | string = 'ha',
  optionsOrLang?:
    | { locale?: string; decimals?: number; useNativeDigits?: boolean }
    | SupportedLanguage,
  customAcresPerUnit?: number,
): string {
  if (isNaN(areaHa) || areaHa < 0) {
    throw new Error('Area must be a non-negative number');
  }

  const isLegacyOptions = typeof optionsOrLang === 'object' && optionsOrLang !== null;
  let lang: SupportedLanguage = 'en';
  if (typeof optionsOrLang === 'string') {
    lang = optionsOrLang;
  } else if (isLegacyOptions && optionsOrLang.locale) {
    const locPrefix = optionsOrLang.locale.slice(0, 2);
    if (['hi', 'mr', 'pa', 'te', 'en'].includes(locPrefix)) {
      lang = locPrefix as SupportedLanguage;
    }
  }
  const decimals = isLegacyOptions ? optionsOrLang.decimals ?? 2 : 2;
  const useNativeDigits = isLegacyOptions ? optionsOrLang.useNativeDigits ?? false : false;

  const value = fromHectares(areaHa, unit, customAcresPerUnit);
  const formattedNum = formatNumber(value, {
    lang,
    useNativeDigits,
    decimals,
  });

  const normalized = unit.toLowerCase();
  let label = unit;
  if (lang === 'hi') {
    if (normalized === 'acre') label = 'एकड़';
    else if (normalized === 'ha' || normalized === 'hectare') label = 'हेक्टेयर';
    else if (normalized === 'guntha') label = 'गुंठा';
    else if (normalized === 'custom') label = 'बीघा/कस्टम';
  } else if (lang === 'mr') {
    if (normalized === 'acre') label = 'एकर';
    else if (normalized === 'ha' || normalized === 'hectare') label = 'हेक्टर';
    else if (normalized === 'guntha') label = 'गुंठा';
    else if (normalized === 'custom') label = 'इतर/बिघा';
  } else if (lang === 'pa') {
    if (normalized === 'acre') label = 'ਏਕੜ';
    else if (normalized === 'ha' || normalized === 'hectare') label = 'ਹੈਕਟੇਅਰ';
    else if (normalized === 'guntha') label = 'ਗੁੰਠਾ';
    else if (normalized === 'custom') label = 'ਬਿੱਘਾ/ਹੋਰ';
  } else if (lang === 'te') {
    if (normalized === 'acre') label = 'ఎకరాలు';
    else if (normalized === 'ha' || normalized === 'hectare') label = 'హెక్టార్లు';
    else if (normalized === 'guntha') label = 'గుంటలు';
    else if (normalized === 'custom') label = 'బిఘా/ఇతర';
  } else {
    if (normalized === 'ha') label = 'ha';
    else if (normalized === 'hectare') label = 'hectare';
    else if (normalized === 'acre') label = 'acre';
    else if (normalized === 'guntha') label = 'guntha';
  }

  return `${formattedNum} ${label}`;
}
