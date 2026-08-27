'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import type { LoginInput, RegisterInput } from '@wellovue/types';
import { api, ApiError, refreshSession, tokenStore } from '@/lib/api';
import { hasSessionHint } from './useSessionHint';

/**
 * Resolves the signed-in user.
 *
 * The access token lives only in memory, so a page load starts with nothing.
 * Before giving up, this tries to renew the session from the HttpOnly refresh
 * cookie — that is what keeps a reload from logging the person out, without
 * any credential being readable by script.
 *
 * A visitor with no session is not asked to prove it. The refresh cookie is
 * HttpOnly and unreadable, but it is always written alongside a readable hint
 * with the same lifetime, so the absence of the hint is a reliable "there is
 * nothing to renew". Skipping the call saves a round trip on every anonymous
 * page view and, more visibly, stops the sign-in page from printing an
 * expected 401 into the browser console: a production page whose console has
 * a red line in it on first load teaches people to ignore red lines.
 *
 * A hint without a usable cookie still behaves: the refresh returns 401, the
 * hint is cleared, and the next load takes the quiet path.
 */
export function useCurrentUser() {
  return useQuery({
    queryKey: ['currentUser'],
    queryFn: async () => {
      if (!tokenStore.get()) {
        if (!hasSessionHint()) return null;
        const renewed = await refreshSession();
        if (!renewed) return null;
      }
      try {
        return await api.users.me();
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Whether data queries may run yet.
 *
 * The access token lives in memory, so a cold page load starts without one.
 * Firing queries immediately means each one 401s, triggers a refresh, and
 * retries: the data arrives either way, but it costs a wasted round trip per
 * query and puts errors in the console on every single load.
 */
export function useSession() {
  const user = useCurrentUser();
  return { ready: Boolean(user.data), settled: !user.isLoading };
}

export function useLogin() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: (input: LoginInput) => api.auth.login(input),
    onSuccess: (data) => {
      tokenStore.set(data.tokens.accessToken);
      queryClient.setQueryData(['currentUser'], data.user);
      router.push('/timeline');
    },
  });
}

export function useRegister() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: (input: RegisterInput) => api.auth.register(input),
    onSuccess: (data) => {
      tokenStore.set(data.tokens.accessToken);
      queryClient.setQueryData(['currentUser'], data.user);
      // A new account has no care profile, so nothing can be interpreted for
      // them yet. Sending them to a timeline of raw readings first, and only
      // explaining later why Evidence refuses, gets the order backwards.
      router.push('/profile?welcome=1');
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: async () => {
      // Clear locally even if the server call fails — the user asked to leave.
      await api.auth.logout().catch((err) => {
        if (!(err instanceof ApiError)) throw err;
      });
    },
    onSettled: () => {
      tokenStore.clear();
      // Drops every cached health record from memory on sign-out.
      queryClient.clear();
      router.push('/login');
    },
  });
}
