'use client';

import { useQuery } from '@tanstack/react-query';
import type { ReportPeriod } from '@wellovue/types';
import { api } from '@/lib/api';
import { useSession } from './useAuth';

/**
 * The clinician packet for a fixed period.
 *
 * The period is part of the key: thirty days and ninety days are different
 * questions with different answers, and caching one as the other would show
 * somebody a quarter's summary under a month's heading.
 *
 * Not refetched on window focus. Assembling a packet re-runs the pattern
 * engine over the whole window, and a person reading one in an appointment
 * should not have the page redraw underneath them because they switched tabs.
 */
export function useClinicianPacket(days: ReportPeriod) {
  const { ready } = useSession();

  return useQuery({
    queryKey: ['clinicianPacket', days],
    queryFn: () => api.reports.clinicianPacket(days),
    enabled: ready,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
  });
}
