import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, X } from 'lucide-react';
import { useSyncStatus } from '../offline/sync-manager.js';

export const ConflictResolutionModal: React.FC = () => {
  const { t } = useTranslation();
  const { drafts, resolveKeepMine, resolveUseServer } = useSyncStatus();

  if (!drafts || drafts.length === 0 || !drafts[0]) {
    return null;
  }

  const currentDraft = drafts[0];
  const { draftPayload, serverField, fieldId } = currentDraft;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-200">
        <div className="p-5 bg-amber-50 border-b border-amber-200 flex items-start space-x-3">
          <div className="p-2 bg-amber-100 rounded-xl text-amber-700 shrink-0">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-amber-950">
              {t('offline.conflict_title', 'Update Conflict Detected')}
            </h3>
            <p className="text-sm text-amber-800 mt-0.5">
              {t(
                'offline.conflict_desc',
                'This field was updated on the server while you were working offline. Please choose which version to keep.',
              )}
            </p>
          </div>
        </div>

        <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3 text-xs">
            {/* Offline draft column */}
            <div className="p-3.5 bg-blue-50/60 border border-blue-200 rounded-xl space-y-2">
              <span className="font-bold uppercase tracking-wider text-blue-900 block border-b border-blue-200 pb-1">
                {t('offline.your_edit', 'Your Offline Edit')}
              </span>
              <div className="space-y-1.5 text-slate-700">
                {draftPayload?.name && (
                  <div>
                    <span className="text-slate-400 block">{t('fields.name', 'Name')}:</span>
                    <span className="font-medium">{draftPayload.name}</span>
                  </div>
                )}
                {draftPayload?.sowingDate && (
                  <div>
                    <span className="text-slate-400 block">{t('fields.sowingDate', 'Sowing Date')}:</span>
                    <span className="font-medium">{draftPayload.sowingDate}</span>
                  </div>
                )}
                {draftPayload?.soilType && (
                  <div>
                    <span className="text-slate-400 block">{t('fields.soilType', 'Soil')}:</span>
                    <span className="font-medium capitalize">{draftPayload.soilType}</span>
                  </div>
                )}
                {draftPayload?.method && (
                  <div>
                    <span className="text-slate-400 block">{t('fields.method', 'Method')}:</span>
                    <span className="font-medium capitalize">{draftPayload.method}</span>
                  </div>
                )}
                {draftPayload?.baseline && (
                  <div>
                    <span className="text-slate-400 block">{t('fields.baseline', 'Routine')}:</span>
                    <span className="font-medium">
                      {draftPayload.baseline.everyDays}d / {draftPayload.baseline.depthMm}mm
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Current server version column */}
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
              <span className="font-bold uppercase tracking-wider text-slate-800 block border-b border-slate-200 pb-1">
                {t('offline.server_version', 'Server Version')}
              </span>
              <div className="space-y-1.5 text-slate-700">
                <div>
                  <span className="text-slate-400 block">{t('fields.name', 'Name')}:</span>
                  <span className="font-medium">{serverField?.name || '—'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">{t('fields.sowingDate', 'Sowing Date')}:</span>
                  <span className="font-medium">{serverField?.sowingDate || '—'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">{t('fields.soilType', 'Soil')}:</span>
                  <span className="font-medium capitalize">{serverField?.soilType || '—'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">{t('fields.method', 'Method')}:</span>
                  <span className="font-medium capitalize">{serverField?.method || '—'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">{t('fields.baseline', 'Routine')}:</span>
                  <span className="font-medium">
                    {serverField?.baseline
                      ? `${serverField.baseline.everyDays}d / ${serverField.baseline.depthMm}mm`
                      : '—'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end space-x-3">
          <button
            onClick={() => resolveUseServer(fieldId)}
            className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-white text-slate-700 border border-slate-300 hover:bg-slate-100 transition-colors shadow-2xs"
          >
            <X className="w-3.5 h-3.5 text-slate-500" />
            <span>{t('offline.use_server', 'Use Server Version')}</span>
          </button>

          <button
            onClick={() => resolveKeepMine(fieldId)}
            className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors shadow-xs"
          >
            <Check className="w-3.5 h-3.5" />
            <span>{t('offline.keep_mine', 'Keep My Changes')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
