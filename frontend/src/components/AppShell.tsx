'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

const NAV = [
  { href: '/timeline', label: 'Timeline' },
  { href: '/log', label: 'Log' },
  { href: '/evidence', label: 'Evidence' },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-6">
      <header className="flex items-baseline justify-between border-b border-line py-5">
        <Link href="/timeline" className="text-sm font-medium tracking-tight text-ink">
          Diabetes Platform
        </Link>

        <nav className="flex gap-6" aria-label="Main">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={pathname === item.href ? 'page' : undefined}
              className={cn(
                'text-sm transition-colors',
                pathname === item.href
                  ? 'text-ink'
                  : 'text-ink-faint hover:text-ink-muted',
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      <main className="flex-1 py-8">{children}</main>

      <footer className="border-t border-line py-5 text-xs leading-relaxed text-ink-faint">
        This platform helps you understand patterns in your own data and prepare
        for conversations with your clinician. It does not diagnose conditions,
        adjust medication, or provide emergency advice.
      </footer>
    </div>
  );
}
