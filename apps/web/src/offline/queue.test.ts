import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  enqueueMutation,
  getPendingMutations,
  getAllMutations,
  retryMutation,
  flushQueue,
} from './queue.js';
import {
  getDB,
  clearAllUserData,
  setCachedField,
  getCachedField,
  getFieldDrafts,
  saveFieldDraft,
} from './db.js';
import * as client from '../api/client.js';

describe('Offline Mutation Queue & IndexedDB Tests', () => {
  beforeEach(async () => {
    await clearAllUserData();
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    await clearAllUserData();
  });

  describe('Queue Order (FIFO)', () => {
    it('enqueues mutations and retrieves them in FIFO order', async () => {
      // Enqueue 3 mutations sequentially
      const mut1 = await enqueueMutation({
        type: 'create_irrigation_log',
        fieldId: 'field-1',
        payload: { date: '2026-10-01', appliedMm: 10, source: 'manual' },
      });

      // Small delay to ensure strictly increasing timestamps
      await new Promise((r) => setTimeout(r, 10));

      const mut2 = await enqueueMutation({
        type: 'update_field',
        fieldId: 'field-1',
        baseVersion: 1,
        payload: { name: 'Field Renamed' },
      });

      await new Promise((r) => setTimeout(r, 10));

      const mut3 = await enqueueMutation({
        type: 'create_irrigation_log',
        fieldId: 'field-2',
        payload: { date: '2026-10-02', appliedMm: 20, source: 'recommended' },
      });

      const pending = await getPendingMutations();
      expect(pending).toHaveLength(3);
      expect(pending[0]?.clientId).toBe(mut1.clientId);
      expect(pending[1]?.clientId).toBe(mut2.clientId);
      expect(pending[2]?.clientId).toBe(mut3.clientId);
      expect(pending[0]!.timestamp).toBeLessThan(pending[1]!.timestamp);
      expect(pending[1]!.timestamp).toBeLessThan(pending[2]!.timestamp);
    });
  });

  describe('Optimistic Local Writes', () => {
    it('optimistically updates field in IndexedDB when enqueuing field update', async () => {
      // Seed a cached field
      const initialField: any = {
        id: 'field-123',
        userId: 'user-1',
        name: 'Original Field Name',
        version: 1,
        cropKey: 'wheat',
        sowingDate: '2026-10-01',
        soilType: 'loam',
        method: 'drip',
        baseline: { everyDays: 5, depthMm: 20 },
        areaHa: 2.0,
      };
      await setCachedField(initialField);

      // Enqueue update
      await enqueueMutation({
        type: 'update_field',
        fieldId: 'field-123',
        baseVersion: 1,
        payload: { name: 'Optimistically Renamed Field', soilType: 'clay' },
      });

      // Verify cached field in IndexedDB is updated immediately
      const cached = await getCachedField('field-123');
      expect(cached).toBeDefined();
      expect(cached?.name).toBe('Optimistically Renamed Field');
      expect(cached?.soilType).toBe('clay');
    });
  });

  describe('Flush Queue & Retries', () => {
    it('marks mutation as failed and increments retryCount when upstream fails', async () => {
      // Mock apiFetch to fail
      vi.spyOn(client, 'apiFetch').mockRejectedValue(new Error('Network unreachable'));

      await enqueueMutation({
        type: 'create_irrigation_log',
        fieldId: 'field-fail-test',
        payload: { date: '2026-10-05', appliedMm: 15, source: 'manual' },
      });

      // Flush queue
      const res = await flushQueue();
      expect(res.errors).toBe(1);

      // Verify queue item is marked failed with error details and retry count
      const all = await getAllMutations();
      expect(all).toHaveLength(1);
      expect(all[0]?.status).toBe('failed');
      expect(all[0]?.error).toContain('Network unreachable');
      expect(all[0]?.retryCount).toBe(1);
    });

    it('retrying a failed mutation resets status to pending', async () => {
      const mut = await enqueueMutation({
        type: 'create_irrigation_log',
        fieldId: 'field-retry-test',
        payload: { date: '2026-10-05', appliedMm: 15, source: 'manual' },
      });

      // Manually set to failed
      const db = await getDB();
      mut.status = 'failed';
      mut.error = 'Previous timeout';
      mut.retryCount = 1;
      await db.put('mutationQueue', mut);

      const pending = await getPendingMutations();
      expect(pending[0]?.status).toBe('failed');

      // Retry
      await retryMutation(mut.clientId);

      const refreshed = await db.get('mutationQueue', mut.clientId);
      expect(refreshed?.status).toBe('pending');
      expect(refreshed?.error).toBeUndefined();
    });

    it('successfully flushes applied mutation and removes it from queue', async () => {
      const mut = await enqueueMutation({
        type: 'create_irrigation_log',
        fieldId: 'field-apply-test',
        payload: { date: '2026-10-05', appliedMm: 15, source: 'manual' },
      });

      // Mock apiFetch to return successful sync
      vi.spyOn(client, 'apiFetch').mockResolvedValue({
        results: [
          {
            clientId: mut.clientId,
            type: 'create_irrigation_log',
            status: 'applied',
            fieldId: 'field-apply-test',
            appliedLog: { id: 'log-101', appliedMm: 15 },
          },
        ],
      });

      const res = await flushQueue();
      expect(res.applied).toBe(1);

      // Mutation must be removed from queue
      const pending = await getPendingMutations();
      expect(pending).toHaveLength(0);
    });
  });

  describe('Conflict Detection & Draft Store', () => {
    it('saves draft to fieldDrafts store when server returns version conflict', async () => {
      const mut = await enqueueMutation({
        type: 'update_field',
        fieldId: 'field-conflict-test',
        baseVersion: 1,
        payload: { name: 'My Offline Version' },
      });

      // Mock apiFetch returning conflict
      vi.spyOn(client, 'apiFetch').mockResolvedValue({
        results: [
          {
            clientId: mut.clientId,
            type: 'update_field',
            status: 'conflict',
            fieldId: 'field-conflict-test',
            serverVersion: 3,
            serverField: { id: 'field-conflict-test', name: 'Server Version 3', version: 3 },
            error: 'Conflict: server version is 3',
          },
        ],
      });

      const res = await flushQueue();
      expect(res.conflicts).toBe(1);

      // Verify draft saved
      const drafts = await getFieldDrafts();
      expect(drafts).toHaveLength(1);
      expect(drafts[0]?.fieldId).toBe('field-conflict-test');
      expect(drafts[0]?.serverVersion).toBe(3);
      expect(drafts[0]?.draftPayload.name).toBe('My Offline Version');
    });
  });

  describe('User Logout & Cache Erasure', () => {
    it('clearAllUserData completely erases fields, plans, crops, and pending queue', async () => {
      await setCachedField({ id: 'f-1', name: 'Test' } as any);
      await enqueueMutation({
        type: 'create_irrigation_log',
        fieldId: 'f-1',
        payload: { date: '2026-10-10', appliedMm: 10, source: 'manual' },
      });
      await saveFieldDraft({
        fieldId: 'f-1',
        baseVersion: 1,
        serverVersion: 2,
        draftPayload: {},
        serverField: {},
        createdAt: Date.now(),
      });

      // Verify records exist
      expect((await getAllMutations()).length).toBeGreaterThan(0);
      expect((await getFieldDrafts()).length).toBeGreaterThan(0);

      // Call clearAllUserData
      await clearAllUserData();

      // Everything must be empty
      expect(await getAllMutations()).toHaveLength(0);
      expect(await getFieldDrafts()).toHaveLength(0);
      expect(await getCachedField('f-1')).toBeUndefined();
    });
  });
});
