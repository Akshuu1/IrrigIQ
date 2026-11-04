import type { SupportedLanguage } from './schemas.js';

export type ScriptNumberingSystem = 'latn' | 'deva' | 'guru' | 'telu';

/**
 * Maps supported language to its canonical native script numbering system.
 * - Hindi, Marathi -> Devanagari ('deva')
 * - Punjabi -> Gurmukhi ('guru')
 * - Telugu -> Telugu ('telu')
 * - English -> Latin ('latn')
 */
export function getScriptNumberingSystem(lang: SupportedLanguage = 'en'): ScriptNumberingSystem {
  switch (lang) {
    case 'hi':
    case 'mr':
      return 'deva';
    case 'pa':
      return 'guru';
    case 'te':
      return 'telu';
    default:
      return 'latn';
  }
}

/**
 * Returns BCP-47 locale tag for language code.
 */
export function getLocaleForLanguage(lang: SupportedLanguage = 'en'): string {
  switch (lang) {
    case 'hi':
      return 'hi-IN';
    case 'mr':
      return 'mr-IN';
    case 'pa':
      return 'pa-IN';
    case 'te':
      return 'te-IN';
    default:
      return 'en-IN';
  }
}

export interface FormatNumberOptions {
  lang?: SupportedLanguage;
  useNativeDigits?: boolean;
  numberingSystem?: 'latn' | 'native';
  decimals?: number;
  minDecimals?: number;
  maxDecimals?: number;
}

/**
 * Formats a number with Indian thousand/lakh separators using Intl.NumberFormat.
 * Supports user preference for native digits ('deva', 'guru', 'telu') versus Latin digits ('latn').
 */
export function formatNumber(value: number, options: FormatNumberOptions = {}): string {
  if (isNaN(value)) return '0';

  const lang = options.lang || 'en';
  const locale = getLocaleForLanguage(lang);

  const isNative = options.useNativeDigits === true || options.numberingSystem === 'native';
  const numberingSystem = isNative ? getScriptNumberingSystem(lang) : 'latn';

  const minDec = options.minDecimals ?? (options.decimals !== undefined ? options.decimals : 0);
  const maxDec = options.maxDecimals ?? (options.decimals !== undefined ? options.decimals : 2);

  const formatter = new Intl.NumberFormat(locale, {
    numberingSystem,
    minimumFractionDigits: minDec,
    maximumFractionDigits: maxDec,
  });

  return formatter.format(value);
}

export interface FormatDateOptions {
  lang?: SupportedLanguage;
  useNativeDigits?: boolean;
  numberingSystem?: 'latn' | 'native';
  dateStyle?: 'short' | 'medium' | 'long' | 'full';
}

/**
 * Formats a date using Intl.DateTimeFormat respecting language locale and native digit setting.
 */
export function formatDate(date: Date | string | number, options: FormatDateOptions = {}): string {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';

  const lang = options.lang || 'en';
  const locale = getLocaleForLanguage(lang);

  const isNative = options.useNativeDigits === true || options.numberingSystem === 'native';
  const numberingSystem = isNative ? getScriptNumberingSystem(lang) : 'latn';

  const formatter = new Intl.DateTimeFormat(locale, {
    numberingSystem,
    dateStyle: options.dateStyle || 'medium',
  });

  return formatter.format(d);
}

