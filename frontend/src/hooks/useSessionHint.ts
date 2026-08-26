'use client';

import { useEffect, useState } from 'react';

/** Mirrors SESSION_HINT_COOKIE_NAME in the backend. */
const HINT = 'wellovue_signed_in';

/**
 * Whether a session probably exists, read from a cookie that carries no
 * authority.
 *
 * Public pages need this to decide whether the header points at a login form
 * or at the person's own timeline. Asking the API on every anonymous page view
 * would cost a request per visitor on the most-visited pages we have.
 *
 * Resolved after mount, never during render, so the server-rendered markup and
 * the first client render agree. Anonymous visitors see the signed-out header
 * and nothing moves; signed-in visitors see it correct a moment later.
 *
 * A stale hint is possible and harmless: the link leads to the app, and the
 * app resolves the real session itself.
 */
export function useSessionHint(): boolean {
  const [hinted, setHinted] = useState(false);

  useEffect(() => {
    setHinted(
      document.cookie.split('; ').some((c) => c.startsWith(`${HINT}=`)),
    );
  }, []);

  return hinted;
}

/** Clears the hint when the session it described turns out to be gone. */
export function clearSessionHint(): void {
  document.cookie = `${HINT}=; Max-Age=0; Path=/; SameSite=Lax`;
}
