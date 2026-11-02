import { describe, it, expect } from 'vitest';
import * as turf from '@turf/turf';
import { validatePolygon, polygonAreaHa, polygonCentroid, type GeoJSONPolygon } from './geo.js';

describe('Geo helpers', () => {
  // A valid ~1-hectare field near Jaipur, Rajasthan (approx 75.8°E, 26.9°N)
  // 100m x 100m square
  const origin = turf.point([75.8, 26.9]);
  const eastPoint = turf.destination(origin, 0.1, 90, { units: 'kilometers' });
  const northEastPoint = turf.destination(eastPoint, 0.1, 0, { units: 'kilometers' });
  const northPoint = turf.destination(origin, 0.1, 0, { units: 'kilometers' });

  const validSquareCoords: number[][][] = [
    [
      origin.geometry.coordinates,
      eastPoint.geometry.coordinates,
      northEastPoint.geometry.coordinates,
      northPoint.geometry.coordinates,
      origin.geometry.coordinates,
    ],
  ];

  const validField: GeoJSONPolygon = {
    type: 'Polygon',
    coordinates: validSquareCoords,
  };

  it('validates a correct polygon and computes area and centroid', () => {
    const result = validatePolygon(validField);
    expect(result.valid).toBe(true);
    // 0.1 km x 0.1 km = 0.01 km2 = 1.0 ha
    expect(result.areaHa).toBeGreaterThan(0.98);
    expect(result.areaHa).toBeLessThan(1.02);
    expect(result.centroid.type).toBe('Point');
    expect(result.centroid.coordinates[0]).toBeCloseTo(75.8, 2);
    expect(result.centroid.coordinates[1]).toBeCloseTo(26.9, 2);
  });

  it('polygonCentroid calculates the centroid accurately', () => {
    const centroid = polygonCentroid(validField);
    expect(centroid.type).toBe('Point');
    expect(centroid.coordinates[0]).toBeCloseTo(75.8, 2);
    expect(centroid.coordinates[1]).toBeCloseTo(26.9, 2);
  });

  it('area matches a known rectangle within 1 percent', () => {
    // 0.1 km x 0.1 km is known to be exactly 1.000 ha (10,000 m2)
    const area = polygonAreaHa(validField);
    expect(area).toBeGreaterThanOrEqual(0.99);
    expect(area).toBeLessThanOrEqual(1.01);
  });

  it('rejects a self-intersecting polygon (hourglass/bowtie)', () => {
    // Bowtie shape: [0,0] -> [1,1] -> [1,0] -> [0,1] -> [0,0]
    const bowtie: GeoJSONPolygon = {
      type: 'Polygon',
      coordinates: [
        [
          [75.0, 20.0],
          [75.02, 20.02],
          [75.02, 20.0],
          [75.0, 20.02],
          [75.0, 20.0],
        ],
      ],
    };
    expect(() => validatePolygon(bowtie)).toThrow(/self-intersecting|kinks/i);
  });

  it('rejects a polygon outside India bounding box', () => {
    // London coordinates
    const londonPolygon: GeoJSONPolygon = {
      type: 'Polygon',
      coordinates: [
        [
          [-0.12, 51.5],
          [-0.11, 51.5],
          [-0.11, 51.51],
          [-0.12, 51.51],
          [-0.12, 51.5],
        ],
      ],
    };
    expect(() => validatePolygon(londonPolygon)).toThrow(/outside India's bounding box/i);
  });

  it('rejects a polygon that is too small (< 0.01 ha)', () => {
    // 2m x 2m square = 4 m2 = 0.0004 ha
    const tinyOrigin = turf.point([75.8, 26.9]);
    const p1 = turf.destination(tinyOrigin, 0.002, 90, { units: 'kilometers' });
    const p2 = turf.destination(p1, 0.002, 0, { units: 'kilometers' });
    const p3 = turf.destination(tinyOrigin, 0.002, 0, { units: 'kilometers' });

    const tinyField: GeoJSONPolygon = {
      type: 'Polygon',
      coordinates: [
        [
          tinyOrigin.geometry.coordinates,
          p1.geometry.coordinates,
          p2.geometry.coordinates,
          p3.geometry.coordinates,
          tinyOrigin.geometry.coordinates,
        ],
      ],
    };
    expect(() => validatePolygon(tinyField)).toThrow(/below the minimum allowed 0.01 ha/i);
  });

  it('rejects a polygon that is too large (> 500 ha)', () => {
    // 3000m x 3000m = 9 km2 = 900 ha
    const hugeOrigin = turf.point([75.8, 26.9]);
    const p1 = turf.destination(hugeOrigin, 3.0, 90, { units: 'kilometers' });
    const p2 = turf.destination(p1, 3.0, 0, { units: 'kilometers' });
    const p3 = turf.destination(hugeOrigin, 3.0, 0, { units: 'kilometers' });

    const hugeField: GeoJSONPolygon = {
      type: 'Polygon',
      coordinates: [
        [
          hugeOrigin.geometry.coordinates,
          p1.geometry.coordinates,
          p2.geometry.coordinates,
          p3.geometry.coordinates,
          hugeOrigin.geometry.coordinates,
        ],
      ],
    };
    expect(() => validatePolygon(hugeField)).toThrow(/exceeds the maximum allowed 500 ha/i);
  });

  it('rejects a polygon with more than 100 vertices', () => {
    // Generate a circle polygon with 102 vertices
    const center = [75.8, 26.9];
    const circle = turf.circle(center, 0.2, { steps: 102, units: 'kilometers' });
    const poly: GeoJSONPolygon = {
      type: 'Polygon',
      coordinates: circle.geometry.coordinates,
    };
    expect(() => validatePolygon(poly)).toThrow(/too many vertices/i);
  });

  it('rejects an unclosed ring', () => {
    const unclosed: GeoJSONPolygon = {
      type: 'Polygon',
      coordinates: [
        [
          [75.0, 20.0],
          [75.01, 20.0],
          [75.01, 20.01],
          [75.0, 20.01],
          [75.05, 20.05], // does not match first point
        ],
      ],
    };
    expect(() => validatePolygon(unclosed)).toThrow(/closed ring/i);
  });
});
