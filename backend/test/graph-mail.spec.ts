import { afterEach, describe, expect, it, vi } from 'vitest';
import { GraphMailClient } from '../src/notifications/graph-mail.client';
import { envSchema, type Env } from '../src/config/env';
import { deviceClass, deviceFingerprint } from '../src/auth/sign-in-device';

/**
 * The provider boundary.
 *
 * Two properties are worth pinning down here, and neither is visible from
 * inside the application.
 *
 * **What Graph is actually sent.** The From address is server configuration
 * and nothing else; `saveToSentItems` defaults to false because retaining
 * every account email in a shared support mailbox builds a record of who
 * signed up and when that no part of the product needs. Both are the kind of
 * thing that changes by accident during a refactor and is noticed a year later
 * by somebody reading a mailbox.
 *
 * **How a failure is classified.** The retry policy is only as good as the
 * transient/permanent distinction: retrying a 403 a hundred times does nothing
 * except lengthen the queue behind it, and giving up on a 429 loses mail the
 * provider was willing to take a minute later.
 */

const BASE: NodeJS.ProcessEnv = {
  DATABASE_URL: 'postgresql://u:p@medical-db:5432/db',
  JWT_SECRET: 'a-secret-long-enough-to-satisfy-validation',
  S3_ENDPOINT: 'http://storage.test:9000',
  S3_REGION: 'test',
  S3_BUCKET: 'medicaldata',
  S3_ACCESS_KEY_ID: 'x',
  S3_SECRET_ACCESS_KEY: 'y',
  MAIL_ENABLED: 'true',
  GRAPH_TENANT_ID: 'tenant-id',
  GRAPH_CLIENT_ID: 'client-id',
  GRAPH_CLIENT_SECRET: 'client-secret',
  GRAPH_SENDER_USER: 'support@wellovue.example',
};

function env(extra: NodeJS.ProcessEnv = {}): Env {
  return envSchema.parse({ ...BASE, ...extra });
}

const MESSAGE = {
  to: 'person@example.test',
  subject: 'Verify your Wellovue email',
  text: 'plain text body',
  html: '<html lang="en"><body>html body</body></html>',
};

/** A token response, then whatever the sendMail call should answer with. */
function stubFetch(sendResponse: Response) {
  const calls: { url: string; init: RequestInit }[] = [];

  const fetchStub = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });

    if (String(url).includes('oauth2/v2.0/token')) {
      return new Response(
        JSON.stringify({ access_token: 'an-app-token', expires_in: 3600 }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return sendResponse;
  });

  vi.stubGlobal('fetch', fetchStub);
  return { calls, fetchStub };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the Microsoft Graph client', () => {
  it('posts the message the product intends to send', async () => {
    const { calls } = stubFetch(new Response(null, { status: 202 }));

    const result = await new GraphMailClient(env()).send(MESSAGE);
    expect(result.accepted).toBe(true);

    const send = calls.find((c) => c.url.includes('/sendMail'));
    expect(send?.url).toBe(
      'https://graph.microsoft.com/v1.0/users/support%40wellovue.example/sendMail',
    );

    const body = JSON.parse(String(send?.init.body));
    expect(body.message.subject).toBe(MESSAGE.subject);
    expect(body.message.toRecipients).toEqual([
      { emailAddress: { address: MESSAGE.to } },
    ]);
    // The sender is configuration. Nothing a caller or a template supplies can
    // reach this field.
    expect(body.message.from.emailAddress.address).toBe('support@wellovue.example');
    expect(body.message.body.contentType).toBe('HTML');
    expect(body.saveToSentItems).toBe(false);
  });

  it('sends the plain-text body when the deployment asks for text', async () => {
    const { calls } = stubFetch(new Response(null, { status: 202 }));
    await new GraphMailClient(env({ MAIL_BODY_FORMAT: 'text' })).send(MESSAGE);

    const body = JSON.parse(
      String(calls.find((c) => c.url.includes('/sendMail'))?.init.body),
    );
    expect(body.message.body).toEqual({ contentType: 'Text', content: MESSAGE.text });
  });

  it('retains sent mail only when the product asks it to', async () => {
    const { calls } = stubFetch(new Response(null, { status: 202 }));
    await new GraphMailClient(env({ MAIL_SAVE_TO_SENT_ITEMS: 'true' })).send(MESSAGE);

    const body = JSON.parse(
      String(calls.find((c) => c.url.includes('/sendMail'))?.init.body),
    );
    expect(body.saveToSentItems).toBe(true);
  });

  it('treats 202 as accepted by Graph and not as delivered', async () => {
    stubFetch(new Response(null, { status: 202 }));
    const result = await new GraphMailClient(env()).send(MESSAGE);

    // Graph returns no message id and makes no promise about the recipient's
    // mailbox. Anything downstream reading `accepted` as delivery would be
    // wrong, so there is deliberately nothing here that could be mistaken for
    // a receipt.
    expect(result).toEqual({ accepted: true, transient: false, messageId: null });
  });

  it('honours Retry-After when Graph throttles', async () => {
    stubFetch(
      new Response(JSON.stringify({ error: { code: 'ApplicationThrottled' } }), {
        status: 429,
        headers: { 'retry-after': '42', 'content-type': 'application/json' },
      }),
    );

    const result = await new GraphMailClient(env()).send(MESSAGE);
    expect(result.accepted).toBe(false);
    expect(result.transient).toBe(true);
    expect(result.retryAfterMs).toBe(42_000);
  });

  it('caps an absurd Retry-After rather than parking mail for a day', async () => {
    stubFetch(new Response(null, { status: 503, headers: { 'retry-after': '86400' } }));
    const result = await new GraphMailClient(env()).send(MESSAGE);
    expect(result.retryAfterMs).toBe(15 * 60 * 1000);
  });

  it('does not retry a permissions failure', async () => {
    // 403 is Mail.Send unconsented, or consented for a different app. It will
    // be just as true in five minutes, and the queue behind it is real mail.
    stubFetch(
      new Response(
        JSON.stringify({ error: { code: 'ErrorAccessDenied', message: 'Access is denied.' } }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      ),
    );

    const result = await new GraphMailClient(env()).send(MESSAGE);
    expect(result.transient).toBe(false);
    expect(result.error).toContain('ErrorAccessDenied');
  });

  it('does not retry a rejected recipient', async () => {
    stubFetch(
      new Response(JSON.stringify({ error: { code: 'ErrorInvalidRecipients' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect((await new GraphMailClient(env()).send(MESSAGE)).transient).toBe(false);
  });

  it('retries a network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );

    const result = await new GraphMailClient(env()).send(MESSAGE);
    expect(result.accepted).toBe(false);
    expect(result.transient).toBe(true);
  });

  it('reuses one app token across sends', async () => {
    const { fetchStub } = stubFetch(new Response(null, { status: 202 }));
    const client = new GraphMailClient(env());

    await client.send(MESSAGE);
    await client.send(MESSAGE);

    const tokenCalls = fetchStub.mock.calls.filter(([url]) =>
      String(url).includes('oauth2/v2.0/token'),
    );
    // A token lasts an hour and costs a round trip. Fetching one per email
    // doubles the requests for nothing.
    expect(tokenCalls).toHaveLength(1);
  });

  it('drops the cached token when Graph rejects it', async () => {
    const { fetchStub } = stubFetch(new Response(null, { status: 401 }));
    const client = new GraphMailClient(env());

    const first = await client.send(MESSAGE);
    expect(first.transient).toBe(true);

    await client.send(MESSAGE);
    const tokenCalls = fetchStub.mock.calls.filter(([url]) =>
      String(url).includes('oauth2/v2.0/token'),
    );
    // Two, because the rejected one was thrown away. A cached token that keeps
    // being replayed turns a one-off rejection into a permanent outage.
    expect(tokenCalls).toHaveLength(2);
  });

  it('reports a token failure without echoing the secret', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: 'invalid_client',
            error_description: 'AADSTS7000215: Invalid client secret provided.',
          }),
          { status: 401, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );

    const result = await new GraphMailClient(env()).send(MESSAGE);
    expect(result.accepted).toBe(false);
    expect(result.error).toContain('AADSTS7000215');
    // The description names the misconfiguration and never the credential.
    expect(result.error).not.toContain('client-secret');
  });

  it('asks only for the permissions the app was consented for', async () => {
    const { calls } = stubFetch(new Response(null, { status: 202 }));
    await new GraphMailClient(env()).send(MESSAGE);

    const token = calls.find((c) => c.url.includes('oauth2/v2.0/token'));
    expect(token?.url).toBe(
      'https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token',
    );
    const form = String(token?.init.body);
    expect(form).toContain('grant_type=client_credentials');
    expect(form).toContain('scope=https%3A%2F%2Fgraph.microsoft.com%2F.default');
  });
});

/**
 * What "a new device" is allowed to mean, and what it is allowed to say.
 *
 * The fingerprint has to be stable across sign-ins and useless to anybody
 * reading the table; the label has to be recognisable to its owner and shared
 * by millions of other people.
 */
describe('sign-in device recognition', () => {
  const SECRET = 'a-secret-long-enough-to-satisfy-validation';
  const CHROME_MAC =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

  it('gives the same browser the same fingerprint', () => {
    expect(deviceFingerprint(CHROME_MAC, SECRET)).toBe(
      deviceFingerprint(CHROME_MAC, SECRET),
    );
  });

  it('does not keep the user agent recoverable from the fingerprint', () => {
    const hash = deviceFingerprint(CHROME_MAC, SECRET);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('Chrome');
    // Keyed, not plainly hashed: the set of real user agent strings is small
    // enough to enumerate, so an unkeyed digest would leave the string
    // effectively still in the table.
    expect(hash).not.toBe(deviceFingerprint(CHROME_MAC, 'a-different-secret-value'));
  });

  it('describes a device coarsely enough to put in an email', () => {
    expect(deviceClass(CHROME_MAC)).toBe('Chrome on macOS');
    expect(
      deviceClass(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
          '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Safari on iPhone');
    // Edge and Opera both claim to be Chrome, so order matters in the table.
    expect(deviceClass('Mozilla/5.0 (Windows NT 10.0) Chrome/131 Safari/537.36 Edg/131')).toBe(
      'Edge on Windows',
    );
  });

  it('says something rather than nothing for an unrecognised client', () => {
    expect(deviceClass(undefined)).toBe('Unrecognised device');
    expect(deviceClass('curl/8.4.0')).toBe('A browser on an unrecognised system');
  });
});
