import Link from 'next/link';
import { Bullet, Clause, LegalPage } from '@/components/marketing/LegalPage';
import { pageMetadata } from '@/lib/seo';

export const metadata = pageMetadata('/privacy');

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy"
      updated="26 August 2026"
      summary="This describes what we actually hold and what the system actually does, in the same language as the rest of the site. Health data deserves a policy you can finish reading."
    >
      <Clause n={1} title="Who is responsible">
        <p>
          Wellovue is operated by <strong>Wellovue Limited</strong>, registered in{' '}
          <strong>Ireland</strong>, which is the data controller for the
          information described here. Reach us through the{' '}
          <Link href="/contact">contact page</Link>.
        </p>
      </Clause>

      <Clause n={2} title="What we hold">
        <p>Only what you give us or what the service needs to run.</p>
        <ul>
          <li>
            <Bullet />
            <span>
              <strong>Your account:</strong> email address, an optional display
              name, and a hashed password. We never store the password itself.
            </span>
          </li>
          <li>
            <Bullet />
            <span>
              <strong>Health data you enter or import:</strong> glucose readings,
              meals and estimated nutrition, medication records, activity, sleep,
              symptoms, and lab results. In the UK and EU this is special
              category data, and it is treated as such.
            </span>
          </li>
          <li>
            <Bullet />
            <span>
              <strong>Files you upload:</strong> meal photos and device exports.
              The original import file is kept so an import can be replayed and
              checked.
            </span>
          </li>
          <li>
            <Bullet />
            <span>
              <strong>An access record:</strong> every read and write of your
              record, with who did it and when.
            </span>
          </li>
        </ul>
        <p>
          We do not ask for your name, address, phone number, date of birth, or
          any national health identifier, because the product does not need
          them.
        </p>
      </Clause>

      <Clause n={3} title="Why we are allowed to hold it">
        <p>
          For health data we rely on your <strong>explicit consent</strong>,
          given when you create an account and add data. Consent can be
          withdrawn at any time, and withdrawing it means we delete the data,
          not that we keep it quietly.
        </p>
        <p>
          For your account and security records we rely on performance of a
          contract, and on our legitimate interest in keeping the service safe.
        </p>
      </Clause>

      <Clause n={4} title="Where it lives">
        <p>
          On infrastructure we run and control: a PostgreSQL database for
          records, and object storage for photos and imported files. Nothing is
          copied into a third-party analytics or marketing tool, because there
          is no such tool in this product.
        </p>
        <p>
          Uploaded files are stored under opaque identifiers that reveal nothing
          about you, and your browser only reaches them through links that
          expire in minutes. Connections are encrypted in transit.
        </p>
      </Clause>

      <Clause n={5} title="Who can see it">
        <p>
          You. Nobody else sees your health data unless you deliberately share
          it, and clinician sharing is off unless you turn it on for a specific
          person.
        </p>
        <p>
          A small number of our engineers can reach production systems to keep
          them running. Any such access is recorded in the same access trail you
          can read yourself, and that trail cannot be edited or deleted by
          anyone, including us.
        </p>
        <p>
          We do not sell data, and we do not share it for advertising. If we ever
          use it in aggregate to improve the models, it will be aggregate:
          nothing that identifies a person, and you will be asked first.
        </p>
      </Clause>

      <Clause n={6} title="How long we keep it">
        <p>
          Your health record stays until you delete it or close your account.
          Sign-in sessions expire after 30 days. The access trail is kept for
          seven years, because an audit record you can shorten at will is not an
          audit record.
        </p>
      </Clause>

      <Clause n={7} title="Getting it back, or getting rid of it">
        <p>
          Ask and we will export everything we hold in a portable format. Ask and
          we will erase it.
        </p>
        <p>
          One honest caveat about erasure. Deleting your account removes your
          health data and unlinks you from the access trail, so no entry points
          at you any more. The trail still records that events occurred, because
          it is append-only by design and that is what makes it trustworthy. It
          cannot be used to identify you afterwards.
        </p>
        <p>
          You also have the right to correct your data, to object to or restrict
          processing, and to complain to your data protection authority. In the
          UK that is the ICO.
        </p>
      </Clause>

      <Clause n={8} title="Others who process data for us">
        <p>
          We keep this list short on purpose. At present it is our hosting and
          infrastructure provider, <strong>ImaniHosting</strong>, and{' '}
          <strong>Microsoft</strong> for the mail we send you. Each is
          bound by a data processing agreement. This list is updated when it
          changes.
        </p>
      </Clause>

      <Clause n={9} title="Children">
        <p>
          Wellovue is for adults. It is not designed for anyone under 16, and we
          do not knowingly hold their data. If you believe a child has an
          account, tell us and we will remove it.
        </p>
      </Clause>

      <Clause n={10} title="Changes">
        <p>
          If this policy changes in a way that affects how your health data is
          used, we will tell you before the change takes effect rather than
          quietly updating the date at the top.
        </p>
        <p>
          How the system works technically is described on{' '}
          <Link href="/how-it-works">how this works</Link>. The single cookie we
          set is described under <Link href="/cookies">cookies</Link>.
        </p>
      </Clause>
    </LegalPage>
  );
}
