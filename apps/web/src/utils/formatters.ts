import {
  type AreaUnit,
  type SupportedLanguage,
  formatNumber as sharedFormatNumber,
  formatDate as sharedFormatDate,
  formatArea as sharedFormatArea,
} from '@irrigiq/shared';

export interface FormatOptions extends Intl.NumberFormatOptions {
  useNativeDigits?: boolean;
}

/**
 * Format a number using Indian grouping conventions (e.g., 1,25,000 / १२५,०००).
 */
export function formatNumber(
  value: number,
  lang: string = 'en',
  options?: FormatOptions,
): string {
  const supportedLang = (['en', 'hi', 'mr', 'pa', 'te'].includes(lang) ? lang : 'en') as SupportedLanguage;
  const isNative = options?.useNativeDigits === true;
  
  return sharedFormatNumber(value, {
    lang: supportedLang,
    useNativeDigits: isNative,
    minDecimals: options?.minimumFractionDigits,
    maxDecimals: options?.maximumFractionDigits,
  });
}

/**
 * Format a date string or Date object into localized medium date.
 */
export function formatDate(
  dateInput: string | Date,
  lang: string = 'en',
  options?: Intl.DateTimeFormatOptions & { useNativeDigits?: boolean },
): string {
  const supportedLang = (['en', 'hi', 'mr', 'pa', 'te'].includes(lang) ? lang : 'en') as SupportedLanguage;
  return sharedFormatDate(dateInput, {
    lang: supportedLang,
    useNativeDigits: options?.useNativeDigits === true,
    dateStyle: 'medium',
  });
}

/**
 * Format land area according to user preference (acre or ha) and language.
 */
export function formatArea(
  areaHa: number,
  unit: AreaUnit = 'acre',
  lang: string = 'en',
  options?: { useNativeDigits?: boolean },
): string {
  const supportedLang = (['en', 'hi', 'mr', 'pa', 'te'].includes(lang) ? lang : 'en') as SupportedLanguage;
  return sharedFormatArea(areaHa, unit, {
    locale: `${supportedLang}-IN`,
    decimals: 2,
    useNativeDigits: options?.useNativeDigits === true,
  });
}

/**
 * Format water volume in litres.
 */
export function formatLitres(litres: number, lang: string = 'en', options?: { useNativeDigits?: boolean }): string {
  const rounded = Math.round(litres);
  const supportedLang = (['en', 'hi', 'mr', 'pa', 'te'].includes(lang) ? lang : 'en') as SupportedLanguage;
  const numStr = formatNumber(rounded, lang, options);

  let unitLabel = 'litres';
  if (supportedLang === 'hi') unitLabel = 'लीटर';
  else if (supportedLang === 'mr') unitLabel = 'लिटर';
  else if (supportedLang === 'pa') unitLabel = 'ਲੀਟਰ';
  else if (supportedLang === 'te') unitLabel = 'లీటర్లు';

  return `${numStr} ${unitLabel}`;
}

/**
 * Format depth in mm.
 */
export function formatDepthMm(mm: number, lang: string = 'en', options?: { useNativeDigits?: boolean }): string {
  const supportedLang = (['en', 'hi', 'mr', 'pa', 'te'].includes(lang) ? lang : 'en') as SupportedLanguage;
  const numStr = formatNumber(mm, lang, { ...options, maximumFractionDigits: 1 });

  let unitLabel = 'mm';
  if (supportedLang === 'hi' || supportedLang === 'mr') unitLabel = 'मिमी';
  else if (supportedLang === 'pa') unitLabel = 'ਮਿ.ਮੀ.';
  else if (supportedLang === 'te') unitLabel = 'మిమీ';

  return `${numStr} ${unitLabel}`;
}
