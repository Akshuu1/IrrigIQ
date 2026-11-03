import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client.js';
import { FileText, Download, ExternalLink, X, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

interface ReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  fieldId: string;
  fieldName: string;
}

export function ReportModal({
  isOpen,
  onClose,
  fieldId,
  fieldName,
}: ReportModalProps): React.JSX.Element | null {
  const { t, i18n } = useTranslation();
  const currentLang = (i18n.language === 'hi' ? 'hi' : 'en') as 'en' | 'hi';

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [language, setLanguage] = useState<'en' | 'hi'>(currentLang);
  const [status, setStatus] = useState<'idle' | 'generating' | 'polling' | 'completed' | 'failed'>('idle');
  const [reportId, setReportId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const today = new Date();
      const d7Ago = new Date();
      d7Ago.setDate(today.getDate() - 7);
      const d6Ahead = new Date();
      d6Ahead.setDate(today.getDate() + 6);

      setFrom(d7Ago.toISOString().split('T')[0]!);
      setTo(d6Ahead.toISOString().split('T')[0]!);
      setLanguage(currentLang);
      setStatus('idle');
      setReportId(null);
      setErrorMsg(null);
    }
  }, [isOpen, currentLang]);

  if (!isOpen) return null;

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('generating');
    setErrorMsg(null);

    try {
      const res = await api.createReport(fieldId, { from, to, language });
      setReportId(res.id);

      if (res.status === 'completed') {
        setStatus('completed');
        return;
      }

      // If processing in BullMQ background job, poll every 1s
      setStatus('polling');
      const repId = res.id;
      let attempts = 0;
      const interval = setInterval(async () => {
        attempts++;
        try {
          const check = await api.getReport(repId);
          if (check.status === 'completed') {
            clearInterval(interval);
            setStatus('completed');
          } else if (check.status === 'failed') {
            clearInterval(interval);
            setStatus('failed');
            setErrorMsg(check.error || t('report.failed'));
          } else if (attempts > 30) {
            clearInterval(interval);
            setStatus('failed');
            setErrorMsg('Report generation timed out. Please try again.');
          }
        } catch (err: unknown) {
          clearInterval(interval);
          setStatus('failed');
          setErrorMsg(err instanceof Error ? err.message : t('report.failed'));
        }
      }, 1000);
    } catch (err: unknown) {
      setStatus('failed');
      setErrorMsg(err instanceof Error ? err.message : t('report.failed'));
    }
  };

  const handleDownloadPdf = async () => {
    if (!reportId) return;
    setIsDownloading(true);
    try {
      const blob = await api.getReportPdfBlob(reportId);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `irrigiq-report-${from}-to-${to}-${language}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch {
      // Fallback: direct window open with query token
      window.open(api.getReportPdfUrl(reportId), '_blank');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleOpenPdf = () => {
    if (!reportId) return;
    window.open(api.getReportPdfUrl(reportId), '_blank');
  };

  const isWorking = status === 'generating' || status === 'polling';

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="bg-slate-900 border-2 border-slate-800 rounded-3xl w-full max-w-lg p-6 sm:p-7 shadow-2xl relative text-white space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-800/80 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg sm:text-xl font-black text-white">{t('report.modalTitle')}</h3>
              <p className="text-xs text-slate-400 mt-0.5">{fieldName}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isWorking}
            className="p-1.5 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label={t('report.close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-xs sm:text-sm text-slate-300">{t('report.subtitle')}</p>

        {/* Form */}
        <form onSubmit={handleGenerate} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="report-from" className="block text-xs font-bold text-slate-300 mb-1.5">
                {t('report.from')}
              </label>
              <input
                id="report-from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                disabled={isWorking || status === 'completed'}
                required
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
              />
            </div>
            <div>
              <label htmlFor="report-to" className="block text-xs font-bold text-slate-300 mb-1.5">
                {t('report.to')}
              </label>
              <input
                id="report-to"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                disabled={isWorking || status === 'completed'}
                required
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
              />
            </div>
          </div>

          <div>
            <label htmlFor="report-language" className="block text-xs font-bold text-slate-300 mb-1.5">
              {t('report.language')}
            </label>
            <select
              id="report-language"
              value={language}
              onChange={(e) => setLanguage(e.target.value as 'en' | 'hi')}
              disabled={isWorking || status === 'completed'}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
            >
              <option value="en">{t('report.langEn')}</option>
              <option value="hi">{t('report.langHi')}</option>
            </select>
          </div>

          {/* Status Indicators */}
          {status === 'generating' && (
            <div className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-800/80 border border-slate-700 text-xs text-emerald-400">
              <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
              <span>{t('report.generating')}</span>
            </div>
          )}

          {status === 'polling' && (
            <div className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-800/80 border border-slate-700 text-xs text-amber-400">
              <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
              <span>{t('report.polling')}</span>
            </div>
          )}

          {status === 'completed' && (
            <div className="flex items-center gap-2.5 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-400">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{t('report.ready')}</span>
            </div>
          )}

          {status === 'failed' && (
            <div className="flex items-center gap-2.5 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-400">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{errorMsg || t('report.failed')}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row items-center gap-3 pt-3 border-t border-slate-800/80">
            {status !== 'completed' ? (
              <button
                type="submit"
                disabled={isWorking}
                className="w-full sm:flex-1 min-h-[46px] rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-bold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 shadow-lg shadow-emerald-900/40"
              >
                {isWorking ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{status === 'generating' ? t('report.generating') : t('report.polling')}</span>
                  </>
                ) : (
                  <>
                    <FileText className="w-4 h-4" />
                    <span>{t('report.generateBtn')}</span>
                  </>
                )}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleDownloadPdf}
                  disabled={isDownloading}
                  className="w-full sm:flex-1 min-h-[46px] rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-bold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg shadow-emerald-900/40"
                >
                  {isDownloading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  <span>{t('report.downloadBtn')}</span>
                </button>
                <button
                  type="button"
                  onClick={handleOpenPdf}
                  className="w-full sm:w-auto min-h-[46px] px-4 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-white font-bold text-sm flex items-center justify-center gap-2 border border-slate-700 transition-all cursor-pointer"
                >
                  <ExternalLink className="w-4 h-4 text-slate-400" />
                  <span>{t('report.openBtn')}</span>
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              disabled={isWorking}
              className="w-full sm:w-auto min-h-[46px] px-4 rounded-xl bg-slate-800/60 hover:bg-slate-800 text-slate-400 hover:text-white font-bold text-sm flex items-center justify-center transition-colors cursor-pointer"
            >
              {t('report.close')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
