import { z } from 'zod';
import { uuidSchema } from './common';

export const registerSchema = z.object({
  email: z.string().email(),
  password: z
    .string()
    .min(12, 'Password must be at least 12 characters')
    .max(200),
  displayName: z.string().min(1).max(120).optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const primaryRoleSchema = z.enum(['patient', 'clinician', 'admin']);
export type PrimaryRole = z.infer<typeof primaryRoleSchema>;

export const userSchema = z.object({
  id: uuidSchema,
  email: z.string().email(),
  displayName: z.string().nullable(),
  primaryRole: primaryRoleSchema,
  createdAt: z.coerce.date(),
});
export type User = z.infer<typeof userSchema>;

/**
 * Server-internal token pair.
 *
 * The refresh token never reaches the browser as data: it is set as an
 * HttpOnly cookie so page JavaScript cannot read it. See
 * backend/src/auth/refresh-cookie.ts.
 */
export const authTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int(),
});
export type AuthTokens = z.infer<typeof authTokensSchema>;

export const authResponseSchema = z.object({
  user: userSchema,
  tokens: authTokensSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

/** What the browser actually receives — no refresh token in the payload. */
export const clientAuthTokensSchema = authTokensSchema.omit({
  refreshToken: true,
});
export type ClientAuthTokens = z.infer<typeof clientAuthTokensSchema>;

export const clientAuthResponseSchema = z.object({
  user: userSchema,
  tokens: clientAuthTokensSchema,
});
export type ClientAuthResponse = z.infer<typeof clientAuthResponseSchema>;
