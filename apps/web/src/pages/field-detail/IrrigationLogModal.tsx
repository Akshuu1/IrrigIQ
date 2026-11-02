import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { mmToLitres } from '@irrigiq/shared';
import { type Field, type Recommendation } from '../../api/client.js';
import { formatNumber } from '../../utils/formatters.js';
import { Droplet, X, Loader2, Check } from 'lucide-react';

interface IrrigationLogModalProps {
  field: Field;
  todayRecommendation?: Recommendation;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: {
    date: string;
    appliedMm: number;
    source: 'recommended' | 'manual';
    note?: string;
  }) => Promise<void>;
  isSubmitting: boolean;
}

export function IrrigationLogModal({
  field,
  todayRecommendation,
  isOpen,
  onClose,
  onSubmit,
  isSubmitting,
}: IrrigationLogModalProps): React.JSX.Element | null {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language || 'en') as 'en' | 'hi';

  const defaultDepth = todayRecommendation?.plan?.grossMm || 25;
  const [appliedMm, setAppliedMm] = useState<number>(defaultDepth);
  const [date, setDate] = useState<string>(() => new Date().toISOString().split('T')[0] || '');
  const [source, setSource] = useState<'recommended' | 'manual'>('recommended');
  const [note, setNote] = useState<string>('');

  if (!isOpen) return null;

  const estimatedLitres = mmToLitres(appliedMm, field.areaHa);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (appliedMm <= 0) return;

    await onSubmit({
      date,
      appliedMm: Number(appliedMm),
      source,
      note: note.trim() || undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-7 shadow-2xl space-y-5 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <Droplet className="w-5 h-5 fill-emerald-400" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">{t('fieldDetail.logModalTitle')}</h3>
              <p className="text-xs text-slate-400">{t('fieldDetail.logModalSubtitle')}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Water Depth (mm) */}
          <div>
            <label htmlFor="log-depth" className="block text-sm font-semibold text-slate-200 mb-1">
              {t('fieldDetail.appliedDepthMm')} *
            </label>
            <input
              id="log-depth"
              type="number"
              step="0.5"
              min="1"
              max="300"
              required
              value={appliedMm}
              onChange={(e) => {
                const val = Number(e.target.value);
                setAppliedMm(val);
                if (val !== defaultDepth) {
                  setSource('manual');
                }
              }}
              className="w-full min-h-[48px] bg-slate-950 border border-slate-700 focus:border-emerald-400 rounded-xl px-4 py-3 text-base text-white focus:outline-none"
            />
            <p className="text-xs text-slate-400 mt-1">{t('fieldDetail.appliedDepthMmHelp')}</p>
          </div>

          {/* Live Volume Readout */}
          <div className="bg-emerald-950/40 border border-emerald-800/40 rounded-xl p-3 flex items-center justify-between">
            <span className="text-xs text-emerald-300 font-semibold">
              {t('fieldDetail.appliedLitres')}:
            </span>
            <span className="text-lg font-black text-emerald-400">
              {formatNumber(Math.round(estimatedLitres), lang)} {t('units.litres')}
            </span>
          </div>

          {/* Date */}
          <div>
            <label htmlFor="log-date" className="block text-sm font-semibold text-slate-200 mb-1">
              {t('fieldDetail.logDate')} *
            </label>
            <input
              id="log-date"
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full min-h-[48px] bg-slate-950 border border-slate-700 focus:border-emerald-400 rounded-xl px-4 py-3 text-sm text-white focus:outline-none"
            />
          </div>

          {/* Source Selection */}
          <div>
            <label htmlFor="log-source" className="block text-sm font-semibold text-slate-200 mb-1">
              {t('fieldDetail.logSource')}
            </label>
            <select
              id="log-source"
              value={source}
              onChange={(e) => setSource(e.target.value as 'recommended' | 'manual')}
              className="w-full min-h-[48px] bg-slate-950 border border-slate-700 focus:border-emerald-400 rounded-xl px-3 py-2 text-sm text-white focus:outline-none"
            >
              <option value="recommended">{t('fieldDetail.sourceRecommended')}</option>
              <option value="manual">{t('fieldDetail.sourceManual')}</option>
            </select>
          </div>

          {/* Note */}
          <div>
            <label htmlFor="log-note" className="block text-sm font-semibold text-slate-200 mb-1">
              {t('fieldDetail.logNote')}
            </label>
            <input
              id="log-note"
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('fieldDetail.logNotePlaceholder')}
              className="w-full min-h-[48px] bg-slate-950 border border-slate-700 focus:border-emerald-400 rounded-xl px-4 py-3 text-sm text-white focus:outline-none"
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full min-h-[50px] mt-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:scale-[0.98] disabled:opacity-60 text-slate-950 font-black text-base shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>{t('fieldDetail.loggingIrrigation')}</span>
              </>
            ) : (
              <>
                <Check className="w-5 h-5 stroke-[2.5]" />
                <span>{t('fieldDetail.iIrrigatedButton')}</span>
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
