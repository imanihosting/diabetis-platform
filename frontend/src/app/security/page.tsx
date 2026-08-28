import Link from 'next/link';
import { MarketingShell } from '@/components/marketing/MarketingShell';
import { PageHeader, Prose } from '@/components/marketing/PageHeader';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata('/security');

/**
 * How the data is held, in things that are actually built.
 *
 * Every claim on this page corresponds to something in the repository: the
 * append-only trigger in migration 0008, argon2 in `auth.service.ts`, the
 * pinned CA the database connection verifies against, the schema guards the
 * integration suite attacks directly. §7 of the handover applies here more
 * than anywhere — a security page is the easiest place on a site to write
 * something reassuring and untrue, and the reader most likely to check is
 * exactly the reader this page is for.
 *
 * It therefore also says what is not done. A security page with no such
 * section is not describing a real system.
 */
export default function SecurityPage() {
  return (
    <MarketingShell>
      <PageHeader
        eyebrow="Security"
        heading="What holds your record, and what it refuses to do with it."
      >
        <p>
          This describes the system as built rather than as intended. Where
          something is not in place yet, it says so.
        </p>
      </PageHeader>

      <Prose eyebrow="In transit" heading="Verified connections, not merely encrypted ones.">
        <p>
          Traffic between the application and its database is encrypted and the
          database&rsquo;s certificate is verified against a pinned authority,
          so an encrypted connection to the wrong host fails instead of
          succeeding quietly. That verification is checked by its own command
          rather than assumed.
        </p>
      </Prose>

      <Prose eyebrow="Accounts" heading="Passwords that cannot be read back.">
        <p>
          Passwords are stored as argon2 hashes, never as recoverable text.
          Credentials live in their own isolated part of the schema, separate
          from health data.
        </p>
        <p>
          Sessions use a short-lived access token in memory and a refresh cookie
          the browser cannot read from JavaScript, restricted to the site and to
          the authentication path. Repeated failed sign-in attempts are rejected
          before they reach the password check.
        </p>
      </Prose>

      <Prose
        eyebrow="The audit trail"
        heading="Append-only, enforced by the database."
      >
        <p>
          Access to health data is recorded, and those records cannot be edited
          or deleted — a database trigger refuses both, so the guarantee does
          not depend on application code remembering to honour it.
        </p>
        <p>
          There is one exception and it is deliberate: when a person asks to be
          erased, the trail keeps what happened and drops the link to who they
          were. That is anonymisation rather than revision, and every other
          column stays byte for byte as it was written.
        </p>
      </Prose>

      <Prose
        eyebrow="Safety"
        heading="The rules are in the schema, not only in the code."
      >
        <p>
          The boundaries this product holds to — that a running experiment must
          have a prediction recorded before it starts, that a completed one must
          have an outcome, that a blocked protocol cannot be activated — are
          enforced by database constraints as well as by application logic, and
          the test suite attacks them directly over SQL rather than through the
          application that is supposed to prevent them.
        </p>
        <p>
          A safety rule that only exists in a code path is one refactor away
          from not existing.
        </p>
      </Prose>

      <Prose eyebrow="What is not collected" heading="No analytics, no advertising, no third parties.">
        <p>
          There is no analytics script, no advertising network and no third-party
          tracker on this site. Cookies are set only after you sign in and only
          to keep you signed in; the{' '}
          <Link href="/cookies" className="text-[var(--ink)] underline underline-offset-4">cookie policy</Link> names each one and what it
          does. <Link href="/privacy" className="text-[var(--ink)] underline underline-offset-4">Privacy</Link> covers what is held, for how
          long, and how to get it back or have it erased.
        </p>
      </Prose>

      <Prose eyebrow="What is not in place" heading="Stated plainly, because it matters.">
        <p>
          Wellovue has not completed an external security audit and holds no
          security certification. It is not a certified medical device and has
          not been through clinical or regulatory review. Its legal terms carry
          placeholders pending review by a qualified lawyer.
        </p>
        <p>
          None of that stops the engineering above being real, and none of it
          should be discovered by a reader after they have trusted the product
          with a health record.
        </p>
      </Prose>

      <Prose eyebrow="Reporting a problem" heading="Tell us and we will answer.">
        <p>
          If you believe you have found a vulnerability, please{' '}
          <Link href="/contact" className="text-[var(--ink)] underline underline-offset-4">get in touch</Link> with enough detail to
          reproduce it. Please do not access, modify, or retain anybody
          else&rsquo;s data while investigating.
        </p>
      </Prose>
    </MarketingShell>
  );
}
