import * as turf from '@turf/turf';

export interface GeoJSONPolygon {
  type: 'Polygon';
  coordinates: number[][][];
}

export interface GeoJSONPoint {
  type: 'Point';
  coordinates: [number, number];
}

/**
 * India's approximate bounding box: [minLng, minLat, maxLng, maxLat]
 * Longitude: 68.0 to 97.5
 * Latitude: 6.5 to 37.5
 */
export const INDIA_BOUNDS = {
  minLng: 68.0,
  minLat: 6.5,
  maxLng: 97.5,
  maxLat: 37.5,
} as const;

export const POLYGON_CONSTRAINTS = {
  minVertices: 3,
  maxVertices: 100,
  minAreaHa: 0.01,
  maxAreaHa: 500.0,
} as const;

/**
 * Calculates polygon area in hectares using Turf.js geodesic measurement.
 */
export function polygonAreaHa(geometry: GeoJSONPolygon): number {
  if (!geometry || geometry.type !== 'Polygon' || !Array.isArray(geometry.coordinates)) {
    throw new Error('Invalid GeoJSON Polygon');
  }
  const poly = turf.polygon(geometry.coordinates);
  const areaSqm = turf.area(poly);
  return areaSqm / 10000;
}

/**
 * Calculates centroid point of a GeoJSON polygon.
 */
export function polygonCentroid(geometry: GeoJSONPolygon): GeoJSONPoint {
  if (!geometry || geometry.type !== 'Polygon' || !Array.isArray(geometry.coordinates)) {
    throw new Error('Invalid GeoJSON Polygon');
  }
  const poly = turf.polygon(geometry.coordinates);
  const cent = turf.centroid(poly);
  const lng = cent.geometry.coordinates[0];
  const lat = cent.geometry.coordinates[1];
  if (typeof lng !== 'number' || typeof lat !== 'number') {
    throw new Error('Could not calculate centroid coordinates');
  }
  return {
    type: 'Point',
    coordinates: [Number(lng.toFixed(6)), Number(lat.toFixed(6))],
  };
}

export interface ValidatedPolygonResult {
  valid: true;
  areaHa: number;
  centroid: GeoJSONPoint;
}

/**
 * Validates a field polygon:
 * - Closed ring (first vertex matches last vertex)
 * - 3 to 100 unique vertices
 * - No self-intersections (using Turf kinks)
 * - All coordinates inside India's bounding box [68.0, 6.5, 97.5, 37.5]
 * - Area between 0.01 ha and 500 ha
 */
export function validatePolygon(geometry: GeoJSONPolygon): ValidatedPolygonResult {
  if (!geometry || geometry.type !== 'Polygon') {
    throw new Error("Geometry type must be 'Polygon'");
  }

  if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) {
    throw new Error('Polygon must contain at least one ring of coordinates');
  }

  const ring = geometry.coordinates[0];
  if (!Array.isArray(ring) || ring.length < 4) {
    throw new Error(
      'Polygon ring must have at least 4 coordinates (3 unique vertices + closing vertex)',
    );
  }

  // Check ring closure
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (
    !Array.isArray(first) ||
    !Array.isArray(last) ||
    first[0] !== last[0] ||
    first[1] !== last[1]
  ) {
    throw new Error('Polygon must be a closed ring (first and last coordinate must be identical)');
  }

  const uniqueVerticesCount = ring.length - 1;
  if (uniqueVerticesCount < POLYGON_CONSTRAINTS.minVertices) {
    throw new Error(
      `Polygon has too few vertices (${uniqueVerticesCount}). Minimum is ${POLYGON_CONSTRAINTS.minVertices}`,
    );
  }
  if (uniqueVerticesCount > POLYGON_CONSTRAINTS.maxVertices) {
    throw new Error(
      `Polygon has too many vertices (${uniqueVerticesCount}). Maximum is ${POLYGON_CONSTRAINTS.maxVertices}`,
    );
  }

  // Check all coordinates: numbers, within India bounding box
  for (let i = 0; i < ring.length; i++) {
    const pt = ring[i];
    if (
      !Array.isArray(pt) ||
      pt.length < 2 ||
      typeof pt[0] !== 'number' ||
      typeof pt[1] !== 'number'
    ) {
      throw new Error(`Invalid coordinate format at index ${i}`);
    }
    const [lng, lat] = pt;
    if (
      typeof lng !== 'number' ||
      typeof lat !== 'number' ||
      Number.isNaN(lng) ||
      Number.isNaN(lat) ||
      !Number.isFinite(lng) ||
      !Number.isFinite(lat)
    ) {
      throw new Error(`Non-finite coordinate at index ${i}`);
    }
    if (
      lng < INDIA_BOUNDS.minLng ||
      lng > INDIA_BOUNDS.maxLng ||
      lat < INDIA_BOUNDS.minLat ||
      lat > INDIA_BOUNDS.maxLat
    ) {
      throw new Error(
        `Coordinate [${lng}, ${lat}] is outside India's bounding box [${INDIA_BOUNDS.minLng}, ${INDIA_BOUNDS.minLat}, ${INDIA_BOUNDS.maxLng}, ${INDIA_BOUNDS.maxLat}]`,
      );
    }
  }

  // Check kinks (self-intersection)
  let polyFeature: ReturnType<typeof turf.polygon>;
  try {
    polyFeature = turf.polygon(geometry.coordinates);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid polygon geometry: ${msg}`);
  }

  const kinks = turf.kinks(polyFeature);
  if (kinks.features.length > 0) {
    throw new Error('Polygon is self-intersecting (kinks detected)');
  }

  // Check area
  const areaHa = polygonAreaHa(geometry);
  if (areaHa < POLYGON_CONSTRAINTS.minAreaHa) {
    throw new Error(
      `Polygon area is ${areaHa.toFixed(4)} ha, which is below the minimum allowed ${POLYGON_CONSTRAINTS.minAreaHa} ha`,
    );
  }
  if (areaHa > POLYGON_CONSTRAINTS.maxAreaHa) {
    throw new Error(
      `Polygon area is ${areaHa.toFixed(2)} ha, which exceeds the maximum allowed ${POLYGON_CONSTRAINTS.maxAreaHa} ha`,
    );
  }

  const centroid = polygonCentroid(geometry);

  return {
    valid: true,
    areaHa: Number(areaHa.toFixed(4)),
    centroid,
  };
}
