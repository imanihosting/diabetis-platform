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
  /**
   * When the address was proven to belong to the person holding the account,
   * or null while it has not been.
   *
   * On the user rather than hidden behind a boolean the server keeps to
   * itself, because the app has to be able to say "we sent a link to this
   * address" without asking a second endpoint, and because the moment it
   * happened is what the audit trail is checked against.
   */
  emailVerifiedAt: z.coerce.date().nullable(),
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
  /**
   * True whether the address is new, already present, or already confirmed.
   *
   * Deliberately not "we sent you an email", which would differ between an
   * address already on the list and one that is not, and turn this public form
   * into a way to test who is on it.
   */
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

/**
 * Email verification and password reset.
 *
 * Every response type below is deliberately content-free. These endpoints are
 * public and take an address, so anything that differs between "we know this
 * account" and "we do not" turns them into an account-existence oracle — the
 * same reason `waitlistSignupResult` says only `subscribed`.
 */
export const verifyEmailSchema = z.object({
  // Long enough that a truncated paste fails here rather than as a puzzling
  // "invalid link" after a database lookup.
  token: z.string().min(20).max(400),
});
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

/** Why a verification attempt did not succeed, for the page to explain. */
export const verificationFailureSchema = z.enum(['expired', 'invalid']);
export type VerificationFailure = z.infer<typeof verificationFailureSchema>;

export const verifyEmailResultSchema = z.object({
  verified: z.boolean(),
  /** Absent when `verified` is true. */
  reason: verificationFailureSchema.optional(),
});
export type VerifyEmailResult = z.infer<typeof verifyEmailResultSchema>;

export const resendVerificationSchema = z.object({
  email: z.string().email().max(320),
});
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;

/**
 * The same answer for every address.
 *
 * `accepted: true` means the request was taken, not that anything was sent.
 * Reporting whether a message went out would say whether the account exists.
 */
export const mailRequestResultSchema = z.object({ accepted: z.literal(true) });
export type MailRequestResult = z.infer<typeof mailRequestResultSchema>;

export const passwordResetRequestSchema = z.object({
  email: z.string().email().max(320),
});
export type PasswordResetRequestInput = z.infer<typeof passwordResetRequestSchema>;

export const passwordResetCompleteSchema = z.object({
  token: z.string().min(20).max(400),
  // Same rule as registration: a reset must not be a way to set a weaker
  // password than signup would have allowed.
  password: z.string().min(12, 'Password must be at least 12 characters').max(200),
});
export type PasswordResetCompleteInput = z.infer<typeof passwordResetCompleteSchema>;

export const passwordResetCompleteResultSchema = z.object({
  reset: z.boolean(),
  reason: verificationFailureSchema.optional(),
});
export type PasswordResetCompleteResult = z.infer<typeof passwordResetCompleteResultSchema>;

/**
 * Confirming a waitlist address.
 *
 * Separate from `verifyEmailSchema` despite the identical shape, because the
 * two tokens live in different tables and mean different things: one proves an
 * account holder can read their inbox, the other records that a stranger
 * consented to be written to. Sharing a type would invite sharing a code path.
 */
export const waitlistConfirmSchema = z.object({
  token: z.string().min(20).max(400),
});
export type WaitlistConfirmInput = z.infer<typeof waitlistConfirmSchema>;

export const waitlistConfirmResultSchema = z.object({
  confirmed: z.boolean(),
  /** Absent when `confirmed` is true. */
  reason: verificationFailureSchema.optional(),
});
export type WaitlistConfirmResult = z.infer<typeof waitlistConfirmResultSchema>;
