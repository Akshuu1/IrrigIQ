import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type Field, type Recommendation } from '../../api/client.js';
import { formatNumber, formatDepthMm } from '../../utils/formatters.js';
import { formatDuration, formatTimeRange } from '@irrigiq/shared';
import {
  Clock,
  Sun,
  AlertTriangle,
  PlusCircle,
  Sparkles,
  CloudRain,
  Gauge,
  ZapOff,
  Wind,
} from 'lucide-react';

interface TodayAdvisoryCardProps {
  field: Field;
  todayRecommendation?: Recommendation;
  onOpenLogModal: () => void;
  onOpenPumpModal?: () => void;
  onRescheduled?: () => void;
}

export function TodayAdvisoryCard({
  field,
  todayRecommendation,
  onOpenLogModal,
  onOpenPumpModal,
  onRescheduled,
}: TodayAdvisoryCardProps): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language || 'en') as 'en' | 'hi';

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
      onRescheduled?.();
    } catch (err) {
      console.error('Failed to report no power:', err);
    } finally {
      setIsReportingNoPower(false);
    }
  };

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
          actionSentence = t('fieldDetail.runPumpWithWindow', {
            duration: durationFormatted,
            window: windowRange,
            defaultValue: `Run the pump ${durationFormatted}, ${windowRange}`,
          });
        } else {
          actionSentence = t('fieldDetail.runPumpSentence', {
            duration: durationFormatted,
            defaultValue: `Run the pump ${durationFormatted} tonight`,
          });
        }
        detailSentence = `${litresFormatted} L (${depthFormatted})`;
      } else {
        actionSentence =
          lang === 'hi'
            ? `आज ${depthFormatted} (लगभग ${litresFormatted} लीटर) सिंचाई करें`
            : `Irrigate ${depthFormatted} (about ${litresFormatted} litres) today`;
        detailSentence = `${litresFormatted} L (${depthFormatted})`;
      }
    } else {
      actionSentence = lang === 'hi' ? 'आज सिंचाई छोड़ें' : 'Skip irrigation today';
    }
  } else {
    actionSentence = t('common.loading');
  }

  let reasonText = '';
  if (todayRecommendation?.plan?.reasonKey) {
    const key = todayRecommendation.plan.reasonKey.replace('reason.', '');
    const params = todayRecommendation.plan.reasonParams || {};
    reasonText = t(`reasons.${key}`, {
      ...params,
      defaultValue: t('reasons.not_needed'),
    });
  }

  return (
    <div
      className={`rounded-3xl p-6 sm:p-8 border-2 shadow-2xl transition-all ${
        isIrrigate
          ? 'bg-emerald-950/60 border-emerald-500 shadow-emerald-950/50 text-white'
          : 'bg-slate-900 border-slate-700 text-white'
      }`}
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/10 pb-5">
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center">
            <Sun className="w-5 h-5 text-amber-300" />
          </span>
          <div>
            <span className="text-xs uppercase tracking-wider font-extrabold text-slate-300">
              {t('dashboard.todayAdvice')}
            </span>
            <div className="text-xs text-emerald-300 font-semibold flex items-center gap-1.5 mt-0.5">
              <Clock className="w-3.5 h-3.5" />
              <span>{t('fieldDetail.todayBestTime')}</span>
            </div>
          </div>
        </div>

        {/* 'I Irrigated' Action Button */}
        <button
          type="button"
          onClick={onOpenLogModal}
          className="min-h-[48px] px-5 py-2.5 rounded-2xl bg-white hover:bg-slate-100 active:scale-95 text-slate-950 font-black text-sm flex items-center justify-center gap-2 shadow-lg transition-all cursor-pointer self-start md:self-auto"
        >
          <PlusCircle className="w-4 h-4 text-emerald-600 stroke-[3]" />
          <span>{t('fieldDetail.iIrrigatedButton')}</span>
        </button>
      </div>

      <div className="pt-6 space-y-4">
        {/* Big Action Sentence */}
        <div>
          <div className="text-2xl sm:text-4xl font-black tracking-tight leading-tight">
            {actionSentence}
          </div>
          {isIrrigate && detailSentence && (
            <div className="text-sm sm:text-base font-semibold text-emerald-200/90 mt-1.5 flex items-center gap-2">
              <span>{detailSentence}</span>
              {pumpCostVal !== null && pumpCostVal !== undefined && (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  {t('fieldDetail.pumpCostEstimate', { cost: pumpCostVal })}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Multi-day split alert */}
        {isIrrigate && splitAcrossDays && (
          <div className="p-3.5 rounded-2xl bg-amber-500/20 border border-amber-500/40 text-amber-200 text-xs sm:text-sm font-medium flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <span>{t('fieldDetail.splitAlert')}</span>
          </div>
        )}

        {/* Pump Missing Advisory Banner */}
        {isIrrigate && isPumpMissing && (
          <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-700/80 text-slate-300 text-xs sm:text-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Gauge className="w-5 h-5 text-emerald-400 flex-shrink-0" />
              <span>{t('fieldDetail.pumpMissingPrompt')}</span>
            </div>
            {onOpenPumpModal && (
              <button
                type="button"
                onClick={onOpenPumpModal}
                className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-md transition-all self-start sm:self-auto cursor-pointer"
              >
                <PlusCircle className="w-4 h-4 stroke-[2.5]" />
                <span>{t('fieldDetail.addPump')}</span>
              </button>
            )}
          </div>
        )}

        {/* Scientific Reason */}
        {reasonText && (
          <div className="text-sm sm:text-base text-slate-200 font-medium flex items-start gap-2.5 pt-2">
            <Sparkles className="w-4 h-4 text-amber-300 flex-shrink-0 mt-1" />
            <span>{reasonText}</span>
          </div>
        )}

        {/* High Wind Alert for Sprinklers */}
        {todayRecommendation?.plan?.notes?.includes('plan.windy') && (
          <div className="p-3.5 rounded-2xl bg-sky-950/70 border border-sky-600/80 text-sky-200 text-xs sm:text-sm font-medium flex items-center gap-2.5">
            <Wind className="w-4 h-4 text-sky-400 flex-shrink-0" />
            <span>{t('dashboard.planWindyWarning')}</span>
          </div>
        )}

        {/* Missing Power Window Alert */}
        {Boolean(todayRecommendation?.plan?.missingMinutes && todayRecommendation.plan.missingMinutes > 0) && (
          <div className="p-3.5 rounded-2xl bg-amber-950/70 border border-amber-600/80 text-amber-200 text-xs sm:text-sm font-medium flex items-center gap-2.5">
            <ZapOff className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <span>
              {t('dashboard.missingPowerWarning', {
                missing: todayRecommendation?.plan?.missingMinutes,
              })}
            </span>
          </div>
        )}

        {/* Power Outage Alert */}
        {todayRecommendation?.plan?.notes?.includes('plan.no_power') && (
          <div className="p-3.5 rounded-2xl bg-rose-950/70 border border-rose-600/80 text-rose-200 text-xs sm:text-sm font-medium flex items-center gap-2.5">
            <ZapOff className="w-4 h-4 text-rose-400 flex-shrink-0" />
            <span>{t('dashboard.noPowerReportedAlert')}</span>
          </div>
        )}

        {/* No Power Action Button */}
        {isIrrigate && (
          <div className="flex items-center justify-end pt-1">
            <button
              type="button"
              disabled={isReportingNoPower}
              onClick={handleReportNoPower}
              className="px-4 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
            >
              <ZapOff className="w-3.5 h-3.5" />
              <span>
                {isReportingNoPower ? t('dashboard.rescheduling') : t('dashboard.noPowerButton')}
              </span>
            </button>
          </div>
        )}

        {/* Stale Weather Warning */}
        {weatherStale && (
          <div
            className="p-3.5 rounded-xl bg-amber-950/80 border border-amber-600/80 text-amber-200 text-xs sm:text-sm flex items-start gap-2.5 font-medium mt-3"
            role="alert"
          >
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <span>{t('dashboard.weatherStaleWarning')}</span>
          </div>
        )}

        {/* Weather Metrics */}
        {todayRecommendation && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-3 text-xs">
            <div className="bg-black/30 border border-white/10 rounded-xl p-3 text-center">
              <span className="text-slate-400 block mb-0.5">Reference ET₀</span>
              <span className="font-bold text-white text-base">
                {todayRecommendation.dailyNeeds.et0Mm} mm
              </span>
            </div>
            <div className="bg-black/30 border border-white/10 rounded-xl p-3 text-center">
              <span className="text-slate-400 block mb-0.5">Forecast Rain</span>
              <span className="font-bold text-white text-base flex items-center justify-center gap-1">
                <CloudRain className="w-4 h-4 text-sky-400" />
                <span>{todayRecommendation.dailyNeeds.rainMm} mm</span>
              </span>
            </div>
            <div className="col-span-2 sm:col-span-1 bg-black/30 border border-white/10 rounded-xl p-3 text-center">
              <span className="text-slate-400 block mb-0.5">Crop Need (ETc)</span>
              <span className="font-bold text-white text-base">
                {todayRecommendation.dailyNeeds.etcMm} mm
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

