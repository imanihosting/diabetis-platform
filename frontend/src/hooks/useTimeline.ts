'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useCurrentUser } from './useAuth';

/**
 * Data queries wait for the session to resolve.
 *
 * The access token lives in memory, so a cold page load starts without one.
 * Firing these immediately means each one 401s, triggers a refresh, and
 * retries: the data arrives either way, but it costs a wasted round trip per
 * query and puts errors in the console on every single load.
 */
function useSession() {
  const user = useCurrentUser();
  return { ready: Boolean(user.data), settled: !user.isLoading };
}

export function useTimeline(days = 7) {
  const { ready } = useSession();
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

  return useQuery({
    // The range is part of the key so switching periods refetches rather than
    // showing the previous window's data under a new heading.
    queryKey: ['timeline', days],
    queryFn: () => api.timeline.query(from, to),
    enabled: ready,
  });
}

export function useGlucoseSummary(days = 14, unit: 'mmol/L' | 'mg/dL' = 'mmol/L') {
  const { ready } = useSession();
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

  return useQuery({
    queryKey: ['glucoseSummary', days, unit],
    queryFn: () => api.glucose.summary(from, to, unit),
    enabled: ready,
  });
}
