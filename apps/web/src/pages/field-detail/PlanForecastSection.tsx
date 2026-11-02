import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from 'recharts';
import { type Recommendation } from '../../api/client.js';
import { formatDate } from '../../utils/formatters.js';
import { Droplet, Calendar, Sparkles } from 'lucide-react';

interface PlanForecastSectionProps {
  recommendations: Recommendation[];
}

export function PlanForecastSection({
  recommendations,
}: PlanForecastSectionProps): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language || 'en') as 'en' | 'hi';

  const chartData = recommendations.map((r) => {
    const isIrrigate = r.plan.action === 'irrigate';
    return {
      date: r.forDate,
      displayDate: formatDate(r.forDate, lang, { day: 'numeric', month: 'short' }),
      etcMm: r.dailyNeeds.etcMm,
      rainMm: r.dailyNeeds.rainMm,
      isIrrigate,
      grossMm: r.plan.grossMm,
      litres: r.plan.litres,
    };
  });

  return (
    <div className="bg-slate-900 border-2 border-slate-800 rounded-3xl p-5 sm:p-7 shadow-xl space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-white flex items-center gap-2.5">
            <Calendar className="w-5 h-5 text-emerald-400" />
            <span>{t('fieldDetail.planChartTitle')}</span>
          </h2>
        </div>
      </div>

      {/* Recharts Bar Chart */}
      <div className="w-full h-72 sm:h-80 pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <XAxis
              dataKey="displayDate"
              stroke="#94a3b8"
              fontSize={12}
              tickLine={false}
              axisLine={{ stroke: '#334155' }}
            />
            <YAxis
              stroke="#94a3b8"
              fontSize={12}
              tickLine={false}
              axisLine={{ stroke: '#334155' }}
              unit=" mm"
            />
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const data = payload[0]?.payload;
                  return (
                    <div className="bg-slate-950 border border-slate-700 rounded-xl p-3 shadow-2xl text-xs space-y-1.5 min-w-[150px]">
                      <div className="font-bold text-white border-b border-slate-800 pb-1">
                        {data.displayDate}
                      </div>
                      <div className="text-emerald-400 flex justify-between">
                        <span>{t('fieldDetail.planCropNeedLegend')}:</span>
                        <span className="font-bold">{data.etcMm} mm</span>
                      </div>
                      <div className="text-sky-400 flex justify-between">
                        <span>{t('fieldDetail.planRainLegend')}:</span>
                        <span className="font-bold">{data.rainMm} mm</span>
                      </div>
                      {data.isIrrigate && (
                        <div className="pt-1 border-t border-slate-800 text-amber-300 font-bold flex items-center gap-1">
                          <Droplet className="w-3.5 h-3.5 fill-amber-300" />
                          <span>
                            {t('fieldDetail.actionIrrigate')}: {data.grossMm} mm
                          </span>
                        </div>
                      )}
                    </div>
                  );
                }
                return null;
              }}
            />
            <Legend
              wrapperStyle={{ paddingTop: '12px', fontSize: '12px' }}
              formatter={(value) => <span className="text-slate-300">{value}</span>}
            />
            <Bar
              dataKey="etcMm"
              name={t('fieldDetail.planCropNeedLegend')}
              fill="#10b981"
              radius={[4, 4, 0, 0]}
            />
            <Bar
              dataKey="rainMm"
              name={t('fieldDetail.planRainLegend')}
              fill="#38bdf8"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Daily Breakdown Table */}
      <div className="space-y-3">
        <h3 className="text-base font-bold text-white">{t('fieldDetail.planTableTitle')}</h3>
        <div className="overflow-x-auto rounded-2xl border border-slate-800">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-950 text-xs uppercase tracking-wider text-slate-400 border-b border-slate-800">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t('fieldDetail.tableColDate')}
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t('fieldDetail.tableColEtc')}
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t('fieldDetail.tableColRain')}
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t('fieldDetail.tableColAction')}
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  {t('fieldDetail.tableColReason')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 bg-slate-900/60 font-medium">
              {recommendations.map((r) => {
                const isIrrigate = r.plan.action === 'irrigate';
                const key = r.plan.reasonKey.replace('reason.', '');
                const reasonParams = r.plan.reasonParams || {};
                const reasonText = t(`reasons.${key}`, {
                  ...reasonParams,
                  defaultValue: t('reasons.not_needed'),
                });

                return (
                  <tr key={r.forDate} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-4 py-3 text-white font-semibold whitespace-nowrap">
                      {formatDate(r.forDate, lang, { day: 'numeric', month: 'short' })}
                    </td>
                    <td className="px-4 py-3 text-emerald-400 whitespace-nowrap">
                      {r.dailyNeeds.etcMm} mm
                    </td>
                    <td className="px-4 py-3 text-sky-400 whitespace-nowrap">
                      {r.dailyNeeds.rainMm} mm
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {isIrrigate ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-extrabold bg-emerald-500 text-slate-950 shadow-sm">
                          <Droplet className="w-3 h-3 fill-slate-950" />
                          <span>{t('fieldDetail.actionIrrigate')} ({r.plan.grossMm} mm)</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-800 text-slate-400 border border-slate-700">
                          {t('fieldDetail.actionSkip')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-300 max-w-xs">
                      <div className="flex items-start gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                        <span>{reasonText}</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
