import { haToAcre, type AreaUnit } from '@irrigiq/shared';

/**
 * Format a number using Indian grouping conventions (e.g., 1,00,000).
 */
export function formatNumber(
  value: number,
  lang: string = 'en',
  options?: Intl.NumberFormatOptions,
): string {
  const locale = lang === 'hi' ? 'hi-IN' : 'en-IN';
  return new Intl.NumberFormat(locale, options).format(value);
}

/**
 * Format a date string or Date object into localized medium date.
 */
export function formatDate(
  dateInput: string | Date,
  lang: string = 'en',
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' },
): string {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return String(dateInput);
  const locale = lang === 'hi' ? 'hi-IN' : 'en-IN';
  return new Intl.DateTimeFormat(locale, options).format(date);
}

/**
 * Format land area according to user preference (acre or ha) and language.
 */
export function formatArea(areaHa: number, unit: AreaUnit = 'acre', lang: string = 'en'): string {
  if (unit === 'acre') {
    const acres = haToAcre(areaHa);
    const unitLabel = lang === 'hi' ? 'एकड़' : 'acre';
    return `${formatNumber(acres, lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${unitLabel}`;
  }
  const unitLabel = lang === 'hi' ? 'हेक्टेयर' : 'ha';
  return `${formatNumber(areaHa, lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${unitLabel}`;
}

/**
 * Format water volume in litres.
 */
export function formatLitres(litres: number, lang: string = 'en'): string {
  const rounded = Math.round(litres);
  const unitLabel = lang === 'hi' ? 'लीटर' : 'litres';
  return `${formatNumber(rounded, lang)} ${unitLabel}`;
}

/**
 * Format depth in mm.
 */
export function formatDepthMm(mm: number, lang: string = 'en'): string {
  const unitLabel = lang === 'hi' ? 'मिमी' : 'mm';
  return `${formatNumber(mm, lang, { maximumFractionDigits: 1 })} ${unitLabel}`;
}
