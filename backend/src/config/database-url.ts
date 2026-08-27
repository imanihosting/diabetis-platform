/**
 * Whether a database URL points at a bare address rather than a name.
 *
 * Its own module because `main.ts` calls `bootstrap()` at import time: a test
 * that imported this from there would start the server as a side effect of
 * checking a regular expression.
 *
 * The distinction matters more than it looks. `verify-full` checks that the
 * certificate was issued for the host being connected to, and RFC 6066 does
 * not permit an IP address in SNI — so a connection to `10.10.5.185` has no
 * name to check a certificate against, and no certificate can fix it. Reaching
 * verified TLS means giving the database host a DNS name first, and that has a
 * lead time nothing else in the launch list has.
 */
export function connectsToBareAddress(databaseUrl: string | undefined): boolean {
  if (!databaseUrl) return false;

  let host: string;
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    // Not this function's failure to report. Saying "you used an IP address"
    // about a malformed URL would send somebody after the wrong problem.
    return false;
  }

  // IPv6 arrives from the URL parser with its brackets already stripped, so a
  // colon in the hostname is enough to recognise one.
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}
