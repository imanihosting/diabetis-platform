import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface AuthenticatedUser {
  id: string;
  email: string;
  primaryRole: 'patient' | 'clinician' | 'admin';
  /**
   * Whether the address was verified as of when this token was issued.
   *
   * A claim about the past, not a fact about now: an access token lives 15
   * minutes, so `false` can be stale by that much. EmailVerifiedGuard is the
   * only thing that should act on it, and it treats `false` as a question to
   * put to the database rather than as an answer.
   */
  emailVerified: boolean;
}

export interface RequestWithUser extends Request {
  user?: AuthenticatedUser;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    if (!request.user) {
      // Reaching here means a route was left unguarded — fail loudly.
      throw new Error('CurrentUser used on a route without JwtAuthGuard');
    }
    return request.user;
  },
);
