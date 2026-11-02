import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import L from 'leaflet';
import '@geoman-io/leaflet-geoman-free';
import 'leaflet/dist/leaflet.css';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';

import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.js';
import { formatArea } from '../utils/formatters.js';
import {
  CROPS,
  polygonAreaHa,
  validatePolygon,
  createFieldSchema,
  type GeoJsonPolygon,
  type SoilType,
  type IrrigationMethod,
} from '@irrigiq/shared';
import { MapPin, AlertCircle, Loader2, Check, Wheat, Ruler, Clock, Sparkles } from 'lucide-react';

export function FieldWizard(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();

  const lang = (i18n.language || user?.language || 'en') as 'en' | 'hi';
  const unit = user?.areaUnit || 'acre';

  // Map & drawing state
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const drawnLayerRef = useRef<L.Layer | null>(null);

  const [polygon, setPolygon] = useState<GeoJsonPolygon | null>(null);
  const [calculatedAreaHa, setCalculatedAreaHa] = useState<number>(0);

  // Form state
  const [name, setName] = useState('');
  const [cropKey, setCropKey] = useState('wheat');
  const [sowingDate, setSowingDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 15); // Default 15 days ago
    return d.toISOString().split('T')[0];
  });
  const [soilType, setSoilType] = useState<SoilType>('loam');
  const [method, setMethod] = useState<IrrigationMethod>('drip');
  const [everyDays, setEveryDays] = useState<number>(4);
  const [depthMm, setDepthMm] = useState<number>(30);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Initialize Leaflet & Geoman
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    // Centered on central/north India (e.g. Madhya Pradesh / Haryana / Punjab agricultural belts)
    const map = L.map(mapContainerRef.current, {
      center: [28.6139, 77.209],
      zoom: 8,
    });
    mapRef.current = map;

    // OpenStreetMap Standard Tiles
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
    }).addTo(map);

    // Geoman Controls
    map.pm.addControls({
      position: 'topleft',
      drawMarker: false,
      drawCircleMarker: false,
      drawPolyline: false,
      drawRectangle: true,
      drawPolygon: true,
      drawCircle: false,
      editMode: true,
      dragMode: false,
      cutPolygon: false,
      removalMode: true,
    });

    // Handle polygon extraction
    const processLayer = (layer: L.Layer) => {
      try {
        if (!('getLatLngs' in layer)) return;
        const latlngs = (layer as L.Polygon).getLatLngs();
        const rings: L.LatLng[] = Array.isArray(latlngs[0])
          ? (latlngs[0] as L.LatLng[])
          : (latlngs as L.LatLng[]);

        if (!rings || rings.length < 3) return;

        // Convert to GeoJSON [[lng, lat], ...]
        const coords: [number, number][] = rings.map((ll: L.LatLng) => [
          Number(ll.lng.toFixed(6)),
          Number(ll.lat.toFixed(6)),
        ]);

        // Ensure closed ring
        const first = coords[0];
        const last = coords[coords.length - 1];
        if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
          coords.push([first[0], first[1]]);
        }

        const geoJson: GeoJsonPolygon = {
          type: 'Polygon',
          coordinates: [coords],
        };

        const area = polygonAreaHa(geoJson);
        setCalculatedAreaHa(area);
        setPolygon(geoJson);
        setErrors((prev) => {
          const next = { ...prev };
          delete next.polygon;
          return next;
        });
      } catch (err) {
        console.error('Error computing drawn polygon:', err);
      }
    };

    map.on('pm:create', (e: { layer: L.Layer }) => {
      if (drawnLayerRef.current) {
        map.removeLayer(drawnLayerRef.current);
      }
      drawnLayerRef.current = e.layer;
      processLayer(e.layer);

      e.layer.on('pm:edit', () => {
        processLayer(e.layer);
      });
    });

    map.on('pm:remove', () => {
      drawnLayerRef.current = null;
      setPolygon(null);
      setCalculatedAreaHa(0);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Quick preset sample field in Haryana/Punjab region (approx 1.2 ha)
  const handleQuickSampleField = () => {
    if (!mapRef.current) return;
    const map = mapRef.current;

    if (drawnLayerRef.current) {
      map.removeLayer(drawnLayerRef.current);
    }

    // Sample coordinates near Karnal, Haryana (lat 29.69, lng 76.99)
    const sampleCoords: [number, number][] = [
      [76.985, 29.69],
      [76.988, 29.69],
      [76.988, 29.694],
      [76.985, 29.694],
      [76.985, 29.69],
    ];

    const latlngs: L.LatLngExpression[] = sampleCoords.map((c) => [c[1], c[0]]);
    const polygonLayer = L.polygon(latlngs, {
      color: '#10b981',
      fillColor: '#10b981',
      fillOpacity: 0.35,
    }).addTo(map);

    drawnLayerRef.current = polygonLayer;

    const geoJson: GeoJsonPolygon = {
      type: 'Polygon',
      coordinates: [sampleCoords],
    };

    const area = polygonAreaHa(geoJson);
    setCalculatedAreaHa(area);
    setPolygon(geoJson);
    setName((prev) => prev || (lang === 'hi' ? 'करनाल गेहूं का खेत' : 'Karnal Wheat Field'));

    map.fitBounds(polygonLayer.getBounds(), { padding: [40, 40] });

    // Enable editing on sample layer
    polygonLayer.on('pm:edit', () => {
      const latlngs = polygonLayer.getLatLngs();
      const rings: L.LatLng[] = Array.isArray(latlngs[0])
        ? (latlngs[0] as L.LatLng[])
        : (latlngs as L.LatLng[]);
      const updated: [number, number][] = rings.map((ll) => [ll.lng, ll.lat]);
      const uFirst = updated[0];
      const uLast = updated[updated.length - 1];
      if (uFirst && uLast && (uFirst[0] !== uLast[0] || uFirst[1] !== uLast[1])) {
        updated.push([uFirst[0], uFirst[1]]);
      }
      const updatedGeoJson: GeoJsonPolygon = {
        type: 'Polygon',
        coordinates: [updated],
      };
      setCalculatedAreaHa(polygonAreaHa(updatedGeoJson));
      setPolygon(updatedGeoJson);
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    // Client-side validation
    if (!polygon) {
      setErrors({ polygon: t('fieldWizard.polygonRequired') });
      return;
    }

    try {
      validatePolygon(polygon);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('fieldWizard.polygonInvalid');
      setErrors({ polygon: msg });
      return;
    }

    const formPayload = {
      name,
      geometry: polygon,
      cropKey,
      sowingDate,
      soilType,
      method,
      baseline: {
        everyDays: Number(everyDays),
        depthMm: Number(depthMm),
      },
    };

    const result = createFieldSchema.safeParse(formPayload);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        fieldErrors[String(issue.path[0])] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    setIsSubmitting(true);
    try {
      await api.createField(result.data);
      navigate('/', { replace: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('fieldWizard.validationError');
      setErrors({
        general: msg,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto py-4 sm:py-6 space-y-6">
      {/* Wizard Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
            {t('fieldWizard.title')}
          </h1>
          <p className="text-sm text-slate-400 mt-1">{t('fieldWizard.subtitle')}</p>
        </div>
      </div>

      {/* General Error Banner */}
      {errors.general && (
        <div
          className="p-4 rounded-2xl bg-rose-950/70 border border-rose-800 text-rose-200 text-sm flex items-start gap-3"
          role="alert"
        >
          <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
          <div>{errors.general}</div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6" noValidate>
        {/* Step 1: Map Drawing */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 space-y-4 shadow-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <MapPin className="w-5 h-5 text-emerald-400" />
              <span>{t('fieldWizard.stepMap')}</span>
            </h2>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleQuickSampleField}
                className="px-3 py-1.5 rounded-xl border border-emerald-500/50 bg-emerald-950/40 hover:bg-emerald-950 text-emerald-300 font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{lang === 'hi' ? 'नमूना खेत जोड़ें' : 'Use Sample Field'}</span>
              </button>
            </div>
          </div>

          <p className="text-xs sm:text-sm text-slate-300">{t('fieldWizard.mapInstruction')}</p>

          {/* Map Leaflet Container */}
          <div className="relative w-full h-[380px] sm:h-[420px] rounded-2xl overflow-hidden border-2 border-slate-700 bg-slate-950">
            <div ref={mapContainerRef} className="w-full h-full z-10" />

            {/* Live Area Display Overlay */}
            {calculatedAreaHa > 0 && (
              <div className="absolute bottom-4 right-4 z-20 bg-slate-950/90 backdrop-blur-md border border-emerald-500/80 rounded-2xl px-4 py-2.5 shadow-2xl flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                  <Ruler className="w-4 h-4" />
                </div>
                <div>
                  <span className="block text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
                    {t('dashboard.areaLabel')}
                  </span>
                  <span className="text-base font-extrabold text-emerald-300">
                    {formatArea(calculatedAreaHa, unit, lang)}
                  </span>
                </div>
              </div>
            )}
          </div>

          {errors.polygon && (
            <p className="text-xs sm:text-sm text-rose-400 font-semibold flex items-center gap-1.5 mt-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{errors.polygon}</span>
            </p>
          )}
        </div>

        {/* Step 2: Field & Crop Details */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 space-y-5 shadow-xl">
          <h2 className="text-lg font-bold text-white flex items-center gap-2 border-b border-slate-800/80 pb-3">
            <Wheat className="w-5 h-5 text-emerald-400" />
            <span>{t('fieldWizard.stepDetails')}</span>
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
            {/* Field Name */}
            <div>
              <label
                htmlFor="field-name"
                className="block text-sm font-semibold text-slate-200 mb-2"
              >
                {t('fieldWizard.fieldName')} *
              </label>
              <input
                id="field-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('fieldWizard.fieldNamePlaceholder')}
                className={`w-full min-h-[48px] bg-slate-950 border rounded-xl px-4 py-3 text-base text-white placeholder-slate-500 focus:outline-none transition-colors ${
                  errors.name ? 'border-rose-500' : 'border-slate-700 focus:border-emerald-400'
                }`}
              />
              {errors.name && (
                <p className="mt-1 text-xs text-rose-400 font-medium">{errors.name}</p>
              )}
            </div>

            {/* Crop Selector */}
            <div>
              <label
                htmlFor="field-crop"
                className="block text-sm font-semibold text-slate-200 mb-2"
              >
                {t('fieldWizard.cropLabel')} *
              </label>
              <select
                id="field-crop"
                value={cropKey}
                onChange={(e) => setCropKey(e.target.value)}
                className="w-full min-h-[48px] bg-slate-950 border border-slate-700 focus:border-emerald-400 rounded-xl px-4 py-3 text-base text-white focus:outline-none"
              >
                {CROPS.map((c) => (
                  <option key={c.key} value={c.key}>
                    {lang === 'hi' ? `${c.nameHi} (${c.nameEn})` : `${c.nameEn} (${c.nameHi})`}
                  </option>
                ))}
              </select>
            </div>

            {/* Sowing Date */}
            <div>
              <label
                htmlFor="field-sowing"
                className="block text-sm font-semibold text-slate-200 mb-2"
              >
                {t('fieldWizard.sowingDate')} *
              </label>
              <input
                id="field-sowing"
                type="date"
                value={sowingDate}
                onChange={(e) => setSowingDate(e.target.value)}
                className="w-full min-h-[48px] bg-slate-950 border border-slate-700 focus:border-emerald-400 rounded-xl px-4 py-3 text-base text-white focus:outline-none"
              />
              {errors.sowingDate && (
                <p className="mt-1 text-xs text-rose-400 font-medium">{errors.sowingDate}</p>
              )}
            </div>

            {/* Soil Type */}
            <div>
              <label
                htmlFor="field-soil"
                className="block text-sm font-semibold text-slate-200 mb-2"
              >
                {t('fieldWizard.soilLabel')} *
              </label>
              <select
                id="field-soil"
                value={soilType}
                onChange={(e) => setSoilType(e.target.value as SoilType)}
                className="w-full min-h-[48px] bg-slate-950 border border-slate-700 focus:border-emerald-400 rounded-xl px-4 py-3 text-base text-white focus:outline-none"
              >
                <option value="sandy">{t('fieldWizard.soilSandy')}</option>
                <option value="loam">{t('fieldWizard.soilLoam')}</option>
                <option value="clay">{t('fieldWizard.soilClay')}</option>
              </select>
            </div>

            {/* Irrigation Method */}
            <div className="sm:col-span-2">
              <label
                htmlFor="field-method"
                className="block text-sm font-semibold text-slate-200 mb-2"
              >
                {t('fieldWizard.methodLabel')} *
              </label>
              <select
                id="field-method"
                value={method}
                onChange={(e) => setMethod(e.target.value as IrrigationMethod)}
                className="w-full min-h-[48px] bg-slate-950 border border-slate-700 focus:border-emerald-400 rounded-xl px-4 py-3 text-base text-white focus:outline-none"
              >
                <option value="drip">{t('fieldWizard.methodDrip')}</option>
                <option value="sprinkler">{t('fieldWizard.methodSprinkler')}</option>
                <option value="flood">{t('fieldWizard.methodFlood')}</option>
              </select>
            </div>
          </div>
        </div>

        {/* Step 3: Current Routine Baseline */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 space-y-4 shadow-xl">
          <div className="border-b border-slate-800/80 pb-3">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Clock className="w-5 h-5 text-emerald-400" />
              <span>{t('fieldWizard.stepRoutine')}</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">{t('fieldWizard.routineSubtitle')}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
            <div>
              <label
                htmlFor="field-every-days"
                className="block text-sm font-semibold text-slate-200 mb-1"
              >
                {t('fieldWizard.everyDaysLabel')} *
              </label>
              <p className="text-xs text-slate-400 mb-2">{t('fieldWizard.everyDaysHelp')}</p>
              <input
                id="field-every-days"
                type="number"
                min="1"
                max="60"
                value={everyDays}
                onChange={(e) => setEveryDays(Number(e.target.value))}
                className="w-full min-h-[48px] bg-slate-950 border border-slate-700 focus:border-emerald-400 rounded-xl px-4 py-3 text-base text-white focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="field-depth-mm"
                className="block text-sm font-semibold text-slate-200 mb-1"
              >
                {t('fieldWizard.depthMmLabel')} *
              </label>
              <p className="text-xs text-slate-400 mb-2">{t('fieldWizard.depthMmHelp')}</p>
              <input
                id="field-depth-mm"
                type="number"
                min="1"
                max="150"
                value={depthMm}
                onChange={(e) => setDepthMm(Number(e.target.value))}
                className="w-full min-h-[48px] bg-slate-950 border border-slate-700 focus:border-emerald-400 rounded-xl px-4 py-3 text-base text-white focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full min-h-[56px] rounded-2xl bg-emerald-500 hover:bg-emerald-400 active:scale-[0.99] disabled:opacity-60 text-slate-950 font-black text-lg shadow-xl shadow-emerald-500/25 flex items-center justify-center gap-2 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-6 h-6 animate-spin" />
              <span>{t('fieldWizard.creatingField')}</span>
            </>
          ) : (
            <>
              <Check className="w-6 h-6 stroke-[3]" />
              <span>{t('fieldWizard.submitButton')}</span>
            </>
          )}
        </button>
      </form>
    </div>
  );
}
