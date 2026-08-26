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
export const REFRESH_COOKIE_NAME = 'diabetes_refresh';

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
}

export function clearRefreshCookie(response: Response, isProduction: boolean): void {
  // maxAge must be omitted when clearing, or the browser keeps the cookie.
  const { maxAge: _maxAge, ...options } = refreshCookieOptions(isProduction);
  response.clearCookie(REFRESH_COOKIE_NAME, options);
}
