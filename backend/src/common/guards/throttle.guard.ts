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
/**
 * Endpoints that cause an email to be sent to an address the caller chose.
 *
 * Its own limit rather than reuse of the write limit, because what it protects
 * is somebody else's inbox rather than a table of ours: verification resend
 * and password reset both take an address and mail it. Tight, and keyed on the
 * address as well as the caller — see `generateKey`.
 */
export const THROTTLE_MAIL = 'mail';

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
 * Trusting the header is not enough on its own, and this took a second pass to
 * get right. A proxy that *overwrites* X-Forwarded-For leaves exactly one
 * entry and the leftmost is the client. A CDN that *appends* — Cloudflare does
 * — adds the real address to whatever the caller already sent, so the leftmost
 * entry is attacker-chosen. `CLIENT_IP_HEADER` names the edge's own header for
 * those deployments, and without it the guard falls back to an address it can
 * actually vouch for, which may be coarse and is never forgeable.
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
   * the timeline and a tight one for guessing a password, or for asking that a
   * message be sent to somebody.
   */
  protected generateKey(
    context: ExecutionContext,
    suffix: string,
    name: string,
  ): string {
    // The mail limits key the same way and for a closely related reason: an
    // attacker rotating addresses is aiming at inboxes, and an attacker
    // rotating source addresses is aiming at one inbox. Folding both into the
    // key means neither rotation buys a fresh budget.
    if (name !== THROTTLE_AUTH && name !== THROTTLE_MAIL) {
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
      // An edge-set header, when the deployment has one. This is the only
      // correct answer behind a CDN that appends to X-Forwarded-For rather
      // than overwriting it: Cloudflare adds the true client address to
      // whatever the caller already put in that header, so the leftmost entry
      // is a string the caller chose. Keying on it would hand an attacker a
      // fresh budget on every request, which is the exact failure this guard
      // exists to prevent.
      const header = this.env.CLIENT_IP_HEADER;
      if (header) {
        const value = request.headers[header];
        const address = Array.isArray(value) ? value[0] : value;
        // One address, not a list. These headers carry a single value; if one
        // arrives with a comma in it, something is forwarding it wrongly and
        // the first entry is the least bad reading.
        const first = address?.split(',')[0]?.trim();
        if (first) return first;
      }

      // Otherwise Express's own computation, which honours the number of hops
      // the app was told to trust. Deliberately not `ips[0]`: that is the
      // leftmost X-Forwarded-For entry, which is only the client when the
      // nearest proxy overwrites the header. When it appends — every CDN — the
      // leftmost entry is whatever the caller sent.
      //
      // When the chain is longer than the trusted hop count this returns an
      // internal address and every caller shares one bucket. That is coarse
      // and it is not exploitable, which is the right direction for this to
      // fail in; `CLIENT_IP_HEADER` is how it is made precise.
      if (request.ip) return request.ip;
    }
    return request.socket.remoteAddress ?? 'unknown';
  }
}
