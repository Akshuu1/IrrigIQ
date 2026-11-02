import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext.js';
import { setAppLanguage, type SupportedLanguage } from '../locales/i18n.js';
import {
  Droplet,
  Globe,
  Settings as SettingsIcon,
  LogOut,
  PlusCircle,
  LayoutDashboard,
} from 'lucide-react';

export function Header(): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const { user, isAuthenticated, logout, updateUser } = useAuth();
  const navigate = useNavigate();

  const currentLang = (i18n.language || 'en') as SupportedLanguage;

  const handleLanguageToggle = async () => {
    const nextLang: SupportedLanguage = currentLang === 'en' ? 'hi' : 'en';
    setAppLanguage(nextLang);
    if (isAuthenticated && user) {
      try {
        await updateUser({ language: nextLang });
      } catch {
        // Fallback to local storage is already completed
      }
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <header className="sticky top-0 z-40 w-full bg-slate-950 border-b border-slate-800 shadow-md">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 sm:h-20 flex items-center justify-between gap-2">
        {/* Brand */}
        <Link
          to="/"
          className="flex items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 rounded-lg p-1"
          aria-label={t('nav.brand')}
        >
          <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-emerald-500 flex items-center justify-center text-slate-950 shadow-md shadow-emerald-500/20">
            <Droplet className="w-6 h-6 stroke-[2.5]" />
          </div>
          <div>
            <div className="text-xl sm:text-2xl font-black tracking-tight text-white flex items-center gap-2">
              {t('nav.brand')}
              <span className="text-[10px] sm:text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                v1.0
              </span>
            </div>
            <div className="text-[10px] sm:text-xs text-slate-400 font-medium hidden sm:block">
              {t('nav.tagline')}
            </div>
          </div>
        </Link>

        {/* Navigation & Controls */}
        <div className="flex items-center gap-2 sm:gap-4">
          {/* Language Switcher Button (Large touch target, high contrast) */}
          <button
            type="button"
            onClick={handleLanguageToggle}
            className="min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl border-2 border-emerald-500/60 bg-slate-900 hover:bg-slate-800 active:scale-95 text-emerald-300 font-bold text-sm flex items-center gap-2 shadow-sm transition-all focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:outline-none"
            title="Switch Language / भाषा बदलें"
            aria-label="Switch Language / भाषा बदलें"
          >
            <Globe className="w-4 h-4 text-emerald-400" />
            <span className="uppercase">{currentLang === 'en' ? 'हिन्दी' : 'English'}</span>
          </button>

          {isAuthenticated && (
            <>
              {/* Add Field Button */}
              <Link
                to="/fields/new"
                className="min-h-[44px] px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-slate-950 font-bold text-sm flex items-center gap-1.5 shadow-md shadow-emerald-500/20 transition-all focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:outline-none"
              >
                <PlusCircle className="w-4 h-4 stroke-[2.5]" />
                <span className="hidden md:inline">{t('nav.newField')}</span>
              </Link>

              {/* Dashboard Link */}
              <Link
                to="/"
                className="min-h-[44px] min-w-[44px] p-2.5 rounded-xl border border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white flex items-center justify-center transition-colors focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:outline-none"
                title={t('nav.dashboard')}
                aria-label={t('nav.dashboard')}
              >
                <LayoutDashboard className="w-5 h-5" />
              </Link>

              {/* Settings Link */}
              <Link
                to="/settings"
                className="min-h-[44px] min-w-[44px] p-2.5 rounded-xl border border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white flex items-center justify-center transition-colors focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:outline-none"
                title={t('nav.settings')}
                aria-label={t('nav.settings')}
              >
                <SettingsIcon className="w-5 h-5" />
              </Link>

              {/* Logout Button */}
              <button
                type="button"
                onClick={handleLogout}
                className="min-h-[44px] min-w-[44px] p-2.5 rounded-xl border border-slate-800 bg-slate-900 hover:bg-rose-950/40 hover:text-rose-400 hover:border-rose-900/50 text-slate-400 flex items-center justify-center transition-colors focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:outline-none"
                title={t('nav.logout')}
                aria-label={t('nav.logout')}
              >
                <LogOut className="w-5 h-5" />
              </button>
            </>
          )}

          {!isAuthenticated && (
            <div className="flex items-center gap-2">
              <Link
                to="/login"
                className="min-h-[44px] px-3.5 py-2 rounded-xl text-slate-200 hover:text-white font-semibold text-sm transition-colors"
              >
                {t('nav.login')}
              </Link>
              <Link
                to="/register"
                className="min-h-[44px] px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm shadow-md transition-all"
              >
                {t('nav.register')}
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
