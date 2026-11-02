/**
 * IrrigIQ Scientific Unit Conversion Helpers (FAO-56 standard)
 */

/**
 * Converts water depth in millimetres over an area in hectares to volume in litres.
 * 1 mm over 1 m² = 1 litre.
 * 1 hectare = 10,000 m².
 * Therefore, 1 mm over 1 hectare = 10,000 litres.
 */
export function mmToLitres(depthMm: number, areaHa: number): number {
  if (depthMm < 0 || areaHa < 0) {
    throw new Error('Depth and area must be non-negative');
  }
  return Math.round(depthMm * areaHa * 10000);
}

/**
 * Converts water volume in litres over an area in hectares to depth in millimetres.
 */
export function litresToMm(litres: number, areaHa: number): number {
  if (litres < 0 || areaHa <= 0) {
    throw new Error('Litres must be non-negative and area must be greater than zero');
  }
  return Number((litres / (areaHa * 10000)).toFixed(2));
}

/**
 * Converts hectares to acres (1 ha ≈ 2.47105 acres).
 */
export function haToAcre(ha: number): number {
  if (ha < 0) throw new Error('Area must be non-negative');
  return Number((ha * 2.47105).toFixed(3));
}

/**
 * Converts acres to hectares (1 acre ≈ 0.404686 ha).
 */
export function acreToHa(acre: number): number {
  if (acre < 0) throw new Error('Area must be non-negative');
  return Number((acre * 0.404686).toFixed(3));
}
