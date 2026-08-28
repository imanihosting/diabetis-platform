import {
  DEFAULT_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
  canonical,
  publicPage,
} from '@/lib/seo';

/**
 * The JSON-LD this site publishes, and the rules about which page gets what.
 *
 * Structured data is a set of assertions about what something is, and a health
 * product making those assertions carelessly is the thing this module exists to
 * prevent. Two rules:
 *
 * 1. `MedicalWebPage` goes only on a page that explains something about the
 *    condition. A page describing what the software does is a product page
 *    however much diabetes it mentions. Marking everything medical overstates
 *    what the site is, and it is the sort of overstatement a regulator reads
 *    as a claim.
 * 2. Nothing behind sign-in is described here at all. Those pages are somebody's
 *    record, they are disallowed in robots.txt, and publishing schema for them
 *    would invite exactly the indexing the rest of this work prevents.
 *
 * Emitted as `application/ld+json`. Every value is drawn from the same registry
 * the visible page uses, so the machine-readable claim and the human-readable
 * one cannot disagree.
 */

export interface JsonLd {
  '@context': 'https://schema.org';
  [key: string]: unknown;
}

export function organizationSchema(): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: `${SITE_URL}/`,
    logo: `${SITE_URL}/icon.svg`,
    description: DEFAULT_DESCRIPTION,
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer support',
      url: canonical('/contact'),
    },
  };
}

export function webSiteSchema(): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: `${SITE_URL}/`,
    description: DEFAULT_DESCRIPTION,
    publisher: { '@type': 'Organization', name: SITE_NAME, url: `${SITE_URL}/` },
  };
}

/**
 * The platform itself.
 *
 * `HealthApplication` is the honest category and it is worth being careful
 * about: it describes software used in a health context, which this is, and it
 * is not a claim to be a medical device, which this is not. The care boundary
 * is repeated here in the machine-readable copy for the same reason it is in
 * the footer of every page — it is a reason to trust the product, and it should
 * not be the one thing only a human reader is told.
 */
export function softwareApplicationSchema(): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SITE_NAME,
    url: `${SITE_URL}/`,
    applicationCategory: 'HealthApplication',
    operatingSystem: 'Web',
    description:
      'Wellovue analyses a person’s own glucose, meal, activity and lab ' +
      'records to find patterns, tests those patterns with experiments the ' +
      'person runs, and prepares a summary for a clinician appointment.',
    featureList: [
      'Glucose timeline',
      'Post-meal response measurement',
      'Activity effect on glucose',
      'HbA1c and fasting glucose trends',
      'Experiments with a prediction recorded before the result',
      'Clinician report',
    ],
    disambiguatingDescription:
      'Wellovue is not a medical device. It does not diagnose, prescribe, ' +
      'calculate insulin doses, or substitute for clinical care.',
  };
}

/**
 * A page that explains something about the condition.
 *
 * `lastReviewed` is deliberately absent. Schema.org treats it as a statement
 * that a person with the relevant expertise checked the content on that date,
 * and none of this has been through clinical review — see the open decisions
 * in HANDOVER §11. Emitting a date because the field exists would be inventing
 * the one credential this page has not got.
 */
export function medicalWebPageSchema(path: string): JsonLd {
  const page = publicPage(path);
  if (page.kind !== 'health') {
    throw new Error(
      `${path} is a ${page.kind} page. MedicalWebPage is only for pages that ` +
        'explain the condition, not for pages that describe the product.',
    );
  }

  return {
    '@context': 'https://schema.org',
    '@type': 'MedicalWebPage',
    name: page.title,
    description: page.description,
    url: canonical(path),
    isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: `${SITE_URL}/` },
    audience: { '@type': 'Patient' },
    // What the page is about, rather than what it advises. There is no
    // treatment or dosage aspect here and there must not be.
    medicalAudience: 'Patient',
  };
}

/** Renders one or more schemas into a script tag the page can drop in. */
export function jsonLdProps(...schemas: JsonLd[]) {
  return {
    type: 'application/ld+json',
    // Serialised once. `<` is escaped so a string in the data can never close
    // the script tag early, which is the one way JSON-LD becomes an injection.
    dangerouslySetInnerHTML: {
      __html: JSON.stringify(schemas.length === 1 ? schemas[0] : schemas).replace(
        /</g,
        '\\u003c',
      ),
    },
  };
}
