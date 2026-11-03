import type {
  RegisterInput,
  LoginInput,
  UpdateProfileInput,
  CreateFieldInput,
  Language,
  AreaUnit,
  Crop,
  SyncMutation,
  SyncResultItem,
} from '@irrigiq/shared';
import { CROPS } from '@irrigiq/shared';
import {
  getCachedFields,
  setCachedFields,
  getCachedField,
  setCachedField,
  getCachedCrops,
  setCachedCrops,
  getCachedPlan,
  setCachedPlan,
  clearAllUserData,
} from '../offline/db.js';
import { enqueueMutation } from '../offline/queue.js';

const API_BASE = import.meta.env.VITE_API_URL || '';

let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let isRefreshing = false;
let refreshSubscribers: ((token: string) => void)[] = [];

function onRefreshed(token: string) {
  refreshSubscribers.forEach((callback) => callback(token));
  refreshSubscribers = [];
}

function addRefreshSubscriber(callback: (token: string) => void) {
  refreshSubscribers.push(callback);
}

export async function apiFetch<T>(
  endpoint: string,
  options: RequestInit = {},
  isRetry = false,
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  const headers = new Headers(options.headers || {});

  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  if (accessToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include', // sends refresh token cookie
  });

  // Handle 401 Unauthorized -> try refresh token rotation once
  if (response.status === 401 && !isRetry && !endpoint.startsWith('/auth/login') && !endpoint.startsWith('/auth/register')) {
    if (!isRefreshing) {
      isRefreshing = true;
      try {
        const refreshResponse = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
        });

        if (refreshResponse.ok) {
          const data = (await refreshResponse.json()) as {
            accessToken?: string;
            data?: { accessToken: string };
          };
          const newToken = data.data?.accessToken || data.accessToken;
          if (newToken) {
            setAccessToken(newToken);
            onRefreshed(newToken);
            isRefreshing = false;

            // Retry original request with new token
            headers.set('Authorization', `Bearer ${newToken}`);
            return apiFetch<T>(endpoint, { ...options, headers }, true);
          }
        }
      } catch {
        // Refresh failed entirely
      }

      isRefreshing = false;
      setAccessToken(null);
      // Trigger logout event or redirect if in browser
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('auth:expired'));
      }
    } else {
      // Another request is already refreshing, wait for it
      return new Promise<T>((resolve, reject) => {
        addRefreshSubscriber((token) => {
          const retryHeaders = new Headers(options.headers || {});
          retryHeaders.set('Authorization', `Bearer ${token}`);
          apiFetch<T>(endpoint, { ...options, headers: retryHeaders }, true)
            .then(resolve)
            .catch(reject);
        });
      });
    }
  }

  if (!response.ok) {
    let errorData: Record<string, unknown> = {};
    try {
      errorData = (await response.json()) as Record<string, unknown>;
    } catch {
      errorData = { message: response.statusText };
    }
    const message =
      typeof errorData['message'] === 'string'
        ? errorData['message']
        : errorData['errors']
          ? JSON.stringify(errorData['errors'])
          : `HTTP ${response.status}`;
    throw new ApiError(response.status, message, errorData);
  }

  if (response.status === 204) {
    return {} as T;
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    if (!API_BASE && typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      throw new ApiError(
        500,
        'Backend API URL is not connected. In Vercel Project Settings > Environment Variables, set VITE_API_URL=https://your-api.onrender.com and Redeploy.',
      );
    }
    throw new ApiError(500, 'Received unexpected HTML from server instead of API JSON response.');
  }

  return response.json();
}

// User & Auth types
export interface User {
  id: string;
  email: string;
  name: string;
  language: Language;
  areaUnit: AreaUnit;
  createdAt: string;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
}

// Field types
export interface Field {
  id: string;
  userId: string;
  name: string;
  geometry: {
    type: 'Polygon';
    coordinates: number[][][];
  };
  centroid: {
    type: 'Point';
    coordinates: [number, number];
  };
  areaHa: number;
  cropKey: string;
  sowingDate: string;
  soilType: 'sandy' | 'loam' | 'clay';
  method: 'drip' | 'sprinkler' | 'flood';
  baseline: {
    everyDays: number;
    depthMm: number;
  };
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Recommendation {
  id: string;
  fieldId: string;
  forDate: string;
  weatherStale: boolean;
  dailyNeeds: {
    date: string;
    et0Mm: number;
    stage: string;
    kc: number;
    etcMm: number;
    rainMm: number;
    effectiveRainMm: number;
    netNeedMm: number;
  };
  plan: {
    action: 'irrigate' | 'skip';
    grossMm: number;
    litres: number;
    reasonKey: string;
    reasonParams?: Record<string, string | number>;
    deficitMm: number;
  };
}

export interface IrrigationLog {
  id: string;
  fieldId: string;
  userId: string;
  date: string;
  appliedMm: number;
  source: 'recommended' | 'manual';
  note?: string;
  createdAt: string;
}

export interface SavingsData {
  fieldId: string;
  from: string;
  to: string;
  days: number;
  totals: {
    baseline: { grossMm: number; litres: number };
    recommended: { grossMm: number; litres: number };
    actual: { grossMm: number; litres: number };
    potentialSaved: { litres: number; pct: number };
    realisedSaved: { litres: number; pct: number };
  };
  assumptions: {
    method: string;
    efficiency: number;
    areaHa: number;
    baseline: { everyDays: number; depthMm: number };
    baselineNote: string;
  };
}

export interface Sensor {
  id: string;
  fieldId: string;
  userId: string;
  name: string;
  isSimulated: boolean;
  lastSeenAt?: string;
  createdAt: string;
}

export interface SensorReading {
  timestamp: string;
  moisturePct: number;
  tempC: number;
  count?: number;
}

export const api = {
  // Auth
  async register(data: RegisterInput): Promise<AuthResponse> {
    const res = await apiFetch<{ data?: AuthResponse } & AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return res.data || res;
  },

  async login(data: LoginInput): Promise<AuthResponse> {
    const res = await apiFetch<{ data?: AuthResponse } & AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return res.data || res;
  },

  async refresh(): Promise<{ accessToken: string }> {
    const res = await apiFetch<{ data?: { accessToken: string }; accessToken?: string }>('/auth/refresh', {
      method: 'POST',
    });
    return {
      accessToken: res.data?.accessToken || res.accessToken || '',
    };
  },

  async logout(): Promise<void> {
    try {
      await apiFetch<void>('/auth/logout', {
        method: 'POST',
      });
    } catch {
      // offline logout still proceeds
    }
    setAccessToken(null);

    // Clear all IndexedDB user data
    try {
      await clearAllUserData();
    } catch {
      // ignore
    }

    // Never keep one user's cached responses for another user (clear caches on logout)
    if (typeof window !== 'undefined' && 'caches' in window) {
      try {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map((name) => caches.delete(name)));
      } catch {
        // ignore
      }
    }
  },

  async getMe(): Promise<{ user: User }> {
    const res = await apiFetch<{ data?: { user: User }; user?: User }>('/auth/me');
    return {
      user: res.data?.user || res.user!,
    };
  },

  async updateMe(data: UpdateProfileInput): Promise<{ user: User }> {
    const res = await apiFetch<{ data?: { user: User }; user?: User }>('/auth/me', {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    return {
      user: res.data?.user || res.user!,
    };
  },

  // Crops
  async getCrops(): Promise<Crop[]> {
    try {
      const res = await apiFetch<{ data?: { crops: Crop[] }; crops?: Crop[] } | Crop[]>('/crops');
      const crops = Array.isArray(res) ? res : res.data?.crops || res.crops || [];
      setCachedCrops(crops).catch(() => {});
      return crops;
    } catch {
      const cached = await getCachedCrops();
      if (cached && cached.length > 0) {
        return cached;
      }
      return [...CROPS];
    }
  },

  // Fields
  async getFields(): Promise<Field[]> {
    try {
      const res = await apiFetch<{ data?: { fields: Field[] }; fields?: Field[] } | Field[]>('/fields');
      const fields = Array.isArray(res) ? res : res.data?.fields || res.fields || [];
      setCachedFields(fields).catch(() => {});
      return fields;
    } catch (err) {
      const cached = await getCachedFields();
      if (cached && cached.length > 0) {
        return cached;
      }
      throw err;
    }
  },

  async getField(id: string): Promise<Field> {
    try {
      const res = await apiFetch<{ data?: { field: Field }; field?: Field } | Field>(`/fields/${id}`);
      const field =
        'data' in res && res.data?.field
          ? res.data.field
          : 'field' in res && res.field
            ? res.field
            : (res as Field);
      setCachedField(field).catch(() => {});
      return field;
    } catch (err) {
      const cached = await getCachedField(id);
      if (cached) {
        return cached;
      }
      throw err;
    }
  },

  async updateField(id: string, data: Partial<Field> & { version: number }): Promise<Field> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      await enqueueMutation({
        type: 'update_field',
        fieldId: id,
        baseVersion: data.version,
        payload: data,
      });
      const cached = await getCachedField(id);
      return {
        ...(cached || ({} as Field)),
        ...data,
      } as Field;
    }

    try {
      const res = await apiFetch<{ data?: { field: Field }; field?: Field }>(`/fields/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      });
      const updated = res.data?.field || res.field || (res as unknown as Field);
      setCachedField(updated).catch(() => {});
      return updated;
    } catch (err) {
      if (err instanceof TypeError || (err instanceof ApiError && err.status >= 500)) {
        await enqueueMutation({
          type: 'update_field',
          fieldId: id,
          baseVersion: data.version,
          payload: data,
        });
        const cached = await getCachedField(id);
        return {
          ...(cached || ({} as Field)),
          ...data,
        } as Field;
      }
      throw err;
    }
  },

  async createField(data: CreateFieldInput): Promise<Field> {
    const res = await apiFetch<{ data?: { field: Field }; field?: Field } | Field>('/fields', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return 'data' in res && res.data?.field
      ? res.data.field
      : 'field' in res && res.field
        ? res.field
        : (res as Field);
  },

  async deleteField(id: string): Promise<void> {
    await apiFetch<void>(`/fields/${id}`, {
      method: 'DELETE',
    });
  },

  // Recommendations
  async getRecommendations(fieldId: string, days = 7): Promise<Recommendation[]> {
    try {
      const res = await apiFetch<
        | { data?: { recommendations: Recommendation[] }; recommendations?: Recommendation[] }
        | Recommendation[]
      >(`/fields/${fieldId}/recommendations?days=${days}`);
      const rawRecs = Array.isArray(res) ? res : res.data?.recommendations || res.recommendations || [];
      const recs: Recommendation[] = (rawRecs as any[]).map((r) => {
        const action = r.plan?.action || r.action || 'skip';
        const grossMm = r.plan?.grossMm ?? r.grossMm ?? 0;
        const litres = r.plan?.litres ?? r.litres ?? 0;
        const reasonKey = r.plan?.reasonKey || r.reasonKey || 'reason.not_needed';
        const reasonParams = r.plan?.reasonParams || r.params || {};
        const deficitMm = r.plan?.deficitMm ?? r.deficitMm ?? 0;
        const et0Mm = r.dailyNeeds?.et0Mm ?? r.et0Mm ?? 0;
        const rainMm = r.dailyNeeds?.rainMm ?? r.rainMm ?? 0;
        const etcMm = r.dailyNeeds?.etcMm ?? r.etcMm ?? 0;
        const weatherStale = Boolean(r.weatherStale ?? r.staleWeather ?? false);

        return {
          id: String(r.id || r._id || ''),
          fieldId: String(r.fieldId || ''),
          forDate: String(r.forDate || ''),
          weatherStale,
          dailyNeeds: {
            date: String(r.forDate || ''),
            et0Mm,
            stage: r.dailyNeeds?.stage || '',
            kc: r.kc ?? 1,
            etcMm,
            rainMm,
            effectiveRainMm: r.effectiveRainMm ?? 0,
            netNeedMm: r.netMm ?? 0,
          },
          plan: {
            action,
            grossMm,
            litres,
            reasonKey,
            reasonParams,
            deficitMm,
          },
        };
      });
      setCachedPlan(fieldId, { days: recs, summary: null }).catch(() => {});
      return recs;
    } catch (err) {
      const cached = await getCachedPlan(fieldId);
      if (cached && cached.days && cached.days.length > 0) {
        return cached.days as Recommendation[];
      }
      throw err;
    }
  },

  async recomputeRecommendations(fieldId: string): Promise<{ success: boolean }> {
    return apiFetch<{ success: boolean }>(`/fields/${fieldId}/recommendations/recompute`, {
      method: 'POST',
    });
  },

  // Irrigation Logs
  async getLogs(fieldId: string, from?: string, to?: string): Promise<{ logs: IrrigationLog[] }> {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const query = params.toString() ? `?${params.toString()}` : '';
    const res = await apiFetch<{ data?: { logs: IrrigationLog[] }; logs?: IrrigationLog[] }>(
      `/fields/${fieldId}/logs${query}`,
    );
    return {
      logs: res.data?.logs || res.logs || [],
    };
  },

  async createLog(
    fieldId: string,
    data: { date: string; appliedMm: number; source: 'recommended' | 'manual'; note?: string },
  ): Promise<IrrigationLog> {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      await enqueueMutation({
        type: 'create_irrigation_log',
        fieldId,
        payload: data,
      });
      return {
        id: 'offline-' + Date.now(),
        fieldId,
        userId: '',
        date: data.date,
        appliedMm: data.appliedMm,
        source: data.source,
        note: data.note,
        createdAt: new Date().toISOString(),
      };
    }

    try {
      const res = await apiFetch<
        { data?: { log: IrrigationLog }; log?: IrrigationLog } | IrrigationLog
      >(`/fields/${fieldId}/logs`, {
        method: 'POST',
        body: JSON.stringify(data),
      });
      return 'data' in res && res.data?.log
        ? res.data.log
        : 'log' in res && res.log
          ? res.log
          : (res as IrrigationLog);
    } catch (err) {
      if (err instanceof TypeError || (err instanceof ApiError && err.status >= 500)) {
        await enqueueMutation({
          type: 'create_irrigation_log',
          fieldId,
          payload: data,
        });
        return {
          id: 'offline-' + Date.now(),
          fieldId,
          userId: '',
          date: data.date,
          appliedMm: data.appliedMm,
          source: data.source,
          note: data.note,
          createdAt: new Date().toISOString(),
        };
      }
      throw err;
    }
  },

  // Batch Sync
  async batchSync(mutations: SyncMutation[]): Promise<{ results: SyncResultItem[] }> {
    const res = await apiFetch<{ results?: SyncResultItem[]; data?: { results: SyncResultItem[] } }>(
      '/sync',
      {
        method: 'POST',
        body: JSON.stringify({ mutations }),
      },
    );
    return {
      results: res.results || res.data?.results || [],
    };
  },

  async deleteLog(fieldId: string, logId: string): Promise<void> {
    await apiFetch<void>(`/fields/${fieldId}/logs/${logId}`, {
      method: 'DELETE',
    });
  },

  // Savings
  async getSavings(fieldId: string, from: string, to: string): Promise<SavingsData> {
    const res = await apiFetch<any>(`/fields/${fieldId}/savings?from=${from}&to=${to}`);
    if (res?.data?.totals) {
      return res.data as SavingsData;
    }
    if (res?.data?.savings) {
      return res.data.savings as SavingsData;
    }
    if (res?.savings) {
      return res.savings as SavingsData;
    }
    return res as SavingsData;
  },

  // Sensors & Moisture
  async getSensors(fieldId: string): Promise<{ sensors: Sensor[] }> {
    const res = await apiFetch<{ data?: { sensors: Sensor[] }; sensors?: Sensor[] }>(
      `/fields/${fieldId}/sensors`,
    );
    return {
      sensors: res.data?.sensors || res.sensors || [],
    };
  },

  async createSensor(
    fieldId: string,
    data: { name: string; isSimulated?: boolean },
  ): Promise<{ sensor: Sensor; apiKey: string }> {
    const res = await apiFetch<{
      data?: { sensor: Sensor; apiKey: string };
      sensor?: Sensor;
      apiKey?: string;
    }>(`/fields/${fieldId}/sensors`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return {
      sensor: res.data?.sensor || res.sensor!,
      apiKey: res.data?.apiKey || res.apiKey!,
    };
  },

  async getMoisture(
    fieldId: string,
    from?: string,
    to?: string,
  ): Promise<{ readings: SensorReading[] }> {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const query = params.toString() ? `?${params.toString()}` : '';
    const res = await apiFetch<{ data?: { readings: SensorReading[] }; readings?: SensorReading[] }>(
      `/fields/${fieldId}/moisture${query}`,
    );
    return {
      readings: res.data?.readings || res.readings || [],
    };
  },

  getMoistureStreamUrl(fieldId: string): string {
    const token = getAccessToken();
    const base = API_BASE.startsWith('http') ? API_BASE : `${window.location.origin}${API_BASE}`;
    return `${base}/fields/${fieldId}/moisture/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  },

  // Reports (Phase 12)
  async createReport(
    fieldId: string,
    options?: { from?: string; to?: string; language?: 'en' | 'hi' },
  ): Promise<{ id: string; status: 'completed' | 'processing'; report?: any; message?: string }> {
    return apiFetch<{ id: string; status: 'completed' | 'processing'; report?: any; message?: string }>(
      `/fields/${fieldId}/reports`,
      {
        method: 'POST',
        body: JSON.stringify(options || {}),
      },
    );
  },

  async getReport(
    reportId: string,
  ): Promise<{ id: string; status: 'completed' | 'processing' | 'failed'; data?: any; error?: string }> {
    return apiFetch<{ id: string; status: 'completed' | 'processing' | 'failed'; data?: any; error?: string }>(
      `/reports/${reportId}`,
    );
  },

  async getReportPdfBlob(reportId: string): Promise<Blob> {
    const url = `${API_BASE}/reports/${reportId}/pdf`;
    const headers = new Headers();
    if (accessToken) {
      headers.set('Authorization', `Bearer ${accessToken}`);
    }
    const response = await fetch(url, { headers, credentials: 'include' });
    if (!response.ok) {
      throw new ApiError(response.status, 'Failed to download report PDF');
    }
    return response.blob();
  },

  getReportPdfUrl(reportId: string): string {
    const token = getAccessToken();
    const base = API_BASE.startsWith('http') ? API_BASE : `${window.location.origin}${API_BASE}`;
    return `${base}/reports/${reportId}/pdf${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  },
};
