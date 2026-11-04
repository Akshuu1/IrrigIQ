/**
 * Soil Texture Classification & ISRIC SoilGrids Mapping
 * Rule: Versioned config file with sources and verified: false (Rule 1).
 */

export const SOIL_TEXTURE_CONFIG = {
  version: '1.0.0',
  clayThresholdPct: {
    value: 40.0,
    source: 'USDA Soil Texture Classification / FAO-56 Chapter 3 (Clay content >= 40% constitutes clay texture)',
    verified: false,
  },
  sandySandThresholdPct: {
    value: 70.0,
    source: 'USDA Soil Texture Classification / FAO-56 Chapter 3 (Sand content >= 70% with clay <= 15% constitutes sandy texture)',
    verified: false,
  },
  sandyClayMaxPct: {
    value: 15.0,
    source: 'USDA Soil Texture Classification / FAO-56 Chapter 3',
    verified: false,
  },
  isricApi: {
    url: 'https://rest.isric.org/soilgrids/v2.0/properties/query',
    source: 'ISRIC World Soil Information SoilGrids 250m v2.0 REST API',
    license: 'CC BY 4.0',
    timeoutMs: 5000,
    cacheTtlSeconds: 30 * 24 * 60 * 60, // 30 days
    verified: false,
  },
} as const;

export type SoilTexture = 'sandy' | 'loam' | 'clay';

export interface SoilSuggestionResult {
  sandPct: number;
  siltPct: number;
  clayPct: number;
  texture: SoilTexture;
  source: string;
}

/**
 * Maps sand, silt, and clay percentages to 'sandy' | 'loam' | 'clay' using USDA classification rule:
 * - clay: clay >= 40%
 * - sandy: sand >= 70% and clay <= 15%
 * - loam: all other combinations
 */
export function mapSoilTexture(sandPct: number, siltPct: number, clayPct: number): SoilTexture {
  if (
    isNaN(sandPct) ||
    isNaN(siltPct) ||
    isNaN(clayPct) ||
    sandPct < 0 ||
    siltPct < 0 ||
    clayPct < 0
  ) {
    throw new Error('Soil percentages must be non-negative numbers');
  }

  if (clayPct >= SOIL_TEXTURE_CONFIG.clayThresholdPct.value) {
    return 'clay';
  }

  if (
    sandPct >= SOIL_TEXTURE_CONFIG.sandySandThresholdPct.value &&
    clayPct <= SOIL_TEXTURE_CONFIG.sandyClayMaxPct.value
  ) {
    return 'sandy';
  }

  return 'loam';
}

/**
 * Parses raw JSON returned by ISRIC SoilGrids v2.0 REST API.
 * Values in SoilGrids v2 are in g/kg (e.g. 450 g/kg = 45% = 450 / 10).
 * Returns null if data is malformed or properties are missing.
 */
export function parseSoilGridsResponse(data: unknown): SoilSuggestionResult | null {
  try {
    if (
      !data ||
      typeof data !== 'object' ||
      !('properties' in data) ||
      !data.properties ||
      typeof data.properties !== 'object' ||
      !('layers' in data.properties) ||
      !Array.isArray((data.properties as { layers: unknown[] }).layers)
    ) {
      return null;
    }

    const layers = (data.properties as { layers: Array<{ name: string; depths?: Array<{ values?: { mean?: number } }> }> }).layers;

    const getMeanValue = (layerName: string): number | null => {
      const layer = layers.find((l) => l.name === layerName);
      if (!layer || !Array.isArray(layer.depths) || layer.depths.length === 0) {
        return null;
      }
      const validMeans = layer.depths
        .map((d) => d?.values?.mean)
        .filter((v): v is number => typeof v === 'number' && !isNaN(v) && v >= 0);

      if (validMeans.length === 0) return null;
      const sum = validMeans.reduce((acc, v) => acc + v, 0);
      return sum / validMeans.length;
    };

    const clayGkg = getMeanValue('clay');
    const sandGkg = getMeanValue('sand');
    const siltGkg = getMeanValue('silt');

    if (clayGkg === null || sandGkg === null || siltGkg === null) {
      return null;
    }

    // Convert g/kg to percentage (10 g/kg = 1%)
    const clayPct = Number((clayGkg / 10).toFixed(1));
    const sandPct = Number((sandGkg / 10).toFixed(1));
    const siltPct = Number((siltGkg / 10).toFixed(1));

    const texture = mapSoilTexture(sandPct, siltPct, clayPct);

    return {
      sandPct,
      siltPct,
      clayPct,
      texture,
      source: 'ISRIC SoilGrids 250m v2.0',
    };
  } catch {
    return null;
  }
}

