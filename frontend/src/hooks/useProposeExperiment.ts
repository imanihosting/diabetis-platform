'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ExperimentProposal } from '@wellovue/types';
import { api } from '@/lib/api';

/**
 * Proposes an experiment and returns what the safety rules said.
 *
 * A refusal is a successful call. The endpoint answers 201 with a decision
 * whether the answer is yes or no, so `isError` here means the request failed
 * rather than that the experiment was declined — and conflating the two would
 * show somebody "something went wrong" when what actually happened is that the
 * product considered their question and said no.
 */
export function useProposeExperiment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (proposal: ExperimentProposal) => api.experiments.propose(proposal),
    onSuccess: () => {
      // The experiments list now has one more in it, refusals included.
      void queryClient.invalidateQueries({ queryKey: ['experiments'] });
    },
  });
}
