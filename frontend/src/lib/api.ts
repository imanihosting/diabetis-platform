import { clearSessionHint } from '@/hooks/useSessionHint';
import type {
  AttachOutcomeInput,
  CareModeCapabilities,
  ClinicianPacket,
  ClientAuthResponse,
  GlucoseSummary,
  LoginInput,
  MailRequestResult,
  Meal,
  CreateExperimentInput,
  CreateLabResultInput,
  DiabetesProfile,
  Experiment,
  ExperimentDecision,
  ExperimentDetail,
  Prediction,
  PredictionOutcome,
  DiabetesSafetyFlag,
  LabResult,
  MedicationRecord,
  PatternResponse,
  RecordSafetyFlagInput,
  SafetyFlag,
  UpdateDiabetesProfileInput,
  PasswordResetCompleteResult,
  RegisterInput,
  TimelineEntry,
  User,
  VerifyEmailResult,
  WaitlistConfirmResult,
} from '@wellovue/types';

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
    /**
     * A machine-readable reason, when the server sent one.
     *
     * Exists for one case so far and an important one: `email_unverified` on a
     * 403. Without it the app cannot tell "prove your address" from "you are
     * not allowed here", and a person who needs to click a link in their inbox
     * gets told they lack permission.
     */
    readonly code?: string,
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
      if (!res.ok) {
        // The hint outlived the session it described. Clear it so the public
        // header stops offering a route the app cannot honour.
        clearSessionHint();
        return false;
      }

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
      payload?.code,
    );
  }

  return payload as T;
}

export interface DiabetesContextResponse {
  profile: DiabetesProfile;
  activeFlags: SafetyFlag[];
  capabilities: CareModeCapabilities;
  /** Decides which hours the engine calls morning. See the care profile page. */
  timezone: string;
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

    /**
     * Spends a verification token from a mailed link.
     *
     * A refused token comes back as a result, not an error: expired, invalid
     * and verified are three things the page says differently, and the first
     * two are expected outcomes rather than failures.
     */
    verifyEmail: (token: string) =>
      request<VerifyEmailResult>('/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ token }),
      }),

    /**
     * Asks for another verification link.
     *
     * Always resolves for a well-formed address, whether or not an account
     * exists. The server will not say, and neither will this.
     */
    resendVerification: (email: string) =>
      request<MailRequestResult>('/auth/verify-email/resend', {
        method: 'POST',
        body: JSON.stringify({ email }),
      }),

    /** Same contract as the resend above: the same answer for every address. */
    requestPasswordReset: (email: string) =>
      request<MailRequestResult>('/auth/password-reset', {
        method: 'POST',
        body: JSON.stringify({ email }),
      }),

    completePasswordReset: (token: string, password: string) =>
      request<PasswordResetCompleteResult>('/auth/password-reset/complete', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      }),
  },

  users: {
    me: () => request<User>('/users/me'),
  },

  waitlist: {
    /**
     * Spends a confirmation token from the landing page's capture email.
     *
     * A refused token comes back as a result rather than an error: confirmed,
     * expired and not-valid are three things the page says differently, and
     * two of them are expected.
     */
    confirm: (token: string) =>
      request<WaitlistConfirmResult>('/waitlist/confirm', {
        method: 'POST',
        body: JSON.stringify({ token }),
      }),
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

  diabetesProfile: {
    /**
     * Profile, active flags and capabilities in one response.
     *
     * Care mode and safety tier are absent from every request on purpose: they
     * are derived on the server, because they decide which analysis a person's
     * data is put through.
     */
    get: () => request<DiabetesContextResponse>('/diabetes-profile'),
    update: (body: UpdateDiabetesProfileInput) =>
      request<DiabetesContextResponse>('/diabetes-profile', {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    recordFlag: (body: RecordSafetyFlagInput) =>
      request<DiabetesContextResponse>('/diabetes-profile/flags', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    flagHistory: () => request<DiabetesSafetyFlag[]>('/diabetes-profile/flags'),
  },

  experiments: {
    list: () => request<Experiment[]>('/experiments'),
    /** One experiment with what was predicted of it and what came of it. */
    get: (id: string) => request<ExperimentDetail>(`/experiments/${id}`),
    /**
     * Always resolves for a well-formed proposal, including when the answer is
     * no: a refusal comes back as a decision, not as a thrown error, because
     * it is an answer the reader is meant to see rather than a failure.
     */
    propose: (body: CreateExperimentInput) =>
      request<{ experiment: Experiment; decision: ExperimentDecision }>('/experiments', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    /**
     * Starts an experiment, and returns the prediction written in the same
     * transaction as the start.
     *
     * Nothing about the prediction is sent. What the platform expects is
     * derived on the server from the evidence as it stands, because a record
     * of how often it was right is worth nothing if the browser could choose
     * the answer.
     */
    start: (id: string) =>
      request<{ experiment: Experiment; prediction: Prediction }>(
        `/experiments/${id}/start`,
        { method: 'POST' },
      ),
    /**
     * Finishes an experiment by recording what actually happened.
     *
     * The only way an outcome reaches the server, and it is written once: a
     * second attempt is refused rather than replacing a disappointing result
     * with a better one.
     */
    complete: (id: string, body: AttachOutcomeInput) =>
      request<{
        experiment: Experiment;
        prediction: Prediction;
        outcome: PredictionOutcome;
      }>(`/experiments/${id}/complete`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  },

  reports: {
    /**
     * Thirty or ninety days on one page, for an appointment.
     *
     * The period is one of two fixed windows. An arbitrary range would let it
     * be chosen after the answer is seen, which is the same failure as an
     * editable prediction in different clothes.
     */
    clinicianPacket: (days: 30 | 90) =>
      request<ClinicianPacket>(`/reports/clinician?days=${days}`),
  },

  evidence: {
    /**
     * Structured findings for the signed-in user.
     *
     * No user id is sent. The server takes it from the access token, because
     * the engine behind this endpoint will answer about whatever id it is
     * given.
     */
    findings: (from: Date, to: Date) =>
      request<PatternResponse>(
        `/evidence?from=${from.toISOString()}&to=${to.toISOString()}`,
      ),
  },

  labs: {
    list: (testName?: string) =>
      request<LabResult[]>(
        `/labs${testName ? `?testName=${encodeURIComponent(testName)}` : ''}`,
      ),
    create: (body: CreateLabResultInput) =>
      request<LabResult>('/labs', { method: 'POST', body: JSON.stringify(body) }),
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
