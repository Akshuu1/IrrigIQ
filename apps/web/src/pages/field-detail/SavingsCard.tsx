import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type SavingsData } from '../../api/client.js';
import { formatNumber } from '../../utils/formatters.js';
import { ReportModal } from '../../components/ReportModal.js';
import {
  TrendingUp,
  FileText,
  Info,
  Droplets,
  HelpCircle,
  AlertCircle,
  X,
} from 'lucide-react';

interface SavingsCardProps {
  savings?: SavingsData;
  isLoading: boolean;
  fieldId?: string;
  fieldName?: string;
}

export function SavingsCard({
  savings,
  isLoading,
  fieldId = '',
  fieldName = '',
}: SavingsCardProps): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language || 'en') as 'en' | 'hi';

  const [isTooltipOpen, setIsTooltipOpen] = useState(false);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="bg-slate-900 border-2 border-slate-800 rounded-3xl p-6 animate-pulse space-y-4">
        <div className="h-6 bg-slate-800 rounded-lg w-1/3" />
        <div className="grid grid-cols-2 gap-4">
          <div className="h-24 bg-slate-800/60 rounded-2xl" />
          <div className="h-24 bg-slate-800/60 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!savings) {
    return (
      <div className="bg-slate-900 border-2 border-slate-800 rounded-3xl p-6 text-center text-slate-400 text-sm">
        {t('common.loading')}
      </div>
    );
  }

  const totals = savings?.totals;
  const assumptions = savings?.assumptions;

  if (!totals || !assumptions) {
    return (
      <div className="bg-slate-900 border-2 border-slate-800 rounded-3xl p-6 text-center text-slate-400 text-sm">
        {t('common.loading')}
      </div>
    );
  }

  const potentialLitres = totals.potentialSaved?.litres ?? 0;
  const potentialPct = totals.potentialSaved?.pct ?? 0;
  const realisedLitres = totals.realisedSaved?.litres ?? 0;
  const realisedPct = totals.realisedSaved?.pct ?? 0;

  const isRealisedNegative = realisedLitres < 0;

  const handleCreateReportClick = () => {
    setIsReportModalOpen(true);
  };

  return (
    <div className="bg-slate-900 border-2 border-slate-800 rounded-3xl p-5 sm:p-7 shadow-xl space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl sm:text-2xl font-black text-white flex items-center gap-2.5">
              <TrendingUp className="w-5 h-5 text-emerald-400" />
              <span>{t('fieldDetail.savingsTitle')}</span>
            </h2>
            <button
              type="button"
              onClick={() => setIsTooltipOpen(true)}
              className="p-1 text-slate-400 hover:text-emerald-400 transition-colors"
              title="Assumptions info"
              aria-label="Assumptions info"
            >
              <HelpCircle className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">{t('fieldDetail.savingsSubtitle')}</p>
        </div>

        <button
          type="button"
          onClick={handleCreateReportClick}
          className="min-h-[44px] px-4 py-2 rounded-2xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-white font-bold text-xs sm:text-sm flex items-center gap-2 border border-slate-700 transition-all cursor-pointer self-start sm:self-auto shadow-md"
        >
          <FileText className="w-4 h-4 text-emerald-400" />
          <span>{t('fieldDetail.createReport')}</span>
        </button>
      </div>

      {/* Savings Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Potential Savings */}
        <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase font-extrabold text-slate-400 tracking-wider">
              {t('fieldDetail.potentialSaved')}
            </span>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              {potentialPct >= 0 ? `+${potentialPct}%` : `${potentialPct}%`}
            </span>
          </div>

          <div className="flex items-baseline gap-2">
            <span className="text-3xl sm:text-4xl font-black text-emerald-400">
              {formatNumber(Math.abs(Math.round(potentialLitres)), lang)}
            </span>
            <span className="text-sm font-semibold text-slate-400">{t('units.litres')}</span>
          </div>

          <p className="text-xs text-slate-500">
            Based on following scientific recommendations vs your stated routine.
          </p>
        </div>

        {/* Realised Savings */}
        <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase font-extrabold text-slate-400 tracking-wider">
              {t('fieldDetail.realisedSaved')}
            </span>
            <span
              className={`px-2.5 py-0.5 rounded-full text-xs font-black ${
                isRealisedNegative
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                  : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
              }`}
            >
              {realisedPct >= 0 ? `+${realisedPct}%` : `${realisedPct}%`}
            </span>
          </div>

          <div className="flex items-baseline gap-2">
            <span
              className={`text-3xl sm:text-4xl font-black ${
                isRealisedNegative ? 'text-rose-400' : 'text-emerald-400'
              }`}
            >
              {isRealisedNegative ? '-' : ''}
              {formatNumber(Math.abs(Math.round(realisedLitres)), lang)}
            </span>
            <span className="text-sm font-semibold text-slate-400">{t('units.litres')}</span>
          </div>

          <p className="text-xs text-slate-500">
            {isRealisedNegative
              ? 'Actual water applied exceeded your baseline routine.'
              : 'Actual water saved based on your recorded irrigation logs.'}
          </p>
        </div>
      </div>

      {/* Assumptions Footer Note */}
      <div className="text-xs text-slate-400 bg-slate-950/40 p-3.5 rounded-xl border border-slate-800 flex items-start gap-2.5">
        <Droplets className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
        <span>{t('fieldDetail.baselineFarmerNote')}</span>
      </div>

      {/* Assumptions Tooltip Modal */}
      {isTooltipOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4 animate-fade-in">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Info className="w-4 h-4 text-emerald-400" />
                <span>Savings Assumptions</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsTooltipOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="text-xs text-slate-300 space-y-2.5">
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-400">Application Method:</span>
                <span className="font-semibold text-white capitalize">{assumptions.method}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-400">Application Efficiency:</span>
                <span className="font-semibold text-white">
                  {(assumptions.efficiency * 100).toFixed(0)}%
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-400">Farmer Baseline Schedule:</span>
                <span className="font-semibold text-white">
                  {assumptions.baseline.depthMm} mm every {assumptions.baseline.everyDays} days
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-400">Calculated Days:</span>
                <span className="font-semibold text-white">{savings.days} days</span>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-slate-400 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <span>{assumptions.baselineNote}</span>
            </div>

            <button
              type="button"
              onClick={() => setIsTooltipOpen(false)}
              className="w-full min-h-[44px] rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm cursor-pointer"
            >
              {t('common.close')}
            </button>
          </div>
        </div>
      )}

      {/* Phase 12 Report Modal */}
      <ReportModal
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        fieldId={fieldId}
        fieldName={fieldName}
      />
    </div>
  );
}

