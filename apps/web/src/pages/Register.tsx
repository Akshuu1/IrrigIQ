import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext.js';
import { RegisterSchema, type Language, type AreaUnit } from '@irrigiq/shared';
import { Droplet, AlertCircle, Loader2 } from 'lucide-react';

export function Register(): React.JSX.Element {
  const { t } = useTranslation();
  const { register } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [language, setLanguage] = useState<Language>('en');
  const [areaUnit, setAreaUnit] = useState<AreaUnit>('acre');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    const result = RegisterSchema.safeParse({
      name,
      email,
      password,
      language,
      areaUnit,
    });

    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        fieldErrors[String(issue.path[0])] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    setIsSubmitting(true);
    try {
      await register(result.data);
      navigate('/', { replace: true });
    } catch (err: unknown) {
      setErrors({
        general: err instanceof Error ? err.message : t('common.error'),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-[85vh] flex flex-col justify-center items-center py-8">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl backdrop-blur-md">
        {/* Brand Icon & Heading */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500 flex items-center justify-center text-slate-950 mb-4 shadow-lg shadow-emerald-500/30">
            <Droplet className="w-8 h-8 stroke-[2.5]" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            {t('auth.registerTitle')}
          </h1>
          <p className="text-sm text-slate-400 mt-2 max-w-sm">{t('auth.registerSubtitle')}</p>
        </div>

        {/* General Error Banner */}
        {errors.general && (
          <div
            className="mb-6 p-4 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-200 text-sm flex items-start gap-3"
            role="alert"
          >
            <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
            <div>{errors.general}</div>
          </div>
        )}

        {/* Register Form */}
        <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5" noValidate>
          <div>
            <label
              htmlFor="register-name"
              className="block text-sm font-semibold text-slate-200 mb-2"
            >
              {t('auth.name')}
            </label>
            <input
              id="register-name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('auth.namePlaceholder')}
              className={`w-full min-h-[48px] bg-slate-950 border rounded-xl px-4 py-3 text-base text-white placeholder-slate-500 focus:outline-none transition-colors ${
                errors.name
                  ? 'border-rose-500 focus:border-rose-400'
                  : 'border-slate-700 focus:border-emerald-400'
              }`}
            />
            {errors.name && (
              <p className="mt-1.5 text-xs text-rose-400 font-medium">{errors.name}</p>
            )}
          </div>

          <div>
            <label
              htmlFor="register-email"
              className="block text-sm font-semibold text-slate-200 mb-2"
            >
              {t('auth.email')}
            </label>
            <input
              id="register-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('auth.emailPlaceholder')}
              className={`w-full min-h-[48px] bg-slate-950 border rounded-xl px-4 py-3 text-base text-white placeholder-slate-500 focus:outline-none transition-colors ${
                errors.email
                  ? 'border-rose-500 focus:border-rose-400'
                  : 'border-slate-700 focus:border-emerald-400'
              }`}
            />
            {errors.email && (
              <p className="mt-1.5 text-xs text-rose-400 font-medium">{errors.email}</p>
            )}
          </div>

          <div>
            <label
              htmlFor="register-password"
              className="block text-sm font-semibold text-slate-200 mb-2"
            >
              {t('auth.password')}
            </label>
            <input
              id="register-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('auth.passwordPlaceholder')}
              className={`w-full min-h-[48px] bg-slate-950 border rounded-xl px-4 py-3 text-base text-white placeholder-slate-500 focus:outline-none transition-colors ${
                errors.password
                  ? 'border-rose-500 focus:border-rose-400'
                  : 'border-slate-700 focus:border-emerald-400'
              }`}
            />
            {errors.password && (
              <p className="mt-1.5 text-xs text-rose-400 font-medium">{errors.password}</p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
            {/* Preferred Language */}
            <div>
              <label
                htmlFor="register-language"
                className="block text-sm font-semibold text-slate-200 mb-2"
              >
                {t('auth.selectLanguage')}
              </label>
              <select
                id="register-language"
                value={language}
                onChange={(e) => setLanguage(e.target.value as Language)}
                className="w-full min-h-[48px] bg-slate-950 border border-slate-700 focus:border-emerald-400 rounded-xl px-3 py-2 text-base text-white focus:outline-none"
              >
                <option value="en">English</option>
                <option value="hi">हिन्दी (Hindi)</option>
              </select>
            </div>

            {/* Preferred Unit */}
            <div>
              <label
                htmlFor="register-unit"
                className="block text-sm font-semibold text-slate-200 mb-2"
              >
                {t('auth.selectUnit')}
              </label>
              <select
                id="register-unit"
                value={areaUnit}
                onChange={(e) => setAreaUnit(e.target.value as AreaUnit)}
                className="w-full min-h-[48px] bg-slate-950 border border-slate-700 focus:border-emerald-400 rounded-xl px-3 py-2 text-base text-white focus:outline-none"
              >
                <option value="acre">{t('settings.unitAcre')}</option>
                <option value="ha">{t('settings.unitHa')}</option>
              </select>
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full min-h-[50px] mt-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:scale-[0.98] disabled:opacity-60 text-slate-950 font-bold text-base shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>{t('auth.registering')}</span>
              </>
            ) : (
              <span>{t('auth.registerButton')}</span>
            )}
          </button>
        </form>

        {/* Footer Link */}
        <div className="mt-8 text-center text-sm text-slate-400">
          <span>{t('auth.alreadyHaveAccount')} </span>
          <Link
            to="/login"
            className="text-emerald-400 hover:text-emerald-300 font-bold underline underline-offset-4 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400 rounded"
          >
            {t('auth.loginHere')}
          </Link>
        </div>
      </div>
    </div>
  );
}
