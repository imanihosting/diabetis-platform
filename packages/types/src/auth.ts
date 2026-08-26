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

/**
 * Landing page email capture.
 *
 * Deliberately just an email: asking a stranger for more before they have seen
 * anything is a poor trade, and this is health-adjacent data from someone who
 * has not consented to anything yet.
 */
export const waitlistSignupSchema = z.object({
  email: z.string().email().max(320),
});
export type WaitlistSignupInput = z.infer<typeof waitlistSignupSchema>;

export const waitlistSignupResultSchema = z.object({
  /** True whether the address is new or already present — see the service. */
  subscribed: z.boolean(),
});
export type WaitlistSignupResult = z.infer<typeof waitlistSignupResultSchema>;

/** Topics the contact form offers, so messages can be routed without triage. */
export const contactTopicSchema = z.enum([
  'general',
  'account',
  'data',
  'clinician',
  'press',
]);
export type ContactTopic = z.infer<typeof contactTopicSchema>;

export const contactMessageSchema = z.object({
  name: z.string().max(200).optional(),
  email: z.string().email().max(320),
  topic: contactTopicSchema.default('general'),
  message: z.string().min(10, 'Tell us a little more').max(5000),
});
export type ContactMessageInput = z.infer<typeof contactMessageSchema>;

export const contactMessageResultSchema = z.object({ received: z.boolean() });
export type ContactMessageResult = z.infer<typeof contactMessageResultSchema>;
