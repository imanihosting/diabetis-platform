'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useTimeline(days = 7) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

  return useQuery({
    // The range is part of the key so switching periods refetches rather than
    // showing the previous window's data under a new heading.
    queryKey: ['timeline', days],
    queryFn: () => api.timeline.query(from, to),
  });
}

export function useGlucoseSummary(days = 14, unit: 'mmol/L' | 'mg/dL' = 'mmol/L') {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

  return useQuery({
    queryKey: ['glucoseSummary', days, unit],
    queryFn: () => api.glucose.summary(from, to, unit),
  });
}
