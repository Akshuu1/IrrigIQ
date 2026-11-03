import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, type IrrigationLog } from '../api/client.js';
import { useAuth } from '../context/AuthContext.js';
import { formatArea } from '../utils/formatters.js';
import { CROPS_MAP } from '@irrigiq/shared';
import { TodayAdvisoryCard } from './field-detail/TodayAdvisoryCard.js';
import { PlanForecastSection } from './field-detail/PlanForecastSection.js';
import { SoilMoistureLiveSection } from './field-detail/SoilMoistureLiveSection.js';
import { SavingsCard } from './field-detail/SavingsCard.js';
import { IrrigationLogModal } from './field-detail/IrrigationLogModal.js';
import { RecentLogsTable } from './field-detail/RecentLogsTable.js';
import { OfflineFieldMap } from '../components/OfflineFieldMap.js';
import {
  ArrowLeft,
  Wheat,
  Calendar,
  RotateCw,
  CheckCircle2,
} from 'lucide-react';

export function FieldDetail(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const fieldId = id || '';

  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const lang = (i18n.language || user?.language || 'en') as 'en' | 'hi';
  const unit = user?.areaUnit || 'acre';

  const [isLogModalOpen, setIsLogModalOpen] = useState(false);
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [deletingLogId, setDeletingLogId] = useState<string | null>(null);

  // 1. Fetch Field Info
  const {
    data: field,
    isLoading: isFieldLoading,
    isError: isFieldError,
    refetch: refetchField,
  } = useQuery({
    queryKey: ['field', fieldId],
    queryFn: () => api.getField(fieldId),
    enabled: !!fieldId,
  });

  // 2. Fetch 7-day recommendations
  const {
    data: recommendations = [],
    isLoading: isRecsLoading,
    refetch: refetchRecs,
  } = useQuery({
    queryKey: ['recommendations', fieldId],
    queryFn: () => api.getRecommendations(fieldId, 7),
    enabled: !!fieldId,
  });

  // 3. Fetch irrigation logs
  const {
    data: logsData,
    isLoading: isLogsLoading,
    refetch: refetchLogs,
  } = useQuery({
    queryKey: ['logs', fieldId],
    queryFn: () => api.getLogs(fieldId),
    enabled: !!fieldId,
  });

  // 4. Fetch savings summary
  const todayStr = new Date().toISOString().split('T')[0] || '';
  const sowingDateStr = field?.sowingDate
    ? new Date(field.sowingDate).toISOString().split('T')[0] || todayStr
    : todayStr;
  const fromDate = sowingDateStr <= todayStr ? sowingDateStr : todayStr;

  const {
    data: savings,
    isLoading: isSavingsLoading,
    refetch: refetchSavings,
  } = useQuery({
    queryKey: ['savings', fieldId, fromDate, todayStr],
    queryFn: () => api.getSavings(fieldId, fromDate, todayStr),
    enabled: !!fieldId && !!field,
  });

  // Mutation: Log Irrigation with Optimistic Updates
  const createLogMutation = useMutation({
    networkMode: 'always',
    mutationFn: (data: {
      date: string;
      appliedMm: number;
      source: 'recommended' | 'manual';
      note?: string;
    }) => api.createLog(fieldId, data),
    onMutate: async (newLogInput) => {
      await queryClient.cancelQueries({ queryKey: ['logs', fieldId] });
      const previousLogs = queryClient.getQueryData<{ logs: IrrigationLog[] }>(['logs', fieldId]);

      if (previousLogs && field && user) {
        const optimisticLog: IrrigationLog = {
          id: `temp-${Date.now()}`,
          fieldId,
          userId: user.id,
          date: newLogInput.date,
          appliedMm: newLogInput.appliedMm,
          source: newLogInput.source,
          note: newLogInput.note,
          createdAt: new Date().toISOString(),
        };

        queryClient.setQueryData(['logs', fieldId], {
          logs: [optimisticLog, ...previousLogs.logs],
        });
      }

      return { previousLogs };
    },
    onError: (_err, _newLog, context) => {
      if (context?.previousLogs) {
        queryClient.setQueryData(['logs', fieldId], context.previousLogs);
      }
    },
    onSuccess: () => {
      setIsLogModalOpen(false);
      setSuccessToast(t('fieldDetail.logSuccess'));
      setTimeout(() => setSuccessToast(null), 4000);

      // Invalidate and refresh recommendations, savings, and logs
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ['recommendations', fieldId] }),
        queryClient.invalidateQueries({ queryKey: ['savings', fieldId] }),
        queryClient.invalidateQueries({ queryKey: ['logs', fieldId] }),
      ]);
    },
  });

  // Mutation: Delete Irrigation Log with Optimistic Updates
  const deleteLogMutation = useMutation({
    mutationFn: (logId: string) => api.deleteLog(fieldId, logId),
    onMutate: async (logIdToDelete) => {
      setDeletingLogId(logIdToDelete);
      await queryClient.cancelQueries({ queryKey: ['logs', fieldId] });
      const previousLogs = queryClient.getQueryData<{ logs: IrrigationLog[] }>(['logs', fieldId]);

      if (previousLogs) {
        queryClient.setQueryData(['logs', fieldId], {
          logs: previousLogs.logs.filter((l) => l.id !== logIdToDelete),
        });
      }

      return { previousLogs };
    },
    onError: (_err, _logId, context) => {
      if (context?.previousLogs) {
        queryClient.setQueryData(['logs', fieldId], context.previousLogs);
      }
    },
    onSettled: () => {
      setDeletingLogId(null);
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ['recommendations', fieldId] }),
        queryClient.invalidateQueries({ queryKey: ['savings', fieldId] }),
        queryClient.invalidateQueries({ queryKey: ['logs', fieldId] }),
      ]);
    },
  });

  // Loading skeleton state
  if (isFieldLoading) {
    return (
      <div className="space-y-6 animate-pulse py-4">
        <div className="h-8 bg-slate-800 rounded-lg w-1/4" />
        <div className="h-44 bg-slate-900 border border-slate-800 rounded-3xl" />
        <div className="h-72 bg-slate-900 border border-slate-800 rounded-3xl" />
      </div>
    );
  }

  // Error state
  if (isFieldError || !field) {
    return (
      <div className="bg-rose-950/60 border border-rose-800 rounded-3xl p-8 text-center space-y-4 my-8 max-w-lg mx-auto">
        <p className="text-rose-200 font-bold">{t('common.error')}</p>
        <button
          type="button"
          onClick={() => {
            void refetchField();
            void refetchRecs();
            void refetchLogs();
            void refetchSavings();
          }}
          className="px-5 py-2.5 rounded-xl bg-rose-900 hover:bg-rose-800 text-white font-bold text-sm inline-flex items-center gap-2 cursor-pointer shadow-md"
        >
          <RotateCw className="w-4 h-4" />
          <span>{t('common.retry')}</span>
        </button>
      </div>
    );
  }

  const crop = CROPS_MAP.get(field.cropKey);
  const localizedCropName = crop
    ? lang === 'hi'
      ? crop.nameHi
      : crop.nameEn
    : t(`crops.${field.cropKey}`, { defaultValue: field.cropKey });

  const soilLabel =
    field.soilType === 'sandy'
      ? t('fieldWizard.soilSandy')
      : field.soilType === 'clay'
        ? t('fieldWizard.soilClay')
        : t('fieldWizard.soilLoam');

  const methodLabel =
    field.method === 'drip'
      ? t('fieldWizard.methodDrip')
      : field.method === 'sprinkler'
        ? t('fieldWizard.methodSprinkler')
        : t('fieldWizard.methodFlood');

  const daysAfterSowing = Math.max(
    0,
    Math.floor(
      (new Date().getTime() - new Date(field.sowingDate).getTime()) / (1000 * 60 * 60 * 24),
    ),
  );

  return (
    <div className="space-y-6 sm:space-y-8 pb-12">
      {/* Top Navigation & Breadcrumbs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-xs sm:text-sm text-slate-400 hover:text-white transition-colors mb-2 font-semibold"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>{t('fieldDetail.backToDashboard')}</span>
          </Link>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight">
              {field.name}
            </h1>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
              <Wheat className="w-3.5 h-3.5" />
              <span>{localizedCropName}</span>
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs sm:text-sm text-slate-400 mt-1 font-medium">
            <span>{formatArea(field.areaHa, unit, lang)}</span>
            <span>•</span>
            <span className="capitalize">{soilLabel}</span>
            <span>•</span>
            <span className="capitalize">{methodLabel}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-400 self-start sm:self-auto bg-slate-900 border border-slate-800 px-3.5 py-2 rounded-xl">
          <Calendar className="w-4 h-4 text-emerald-400" />
          <span>{t('dashboard.daysAfterSowing', { days: daysAfterSowing })}</span>
        </div>
      </div>

      {/* Success Notification Toast */}
      {successToast && (
        <div
          className="p-4 rounded-2xl bg-emerald-950/80 border border-emerald-600 text-emerald-200 text-sm font-semibold flex items-center gap-2.5 animate-fade-in shadow-lg"
          role="status"
        >
          <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
          <span>{successToast}</span>
        </div>
      )}

      {/* 1. Today's Big Advisory Answer */}
      <TodayAdvisoryCard
        field={field}
        todayRecommendation={recommendations[0]}
        onOpenLogModal={() => setIsLogModalOpen(true)}
      />

      {/* 2. 7-Day Plan Forecast (Recharts BarChart + Table) */}
      {!isRecsLoading && recommendations.length > 0 && (
        <PlanForecastSection recommendations={recommendations} />
      )}

      {/* 3. Live Soil Moisture Line Chart & IoT Telemetry (SSE) */}
      <SoilMoistureLiveSection fieldId={field.id} />

      {/* 4. Water Savings Card */}
      <SavingsCard
        savings={savings}
        isLoading={isSavingsLoading}
        fieldId={field.id}
        fieldName={field.name}
      />

      {/* 5. Recent Irrigation Logs Table */}
      {!isLogsLoading && (
        <RecentLogsTable
          field={field}
          logs={logsData?.logs || []}
          onDeleteLog={async (logId) => {
            await deleteLogMutation.mutateAsync(logId);
          }}
          isDeletingId={deletingLogId}
        />
      )}

      {/* 6. Vector Field Boundary (Safe Offline Rendering) */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 space-y-3">
        <h3 className="text-base sm:text-lg font-bold text-white">
          {t('fieldDetail.fieldMapOutline', 'Field Boundary & Vector Outline')}
        </h3>
        <OfflineFieldMap geometry={field.geometry} areaHa={field.areaHa} fieldName={field.name} />
      </div>

      {/* "I Irrigated" Modal */}
      <IrrigationLogModal
        field={field}
        todayRecommendation={recommendations[0]}
        isOpen={isLogModalOpen}
        onClose={() => setIsLogModalOpen(false)}
        onSubmit={async (data) => {
          await createLogMutation.mutateAsync(data);
        }}
        isSubmitting={createLogMutation.isPending}
      />
    </div>
  );
}

