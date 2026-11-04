import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type MessageChannel, type LinkCodeResponse } from '../api/client.js';
import {
  Send,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Loader2,
  Clock,
  Moon,
  Trash2,
  RefreshCw,
} from 'lucide-react';

export function TelegramConnectCard(): React.JSX.Element {
  const { t } = useTranslation();

  const [channel, setChannel] = useState<MessageChannel | null>(null);
  const [linkData, setLinkData] = useState<LinkCodeResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLinking, setIsLinking] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const [sendTime, setSendTime] = useState('06:30');
  const [quietStart, setQuietStart] = useState('22:00');
  const [quietEnd, setQuietEnd] = useState('06:00');
  const [dailyCap, setDailyCap] = useState(3);

  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null,
  );

  const loadChannel = async () => {
    try {
      setIsLoading(true);
      const data = await api.getMessagingChannel();
      setChannel(data);
      if (data) {
        setSendTime(data.sendTime || '06:30');
        if (data.quietHours) {
          setQuietStart(data.quietHours.start || '22:00');
          setQuietEnd(data.quietHours.end || '06:00');
        }
        if (data.dailyCap) {
          setDailyCap(data.dailyCap);
        }
      }
    } catch {
      // Fallback silently if offline or unlinked
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadChannel();
  }, []);

  const handleGenerateLink = async () => {
    try {
      setIsLinking(true);
      setFeedback(null);
      const data = await api.createLinkCode();
      setLinkData(data);
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to generate link code',
      });
    } finally {
      setIsLinking(false);
    }
  };

  const handleSavePreferences = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSaving(true);
      setFeedback(null);
      const updated = await api.updateMessagingChannel({
        sendTime,
        quietHours: { start: quietStart, end: quietEnd },
        dailyCap: Number(dailyCap),
      });
      setChannel(updated);
      setFeedback({ type: 'success', message: t('messaging.preferencesSaved') });
      setTimeout(() => setFeedback(null), 4000);
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to update preferences',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSendTestMessage = async () => {
    try {
      setIsTesting(true);
      setFeedback(null);
      await api.sendTestMessage();
      setFeedback({ type: 'success', message: t('messaging.testSent') });
      setTimeout(() => setFeedback(null), 4000);
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to send test message',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm(t('messaging.confirmDisconnect'))) return;
    try {
      setIsDisconnecting(true);
      setFeedback(null);
      await api.deleteMessagingChannel();
      setChannel(null);
      setLinkData(null);
      setFeedback({ type: 'success', message: 'Telegram disconnected' });
      setTimeout(() => setFeedback(null), 4000);
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to disconnect',
      });
    } finally {
      setIsDisconnecting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex items-center justify-center gap-3 text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin text-emerald-400" />
        <span>{t('common.loading')}</span>
      </div>
    );
  }

  const isConnected = channel && (channel.status === 'active' || channel.status === 'pending_opt_in');

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400">
            <Send className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">{t('messaging.title')}</h2>
            <p className="text-xs text-slate-400">{t('messaging.subtitle')}</p>
          </div>
        </div>

        {/* Status Badge */}
        <div>
          {channel?.status === 'active' ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              {t('messaging.statusActive')}
            </span>
          ) : channel?.status === 'pending_opt_in' ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              {t('messaging.statusPending')}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-800 text-slate-400 border border-slate-700">
              {t('messaging.statusDisconnected')}
            </span>
          )}
        </div>
      </div>

      {/* Feedback Alerts */}
      {feedback && (
        <div
          className={`p-3.5 rounded-xl border text-sm flex items-center gap-2.5 ${
            feedback.type === 'success'
              ? 'bg-emerald-950/60 border-emerald-800 text-emerald-200'
              : 'bg-rose-950/60 border-rose-800 text-rose-200'
          }`}
          role="alert"
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      {/* State 1: Disconnected / Not Linked */}
      {!isConnected && (
        <div className="space-y-4 pt-1">
          <p className="text-sm text-slate-300 leading-relaxed">
            {t('messaging.linkInstructions')}
          </p>

          {!linkData ? (
            <button
              type="button"
              onClick={handleGenerateLink}
              disabled={isLinking}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-sky-500 hover:bg-sky-400 active:scale-[0.99] disabled:opacity-60 text-slate-950 font-bold text-sm shadow-md transition-all cursor-pointer"
            >
              {isLinking ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{t('messaging.connecting')}</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>{t('messaging.connectBtn')}</span>
                </>
              )}
            </button>
          ) : (
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <span className="text-xs text-slate-400 block">{t('messaging.linkCode')}</span>
                  <span className="text-2xl font-mono font-black text-sky-400 tracking-wider">
                    {linkData.code}
                  </span>
                </div>
                <a
                  href={linkData.deepLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-sm transition-all"
                >
                  <span>{t('messaging.openTelegram')}</span>
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
              <p className="text-xs text-slate-400 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-slate-500" />
                <span>{t('messaging.codeExpires')}</span>
              </p>
            </div>
          )}
        </div>
      )}

      {/* State 2: Connected - Show Preferences Form & Test Button */}
      {isConnected && (
        <form onSubmit={handleSavePreferences} className="space-y-4 pt-1">
          <h3 className="text-sm font-bold text-slate-200">{t('messaging.preferencesTitle')}</h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Send Time */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-sky-400" />
                <span>{t('messaging.sendTime')}</span>
              </label>
              <input
                type="time"
                value={sendTime}
                onChange={(e) => setSendTime(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>

            {/* Daily Cap */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">
                {t('messaging.dailyCap')}
              </label>
              <input
                type="number"
                min="1"
                max="10"
                value={dailyCap}
                onChange={(e) => setDailyCap(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>
          </div>

          {/* Quiet Hours */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Moon className="w-3.5 h-3.5 text-indigo-400" />
              <span>{t('messaging.quietHours')}</span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="text-[11px] text-slate-400 block mb-1">
                  {t('messaging.quietFrom')}
                </span>
                <input
                  type="time"
                  value={quietStart}
                  onChange={(e) => setQuietStart(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>
              <div>
                <span className="text-[11px] text-slate-400 block mb-1">
                  {t('messaging.quietTo')}
                </span>
                <input
                  type="time"
                  value={quietEnd}
                  onChange={(e) => setQuietEnd(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>
            </div>
          </div>

          {/* Actions Bar */}
          <div className="pt-2 flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-sky-500 hover:bg-sky-400 active:scale-[0.99] disabled:opacity-60 text-slate-950 font-bold text-sm shadow transition-all cursor-pointer"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{t('messaging.saving')}</span>
                </>
              ) : (
                <span>{t('messaging.savePreferences')}</span>
              )}
            </button>

            <button
              type="button"
              onClick={handleSendTestMessage}
              disabled={isTesting}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-[0.99] disabled:opacity-60 text-slate-200 font-semibold text-sm border border-slate-700 transition-all cursor-pointer"
            >
              {isTesting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
                  <span>{t('messaging.sendingTest')}</span>
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4 text-sky-400" />
                  <span>{t('messaging.testBtn')}</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleDisconnect}
              disabled={isDisconnecting}
              className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-rose-400 hover:bg-rose-950/40 text-xs font-semibold transition-all cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
              <span>{t('messaging.disconnectBtn')}</span>
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
