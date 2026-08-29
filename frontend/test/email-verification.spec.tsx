import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setSearchParams } from './stubs/next-navigation';

/**
 * The screens between "signed up" and "using the product".
 *
 * These are rendered rather than reasoned about, because the thing that goes
 * wrong here is not logic but what the page says. Three of the four states are
 * failures of one kind or another, and each needs a different sentence: an
 * expired link needs "ask for another", an invalid one needs "it may already
 * have been used", and a server that did not answer needs "your account has
 * not changed". Collapsing them into "something went wrong" leaves somebody
 * holding an expired link with no idea that the fix is one button away.
 *
 * The hooks are stubbed rather than the network, so these tests are about the
 * page. What the endpoints do is the backend suite's question, and it answers
 * it against a real database.
 */

const verify = {
  mutate: vi.fn(),
  isIdle: true,
  isPending: false,
  isError: false,
  data: undefined as { verified: boolean; reason?: string } | undefined,
};

const resend = {
  mutate: vi.fn(),
  isPending: false,
  isError: false,
  isSuccess: false,
};

const confirmWaitlist = {
  mutate: vi.fn(),
  isIdle: true,
  isPending: false,
  isError: false,
  data: undefined as { confirmed: boolean; reason?: string } | undefined,
};

vi.mock('@/hooks/useEmailVerification', () => ({
  useVerifyEmail: () => verify,
  useResendVerification: () => resend,
  useRequestPasswordReset: () => resend,
  useCompletePasswordReset: () => resend,
  useConfirmWaitlist: () => confirmWaitlist,
}));

vi.mock('@/hooks/useAuth', () => ({
  useCurrentUser: () => ({ data: null }),
  useLogout: () => ({ mutate: vi.fn(), isPending: false }),
}));

/** Rendered markup as a reader would hear it: tags gone, entities resolved. */
function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function renderPage(path: string): Promise<string> {
  const mod = (await import(path)) as { default: () => React.ReactElement };
  return renderToStaticMarkup(<mod.default />);
}

beforeEach(() => {
  __setSearchParams('token=a-token-from-an-email');
  verify.isIdle = true;
  verify.isPending = false;
  verify.isError = false;
  verify.data = undefined;
  resend.isPending = false;
  resend.isError = false;
  resend.isSuccess = false;
  confirmWaitlist.isIdle = true;
  confirmWaitlist.isPending = false;
  confirmWaitlist.isError = false;
  confirmWaitlist.data = undefined;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('the verification screen', () => {
  it('says it is working while the token is being checked', async () => {
    const text = textOf(await renderPage('@/app/verify-email/page'));
    expect(text).toContain('Verifying your email');
  });

  it('confirms success and offers the way onward', async () => {
    verify.isIdle = false;
    verify.data = { verified: true };

    const html = await renderPage('@/app/verify-email/page');
    expect(textOf(html)).toContain('Your email is verified');
    expect(html).toContain('href="/login"');
  });

  it('tells an expired link apart from an invalid one', async () => {
    verify.isIdle = false;
    verify.data = { verified: false, reason: 'expired' };
    const expired = textOf(await renderPage('@/app/verify-email/page'));
    expect(expired).toContain('That link has expired');
    // The fix is on the same screen, because "ask for a new one" is the whole
    // remedy and sending somebody hunting for it loses them.
    expect(expired).toContain('Send a new link');

    verify.data = { verified: false, reason: 'invalid' };
    const invalid = textOf(await renderPage('@/app/verify-email/page'));
    expect(invalid).toContain('That link is not valid');
    expect(invalid).toContain('already have been used');
  });

  it('handles a link with no token at all', async () => {
    // Mail clients wrap long URLs, and people paste the first half.
    __setSearchParams('');
    verify.isIdle = false;
    const text = textOf(await renderPage('@/app/verify-email/page'));
    expect(text).toContain('not complete');
  });

  it('says the account is untouched when the server does not answer', async () => {
    verify.isIdle = false;
    verify.isError = true;
    const text = textOf(await renderPage('@/app/verify-email/page'));
    expect(text).toContain('could not check that link');
    // Different from an expired link, and the difference matters: nothing has
    // been spent, so opening the same link again is the right advice.
    expect(text).toContain('has not changed');
  });
});

describe('the check-your-email screen', () => {
  it('names the address it sent to and says how long the link lasts', async () => {
    __setSearchParams('email=person%40example.test');
    const text = textOf(await renderPage('@/app/check-email/page'));

    expect(text).toContain('Check your email');
    // The commonest reason a verification email does not arrive is a typo, so
    // showing the address back is the single most useful thing on this page.
    expect(text).toContain('person@example.test');
    expect(text).toContain('24 hours');
    expect(text).toContain('spam folder');
  });
});

describe('asking for another link', () => {
  it('offers the action', async () => {
    const html = await renderPage('@/app/check-email/page');
    expect(textOf(html)).toContain('Send the link again');
  });

  it('says nothing about whether the address has an account', async () => {
    resend.isSuccess = true;
    const text = textOf(await renderPage('@/app/check-email/page'));

    // The server answers identically for an address it knows and one it does
    // not. A page that said "we have sent you an email" would undo that on the
    // client side and hand back the account-existence oracle.
    expect(text).toContain('If that address has an account');
  });

  it('offers a way through when sending fails', async () => {
    resend.isError = true;
    const text = textOf(await renderPage('@/app/check-email/page'));
    expect(text).toContain('could not send it right now');
    expect(text).toContain('nothing about your account has changed');
  });
});

describe('the waitlist confirmation screen', () => {
  it('confirms, and says what will and will not arrive', async () => {
    confirmWaitlist.isIdle = false;
    confirmWaitlist.data = { confirmed: true };

    const text = textOf(await renderPage('@/app/waitlist/confirm/page'));
    expect(text).toContain('That address is confirmed');
    expect(text).toContain('something worth sending');
    // Its reader has no account, so the shell's usual footnote about account
    // mail would leave them wondering what account is meant.
    expect(text).not.toContain('about your account only');
  });

  it('keeps a failed confirmation low-drama', async () => {
    confirmWaitlist.isIdle = false;
    confirmWaitlist.data = { confirmed: false, reason: 'expired' };

    const text = textOf(await renderPage('@/app/waitlist/confirm/page'));
    // Nothing is broken and nothing is lost — entering the address again is
    // the whole remedy, and the page says so rather than apologising.
    expect(text).toContain('Nothing is lost');
    expect(text).toContain('sends a new one');
  });

  it('does not offer a sign-in form to somebody with no account', async () => {
    confirmWaitlist.isIdle = false;
    confirmWaitlist.data = { confirmed: true };

    const html = await renderPage('@/app/waitlist/confirm/page');
    // One link out, and it goes back to the site rather than into the product.
    expect(html).toContain('href="/"');
  });
});

describe('what these pages promise', () => {
  const PAGES = [
    '@/app/check-email/page',
    '@/app/verify-email/page',
    '@/app/forgot-password/page',
    '@/app/reset-password/page',
    '@/app/waitlist/confirm/page',
  ];

  it('never implies that health information is being emailed', async () => {
    // The line these pages must not cross. Somebody reading "check your email"
    // on a diabetes platform should not be left wondering what was sent, and a
    // page that mentions their record in the same breath as an email is how
    // that worry starts.
    const banned = /glucose|blood sugar|hba1c|lab result|diagnosis|reading/i;

    for (const page of PAGES) {
      const text = textOf(await renderPage(page));
      expect(banned.test(text), `${page} suggests health data is emailed`).toBe(false);
    }
  });

  it('stays calm rather than selling anything', async () => {
    // Marketing copy on a page somebody reached because they are locked out is
    // the wrong register, and this platform's whole posture is plainness.
    const marketing = /revolution|transform your|unlock|amazing|exciting|journey/i;

    for (const page of PAGES) {
      const text = textOf(await renderPage(page));
      expect(marketing.test(text), `${page} reads as marketing`).toBe(false);
    }
  });

  it('gives every one of them a heading', async () => {
    for (const page of PAGES) {
      expect((await renderPage(page)).match(/<h1/g) ?? [], page).toHaveLength(1);
    }
  });
});
