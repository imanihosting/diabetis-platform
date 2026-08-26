'use client';

import type { ReactNode } from 'react';
import { useShown } from './useShown';

/**
 * Fades a block up as it arrives. One gesture, used consistently, rather than
 * scattered micro-interactions. Inert under prefers-reduced-motion.
 */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const { ref, shown } = useShown<HTMLDivElement>();

  return (
    <div
      ref={ref}
      className={`reveal ${className ?? ''}`}
      data-shown={shown}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
