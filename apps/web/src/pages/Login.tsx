import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext.js';
import { LoginSchema } from '@irrigiq/shared';
import { Droplet, AlertCircle, Loader2, Sparkles } from 'lucide-react';

export function Login(): React.JSX.Element {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string; general?: string }>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    const result = LoginSchema.safeParse({ email, password });
    if (!result.success) {
      const fieldErrors: { email?: string; password?: string } = {};
      for (const issue of result.error.issues) {
        if (issue.path[0] === 'email') fieldErrors.email = issue.message;
        if (issue.path[0] === 'password') fieldErrors.password = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    setIsSubmitting(true);
    try {
      await login(result.data);
      const locState = location.state as { from?: { pathname?: string } } | null;
      const destination = locState?.from?.pathname || '/';
      navigate(destination, { replace: true });
    } catch (err: unknown) {
      const is401 = (err as { status?: number })?.status === 401;
      const message = err instanceof Error ? err.message : t('common.error');
      setErrors({
        general: is401 ? t('auth.invalidCredentials') : message,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDemoLogin = async () => {
    setEmail('demo@irrigiq.org');
    setPassword('DemoPassword123!');
    setErrors({});
    setIsSubmitting(true);
    try {
      await login({ email: 'demo@irrigiq.org', password: 'DemoPassword123!' });
      const locState = location.state as { from?: { pathname?: string } } | null;
      const destination = locState?.from?.pathname || '/';
      navigate(destination, { replace: true });
    } catch (err: unknown) {
      const is401 = (err as { status?: number })?.status === 401;
      const message = err instanceof Error ? err.message : t('common.error');
      setErrors({
        general: is401 ? t('auth.invalidCredentials') : message,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex flex-col justify-center items-center py-8">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl backdrop-blur-md">
        {/* Brand Icon & Heading */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500 flex items-center justify-center text-slate-950 mb-4 shadow-lg shadow-emerald-500/30">
            <Droplet className="w-8 h-8 stroke-[2.5]" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            {t('auth.loginTitle')}
          </h1>
          <p className="text-sm text-slate-400 mt-2 max-w-xs">{t('auth.loginSubtitle')}</p>
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

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          <div>
            <label
              htmlFor="login-email"
              className="block text-sm font-semibold text-slate-200 mb-2"
            >
              {t('auth.email')}
            </label>
            <input
              id="login-email"
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
              htmlFor="login-password"
              className="block text-sm font-semibold text-slate-200 mb-2"
            >
              {t('auth.password')}
            </label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
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

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full min-h-[50px] mt-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:scale-[0.98] disabled:opacity-60 text-slate-950 font-bold text-base shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>{t('auth.loggingIn')}</span>
              </>
            ) : (
              <span>{t('auth.loginButton')}</span>
            )}
          </button>

          <button
            type="button"
            onClick={handleDemoLogin}
            disabled={isSubmitting}
            className="w-full min-h-[46px] rounded-xl border border-emerald-500/50 bg-emerald-950/40 hover:bg-emerald-950 active:scale-[0.98] disabled:opacity-60 text-emerald-300 font-bold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            <Sparkles className="w-4 h-4 text-emerald-400" />
            <span>One-Click Demo Farmer Login (डेमो लॉगिन)</span>
          </button>
        </form>

        {/* Footer Link */}
        <div className="mt-8 text-center text-sm text-slate-400">
          <span>{t('auth.noAccount')} </span>
          <Link
            to="/register"
            className="text-emerald-400 hover:text-emerald-300 font-bold underline underline-offset-4 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-400 rounded"
          >
            {t('auth.registerHere')}
          </Link>
        </div>
      </div>
    </div>
  );
}
