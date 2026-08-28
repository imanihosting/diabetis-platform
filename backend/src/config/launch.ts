import { connectsToBareAddress } from './database-url';
import type { Env } from './env';

/**
 * What still stands between this deployment and serving the public.
 *
 * One computation, consumed by three things that would otherwise each have
 * their own opinion: the boot sequence, which refuses to start; the posture
 * endpoint, which reports; and `scripts/canary.mjs`, which gates a deploy. A
 * launch checklist that lives in three places is a checklist that disagrees
 * with itself on the day somebody is relying on it.
 *
 * **The rule this exists to enforce: the platform must not be able to look
 * live while a known blocker is unresolved.** Not "should not" — must not.
 * Every item below is something that, left unfixed, either exposes a person's
 * record or tells them something untrue about who is responsible for it, and
 * every one of them is the kind of thing that gets deferred to after launch
 * and then forgotten because nothing complains.
 *
 * `PUBLIC_LAUNCH` is the switch. Off, this is advisory: the boot logs say what
 * is outstanding and the process serves anyway, which is right for a
 * development stack and for the staging box. On, every item here is fatal —
 * the backend refuses to start and the frontend image refuses to build. There
 * is deliberately no way to be in public-launch mode with an open blocker,
 * because "we will fix it next week" is how all of these survive.
 *
 * Note what is NOT here: whether a lawyer has read the terms, and whether the
 * legal placeholders have been filled in. Neither is visible from inside a
 * running process. They are checked where they can be —
 * `scripts/check-launch-blockers.mjs`, run during the frontend image build
 * when `PUBLIC_LAUNCH` is on — so a launch image containing `[LEGAL ENTITY]`
 * cannot be produced at all.
 */
export interface LaunchBlocker {
  id: string;
  /** What is wrong, in a sentence an operator can act on. */
  problem: string;
  /** What makes it go away. */
  resolution: string;
}

export interface LaunchInputs {
  env: Env;
  databaseUrl: string | undefined;
  /** Whether rate limit counts are actually shared, not merely configured. */
  rateLimitsShared: boolean;
}

export function launchBlockers({
  env,
  databaseUrl,
  rateLimitsShared,
}: LaunchInputs): LaunchBlocker[] {
  const blockers: LaunchBlocker[] = [];

  if (connectsToBareAddress(databaseUrl)) {
    blockers.push({
      id: 'database-host-is-an-address',
      problem:
        'DATABASE_URL points at a bare IP address, so the certificate cannot ' +
        'be verified against a hostname.',
      resolution:
        'Give the database host a DNS name, reissue its certificate for that ' +
        'name, and connect by name.',
    });
  }

  if (!env.DATABASE_SSL_REJECT_UNAUTHORIZED) {
    blockers.push({
      id: 'database-tls-unverified',
      problem:
        'The database connection is encrypted but unverified, so an attacker ' +
        'who can answer as the database is not detected.',
      resolution:
        'Install a CA-signed certificate, set sslmode=verify-full, then set ' +
        'DATABASE_SSL_REJECT_UNAUTHORIZED=true and REQUIRE_VERIFIED_DB_TLS=true.',
    });
  }

  if (!rateLimitsShared) {
    blockers.push({
      id: 'rate-limits-not-shared',
      problem:
        'Rate limits are counted per process, so every replica hands out its ' +
        'own budget and the sign-in limit multiplies by the deployment size.',
      resolution: 'Set REDIS_URL and REQUIRE_SHARED_RATE_LIMIT=true.',
    });
  }

  if (!env.TRUST_PROXY) {
    blockers.push({
      id: 'client-addresses-not-known',
      problem:
        'TRUST_PROXY is off, so every request is keyed on the address of ' +
        'whatever last forwarded it. Address-based rate limits are therefore ' +
        'one shared budget for the entire internet.',
      resolution:
        'Put a reverse proxy in front that overwrites X-Forwarded-For, set ' +
        'TRUST_PROXY=true on the backend AND on the frontend — the frontend ' +
        'proxy drops the header otherwise and the chain breaks there.',
    });
  }

  return blockers;
}

/** The sentence a boot failure or a canary prints. */
export function describeBlockers(blockers: LaunchBlocker[]): string {
  return blockers
    .map((b) => `  - ${b.id}\n      ${b.problem}\n      fix: ${b.resolution}`)
    .join('\n');
}
