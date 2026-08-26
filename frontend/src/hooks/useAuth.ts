'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import type { LoginInput, RegisterInput } from '@diabetes/types';
import { api, ApiError, tokenStore } from '@/lib/api';

export function useCurrentUser() {
  return useQuery({
    queryKey: ['currentUser'],
    queryFn: api.users.me,
    retry: false,
    // A 401 means "not signed in", which is an answer, not a failure to retry.
    throwOnError: false,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: (input: LoginInput) => api.auth.login(input),
    onSuccess: (data) => {
      tokenStore.set(data.tokens.accessToken, data.tokens.refreshToken);
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
      tokenStore.set(data.tokens.accessToken, data.tokens.refreshToken);
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
      queryClient.clear();
      router.push('/login');
    },
  });
}
