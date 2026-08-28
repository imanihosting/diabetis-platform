import type { MetadataRoute } from 'next';
import { DISALLOWED_PATHS, SITE_URL } from '@/lib/seo';

/**
 * What a crawler is asked to leave alone.
 *
 * A request, not a control. Every route below is already refused to anyone
 * without a valid access token; this only stops a well-behaved crawler putting
 * a signed-in page into a search result, which is a privacy problem of a
 * different shape from unauthorised access and needs its own answer.
 *
 * The disallow list is shared with the sitemap's test, so a route cannot be
 * disallowed here and offered for indexing there.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: [...DISALLOWED_PATHS] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
