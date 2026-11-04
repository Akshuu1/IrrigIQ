import React from 'react';
import { useTranslation } from 'react-i18next';
import { type Field, type Recommendation } from '../../api/client.js';
import { formatNumber } from '../../utils/formatters.js';
import {
  CloudRain,
  Sun,
  AlertTriangle,
  Droplets,
  ShieldAlert,
  Sprout,
  HelpCircle,
  FileText,
} from 'lucide-react';

interface RainfedAdvisoryCardProps {
  field: Field;
  todayRecommendation?: Recommendation;
}

export function RainfedAdvisoryCard({
  field,
  todayRecommendation,
}: RainfedAdvisoryCardProps): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language || 'en') as 'en' | 'hi';

  const plan = todayRecommendation?.rainfedPlan;
  const statusKey = plan?.statusKey || todayRecommendation?.plan?.reasonKey || 'rainfed.ok';
  const statusSubKey = statusKey.replace(/^rainfed\./, '');

  const params = (plan?.params || {}) as Record<string, unknown>;
  const rainLast7Days = typeof params['rainLast7Days'] === 'number' ? params['rainLast7Days'] : 0;
  const drySpellDays = typeof params['drySpellDays'] === 'number' ? params['drySpellDays'] : 0;
  const bucketPercent =
    typeof params['bucketPercent'] === 'number'
      ? Math.min(100, Math.max(0, params['bucketPercent']))
      : 0;
  const adviceList = plan?.advice || todayRecommendation?.plan?.notes || [];

  // Theme based on status
  let bgClass = 'bg-blue-50 border-blue-200 text-blue-900';
  let badgeClass = 'bg-blue-100 text-blue-800 border-blue-300';
  let Icon = Droplets;

  if (statusSubKey === 'good_to_sow' || statusSubKey === 'ok') {
    bgClass = 'bg-emerald-50 border-emerald-200 text-emerald-950';
    badgeClass = 'bg-emerald-100 text-emerald-800 border-emerald-300';
    Icon = Sprout;
  } else if (statusSubKey === 'wait_to_sow' || statusSubKey === 'watch_dry') {
    bgClass = 'bg-amber-50 border-amber-200 text-amber-950';
    badgeClass = 'bg-amber-100 text-amber-800 border-amber-300';
    Icon = Sun;
  } else if (statusSubKey === 'stress_risk' || statusSubKey === 'outside_window') {
    bgClass = 'bg-rose-50 border-rose-200 text-rose-950';
    badgeClass = 'bg-rose-100 text-rose-800 border-rose-300';
    Icon = AlertTriangle;
  } else if (statusSubKey === 'no_calendar') {
    bgClass = 'bg-slate-50 border-slate-200 text-slate-800';
    badgeClass = 'bg-slate-100 text-slate-700 border-slate-300';
    Icon = HelpCircle;
  }

  const statusText = t(`rainfed.status.${statusSubKey}`, {
    defaultValue: statusSubKey.replace(/_/g, ' '),
  });

  return (
    <div
      data-testid="rainfed-card"
      className={`rounded-2xl border p-6 shadow-sm transition-all ${bgClass}`}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/5 pb-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-white p-2.5 shadow-xs">
            <Icon className="h-6 w-6 text-emerald-600" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
                {t('rainfed.title', 'Rain-fed Crop Advisory')}
              </span>
              {field.hasProtectiveWater && (
                <span className="inline-flex items-center gap-1 rounded-full bg-cyan-100 px-2 py-0.5 text-xs font-medium text-cyan-800">
                  <Droplets className="h-3 w-3" />
                  {t('rainfed.protectiveWaterLabel', 'Protective Water Available')}
                </span>
              )}
            </div>
            <h3 className="text-xl font-bold tracking-tight text-slate-900">
              {statusText}
            </h3>
          </div>
        </div>

        <span
          className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-semibold shadow-xs ${badgeClass}`}
        >
          {statusText}
        </span>
      </div>

      {/* Metrics Row */}
      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* Last 7 Days Rain */}
        <div className="rounded-xl bg-white/80 p-4 shadow-xs backdrop-blur-xs">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
            <CloudRain className="h-4 w-4 text-blue-500" />
            <span>{t('rainfed.metrics.rainLast7Days', 'Last 7 Days Rain')}</span>
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900">
            {formatNumber(rainLast7Days, lang)} <span className="text-sm font-normal text-slate-500">mm</span>
          </div>
        </div>

        {/* Available Soil Moisture (Bucket %) */}
        <div className="rounded-xl bg-white/80 p-4 shadow-xs backdrop-blur-xs">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
            <Droplets className="h-4 w-4 text-emerald-500" />
            <span>{t('rainfed.metrics.bucketPercent', 'Available Soil Moisture')}</span>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <div className="text-2xl font-bold text-slate-900">
              {bucketPercent}%
            </div>
            <span className="text-xs text-slate-500">of TAW</span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200">
            <div
              className={`h-full transition-all ${
                bucketPercent < 30
                  ? 'bg-rose-500'
                  : bucketPercent < 50
                    ? 'bg-amber-500'
                    : 'bg-emerald-500'
              }`}
              style={{ width: `${bucketPercent}%` }}
            />
          </div>
        </div>

        {/* 7-Day Dry Spell Bar */}
        <div className="rounded-xl bg-white/80 p-4 shadow-xs backdrop-blur-xs">
          <div className="flex items-center justify-between text-xs font-medium text-slate-600">
            <div className="flex items-center gap-2">
              <Sun className="h-4 w-4 text-amber-500" />
              <span>{t('rainfed.metrics.drySpellBar', '7-Day Dry Spell Bar')}</span>
            </div>
            <span className="font-semibold text-slate-700">
              {drySpellDays} {t('rainfed.metrics.of7Days', '/ 7 days dry')}
            </span>
          </div>
          <div className="mt-3 flex gap-1.5" data-testid="dry-spell-bar">
            {Array.from({ length: 7 }).map((_, idx) => {
              const isDry = idx < drySpellDays;
              const isAlert = isDry && idx >= 6;
              const isWarning = isDry && idx >= 4;
              return (
                <div
                  key={idx}
                  title={`Day ${idx + 1}: ${isDry ? 'Dry' : 'Rain forecasted'}`}
                  className={`h-4 flex-1 rounded-sm transition-all ${
                    isAlert
                      ? 'bg-rose-500'
                      : isWarning
                        ? 'bg-amber-400'
                        : isDry
                          ? 'bg-amber-200'
                          : 'bg-blue-300'
                  }`}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* Advisory Bullet Points */}
      {adviceList.length > 0 && (
        <div className="mt-5 rounded-xl bg-white/90 p-4 shadow-xs backdrop-blur-xs">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <FileText className="h-4 w-4 text-emerald-600" />
            <span>Recommended Agronomic Actions</span>
          </h4>
          <ul className="mt-3 space-y-2 text-sm text-slate-700">
            {adviceList.map((itemKey, idx) => {
              const translated = t(itemKey, {
                defaultValue: t(`rainfed.advice.${itemKey.replace(/^rainfed\.advice\./, '')}`, {
                  defaultValue: itemKey,
                }),
              });
              return (
                <li key={idx} className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                  <span>{translated}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Agronomist Disclaimer Flag */}
      <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-200/80 bg-amber-100/40 p-3 text-xs text-amber-900">
        <ShieldAlert className="h-4 w-4 shrink-0 text-amber-700" />
        <p className="leading-relaxed">
          {t(
            'rainfed.advice.agronomist_disclaimer',
            '⚠️ Advisory generated based on ICAR-CRIDA dryland guidelines. Text and thresholds flagged for agronomic review by local Krishi Vigyan Kendra (KVK).',
          )}
        </p>
      </div>
    </div>
  );
}
