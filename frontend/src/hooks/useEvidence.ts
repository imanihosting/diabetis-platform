'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSession } from './useAuth';

/**
 * Findings from the metabolic engine for a trailing window.
 *
 * Pattern detection runs over the whole window on every call rather than
 * reading a cached table, so this is deliberately not refetched on window
 * focus. A finding is not a live number; it does not change while you look at
 * it, and re-running the engine because a reader switched tabs is work nobody
 * asked for.
 */
export function useEvidence(days = 30) {
  const { ready } = useSession();
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

  return useQuery({
    // The window is part of the key: the same data over 7 days and over 90
    // days is a different question with a different answer.
    queryKey: ['evidence', days],
    queryFn: () => api.evidence.findings(from, to),
    enabled: ready,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
  });
}
