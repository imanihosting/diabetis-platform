#!/usr/bin/env node
/**
 * Checks a running deployment and exits non-zero when it should not carry
 * traffic.
 *
 *   node scripts/canary.mjs http://localhost:4000
 *   node scripts/canary.mjs https://api.example.com --require-production
 *
 * Takes a base URL rather than reading configuration, so the same script runs
 * against the local compose stack, a staging box, and production. Nothing here
 * needs a shell on the host or the environment of the container: everything is
 * observed from outside, over HTTP, the way a load balancer would.
 *
 * Two kinds of check, deliberately separated.
 *
 * **Health** is whether the process can serve: is it up, are its dependencies
 * reachable. These fail the canary anywhere.
 *
 * **Posture** is whether it should be trusted with real people's records:
 * verified database TLS, rate limits shared across replicas. These are states
 * the platform runs in on purpose today, so they are reported as warnings and
 * only fail with `--require-production`. A gate that goes red for the
 * configuration the thing shipped with is a gate somebody switches off, and
 * then it is not there on the day it matters.
 */

const [, , baseUrlArg, ...flags] = process.argv;

if (!baseUrlArg || baseUrlArg === '--help' || baseUrlArg === '-h') {
  console.error('usage: node scripts/canary.mjs <base-url> [--require-production] [--timeout-ms N]');
  process.exit(2);
}

const requireProduction = flags.includes('--require-production');
const timeoutMs = Number(
  flags.find((f) => f.startsWith('--timeout-ms'))?.split('=')[1] ?? 5000,
);

const base = baseUrlArg.replace(/\/+$/, '');
const api = base.endsWith('/api') ? base : `${base}/api`;

/** Results, printed as one table at the end rather than a running commentary. */
const checks = [];
const record = (name, state, detail) => checks.push({ name, state, detail });

async function get(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${api}${path}`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  // 1. Liveness. Everything else is meaningless if this fails, so it is the
  //    only check that stops the run early.
  try {
    const live = await get('/health/live');
    if (!live.ok) {
      record('process', 'fail', `GET /health/live returned ${live.status}`);
      return;
    }
    record('process', 'pass', 'responding');
  } catch (err) {
    record('process', 'fail', `unreachable: ${err.message}`);
    return;
  }

  // 2. Dependencies, as the process itself sees them.
  const ready = await get('/health/ready');
  const dependencies = ready.body?.checks ?? {};

  record(
    'database',
    dependencies.database ? 'pass' : 'fail',
    dependencies.database ? 'reachable' : 'not reachable from the backend',
  );
  record(
    'object storage',
    dependencies.storage ? 'pass' : 'fail',
    dependencies.storage ? 'reachable' : 'not reachable from the backend',
  );
  // The engine's absence degrades the product rather than breaking it: the
  // timeline, the log and the record all work without it. Findings do not,
  // which is worth knowing about and is not worth refusing traffic over.
  record(
    'metabolic engine',
    dependencies.metabolicEngine ? 'pass' : 'warn',
    dependencies.metabolicEngine
      ? 'reachable'
      : 'not reachable — evidence will fail, everything else serves',
  );

  // 3. Posture.
  const posture = ready.body?.posture ?? (await get('/health/posture')).body;

  if (!posture) {
    record('posture', 'fail', 'the deployment does not report its posture — is it an old build?');
  } else {
    record(
      'database TLS verified',
      posture.databaseTlsVerified ? 'pass' : requireProduction ? 'fail' : 'warn',
      posture.databaseTlsVerified
        ? 'certificate is checked'
        : 'encrypted but UNVERIFIED — an attacker answering as the database is not detected',
    );

    // Expiry, separately from validity. A certificate that verifies today and
    // expires next week is the specific failure this platform arranges for
    // itself the moment REQUIRE_VERIFIED_DB_TLS is on: the backend stops
    // starting. Let's Encrypt issues for 90 days and renews at 30, so anything
    // under three weeks means renewal has already stopped working.
    const cert = posture.databaseCertificate;
    if (cert) {
      const days = cert.daysRemaining;
      record(
        'database certificate',
        days <= 7 ? 'fail' : days <= 21 ? 'warn' : 'pass',
        `${cert.subject}, issued by ${cert.issuer}, expires in ${days} days` +
          (days <= 21
            ? ' — renewal has not replaced it; check the certbot timer and the reload hook'
            : ''),
      );
    }

    const shared = posture.rateLimit?.sharedAcrossReplicas;
    record(
      'rate limits shared',
      shared ? 'pass' : requireProduction ? 'fail' : 'warn',
      shared
        ? 'counted in Redis'
        : posture.rateLimit?.configured
          ? 'Redis is configured but not answering — counting per process'
          : 'counted per process — every replica has its own budget',
    );
  }

  // 4. Schema. A backend serving against a database older than its code does
  //    not fail readiness — the connection is fine — and presents as arbitrary
  //    500s from whichever route touches the missing column. The count is
  //    compared against the migrations in the tree this script was run from,
  //    which is the only place that knows what the code expects.
  const applied = ready.body?.migrations ?? null;
  const expected = await expectedMigrations();

  if (!applied) {
    record('migrations', 'fail', 'the database has no schema_migrations table — never migrated');
  } else if (expected === null) {
    record('migrations', 'warn', `${applied.count} applied; no migrations directory to compare against`);
  } else if (applied.count < expected) {
    record(
      'migrations',
      'fail',
      `${applied.count} applied, ${expected} in this tree — run db:migrate before serving`,
    );
  } else if (applied.count > expected) {
    // Ahead, not behind: the database has migrations this checkout does not.
    // Usually an older image against a newer database, which is a rollback
    // that has not been thought through rather than a missing step.
    record(
      'migrations',
      'warn',
      `${applied.count} applied, ${expected} in this tree — the database is ahead of this code`,
    );
  } else {
    record('migrations', 'pass', `${applied.count} applied, latest ${applied.latest}`);
  }

  // 5. Launch blockers, as the process itself computes them. The same function
  //    the backend refuses to start on when PUBLIC_LAUNCH is set, so a canary
  //    and a running deployment cannot disagree about whether it is ready.
  const blockers = posture?.launchBlockers ?? [];
  if (posture?.publicLaunch) {
    // It says it is serving the public. If it started at all the list is
    // empty, so a non-empty one here means something changed underneath a
    // running process.
    record(
      'launch blockers',
      blockers.length === 0 ? 'pass' : 'fail',
      blockers.length === 0
        ? 'serving the public with none outstanding'
        : `${blockers.length} outstanding on a deployment claiming to be live: ` +
          blockers.map((b) => b.id).join(', '),
    );
  } else {
    record(
      'launch blockers',
      blockers.length === 0
        ? 'pass'
        : requireProduction
          ? 'fail'
          : 'warn',
      blockers.length === 0
        ? 'none outstanding, though PUBLIC_LAUNCH is off'
        : `${blockers.length} outstanding: ${blockers.map((b) => b.id).join(', ')}`,
    );
  }

  // 6. The public site, over the address a person actually types. Only when
  //    the canary was pointed at a site rather than at an API, which is what
  //    the /api suffix distinguishes.
  await checkPublicSite();
}

/**
 * How many migrations this checkout expects.
 *
 * Read from the tree rather than asked of the deployment, because the
 * deployment cannot know: the SQL files are not in the runtime image. Null when
 * the directory is absent, which is the case when this script has been copied
 * somewhere on its own.
 */
async function expectedMigrations() {
  try {
    const { readdir } = await import('node:fs/promises');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const files = await readdir(join(root, 'infra', 'db', 'migrations'));
    return files.filter((f) => f.endsWith('.sql')).length;
  } catch {
    return null;
  }
}

/**
 * The pages a person and a search engine actually reach.
 *
 * Checked over the site's own origin rather than the API's, and skipped when
 * this canary was pointed straight at an API — a warning about a 404 that was
 * always going to be a 404 teaches people to skim the output.
 *
 * The authenticated routes are checked for *refusing*, not for serving. A
 * canary has no credentials and should not have any; what it can prove is the
 * thing that matters most, which is that somebody's timeline is not reachable
 * without them.
 */
async function checkPublicSite() {
  if (base.endsWith('/api')) return;

  const fetchStatus = async (path) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${base}${path}`, {
        signal: controller.signal,
        redirect: 'manual',
      });
      return res.status;
    } catch (err) {
      return `unreachable: ${err.message}`;
    } finally {
      clearTimeout(timer);
    }
  };

  for (const path of ['/', '/robots.txt', '/sitemap.xml']) {
    const status = await fetchStatus(path);
    record(`public ${path}`, status === 200 ? 'pass' : 'fail', `HTTP ${status}`);
  }

  // Signed-in routes must not serve to somebody with no session. A 200 here is
  // the worst result this script can produce.
  for (const path of ['/api/evidence', '/api/reports/clinician']) {
    const status = await fetchStatus(path);
    const refused = status === 401 || status === 403;
    record(
      `refuses ${path}`,
      refused ? 'pass' : 'fail',
      refused ? `HTTP ${status}` : `HTTP ${status} — this must not answer without a session`,
    );
  }

  if (base.startsWith('https://')) {
    record('site TLS', 'pass', 'reached over HTTPS');
  } else {
    record(
      'site TLS',
      requireProduction ? 'fail' : 'warn',
      'reached over plain HTTP — a health record site must terminate TLS',
    );
  }
}

await main();

const width = Math.max(...checks.map((c) => c.name.length));
const SYMBOL = { pass: 'ok  ', warn: 'warn', fail: 'FAIL' };
for (const check of checks) {
  console.log(`${SYMBOL[check.state]}  ${check.name.padEnd(width)}  ${check.detail}`);
}

const failed = checks.filter((c) => c.state === 'fail');
const warned = checks.filter((c) => c.state === 'warn');

console.log('');
if (failed.length) {
  console.log(`${failed.length} check(s) failed. This deployment should not carry traffic.`);
  process.exit(1);
}
if (warned.length && !requireProduction) {
  console.log(
    `${warned.length} warning(s). Run with --require-production to treat posture ` +
      'warnings as failures once this is serving real records.',
  );
}
console.log('Canary passed.');
