import React, { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Header } from './Header.js';
import { OfflineBanner } from './OfflineBanner.js';
import { ConflictResolutionModal } from './ConflictResolutionModal.js';
import { initOfflineSync } from '../offline/sync-manager.js';

export function Layout({ children }: { children: React.ReactNode }): React.JSX.Element {
  const queryClient = useQueryClient();

  useEffect(() => {
    const cleanup = initOfflineSync(() => {
      queryClient.invalidateQueries();
    });
    return cleanup;
  }, [queryClient]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-slate-950">
      <Header />
      <OfflineBanner />
      <ConflictResolutionModal />
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">{children}</main>
      <footer className="w-full border-t border-slate-900 bg-slate-950 py-6 text-xs text-slate-500">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div>
            IrrigIQ © 2026 • FAO-56 Penman-Monteith Irrigation Science for Indian Smallholders
          </div>
          <div className="flex items-center gap-3 font-medium text-slate-400">
            <span>Tailwind v4</span>
            <span>•</span>
            <span>TanStack Query</span>
            <span>•</span>
            <span>OpenStreetMap</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
