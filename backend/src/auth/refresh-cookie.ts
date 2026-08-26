import type { CookieOptions, Response } from 'express';

/**
 * The refresh token is carried in an HttpOnly cookie, never in a place
 * JavaScript can read.
 *
 * The refresh token is the long-lived credential: it mints new sessions for
 * up to 30 days. Held in localStorage, any XSS anywhere in the app hands an
 * attacker a durable foothold in someone's health record. In an HttpOnly
 * cookie, script cannot read it even if script is running.
 *
 * The short-lived access token stays out of storage entirely and lives only
 * in memory for the tab's lifetime.
 */
export const REFRESH_COOKIE_NAME = 'wellovue_refresh';

/**
 * Names this cookie has had before.
 *
 * Renaming a cookie does not remove the old one: it sits in the browser until
 * it expires, doing nothing. Clearing it alongside the current one keeps the
 * cookie policy page truthful about what is actually on someone's device.
 */
const LEGACY_COOKIE_NAMES = ['diabetes_refresh'];

/**
 * A readable hint that a session exists. Carries no authority whatsoever.
 *
 * The refresh cookie is HttpOnly and scoped to /api/auth, so a public page has
 * no way to tell whether the visitor is signed in. Without that, the marketing
 * header has to either show "Sign in" to someone who already is, or ask the
 * API on every anonymous page view just to find out.
 *
 * This holds the single character "1". It grants nothing, proves nothing, and
 * is never trusted by the server. It exists so the header can point somebody
 * at their own timeline instead of a login form.
 */
export const SESSION_HINT_COOKIE_NAME = 'wellovue_signed_in';

/** Scoped to the auth routes, so it is not attached to every API request. */
const REFRESH_COOKIE_PATH = '/api/auth';

export function refreshCookieOptions(isProduction: boolean): CookieOptions {
  return {
    httpOnly: true,
    // `strict` rather than `lax`: no third-party context has any reason to
    // trigger a session refresh for a health record.
    sameSite: 'strict',
    // Requires HTTPS in production; relaxed locally so http://localhost works.
    secure: isProduction,
    path: REFRESH_COOKIE_PATH,
    maxAge: 30 * 24 * 60 * 60 * 1000,
  };
}

export function setRefreshCookie(
  response: Response,
  token: string,
  isProduction: boolean,
): void {
  response.cookie(REFRESH_COOKIE_NAME, token, refreshCookieOptions(isProduction));

  // Readable by the page, and deliberately so. Lax rather than Strict, because
  // it has to survive a return navigation from somewhere else; there is
  // nothing here worth protecting from a cross-site read.
  response.cookie(SESSION_HINT_COOKIE_NAME, '1', {
    httpOnly: false,
    sameSite: 'lax',
    secure: isProduction,
    path: '/',
    maxAge: refreshCookieOptions(isProduction).maxAge,
  });
}

export function clearRefreshCookie(response: Response, isProduction: boolean): void {
  // maxAge must be omitted when clearing, or the browser keeps the cookie.
  const { maxAge: _maxAge, ...options } = refreshCookieOptions(isProduction);
  for (const name of [REFRESH_COOKIE_NAME, ...LEGACY_COOKIE_NAMES]) {
    response.clearCookie(name, options);
  }

  response.clearCookie(SESSION_HINT_COOKIE_NAME, {
    httpOnly: false,
    sameSite: 'lax',
    secure: isProduction,
    path: '/',
  });
}
