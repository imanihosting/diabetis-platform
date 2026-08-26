import type { Metadata } from 'next';
import Link from 'next/link';
import { Bullet, Clause, LegalPage } from '@/components/marketing/LegalPage';

export const metadata: Metadata = {
  title: 'Cookies · Wellovue',
  description:
    'Wellovue sets one cookie, only after you sign in, and only to keep you signed in. No analytics, no advertising, no third parties.',
};

export default function CookiesPage() {
  return (
    <LegalPage
      title="Cookies"
      updated="26 August 2026"
      summary="One cookie, set only after you sign in, and only to keep you signed in. Nothing is set before that, and nothing is shared with anyone."
    >
      <Clause n={1} title="The only cookie we set">
        <div className="not-prose overflow-x-auto">
          <table className="w-full min-w-[34rem] border border-[var(--brand-rule)] text-sm">
            <tbody className="divide-y divide-[var(--brand-rule)]">
              {[
                ['Name', 'wellovue_refresh'],
                ['Purpose', 'Keeps you signed in, and lets a reload restore your session'],
                ['Set when', 'You sign in. Never before'],
                ['Contains', 'A random value. No name, email, or health data'],
                ['Readable by scripts', 'No. It is HttpOnly, so page code cannot read it'],
                ['Sent to other sites', 'No. It is SameSite=Strict and scoped to /api/auth'],
                ['Expires', '30 days, or immediately when you sign out'],
              ].map(([k, v]) => (
                <tr key={k}>
                  <th
                    scope="row"
                    className="w-[13rem] bg-[var(--paper-sunk)] px-4 py-3 text-left align-top font-medium text-[var(--brand-ink)]"
                  >
                    {k}
                  </th>
                  <td className="px-4 py-3 align-top text-[var(--brand-ink-2)]">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Clause>

      <Clause n={2} title="Why there is no cookie banner">
        <p>
          Under UK and EU rules, a cookie that is strictly necessary to provide a
          service the user asked for does not require consent. Keeping you signed
          in is that kind of cookie, and it is the only one we set.
        </p>
        <p>
          If we ever add one that is not strictly necessary, you will be asked
          first, and it will be off until you say yes. We would rather not add
          one at all.
        </p>
      </Clause>

      <Clause n={3} title="What we do not do">
        <ul>
          <li>
            <Bullet />
            No analytics cookies. We do not use Google Analytics or any
            equivalent.
          </li>
          <li>
            <Bullet />
            No advertising or tracking cookies, and no pixels.
          </li>
          <li>
            <Bullet />
            No third-party scripts on any page. Public pages load nothing from
            another domain.
          </li>
          <li>
            <Bullet />
            Nothing in local storage. Your access token is held in memory for
            the tab and is gone when you close it.
          </li>
        </ul>
      </Clause>

      <Clause n={4} title="Removing it">
        <p>
          Signing out deletes it. You can also clear it from your browser
          settings at any time. The only consequence is that you will be signed
          out and will need to sign in again.
        </p>
        <p>
          If you used Wellovue before it was renamed, an older cookie named{' '}
          <span className="measure">diabetes_refresh</span> may still be on your
          device. It does nothing, and we delete it the next time you sign out.
        </p>
      </Clause>

      <Clause n={5} title="Questions">
        <p>
          What we hold and why is set out in the{' '}
          <Link href="/privacy">privacy policy</Link>. Anything else, use the{' '}
          <Link href="/contact">contact page</Link>.
        </p>
      </Clause>
    </LegalPage>
  );
}
