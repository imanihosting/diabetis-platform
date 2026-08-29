'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * Spends the token from a verification link.
 *
 * The mutation succeeds for a refused token too. `verified: false` with a
 * reason is an expected answer — the page has three things to say and only one
 * of them is an error — so only a network or server failure lands in
 * `isError`. See `api.auth.verifyEmail`.
 *
 * A successful verification invalidates the cached user, because
 * `emailVerifiedAt` on it is what the app reads to decide whether the product
 * is reachable.
 */
export function useVerifyEmail() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (token: string) => api.auth.verifyEmail(token),
    onSuccess: (result) => {
      if (result.verified) {
        void queryClient.invalidateQueries({ queryKey: ['currentUser'] });
      }
    },
  });
}

/**
 * Asks for another verification email.
 *
 * Resolves the same way for every well-formed address. Nothing here can tell
 * whether an account exists, which is the point — the server will not say.
 */
export function useResendVerification() {
  return useMutation({
    mutationFn: (email: string) => api.auth.resendVerification(email),
  });
}

export function useRequestPasswordReset() {
  return useMutation({
    mutationFn: (email: string) => api.auth.requestPasswordReset(email),
  });
}

export function useCompletePasswordReset() {
  return useMutation({
    mutationFn: (input: { token: string; password: string }) =>
      api.auth.completePasswordReset(input.token, input.password),
  });
}

/**
 * Confirms a waitlist address.
 *
 * Separate from `useVerifyEmail` despite the identical shape: one proves an
 * account holder can read their inbox, the other records that a stranger
 * consented to be written to. They reach different endpoints and different
 * tables, and sharing a hook would invite sharing a code path.
 */
export function useConfirmWaitlist() {
  return useMutation({
    mutationFn: (token: string) => api.waitlist.confirm(token),
  });
}
