#!/usr/bin/env node
/**
 * Reports what a database connection actually negotiated.
 *
 * Written because "we set sslmode=verify-full" and "the connection is verified"
 * are different claims, and the gap between them is silent: a URL that says
 * `verify-full` while the client library was handed `rejectUnauthorized: false`
 * connects happily and verifies nothing. The only way to know is to connect
 * with verification demanded and see whether it refuses.
 *
 * Run it from a machine that is not the database host, so the path under test
 * is the one real traffic takes.
 *
 *   node --env-file=.env scripts/verify-db-tls.mjs
 *
 * Exits non-zero when the connection is unverified, so CI or a deploy gate can
 * depend on it.
 */
import pg from 'pg';

const url = new URL(process.env.DATABASE_URL ?? '');
if (!url.host) {
  console.error('DATABASE_URL is not set.');
  process.exit(2);
}

const sslmode = url.searchParams.get('sslmode') ?? 'prefer';
const rejectUnauthorized = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false';
url.searchParams.delete('sslmode');

const redactedHost = `${url.hostname}:${url.port || 5432}`;
console.log(`Host:        ${redactedHost}`);
console.log(`sslmode:     ${sslmode}`);
console.log(`verify certs: ${rejectUnauthorized}`);
console.log('');

if (sslmode === 'disable') {
  console.error('FAIL: sslmode=disable. The connection is not encrypted at all.');
  process.exit(1);
}

/**
 * Whether the URL connects to a bare address rather than a name.
 *
 * This matters more than it looks. `verify-full` checks the certificate was
 * issued for the host being connected to, and RFC 6066 does not permit an IP
 * address in SNI, so a connection to `10.10.5.185` has no name to check
 * against. Reaching verified TLS therefore requires giving the database a DNS
 * name first; no certificate can fix an IP-literal URL.
 */
const isIpLiteral = /^\[?[0-9a-fA-F:.]+\]?$/.test(url.hostname) &&
  /[0-9a-fA-F]/.test(url.hostname) &&
  !/[a-zA-Z]{2}/.test(url.hostname);

/** Connects with verification demanded, regardless of what the env asks for. */
async function probe(verify) {
  const client = new pg.Client({
    connectionString: url.toString(),
    ssl: {
      rejectUnauthorized: verify,
      // The certificate must be issued for the name being connected to.
      // Omitted for an IP literal, which SNI cannot carry.
      ...(isIpLiteral ? {} : { servername: url.hostname }),
    },
    connectionTimeoutMillis: 10_000,
  });
  try {
    await client.connect();
    const { rows } = await client.query(
      "select ssl, version, cipher from pg_stat_ssl where pid = pg_backend_pid()",
    );
    // Read off the live socket before closing it. node-postgres exposes no
    // API for the peer certificate, so this reaches through to the TLS socket
    // it is holding; every step is optional-chained because a shape change in
    // pg should cost this script its certificate detail, never its verdict.
    const certificate = peerCertificate(client);
    await client.end();
    return { ok: true, info: rows[0], certificate };
  } catch (err) {
    await client.end().catch(() => {});
    return { ok: false, error: err.message };
  }
}

/**
 * The certificate the server actually presented, or null.
 *
 * Reported because the interesting question changes the moment verification is
 * switched on. Before that, an expiring certificate is tolerated silently.
 * After it, an expired one means the backend refuses to start — which is the
 * correct behaviour and also a scheduled outage if nobody was watching the
 * date. Verification and expiry monitoring are the same piece of work; doing
 * the first without the second trades a quiet risk for a quiet deadline.
 */
function peerCertificate(client) {
  try {
    const socket = client.connection?.stream;
    const cert = socket?.getPeerCertificate?.();
    if (!cert || !cert.valid_to) return null;
    const expiresAt = new Date(cert.valid_to);
    return {
      subject: cert.subject?.CN ?? 'unknown',
      issuer: cert.issuer?.CN ?? 'unknown',
      names: cert.subjectaltname ?? '',
      expiresAt,
      daysRemaining: Math.floor((expiresAt.getTime() - Date.now()) / 86_400_000),
    };
  } catch {
    return null;
  }
}

const verified = await probe(true);

if (verified.ok) {
  const { ssl, version, cipher } = verified.info ?? {};
  console.log(`Encrypted:   ${ssl === true ? 'yes' : 'NO'}`);
  console.log(`Protocol:    ${version ?? 'unknown'}`);
  console.log(`Cipher:      ${cipher ?? 'unknown'}`);
  console.log('');
  if (ssl !== true) {
    console.error('FAIL: the server accepted the connection without TLS.');
    process.exit(1);
  }
  const cert = verified.certificate;
  if (cert) {
    console.log(`Issued to:   ${cert.subject}`);
    console.log(`Issued by:   ${cert.issuer}`);
    if (cert.names) console.log(`Valid for:   ${cert.names}`);
    console.log(
      `Expires:     ${cert.expiresAt.toISOString().slice(0, 10)} ` +
        `(${cert.daysRemaining} days)`,
    );
    console.log('');
  }

  console.log('PASS: the certificate chain and hostname both verified.');

  // Renewal is the part that fails quietly. Let's Encrypt issues for 90 days
  // and renews at 30; a certificate inside that window that has not renewed
  // means the timer, the hook or the DNS credential has stopped working, and
  // with REQUIRE_VERIFIED_DB_TLS=true the deadline is an outage rather than a
  // warning.
  if (cert && cert.daysRemaining <= 21) {
    console.log('');
    console.error(
      `WARNING: the certificate expires in ${cert.daysRemaining} days and ` +
        'renewal has not replaced it. Check `certbot renew --dry-run` and the ' +
        'deploy hook that reloads PostgreSQL — a renewed certificate on disk ' +
        'that PostgreSQL never reloaded looks exactly like this.',
    );
  }
  if (!rejectUnauthorized) {
    console.log('');
    console.log(
      'Note: verification succeeds, but DATABASE_SSL_REJECT_UNAUTHORIZED is ' +
        'still false, so the running app is not asking for it. Set it to true ' +
        'and set REQUIRE_VERIFIED_DB_TLS=true.',
    );
    process.exit(1);
  }
  process.exit(0);
}

// Verification failed. Find out whether the host is simply unreachable, or
// whether it is reachable and presenting a certificate we cannot trust —
// which is the condition this script exists to name.
const unverified = await probe(false);

console.error('FAIL: the connection could not be verified.');
console.error(`  ${verified.error}`);
console.error('');
if (unverified.ok) {
  console.error(
    'The host is reachable and TLS works, but the certificate is not trusted ' +
      '(self-signed, wrong hostname, or an unknown CA). Traffic is encrypted ' +
      'and an attacker who can answer as the database will not be detected. ' +
      'See the TLS section of infra/README.md.',
  );

  // What was actually presented. "Issued to localhost by localhost" answers
  // the question in one line, and distinguishes a certificate for the wrong
  // name — which is a five-minute fix — from no real certificate at all.
  const cert = unverified.certificate;
  if (cert) {
    console.error('');
    console.error(`  presented: ${cert.subject}, issued by ${cert.issuer}`);
    if (cert.names) console.error(`  valid for: ${cert.names}`);
    console.error(
      `  expires:   ${cert.expiresAt.toISOString().slice(0, 10)} ` +
        `(${cert.daysRemaining} days)`,
    );
  }
  if (isIpLiteral) {
    console.error('');
    console.error(
      `DATABASE_URL connects to the bare address ${url.hostname}. No ` +
        'certificate can satisfy verify-full against an IP literal, because ' +
        'there is no name to check it against and SNI cannot carry one. Give ' +
        'the database host a DNS name and use it in DATABASE_URL before ' +
        'issuing the certificate.',
    );
  }
} else {
  console.error(`The host was not reachable at all: ${unverified.error}`);
}
process.exit(1);
