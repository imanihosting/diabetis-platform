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
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        // A measurement scale: numbers are the content, so they get their own steps.
        reading: ['2.25rem', { lineHeight: '1', letterSpacing: '-0.02em' }],
        'reading-sm': ['1.5rem', { lineHeight: '1.1', letterSpacing: '-0.01em' }],
      },
    },
  },
  plugins: [],
};

export default config;
