import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, type Env } from '../config/env';

/**
 * Sends mail through Microsoft Graph, and says honestly what happened.
 *
 * Two things about Graph shape this file.
 *
 * **202 is not delivery.** `POST /users/{id}/sendMail` returns `202 Accepted`
 * with an empty body: Microsoft has taken the message, and nothing about the
 * recipient's mailbox has been established. There is no message id to follow
 * and no delivery receipt to wait for. So `accepted` is the word used
 * throughout, and the outbox status it produces means "the provider took it" —
 * a bounce an hour later is invisible from here and always will be.
 *
 * **The failures are not alike.** A 429 with a Retry-After is Microsoft asking
 * for patience; a 403 is an admin who has not consented to Mail.Send, and
 * retrying it a hundred times changes nothing except how long the queue behind
 * it is. Every response is sorted into transient or permanent, because the
 * retry policy is only as good as that distinction.
 *
 * Nothing here logs a token, a request body, or a rendered message. The access
 * token is a bearer credential for a mailbox; the body is somebody's mail.
 */
@Injectable()
export class GraphMailClient {
  private readonly logger = new Logger(GraphMailClient.name);

  /**
   * The current app token and when it stops being usable.
   *
   * Client-credentials tokens last about an hour and cost a round trip to
   * fetch. Caching one is the difference between two HTTP calls per email and
   * one. Held in memory only: it is a credential, and it belongs in a process
   * rather than in a store something else can read.
   */
  private token: { value: string; expiresAt: number } | null = null;

  constructor(@Inject(ENV) private readonly env: Env) {}

  /**
   * Hands the message to Graph.
   *
   * Never throws for a provider failure — a failure is a result the caller has
   * to record, and an exception would make "did not send" and "the worker
   * crashed" look the same in the outbox.
   */
  async send(message: OutboundMessage): Promise<GraphSendResult> {
    const sender = this.env.GRAPH_SENDER_USER;
    if (!sender) {
      // Unreachable when the env refinement has run: MAIL_ENABLED without a
      // sender does not boot. Kept because this class is also constructible in
      // a test, and a null sender there should say so rather than build a URL
      // containing "undefined".
      return permanent('GRAPH_SENDER_USER is not configured');
    }

    let token: string;
    try {
      token = await this.accessToken();
    } catch (err) {
      // Token acquisition failing is usually the identity platform being
      // unreachable, which is transient. A wrong secret is a 401 from the
      // token endpoint, which `accessToken` has already classified.
      return err instanceof GraphAuthError
        ? { accepted: false, transient: err.transient, error: err.message }
        : { accepted: false, transient: true, error: safeError(err) };
    }

    const url = `${this.env.GRAPH_BASE_URL}/users/${encodeURIComponent(sender)}/sendMail`;

    // Graph's JSON message carries exactly one body. A multipart/alternative
    // with both a text and an HTML part needs the MIME form of this endpoint,
    // which in turn gives up control of saveToSentItems — and not retaining a
    // copy of every account email in a shared support mailbox is worth more
    // here than a plain-text alternative that essentially every modern client
    // ignores. Both bodies are still rendered: the text one is what dry run
    // logs, what the outbox debugging path shows, and what this sends if
    // MAIL_BODY_FORMAT is ever set to text.
    const html = this.env.MAIL_BODY_FORMAT !== 'text';

    const payload = {
      message: {
        subject: message.subject,
        body: {
          contentType: html ? 'HTML' : 'Text',
          content: html ? message.html : message.text,
        },
        toRecipients: [{ emailAddress: { address: message.to } }],
        // The From address is server configuration and nothing else. No caller
        // supplies it, and no template can influence it.
        from: { emailAddress: { address: sender, name: this.env.MAIL_FROM_NAME } },
      },
      saveToSentItems: this.env.MAIL_SAVE_TO_SENT_ITEMS,
    };

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // DNS, TLS, connection reset, timeout. All worth another attempt.
      return { accepted: false, transient: true, error: safeError(err) };
    }

    if (response.status === 202) {
      return { accepted: true, transient: false, messageId: null };
    }

    // A 401 here after a successful token fetch means the cached token was
    // rejected — revoked, or the clock drifted past its life. Drop it so the
    // next attempt fetches a fresh one, and treat this attempt as transient.
    if (response.status === 401) {
      this.token = null;
      return { accepted: false, transient: true, error: 'Graph rejected the access token (401)' };
    }

    return {
      accepted: false,
      transient: isTransientStatus(response.status),
      retryAfterMs: retryAfterMs(response),
      error: await describeGraphError(response),
    };
  }

  /**
   * A client-credentials token for the Graph app, cached until near expiry.
   *
   * The 60-second margin is not politeness: a token that expires between this
   * check and the sendMail call produces a 401 that looks like a permissions
   * problem, and somebody spends an afternoon in the Entra portal.
   */
  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + TOKEN_REFRESH_MARGIN_MS) {
      return this.token.value;
    }

    const { GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, GRAPH_AUTHORITY_URL } =
      this.env;
    if (!GRAPH_TENANT_ID || !GRAPH_CLIENT_ID || !GRAPH_CLIENT_SECRET) {
      throw new GraphAuthError('Graph client credentials are not configured', false);
    }

    const url = `${GRAPH_AUTHORITY_URL}/${encodeURIComponent(GRAPH_TENANT_ID)}/oauth2/v2.0/token`;
    const form = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: GRAPH_CLIENT_ID,
      client_secret: GRAPH_CLIENT_SECRET,
      // `.default` asks for whatever application permissions the app has been
      // granted consent for — Mail.Send, for this one. Client credentials
      // cannot request scopes that were not consented to in the portal.
      scope: 'https://graph.microsoft.com/.default',
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      // The identity platform returns `error` and `error_description`. The
      // description names the misconfiguration — expired secret, wrong tenant,
      // consent missing — and contains no credential, so it is safe to keep.
      const detail = await response
        .json()
        .then((b: unknown) => {
          const body = b as { error?: string; error_description?: string };
          return body.error_description ?? body.error ?? '';
        })
        .catch(() => '');

      throw new GraphAuthError(
        `Token request failed (${response.status}): ${truncate(detail)}`,
        isTransientStatus(response.status),
      );
    }

    const body = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) {
      throw new GraphAuthError('Token response contained no access_token', true);
    }

    this.token = {
      value: body.access_token,
      expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    };

    // Says a token was obtained and never what it is. The lifetime is useful
    // when diagnosing a clock-skew problem; the value is a mailbox credential.
    this.logger.debug(`Graph token acquired, valid for ${body.expires_in ?? 3600}s`);
    return this.token.value;
  }

  /** Drops the cached token. Used by the credential-rotation runbook and tests. */
  forgetToken(): void {
    this.token = null;
  }
}

export interface OutboundMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface GraphSendResult {
  /** True only for 202. Means Graph took it, never that it arrived. */
  accepted: boolean;
  /** Whether another attempt could plausibly succeed. */
  transient: boolean;
  /** Graph's own Retry-After, when it named one. */
  retryAfterMs?: number;
  messageId?: string | null;
  error?: string;
}

class GraphAuthError extends Error {
  constructor(
    message: string,
    readonly transient: boolean,
  ) {
    super(message);
    this.name = 'GraphAuthError';
  }
}

const REQUEST_TIMEOUT_MS = 15_000;
const TOKEN_REFRESH_MARGIN_MS = 60_000;

function permanent(error: string): GraphSendResult {
  return { accepted: false, transient: false, error };
}

/**
 * Which HTTP statuses are worth trying again.
 *
 * 429 and 503 are Microsoft's documented throttling responses; 500, 502 and
 * 504 are its own failures. Everything else — 400 on a malformed recipient,
 * 403 with Mail.Send unconsented, 404 on a mailbox that does not exist — is a
 * fact about this deployment that will be just as true in five minutes.
 */
function isTransientStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

/**
 * Graph's Retry-After, honoured as given.
 *
 * Microsoft's throttling guidance is explicit that a client should wait the
 * period named rather than apply its own backoff, and a service that ignores
 * it gets throttled harder. Seconds in practice; the HTTP-date form is
 * accepted too because the specification allows it. Capped, so a header saying
 * "come back in a day" does not silently park a verification email for a day —
 * the row stays queued and is retried sooner, which is the lesser wrong.
 */
function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get('retry-after');
  if (!header) return undefined;

  const seconds = Number(header);
  const ms = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(header) - Date.now();

  if (!Number.isFinite(ms) || ms <= 0) return undefined;
  return Math.min(ms, MAX_RETRY_AFTER_MS);
}

const MAX_RETRY_AFTER_MS = 15 * 60 * 1000;

/**
 * A short, safe description of a failed Graph response.
 *
 * Graph errors are `{ error: { code, message } }`, and the pair is what makes
 * a failure actionable — `ErrorAccessDenied` and `MailboxNotEnabledForRESTAPI`
 * are different afternoons. Truncated, because this string is written to the
 * outbox and read in a terminal; the body is never echoed wholesale.
 */
async function describeGraphError(response: Response): Promise<string> {
  const detail = await response
    .json()
    .then((b: unknown) => {
      const body = b as { error?: { code?: string; message?: string } };
      return [body.error?.code, body.error?.message].filter(Boolean).join(': ');
    })
    .catch(() => '');

  return `Graph responded ${response.status}${detail ? `: ${truncate(detail)}` : ''}`;
}

function safeError(err: unknown): string {
  return truncate(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
}

function truncate(value: string, max = 400): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
