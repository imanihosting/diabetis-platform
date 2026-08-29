import type { Ttl } from '../config/env';

/**
 * The three things done with a `15m` / `24h` / `30d` duration.
 *
 * Collected here because there are now four places that mint an expiring
 * thing — sessions, refresh tokens, mailed links, waitlist confirmations —
 * and three of them had grown their own copy of the same regex. A duration
 * parser that exists four times is a duration parser that will eventually
 * disagree with itself about what `1h` means, in the one place nobody looks.
 *
 * `env.ts` validates the shape at boot, so a malformed value never reaches
 * here. The throws are for the case where somebody constructs one by hand.
 */

const PATTERN = /^(\d+)([smhd])$/;

function parse(ttl: Ttl): { amount: number; unit: 's' | 'm' | 'h' | 'd' } {
  const match = PATTERN.exec(ttl);
  if (!match) throw new Error(`Unsupported TTL format: ${ttl}`);
  return { amount: Number(match[1]), unit: match[2] as 's' | 'm' | 'h' | 'd' };
}

/** `30d` as a Postgres interval literal, for `now() + $1::interval`. */
export function toPostgresInterval(ttl: Ttl): string {
  const { amount, unit } = parse(ttl);
  return `${amount} ${{ s: 'seconds', m: 'minutes', h: 'hours', d: 'days' }[unit]}`;
}

/** `15m` as 900, for the `expiresIn` a client is told. */
export function ttlToSeconds(ttl: Ttl): number {
  const { amount, unit } = parse(ttl);
  return amount * { s: 1, m: 60, h: 3600, d: 86_400 }[unit];
}

/**
 * `24h` as "24 hours", for an email that has to say when a link stops working.
 *
 * Prose rather than a duration string, because the reader is a person holding
 * a link and not a program.
 */
export function describeTtl(ttl: Ttl): string {
  const { amount, unit } = parse(ttl);
  const word = { s: 'second', m: 'minute', h: 'hour', d: 'day' }[unit];
  return `${amount} ${word}${amount === 1 ? '' : 's'}`;
}
