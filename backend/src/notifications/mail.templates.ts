/**
 * Every message this platform is allowed to send.
 *
 * A closed set, not a rendering engine. Callers name a template and hand it a
 * small, typed set of variables; there is no path by which a caller composes a
 * subject or a body of its own. That is the design decision the rest of this
 * file exists to enforce, and the reason is the domain: this is a diabetes
 * platform, and mail leaves the building. A glucose value, an HbA1c, a
 * medication, a finding — none of it belongs in an inbox, in a mail provider's
 * logs, or on the notification screen of a phone somebody has handed to a
 * colleague. `assertNoSensitiveContent` below turns that from a convention
 * everyone remembers into a check every render passes through.
 *
 * Templates are versioned in their id (`email_verification.v1`). The version
 * is written to the outbox, so a row from six months ago says which wording it
 * was; rewriting a template without bumping it would quietly change what past
 * rows claim to have been.
 */

export type MailTemplateName =
  | 'email_verification'
  | 'welcome'
  | 'password_reset'
  | 'new_device_sign_in'
  | 'email_changed'
  | 'password_changed'
  | 'security_alert';

/**
 * Reasons a security alert may be raised.
 *
 * An enum rather than a message, because "fallback template with free text" is
 * exactly the shape through which a health detail eventually reaches an inbox.
 * A new reason is a code change and a review, which is the point.
 */
export type SecurityAlertReason =
  | 'sign_in_blocked'
  | 'sessions_revoked'
  | 'account_locked';

/** What each template needs. Nothing here is or can be a health field. */
export interface MailTemplateVars {
  email_verification: { verifyUrl: string; expiresIn: string };
  welcome: Record<string, never>;
  password_reset: { resetUrl: string; expiresIn: string };
  new_device_sign_in: { signedInAt: string; deviceClass: string };
  email_changed: { changedAt: string };
  password_changed: { changedAt: string };
  security_alert: { reason: SecurityAlertReason; occurredAt: string };
}

/** Fixed strings for the shared parts of every message. */
export interface MailBranding {
  appUrl: string;
  supportEmail: string;
}

export interface RenderedMail {
  /** Versioned template id, written to the outbox. */
  templateId: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Words no outbound message may contain.
 *
 * Checked on every render, not only in tests: a test proves the templates were
 * clean when it ran, and this proves the message about to leave is clean now,
 * including the parts that arrived as variables. The list is vocabulary rather
 * than values, because a number is not recognisable out of context and the
 * word beside it always is.
 */
export const BANNED_EMAIL_TERMS = [
  'glucose',
  'blood sugar',
  'hba1c',
  'a1c',
  'mmol/l',
  'mg/dl',
  'insulin',
  'metformin',
  'diagnosis',
  'diagnosed',
  'prediabetes',
  'lab result',
  'lab value',
  'cholesterol',
  'triglyceride',
  'experiment',
  'finding',
  'clinician report',
  'time in range',
  'carbs',
  'carbohydrate',
  'dose',
  'medication',
] as const;

/**
 * Every banned term a piece of prose contains.
 *
 * Matched case-insensitively, with word boundaries where the term is made of
 * word characters so "diagnostics" does not trip "diagnosis", and as a plain
 * substring for the ones containing punctuation ("mmol/L"), where \b does not
 * mean what it looks like it means.
 */
export function scanForSensitiveTerms(prose: string): string[] {
  const haystack = prose.toLowerCase();
  return BANNED_EMAIL_TERMS.filter((term) => {
    const pattern = /^[a-z0-9 ]+$/.test(term)
      ? new RegExp(`\\b${term.replace(/ /g, '\\s+')}\\b`)
      : new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return pattern.test(haystack);
  });
}

/**
 * Refuses to let a message out that names anything clinical.
 *
 * Throws rather than filtering. A message with a health term silently removed
 * is a message whose sentence no longer says what its author meant, and the
 * failure is a bug in a template — something to fix before it is sent, not to
 * paper over on the way past.
 *
 * Run over the prose, not over the finished message. A verification link
 * carries 43 random characters, and a random string eventually contains
 * anything: scanning it would mean a small share of real signups failing to
 * send with an error about health information, which is both wrong and
 * impossible to reproduce. The link is checked differently — `renderMail`
 * requires it to be on the configured origin — which is the property that
 * actually matters about it.
 */
function assertNoSensitiveProse(templateId: string, prose: string[]): void {
  const found = scanForSensitiveTerms(prose.join('\n'));
  if (found.length > 0) {
    throw new Error(
      `Template ${templateId} renders the term "${found[0]}", which is health ` +
        'information and must not be emailed. Rewrite the template, or the ' +
        'value being interpolated into it.',
    );
  }
}

type Renderers = {
  [K in MailTemplateName]: (vars: MailTemplateVars[K], branding: MailBranding) => RenderedMail;
};

export function renderMail<T extends MailTemplateName>(
  template: T,
  vars: MailTemplateVars[T],
  branding: MailBranding,
): RenderedMail {
  const rendered = TEMPLATES[template](vars, branding);

  // Whatever the link says, it points at us. The prose check cannot see into
  // an opaque token, so this is the guarantee that replaces it: a template
  // cannot be made to send somebody to a host this deployment does not serve.
  for (const url of rendered.text.match(/https?:\/\/\S+/g) ?? []) {
    if (!url.startsWith(`${branding.appUrl}/`) && url !== branding.appUrl) {
      throw new Error(
        `Template ${rendered.templateId} links to ${new URL(url).origin}, which ` +
          `is not APP_PUBLIC_URL (${branding.appUrl}).`,
      );
    }
  }

  return rendered;
}

/** The versioned id a template writes to the outbox, without rendering it. */
export function templateId(template: MailTemplateName): string {
  return TEMPLATE_IDS[template];
}

const TEMPLATE_IDS: Record<MailTemplateName, string> = {
  email_verification: 'email_verification.v1',
  welcome: 'welcome.v1',
  password_reset: 'password_reset.v1',
  new_device_sign_in: 'new_device_sign_in.v1',
  email_changed: 'email_changed.v1',
  password_changed: 'password_changed.v1',
  security_alert: 'security_alert.v1',
};

const SECURITY_ALERT_COPY: Record<SecurityAlertReason, { headline: string; body: string }> = {
  sign_in_blocked: {
    headline: 'A sign-in to your account was blocked',
    body: 'We stopped a sign-in attempt on your account. If it was you, try again from your usual device.',
  },
  sessions_revoked: {
    headline: 'You were signed out everywhere',
    body: 'Every signed-in session on your account was ended. You can sign in again as normal.',
  },
  account_locked: {
    headline: 'Your account was locked',
    body: 'Your account has been locked to protect it. Contact us and we will help you get back in.',
  },
};

const TEMPLATES: Renderers = {
  email_verification: (vars, b) =>
    compose('email_verification', 'Verify your Wellovue email', b, {
      heading: 'Verify your email address',
      paragraphs: [
        'Confirm this address to finish setting up your Wellovue account.',
        `This link works for ${vars.expiresIn}. After that you can ask for a new one from the sign-in page.`,
        'If you did not create an account, you can ignore this message and nothing further will happen.',
      ],
      action: { label: 'Verify email address', url: vars.verifyUrl },
    }),

  welcome: (_vars, b) =>
    compose('welcome', 'Welcome to Wellovue', b, {
      heading: 'Your email address is verified',
      paragraphs: [
        'Your account is ready. You can sign in and start adding the information you already have.',
        'Wellovue never emails the information you record. Anything you save stays in the app, behind your sign-in.',
      ],
      action: { label: 'Open Wellovue', url: b.appUrl },
    }),

  password_reset: (vars, b) =>
    compose('password_reset', 'Reset your Wellovue password', b, {
      heading: 'Reset your password',
      paragraphs: [
        'Someone asked to reset the password on this account.',
        `This link works for ${vars.expiresIn} and can be used once.`,
        'If it was not you, ignore this message. Your password has not changed and nobody has been given access.',
      ],
      action: { label: 'Choose a new password', url: vars.resetUrl },
    }),

  new_device_sign_in: (vars, b) =>
    compose('new_device_sign_in', 'New sign-in to your Wellovue account', b, {
      heading: 'A new device signed in',
      paragraphs: [
        `Time: ${vars.signedInAt} (approximate)`,
        `Device: ${vars.deviceClass}`,
        'If this was you, there is nothing to do.',
        'If it was not, change your password now and contact us.',
      ],
      action: { label: 'Review your account', url: `${b.appUrl}/profile` },
    }),

  email_changed: (vars, b) =>
    compose('email_changed', 'The email on your Wellovue account changed', b, {
      heading: 'Your account email was changed',
      paragraphs: [
        `The email address on your account was changed on ${vars.changedAt}.`,
        'We are telling this address because it was the one on the account before the change.',
        'If you did not do this, contact us immediately using the address below.',
      ],
    }),

  password_changed: (vars, b) =>
    compose('password_changed', 'Your Wellovue password changed', b, {
      heading: 'Your password was changed',
      paragraphs: [
        `The password on your account was changed on ${vars.changedAt}.`,
        'Every signed-in session was ended, so you will be asked to sign in again.',
        'If you did not do this, contact us immediately using the address below.',
      ],
    }),

  security_alert: (vars, b) => {
    const copy = SECURITY_ALERT_COPY[vars.reason];
    return compose('security_alert', 'A security notice about your Wellovue account', b, {
      heading: copy.headline,
      paragraphs: [copy.body, `This happened on ${vars.occurredAt}.`],
    });
  },
};

interface Body {
  heading: string;
  paragraphs: string[];
  action?: { label: string; url: string };
}

/**
 * One layout for every message.
 *
 * Plain and single-column on purpose. No images, no tracking pixel, no
 * external stylesheet: an email client that blocks remote content shows this
 * whole, a screen reader reads it in order, and nothing about opening it is
 * reported back to us. The action is a real link with its address written out
 * underneath, because a bare "click here" is indistinguishable from a phishing
 * message and this platform sends the kind of mail phishing imitates.
 */
function compose(
  template: MailTemplateName,
  subject: string,
  branding: MailBranding,
  body: Body,
): RenderedMail {
  const support = `Questions, or something here looks wrong? Write to ${branding.supportEmail}.`;
  const footer =
    'Wellovue sends this kind of message about your account only. ' +
    'We never include the information you record in the app.';

  // Before anything is assembled, and over the prose only. Every template goes
  // through here, so there is no way to add one that skips the check.
  assertNoSensitiveProse(TEMPLATE_IDS[template], [
    subject,
    body.heading,
    ...body.paragraphs,
    ...(body.action ? [body.action.label] : []),
    support,
    footer,
  ]);

  const text = [
    body.heading,
    '',
    ...body.paragraphs,
    ...(body.action ? ['', body.action.label + ':', body.action.url] : []),
    '',
    support,
    footer,
  ].join('\n');

  const html = [
    '<!doctype html>',
    '<html lang="en">',
    '<head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${escapeHtml(subject)}</title></head>`,
    '<body style="margin:0;padding:24px;background:#faf9f7;color:#1c1b19;',
    'font:16px/1.6 -apple-system,BlinkMacSystemFont,\'Segoe UI\',Helvetica,Arial,sans-serif;">',
    '<main style="max-width:34rem;margin:0 auto;">',
    `<h1 style="margin:0 0 1rem;font-size:1.35rem;font-weight:600;">${escapeHtml(body.heading)}</h1>`,
    ...body.paragraphs.map(
      (p) => `<p style="margin:0 0 1rem;">${escapeHtml(p)}</p>`,
    ),
    ...(body.action
      ? [
          `<p style="margin:1.5rem 0;"><a href="${escapeHtml(body.action.url)}"`,
          ' style="display:inline-block;padding:12px 20px;background:#1c1b19;color:#faf9f7;',
          `text-decoration:none;border-radius:4px;">${escapeHtml(body.action.label)}</a></p>`,
          '<p style="margin:0 0 1rem;font-size:0.85rem;color:#5f5c57;">',
          'If the button does not work, copy this address into your browser:<br>',
          `<span style="word-break:break-all;">${escapeHtml(body.action.url)}</span></p>`,
        ]
      : []),
    '<hr style="border:0;border-top:1px solid #e4e1dc;margin:2rem 0 1rem;">',
    `<p style="margin:0 0 0.5rem;font-size:0.85rem;color:#5f5c57;">${escapeHtml(support)}</p>`,
    `<p style="margin:0;font-size:0.85rem;color:#5f5c57;">${escapeHtml(footer)}</p>`,
    '</main></body></html>',
  ].join('');

  return { templateId: TEMPLATE_IDS[template], subject, text, html };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
