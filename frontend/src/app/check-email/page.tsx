'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { AccountPageShell } from '@/components/AccountPageShell';
import { ResendVerification } from '@/components/ResendVerification';
import { useCurrentUser } from '@/hooks/useAuth';

/**
 * Where a new account lands, and where the app sends anyone still unverified.
 *
 * The address is taken from the session when there is one and from the query
 * string otherwise, so the page can name it back to the person — which is the
 * single most useful thing it can do, since the commonest reason a
 * verification email does not arrive is that the address was mistyped.
 */
export default function CheckEmailPage() {
  return (
    <Suspense fallback={null}>
      <CheckEmailView />
    </Suspense>
  );
}

function CheckEmailView() {
  const params = useSearchParams();
  const user = useCurrentUser();
  const email = user.data?.email ?? params.get('email') ?? undefined;

  return (
    <AccountPageShell title="Check your email">
      <div className="space-y-5 text-lede text-ink-muted">
        <p>
          {email ? (
            <>
              We sent a link to <span className="text-ink">{email}</span>. Open it
              to confirm the address and finish setting up your account.
            </>
          ) : (
            'We sent you a link. Open it to confirm your address and finish setting up your account.'
          )}
        </p>
        <p className="text-sm">
          The link works for 24 hours. If it does not arrive within a few
          minutes, check the spam folder before asking for another.
        </p>
      </div>

      <div className="mt-10 border-t border-rule pt-8">
        <ResendVerification email={email} />
      </div>
    </AccountPageShell>
  );
}
