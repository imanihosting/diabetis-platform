import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import {
  Atkinson_Hyperlegible_Mono,
  Atkinson_Hyperlegible_Next,
} from 'next/font/google';
import { Providers } from './providers';
import {
  DEFAULT_DESCRIPTION,
  DEFAULT_TITLE,
  OG_IMAGE,
  SITE_NAME,
  SITE_URL,
  TITLE_TEMPLATE,
} from '@/lib/seo';
import {
  jsonLdProps,
  organizationSchema,
  softwareApplicationSchema,
  webSiteSchema,
} from '@/lib/structured-data';
import './globals.css';

/**
 * Atkinson Hyperlegible was engineered by the Braille Institute for readers
 * with low vision: its letterforms are drawn to be told apart rather than to
 * be even. Diabetic retinopathy is a complication of the condition this
 * product serves, so that is a functional choice here, not a stylistic one.
 */
const sans = Atkinson_Hyperlegible_Next({
  subsets: ['latin'],
  weight: ['200', '300', '400', '500', '600', '700', '800'],
  variable: '--font-hyperlegible',
  display: 'swap',
});

/** Reserved for measured values, where digits must align and never be mistaken. */
const mono = Atkinson_Hyperlegible_Mono({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-hyperlegible-mono',
  display: 'swap',
});

/**
 * What every page inherits, and what a page has to say for itself.
 *
 * `metadataBase` is the line that makes the rest work: without it Next emits
 * relative Open Graph and canonical URLs, which no crawler resolves, so the
 * tags are present and useless. Everything else here is a default a public
 * page overrides through `pageMetadata()` — the title template is the one
 * thing that always applies, so a page supplies its own subject and the brand
 * is appended rather than retyped fourteen times.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: DEFAULT_TITLE, template: TITLE_TEMPLATE },
  description: DEFAULT_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    locale: 'en_GB',
    url: `${SITE_URL}/`,
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    images: [OG_IMAGE],
  },
  twitter: {
    card: 'summary_large_image',
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    images: [OG_IMAGE.url],
  },
  robots: {
    // The site-wide default. Signed-in routes are kept out of an index by
    // robots.txt rather than by flipping this, because a page that is never
    // fetched cannot be read for a noindex tag in the first place.
    index: true,
    follow: true,
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh">
        {/* Who publishes this site, what the site is, and what the software
            does. Site-wide because all three are true on every page. Nothing
            medical is asserted here: that is per-page, and only on the pages
            that actually explain the condition. */}
        <script
          {...jsonLdProps(
            organizationSchema(),
            webSiteSchema(),
            softwareApplicationSchema(),
          )}
        />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
