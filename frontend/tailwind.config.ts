import type { Config } from 'tailwindcss';

/**
 * One vocabulary for both surfaces.
 *
 * Colours are referenced directly rather than through Tailwind's
 * `<alpha-value>` channel substitution, because that only works with space-
 * separated RGB triplets and these are OKLCH. Where a translucent version is
 * needed, `color-mix(in oklch, ...)` does it at the call site and stays in the
 * same colour space.
 *
 * The type scale carries two ranges on purpose: `statement`/`fold`/`lede` for
 * the marketing pages, `reading` for measurements in the app. A dashboard is
 * scanned and a landing page is read; they share the palette, not the density.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: {
          DEFAULT: 'var(--paper)',
          sunk: 'var(--paper-sunk)',
          raised: 'var(--paper-raised)',
        },
        ink: {
          DEFAULT: 'var(--ink)',
          muted: 'var(--ink-muted)',
          faint: 'var(--ink-faint)',
        },
        rule: 'var(--rule)',

        // Glucose relative to target. `*Text` variants clear the 4.5:1 text bar.
        zone: {
          in: 'var(--in-range)',
          inWash: 'var(--in-range-wash)',
          inText: 'var(--in-range-text)',
          above: 'var(--above-range)',
          aboveWash: 'var(--above-range-wash)',
          aboveText: 'var(--above-range-text)',
          below: 'var(--below-range)',
          belowText: 'var(--below-range-text)',
        },

        // How far a finding can be trusted.
        evidence: {
          insufficient: 'var(--evidence-insufficient)',
          weak: 'var(--evidence-weak)',
          moderate: 'var(--evidence-moderate)',
          strong: 'var(--evidence-strong)',
        },
      },
      fontFamily: {
        sans: ['var(--font-hyperlegible)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-hyperlegible-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        // Measurements in the app: numbers are the content, so they get steps
        // of their own rather than borrowing a heading size.
        reading: ['2.25rem', { lineHeight: '1', letterSpacing: '-0.02em' }],
        'reading-sm': ['1.5rem', { lineHeight: '1.1', letterSpacing: '-0.01em' }],

        // Marketing display scale. Fluid, well above a 1.25 ratio between
        // steps so the hierarchy reads as decided rather than hedged.
        statement: [
          'clamp(2.35rem, 1.5rem + 3.5vw, 4.5rem)',
          { lineHeight: '1.03', letterSpacing: '-0.033em' },
        ],
        fold: [
          'clamp(1.8rem, 1.2rem + 2.4vw, 3.25rem)',
          { lineHeight: '1.08', letterSpacing: '-0.026em' },
        ],
        lede: [
          'clamp(1.05rem, 0.98rem + 0.42vw, 1.375rem)',
          { lineHeight: '1.5', letterSpacing: '-0.008em' },
        ],
      },
    },
  },
  plugins: [],
};

export default config;
