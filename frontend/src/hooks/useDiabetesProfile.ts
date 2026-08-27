'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DiabetesType, SafetyFlag } from '@wellovue/types';
import { api } from '@/lib/api';
import { useSession } from './useAuth';

const KEY = ['diabetesProfile'];

export function useDiabetesProfile() {
  const { ready } = useSession();

  return useQuery({
    queryKey: KEY,
    queryFn: () => api.diabetesProfile.get(),
    enabled: ready,
    staleTime: 5 * 60 * 1000,
  });
}

export interface ProfileSubmission {
  diabetesType: DiabetesType;
  /** The flags the person ticked. Anything absent is recorded as inactive. */
  flags: SafetyFlag[];
  /** Every flag the form offered, so an unticked box can be recorded as a No. */
  offeredFlags: readonly SafetyFlag[];
}

/**
 * Saves a profile answer and the flags that go with it.
 *
 * The diagnosis is written first and each flag after it, sequentially rather
 * than in parallel. Every write re-derives the care mode from the diagnosis
 * plus the flags then in force, so two concurrent writes would each derive
 * from a different half-applied state and the last one to land would win with
 * an answer neither was asked for.
 *
 * Unticked boxes are recorded as `inactive` rather than skipped. "I am not
 * using insulin" is an answer, and a flag that was never recorded is
 * indistinguishable from one nobody asked about — which is the distinction the
 * whole profile layer exists to keep.
 */
export function useSaveDiabetesProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ diabetesType, flags, offeredFlags }: ProfileSubmission) => {
      let context = await api.diabetesProfile.update({ diabetesType });

      for (const flag of offeredFlags) {
        const status = flags.includes(flag) ? 'active' : 'inactive';
        const alreadyActive = context.activeFlags.includes(flag);
        // Append-only storage: writing an unchanged answer would add a row
        // saying nothing happened. Only record a genuine change.
        if (alreadyActive === (status === 'active')) continue;
        context = await api.diabetesProfile.recordFlag({ flag, status });
      }

      return context;
    },
    onSuccess: (context) => {
      queryClient.setQueryData(KEY, context);
      // The care mode decides whether the engine runs, so findings computed
      // under the previous answer are no longer the right answer.
      void queryClient.invalidateQueries({ queryKey: ['evidence'] });
    },
  });
}
