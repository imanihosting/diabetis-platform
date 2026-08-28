import type { MetadataRoute } from 'next';
import { PUBLIC_PAGES, canonical } from '@/lib/seo';

/**
 * The pages this site asks to have indexed.
 *
 * Generated from `PUBLIC_PAGES` rather than written out, so it cannot list a
 * page that does not exist or miss one that does. Nothing behind sign-in is
 * here — not because a sitemap enforces anything, but because a sitemap is an
 * invitation, and inviting a crawler to somebody's glucose record is the
 * mistake this file is shaped to make impossible.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return PUBLIC_PAGES.map((page) => ({
    url: canonical(page.path),
    lastModified,
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }));
}
