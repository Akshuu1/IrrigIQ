import type {
  RegisterInput,
  LoginInput,
  UpdateProfileInput,
  CreateFieldInput,
  Language,
  AreaUnit,
  Crop,
} from '@irrigiq/shared';

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
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;
  const headers = new Headers(options.headers || {});

  if (accessToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include', // Include httpOnly refresh cookie
  });

  if (
    response.status === 401 &&
    !isRetry &&
    !endpoint.includes('/auth/login') &&
    !endpoint.includes('/auth/register')
  ) {
    if (!isRefreshing) {
      isRefreshing = true;
      try {
        const refreshResponse = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
        });
        if (refreshResponse.ok) {
          const data = await refreshResponse.json();
          accessToken = data.accessToken;
          onRefreshed(data.accessToken);
          isRefreshing = false;
          return apiFetch<T>(endpoint, options, true);
        } else {
          accessToken = null;
          isRefreshing = false;
          window.dispatchEvent(new CustomEvent('auth:expired'));
        }
      } catch {
        accessToken = null;
        isRefreshing = false;
        window.dispatchEvent(new CustomEvent('auth:expired'));
      }
    } else {
      // Wait for refresh to complete
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

export const api = {
  // Auth
  async register(data: RegisterInput): Promise<AuthResponse> {
    return apiFetch<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async login(data: LoginInput): Promise<AuthResponse> {
    return apiFetch<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async refresh(): Promise<{ accessToken: string }> {
    return apiFetch<{ accessToken: string }>('/auth/refresh', {
      method: 'POST',
    });
  },

  async logout(): Promise<void> {
    await apiFetch<void>('/auth/logout', {
      method: 'POST',
    });
    setAccessToken(null);
  },

  async getMe(): Promise<{ user: User }> {
    return apiFetch<{ user: User }>('/auth/me');
  },

  async updateMe(data: UpdateProfileInput): Promise<{ user: User }> {
    return apiFetch<{ user: User }>('/auth/me', {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  // Crops
  async getCrops(): Promise<Crop[]> {
    return apiFetch<Crop[]>('/crops');
  },

  // Fields
  async getFields(): Promise<Field[]> {
    return apiFetch<Field[]>('/fields');
  },

  async getField(id: string): Promise<Field> {
    return apiFetch<Field>(`/fields/${id}`);
  },

  async createField(data: CreateFieldInput): Promise<Field> {
    return apiFetch<Field>('/fields', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async deleteField(id: string): Promise<void> {
    await apiFetch<void>(`/fields/${id}`, {
      method: 'DELETE',
    });
  },

  // Recommendations
  async getRecommendations(fieldId: string, days = 7): Promise<Recommendation[]> {
    return apiFetch<Recommendation[]>(`/fields/${fieldId}/recommendations?days=${days}`);
  },

  async recomputeRecommendations(fieldId: string): Promise<{ success: boolean }> {
    return apiFetch<{ success: boolean }>(`/fields/${fieldId}/recommendations/recompute`, {
      method: 'POST',
    });
  },
};
