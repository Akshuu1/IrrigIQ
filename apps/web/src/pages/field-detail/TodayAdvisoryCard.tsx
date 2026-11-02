import React from 'react';
import { useTranslation } from 'react-i18next';
import { type Field, type Recommendation } from '../../api/client.js';
import { formatNumber, formatDepthMm } from '../../utils/formatters.js';
import {
  Droplet,
  Clock,
  Sun,
  AlertTriangle,
  PlusCircle,
  Sparkles,
  CloudRain,
} from 'lucide-react';

interface TodayAdvisoryCardProps {
  field: Field;
  todayRecommendation?: Recommendation;
  onOpenLogModal: () => void;
}

export function TodayAdvisoryCard({
  field: _field,
  todayRecommendation,
  onOpenLogModal,
}: TodayAdvisoryCardProps): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language || 'en') as 'en' | 'hi';

  const isIrrigate = todayRecommendation?.plan?.action === 'irrigate';
  const weatherStale = todayRecommendation?.weatherStale ?? false;

  let actionSentence = '';
  if (todayRecommendation) {
    if (isIrrigate) {
      const depthFormatted = formatDepthMm(todayRecommendation.plan.grossMm, lang);
      const litresFormatted = formatNumber(Math.round(todayRecommendation.plan.litres), lang);
      actionSentence =
        lang === 'hi'
          ? `आज ${depthFormatted} (लगभग ${litresFormatted} लीटर) सिंचाई करें`
          : `Irrigate ${depthFormatted} (about ${litresFormatted} litres) today`;
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
        <div className="text-2xl sm:text-4xl font-black tracking-tight leading-tight">
          {actionSentence}
        </div>

        {/* Litres Volume Pill (if irrigate) */}
        {isIrrigate && todayRecommendation && (
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-emerald-500 text-slate-950 font-black text-base shadow-md">
            <Droplet className="w-5 h-5 fill-slate-950" />
            <span>
              {formatNumber(Math.round(todayRecommendation.plan.litres), lang)} {t('units.litres')}
            </span>
          </div>
        )}

        {/* Scientific Reason */}
        {reasonText && (
          <div className="text-sm sm:text-base text-slate-200 font-medium flex items-start gap-2.5 pt-2">
            <Sparkles className="w-4 h-4 text-amber-300 flex-shrink-0 mt-1" />
            <span>{reasonText}</span>
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

