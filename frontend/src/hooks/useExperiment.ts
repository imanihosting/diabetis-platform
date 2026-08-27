'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AttachOutcomeInput } from '@wellovue/types';
import { api } from '@/lib/api';
import { useSession } from './useAuth';

/**
 * One experiment, with the expectation recorded before it ran and, once it is
 * finished, what actually happened.
 *
 * Not refetched on window focus, for the same reason findings are not: none of
 * this moves while somebody is reading it. A prediction cannot be edited and
 * an outcome is written once, so the only thing that ever changes this
 * response is an action taken on this screen — and those invalidate it
 * themselves.
 */
export function useExperiment(id: string) {
  const { ready } = useSession();

  return useQuery({
    queryKey: ['experiment', id],
    queryFn: () => api.experiments.get(id),
    enabled: ready && Boolean(id),
    refetchOnWindowFocus: false,
  });
}

/**
 * Starts an experiment.
 *
 * The first irreversible thing a person can do in this product: the experiment
 * cannot afterwards be deleted, and neither can the prediction the server
 * writes in the same transaction. The screen that calls this is responsible
 * for saying so beforehand.
 */
export function useStartExperiment(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.experiments.start(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['experiment', id] });
      void queryClient.invalidateQueries({ queryKey: ['experiments'] });
      // The prediction list gained one, and the evidence screen's proposal for
      // this finding is no longer an offer.
      void queryClient.invalidateQueries({ queryKey: ['predictions'] });
    },
  });
}

/**
 * Records what happened, which is also what finishes the experiment.
 *
 * One call, because they are one act. Recording a result without finishing the
 * trial would leave it running with its answer already known.
 */
export function useCompleteExperiment(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: AttachOutcomeInput) => api.experiments.complete(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['experiment', id] });
      void queryClient.invalidateQueries({ queryKey: ['experiments'] });
    },
  });
}
