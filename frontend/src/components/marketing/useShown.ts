'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Reports when an element has entered the viewport, once.
 *
 * Returns `true` immediately when the reader prefers reduced motion, so
 * nothing is gated behind an animation that will never run.
 */
export function useShown<T extends HTMLElement>(margin = '-12%') {
  const ref = useRef<T>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || !ref.current) {
      setShown(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          observer.disconnect();
        }
      },
      { rootMargin: `0px 0px ${margin} 0px` },
    );

    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [margin]);

  return { ref, shown };
}
