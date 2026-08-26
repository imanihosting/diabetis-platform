import type { Config } from 'tailwindcss';

/**
 * A restrained token set, not a theme.
 *
 * The product is a health intelligence tool, so colour carries meaning rather
 * than decoration: `evidence.*` communicates how much a finding can be trusted,
 * and `range.*` describes glucose relative to target. Nothing else is coloured
 * for emphasis alone.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: 'rgb(var(--ink) / <alpha-value>)',
          muted: 'rgb(var(--ink-muted) / <alpha-value>)',
          faint: 'rgb(var(--ink-faint) / <alpha-value>)',
        },
        surface: {
          DEFAULT: 'rgb(var(--surface) / <alpha-value>)',
          raised: 'rgb(var(--surface-raised) / <alpha-value>)',
          sunken: 'rgb(var(--surface-sunken) / <alpha-value>)',
        },
        line: 'rgb(var(--line) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',

        // How much a finding can be trusted.
        evidence: {
          insufficient: 'rgb(var(--evidence-insufficient) / <alpha-value>)',
          weak: 'rgb(var(--evidence-weak) / <alpha-value>)',
          moderate: 'rgb(var(--evidence-moderate) / <alpha-value>)',
          strong: 'rgb(var(--evidence-strong) / <alpha-value>)',
        },

        // Glucose relative to target range.
        range: {
          below: 'rgb(var(--range-below) / <alpha-value>)',
          in: 'rgb(var(--range-in) / <alpha-value>)',
          above: 'rgb(var(--range-above) / <alpha-value>)',
        },

        // Landing page (brand register). Declared in OKLCH in globals.css and
        // referenced directly, because OKLCH does not take Tailwind's
        // <alpha-value> channel substitution.
        paper: {
          DEFAULT: 'var(--paper)',
          sunk: 'var(--paper-sunk)',
          raised: 'var(--paper-raised)',
        },
        brand: {
          ink: 'var(--brand-ink)',
          ink2: 'var(--brand-ink-2)',
          ink3: 'var(--brand-ink-3)',
          rule: 'var(--brand-rule)',
        },
        zone: {
          in: 'var(--in-range)',
          inWash: 'var(--in-range-wash)',
          above: 'var(--above-range)',
          aboveWash: 'var(--above-range-wash)',
          below: 'var(--below-range)',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        // A measurement scale: numbers are the content, so they get their own steps.
        reading: ['2.25rem', { lineHeight: '1', letterSpacing: '-0.02em' }],
        'reading-sm': ['1.5rem', { lineHeight: '1.1', letterSpacing: '-0.01em' }],

        // Landing display scale. Fluid, ratio well above 1.25 between steps so
        // the hierarchy reads as decided rather than hedged.
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
