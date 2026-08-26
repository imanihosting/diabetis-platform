import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import {
  Atkinson_Hyperlegible_Mono,
  Atkinson_Hyperlegible_Next,
} from 'next/font/google';
import { Providers } from './providers';
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

export const metadata: Metadata = {
  title: 'Wellovue',
  description:
    'Most diabetes tools tell you what happened. This one helps you find out why.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
