'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef } from 'react';
import { AccountPageShell } from '@/components/AccountPageShell';
import { useConfirmWaitlist } from '@/hooks/useEmailVerification';

/**
 * Where the landing page's confirmation email lands.
 *
 * Its reader has no account and may not want one — they left an address on a
 * marketing page. So the copy stays out of the product's way: it confirms what
 * happened, says what will and will not arrive, and offers the site rather
 * than a sign-in form.
 *
 * A failed confirmation is deliberately low-drama. Nothing is broken and
 * nothing is lost; entering the address again on the landing page sends a
 * fresh link, and that is the whole remedy.
 */
export default function ConfirmWaitlistPage() {
  return (
    <Suspense fallback={null}>
      <ConfirmWaitlistView />
    </Suspense>
  );
}

const FOOTNOTE =
  'Wellovue only emails this address about the product. It is never used for ' +
  'anything else, and never shared.';

function ConfirmWaitlistView() {
  const token = useSearchParams().get('token');
  const confirm = useConfirmWaitlist();

  // Once, on arrival. The token is single-use, and React's development strict
  // mode runs effects twice — without this the second run spends a token the
  // first already consumed and the page reports its own success as invalid.
  const attempted = useRef(false);
  useEffect(() => {
    if (!token || attempted.current) return;
    attempted.current = true;
    confirm.mutate(token);
  }, [token, confirm]);

  if (!token) return <Unconfirmed reason="incomplete" />;

  if (confirm.isPending || confirm.isIdle) {
    return (
      <AccountPageShell title="Confirming your email" footnote={FOOTNOTE}>
        <p role="status" className="text-lede text-ink-muted">
          One moment.
        </p>
      </AccountPageShell>
    );
  }

  if (confirm.isError) {
    return (
      <AccountPageShell title="We could not check that link" footnote={FOOTNOTE}>
        <p className="text-lede text-ink-muted">
          Something on our side did not answer. Open the link again in a minute.
        </p>
      </AccountPageShell>
    );
  }

  if (confirm.data?.confirmed) {
    return (
      <AccountPageShell title="That address is confirmed" footnote={FOOTNOTE}>
        <p className="text-lede text-ink-muted">
          We will write when there is something worth sending, and not before.
          You can stop hearing from us at any point by replying to any message.
        </p>
        <Link href="/" className="btn btn-primary mt-8 inline-block">
          Back to Wellovue
        </Link>
      </AccountPageShell>
    );
  }

  return <Unconfirmed reason={confirm.data?.reason ?? 'invalid'} />;
}

function Unconfirmed({ reason }: { reason: 'expired' | 'invalid' | 'incomplete' }) {
  const detail = {
    expired: 'Confirmation links last seven days. Nothing is lost — entering your address on the site again sends a new one.',
    invalid: 'It may already have been used, or the address may have been cut short by the email client. Entering your address on the site again sends a new one.',
    incomplete: 'The address is missing the part that identifies it. Copy the whole link from the email, or enter your address on the site again.',
  }[reason];

  return (
    <AccountPageShell title="That link did not work" footnote={FOOTNOTE}>
      <p className="text-lede text-ink-muted">{detail}</p>
      <Link href="/#stay-in-touch" className="btn btn-primary mt-8 inline-block">
        Back to Wellovue
      </Link>
    </AccountPageShell>
  );
}
