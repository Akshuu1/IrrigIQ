import { useState, useEffect } from 'react';
import {
  flushQueue,
  getAllMutations,
  getPendingMutations,
  isQueueFlushing,
  getLastSyncTime,
  subscribeToQueue,
  enqueueMutation,
  removeMutation,
} from './queue.js';
import {
  getFieldDrafts,
  getFieldDraft,
  removeFieldDraft,
  setCachedField,
  FieldDraft,
} from './db.js';

let isInitialized = false;

export function initOfflineSync(onSyncSuccess?: () => void): () => void {
  if (typeof window === 'undefined' || isInitialized) {
    return () => {};
  }
  isInitialized = true;

  const handleOnline = () => {
    flushQueue().then((res) => {
      if (res.applied > 0 && onSyncSuccess) {
        onSyncSuccess();
      }
    });
  };

  window.addEventListener('online', handleOnline);

  // Initial flush on app start
  if (navigator.onLine) {
    flushQueue().then((res) => {
      if (res.applied > 0 && onSyncSuccess) {
        onSyncSuccess();
      }
    });
  }

  return () => {
    window.removeEventListener('online', handleOnline);
    isInitialized = false;
  };
}

export async function resolveConflictKeepMine(fieldId: string): Promise<void> {
  const draft = await getFieldDraft(fieldId);
  if (!draft) return;

  // Find and remove the old conflict mutation
  const mutations = await getAllMutations();
  const old = mutations.find((m) => m.fieldId === fieldId && m.status === 'conflict');
  if (old) {
    await removeMutation(old.clientId);
  }

  // Remove the draft
  await removeFieldDraft(fieldId);

  // Enqueue a fresh update using the new server version as baseVersion
  await enqueueMutation({
    type: 'update_field',
    fieldId,
    baseVersion: draft.serverVersion,
    payload: draft.draftPayload,
  });

  if (navigator.onLine) {
    await flushQueue();
  }
}

export async function resolveConflictUseServer(fieldId: string): Promise<void> {
  const draft = await getFieldDraft(fieldId);
  if (!draft) return;

  // Accept server version
  if (draft.serverField && draft.serverField.id) {
    await setCachedField(draft.serverField as any);
  }

  // Remove conflict mutation from queue
  const mutations = await getAllMutations();
  const old = mutations.find((m) => m.fieldId === fieldId && m.status === 'conflict');
  if (old) {
    await removeMutation(old.clientId);
  }

  // Remove draft
  await removeFieldDraft(fieldId);
}

export interface SyncStatus {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  failedCount: number;
  lastSyncTime: number | null;
  drafts: FieldDraft[];
}

export function useSyncStatus(): SyncStatus & {
  syncNow: () => Promise<void>;
  resolveKeepMine: (fieldId: string) => Promise<void>;
  resolveUseServer: (fieldId: string) => Promise<void>;
} {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [isSyncing, setIsSyncing] = useState<boolean>(isQueueFlushing());
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [failedCount, setFailedCount] = useState<number>(0);
  const [lastSyncTime, setLastSyncTime] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<FieldDraft[]>([]);

  const refreshState = async () => {
    setIsOnline(typeof navigator !== 'undefined' ? navigator.onLine : true);
    setIsSyncing(isQueueFlushing());

    try {
      const pending = await getPendingMutations();
      const all = await getAllMutations();
      const failed = all.filter((m) => m.status === 'failed');
      const time = await getLastSyncTime();
      const d = await getFieldDrafts();

      setPendingCount(pending.length);
      setFailedCount(failed.length);
      setLastSyncTime(time);
      setDrafts(d);
    } catch {
      // IndexedDB might not be available in SSR or test
    }
  };

  useEffect(() => {
    refreshState();

    const handleOnline = () => {
      setIsOnline(true);
      refreshState();
    };
    const handleOffline = () => {
      setIsOnline(false);
      refreshState();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    const unsubscribe = subscribeToQueue(refreshState);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      unsubscribe();
    };
  }, []);

  const syncNow = async () => {
    await flushQueue();
    await refreshState();
  };

  return {
    isOnline,
    isSyncing,
    pendingCount,
    failedCount,
    lastSyncTime,
    drafts,
    syncNow,
    resolveKeepMine: async (fieldId: string) => {
      await resolveConflictKeepMine(fieldId);
      await refreshState();
    },
    resolveUseServer: async (fieldId: string) => {
      await resolveConflictUseServer(fieldId);
      await refreshState();
    },
  };
}

