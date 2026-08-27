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

  // No check on the public site here. The frontend is a separate deployable
  // that will have its own address, and asserting it from the API's host
  // produced a warning about a 404 that was always going to be a 404 — a
  // check nobody can act on teaches people to skim the output.
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
