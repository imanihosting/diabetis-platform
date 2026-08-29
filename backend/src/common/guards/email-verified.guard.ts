import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ALLOW_UNVERIFIED_KEY } from '../decorators/allow-unverified.decorator';
import type { RequestWithUser } from '../decorators/current-user.decorator';
import { DatabaseService } from '../../database/database.service';

/**
 * Keeps an unproven email address out of the product.
 *
 * **The product rule, decided here and applied everywhere:** an account whose
 * address has not been verified can sign in, see who it is, ask for another
 * verification link and sign out. It cannot reach anything else.
 *
 * The alternative — let people in with a banner asking them to verify — is
 * friendlier and wrong for this platform. An unverified address means nobody
 * has shown they can read that inbox, and the account behind it accumulates
 * glucose imports, medications and clinical context. If the address was
 * mistyped at signup, the real owner of what was typed can request a password
 * reset and walk into a stranger's health record; if it was somebody else's
 * address on purpose, the same. Verification is what closes that, and a banner
 * does not close it.
 *
 * Registered globally after JwtAuthGuard, so a route is closed by omission and
 * opening one takes an explicit `@AllowUnverified()`.
 */
@Injectable()
export class EmailVerifiedGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DatabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const exempt = this.reflector.getAllAndOverride<boolean>(ALLOW_UNVERIFIED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (exempt) return true;

    // A public route has no user to check. JwtAuthGuard has already let it
    // through, and asking for verification here would close it again.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    if (!user) return true; // JwtAuthGuard owns this case and has already refused.

    if (user.emailVerified) return true;

    // The claim said unverified, and an access token lives for fifteen
    // minutes: somebody who verified two minutes ago is holding a token that
    // still says no. Asking the database settles it, and only the unverified
    // pay for the question — a verified user is answered from the token and
    // never reaches this line.
    const row = await this.db.queryOne<{ verified: boolean }>(
      `select email_verified_at is not null as verified
         from identity.users where id = $1`,
      [user.id],
    );

    if (row?.verified) {
      // Correct the request's own view of the user, so a handler downstream
      // does not disagree with the guard that just admitted it.
      request.user = { ...user, emailVerified: true };
      return true;
    }

    // A distinct code, because the frontend has to tell this apart from an
    // expired session: one means "verify your address", the other means "sign
    // in again", and showing the wrong one sends people in circles.
    throw new ForbiddenException({
      statusCode: 403,
      code: 'email_unverified',
      message: 'Verify your email address to use Wellovue.',
    });
  }
}
