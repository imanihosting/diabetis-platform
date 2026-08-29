'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef } from 'react';
import { AccountPageShell } from '@/components/AccountPageShell';
import { ResendVerification } from '@/components/ResendVerification';
import { useVerifyEmail } from '@/hooks/useEmailVerification';

/**
 * The page a verification link opens.
 *
 * Four states, and they are genuinely different messages: working on it,
 * verified, the link has run out, the link is not one we issued. Collapsing
 * the last three into "something went wrong" would leave somebody with an
 * expired link no way to know that asking for a new one is exactly the fix.
 */
export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailView />
    </Suspense>
  );
}

function VerifyEmailView() {
  const token = useSearchParams().get('token');
  const verify = useVerifyEmail();

  // Once, on arrival. The token is single-use, and React's development strict
  // mode runs effects twice: without this the second run spends a token the
  // first one already consumed and the page reports its own success as an
  // invalid link.
  const attempted = useRef(false);
  useEffect(() => {
    if (!token || attempted.current) return;
    attempted.current = true;
    verify.mutate(token);
  }, [token, verify]);

  if (!token) {
    return (
      <Expired
        title="That link is not complete"
        detail="The address is missing the part that identifies it. Copy the whole link from the email, or ask for a new one."
      />
    );
  }

  if (verify.isPending || verify.isIdle) {
    return (
      <AccountPageShell title="Verifying your email">
        <p role="status" className="text-lede text-ink-muted">
          One moment.
        </p>
      </AccountPageShell>
    );
  }

  if (verify.isError) {
    return (
      <AccountPageShell title="We could not check that link">
        <p className="text-lede text-ink-muted">
          Something on our side did not answer. Your account has not changed.
          Open the link again in a minute.
        </p>
      </AccountPageShell>
    );
  }

  if (verify.data?.verified) {
    return (
      <AccountPageShell title="Your email is verified">
        <p className="text-lede text-ink-muted">
          That is the setup finished. You can sign in and start adding what you
          already have.
        </p>
        <Link href="/login" className="btn btn-primary mt-8 inline-block">
          Continue to Wellovue
        </Link>
      </AccountPageShell>
    );
  }

  return verify.data?.reason === 'expired' ? (
    <Expired
      title="That link has expired"
      detail="Verification links last 24 hours. Ask for a new one and it will arrive in a minute or two."
    />
  ) : (
    <Expired
      title="That link is not valid"
      detail="It may already have been used, or the address may have been cut short by the email client. Asking for a new one is the quickest way through."
    />
  );
}

function Expired({ title, detail }: { title: string; detail: string }) {
  return (
    <AccountPageShell title={title}>
      <p className="text-lede text-ink-muted">{detail}</p>
      <div className="mt-10 border-t border-rule pt-8">
        <ResendVerification label="Send a new link" />
      </div>
    </AccountPageShell>
  );
}
