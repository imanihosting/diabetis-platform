import { SetMetadata } from '@nestjs/common';

export const ALLOW_UNVERIFIED_KEY = 'wellovue:allow-unverified';

/**
 * Lets a route be reached by somebody whose email address is not verified yet.
 *
 * The exception, not the rule. `EmailVerifiedGuard` is global, so a new
 * endpoint is closed to unverified accounts by omission — the safe direction,
 * and the same shape as `@Public()` one layer up.
 *
 * Reserve it for the handful of things a half-finished account genuinely
 * needs: seeing who it is, asking for another verification email, signing out.
 * Anything that reads or writes a health record does not belong here.
 */
export const AllowUnverified = () => SetMetadata(ALLOW_UNVERIFIED_KEY, true);
