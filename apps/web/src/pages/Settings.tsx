import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext.js';
import { type Language, type AreaUnit } from '@irrigiq/shared';
import { setAppLanguage, type SupportedLanguage } from '../locales/i18n.js';
import { Settings as SettingsIcon, Check, AlertCircle, Loader2, Globe, Ruler } from 'lucide-react';

export function Settings(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { user, updateUser } = useAuth();

  const [language, setLanguage] = useState<Language>(
    (user?.language || i18n.language || 'en') as Language,
  );
  const [areaUnit, setAreaUnit] = useState<AreaUnit>(user?.areaUnit || 'acre');
  const [isSaving, setIsSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSuccessMessage(null);
    setErrorMessage(null);

    try {
      await updateUser({ language, areaUnit });
      setAppLanguage(language as SupportedLanguage);
      setSuccessMessage(t('settings.saveSuccess'));
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : t('settings.saveError'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto py-4 sm:py-8 space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-3 border-b border-slate-800 pb-5">
        <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
          <SettingsIcon className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-white">{t('settings.title')}</h1>
          <p className="text-sm text-slate-400 mt-0.5">{t('settings.subtitle')}</p>
        </div>
      </div>

      {/* Notifications */}
      {successMessage && (
        <div
          className="p-4 rounded-xl bg-emerald-950/70 border border-emerald-700 text-emerald-200 text-sm flex items-center gap-3 animate-fade-in"
          role="status"
        >
          <Check className="w-5 h-5 text-emerald-400 flex-shrink-0" />
          <span className="font-semibold">{successMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div
          className="p-4 rounded-xl bg-rose-950/70 border border-rose-800 text-rose-200 text-sm flex items-center gap-3"
          role="alert"
        >
          <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* Farmer Profile Info */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            {t('settings.profileSection')}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-slate-400 block text-xs">{t('settings.nameLabel')}</span>
              <span className="font-semibold text-slate-100 text-base">{user?.name || '—'}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-xs">{t('settings.emailLabel')}</span>
              <span className="font-semibold text-slate-100 text-base">{user?.email || '—'}</span>
            </div>
          </div>
        </div>

        {/* Preferences Section */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 space-y-6">
          <h2 className="text-lg font-bold text-white">{t('settings.preferencesSection')}</h2>

          {/* Language Selection */}
          <div className="space-y-3">
            <label className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <Globe className="w-4 h-4 text-emerald-400" />
              <span>{t('settings.languageLabel')}</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setLanguage('en')}
                className={`min-h-[52px] p-4 rounded-xl border text-left font-semibold text-sm transition-all flex items-center justify-between cursor-pointer ${
                  language === 'en'
                    ? 'border-emerald-500 bg-emerald-950/40 text-emerald-300 ring-2 ring-emerald-500/20'
                    : 'border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-700'
                }`}
              >
                <span>{t('settings.languageEn')}</span>
                {language === 'en' && <Check className="w-5 h-5 text-emerald-400" />}
              </button>

              <button
                type="button"
                onClick={() => setLanguage('hi')}
                className={`min-h-[52px] p-4 rounded-xl border text-left font-semibold text-sm transition-all flex items-center justify-between cursor-pointer ${
                  language === 'hi'
                    ? 'border-emerald-500 bg-emerald-950/40 text-emerald-300 ring-2 ring-emerald-500/20'
                    : 'border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-700'
                }`}
              >
                <span>{t('settings.languageHi')}</span>
                {language === 'hi' && <Check className="w-5 h-5 text-emerald-400" />}
              </button>
            </div>
          </div>

          {/* Area Unit Selection */}
          <div className="space-y-3">
            <label className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <Ruler className="w-4 h-4 text-emerald-400" />
              <span>{t('settings.unitLabel')}</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setAreaUnit('acre')}
                className={`min-h-[52px] p-4 rounded-xl border text-left font-semibold text-sm transition-all flex items-center justify-between cursor-pointer ${
                  areaUnit === 'acre'
                    ? 'border-emerald-500 bg-emerald-950/40 text-emerald-300 ring-2 ring-emerald-500/20'
                    : 'border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-700'
                }`}
              >
                <span>{t('settings.unitAcre')}</span>
                {areaUnit === 'acre' && <Check className="w-5 h-5 text-emerald-400" />}
              </button>

              <button
                type="button"
                onClick={() => setAreaUnit('ha')}
                className={`min-h-[52px] p-4 rounded-xl border text-left font-semibold text-sm transition-all flex items-center justify-between cursor-pointer ${
                  areaUnit === 'ha'
                    ? 'border-emerald-500 bg-emerald-950/40 text-emerald-300 ring-2 ring-emerald-500/20'
                    : 'border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-700'
                }`}
              >
                <span>{t('settings.unitHa')}</span>
                {areaUnit === 'ha' && <Check className="w-5 h-5 text-emerald-400" />}
              </button>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <button
          type="submit"
          disabled={isSaving}
          className="w-full min-h-[52px] rounded-xl bg-emerald-500 hover:bg-emerald-400 active:scale-[0.99] disabled:opacity-60 text-slate-950 font-black text-base shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          {isSaving ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>{t('common.saving')}</span>
            </>
          ) : (
            <span>{t('settings.saveButton')}</span>
          )}
        </button>
      </form>
    </div>
  );
}
