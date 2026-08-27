import { describe, expect, it } from 'vitest';
import { connectsToBareAddress } from '../src/config/database-url';

/**
 * The two boot-time refusals, and the trap one of them exists to answer.
 *
 * `REQUIRE_VERIFIED_DB_TLS=true` against a bare IP address cannot succeed and
 * cannot be made to succeed by installing a certificate: `verify-full` checks
 * that the certificate was issued for the host being connected to, and RFC
 * 6066 does not permit an IP literal in SNI, so there is no name to check
 * against. Someone who flips the flag without reading infra/README.md gets a
 * TLS handshake failure and goes looking for a problem with their certificate,
 * which is a week of the wrong work. The boot check answers with the actual
 * blocker: the host needs a DNS name first.
 */
describe('database URL host detection', () => {
  it('recognises the IP literal the platform runs against today', () => {
    expect(
      connectsToBareAddress('postgresql://app:pw@10.10.5.185:5432/diabetes?sslmode=require'),
    ).toBe(true);
  });

  it('recognises other bare addresses, including IPv6 and loopback', () => {
    for (const url of [
      'postgresql://app:pw@127.0.0.1:5432/db',
      'postgresql://app:pw@192.168.3.10/db',
      'postgresql://app:pw@[2001:db8::1]:5432/db',
    ]) {
      expect(connectsToBareAddress(url)).toBe(true);
    }
  });

  it('accepts a name, which is the thing that unblocks verification', () => {
    for (const url of [
      'postgresql://app:pw@db.wellovue.internal:5432/diabetes?sslmode=verify-full',
      'postgresql://app:pw@localhost:5432/db',
      'postgresql://app:pw@postgres/db',
    ]) {
      expect(connectsToBareAddress(url)).toBe(false);
    }
  });

  it('treats an unset or unparseable URL as not-a-bare-address', () => {
    // The check exists to produce a better error, never to become one. A
    // malformed URL is somebody else's failure to report, and reporting it
    // here as "you used an IP address" would be a lie.
    expect(connectsToBareAddress(undefined)).toBe(false);
    expect(connectsToBareAddress('not a url at all')).toBe(false);
  });
});
