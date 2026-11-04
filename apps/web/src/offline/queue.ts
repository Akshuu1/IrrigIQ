import {
  getDB,
  QueuedMutation,
  setCachedField,
  getCachedField,
  saveFieldDraft,
  setPreference,
  getPreference,
} from './db.js';
import type { SyncMutation, SyncResultItem } from '@irrigiq/shared';
import { apiFetch } from '../api/client.js';

let isFlushing = false;
type QueueListener = () => void;
const listeners = new Set<QueueListener>();

export function subscribeToQueue(listener: QueueListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyListeners() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // ignore
    }
  });
}

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'mut-' + Math.random().toString(36).substring(2, 11) + '-' + Date.now();
}

/**
 * Enqueue a mutation for offline execution.
 * Saves locally first and applies optimistic updates.
 */
export async function enqueueMutation(
  input: Omit<QueuedMutation, 'clientId' | 'timestamp' | 'status' | 'retryCount'>,
): Promise<QueuedMutation> {
  const db = await getDB();
  const clientId = generateUUID();
  const mutation: QueuedMutation = {
    ...input,
    clientId,
    timestamp: Date.now(),
    status: 'pending',
    retryCount: 0,
  };

  await db.put('mutationQueue', mutation);

  // Apply optimistic local update to IndexedDB
  if (mutation.type === 'update_field' && mutation.fieldId) {
    const existing = await getCachedField(mutation.fieldId);
    if (existing) {
      const updated = {
        ...existing,
        ...mutation.payload,
        updatedAt: new Date().toISOString(),
      };
      await setCachedField(updated);
    }
  }

  notifyListeners();

  // If online, attempt to flush queue immediately
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    flushQueue().catch(() => {
      // Background flush error handled in queue status
    });
  }

  return mutation;
}

export async function getAllMutations(): Promise<QueuedMutation[]> {
  const db = await getDB();
  const all = await db.getAll('mutationQueue');
  return all.sort((a, b) => a.timestamp - b.timestamp);
}

export async function getPendingMutations(): Promise<QueuedMutation[]> {
  const db = await getDB();
  const all = await db.getAll('mutationQueue');
  return all
    .filter((m) => m.status === 'pending' || m.status === 'failed')
    .sort((a, b) => a.timestamp - b.timestamp);
}

export async function removeMutation(clientId: string): Promise<void> {
  const db = await getDB();
  await db.delete('mutationQueue', clientId);
  notifyListeners();
}

export async function retryMutation(clientId: string): Promise<void> {
  const db = await getDB();
  const mutation = await db.get('mutationQueue', clientId);
  if (mutation) {
    mutation.status = 'pending';
    mutation.error = undefined;
    await db.put('mutationQueue', mutation);
    notifyListeners();
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      flushQueue();
    }
  }
}

export async function getLastSyncTime(): Promise<number | null> {
  const time = await getPreference<number>('lastSyncTime');
  return time ?? null;
}

/**
 * Flush all pending mutations to POST /sync.
 * Guaranteed FIFO ordering and idempotency.
 */
export async function flushQueue(): Promise<{
  applied: number;
  conflicts: number;
  errors: number;
}> {
  if (isFlushing) {
    return { applied: 0, conflicts: 0, errors: 0 };
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { applied: 0, conflicts: 0, errors: 0 };
  }

  isFlushing = true;
  notifyListeners();

  let appliedCount = 0;
  let conflictCount = 0;
  let errorCount = 0;

  try {
    const pending = await getPendingMutations();
    if (pending.length === 0) {
      await setPreference('lastSyncTime', Date.now());
      return { applied: 0, conflicts: 0, errors: 0 };
    }

    const db = await getDB();

    // Mark as processing
    for (const m of pending) {
      m.status = 'processing';
      await db.put('mutationQueue', m);
    }
    notifyListeners();

    // Prepare batch
    const mutationsPayload: SyncMutation[] = pending.map((m) => ({
      clientId: m.clientId,
      type: m.type,
      fieldId: m.fieldId,
      baseVersion: m.baseVersion,
      payload: m.payload,
      timestamp: m.timestamp,
    }));

    // Send batch to backend POST /sync
    const response = await apiFetch<{ results: SyncResultItem[] }>('/sync', {
      method: 'POST',
      body: JSON.stringify({ mutations: mutationsPayload }),
    });

    const results = response.results || [];

    for (const res of results) {
      const mut = pending.find((p) => p.clientId === res.clientId);
      if (!mut) continue;

      if (res.status === 'applied') {
        appliedCount++;
        // Remove from queue upon success
        await db.delete('mutationQueue', mut.clientId);

        // If field was updated, update local cache with fresh server version
        if (res.serverField && typeof res.serverField === 'object') {
          await setCachedField(res.serverField as any);
        }
      } else if (res.status === 'conflict') {
        conflictCount++;
        mut.status = 'conflict';
        mut.error = res.error || 'Version conflict';
        await db.put('mutationQueue', mut);

        // Store conflict draft for UI resolution
        if (res.serverField) {
          await saveFieldDraft({
            fieldId: res.fieldId || mut.fieldId || '',
            baseVersion: mut.baseVersion ?? 1,
            serverVersion: res.serverVersion ?? 2,
            draftPayload: mut.payload,
            serverField: res.serverField as Record<string, any>,
            createdAt: Date.now(),
          });
        }
      } else {
        errorCount++;
        mut.status = 'failed';
        mut.error = res.error || 'Sync failed';
        mut.retryCount += 1;
        await db.put('mutationQueue', mut);
      }
    }

    await setPreference('lastSyncTime', Date.now());
  } catch (err: unknown) {
    // Entire network call failed, revert processing mutations to failed
    const db = await getDB();
    const all = await db.getAll('mutationQueue');
    for (const m of all) {
      if (m.status === 'processing') {
        m.status = 'failed';
        m.error = err instanceof Error ? err.message : 'Network failure';
        m.retryCount += 1;
        await db.put('mutationQueue', m);
      }
    }
    errorCount++;
  } finally {
    isFlushing = false;
    notifyListeners();
  }

  return { applied: appliedCount, conflicts: conflictCount, errors: errorCount };
}

export function isQueueFlushing(): boolean {
  return isFlushing;
}

export type { QueuedMutation };
