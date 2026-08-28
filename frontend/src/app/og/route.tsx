import { ImageResponse } from 'next/og';
import { SITE_NAME } from '@/lib/seo';

/**
 * The share card, drawn rather than stored.
 *
 * A route instead of a file-based `opengraph-image` because the URL has to be
 * stable and known: `seo.ts` names it in every page's metadata, and Next's
 * file convention appends a content hash nobody can write down. Drawn rather
 * than committed as a PNG so it stays editable in the same language as the
 * rest of the site.
 *
 * The mark is the product's own object — the target band with a trace settling
 * into it — the same drawing the charts and the footer rule use. A share
 * preview is usually the first thing anybody sees of this product, and it
 * should be the thing the product actually is.
 */
export const runtime = 'nodejs';

/** Cached hard: the image is static, and regenerating it per scrape is waste. */
export const revalidate = 86400;

/**
 * Local rather than exported. A route handler accepts only a fixed set of
 * exports and `size` is not one of them — that belongs to the file-based
 * `opengraph-image` convention this deliberately is not using, because that
 * convention hashes the URL and `seo.ts` needs to be able to name it.
 */
const SIZE = { width: 1200, height: 630 };

export function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#faf7f2',
          color: '#241f1a',
          padding: '80px',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
          <div
            style={{
              width: '54px',
              height: '26px',
              background: '#cfe3d4',
              borderRadius: '4px',
              display: 'flex',
            }}
          />
          <div style={{ fontSize: '34px', fontWeight: 700, letterSpacing: '-0.02em' }}>
            {SITE_NAME}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
          <div
            style={{
              fontSize: '68px',
              fontWeight: 700,
              lineHeight: 1.08,
              letterSpacing: '-0.03em',
              maxWidth: '900px',
            }}
          >
            Personal metabolic evidence, from your own data.
          </div>
          <div style={{ fontSize: '30px', color: '#5b5249', maxWidth: '860px' }}>
            Patterns in your glucose, meals and activity — tested, not asserted.
          </div>
        </div>

        {/* The target band as the ground line, exactly as the site footer draws it. */}
        <div style={{ display: 'flex', width: '100%', height: '10px', background: '#cfe3d4' }} />
      </div>
    ),
    SIZE,
  );
}
