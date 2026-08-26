import type {
  AuthResponse,
  GlucoseSummary,
  LoginInput,
  Meal,
  MedicationRecord,
  RegisterInput,
  TimelineEntry,
  User,
} from '@diabetes/types';

/**
 * Typed client for the backend.
 *
 * Requests go to a same-origin `/api` path that Next rewrites to the backend,
 * so the access token never travels in a cross-site request.
 */
const TOKEN_KEY = 'diabetes.accessToken';
const REFRESH_KEY = 'diabetes.refreshToken';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issues?: { path: string; message: string }[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const tokenStore = {
  get(): string | null {
    if (typeof window === 'undefined') return null;
    try {
      return window.localStorage.getItem(TOKEN_KEY);
    } catch {
      // Private browsing and blocked site data both throw here.
      return null;
    }
  },
  set(access: string, refresh: string): void {
    try {
      window.localStorage.setItem(TOKEN_KEY, access);
      window.localStorage.setItem(REFRESH_KEY, refresh);
    } catch {
      /* Session simply will not persist across reloads. */
    }
  },
  clear(): void {
    try {
      window.localStorage.removeItem(TOKEN_KEY);
      window.localStorage.removeItem(REFRESH_KEY);
    } catch {
      /* nothing to clean up */
    }
  },
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = tokenStore.get();
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(init.body && !(init.body instanceof FormData)
        ? { 'content-type': 'application/json' }
        : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  if (res.status === 204) return undefined as T;

  const payload = await res.json().catch(() => null);

  if (!res.ok) {
    throw new ApiError(
      payload?.message ?? `Request failed with ${res.status}`,
      res.status,
      payload?.issues,
    );
  }

  return payload as T;
}

export const api = {
  auth: {
    register: (input: RegisterInput) =>
      request<AuthResponse>('/auth/register', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    login: (input: LoginInput) =>
      request<AuthResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    logout: () => request<void>('/auth/logout', { method: 'POST', body: '{}' }),
  },

  users: {
    me: () => request<User>('/users/me'),
  },

  timeline: {
    query: (from: Date, to: Date, limit = 500) =>
      request<TimelineEntry[]>(
        `/timeline?from=${from.toISOString()}&to=${to.toISOString()}&limit=${limit}`,
      ),
    addEvent: (body: unknown) =>
      request<TimelineEntry>('/timeline/events', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  },

  glucose: {
    create: (body: unknown) =>
      request<unknown>('/glucose', { method: 'POST', body: JSON.stringify(body) }),
    summary: (from: Date, to: Date, unit: 'mmol/L' | 'mg/dL' = 'mmol/L') =>
      request<GlucoseSummary>(
        `/glucose/summary?from=${from.toISOString()}&to=${to.toISOString()}&unit=${encodeURIComponent(unit)}`,
      ),
    importCsv: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return request<{ imported: number; duplicates: number; rejected: unknown[] }>(
        '/glucose/import/csv',
        { method: 'POST', body: form },
      );
    },
  },

  meals: {
    list: (from: Date, to: Date) =>
      request<Meal[]>(`/meals?from=${from.toISOString()}&to=${to.toISOString()}`),
    create: (body: unknown) =>
      request<Meal>('/meals', { method: 'POST', body: JSON.stringify(body) }),
    uploadPhoto: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return request<{ objectKey: string }>('/meals/photo', {
        method: 'POST',
        body: form,
      });
    },
  },

  medications: {
    list: () => request<MedicationRecord[]>('/medications'),
    create: (body: unknown) =>
      request<MedicationRecord>('/medications', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  },
};
