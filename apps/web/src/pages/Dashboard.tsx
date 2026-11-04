import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type Field, type Recommendation } from '../api/client.js';
import { useAuth } from '../context/AuthContext.js';
import { formatArea, formatNumber, formatDepthMm } from '../utils/formatters.js';
import { CROPS_MAP, formatDuration, formatTimeRange } from '@irrigiq/shared';
import { PumpModal } from '../components/PumpModal.js';
import {
  Droplet,
  PlusCircle,
  AlertTriangle,
  Calendar,
  CloudRain,
  RotateCw,
  Sparkles,
  Wheat,
  Clock,
  ArrowRight,
  Loader2,
  Gauge,
  ZapOff,
  Wind,
} from 'lucide-react';

function FieldRecommendationCard({
  field,
  onOpenPumpModal,
}: {
  field: Field;
  onOpenPumpModal: (field: Field) => void;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const lang = (i18n.language || user?.language || 'en') as 'en' | 'hi';
  const unit = user?.areaUnit || 'acre';

  const {
    data: recommendations,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['recommendations', field.id],
    queryFn: () => api.getRecommendations(field.id, 7),
    staleTime: 60 * 1000,
  });

  const crop = CROPS_MAP.get(field.cropKey);
  const localizedCropName = crop
    ? lang === 'hi'
      ? crop.nameHi
      : crop.nameEn
    : t(`crops.${field.cropKey}`, { defaultValue: field.cropKey });

  const todayRecommendation: Recommendation | undefined = recommendations?.[0];
  const isIrrigate = todayRecommendation?.plan?.action === 'irrigate';
  const weatherStale = todayRecommendation?.weatherStale ?? false;
  const runMinutesVal = todayRecommendation?.plan?.runMinutes;
  const splitAcrossDays = todayRecommendation?.plan?.splitAcrossDays ?? false;
  const pumpCostVal = todayRecommendation?.plan?.pumpCost;
  const isPumpMissing = todayRecommendation?.plan?.pumpMissing ?? false;
  const [isReportingNoPower, setIsReportingNoPower] = useState(false);

  const handleReportNoPower = async () => {
    if (!todayRecommendation) return;
    try {
      setIsReportingNoPower(true);
      await api.reportNoPower(field.id, todayRecommendation.forDate);
      await refetch();
    } catch (err) {
      console.error('Failed to report no power:', err);
    } finally {
      setIsReportingNoPower(false);
    }
  };

  // Localized action sentence and detail line
  let actionSentence = '';
  let detailSentence = '';
  if (todayRecommendation) {
    if (isIrrigate) {
      const depthFormatted = formatDepthMm(todayRecommendation.plan.grossMm, lang);
      const litresFormatted = formatNumber(Math.round(todayRecommendation.plan.litres), lang);

      if (runMinutesVal !== null && runMinutesVal !== undefined) {
        const durationFormatted = formatDuration(runMinutesVal, lang);

        let windowRange = '';
        const firstSeg = todayRecommendation.plan.pumpSegments?.[0];
        if (firstSeg) {
          const startHhmm = firstSeg.start.slice(11, 16);
          if (startHhmm === '22:00') {
            windowRange = formatTimeRange('22:00', '06:00', lang);
          } else if (startHhmm === '06:00') {
            windowRange = formatTimeRange('06:00', '14:00', lang);
          } else {
            const endHhmm = firstSeg.end.slice(11, 16);
            windowRange = formatTimeRange(startHhmm, endHhmm, lang);
          }
        }

        if (windowRange) {
          actionSentence = t('dashboard.runPumpWithWindow', {
            duration: durationFormatted,
            window: windowRange,
            defaultValue: `Run the pump ${durationFormatted}, ${windowRange}`,
          });
        } else {
          actionSentence = t('dashboard.runPumpSentence', {
            duration: durationFormatted,
            defaultValue: `Run the pump ${durationFormatted} tonight`,
          });
        }

        detailSentence = t('dashboard.volumeDetail', {
          litres: litresFormatted,
          depthMm: depthFormatted,
          defaultValue: `${litresFormatted} L (${depthFormatted})`,
        });
      } else {
        actionSentence =
          lang === 'hi'
            ? `आज ${depthFormatted} (लगभग ${litresFormatted} लीटर) सिंचाई करें`
            : `Irrigate ${depthFormatted} (about ${litresFormatted} litres) today`;
        detailSentence = t('dashboard.volumeDetail', {
          litres: litresFormatted,
          depthMm: depthFormatted,
          defaultValue: `${litresFormatted} L (${depthFormatted})`,
        });
      }
    } else {
      actionSentence = lang === 'hi' ? 'आज सिंचाई छोड़ें' : 'Skip irrigation today';
    }
  }

  // Reason message
  let reasonText = '';
  if (todayRecommendation?.plan?.reasonKey) {
    const key = todayRecommendation.plan.reasonKey.replace('reason.', '');
    const params = todayRecommendation.plan.reasonParams || {};
    reasonText = t(`reasons.${key}`, {
      ...params,
      defaultValue: t('reasons.not_needed'),
    });
  }

  const soilLabel =
    field.soilType === 'sandy'
      ? t('fieldWizard.soilSandy')
      : field.soilType === 'clay'
        ? t('fieldWizard.soilClay')
        : t('fieldWizard.soilLoam');

  const methodLabel =
    field.method === 'drip'
      ? t('fieldWizard.methodDrip')
      : field.method === 'sprinkler'
        ? t('fieldWizard.methodSprinkler')
        : t('fieldWizard.methodFlood');

  return (
    <div className="bg-slate-900 border-2 border-slate-800 rounded-3xl p-5 sm:p-7 shadow-xl hover:border-slate-700 transition-all space-y-5">
      {/* Field Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
              <Link to={`/fields/${field.id}`} className="hover:text-emerald-400 transition-colors">
                {field.name}
              </Link>
            </h2>
            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
              <Wheat className="w-3.5 h-3.5" />
              <span>{localizedCropName}</span>
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-400 mt-1 font-medium">
            <span>{formatArea(field.areaHa, unit, lang)}</span>
            <span>•</span>
            <span className="capitalize">{soilLabel}</span>
            <span>•</span>
            <span className="capitalize">{methodLabel}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-400 self-start sm:self-auto">
          <Calendar className="w-4 h-4 text-slate-500" />
          <span>
            {t('dashboard.daysAfterSowing', {
              days: Math.max(
                0,
                Math.floor(
                  (new Date().getTime() - new Date(field.sowingDate).getTime()) /
                    (1000 * 60 * 60 * 24),
                ),
              ),
            })}
          </span>
        </div>
      </div>

      {/* Loading state for field card */}
      {isLoading && (
        <div className="animate-pulse space-y-3 py-4">
          <div className="h-20 bg-slate-800/60 rounded-2xl w-full" />
          <div className="h-6 bg-slate-800/40 rounded-lg w-2/3" />
        </div>
      )}

      {/* Error state for field card */}
      {isError && (
        <div className="p-4 rounded-2xl bg-rose-950/40 border border-rose-900/60 text-rose-300 text-sm flex items-center justify-between">
          <span>{t('common.error')}</span>
          <button
            type="button"
            onClick={() => refetch()}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-rose-900 hover:bg-rose-800 text-xs font-bold text-white transition-colors cursor-pointer"
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span>{t('common.retry')}</span>
          </button>
        </div>
      )}

      {/* Today's Recommendation Box */}
      {!isLoading && !isError && todayRecommendation && (
        <div className="space-y-4">
          <div
            className={`rounded-2xl p-5 sm:p-6 border-2 transition-all ${
              isIrrigate
                ? 'bg-emerald-950/50 border-emerald-500/80 shadow-lg shadow-emerald-950/40 text-emerald-100'
                : 'bg-slate-950/80 border-slate-700/80 text-slate-100'
            }`}
          >
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs uppercase tracking-wider font-extrabold flex items-center gap-1.5 text-slate-400">
                <Clock className="w-3.5 h-3.5 text-emerald-400" />
                <span>{t('dashboard.todayAdvice')}</span>
              </span>

              {isIrrigate && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500 text-slate-950">
                  <Droplet className="w-3 h-3 fill-slate-950" />
                  <span>
                    {formatNumber(Math.round(todayRecommendation.plan.litres), lang)}{' '}
                    {t('units.litres')}
                  </span>
                </span>
              )}
            </div>

            {/* Large clear sentence */}
            <div>
              <div className="text-2xl sm:text-3xl font-black tracking-tight leading-snug">
                {actionSentence}
              </div>
              {isIrrigate && detailSentence && (
                <div className="text-xs sm:text-sm font-semibold text-emerald-300/90 mt-1.5 flex items-center gap-2">
                  <span>{detailSentence}</span>
                  {pumpCostVal !== null && pumpCostVal !== undefined && (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                      {t('dashboard.pumpCostEstimate', { cost: pumpCostVal })}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Multi-day split alert */}
            {isIrrigate && splitAcrossDays && (
              <div className="mt-3 p-3 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-200 text-xs font-medium flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                <span>{t('dashboard.splitAlert')}</span>
              </div>
            )}

            {/* Pump missing alert */}
            {isIrrigate && isPumpMissing && (
              <div className="mt-3 p-3 rounded-xl bg-slate-900 border border-slate-700 text-slate-300 text-xs flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5">
                  <Gauge className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  <span>{t('dashboard.pumpMissingPrompt')}</span>
                </span>
                <button
                  type="button"
                  onClick={() => onOpenPumpModal(field)}
                  className="px-3 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-1 shadow cursor-pointer flex-shrink-0"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span>{t('dashboard.addPump')}</span>
                </button>
              </div>
            )}

            {/* Scientific Explanation */}
            {reasonText && (
              <div className="mt-3.5 text-sm sm:text-base text-slate-300 font-medium flex items-start gap-2 pt-3 border-t border-slate-800/60">
                <Sparkles className="w-4 h-4 text-amber-400 flex-shrink-0 mt-1" />
                <span>{reasonText}</span>
              </div>
            )}

            {/* High Wind Alert for Sprinklers */}
            {todayRecommendation.plan.notes?.includes('plan.windy') && (
              <div className="mt-3 p-3 rounded-xl bg-sky-950/60 border border-sky-800/80 text-sky-200 text-xs flex items-center gap-2">
                <Wind className="w-4 h-4 text-sky-400 flex-shrink-0" />
                <span>{t('dashboard.planWindyWarning')}</span>
              </div>
            )}

            {/* Missing Power Window Alert */}
            {Boolean(todayRecommendation.plan.missingMinutes && todayRecommendation.plan.missingMinutes > 0) && (
              <div className="mt-3 p-3 rounded-xl bg-amber-950/60 border border-amber-800/80 text-amber-200 text-xs flex items-center gap-2">
                <ZapOff className="w-4 h-4 text-amber-400 flex-shrink-0" />
                <span>
                  {t('dashboard.missingPowerWarning', {
                    missing: todayRecommendation.plan.missingMinutes,
                  })}
                </span>
              </div>
            )}

            {/* Power Outage Alert */}
            {todayRecommendation.plan.notes?.includes('plan.no_power') && (
              <div className="mt-3 p-3 rounded-xl bg-rose-950/60 border border-rose-800/80 text-rose-200 text-xs flex items-center gap-2">
                <ZapOff className="w-4 h-4 text-rose-400 flex-shrink-0" />
                <span>{t('dashboard.noPowerReportedAlert')}</span>
              </div>
            )}

            {/* No Power Action Button */}
            {isIrrigate && (
              <div className="mt-3 pt-2 flex items-center justify-end">
                <button
                  type="button"
                  disabled={isReportingNoPower}
                  onClick={handleReportNoPower}
                  className="text-xs font-semibold text-amber-400 hover:text-amber-300 flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <ZapOff className="w-3.5 h-3.5" />
                  <span>
                    {isReportingNoPower ? t('dashboard.rescheduling') : t('dashboard.noPowerButton')}
                  </span>
                </button>
              </div>
            )}
          </div>

          {/* Stale Weather Warning */}
          {weatherStale && (
            <div
              className="p-3.5 rounded-xl bg-amber-950/50 border border-amber-800/80 text-amber-200 text-xs sm:text-sm flex items-start gap-2.5 font-medium"
              role="alert"
            >
              <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <span>{t('dashboard.weatherStaleWarning')}</span>
            </div>
          )}

          {/* ET0 and Rain summary */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs text-slate-400 pt-1">
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-2.5 text-center">
              <span className="block text-slate-500 mb-0.5">Reference ET₀</span>
              <span className="font-bold text-slate-200 text-sm">
                {todayRecommendation.dailyNeeds.et0Mm} mm
              </span>
            </div>
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-2.5 text-center">
              <span className="block text-slate-500 mb-0.5">Forecast Rain</span>
              <span className="font-bold text-slate-200 text-sm flex items-center justify-center gap-1">
                <CloudRain className="w-3.5 h-3.5 text-sky-400" />
                <span>{todayRecommendation.dailyNeeds.rainMm} mm</span>
              </span>
            </div>
            <div className="col-span-2 sm:col-span-1 bg-slate-950/60 border border-slate-800/80 rounded-xl p-2.5 text-center">
              <span className="block text-slate-500 mb-0.5">Crop Need (ETc)</span>
              <span className="font-bold text-slate-200 text-sm">
                {todayRecommendation.dailyNeeds.etcMm} mm
              </span>
            </div>
          </div>

          {/* View Details Link */}
          <div className="pt-2 border-t border-slate-800/80 flex items-center justify-end">
            <Link
              to={`/fields/${field.id}`}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs transition-colors cursor-pointer"
            >
              <span>{t('dashboard.viewDetails')}</span>
              <ArrowRight className="w-3.5 h-3.5 text-emerald-400" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

export function Dashboard(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [isSeeding, setIsSeeding] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);
  const [pumpModalField, setPumpModalField] = useState<Field | null>(null);

  const {
    data: fields,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['fields'],
    queryFn: api.getFields,
  });

  const handleLoadSampleFields = async () => {
    setIsSeeding(true);
    setSeedError(null);
    try {
      const now = new Date();
      const sowing1 = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000);
      const sowing2 = new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000);

      await api.createField({
        name: i18n.language === 'hi' ? 'करनाल गेहूं का खेत (उत्तर)' : 'Karnal Wheat Field (North)',
        cropKey: 'wheat',
        soilType: 'loam',
        method: 'drip',
        sowingDate: sowing1,
        baseline: { everyDays: 4, depthMm: 30 },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [76.985, 29.69],
              [76.988, 29.69],
              [76.988, 29.694],
              [76.985, 29.694],
              [76.985, 29.69],
            ],
          ],
        },
      });

      await api.createField({
        name: i18n.language === 'hi' ? 'लुधियाना मक्का का खेत (दक्षिण)' : 'Ludhiana Maize Field (South)',
        cropKey: 'maize',
        soilType: 'clay',
        method: 'sprinkler',
        sowingDate: sowing2,
        baseline: { everyDays: 3, depthMm: 25 },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [75.85, 30.9],
              [75.855, 30.9],
              [75.855, 30.905],
              [75.85, 30.905],
              [75.85, 30.9],
            ],
          ],
        },
      });

      await queryClient.invalidateQueries({ queryKey: ['fields'] });
      await refetch();
    } catch (err: unknown) {
      setSeedError(err instanceof Error ? err.message : 'Failed to load sample fields');
    } finally {
      setIsSeeding(false);
    }
  };

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Dashboard Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight">
            {t('dashboard.title')}
          </h1>
          <p className="text-sm sm:text-base text-slate-400 mt-1 max-w-xl">
            {t('dashboard.subtitle')}
          </p>
        </div>

        <Link
          to="/fields/new"
          className="min-h-[48px] px-5 py-3 rounded-2xl bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-slate-950 font-black text-base flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 transition-all cursor-pointer self-start sm:self-auto"
        >
          <PlusCircle className="w-5 h-5 stroke-[2.5]" />
          <span>{t('dashboard.addField')}</span>
        </Link>
      </div>

      {/* Loading Skeletons */}
      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4 animate-pulse"
            >
              <div className="h-8 bg-slate-800 rounded-lg w-1/2" />
              <div className="h-28 bg-slate-800/60 rounded-2xl w-full" />
              <div className="h-6 bg-slate-800/40 rounded-lg w-3/4" />
            </div>
          ))}
        </div>
      )}

      {/* Global Error Banner */}
      {isError && (
        <div className="bg-rose-950/60 border border-rose-800 rounded-2xl p-6 text-center space-y-3">
          <p className="text-rose-200 font-semibold">{t('common.error')}</p>
          <button
            type="button"
            onClick={() => refetch()}
            className="px-5 py-2.5 rounded-xl bg-rose-900 hover:bg-rose-800 text-white font-bold text-sm inline-flex items-center gap-2 cursor-pointer"
          >
            <RotateCw className="w-4 h-4" />
            <span>{t('common.retry')}</span>
          </button>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !isError && fields && fields.length === 0 && (
        <div className="bg-slate-900 border-2 border-dashed border-slate-800 rounded-3xl p-8 sm:p-14 text-center max-w-xl mx-auto space-y-5 my-8">
          <div className="w-20 h-20 rounded-3xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mx-auto shadow-inner">
            <Wheat className="w-10 h-10 stroke-[2]" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white tracking-tight">
              {t('dashboard.emptyTitle')}
            </h2>
            <p className="text-sm text-slate-400 mt-2 leading-relaxed">
              {t('dashboard.emptySubtitle')}
            </p>
          </div>
          {seedError && (
            <p className="text-xs text-rose-400 bg-rose-950/50 p-2.5 rounded-xl border border-rose-800">
              {seedError}
            </p>
          )}

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <Link
              to="/fields/new"
              className="w-full sm:w-auto inline-flex min-h-[50px] px-6 py-3 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-base shadow-lg shadow-emerald-500/20 items-center justify-center gap-2 active:scale-95 transition-all cursor-pointer"
            >
              <PlusCircle className="w-5 h-5 stroke-[2.5]" />
              <span>{t('dashboard.emptyButton')}</span>
            </Link>

            <button
              type="button"
              onClick={handleLoadSampleFields}
              disabled={isSeeding}
              className="w-full sm:w-auto inline-flex min-h-[50px] px-6 py-3 rounded-2xl border-2 border-emerald-500/50 bg-emerald-950/40 hover:bg-emerald-950 text-emerald-300 font-black text-sm items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-60"
            >
              {isSeeding ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Loading Sample Farm Data...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5 text-emerald-400" />
                  <span>{i18n.language === 'hi' ? 'नमूना खेत लोड करें' : '🌱 Load Sample Fields'}</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Fields List */}
      {!isLoading && !isError && fields && fields.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {fields.map((field) => (
            <FieldRecommendationCard
              key={field.id}
              field={field}
              onOpenPumpModal={(f) => setPumpModalField(f)}
            />
          ))}
        </div>
      )}

      {/* Pump Setup Modal */}
      <PumpModal
        isOpen={Boolean(pumpModalField)}
        onClose={() => setPumpModalField(null)}
        onSuccess={async (pump) => {
          if (pumpModalField) {
            try {
              await api.updateField(pumpModalField.id, {
                version: pumpModalField.version,
                pumpId: pump.id,
              });
              queryClient.invalidateQueries({ queryKey: ['fields'] });
              queryClient.invalidateQueries({ queryKey: ['recommendations', pumpModalField.id] });
            } catch (err) {
              console.error('Failed to link pump to field', err);
            }
          }
          setPumpModalField(null);
        }}
      />
    </div>
  );
}
