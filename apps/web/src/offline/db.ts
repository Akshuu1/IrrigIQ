import { openDB, DBSchema, IDBPDatabase } from 'idb';
import type { Crop } from '@irrigiq/shared';
import type { Field } from '../api/client.js';

export interface QueuedMutation {
  clientId: string;
  type: 'create_irrigation_log' | 'update_field';
  fieldId: string;
  baseVersion?: number;
  payload: Record<string, any>;
  timestamp: number;
  status: 'pending' | 'processing' | 'failed' | 'conflict';
  error?: string;
  retryCount: number;
}

export interface FieldDraft {
  fieldId: string;
  baseVersion: number;
  serverVersion: number;
  draftPayload: Record<string, any>;
  serverField: Record<string, any>;
  createdAt: number;
}

export interface StoredPlan {
  fieldId: string;
  days: any[];
  summary: any;
  cachedAt: number;
}

interface IrrigIQDB extends DBSchema {
  fields: {
    key: string;
    value: Field;
  };
  plans: {
    key: string;
    value: StoredPlan;
  };
  crops: {
    key: string;
    value: Crop;
  };
  preferences: {
    key: string;
    value: any;
  };
  mutationQueue: {
    key: string;
    value: QueuedMutation;
    indexes: { 'by-status': string; 'by-timestamp': number };
  };
  fieldDrafts: {
    key: string;
    value: FieldDraft;
  };
}

const DB_NAME = 'irrigiq-offline-db';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<IrrigIQDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<IrrigIQDB>> {
  if (!dbPromise) {
    dbPromise = openDB<IrrigIQDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('fields')) {
          db.createObjectStore('fields', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('plans')) {
          db.createObjectStore('plans', { keyPath: 'fieldId' });
        }
        if (!db.objectStoreNames.contains('crops')) {
          db.createObjectStore('crops', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('preferences')) {
          db.createObjectStore('preferences', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('mutationQueue')) {
          const queueStore = db.createObjectStore('mutationQueue', { keyPath: 'clientId' });
          queueStore.createIndex('by-status', 'status');
          queueStore.createIndex('by-timestamp', 'timestamp');
        }
        if (!db.objectStoreNames.contains('fieldDrafts')) {
          db.createObjectStore('fieldDrafts', { keyPath: 'fieldId' });
        }
      },
    });
  }
  return dbPromise;
}

// Fields Store
export async function getCachedFields(): Promise<Field[]> {
  const db = await getDB();
  return db.getAll('fields');
}

export async function getCachedField(id: string): Promise<Field | undefined> {
  const db = await getDB();
  return db.get('fields', id);
}

export async function setCachedFields(fields: Field[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('fields', 'readwrite');
  await Promise.all([
    ...fields.map((f) => tx.store.put(f)),
    tx.done,
  ]);
}

export async function setCachedField(field: Field): Promise<void> {
  const db = await getDB();
  await db.put('fields', field);
}

// Plans Store
export async function getCachedPlan(fieldId: string): Promise<StoredPlan | undefined> {
  const db = await getDB();
  return db.get('plans', fieldId);
}

export async function setCachedPlan(fieldId: string, plan: { days: any[]; summary: any }): Promise<void> {
  const db = await getDB();
  await db.put('plans', {
    fieldId,
    days: plan.days,
    summary: plan.summary,
    cachedAt: Date.now(),
  });
}

// Crops Store
export async function getCachedCrops(): Promise<Crop[]> {
  const db = await getDB();
  return db.getAll('crops');
}

export async function setCachedCrops(crops: Crop[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('crops', 'readwrite');
  await Promise.all([
    ...crops.map((c) => tx.store.put(c)),
    tx.done,
  ]);
}

// Preferences / Metadata
export async function getPreference<T>(key: string): Promise<T | undefined> {
  const db = await getDB();
  const res = await db.get('preferences', key);
  return res ? (res.value as T) : undefined;
}

export async function setPreference(key: string, value: any): Promise<void> {
  const db = await getDB();
  await db.put('preferences', { key, value });
}

// Field Drafts (Conflict Store)
export async function getFieldDrafts(): Promise<FieldDraft[]> {
  const db = await getDB();
  return db.getAll('fieldDrafts');
}

export async function getFieldDraft(fieldId: string): Promise<FieldDraft | undefined> {
  const db = await getDB();
  return db.get('fieldDrafts', fieldId);
}

export async function saveFieldDraft(draft: FieldDraft): Promise<void> {
  const db = await getDB();
  await db.put('fieldDrafts', draft);
}

export async function removeFieldDraft(fieldId: string): Promise<void> {
  const db = await getDB();
  await db.delete('fieldDrafts', fieldId);
}

// Clear all local data on logout
export async function clearAllUserData(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(
    ['fields', 'plans', 'crops', 'preferences', 'mutationQueue', 'fieldDrafts'],
    'readwrite',
  );
  await Promise.all([
    tx.objectStore('fields').clear(),
    tx.objectStore('plans').clear(),
    tx.objectStore('crops').clear(),
    tx.objectStore('preferences').clear(),
    tx.objectStore('mutationQueue').clear(),
    tx.objectStore('fieldDrafts').clear(),
    tx.done,
  ]);
}
