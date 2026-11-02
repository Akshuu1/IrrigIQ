import React from 'react';
import { useTranslation } from 'react-i18next';
import { mmToLitres } from '@irrigiq/shared';
import { type IrrigationLog, type Field } from '../../api/client.js';
import { formatDate, formatNumber } from '../../utils/formatters.js';
import { Droplet, Trash2, Calendar } from 'lucide-react';

interface RecentLogsTableProps {
  field: Field;
  logs: IrrigationLog[];
  onDeleteLog: (logId: string) => Promise<void>;
  isDeletingId: string | null;
}

export function RecentLogsTable({
  field,
  logs,
  onDeleteLog,
  isDeletingId,
}: RecentLogsTableProps): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language || 'en') as 'en' | 'hi';

  return (
    <div className="bg-slate-900 border-2 border-slate-800 rounded-3xl p-5 sm:p-7 shadow-xl space-y-4">
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
        <h3 className="text-xl sm:text-2xl font-black text-white flex items-center gap-2.5">
          <Calendar className="w-5 h-5 text-emerald-400" />
          <span>{t('fieldDetail.recentLogsTitle')}</span>
        </h3>
        <span className="text-xs text-slate-400 font-semibold">{logs.length} entries</span>
      </div>

      {logs.length === 0 ? (
        <div className="p-8 text-center text-slate-500 text-sm border border-dashed border-slate-800 rounded-2xl">
          <Droplet className="w-8 h-8 mx-auto mb-2 opacity-40 text-emerald-400" />
          <p>{t('fieldDetail.noLogsYet')}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-800">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-950 text-xs uppercase tracking-wider text-slate-400 border-b border-slate-800">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t('fieldDetail.tableColDate')}
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t('fieldDetail.appliedDepthMm')}
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t('fieldDetail.appliedLitres')}
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t('fieldDetail.logSource')}
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t('fieldDetail.logNote')}
                </th>
                <th scope="col" className="px-4 py-3 font-semibold text-right">
                  {t('common.delete')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 bg-slate-900/60 font-medium">
              {logs.map((log) => {
                const litres = mmToLitres(log.appliedMm, field.areaHa);
                const isDeleting = isDeletingId === log.id;

                return (
                  <tr key={log.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-4 py-3 text-white font-semibold whitespace-nowrap">
                      {formatDate(log.date, lang, { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="px-4 py-3 text-emerald-400 font-bold whitespace-nowrap">
                      {log.appliedMm} mm
                    </td>
                    <td className="px-4 py-3 text-slate-200 whitespace-nowrap">
                      {formatNumber(Math.round(litres), lang)} {t('units.litres')}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          log.source === 'recommended'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                            : 'bg-slate-800 text-slate-300 border border-slate-700'
                        }`}
                      >
                        {log.source === 'recommended'
                          ? t('fieldDetail.sourceRecommended')
                          : t('fieldDetail.sourceManual')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400 max-w-xs truncate">
                      {log.note || '—'}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        disabled={isDeleting}
                        onClick={() => {
                          if (window.confirm(t('fieldDetail.deleteLogConfirm'))) {
                            void onDeleteLog(log.id);
                          }
                        }}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 transition-colors cursor-pointer disabled:opacity-50"
                        title={t('common.delete')}
                        aria-label={t('common.delete')}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
