/**
 * IrrigIQ Scientific Unit Conversion Helpers (FAO-56 standard)
 */

/**
 * Converts water depth in millimetres over an area in hectares to volume in litres.
 * 1 mm of water over 1 square metre = 1 litre.
 * 1 hectare = 10,000 square metres.
 * Formula: litres = depth(mm) * area(ha) * 10,000.
 *
 * @param depthMm - Irrigation depth in millimetres.
 * @param areaHa - Field area in hectares.
 * @returns Total water volume in litres (rounded to nearest integer).
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
 *
 * @param litres - Water volume in litres.
 * @param areaHa - Field area in hectares.
 * @returns Depth in millimetres rounded to 2 decimal places.
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
 *
 * @param ha - Area in hectares.
 * @returns Area in acres rounded to 3 decimal places.
 */
export function haToAcre(ha: number): number {
  if (isNaN(ha) || ha < 0) {
    throw new Error('Area must be a non-negative number');
  }
  return Number((ha * 2.47105).toFixed(3));
}

/**
 * Converts area from acres to hectares (1 acre ≈ 0.404686 ha).
 *
 * @param acre - Area in acres.
 * @returns Area in hectares rounded to 3 decimal places.
 */
export function acreToHa(acre: number): number {
  if (isNaN(acre) || acre < 0) {
    throw new Error('Area must be a non-negative number');
  }
  return Number((acre * 0.404686).toFixed(3));
}

/**
 * Formats field area in either acres or hectares with localized number string.
 *
 * @param areaHa - Field area in hectares.
 * @param unit - Target display unit ('acre' or 'ha').
 * @param options - Locale and decimal precision options.
 * @returns Formatted area string (e.g., "2.47 acre" or "1.00 ha").
 */
export function formatArea(
  areaHa: number,
  unit: 'acre' | 'ha' = 'ha',
  options: { locale?: string; decimals?: number } = {},
): string {
  if (isNaN(areaHa) || areaHa < 0) {
    throw new Error('Area must be a non-negative number');
  }

  const { locale = 'en-IN', decimals = 2 } = options;
  const value = unit === 'acre' ? haToAcre(areaHa) : areaHa;
  const formattedNum = value.toLocaleString(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return `${formattedNum} ${unit}`;
}
