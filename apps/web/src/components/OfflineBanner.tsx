import React from 'react';
import { useTranslation } from 'react-i18next';
import { WifiOff, RefreshCw, CheckCircle2 } from 'lucide-react';
import { useSyncStatus } from '../offline/sync-manager.js';

export const OfflineBanner: React.FC = () => {
  const { t } = useTranslation();
  const { isOnline, isSyncing, pendingCount, syncNow } = useSyncStatus();

  if (isOnline && pendingCount === 0) {
    return null;
  }

  return (
    <aside
      aria-label="Offline sync status"
      className={`${
        !isOnline
          ? 'bg-amber-50 border-b border-amber-200 text-amber-900'
          : 'bg-blue-50 border-b border-blue-200 text-blue-900'
      } px-4 py-2.5 transition-colors duration-200`}
    >
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3 text-sm">
        <div className="flex items-center space-x-2">
          {!isOnline ? (
            <WifiOff className="w-4 h-4 text-amber-600 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />
          )}
          <span className="font-medium">
            {!isOnline
              ? t('offline.banner_offline', 'You are currently offline. Changes are saved locally on this device.')
              : t('offline.banner_pending', 'You are back online with changes waiting to sync.')}
          </span>
          {pendingCount > 0 && (
            <span
              data-testid="pending-badge"
              className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-white/80 border border-current shadow-2xs"
            >
              {pendingCount} {t('offline.pending_badge', 'pending')}
            </span>
          )}
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={() => syncNow()}
            disabled={isSyncing || !isOnline}
            className={`inline-flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-medium shadow-2xs transition-colors ${
              !isOnline
                ? 'bg-amber-100 text-amber-700 opacity-60 cursor-not-allowed'
                : 'bg-white hover:bg-slate-50 text-slate-800 border border-slate-300'
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin text-emerald-600' : ''}`} />
            <span>
              {isSyncing
                ? t('offline.syncing', 'Syncing...')
                : t('offline.sync_now', 'Sync now')}
            </span>
          </button>
        </div>
      </div>
    </aside>
  );
};

