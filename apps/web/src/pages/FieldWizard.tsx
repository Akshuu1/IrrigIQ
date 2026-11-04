import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import L from 'leaflet';
import '@geoman-io/leaflet-geoman-free';
import 'leaflet/dist/leaflet.css';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';

import { api, type Pump, type SoilSuggestionResult, type Field } from '../api/client.js';
import { useAuth } from '../context/AuthContext.js';
import { formatArea as formatAreaDisplay } from '../utils/formatters.js';
import { PumpModal } from '../components/PumpModal.js';
import {
  CROPS,
  type Crop,
  polygonAreaHa,
  validatePolygon,
  toHectares,
  stateForPoint,
  suggestLanguageForState,
  type GeoJsonPolygon,
  type SoilType,
  type IrrigationMethod,
  type CreateFieldInput,
} from '@irrigiq/shared';
import {
  MapPin,
  AlertCircle,
  Loader2,
  Check,
  Wheat,
  Ruler,
  Sparkles,
  Navigation,
  Search,
  Gauge,
  PlusCircle,
  Layers,
} from 'lucide-react';

export function FieldWizard(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const lang = (i18n.language || user?.language || 'en') as 'en' | 'hi';
  const userUnit = user?.areaUnit || 'acre';

  // Mode: 'pin' (default for quick onboarding) vs 'polygon' (drawing)
  const [locationMode, setLocationMode] = useState<'pin' | 'polygon'>('pin');

  // Map & drawing state
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const drawnLayerRef = useRef<L.Layer | null>(null);
  const pinMarkerRef = useRef<L.Marker | null>(null);

  // Pin state
  const [pinLocation, setPinLocation] = useState<{ lng: number; lat: number } | null>(null);
  const [detectedState, setDetectedState] = useState<string | null>(null);
  const [suggestedLang, setSuggestedLang] = useState<'en' | 'hi' | null>(null);
  const [soilSuggestion, setSoilSuggestion] = useState<SoilSuggestionResult | null>(null);
  const [isLoadingSoil, setIsLoadingSoil] = useState(false);

  // Area units state (for pin mode)
  const [areaValue, setAreaValue] = useState<string>('2');
  const [areaUnit, setAreaUnit] = useState<string>('acre');
  const [customAcresPerUnit, setCustomAcresPerUnit] = useState<string>('0.5');

  // Polygon state
  const [polygon, setPolygon] = useState<GeoJsonPolygon | null>(null);
  const [calculatedAreaHa, setCalculatedAreaHa] = useState<number>(0);

  // Location search state
  const [isLocating, setIsLocating] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Form details state
  const [name, setName] = useState('');
  const [cropKey, setCropKey] = useState('wheat');
  const [sowingDate, setSowingDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 15);
    return d.toISOString().split('T')[0];
  });
  const [soilType, setSoilType] = useState<SoilType>('loam');
  const [method, setMethod] = useState<IrrigationMethod>('drip');
  const [everyDays, setEveryDays] = useState<number>(4);
  const [depthMm, setDepthMm] = useState<number>(30);
  const [pumps, setPumps] = useState<Pump[]>([]);
  const [selectedPumpId, setSelectedPumpId] = useState<string>('');
  const [isPumpModalOpen, setIsPumpModalOpen] = useState(false);

  useEffect(() => {
    api.getPumps().then(setPumps).catch(() => {});
  }, []);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Calculate live area in hectares for pin mode
  const computedPinHa = useMemo(() => {
    const num = parseFloat(areaValue);
    if (isNaN(num) || num <= 0) return 0;
    try {
      const mult = areaUnit === 'custom' ? parseFloat(customAcresPerUnit) : undefined;
      return toHectares(num, areaUnit, mult);
    } catch {
      return 0;
    }
  }, [areaValue, areaUnit, customAcresPerUnit]);

  // Handle setting a pin location
  const handleSetPin = (lng: number, lat: number) => {
    setPinLocation({ lng, lat });
    setErrors((prev) => {
      const next = { ...prev };
      delete next.location;
      delete next.polygon;
      return next;
    });

    // Update marker on map
    if (mapRef.current) {
      if (pinMarkerRef.current) {
        pinMarkerRef.current.setLatLng([lat, lng]);
      } else {
        const pinIcon = L.divIcon({
          className: 'custom-pin-marker',
          html: `<div style="background:#10b981;border:3px solid #ffffff;width:24px;height:24px;border-radius:50%;box-shadow:0 4px 12px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;">
                  <div style="background:#ffffff;width:8px;height:8px;border-radius:50%;"></div>
                </div>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        });
        pinMarkerRef.current = L.marker([lat, lng], { icon: pinIcon }).addTo(mapRef.current);
      }
    }

    // Detect administrative state & suggest language
    const state = stateForPoint(lng, lat);
    setDetectedState(state);
    const suggested = suggestLanguageForState(state);
    setSuggestedLang(suggested);

    // Fetch ISRIC SoilGrids suggestion
    setIsLoadingSoil(true);
    api
      .getSoilSuggestion(lng, lat)
      .then((sugg) => {
        if (sugg) {
          setSoilSuggestion(sugg);
          setSoilType(sugg.texture);
        }
      })
      .catch(() => {})
      .finally(() => {
        setIsLoadingSoil(false);
      });
  };

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    // Centered near Jaipur/Delhi agricultural belt
    const initialLat = 26.9124;
    const initialLng = 75.7873;

    const map = L.map(mapContainerRef.current, {
      center: [initialLat, initialLng],
      zoom: 9,
    });
    mapRef.current = map;

    // OpenStreetMap standard tiles
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
    }).addTo(map);

    // Initial pin placement
    handleSetPin(initialLng, initialLat);

    // Map click handler for dropping pin
    map.on('click', (e: L.LeafletMouseEvent) => {
      handleSetPin(Number(e.latlng.lng.toFixed(6)), Number(e.latlng.lat.toFixed(6)));
    });

    // Geoman Controls for polygon mode
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

    const processPolygonLayer = (layer: L.Layer) => {
      try {
        if (!('getLatLngs' in layer)) return;
        const latlngs = (layer as L.Polygon).getLatLngs();
        const rings: L.LatLng[] = Array.isArray(latlngs[0])
          ? (latlngs[0] as L.LatLng[])
          : (latlngs as L.LatLng[]);

        if (!rings || rings.length < 3) return;

        const coords: [number, number][] = rings.map((ll: L.LatLng) => [
          Number(ll.lng.toFixed(6)),
          Number(ll.lat.toFixed(6)),
        ]);

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

        // Use polygon centroid to trigger state & soil lookup
        if (coords[0]) {
          handleSetPin(coords[0][0], coords[0][1]);
        }
      } catch (err) {
        console.error('Error computing drawn polygon:', err);
      }
    };

    map.on('pm:create', (e: { layer: L.Layer }) => {
      if (drawnLayerRef.current) {
        map.removeLayer(drawnLayerRef.current);
      }
      drawnLayerRef.current = e.layer;
      processPolygonLayer(e.layer);

      e.layer.on('pm:edit', () => {
        processPolygonLayer(e.layer);
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

  // HTML5 Geolocation to center on farmer's real farm
  const handleLocateCurrentPosition = () => {
    if (!navigator.geolocation) {
      alert(
        lang === 'hi'
          ? 'आपके ब्राउज़र में जीपीएस सुविधा उपलब्ध नहीं है।'
          : 'Geolocation is not supported by your browser.',
      );
      return;
    }
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsLocating(false);
        const { latitude, longitude } = pos.coords;
        if (mapRef.current) {
          mapRef.current.flyTo([latitude, longitude], 16, { duration: 1.5 });
        }
        handleSetPin(Number(longitude.toFixed(6)), Number(latitude.toFixed(6)));
      },
      (err) => {
        setIsLocating(false);
        console.warn('Geolocation error:', err);
        alert(
          lang === 'hi'
            ? 'जीपीएस स्थान प्राप्त नहीं हो सका। कृपया अनुमति दें या मानचित्र पर टैप करें।'
            : 'Could not access GPS. Please ensure location permission is allowed, or tap on the map.',
        );
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  // OpenStreetMap Nominatim search for any village or district in India
  const handleSearchLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
          searchQuery.trim() + ', India',
        )}&format=json&countrycodes=in&limit=1`,
        {
          headers: {
            'Accept-Language': lang === 'hi' ? 'hi,en' : 'en',
            'User-Agent': 'IrrigIQ/1.0 (https://irrigiq.org; agronomy@irrigiq.org)',
          },
        },
      );
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0 && data[0]?.lat && data[0]?.lon) {
        const lat = parseFloat(data[0].lat);
        const lon = parseFloat(data[0].lon);
        if (mapRef.current) {
          mapRef.current.flyTo([lat, lon], 14, { duration: 1.5 });
        }
        handleSetPin(Number(lon.toFixed(6)), Number(lat.toFixed(6)));
      } else {
        setSearchError(
          lang === 'hi'
            ? 'स्थान नहीं मिला, कृपया गाँव या ज़िला नाम से खोजें।'
            : 'Location not found. Try searching by village or district name.',
        );
      }
    } catch {
      setSearchError(lang === 'hi' ? 'खोज में त्रुटि हुई।' : 'Search request failed.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    const fieldName = name.trim() || (lang === 'hi' ? 'मेरा खेत' : 'My Farm');

    let formPayload: CreateFieldInput;

    if (locationMode === 'pin') {
      if (!pinLocation) {
        setErrors({ location: t('fieldWizard.pinRequired') });
        return;
      }

      const numArea = parseFloat(areaValue);
      if (isNaN(numArea) || numArea <= 0) {
        setErrors({ areaValue: 'Please enter a valid positive area' });
        return;
      }

      const mult = areaUnit === 'custom' ? parseFloat(customAcresPerUnit) : undefined;
      let computedHa = 0;
      try {
        computedHa = toHectares(numArea, areaUnit, mult);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Invalid area';
        setErrors({ areaValue: msg });
        return;
      }

      if (computedHa < 0.01 || computedHa > 500) {
        setErrors({ areaValue: 'Area must be between 0.01 ha and 500 ha' });
        return;
      }

      formPayload = {
        name: fieldName,
        locationMode: 'pin',
        location: {
          type: 'Point',
          coordinates: [pinLocation.lng, pinLocation.lat],
        },
        areaValue: numArea,
        areaUnit: areaUnit as 'acre' | 'ha' | 'hectare' | 'guntha' | 'custom',
        customAcresPerUnit: mult,
        cropKey,
        sowingDate: new Date(sowingDate || Date.now()),
        soilType,
        method,
        baseline: {
          everyDays: Number(everyDays),
          depthMm: Number(depthMm),
        },
        pumpId: selectedPumpId || undefined,
      };
    } else {
      // Polygon mode
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

      formPayload = {
        name: fieldName,
        locationMode: 'polygon',
        geometry: polygon,
        cropKey,
        sowingDate: new Date(sowingDate || Date.now()),
        soilType,
        method,
        baseline: {
          everyDays: Number(everyDays),
          depthMm: Number(depthMm),
        },
        pumpId: selectedPumpId || undefined,
      };
    }

    setIsSubmitting(true);
    try {
      const newField = await api.createField(formPayload);
      queryClient.setQueryData<Field[]>(['fields'], (old) => {
        if (!old) return [newField];
        return [newField, ...old.filter((f) => f.id !== newField.id)];
      });
      if (typeof window !== 'undefined' && 'caches' in window) {
        caches
          .open('irrigiq-api-cache')
          .then((cache) => {
            cache.delete('/fields');
          })
          .catch(() => {});
      }
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
        {/* Step 1: Location & Pin Drop / Boundary */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 space-y-4 shadow-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <MapPin className="w-5 h-5 text-emerald-400" />
              <span>{t('fieldWizard.stepMap')}</span>
            </h2>

            {/* Mode Switcher: Pin vs Polygon */}
            <div className="inline-flex rounded-xl bg-slate-950 p-1 border border-slate-800">
              <button
                type="button"
                onClick={() => setLocationMode('pin')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  locationMode === 'pin'
                    ? 'bg-emerald-500 text-slate-950 shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <MapPin className="w-3.5 h-3.5" />
                <span>{t('fieldWizard.modePin')}</span>
              </button>
              <button
                type="button"
                onClick={() => setLocationMode('polygon')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  locationMode === 'polygon'
                    ? 'bg-emerald-500 text-slate-950 shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>{t('fieldWizard.modePolygon')}</span>
              </button>
            </div>
          </div>

          {/* Quick Action Tools: GPS, Village Search */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <button
              type="button"
              onClick={handleLocateCurrentPosition}
              disabled={isLocating}
              className="px-4 py-2.5 rounded-xl border border-sky-500/50 bg-sky-950/40 hover:bg-sky-950 text-sky-300 font-bold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              {isLocating ? (
                <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
              ) : (
                <Navigation className="w-4 h-4 text-sky-400" />
              )}
              <span>{isLocating ? t('fieldWizard.locating') : t('fieldWizard.useMyLocation')}</span>
            </button>

            {/* Nominatim Search */}
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleSearchLocation(e);
                  }
                }}
                placeholder={t('fieldWizard.villageSearchPlaceholder')}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-9 pr-4 py-2 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-400"
              />
            </div>
            <button
              type="button"
              onClick={handleSearchLocation}
              disabled={isSearching}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            >
              {isSearching ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Search className="w-3.5 h-3.5" />
              )}
              <span>{lang === 'hi' ? 'खोजें' : 'Search'}</span>
            </button>
          </div>
          {searchError && <p className="text-xs text-amber-400 font-medium">{searchError}</p>}

          <p className="text-xs sm:text-sm text-slate-300">
            {locationMode === 'pin'
              ? t('fieldWizard.pinPrompt')
              : t('fieldWizard.mapInstruction')}
          </p>

          {/* Map Leaflet Container */}
          <div className="relative w-full h-[360px] sm:h-[400px] rounded-2xl overflow-hidden border-2 border-slate-700 bg-slate-950">
            <div ref={mapContainerRef} className="w-full h-full z-10" />

            {/* Live Area Display Overlay for Polygon */}
            {locationMode === 'polygon' && calculatedAreaHa > 0 && (
              <div className="absolute bottom-4 right-4 z-20 bg-slate-950/90 backdrop-blur-md border border-emerald-500/80 rounded-2xl px-4 py-2.5 shadow-2xl flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                  <Ruler className="w-4 h-4" />
                </div>
                <div>
                  <span className="block text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
                    {t('dashboard.areaLabel')}
                  </span>
                  <span className="text-base font-extrabold text-emerald-300">
                    {formatAreaDisplay(calculatedAreaHa, userUnit, lang)}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Detected State & Language Suggestion Banner */}
          {detectedState && (
            <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-2xl bg-slate-950/70 border border-slate-800 text-xs">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-emerald-400" />
                <span className="text-slate-200 font-bold">
                  {t('fieldWizard.detectedState', { state: detectedState })}
                </span>
              </div>

              {suggestedLang && suggestedLang !== lang && (
                <button
                  type="button"
                  onClick={() => i18n.changeLanguage(suggestedLang)}
                  className="px-3 py-1.5 rounded-xl bg-sky-950/60 border border-sky-500/60 text-sky-300 font-bold hover:bg-sky-900 transition-colors cursor-pointer"
                >
                  {t('fieldWizard.switchLanguage', {
                    lang: suggestedLang === 'hi' ? 'हिंदी' : 'English',
                  })}
                </button>
              )}
            </div>
          )}

          {/* ISRIC Soil Suggestion Card with Confirm/Change */}
          {isLoadingSoil && (
            <div className="p-3 rounded-xl bg-slate-950/50 border border-slate-800 flex items-center gap-2 text-xs text-slate-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
              <span>Checking soil texture from ISRIC SoilGrids...</span>
            </div>
          )}

          {soilSuggestion && !isLoadingSoil && (
            <div className="p-3.5 rounded-2xl bg-emerald-950/30 border border-emerald-500/40 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  {t('fieldWizard.soilSuggestionTitle')}
                </span>
                <span className="text-[11px] text-slate-400">ISRIC SoilGrids 250m</span>
              </div>
              <p className="text-xs text-slate-200">
                {t('fieldWizard.soilSuggested', {
                  texture: soilSuggestion.texture.toUpperCase(),
                  sand: soilSuggestion.sandPct,
                  clay: soilSuggestion.clayPct,
                })}
              </p>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setSoilType(soilSuggestion.texture)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                    soilType === soilSuggestion.texture
                      ? 'bg-emerald-600 text-white shadow-md'
                      : 'bg-emerald-950/60 hover:bg-emerald-900 text-emerald-300 border border-emerald-700'
                  }`}
                >
                  ✓ {t('fieldWizard.useSuggestedSoil')} ({soilSuggestion.texture})
                </button>
              </div>
            </div>
          )}

          {errors.location && (
            <p className="text-xs sm:text-sm text-rose-400 font-semibold flex items-center gap-1.5 mt-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{errors.location}</span>
            </p>
          )}

          {errors.polygon && (
            <p className="text-xs sm:text-sm text-rose-400 font-semibold flex items-center gap-1.5 mt-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{errors.polygon}</span>
            </p>
          )}
        </div>

        {/* Step 2: Area Units & Crop Details */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 space-y-5 shadow-xl">
          <h2 className="text-lg font-bold text-white flex items-center gap-2 border-b border-slate-800/80 pb-3">
            <Wheat className="w-5 h-5 text-emerald-400" />
            <span>{t('fieldWizard.stepDetails')}</span>
          </h2>

          {/* Area Input (Pin Mode) */}
          {locationMode === 'pin' && (
            <div className="space-y-4 p-4 rounded-2xl bg-slate-950/60 border border-slate-800">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="field-area-value"
                    className="block text-sm font-semibold text-slate-200 mb-2"
                  >
                    {t('fieldWizard.areaLabel')} *
                  </label>
                  <input
                    id="field-area-value"
                    type="number"
                    step="any"
                    min="0.01"
                    value={areaValue}
                    onChange={(e) => setAreaValue(e.target.value)}
                    placeholder="2"
                    className="w-full min-h-[48px] bg-slate-950 border border-slate-700 focus:border-emerald-400 rounded-xl px-4 py-3 text-base text-white focus:outline-none"
                  />
                  {errors.areaValue && (
                    <p className="mt-1 text-xs text-rose-400 font-medium">{errors.areaValue}</p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="field-area-unit"
                    className="block text-sm font-semibold text-slate-200 mb-2"
                  >
                    {t('fieldWizard.areaUnitLabel')} *
                  </label>
                  <select
                    id="field-area-unit"
                    value={areaUnit}
                    onChange={(e) => setAreaUnit(e.target.value)}
                    className="w-full min-h-[48px] bg-slate-950 border border-slate-700 focus:border-emerald-400 rounded-xl px-4 py-3 text-base text-white focus:outline-none"
                  >
                    <option value="acre">{t('fieldWizard.unitAcre')}</option>
                    <option value="ha">{t('fieldWizard.unitHectare')}</option>
                    <option value="guntha">{t('fieldWizard.unitGuntha')}</option>
                    <option value="custom">{t('fieldWizard.unitCustom')}</option>
                  </select>
                </div>
              </div>

              {/* Custom Acres Multiplier */}
              {areaUnit === 'custom' && (
                <div>
                  <label
                    htmlFor="field-custom-multiplier"
                    className="block text-sm font-semibold text-slate-200 mb-2"
                  >
                    {t('fieldWizard.customMultiplierLabel')} *
                  </label>
                  <input
                    id="field-custom-multiplier"
                    type="number"
                    step="any"
                    min="0.001"
                    value={customAcresPerUnit}
                    onChange={(e) => setCustomAcresPerUnit(e.target.value)}
                    placeholder="0.5"
                    className="w-full min-h-[48px] bg-slate-950 border border-slate-700 focus:border-emerald-400 rounded-xl px-4 py-3 text-base text-white focus:outline-none"
                  />
                </div>
              )}

              {/* Area summary & warnings */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800 text-xs">
                <span className="text-slate-400 font-medium">
                  {t('fieldWizard.convertedArea', { ha: computedPinHa.toFixed(2) })}
                </span>
                {computedPinHa > 50 && (
                  <span className="text-amber-400 font-bold flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" />
                    {t('fieldWizard.areaWarning')}
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
            {/* Field Name */}
            <div>
              <label
                htmlFor="field-name"
                className="block text-sm font-semibold text-slate-200 mb-2"
              >
                {t('fieldWizard.fieldName')}
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
                {CROPS.map((c: Crop) => (
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

        {/* Step 3: Routine Practices */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 space-y-4 shadow-xl">
          <div className="border-b border-slate-800/80 pb-3">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Wheat className="w-5 h-5 text-emerald-400" />
              <span>{t('fieldWizard.stepRoutine')}</span>
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 mt-1">
              {t('fieldWizard.routineSubtitle')}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                max="30"
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

        {/* Step 4: Irrigation Pump (Optional) */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 space-y-4 shadow-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Gauge className="w-5 h-5 text-emerald-400" />
                <span>{t('pumps.title')}</span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Link a pump to get operating run-time hours instead of litres.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsPumpModalOpen(true)}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-400 font-bold text-xs flex items-center gap-1.5 transition-all self-start sm:self-auto cursor-pointer"
            >
              <PlusCircle className="w-4 h-4 stroke-[2.5]" />
              <span>{t('pumps.addNewPump')}</span>
            </button>
          </div>

          <div>
            <label
              htmlFor="field-pump"
              className="block text-sm font-semibold text-slate-200 mb-1"
            >
              {t('pumps.selectPlaceholder')}
            </label>
            <select
              id="field-pump"
              value={selectedPumpId}
              onChange={(e) => setSelectedPumpId(e.target.value)}
              className="w-full min-h-[48px] bg-slate-950 border border-slate-700 focus:border-emerald-400 rounded-xl px-4 py-3 text-base text-white focus:outline-none"
            >
              <option value="">{t('pumps.selectPlaceholder')}</option>
              {pumps.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.dischargeLph.toLocaleString()} L/h)
                  {p.costPerHour ? ` • ₹${p.costPerHour}/h` : ''}
                </option>
              ))}
            </select>
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

      {/* Pump Setup Modal */}
      <PumpModal
        isOpen={isPumpModalOpen}
        onClose={() => setIsPumpModalOpen(false)}
        onSuccess={(newPump) => {
          setPumps((prev) => [newPump, ...prev]);
          setSelectedPumpId(newPump.id);
          setIsPumpModalOpen(false);
        }}
      />
    </div>
  );
}
