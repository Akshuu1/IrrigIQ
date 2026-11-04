import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext.js';
import { setAppLanguage, type SupportedLanguage, SUPPORTED_LANGUAGES } from '../locales/i18n.js';
import { useSyncStatus } from '../offline/sync-manager.js';
import { SyncStatusModal } from './SyncStatusModal.js';
import {
  Droplet,
  Globe,
  Settings as SettingsIcon,
  LogOut,
  PlusCircle,
  LayoutDashboard,
  WifiOff,
  RefreshCw,
} from 'lucide-react';

export function Header(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { user, isAuthenticated, logout, updateUser } = useAuth();
  const navigate = useNavigate();
  const [showSyncModal, setShowSyncModal] = useState(false);
  const { isOnline, isSyncing, pendingCount } = useSyncStatus();

  const activeLang = i18n.language || user?.language || 'en';
  const currentLang = (SUPPORTED_LANGUAGES.includes(activeLang as SupportedLanguage)
    ? activeLang
    : 'en') as SupportedLanguage;

  const handleLanguageChange = async (nextLang: SupportedLanguage) => {
    setAppLanguage(nextLang);
    if (isAuthenticated && user) {
      try {
        await updateUser({ language: nextLang });
      } catch {
        // Local storage change already applied
      }
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <header className="sticky top-0 z-40 w-full bg-slate-950 border-b border-slate-800 shadow-md">
      <div className="max-w-6xl mx-auto px-2 sm:px-6 h-16 sm:h-20 flex items-center justify-between gap-1.5 sm:gap-4">
        {/* Brand */}
        <Link
          to="/"
          className="flex items-center gap-2 sm:gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 rounded-lg p-1 shrink-0"
          aria-label={t('nav.brand')}
        >
          <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl bg-emerald-500 flex items-center justify-center text-slate-950 shadow-md shadow-emerald-500/20 shrink-0">
            <Droplet className="w-5 h-5 sm:w-6 sm:h-6 stroke-[2.5]" />
          </div>
          <div>
            <div className="text-lg sm:text-2xl font-black tracking-tight text-white flex items-center gap-1.5 sm:gap-2">
              {t('nav.brand')}
              <span className="text-[10px] sm:text-xs font-semibold px-1.5 sm:px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                v1.0
              </span>
            </div>
            <div className="text-[10px] sm:text-xs text-slate-400 font-medium hidden md:block">
              {t('nav.tagline')}
            </div>
          </div>
        </Link>

        {/* Navigation & Controls */}
        <div className="flex items-center gap-1.5 sm:gap-3">
          {/* Sync Status Button */}
          {isAuthenticated && (
            <button
              type="button"
              onClick={() => setShowSyncModal(true)}
              className={`min-h-[40px] px-2 sm:px-2.5 py-1.5 rounded-xl border flex items-center gap-1.5 text-xs font-semibold shadow-xs transition-all ${
                !isOnline
                  ? 'border-amber-500/50 bg-amber-950/40 text-amber-300'
                  : pendingCount > 0
                    ? 'border-blue-500/50 bg-blue-950/40 text-blue-300'
                    : 'border-slate-800 bg-slate-900 text-slate-300 hover:text-white'
              }`}
              title={t('offline.sync_status_title', 'Offline Sync Status')}
              aria-label={t('offline.sync_status_title', 'Offline Sync Status')}
            >
              {!isOnline ? (
                <WifiOff className="w-3.5 h-3.5 text-amber-400" />
              ) : isSyncing ? (
                <RefreshCw className="w-3.5 h-3.5 text-emerald-400 animate-spin" />
              ) : (
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
              )}
              <span className="hidden sm:inline">
                {!isOnline
                  ? `${t('offline.status_offline', 'Offline')} (${pendingCount})`
                  : pendingCount > 0
                    ? `${pendingCount} ${t('offline.pending_badge', 'pending')}`
                    : t('offline.status_synced', 'Synced')}
              </span>
            </button>
          )}

          {/* 5-Language Selector Dropdown */}
          <div className="relative flex items-center">
            <label htmlFor="header-language-select" className="sr-only">
              {t('settings.languageLabel', 'Display Language')}
            </label>
            <div className="relative flex items-center">
              <Globe className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-400 absolute left-2 sm:left-2.5 pointer-events-none" />
              <select
                id="header-language-select"
                value={currentLang}
                onChange={(e) => handleLanguageChange(e.target.value as SupportedLanguage)}
                className="min-h-[40px] sm:min-h-[44px] pl-6 sm:pl-8 pr-2 sm:pr-3 py-1 sm:py-1.5 rounded-xl border-2 border-emerald-500/60 bg-slate-900 hover:bg-slate-800 text-emerald-300 font-bold text-xs sm:text-sm focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:outline-none cursor-pointer"
                title="Switch Language / भाषा निवडा / ਭਾਸ਼ਾ ਬਦਲੋ / భాష మార్చండి"
                aria-label="Switch Language"
              >
                <option value="en" className="bg-slate-900 text-slate-100">
                  English
                </option>
                <option value="hi" className="bg-slate-900 text-slate-100">
                  हिन्दी
                </option>
                <option value="mr" className="bg-slate-900 text-slate-100">
                  मराठी
                </option>
                <option value="pa" className="bg-slate-900 text-slate-100">
                  ਪੰਜਾਬੀ
                </option>
                <option value="te" className="bg-slate-900 text-slate-100">
                  తెలుగు
                </option>
              </select>
            </div>
          </div>

          {isAuthenticated && (
            <>
              {/* Add Field Button */}
              <Link
                to="/fields/new"
                className="min-h-[40px] sm:min-h-[44px] px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-slate-950 font-bold text-xs sm:text-sm flex items-center gap-1.5 shadow-md shadow-emerald-500/20 transition-all focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:outline-none"
              >
                <PlusCircle className="w-4 h-4 stroke-[2.5]" />
                <span className="hidden md:inline">{t('nav.newField')}</span>
              </Link>

              {/* Dashboard Link */}
              <Link
                to="/"
                className="min-h-[40px] min-w-[40px] sm:min-h-[44px] sm:min-w-[44px] p-2 sm:p-2.5 rounded-xl border border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white flex items-center justify-center transition-colors focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:outline-none"
                title={t('nav.dashboard')}
                aria-label={t('nav.dashboard')}
              >
                <LayoutDashboard className="w-4 h-4 sm:w-5 sm:h-5" />
              </Link>

              {/* Settings Link */}
              <Link
                to="/settings"
                className="min-h-[40px] min-w-[40px] sm:min-h-[44px] sm:min-w-[44px] p-2 sm:p-2.5 rounded-xl border border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white flex items-center justify-center transition-colors focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:outline-none"
                title={t('nav.settings')}
                aria-label={t('nav.settings')}
              >
                <SettingsIcon className="w-4 h-4 sm:w-5 sm:h-5" />
              </Link>

              {/* Logout Button */}
              <button
                type="button"
                onClick={handleLogout}
                className="min-h-[40px] min-w-[40px] sm:min-h-[44px] sm:min-w-[44px] p-2 sm:p-2.5 rounded-xl border border-slate-800 bg-slate-900 hover:bg-rose-950/40 hover:text-rose-400 hover:border-rose-900/50 text-slate-400 flex items-center justify-center transition-colors focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:outline-none"
                title={t('nav.logout')}
                aria-label={t('nav.logout')}
              >
                <LogOut className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
            </>
          )}

          {!isAuthenticated && (
            <div className="flex items-center gap-1 sm:gap-2">
              <Link
                to="/login"
                className="min-h-[40px] px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-xl text-slate-200 hover:text-white font-semibold text-xs sm:text-sm transition-colors"
              >
                {t('nav.login')}
              </Link>
              <Link
                to="/register"
                className="min-h-[40px] px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs sm:text-sm shadow-md transition-all"
              >
                {t('nav.register')}
              </Link>
            </div>
          )}
        </div>
      </div>

      <SyncStatusModal isOpen={showSyncModal} onClose={() => setShowSyncModal(false)} />
    </header>
  );
}
