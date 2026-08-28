import { type NextRequest } from 'next/server';

/**
 * Same-origin proxy to the backend API.
 *
 * The browser talks to `/api/*` on its own origin and this forwards to the
 * backend, so the access token never travels in a cross-site request and no
 * CORS preflight is involved.
 *
 * This is a route handler rather than a `next.config` rewrite because rewrites
 * are resolved when the app is built. In a container the backend's address is
 * only known at run time, and a baked-in `localhost:4000` would point at the
 * frontend container itself.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function backendUrl(): string {
  return process.env.BACKEND_URL ?? 'http://localhost:4000';
}

/**
 * Whether something in front of this app owns the forwarding headers.
 *
 * The same switch, with the same default and the same reasoning, as
 * `TRUST_PROXY` on the backend: off means nothing trustworthy sets these, so
 * anyone can, and a rate limiter keyed on a caller-supplied string is worse
 * than none because the people it exists to stop are the ones who can rotate
 * it. On means a reverse proxy overwrites them before this app is reached.
 *
 * Both ends have to agree. A proxy that sets the header, a frontend that
 * forwards it, and a backend that reads it — break the chain anywhere and the
 * backend keys every request in the deployment on one address, which is this
 * proxy's. See infra/README.md.
 */
function trustProxy(): boolean {
  return process.env.TRUST_PROXY === 'true';
}

/**
 * Every header that claims to say who the caller is.
 *
 * The Cloudflare ones matter as much as the standard ones and are easier to
 * miss: `cf-connecting-ip` is the header the backend keys its rate limits on
 * behind a tunnel, and it is an ordinary request header like any other. Left
 * in this list unfiltered, a caller could send it themselves and choose their
 * own bucket — which is the whole attack this list exists to stop, arriving
 * through the one header nobody thinks to check.
 */
const FORWARDING_HEADERS = [
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
  'forwarded',
  'cf-connecting-ip',
  'true-client-ip',
  'cf-ipcountry',
  'cf-ray',
];

async function proxy(request: NextRequest): Promise<Response> {
  const incoming = new URL(request.url);
  const target = new URL(
    `${incoming.pathname}${incoming.search}`,
    backendUrl(),
  );

  const headers = new Headers(request.headers);
  // Host must describe the upstream, and hop-by-hop headers must not be
  // forwarded. Content-Length is recomputed by fetch for a streamed body.
  headers.delete('host');
  headers.delete('connection');
  headers.delete('content-length');

  // Forwarding headers, and which of two situations this deployment is in.
  //
  // With nothing trustworthy in front, they arrive straight from the caller
  // and are dropped. Passing them through would let anybody hand the backend
  // an address of their choosing, and the backend's rate limiter keys on
  // exactly that — a caller could rotate the header and take a fresh budget on
  // every request. They are dropped rather than set, because a Next route
  // handler cannot see the client's socket address and inventing a value would
  // be a lie.
  //
  // With a reverse proxy in front, that proxy has already overwritten them
  // with the address it saw, and dropping them here is what breaks the chain:
  // the backend then keys every request in the whole deployment on this
  // container, and the rate limiter protects nothing. So they are passed
  // through, unchanged, exactly as received from something trusted to set
  // them.
  //
  // The default is to drop. An unset variable behaves as it always has.
  if (!trustProxy()) {
    for (const header of FORWARDING_HEADERS) {
      headers.delete(header);
    }
  }

  const hasBody = !['GET', 'HEAD'].includes(request.method);

  const response = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    // Required by undici when streaming a request body.
    ...(hasBody ? { duplex: 'half' } : {}),
    redirect: 'manual',
  } as RequestInit);

  // Streamed straight back so large responses and file downloads are not
  // buffered in the frontend process.
  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete('content-encoding');
  responseHeaders.delete('content-length');
  responseHeaders.delete('transfer-encoding');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
