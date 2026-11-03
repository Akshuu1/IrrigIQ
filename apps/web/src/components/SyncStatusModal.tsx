import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, AlertCircle, Clock, Check, X } from 'lucide-react';
import { useSyncStatus } from '../offline/sync-manager.js';
import { getAllMutations, retryMutation, QueuedMutation } from '../offline/queue.js';

interface SyncStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SyncStatusModal: React.FC<SyncStatusModalProps> = ({ isOpen, onClose }) => {
  const { t, i18n } = useTranslation();
  const { isOnline, isSyncing, lastSyncTime, syncNow } = useSyncStatus();
  const [mutations, setMutations] = useState<QueuedMutation[]>([]);

  const loadMutations = async () => {
    const all = await getAllMutations();
    setMutations(all);
  };

  useEffect(() => {
    if (isOpen) {
      loadMutations();
    }
  }, [isOpen, isSyncing]);

  if (!isOpen) return null;

  const formatTime = (time: number | null) => {
    if (!time) return t('offline.never_synced', 'Never synced');
    return new Intl.DateTimeFormat(i18n.language === 'hi' ? 'hi-IN' : 'en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(time));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden border border-slate-200">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <RefreshCw className={`w-5 h-5 ${isSyncing ? 'animate-spin text-emerald-600' : 'text-slate-600'}`} />
            <h3 className="text-base font-bold text-slate-800">
              {t('offline.sync_status_title', 'Offline Sync Status')}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* Status summary */}
          <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-slate-500">{t('offline.network_status', 'Connection')}:</span>
              <span className={`font-semibold flex items-center space-x-1 ${isOnline ? 'text-emerald-700' : 'text-amber-700'}`}>
                <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                <span>{isOnline ? t('offline.status_online', 'Online') : t('offline.status_offline', 'Offline')}</span>
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">{t('offline.last_synced', 'Last synced')}:</span>
              <span className="text-slate-800 font-medium">{formatTime(lastSyncTime)}</span>
            </div>
          </div>

          {/* Pending / Failed Mutations */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
              {t('offline.mutation_queue', 'Pending Changes')} ({mutations.length})
            </h4>

            {mutations.length === 0 ? (
              <div className="text-center py-6 border border-dashed border-slate-200 rounded-xl text-slate-400 text-sm">
                <Check className="w-8 h-8 mx-auto mb-1 text-emerald-500" />
                <p>{t('offline.all_changes_synced', 'All changes are synced with server')}</p>
              </div>
            ) : (
              <ul className="space-y-2">
                {mutations.map((mut) => (
                  <li
                    key={mut.clientId}
                    className="p-3 bg-white border border-slate-200 rounded-lg text-sm shadow-2xs flex flex-col space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-800">
                        {mut.type === 'create_irrigation_log'
                          ? t('offline.type_log', 'Irrigation Log')
                          : t('offline.type_edit_field', 'Edit Field')}
                      </span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          mut.status === 'failed'
                            ? 'bg-rose-100 text-rose-700'
                            : mut.status === 'conflict'
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-blue-100 text-blue-700'
                        }`}
                      >
                        {mut.status}
                      </span>
                    </div>

                    {mut.error && (
                      <div className="text-xs text-rose-600 flex items-start space-x-1">
                        <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        <span>{mut.error}</span>
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-xs text-slate-400">
                      <span className="flex items-center space-x-1">
                        <Clock className="w-3 h-3" />
                        <span>{new Date(mut.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </span>

                      {mut.status === 'failed' && (
                        <button
                          onClick={async () => {
                            await retryMutation(mut.clientId);
                            await loadMutations();
                          }}
                          className="text-emerald-700 font-semibold hover:underline"
                        >
                          {t('offline.retry', 'Retry')}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors"
          >
            {t('common.close', 'Close')}
          </button>

          <button
            onClick={async () => {
              await syncNow();
              await loadMutations();
            }}
            disabled={isSyncing || !isOnline || mutations.length === 0}
            className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors shadow-xs"
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>{isSyncing ? t('offline.syncing', 'Syncing...') : t('offline.sync_now', 'Sync Now')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

