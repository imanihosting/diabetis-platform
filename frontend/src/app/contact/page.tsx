import type { Metadata } from 'next';
import Link from 'next/link';
import { MarketingShell } from '@/components/marketing/MarketingShell';
import { PageHeader } from '@/components/marketing/PageHeader';
import { ContactForm } from '@/components/marketing/ContactForm';

export const metadata: Metadata = {
  title: 'Contact · Wellovue',
  description:
    'Ask a question, report a problem, or request your data. Not for medical advice or anything urgent.',
};

export default function ContactPage() {
  return (
    <MarketingShell>
      <PageHeader eyebrow="Contact" heading="Ask us something.">
        <p>
          Questions about the product, your account, or your data. We read
          everything and reply by email.
        </p>
      </PageHeader>

      {/* Placed above the form on purpose: someone in trouble should meet this
          before they start typing, not after they have sent it. */}
      <section className="border-y border-[var(--rule)] bg-[var(--paper-sunk)] py-7">
        <div className="mx-auto max-w-6xl px-7 sm:px-8">
          <div className="flex max-w-[74ch] gap-4">
            <span
              aria-hidden
              className="mt-0.5 shrink-0 text-lede text-[var(--below-range-text)]"
            >
              &#9888;
            </span>
            <div>
              <h2 className="text-lede font-semibold text-[var(--ink)]">
                Not for anything urgent, and not for medical advice
              </h2>
              <p className="mt-2 leading-relaxed text-[var(--ink-muted)]">
                We cannot answer questions about your treatment, your readings,
                or your symptoms. If you feel unwell, or your glucose is very
                high or very low, contact your clinician or your local emergency
                service now. This inbox is checked during working hours.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-7 py-[clamp(2.5rem,6vw,4.5rem)] sm:px-6">
        <div className="grid gap-x-16 gap-y-12 lg:grid-cols-12">
          <div className="lg:col-span-8">
            <ContactForm />
          </div>

          <aside className="lg:col-span-4">
            <h2 className="text-sm font-semibold text-[var(--ink)]">
              Before you write
            </h2>

            <dl className="mt-5 space-y-6">
              <div>
                <dt className="text-sm text-[var(--ink)]">
                  Want your data out?
                </dt>
                <dd className="mt-1.5 text-sm leading-relaxed text-[var(--ink-muted)]">
                  Say so and we will export everything we hold. Erasure removes
                  your identity from the access trail; the record that events
                  happened stays, because it cannot be rewritten.
                </dd>
              </div>

              <div>
                <dt className="text-sm text-[var(--ink)]">
                  Import not working?
                </dt>
                <dd className="mt-1.5 text-sm leading-relaxed text-[var(--ink-muted)]">
                  Tell us which device and which app produced the file. Export
                  formats differ between vendors and we would rather fix the
                  parser than ask you to reformat anything.
                </dd>
              </div>

              <div>
                <dt className="text-sm text-[var(--ink)]">
                  Are you a clinician?
                </dt>
                <dd className="mt-1.5 text-sm leading-relaxed text-[var(--ink-muted)]">
                  Pick that topic. We are interested in what a ten-minute
                  appointment actually needs, and{' '}
                  <Link
                    href="/how-it-works"
                    className="text-[var(--ink)] underline underline-offset-4"
                  >
                    how this works
                  </Link>{' '}
                  covers the evidence model in full.
                </dd>
              </div>
            </dl>
          </aside>
        </div>
      </section>
    </MarketingShell>
  );
}
