import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route as unauthenticated. Auth is on by default (the guard is
 * registered globally), so exposing a route is an explicit, greppable act.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
