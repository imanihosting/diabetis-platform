import { createHash } from 'node:crypto';
import { Inject, Injectable, SetMetadata, applyDecorators } from '@nestjs/common';
import {
  Throttle,
  ThrottlerException,
  ThrottlerGuard,
  type ThrottlerLimitDetail,
  type ThrottlerRequest,
} from '@nestjs/throttler';
import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { ENV, type Env } from '../../config/env';

/** Named limits, applied to routes with the @ThrottleScope decorator below. */
export const THROTTLE_AUTH = 'auth';
export const THROTTLE_REFRESH = 'refresh';
export const THROTTLE_WRITE = 'write';

const THROTTLE_SCOPE = 'wellovue:throttle-scope';

/**
 * Applies exactly one named limit to a route.
 *
 * This exists because of a sharp edge in @nestjs/throttler: every configured
 * throttler is evaluated against every route, and `@Throttle({ auth: {} })`
 * configures the auth limit without stopping the others from also applying.
 * Left alone, the five-per-hour limit written for the waitlist form governed
 * the whole API, and the timeline would have started returning 429 to normal
 * use. The integration suite caught it; nothing else would have until users
 * did.
 *
 * The marker lets the guard drop every named throttler except the one the
 * route asked for. A controller that says nothing therefore gets the global
 * default and nothing else, which is the safe direction to fail in.
 */
export function ThrottleScope(name: string): MethodDecorator & ClassDecorator {
  return applyDecorators(SetMetadata(THROTTLE_SCOPE, name), Throttle({ [name]: {} }));
}

/**
 * Rate limiting that keys on who is actually knocking.
 *
 * Two decisions here, both of which the default guard gets wrong for this
 * service.
 *
 * **The client address has to be earned.** Every browser request reaches this
 * process through the frontend's /api proxy, so the socket address is the
 * proxy's for every visitor on earth. Reading X-Forwarded-For fixes that only
 * when something trustworthy sets it; when nothing does, the header is just a
 * string the caller chose, and keying on it means an attacker can rotate their
 * own bucket at will while everyone else shares one. So the header is believed
 * only when TRUST_PROXY says a real proxy overwrites it, and otherwise the
 * socket address is used and the limit is coarse but honest.
 *
 * **An IP is the wrong unit for a login.** Credential stuffing arrives from
 * thousands of addresses, a few attempts each, all aimed at one account. A
 * per-IP limit never fires. Including the submitted email in the key means the
 * account being attacked runs out of attempts no matter how many machines are
 * pointed at it. The email is hashed first: these keys sit in memory for the
 * window's lifetime, and a heap dump should not enumerate who has an account.
 */
@Injectable()
export class ScopedThrottlerGuard extends ThrottlerGuard {
  @Inject(ENV) private readonly env!: Env;

  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    return this.clientAddress(req as unknown as Request);
  }

  /**
   * Drops every named limit except the one this route declared.
   *
   * `true` means "allowed, keep going". The default throttler always runs, so
   * every route keeps a global backstop; the tight named limits reach only the
   * handlers that opted into them.
   */
  protected async handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    const { context, throttler } = requestProps;

    if (throttler.name !== 'default') {
      const scope = this.reflector.getAllAndOverride<string | undefined>(THROTTLE_SCOPE, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (scope !== throttler.name) return true;
    }

    return super.handleRequest(requestProps);
  }

  /**
   * Adds the target account to the key for the auth limits.
   *
   * `generateKey` is the one hook that knows which named limit is being
   * applied, which is why the email is folded in here rather than in
   * `getTracker`: the same address should get a generous allowance for reading
   * the timeline and a tight one for guessing a password.
   */
  protected generateKey(
    context: ExecutionContext,
    suffix: string,
    name: string,
  ): string {
    if (name !== THROTTLE_AUTH) {
      return super.generateKey(context, suffix, name);
    }

    const request = context.switchToHttp().getRequest<Request>();
    const body = request.body as { email?: unknown } | undefined;
    const email = typeof body?.email === 'string' ? body.email : '';
    const account = email
      ? createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 16)
      : 'no-account';

    return super.generateKey(context, `${suffix}:${account}`, name);
  }

  /**
   * The message a throttled caller sees.
   *
   * Says nothing about which limit was hit or how many attempts remain. A
   * login endpoint that reports "3 attempts left for this account" has just
   * confirmed the account exists.
   */
  protected async throwThrottlingException(
    _context: ExecutionContext,
    _detail: ThrottlerLimitDetail,
  ): Promise<void> {
    throw new ThrottlerException(
      'Too many requests from this client. Wait a few minutes and try again.',
    );
  }

  private clientAddress(request: Request): string {
    if (this.env.TRUST_PROXY) {
      // Express populates `ips` from X-Forwarded-For once `trust proxy` is set,
      // leftmost first. Falling back to `ip` covers a direct hit on the
      // backend that skipped the proxy entirely.
      const forwarded = request.ips?.[0];
      if (forwarded) return forwarded;
    }
    return request.ip ?? request.socket.remoteAddress ?? 'unknown';
  }
}
