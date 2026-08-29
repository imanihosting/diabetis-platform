import { describe, expect, it } from 'vitest';
import {
  BANNED_EMAIL_TERMS,
  renderMail,
  scanForSensitiveTerms,
  templateId,
  type MailBranding,
  type MailTemplateName,
  type MailTemplateVars,
} from '../src/notifications/mail.templates';

/**
 * What the platform is allowed to put in somebody's inbox.
 *
 * The load-bearing test in this file is the sensitive-content one, and it is
 * worth being explicit about why it is a test rather than a code review
 * convention. Email leaves the building: it sits unencrypted in a mail
 * provider's storage, it appears on a lock screen, it is read on a shared
 * laptop. A glucose value in a subject line is a disclosure of a health
 * condition to whoever is standing nearby, and it is the kind of thing that
 * arrives one small helpful addition at a time — "let's include their latest
 * reading so the email feels personal" — each of which looks reasonable on its
 * own.
 *
 * So every template is rendered here with realistic variables and checked
 * against the vocabulary of the domain.
 */

const BRANDING: MailBranding = {
  appUrl: 'https://wellovue.example',
  supportEmail: 'support@wellovue.example',
};

/** Realistic variables for every template, so each one can be rendered. */
const SAMPLES: { [K in MailTemplateName]: MailTemplateVars[K] } = {
  email_verification: {
    verifyUrl: 'https://wellovue.example/verify-email?token=abc123',
    expiresIn: '24 hours',
  },
  welcome: {},
  password_reset: {
    resetUrl: 'https://wellovue.example/reset-password?token=abc123',
    expiresIn: '60 minutes',
  },
  new_device_sign_in: { signedInAt: '2026-08-29 12:40 UTC', deviceClass: 'Chrome on macOS' },
  email_changed: { changedAt: '2026-08-29 12:40 UTC' },
  password_changed: { changedAt: '2026-08-29 12:40 UTC' },
  security_alert: { reason: 'sessions_revoked', occurredAt: '2026-08-29 12:40 UTC' },
};

const NAMES = Object.keys(SAMPLES) as MailTemplateName[];

describe('notification templates', () => {
  it('has one for every message the platform sends', () => {
    // The list is asserted rather than derived, so removing a template is a
    // decision somebody makes here and not a silent consequence of deleting
    // its caller.
    expect(NAMES.sort()).toEqual(
      [
        'email_changed',
        'email_verification',
        'new_device_sign_in',
        'password_changed',
        'password_reset',
        'security_alert',
        'welcome',
      ].sort(),
    );
  });

  it('names no health information in any rendered message', () => {
    for (const name of NAMES) {
      const mail = renderMail(name, SAMPLES[name], BRANDING);
      // The link is excluded: a random token eventually contains anything, and
      // a signup failing to send once in ten million with an error about
      // health information would be impossible to reproduce. renderMail
      // guarantees the property that matters about a link instead — that it
      // points at this deployment — and that is asserted separately below.
      const prose = `${mail.subject} ${mail.text.replace(/https?:\/\/\S+/g, '')}`;
      expect(scanForSensitiveTerms(prose), `${name} mentions health information`).toEqual([]);
    }
  });

  it('refuses to render a template whose variables carry a health term', () => {
    // The check is on the output, not on the template source, which is what
    // makes it hold for anything interpolated in later. A device classifier
    // that started returning something clinical would fail here rather than in
    // an inbox.
    expect(() =>
      renderMail(
        'new_device_sign_in',
        { signedInAt: 'now', deviceClass: 'glucose meter companion app' },
        BRANDING,
      ),
    ).toThrow(/glucose/);
  });

  it('refuses to render a link that points somewhere else', () => {
    // A verification link is exactly the shape of a phishing message, so a
    // template that could be made to link off-site is a template that could be
    // made into one.
    expect(() =>
      renderMail(
        'email_verification',
        { verifyUrl: 'https://wellovue.example.attacker.test/verify', expiresIn: '24 hours' },
        BRANDING,
      ),
    ).toThrow(/APP_PUBLIC_URL/);
  });

  it('sends both a plain-text and an HTML body', () => {
    for (const name of NAMES) {
      const mail = renderMail(name, SAMPLES[name], BRANDING);
      expect(mail.text.length, `${name} text`).toBeGreaterThan(80);
      expect(mail.html, `${name} html`).toContain('<html lang="en">');
      // Accessibility floor: a language, a real heading, and a viewport so it
      // is readable on a phone without pinching.
      expect(mail.html).toContain('<h1');
      expect(mail.html).toContain('name="viewport"');
    }
  });

  it('gives every message a support line and a subject worth reading', () => {
    for (const name of NAMES) {
      const mail = renderMail(name, SAMPLES[name], BRANDING);
      expect(mail.text, `${name} support line`).toContain(BRANDING.supportEmail);
      expect(mail.subject.length, `${name} subject`).toBeGreaterThan(10);
      // Short enough to survive a phone's notification and a mail list column.
      expect(mail.subject.length, `${name} subject`).toBeLessThanOrEqual(60);
    }
  });

  it('says when a link stops working, wherever there is one', () => {
    expect(renderMail('email_verification', SAMPLES.email_verification, BRANDING).text)
      .toContain('24 hours');
    expect(renderMail('password_reset', SAMPLES.password_reset, BRANDING).text)
      .toContain('60 minutes');
  });

  it('uses the exact subjects the product asked for', () => {
    expect(renderMail('email_verification', SAMPLES.email_verification, BRANDING).subject)
      .toBe('Verify your Wellovue email');
    expect(renderMail('welcome', SAMPLES.welcome, BRANDING).subject)
      .toBe('Welcome to Wellovue');
  });

  it('writes a version into every template id', () => {
    for (const name of NAMES) {
      // The version is what lets an outbox row from six months ago say which
      // wording it was. A template rewritten without a bump makes past rows
      // claim something untrue.
      expect(templateId(name), name).toMatch(/\.v\d+$/);
    }
  });

  it('escapes anything interpolated into the HTML body', () => {
    const mail = renderMail(
      'new_device_sign_in',
      { signedInAt: 'now', deviceClass: '<script>alert(1)</script>' },
      BRANDING,
    );
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
  });

  it('bans the vocabulary rather than the values', () => {
    // A number means nothing out of context and the word beside it always
    // does, so the list is words. This asserts the shape of the list itself,
    // because a list that quietly became empty would make every check above
    // pass.
    expect(BANNED_EMAIL_TERMS.length).toBeGreaterThan(15);
    expect(scanForSensitiveTerms('your morning glucose was high')).toContain('glucose');
    // Whole words, so ordinary English is not caught by accident.
    expect(scanForSensitiveTerms('run diagnostics on the labyrinth')).toEqual([]);
  });
});
