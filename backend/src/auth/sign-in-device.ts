import { createHmac } from 'node:crypto';

/**
 * What "a new device" means for the sign-in notification.
 *
 * The user agent, and nothing else. It is a weak signal — two identical
 * browsers on two laptops look the same, and a browser update looks like a new
 * device — and it is the strongest one available without doing something worse.
 * The obvious improvements all make the platform hold more about a person than
 * it needs: an IP address is a location, a canvas fingerprint is tracking, a
 * device cookie is another credential to lose.
 *
 * The failure modes are asymmetric in the right direction. A missed
 * notification is a notification; a spurious one is an email saying "if this
 * was you, nothing to do", which is honest and cheap. Neither can block a
 * sign-in.
 */

/**
 * A stable, non-reversible identifier for a browser.
 *
 * Keyed with the JWT secret rather than hashed plainly. A bare SHA-256 of a
 * user agent is reversible in practice — the space of real user agent strings
 * is small and enumerable — so the raw string would effectively still be in the
 * table. Keying it means the stored value is useless to anybody without the
 * secret, and the secret is already the thing whose loss ends the session
 * system anyway.
 *
 * The consequence, which is deliberate: rotating JWT_SECRET makes every device
 * look new, so everybody gets one "new sign-in" email. That is the correct
 * behaviour for a secret rotation and a good reason to do them rarely.
 */
export function deviceFingerprint(userAgent: string, secret: string): string {
  return createHmac('sha256', secret).update(userAgent.trim()).digest('hex');
}

/**
 * The coarse description an email is allowed to quote.
 *
 * A user agent is a tracking identifier and does not belong in somebody's
 * inbox, on a lock screen, or in a mail provider's logs. "Chrome on macOS" is
 * what a person needs to recognise their own laptop, and is shared by millions
 * of others.
 *
 * Order matters: Edge and Opera both claim to be Chrome, Chrome claims to be
 * Safari, and Safari claims to be Mozilla. Each browser is therefore tested
 * before the one it impersonates.
 */
export function deviceClass(userAgent: string | undefined): string {
  if (!userAgent) return 'Unrecognised device';

  const ua = userAgent.toLowerCase();

  const browser =
    pick(ua, [
      ['edg/', 'Edge'],
      ['opr/', 'Opera'],
      ['firefox/', 'Firefox'],
      ['chrome/', 'Chrome'],
      ['safari/', 'Safari'],
    ]) ?? 'A browser';

  const platform =
    pick(ua, [
      ['iphone', 'iPhone'],
      ['ipad', 'iPad'],
      ['android', 'Android'],
      ['mac os x', 'macOS'],
      ['windows', 'Windows'],
      ['cros', 'ChromeOS'],
      ['linux', 'Linux'],
    ]) ?? 'an unrecognised system';

  return `${browser} on ${platform}`;
}

function pick(haystack: string, table: [string, string][]): string | null {
  for (const [needle, label] of table) {
    if (haystack.includes(needle)) return label;
  }
  return null;
}
