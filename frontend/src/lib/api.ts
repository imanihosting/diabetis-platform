import type {
  ClientAuthResponse,
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
 * Requests go to a same-origin `/api` path proxied to the backend, so the
 * access token never travels in a cross-site request.
 *
 * Nothing is written to localStorage. The refresh token lives in an HttpOnly
 * cookie the page cannot read, and the access token is held in memory for the
 * lifetime of the tab. An XSS can therefore use the session while it is
 * running, but cannot walk away with a credential that outlives the page —
 * which for a health record is the difference that matters.
 */

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

let accessToken: string | null = null;

export const tokenStore = {
  get: (): string | null => accessToken,
  set: (token: string): void => {
    accessToken = token;
  },
  clear: (): void => {
    accessToken = null;
  },
};

/**
 * Guards against a burst of concurrent 401s each firing its own refresh, which
 * would rotate the single-use refresh cookie several times and invalidate the
 * session it was trying to save.
 */
let inFlightRefresh: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  inFlightRefresh ??= (async () => {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (!res.ok) return false;

      const payload = (await res.json()) as ClientAuthResponse;
      tokenStore.set(payload.tokens.accessToken);
      return true;
    } catch {
      return false;
    } finally {
      inFlightRefresh = null;
    }
  })();

  return inFlightRefresh;
}

async function send(path: string, init: RequestInit): Promise<Response> {
  const token = tokenStore.get();
  return fetch(`/api${path}`, {
    ...init,
    // Sends the refresh cookie on the auth routes it is scoped to.
    credentials: 'same-origin',
    headers: {
      ...(init.body && !(init.body instanceof FormData)
        ? { 'content-type': 'application/json' }
        : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await send(path, init);

  // The access token is short-lived by design. A 401 usually means it simply
  // expired, so try once to renew the session from the cookie before
  // surfacing a failure the user would experience as being logged out.
  if (res.status === 401 && !path.startsWith('/auth/')) {
    if (await refreshSession()) {
      res = await send(path, init);
    }
  }

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

export { refreshSession };

export const api = {
  auth: {
    register: (input: RegisterInput) =>
      request<ClientAuthResponse>('/auth/register', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    login: (input: LoginInput) =>
      request<ClientAuthResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    // The server revokes the refresh token and clears its cookie.
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
