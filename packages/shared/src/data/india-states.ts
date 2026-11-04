/**
 * Simplified GeoJSON boundaries for Indian States and Union Territories.
 * Source: Data{Meet} Community Maps Project (https://github.com/datameet/maps)
 * License: Open Database License (ODbL) v1.0 / Creative Commons Attribution 4.0 International (CC-BY 4.0)
 *
 * Coordinates are formatted as [longitude, latitude].
 */

export interface StateFeature {
  type: 'Feature';
  properties: {
    name: string;
    code: string;
  };
  geometry: {
    type: 'Polygon';
    coordinates: number[][][];
  };
}

export interface StateFeatureCollection {
  type: 'FeatureCollection';
  features: StateFeature[];
}

export const INDIA_STATES_GEOJSON: StateFeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'Delhi', code: 'DL' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [76.84, 28.40],
            [77.35, 28.40],
            [77.35, 28.88],
            [76.84, 28.88],
            [76.84, 28.40],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'Chandigarh', code: 'CH' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [76.70, 30.68],
            [76.85, 30.68],
            [76.85, 30.82],
            [76.70, 30.82],
            [76.70, 30.68],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'Punjab', code: 'PB' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [73.85, 29.55],
            [75.80, 29.70],
            [76.90, 30.50],
            [76.60, 31.30],
            [75.85, 32.35],
            [74.85, 32.05],
            [74.30, 31.10],
            [73.85, 30.15],
            [73.85, 29.55],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'Haryana', code: 'HR' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [74.45, 29.00],
            [76.50, 28.20],
            [77.60, 27.80],
            [77.40, 29.50],
            [76.90, 30.50],
            [75.80, 29.70],
            [74.45, 29.00],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'Rajasthan', code: 'RJ' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [69.50, 26.50],
            [70.50, 24.50],
            [73.00, 24.00],
            [75.50, 24.00],
            [77.00, 25.00],
            [78.20, 26.80],
            [77.50, 28.00],
            [75.50, 29.00],
            [73.85, 29.55],
            [71.00, 28.50],
            [69.50, 26.50],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'Uttar Pradesh', code: 'UP' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [77.40, 27.50],
            [78.50, 26.80],
            [80.00, 25.00],
            [83.00, 24.00],
            [84.50, 25.50],
            [84.20, 27.30],
            [81.00, 28.60],
            [79.00, 29.50],
            [77.50, 28.88],
            [77.40, 27.50],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'Gujarat', code: 'GJ' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [68.20, 23.50],
            [70.50, 24.50],
            [73.50, 24.50],
            [74.30, 22.00],
            [73.00, 20.30],
            [72.50, 21.50],
            [70.00, 20.70],
            [68.80, 22.30],
            [68.20, 23.50],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'Maharashtra', code: 'MH' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [72.60, 18.50],
            [72.60, 20.20],
            [74.00, 21.80],
            [78.50, 21.80],
            [80.90, 21.40],
            [80.30, 18.80],
            [78.00, 18.00],
            [76.00, 17.00],
            [73.60, 15.70],
            [73.10, 16.50],
            [72.60, 18.50],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'Karnataka', code: 'KA' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [74.05, 14.80],
            [75.00, 16.50],
            [77.00, 17.80],
            [77.60, 17.50],
            [78.50, 15.00],
            [78.40, 13.50],
            [77.80, 12.50],
            [76.50, 11.80],
            [75.00, 12.50],
            [74.20, 14.00],
            [74.05, 14.80],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'Tamil Nadu', code: 'TN' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [76.20, 11.80],
            [78.00, 12.50],
            [79.80, 13.50],
            [80.35, 13.50],
            [80.30, 12.80],
            [79.80, 10.50],
            [79.00, 9.20],
            [77.50, 8.10],
            [77.20, 8.50],
            [76.80, 10.00],
            [76.20, 11.80],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'Kerala', code: 'KL' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [74.85, 12.80],
            [76.20, 11.80],
            [76.80, 10.00],
            [77.20, 8.50],
            [76.80, 8.40],
            [76.00, 9.50],
            [75.50, 11.50],
            [74.85, 12.80],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'Andhra Pradesh', code: 'AP' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [78.40, 13.50],
            [78.50, 15.00],
            [80.00, 16.50],
            [82.50, 17.50],
            [84.00, 19.00],
            [83.50, 18.00],
            [81.00, 15.50],
            [80.20, 13.50],
            [79.50, 13.20],
            [78.40, 13.50],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'Telangana', code: 'TG' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [77.20, 16.20],
            [77.80, 18.50],
            [79.00, 19.80],
            [80.50, 18.50],
            [80.50, 17.00],
            [79.50, 16.00],
            [78.00, 16.00],
            [77.20, 16.20],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'Madhya Pradesh', code: 'MP' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [74.00, 22.00],
            [75.00, 24.50],
            [77.00, 25.00],
            [78.50, 26.80],
            [81.50, 25.00],
            [82.50, 23.50],
            [80.50, 21.50],
            [76.00, 21.50],
            [74.00, 22.00],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'West Bengal', code: 'WB' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [86.50, 21.50],
            [87.00, 23.50],
            [88.00, 25.50],
            [89.00, 26.80],
            [89.50, 26.00],
            [88.50, 22.50],
            [88.00, 21.50],
            [86.50, 21.50],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'Bihar', code: 'BR' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [83.30, 24.50],
            [84.50, 25.50],
            [84.20, 27.30],
            [88.00, 26.50],
            [87.50, 25.00],
            [85.50, 24.50],
            [83.30, 24.50],
          ],
        ],
      },
    },
  ],
};

