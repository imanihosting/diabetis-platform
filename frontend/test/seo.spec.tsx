import type { ReactElement } from 'react';
import type { Metadata } from 'next';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  DISALLOWED_PATHS,
  PUBLIC_PAGES,
  SITE_URL,
  canonical,
  pageMetadata,
} from '@/lib/seo';
import { medicalWebPageSchema, softwareApplicationSchema } from '@/lib/structured-data';
import sitemap from '@/app/sitemap';
import robots from '@/app/robots';

/**
 * What this site tells a machine about itself.
 *
 * Nearly everything here is invisible. A canonical pointing at the wrong host,
 * a signed-in route offered in the sitemap, a second `<h1>` introduced by a
 * component three levels down — none of it breaks a build or shows up on a
 * screen, and all of it is expensive. So these assertions are made against the
 * rendered markup rather than against page source: every public page on this
 * site gets its heading from a shared component, so grepping a page file for
 * `<h1` would prove nothing about the page.
 */

interface PageModule {
  default: () => ReactElement;
  metadata?: Metadata;
}

/**
 * Every page module, keyed by the route it serves.
 *
 * `import.meta.glob` is Vite's, and typing it here rather than pulling in
 * `vite/client` keeps the app's own `tsc --noEmit` from taking a dependency on
 * the test runner's ambient types.
 */
const MODULES = (
  import.meta as unknown as {
    glob: <T>(pattern: string) => Record<string, () => Promise<T>>;
  }
).glob<PageModule>('../src/app/**/page.tsx');

function routeFor(file: string): string {
  const path = file.replace('../src/app', '').replace(/\/page\.tsx$/, '');
  return path === '' ? '/' : path;
}

const PUBLIC_MODULES = Object.entries(MODULES).filter(([file]) =>
  PUBLIC_PAGES.some((p) => p.path === routeFor(file)),
);

async function render(route: string): Promise<string> {
  const entry = PUBLIC_MODULES.find(([file]) => routeFor(file) === route);
  if (!entry) throw new Error(`No page module for ${route}`);
  const mod = await entry[1]();
  return renderToStaticMarkup(<mod.default />);
}

async function metadataFor(route: string): Promise<Metadata> {
  const entry = PUBLIC_MODULES.find(([file]) => routeFor(file) === route);
  if (!entry) throw new Error(`No page module for ${route}`);
  const mod = await entry[1]();
  if (!mod.metadata) throw new Error(`${route} exports no metadata`);
  return mod.metadata;
}

/** Rendered markup as a reader would hear it: tags gone, entities resolved. */
function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&rsquo;|&#8217;/g, '’')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('the public page registry', () => {
  it('registers a real page for every route it offers', async () => {
    const registered = PUBLIC_PAGES.map((p) => p.path).sort();
    const rendered = PUBLIC_MODULES.map(([file]) => routeFor(file)).sort();
    expect(rendered).toEqual(registered);
  });

  it('gives every page its own title and its own description', () => {
    const titles = PUBLIC_PAGES.map((p) => p.title);
    const descriptions = PUBLIC_PAGES.map((p) => p.description);
    // Duplicated descriptions are the classic way a site of real pages gets
    // treated as one page with several addresses.
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });

  it('keeps titles and descriptions inside what a search result shows', () => {
    for (const page of PUBLIC_PAGES) {
      expect(page.title.length, `${page.path} title`).toBeLessThanOrEqual(60);
      expect(page.title.length, `${page.path} title`).toBeGreaterThan(8);
      expect(page.description.length, `${page.path} description`).toBeGreaterThan(70);
      expect(page.description.length, `${page.path} description`).toBeLessThanOrEqual(320);
    }
  });

  it('refuses a canonical that is not site-relative', () => {
    expect(() => canonical('https://example.com/about')).toThrow();
    expect(canonical('/about')).toBe(`${SITE_URL}/about`);
    expect(canonical('/')).toBe(`${SITE_URL}/`);
  });

  it('does not invent a production domain it has not got', () => {
    // The fallback is localhost on purpose. A plausible default would put a
    // host nobody owns into every canonical and the whole sitemap, and the
    // only symptom would be a site that never ranks. See seo.ts.
    if (!process.env.NEXT_PUBLIC_SITE_URL && !process.env.NEXT_PUBLIC_APP_URL) {
      expect(SITE_URL).toBe('http://localhost:3000');
    }
    expect(SITE_URL).not.toMatch(/\/$/);
  });
});

describe('every public page', () => {
  it.each(PUBLIC_PAGES.map((p) => p.path))('%s exports a title and description', async (route) => {
    const meta = await metadataFor(route);
    expect(meta.title).toBeTruthy();
    expect(meta.description).toBeTruthy();
    expect(String(meta.description).length).toBeGreaterThan(70);
  });

  it.each(PUBLIC_PAGES.map((p) => p.path))('%s declares its canonical', async (route) => {
    const meta = await metadataFor(route);
    expect(meta.alternates?.canonical).toBe(canonical(route));
  });

  it.each(PUBLIC_PAGES.map((p) => p.path))('%s carries an Open Graph card', async (route) => {
    const meta = await metadataFor(route);
    const og = meta.openGraph;
    expect(og?.title, `${route} og:title`).toBeTruthy();
    expect(og?.description, `${route} og:description`).toBeTruthy();

    const images = (og as { images?: unknown[] })?.images ?? [];
    expect(images.length, `${route} og:image`).toBeGreaterThan(0);

    // Absolute, because a relative og:image is not resolved by most scrapers.
    const first = images[0] as { url?: string } | string;
    const url = typeof first === 'string' ? first : (first.url ?? '');
    expect(url.startsWith('http'), `${route} og:image must be absolute`).toBe(true);
  });

  it.each(PUBLIC_PAGES.map((p) => p.path))('%s renders exactly one h1', async (route) => {
    const html = await render(route);
    const headings = html.match(/<h1[\s>]/g) ?? [];
    expect(headings.length, `${route} has ${headings.length} h1 elements`).toBe(1);
  });

  it.each(PUBLIC_PAGES.map((p) => p.path))('%s renders readable prose, not only chrome', async (route) => {
    // A page that is all screenshot and no sentence has nothing for a search
    // engine to understand or for a reader arriving cold to read.
    const text = textOf(await render(route));
    expect(text.length, `${route} rendered ${text.length} characters of text`).toBeGreaterThan(
      1200,
    );
  });

  it.each(PUBLIC_PAGES.map((p) => p.path))('%s states the care boundary', async (route) => {
    const text = textOf(await render(route));
    expect(text).toContain('is not a medical device');
  });
});

/**
 * Claims this product must never make.
 *
 * Matched against a sentence rather than a page, because the same words are
 * fine or forbidden depending on which side of a "does not" they sit on. The
 * whole point of the safety copy is to say "does not calculate insulin doses",
 * and a check that could not tell that from an offer of insulin advice would
 * push the site into writing worse disclaimers to satisfy a test.
 */
const BANNED_CLAIMS: { label: string; pattern: RegExp }[] = [
  { label: 'reverse diabetes', pattern: /revers\w*\s+(your\s+|type\s*2\s+)*diabetes/i },
  { label: 'cure diabetes', pattern: /cur(e|es|ing)\s+(for\s+|your\s+)*diabetes/i },
  { label: 'a cure', pattern: /\ba cure\b/i },
  { label: 'insulin advice', pattern: /insulin\s+(advice|guidance|recommendations?|dosing)/i },
  {
    label: 'replace your doctor',
    pattern: /replac\w*\s+(your\s+)?(doctor|clinician|physician|gp|clinical care|medical care)/i,
  },
  { label: 'medical advice', pattern: /\bmedical advice\b/i },
  { label: 'miracle', pattern: /\bmiracle\b/i },
  { label: 'guaranteed', pattern: /\bguarantee\w*\b/i },
  { label: 'diagnose', pattern: /\bdiagnos(e|es)\b/i },
];

const NEGATION =
  /\b(not|never|no|none|cannot|can't|won't|doesn't|isn't|don't|refuses?|without|nothing|neither|nor|forbidden|must not)\b/i;

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/);
}

describe('no public page makes a claim it must not', () => {
  it.each(PUBLIC_PAGES.map((p) => p.path))('%s', async (route) => {
    const text = textOf(await render(route));

    for (const { label, pattern } of BANNED_CLAIMS) {
      const offending = sentences(text).filter(
        (sentence) => pattern.test(sentence) && !NEGATION.test(sentence),
      );
      expect(
        offending,
        `${route} states "${label}" without a negation: ${offending.join(' | ')}`,
      ).toEqual([]);
    }
  });

  it('holds the meta descriptions to the same rule as the pages', () => {
    // A description is not page copy, and it is read by more people than most
    // of the page is: it is the sentence under the link in a search result.
    for (const page of PUBLIC_PAGES) {
      for (const { label, pattern } of BANNED_CLAIMS) {
        const offending = sentences(page.description).filter(
          (sentence) => pattern.test(sentence) && !NEGATION.test(sentence),
        );
        expect(offending, `${page.path} description states "${label}"`).toEqual([]);
      }
    }
  });

  it('catches an unnegated claim, so the check is not decorative', () => {
    // Guards the guard. Sentence-level negation is subtle enough that a test
    // suite should prove it still fails on the thing it exists to catch.
    const claim = 'Wellovue can reverse diabetes in ninety days.';
    const disclaimer = 'Wellovue does not reverse diabetes and makes no such claim.';
    const pattern = BANNED_CLAIMS[0].pattern;

    expect(pattern.test(claim) && !NEGATION.test(claim)).toBe(true);
    expect(pattern.test(disclaimer) && !NEGATION.test(disclaimer)).toBe(false);
  });
});

describe('the sitemap', () => {
  const entries = sitemap();

  it('offers exactly the registered public pages', () => {
    expect(entries.map((e) => e.url).sort()).toEqual(
      PUBLIC_PAGES.map((p) => canonical(p.path)).sort(),
    );
  });

  it('never offers a signed-in route', () => {
    for (const entry of entries) {
      const path = entry.url.replace(SITE_URL, '');
      for (const blocked of DISALLOWED_PATHS) {
        expect(path.startsWith(blocked), `${entry.url} is disallowed by robots`).toBe(false);
      }
    }
  });

  it('gives absolute URLs on the configured host', () => {
    for (const entry of entries) {
      expect(entry.url.startsWith(`${SITE_URL}/`)).toBe(true);
    }
  });
});

describe('robots', () => {
  const result = robots();
  const rule = Array.isArray(result.rules) ? result.rules[0] : result.rules;
  const disallowed = [rule?.disallow ?? []].flat();

  it('keeps crawlers out of every signed-in route', () => {
    for (const path of ['/timeline', '/log', '/evidence', '/experiments', '/profile', '/report']) {
      expect(disallowed, `${path} must be disallowed`).toContain(path);
    }
  });

  it('keeps crawlers out of the API', () => {
    expect(disallowed).toContain('/api/');
  });

  it('still lets the marketing pages be crawled', () => {
    expect([rule?.allow ?? []].flat()).toContain('/');
    for (const page of PUBLIC_PAGES) {
      expect(disallowed).not.toContain(page.path);
    }
  });

  it('points at the sitemap on the configured host', () => {
    expect(result.sitemap).toBe(`${SITE_URL}/sitemap.xml`);
  });
});

describe('structured data', () => {
  it('marks a health page as medical content', () => {
    const schema = medicalWebPageSchema('/type-2-diabetes');
    expect(schema['@type']).toBe('MedicalWebPage');
    expect(schema.url).toBe(canonical('/type-2-diabetes'));
  });

  it('refuses to mark a product page as medical content', () => {
    // The rule that keeps the schema honest. Every page here mentions
    // diabetes; only two of them explain it.
    for (const route of ['/clinician-report', '/diabetes-intelligence', '/about', '/']) {
      expect(() => medicalWebPageSchema(route), route).toThrow(/MedicalWebPage/);
    }
  });

  it('is emitted on exactly the health pages', async () => {
    for (const page of PUBLIC_PAGES) {
      const html = await render(page.path);
      const isMedical = html.includes('MedicalWebPage');
      expect(isMedical, `${page.path} (${page.kind})`).toBe(page.kind === 'health');
    }
  });

  it('says what the software will not do, in the machine-readable copy too', () => {
    const schema = softwareApplicationSchema();
    expect(String(schema.disambiguatingDescription)).toMatch(/not a medical device/i);
    expect(schema.applicationCategory).toBe('HealthApplication');
  });
});

describe('pageMetadata', () => {
  it('refuses a route that is not registered', () => {
    expect(() => pageMetadata('/timeline')).toThrow(/No public page registered/);
  });
});
