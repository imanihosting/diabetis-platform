import type { Metadata } from 'next';
import Link from 'next/link';
import { Bullet, Clause, LegalPage } from '@/components/marketing/LegalPage';

export const metadata: Metadata = {
  title: 'Terms · Wellovue',
  description:
    'What Wellovue is, what it is explicitly not, and the terms you agree to by using it.',
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of use"
      updated="26 August 2026"
      summary="The important part is the second clause. Wellovue is not a medical device and is not a substitute for your clinician, and no amount of evidence it produces changes that."
    >
      <Clause n={1} title="Agreeing to these terms">
        <p>
          By creating an account or using Wellovue you accept these terms. If you
          do not, please do not use the service. Wellovue is operated by{' '}
          <strong>[LEGAL ENTITY]</strong>, registered in{' '}
          <strong>[JURISDICTION]</strong>.
        </p>
      </Clause>

      <Clause n={2} title="This is not medical advice, and not a medical device">
        <p>
          Wellovue helps you see patterns in data you already have and prepare
          for conversations with your clinician. It does not diagnose, treat,
          cure, or prevent anything, and it is not a regulated medical device.
        </p>
        <p>It will never, under any circumstances:</p>
        <ul>
          <li>
            <Bullet />
            Adjust your medication, or tell you to
          </li>
          <li>
            <Bullet />
            Calculate an insulin dose
          </li>
          <li>
            <Bullet />
            Diagnose a complication
          </li>
          <li>
            <Bullet />
            Advise you during a hypo or a hyper
          </li>
          <li>
            <Bullet />
            Tell you to stop taking something
          </li>
        </ul>
        <p>
          <strong>
            If you feel unwell, or your glucose is very high or very low, contact
            your clinician or your emergency service immediately.
          </strong>{' '}
          Do not wait for anything on this site, and do not use the contact form
          for anything urgent.
        </p>
        <p>
          Every finding Wellovue produces is an association observed in your own
          data, reported with its confidence and its limits. It is a starting
          point for a conversation with a professional, not a conclusion, and
          decisions about your treatment remain between you and your clinician.
        </p>
      </Clause>

      <Clause n={3} title="Your account">
        <p>
          Keep your password to yourself and tell us promptly if you think
          someone else has it. You are responsible for what happens under your
          account. Do not share an account with another person: the whole product
          rests on the data belonging to one body.
        </p>
        <p>You must be 16 or older.</p>
      </Clause>

      <Clause n={4} title="Your data stays yours">
        <p>
          You keep every right in the data you enter. You give us only the
          permission needed to run the service for you: to store it, process it,
          and show it back to you and to anyone you deliberately share it with.
        </p>
        <p>
          You can export it or have it erased at any time. What we hold and how
          erasure works is set out in the{' '}
          <Link href="/privacy">privacy policy</Link>.
        </p>
      </Clause>

      <Clause n={5} title="Fair use">
        <p>Please do not:</p>
        <ul>
          <li>
            <Bullet />
            Enter another person&rsquo;s health data without their knowledge and
            agreement
          </li>
          <li>
            <Bullet />
            Attempt to reach records that are not yours, or probe the service for
            weaknesses without telling us first
          </li>
          <li>
            <Bullet />
            Scrape, resell, or rebrand the service
          </li>
          <li>
            <Bullet />
            Use it to give clinical advice to other people
          </li>
        </ul>
        <p>
          Found a security problem? Tell us through the{' '}
          <Link href="/contact">contact page</Link> before telling anyone else,
          and we will work with you.
        </p>
      </Clause>

      <Clause n={6} title="The service is early, and we will say so">
        <p>
          Wellovue is in active development. Features change, some are
          unfinished, and there is no uptime guarantee. We will not pretend
          otherwise on a marketing page.
        </p>
        <p>
          We may change or withdraw features. If a change would lose data or
          affect your record, we will tell you first and give you a way to export
          it.
        </p>
      </Clause>

      <Clause n={7} title="What we are responsible for">
        <p>
          The service is provided as it is. We do not warrant that a finding will
          apply to you, that a prediction will be right, or that the service will
          be uninterrupted.
        </p>
        <p>
          Nothing here limits liability for death or personal injury caused by
          negligence, for fraud, or for anything else that cannot lawfully be
          limited. Beyond that, and to the extent the law allows, we are not
          liable for indirect or consequential loss, and our total liability is
          limited to the greater of the amount you paid us in the previous twelve
          months or <strong>[LIABILITY CAP]</strong>.
        </p>
        <p>
          Because clause 2 matters more than this one: we are not liable for
          clinical decisions. Those are made by you and your clinician.
        </p>
      </Clause>

      <Clause n={8} title="Ending it">
        <p>
          You can close your account whenever you like. We may suspend an account
          that breaks clause 5 or puts other people at risk, and we will tell you
          why. Either way you can export your data first.
        </p>
      </Clause>

      <Clause n={9} title="Changes and governing law">
        <p>
          We will post material changes here before they take effect. These terms
          are governed by the laws of <strong>[JURISDICTION]</strong>, and its
          courts have exclusive jurisdiction.
        </p>
      </Clause>
    </LegalPage>
  );
}
