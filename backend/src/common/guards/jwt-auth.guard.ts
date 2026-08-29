import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { AuthenticatedUser, RequestWithUser } from '../decorators/current-user.decorator';

interface AccessTokenPayload {
  sub: string;
  email: string;
  role: AuthenticatedUser['primaryRole'];
  /** Absent in tokens issued before email verification existed. */
  verified?: boolean;
}

/**
 * Registered globally in AppModule — every route requires a valid access token
 * unless explicitly marked @Public(). Health data should never be one
 * forgotten decorator away from being exposed.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(
        header.slice('Bearer '.length),
      );
      request.user = {
        id: payload.sub,
        email: payload.email,
        primaryRole: payload.role,
        // Absent means unverified, which costs a token issued before this
        // existed one database lookup in EmailVerifiedGuard and then goes
        // away on its next refresh. Defaulting the other way would admit
        // every such token to the product without a check.
        emailVerified: payload.verified === true,
      };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
