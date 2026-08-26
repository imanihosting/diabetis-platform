'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import type { LoginInput, RegisterInput } from '@wellovue/types';
import { api, ApiError, refreshSession, tokenStore } from '@/lib/api';

/**
 * Resolves the signed-in user.
 *
 * The access token lives only in memory, so a page load starts with nothing.
 * Before giving up, this tries to renew the session from the HttpOnly refresh
 * cookie — that is what keeps a reload from logging the person out, without
 * any credential being readable by script.
 */
export function useCurrentUser() {
  return useQuery({
    queryKey: ['currentUser'],
    queryFn: async () => {
      if (!tokenStore.get()) {
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
      router.push('/timeline');
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
