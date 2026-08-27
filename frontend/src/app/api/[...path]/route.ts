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

  // Forwarding headers arrive here straight from the caller, and nothing in
  // front of this route rewrites them. Passing them through would let anyone
  // hand the backend an address of their choosing, which matters because the
  // backend's rate limiter keys on exactly that: a caller could rotate the
  // header and get a fresh budget on every request.
  //
  // They are dropped rather than set, because a Next route handler cannot see
  // the client's socket address and inventing a value would be a lie. The
  // backend then keys on this proxy's address and refuses to read the header
  // at all unless TRUST_PROXY says a real proxy owns it. Once one is in front
  // of the deployment, it becomes the thing that sets these, and it is what
  // the backend is configured to trust.
  for (const header of ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip', 'forwarded']) {
    headers.delete(header);
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
