import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { bucketTestToLph, PUMP_CONFIG } from '@irrigiq/shared';
import { api, type Pump } from '../api/client.js';
import { X, Gauge, HelpCircle, Check, AlertCircle } from 'lucide-react';

interface PumpModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (pump: Pump) => void;
}

export function PumpModal({ isOpen, onClose, onSuccess }: PumpModalProps): React.JSX.Element | null {
  const { t } = useTranslation();

  const [mode, setMode] = useState<'bucket' | 'direct'>('bucket');
  const [name, setName] = useState('');
  const [bucketLitres, setBucketLitres] = useState<number>(20);
  const [seconds, setSeconds] = useState<number>(4);
  const [directLph, setDirectLph] = useState<number>(18000);
  const [costPerHour, setCostPerHour] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  // Compute flow from bucket test live
  let calculatedLph: number | null = null;
  let calculationError: string | null = null;
  if (mode === 'bucket') {
    try {
      if (bucketLitres > 0 && seconds > 0) {
        calculatedLph = bucketTestToLph(bucketLitres, seconds);
      }
    } catch (err: unknown) {
      calculationError = err instanceof Error ? err.message : 'Invalid values';
    }
  }

  const effectiveLph = mode === 'bucket' ? calculatedLph : directLph;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Please provide a pump name (e.g. "Main Tubewell")');
      return;
    }

    if (!effectiveLph || effectiveLph < PUMP_CONFIG.minDischargeLph.value || effectiveLph > PUMP_CONFIG.maxDischargeLph.value) {
      setError(
        calculationError ||
          `Discharge rate must be between ${PUMP_CONFIG.minDischargeLph.value} and ${PUMP_CONFIG.maxDischargeLph.value} L/h`,
      );
      return;
    }

    const parsedCost = costPerHour.trim() ? Number(costPerHour) : null;
    if (parsedCost !== null && (isNaN(parsedCost) || parsedCost < 0)) {
      setError('Cost per hour must be a positive number');
      return;
    }

    setIsSubmitting(true);
    try {
      const created = await api.createPump({
        name: name.trim(),
        dischargeLph: effectiveLph,
        costPerHour: parsedCost,
      });
      onSuccess(created);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save pump');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pump-modal-title"
    >
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-6 shadow-2xl relative text-white space-y-5 animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <Gauge className="w-5 h-5 text-emerald-400" />
            </span>
            <div>
              <h2 id="pump-modal-title" className="text-xl font-bold tracking-tight">
                {t('pumps.modalTitle')}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">{t('pumps.modalSubtitle')}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="p-3.5 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-200 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Pump Name */}
          <div>
            <label htmlFor="pump-name" className="block text-xs font-semibold text-slate-300 mb-1">
              {t('pumps.nameLabel')} *
            </label>
            <input
              id="pump-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('pumps.namePlaceholder')}
              className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-400 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none"
            />
          </div>

          {/* Flow Measurement Method Toggle */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-300">
              Flow Rate Determination
            </label>
            <div className="grid grid-cols-2 gap-2 bg-slate-950 p-1 rounded-2xl border border-slate-800">
              <button
                type="button"
                onClick={() => setMode('bucket')}
                className={`py-2 px-3 rounded-xl text-xs font-bold transition-all ${
                  mode === 'bucket'
                    ? 'bg-emerald-500 text-slate-950 shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {t('pumps.methodBucket')}
              </button>
              <button
                type="button"
                onClick={() => setMode('direct')}
                className={`py-2 px-3 rounded-xl text-xs font-bold transition-all ${
                  mode === 'direct'
                    ? 'bg-emerald-500 text-slate-950 shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {t('pumps.methodDirect')}
              </button>
            </div>
          </div>

          {/* Mode 1: Bucket Test Helper */}
          {mode === 'bucket' && (
            <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs text-emerald-400 font-medium">
                <HelpCircle className="w-3.5 h-3.5" />
                <span>Fill a container from your outlet and count the seconds</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="bucket-litres" className="block text-xs text-slate-400 mb-1">
                    {t('pumps.bucketLitres')}
                  </label>
                  <input
                    id="bucket-litres"
                    type="number"
                    min="1"
                    max="1000"
                    value={bucketLitres}
                    onChange={(e) => setBucketLitres(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="bucket-seconds" className="block text-xs text-slate-400 mb-1">
                    {t('pumps.bucketSeconds')}
                  </label>
                  <input
                    id="bucket-seconds"
                    type="number"
                    min="0.1"
                    step="0.1"
                    max="600"
                    value={seconds}
                    onChange={(e) => setSeconds(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
                  />
                </div>
              </div>

              {calculatedLph !== null && !calculationError && (
                <div className="flex items-center justify-between p-3 rounded-xl bg-emerald-950/50 border border-emerald-500/40 text-emerald-300 text-xs font-semibold">
                  <span>{t('pumps.calculatedDischarge', { lph: calculatedLph.toLocaleString() })}</span>
                  <Check className="w-4 h-4 text-emerald-400" />
                </div>
              )}
              {calculationError && (
                <div className="text-xs text-rose-400 font-medium">{calculationError}</div>
              )}
            </div>
          )}

          {/* Mode 2: Direct Input */}
          {mode === 'direct' && (
            <div>
              <label htmlFor="direct-lph" className="block text-xs font-semibold text-slate-300 mb-1">
                {t('pumps.dischargeLabel')} *
              </label>
              <input
                id="direct-lph"
                type="number"
                min={PUMP_CONFIG.minDischargeLph.value}
                max={PUMP_CONFIG.maxDischargeLph.value}
                value={directLph}
                onChange={(e) => setDirectLph(Number(e.target.value))}
                placeholder={t('pumps.dischargePlaceholder')}
                className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-400 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none"
              />
              <p className="text-[11px] text-slate-500 mt-1">{t('pumps.dischargeHelp')}</p>
            </div>
          )}

          {/* Optional Cost per Hour */}
          <div>
            <label htmlFor="cost-per-hour" className="block text-xs font-semibold text-slate-300 mb-1">
              {t('pumps.costPerHourLabel')}
            </label>
            <input
              id="cost-per-hour"
              type="number"
              min="0"
              step="1"
              value={costPerHour}
              onChange={(e) => setCostPerHour(e.target.value)}
              placeholder={t('pumps.costPerHourPlaceholder')}
              className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-400 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-semibold transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || (mode === 'bucket' && Boolean(calculationError))}
              className="min-h-[44px] px-6 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold text-sm flex items-center gap-2 shadow-lg transition-all"
            >
              <span>{isSubmitting ? t('pumps.saving') : t('pumps.save')}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
