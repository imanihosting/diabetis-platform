import type { Metadata } from 'next';

/**
 * One definition of how this site describes itself to machines.
 *
 * Titles, descriptions, canonicals, Open Graph and the sitemap all come from
 * the registry below rather than from each page writing its own. That is the
 * same argument `navigation.ts` makes about links: a destination declared once
 * cannot drift, and here the drift is invisible. A canonical that disagrees
 * with the sitemap, or a page listed for crawling that no longer exists, does
 * not break a build or show up on a screen — it quietly costs the site its
 * standing in a search index, months later, with nothing to point at.
 *
 * The other reason it is central: this is a health product. What the site
 * claims about itself in a search result is a claim, and claims about diabetes
 * belong somewhere reviewable rather than scattered across a dozen page files.
 */

export const SITE_NAME = 'Wellovue';

/**
 * Where this site actually lives.
 *
 * There is no production domain yet — see the go-live blockers in HANDOVER §10
 * — so the fallback is localhost rather than a guess. That is deliberate. A
 * plausible-looking default would be silently wrong: every canonical, every
 * `og:url` and the whole sitemap would point at a host nobody owns, and the
 * only symptom would be a site that never ranks. Localhost is obviously wrong
 * instead of subtly wrong, which is the failure worth having.
 *
 * Set `NEXT_PUBLIC_SITE_URL` in the deployed environment. It is read at build
 * time, so it must be present when the image is built, not when it starts.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ??
  process.env.NEXT_PUBLIC_APP_URL ??
  'http://localhost:3000'
).replace(/\/$/, '');

export const DEFAULT_TITLE = 'Wellovue — personal metabolic evidence from your own data';

/**
 * Every page title ends up naming the product.
 *
 * `%s` is the page's own title. A search result and a browser tab both get
 * truncated from the right, so the page's subject leads and the brand follows.
 */
export const TITLE_TEMPLATE = `%s · ${SITE_NAME}`;

export const DEFAULT_DESCRIPTION =
  'Wellovue turns your own glucose, meal, activity and lab records into ' +
  'personal evidence: it finds patterns, tests them with experiments you run, ' +
  'and prepares a clear summary for your clinician. It does not diagnose or ' +
  'change treatment.';

/** The shared card image, drawn at /og. One image, so every share looks alike. */
export const OG_IMAGE = {
  url: `${SITE_URL}/og`,
  width: 1200,
  height: 630,
  alt: 'Wellovue — personal metabolic evidence from your own data',
} as const;

export const TWITTER_DEFAULTS = {
  card: 'summary_large_image',
  title: DEFAULT_TITLE,
  description: DEFAULT_DESCRIPTION,
  images: [OG_IMAGE.url],
} as const;

/** An absolute URL for a site-relative path. Canonicals must be absolute. */
export function canonical(path: string): string {
  if (!path.startsWith('/')) {
    throw new Error(`canonical() needs a site-relative path, got "${path}"`);
  }
  return path === '/' ? `${SITE_URL}/` : `${SITE_URL}${path}`;
}

/**
 * What kind of page this is, which decides which structured data it may carry.
 *
 * `health` is the only kind that gets `MedicalWebPage`, and it means the page
 * explains something about the condition itself. A page describing what the
 * product does is `product`, however much diabetes it mentions: marking
 * marketing copy as medical content overstates what it is, and a search engine
 * that has been told everything is medical has been told nothing.
 */
export type PageKind = 'home' | 'product' | 'health' | 'legal' | 'support';

export interface PublicPage {
  path: string;
  kind: PageKind;
  /** Without the site name; `TITLE_TEMPLATE` adds that. */
  title: string;
  description: string;
  /** Sitemap hint. Lower for pages that exist to be found once, like legal. */
  priority: number;
  changeFrequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
}

/**
 * Every page a search engine is invited to index. Nothing else is.
 *
 * Adding a public page means adding it here; that is the whole point. The
 * sitemap is generated from this list, the tests read it, and each page builds
 * its own metadata from its entry, so a page cannot be in the sitemap with one
 * description and on the screen with another.
 */
export const PUBLIC_PAGES: PublicPage[] = [
  {
    path: '/',
    kind: 'home',
    title: 'Personal metabolic evidence from your own data',
    description: DEFAULT_DESCRIPTION,
    priority: 1.0,
    changeFrequency: 'monthly',
  },
  {
    path: '/how-it-works',
    kind: 'product',
    title: 'How Wellovue works',
    description:
      'From a single glucose reading to evidence you can check: the timeline, ' +
      'the pattern engine that finds meal responses and activity effects, the ' +
      'experiments that test them, and where a language model is not allowed near your data.',
    priority: 0.9,
    changeFrequency: 'monthly',
  },
  {
    path: '/diabetes-intelligence',
    kind: 'product',
    title: 'What diabetes intelligence means here',
    description:
      'Diabetes intelligence, defined concretely: measuring glucose patterns, ' +
      'meal response and activity effect in your own record, stating the ' +
      'confidence and the limits, and testing an association with an experiment ' +
      'rather than asserting it.',
    priority: 0.8,
    changeFrequency: 'monthly',
  },
  {
    path: '/type-2-diabetes',
    kind: 'health',
    title: 'Wellovue for type 2 diabetes',
    description:
      'How Wellovue reads a type 2 record: post-meal glucose response, the ' +
      'effect of activity after eating, morning glucose, and HbA1c trend over ' +
      'time. General information only — it does not diagnose or change treatment.',
    priority: 0.8,
    changeFrequency: 'monthly',
  },
  {
    path: '/prediabetes',
    kind: 'health',
    title: 'Wellovue for prediabetes',
    description:
      'What Wellovue looks at in a prediabetes record: HbA1c trend, fasting ' +
      'glucose trend, weight over time, activity consistency and meal timing. ' +
      'General information only — it does not diagnose or change treatment.',
    priority: 0.8,
    changeFrequency: 'monthly',
  },
  {
    path: '/clinician-report',
    kind: 'product',
    title: 'The clinician report',
    description:
      'What Wellovue hands a clinician: the findings with their sample counts ' +
      'and limitations, each prediction beside what was actually observed, and ' +
      'the engine build that produced them. Written to be checked, not trusted.',
    priority: 0.8,
    changeFrequency: 'monthly',
  },
  {
    path: '/about',
    kind: 'product',
    title: 'About Wellovue',
    description:
      'Why a diabetes tool built around evidence rather than tracking, who it ' +
      'is for, and what it deliberately will not do.',
    priority: 0.7,
    changeFrequency: 'monthly',
  },
  {
    path: '/security',
    kind: 'product',
    title: 'Security and your data',
    description:
      'How Wellovue holds health data: encryption in transit, isolated ' +
      'credentials, an append-only audit trail, and safety rules enforced in ' +
      'the database rather than promised in copy.',
    priority: 0.7,
    changeFrequency: 'monthly',
  },
  {
    path: '/white-paper',
    kind: 'product',
    title: 'White paper',
    description:
      'What Wellovue does, who it is for, how the engine and the prediction ' +
      'record work, and what is not built yet.',
    priority: 0.6,
    changeFrequency: 'monthly',
  },
  {
    path: '/contact',
    kind: 'support',
    title: 'Contact Wellovue',
    description:
      'Ask a question about Wellovue, report a problem with it, or request a ' +
      'copy of your data. Not a channel for medical advice or anything urgent.',
    priority: 0.4,
    changeFrequency: 'yearly',
  },
  {
    path: '/privacy',
    kind: 'legal',
    title: 'Privacy policy',
    description:
      'What Wellovue holds, why it holds it, how long for, and what it never does with it.',
    priority: 0.3,
    changeFrequency: 'yearly',
  },
  {
    path: '/terms',
    kind: 'legal',
    title: 'Terms of service',
    description:
      'What Wellovue is, what it explicitly is not, and the terms you agree to ' +
      'by using it. It is not a medical device and not a substitute for clinical care.',
    priority: 0.3,
    changeFrequency: 'yearly',
  },
  {
    path: '/cookies',
    kind: 'legal',
    title: 'Cookie policy',
    description:
      'Wellovue sets two cookies, both only after you sign in and both only so ' +
      'the site works. No analytics, no advertising, and no third parties.',
    priority: 0.3,
    changeFrequency: 'yearly',
  },
];

/**
 * Routes a crawler is told to stay out of.
 *
 * Everything behind sign-in, the API proxy, and the sign-in form itself. None
 * of these would be useful in a search result and all of them are somebody's
 * medical record or the door to one. `robots.ts` reads this; so does the test
 * that checks none of them ever appears in the sitemap.
 *
 * This is a crawl instruction, not access control. What actually stops a
 * stranger reading a record is the access token the API demands; a robots file
 * is a request that well-behaved crawlers honour and nothing else does.
 */
export const DISALLOWED_PATHS = [
  '/api/',
  '/timeline',
  '/log',
  '/evidence',
  '/experiments',
  '/profile',
  '/report',
  '/login',
  // The account flows. `/verify-email` and `/reset-password` carry a
  // single-use token in the query string, and a crawler that follows one
  // spends it — which is a verification link that stops working before the
  // person who was mailed it opens it. The others are here because a page that
  // says "check your email" has nothing to offer a search result.
  '/check-email',
  '/verify-email',
  '/forgot-password',
  '/reset-password',
] as const;

export function publicPage(path: string): PublicPage {
  const page = PUBLIC_PAGES.find((p) => p.path === path);
  if (!page) throw new Error(`No public page registered for ${path}`);
  return page;
}

/**
 * The full metadata for a public page, from its one registry entry.
 *
 * Every page gets a canonical, an Open Graph block and a Twitter card without
 * restating them, which is what keeps the fourteen of them consistent. A page
 * passes `overrides` only for something genuinely its own.
 */
export function pageMetadata(path: string, overrides: Metadata = {}): Metadata {
  const page = publicPage(path);
  const url = canonical(path);

  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      url,
      title: `${page.title} · ${SITE_NAME}`,
      description: page.description,
      images: [OG_IMAGE],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${page.title} · ${SITE_NAME}`,
      description: page.description,
      images: [OG_IMAGE.url],
    },
    ...overrides,
  };
}
