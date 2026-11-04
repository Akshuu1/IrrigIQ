import React from 'react';
import { useTranslation } from 'react-i18next';
import { WifiOff, MapPin } from 'lucide-react';
import type { GeoJsonPolygon } from '@irrigiq/shared';

interface OfflineFieldMapProps {
  geometry?: GeoJsonPolygon | null;
  areaHa?: number;
  fieldName?: string;
  className?: string;
}

export const OfflineFieldMap: React.FC<OfflineFieldMapProps> = ({
  geometry,
  areaHa,
  fieldName,
  className = '',
}) => {
  const { t } = useTranslation();

  if (!geometry || !geometry.coordinates || !geometry.coordinates[0]) {
    return (
      <div className={`flex flex-col items-center justify-center bg-slate-100 rounded-lg p-6 text-slate-500 ${className}`}>
        <WifiOff className="w-8 h-8 mb-2 text-slate-400" />
        <p className="text-sm">{t('offline.no_map_geometry', 'No geometry available')}</p>
      </div>
    );
  }

  const coordinates = geometry.coordinates[0]; // [ [lng, lat], ... ]

  // Calculate bounding box safely
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  for (const pt of coordinates) {
    const lng = pt[0] ?? 0;
    const lat = pt[1] ?? 0;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }

  const paddingLng = Math.max((maxLng - minLng) * 0.15, 0.0005);
  const paddingLat = Math.max((maxLat - minLat) * 0.15, 0.0005);

  const viewMinLng = minLng - paddingLng;
  const viewMaxLng = maxLng + paddingLng;
  const viewMinLat = minLat - paddingLat;
  const viewMaxLat = maxLat + paddingLat;

  const width = 400;
  const height = 260;

  // Project [lng, lat] to SVG [x, y]
  const project = (lng: number, lat: number) => {
    const x = ((lng - viewMinLng) / (viewMaxLng - viewMinLng)) * width;
    // Invert lat for SVG Y axis
    const y = ((viewMaxLat - lat) / (viewMaxLat - viewMinLat)) * height;
    return [x, y];
  };

  const points = coordinates
    .map((pt) => project(pt[0] ?? 0, pt[1] ?? 0).join(','))
    .join(' ');

  // Centroid projection
  const centroidLng = (minLng + maxLng) / 2;
  const centroidLat = (minLat + maxLat) / 2;
  const [cx, cy] = project(centroidLng, centroidLat);

  return (
    <div className={`relative bg-slate-50 border border-slate-200 rounded-xl overflow-hidden ${className}`}>
      {/* Offline Grid Background */}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-full"
        style={{ minHeight: '220px' }}
      >
        <defs>
          <pattern id="grid-pattern" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#e2e8f0" strokeWidth="1" />
          </pattern>
        </defs>

        <rect width={width} height={height} fill="url(#grid-pattern)" />

        {/* Field Polygon Outline & Semi-transparent Fill */}
        <polygon
          points={points}
          fill="rgba(34, 197, 94, 0.2)"
          stroke="#16a34a"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />

        {/* Coordinate Vertices */}
        {coordinates.map((pt, i) => {
          const [px, py] = project(pt[0] ?? 0, pt[1] ?? 0);
          return (
            <circle
              key={i}
              cx={px}
              cy={py}
              r="3.5"
              fill="#ffffff"
              stroke="#15803d"
              strokeWidth="2"
            />
          );
        })}

        {/* Centroid Marker */}
        <circle cx={cx} cy={cy} r="5" fill="#0284c7" />
        <circle cx={cx} cy={cy} r="9" fill="none" stroke="#38bdf8" strokeWidth="1.5" opacity="0.6" />
      </svg>

      {/* Offline Notice Badge */}
      <div className="absolute top-2 left-2 bg-white/90 backdrop-blur-sm px-2.5 py-1 rounded-md text-xs font-medium text-slate-700 shadow-xs border border-slate-200 flex items-center space-x-1.5">
        <WifiOff className="w-3.5 h-3.5 text-amber-600" />
        <span>{t('offline.vector_map_notice', 'Offline: Vector outline (no tile download)')}</span>
      </div>

      {/* Field Metadata Bottom Bar */}
      <div className="absolute bottom-2 right-2 bg-white/90 backdrop-blur-sm px-2.5 py-1 rounded-md text-xs text-slate-600 shadow-xs border border-slate-200 flex items-center space-x-2">
        <MapPin className="w-3.5 h-3.5 text-emerald-600" />
        {fieldName && <span className="font-semibold text-slate-800">{fieldName}</span>}
        {areaHa !== undefined && <span>{areaHa} ha</span>}
      </div>
    </div>
  );
};
