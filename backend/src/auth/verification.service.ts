import { Inject, Injectable, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import type {
  MailRequestResult,
  PasswordResetCompleteResult,
  VerifyEmailResult,
} from '@wellovue/types';
import { ENV, type Env, type Ttl } from '../config/env';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../notifications/mail.service';
import { deviceClass, deviceFingerprint } from './sign-in-device';

type TokenPurpose = 'email_verification' | 'password_reset';

/**
 * Proving an address, and getting back into an account.
 *
 * Both flows are the same object with different consequences — a random secret
 * mailed to an address, stored as a hash, usable once, expiring — so they live
 * together and share one issue-and-consume path. Splitting them would mean two
 * places to get the expiry check wrong.
 *
 * The rule that shapes every public method here: **a stranger must not be able
 * to learn whether an address has an account.** `requestPasswordReset` and
 * `resendVerification` are unauthenticated and take an email, so any
 * difference between the two cases — a different response, a different status,
 * a noticeably different response time — turns them into a membership oracle
 * for a diabetes platform. They return the same value, always.
 */
@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  /**
   * Issues a verification token and queues the email.
   *
   * Takes the transaction client from registration, so the token, the outbox
   * row and the account itself commit together. A verification email for an
   * account whose insert rolled back is a link to nothing, and a user staring
   * at "check your email" for a message that will never work.
   */
  async sendVerification(
    user: { id: string; email: string },
    client?: PoolClient,
  ): Promise<void> {
    const token = await this.issueToken(user.id, 'email_verification', client);

    await this.mail.queue(
      {
        template: 'email_verification',
        to: user.email,
        userId: user.id,
        vars: {
          verifyUrl: `${this.env.APP_PUBLIC_URL}/verify-email?token=${token}`,
          expiresIn: describeTtl(this.env.EMAIL_VERIFICATION_TTL),
        },
        metadata: { flow: 'email_verification' },
      },
      client,
    );

    await this.audit.record(
      {
        actorUserId: user.id,
        subjectUserId: user.id,
        action: 'auth.verification_requested',
        resourceType: 'user',
        resourceId: user.id,
      },
      client,
    );
  }

  /**
   * Consumes a verification token.
   *
   * The whole check is one statement: find a token whose hash matches, which
   * has not been used and has not expired, and mark it used. Doing it as a
   * read followed by a write would leave a window in which the same link,
   * clicked twice — which mail clients that prefetch links do routinely —
   * passes the check twice.
   *
   * `expired` and `invalid` are told apart, on purpose. The token is a secret
   * only its holder has, so saying "this one has run out" reveals nothing to
   * anybody who did not already have it, and it is the difference between a
   * page that offers a new link and a page that says something went wrong.
   */
  async verifyEmail(token: string): Promise<VerifyEmailResult> {
    const hash = hashToken(token);

    const outcome = await this.db.transaction(async (client) => {
      const { rows } = await client.query<{ user_id: string; email: string }>(
        `with claimed as (
           update identity.security_tokens
              set used_at = now()
            where token_hash = $1
              and purpose = 'email_verification'
              and used_at is null
              and expires_at > now()
           returning user_id
         )
         update identity.users u
            set email_verified_at = coalesce(u.email_verified_at, now())
           from claimed
          where u.id = claimed.user_id
         returning u.id as user_id, u.email`,
        [hash],
      );

      const user = rows[0];
      if (!user) return null;

      await this.audit.record(
        {
          actorUserId: user.user_id,
          subjectUserId: user.user_id,
          action: 'auth.email_verified',
          resourceType: 'user',
          resourceId: user.user_id,
        },
        client,
      );

      // Only now. The welcome message is the reward for proving the address,
      // and sending it at signup would mean mailing whoever actually owns a
      // mistyped address a welcome to an account they did not open.
      //
      // Deduped on the user, so a link clicked twice — or prefetched by a mail
      // client and then clicked — cannot produce two welcomes. The first click
      // is what verifies; this guard covers the case where the row was
      // verified by some other path.
      await this.mail.queue(
        {
          template: 'welcome',
          to: user.email,
          userId: user.user_id,
          vars: {},
          dedupeKey: `welcome:${user.user_id}`,
          metadata: { flow: 'welcome' },
        },
        client,
      );

      return user;
    });

    if (outcome) return { verified: true };

    // Nothing matched. Either the token never existed, or it is spent, or it
    // has expired — and the page says something different for the last case,
    // so it is worth one more lookup to tell them apart.
    const known = await this.db.queryOne<{ expired: boolean }>(
      `select (expires_at <= now() and used_at is null) as expired
         from identity.security_tokens
        where token_hash = $1 and purpose = 'email_verification'`,
      [hash],
    );

    return { verified: false, reason: known?.expired ? 'expired' : 'invalid' };
  }

  /**
   * Sends another verification link, if there is an account to send one for.
   *
   * Returns the same thing either way. The caller — an unauthenticated
   * endpoint — must not be able to distinguish, and the rate limit in front of
   * it is what stops this being used to walk an address list slowly.
   *
   * An already-verified account is a no-op that also returns `accepted`. The
   * alternative, "this address is already verified", is the enumeration answer
   * in polite words.
   */
  async resendVerification(email: string): Promise<MailRequestResult> {
    const user = await this.db.queryOne<{ id: string; email: string; verified: boolean }>(
      `select id, email, email_verified_at is not null as verified
         from identity.users
        where lower(email) = lower($1) and status = 'active'`,
      [email],
    );

    if (user && !user.verified) {
      // Outstanding links are invalidated first. Two live verification tokens
      // for one account is one more than the flow needs, and a user who asked
      // for a new link because the old one did not arrive should not have the
      // old one still working a day later.
      await this.db.transaction(async (client) => {
        await this.invalidateOutstanding(user.id, 'email_verification', client);
        await this.sendVerification(user, client);
      });
    }

    return { accepted: true };
  }

  /**
   * Starts a password reset, if there is an account.
   *
   * Same shape as the resend above and for the same reason. The audit entry is
   * written only when there is an account to attach it to: `audit.events`
   * requires a subject that exists, and a table of "resets requested for
   * addresses we have never heard of" would be a log of who somebody was
   * probing for.
   */
  async requestPasswordReset(email: string): Promise<MailRequestResult> {
    const user = await this.db.queryOne<{ id: string; email: string }>(
      `select id, email from identity.users
        where lower(email) = lower($1) and status = 'active'`,
      [email],
    );

    if (user) {
      await this.db.transaction(async (client) => {
        await this.invalidateOutstanding(user.id, 'password_reset', client);
        const token = await this.issueToken(user.id, 'password_reset', client);

        await this.mail.queue(
          {
            template: 'password_reset',
            to: user.email,
            userId: user.id,
            vars: {
              resetUrl: `${this.env.APP_PUBLIC_URL}/reset-password?token=${token}`,
              expiresIn: describeTtl(this.env.PASSWORD_RESET_TTL),
            },
            metadata: { flow: 'password_reset' },
          },
          client,
        );

        await this.audit.record(
          {
            actorUserId: null,
            subjectUserId: user.id,
            action: 'auth.password_reset_requested',
            resourceType: 'user',
            resourceId: user.id,
          },
          client,
        );
      });
    }

    return { accepted: true };
  }

  /**
   * Finishes a password reset.
   *
   * Three things happen together or not at all: the token is spent, the
   * credential is replaced, and every existing session is revoked. The last is
   * the one that is easy to leave out and the one that matters — somebody
   * resetting a password they think was stolen has not achieved anything if
   * the thief's refresh token still works for another twenty-nine days.
   *
   * A successful reset also verifies the address. Receiving mail at it is the
   * same proof the verification link asks for, and leaving the account
   * unverified after somebody demonstrably read their inbox would be theatre.
   */
  async completePasswordReset(
    token: string,
    password: string,
  ): Promise<PasswordResetCompleteResult> {
    const hash = hashToken(token);

    // Hashed before the transaction opens: argon2 is deliberately slow, and
    // holding a database transaction through it would tie up a pooled
    // connection for the duration.
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

    const user = await this.db.transaction(async (client) => {
      const { rows } = await client.query<{ id: string; email: string }>(
        `with claimed as (
           update identity.security_tokens
              set used_at = now()
            where token_hash = $1
              and purpose = 'password_reset'
              and used_at is null
              and expires_at > now()
           returning user_id
         )
         update identity.users u
            set email_verified_at = coalesce(u.email_verified_at, now())
           from claimed
          where u.id = claimed.user_id
         returning u.id, u.email`,
        [hash],
      );

      const claimed = rows[0];
      if (!claimed) return null;

      await client.query(
        `insert into identity.credentials (user_id, password_hash)
         values ($1, $2)
         on conflict (user_id) do update set password_hash = excluded.password_hash`,
        [claimed.id, passwordHash],
      );

      await client.query(
        `update identity.refresh_tokens set revoked_at = now()
          where user_id = $1 and revoked_at is null`,
        [claimed.id],
      );

      // Any other outstanding reset link is dead too. Otherwise a second
      // request made while the first email was in flight stays usable after
      // the password has already been changed.
      await this.invalidateOutstanding(claimed.id, 'password_reset', client);

      await this.mail.queue(
        {
          template: 'password_changed',
          to: claimed.email,
          userId: claimed.id,
          vars: { changedAt: approximateTime(new Date()) },
          metadata: { flow: 'password_reset' },
        },
        client,
      );

      await this.audit.record(
        {
          actorUserId: claimed.id,
          subjectUserId: claimed.id,
          action: 'auth.password_reset_completed',
          resourceType: 'user',
          resourceId: claimed.id,
        },
        client,
      );

      return claimed;
    });

    if (user) return { reset: true };

    const known = await this.db.queryOne<{ expired: boolean }>(
      `select (expires_at <= now() and used_at is null) as expired
         from identity.security_tokens
        where token_hash = $1 and purpose = 'password_reset'`,
      [hash],
    );

    return { reset: false, reason: known?.expired ? 'expired' : 'invalid' };
  }

  /**
   * Records the device a sign-in came from, and says if it is new.
   *
   * Never throws and never blocks. This runs after the session has already
   * been issued: a failure to send a courtesy email must not turn a successful
   * sign-in into an error, which would be a mail outage presenting as an
   * inability to log in.
   *
   * The first device an account ever signs in from is recorded silently. A
   * "new sign-in" email arriving seconds after the verification email, for the
   * browser the person is looking at, teaches them that these messages are
   * noise — and the whole value of the notification is that it is not.
   */
  async noteSignInDevice(
    user: { id: string; email: string },
    userAgent: string | undefined,
  ): Promise<void> {
    if (!userAgent) return;

    try {
      const fingerprint = deviceFingerprint(userAgent, this.env.JWT_SECRET);
      const label = deviceClass(userAgent);

      const rows = await this.db.query<{ is_new: boolean; devices_before: number }>(
        `with upserted as (
           insert into identity.sign_in_devices (user_id, fingerprint_hash, device_class)
           values ($1, $2, $3)
           on conflict (user_id, fingerprint_hash)
             do update set last_seen_at = now(), device_class = excluded.device_class
           returning (xmax = 0) as is_new
         )
         select u.is_new,
                (select count(*)::int from identity.sign_in_devices where user_id = $1)
                  as devices_before
           from upserted u`,
        [user.id, fingerprint, label],
      );

      // `xmax = 0` distinguishes the insert from the update, which is the only
      // way to know whether this device is genuinely new without a second
      // round trip.
      //
      // `devices_before` counts what was there before this statement, not
      // after: a data-modifying CTE's rows are invisible to the rest of the
      // same statement, which reads like a bug and is exactly what is wanted
      // here. Zero means this is the account's first sign-in ever, and gets no
      // email — a "new sign-in" notice arriving seconds after the verification
      // one, for the browser the person is looking at, is how people learn
      // these messages are noise.
      const { is_new: isNew, devices_before: before } = rows[0] ?? {
        is_new: false,
        devices_before: 0,
      };
      if (!isNew || before === 0) return;

      const queued = await this.mail.queue({
        template: 'new_device_sign_in',
        to: user.email,
        userId: user.id,
        vars: { signedInAt: approximateTime(new Date()), deviceClass: label },
        metadata: { flow: 'new_device_sign_in', deviceClass: label },
      });

      await this.audit.recordBestEffort({
        actorUserId: user.id,
        subjectUserId: user.id,
        action: 'auth.new_device_signed_in',
        resourceType: 'user',
        resourceId: user.id,
        metadata: { deviceClass: label, notified: queued.queued },
      });
    } catch (err) {
      this.logger.error(
        `Could not record a sign-in device: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Mints a token, stores only its hash, and returns the secret half once.
   *
   * The same shape as the refresh token in AuthService: 32 random bytes, and
   * the database never holds anything that can be put into a link. Somebody
   * reading `identity.security_tokens` cannot verify an account or reset a
   * password with what is in it.
   */
  private async issueToken(
    userId: string,
    purpose: TokenPurpose,
    client?: PoolClient,
  ): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const ttl =
      purpose === 'email_verification'
        ? this.env.EMAIL_VERIFICATION_TTL
        : this.env.PASSWORD_RESET_TTL;

    const sql = `insert into identity.security_tokens (user_id, purpose, token_hash, expires_at)
                 values ($1, $2, $3, now() + $4::interval)`;
    const params = [userId, purpose, hashToken(token), toPostgresInterval(ttl)];

    if (client) await client.query(sql, params);
    else await this.db.query(sql, params);

    return token;
  }

  private async invalidateOutstanding(
    userId: string,
    purpose: TokenPurpose,
    client: PoolClient,
  ): Promise<void> {
    await client.query(
      `update identity.security_tokens set used_at = now()
        where user_id = $1 and purpose = $2 and used_at is null`,
      [userId, purpose],
    );
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Converts `15m` / `24h` style TTLs into a Postgres interval literal. */
function toPostgresInterval(ttl: Ttl): string {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (!match) throw new Error(`Unsupported TTL format: ${ttl}`);
  const units = { s: 'seconds', m: 'minutes', h: 'hours', d: 'days' } as const;
  return `${match[1]} ${units[match[2] as keyof typeof units]}`;
}

/** `24h` as "24 hours", for an email that has to say when a link stops working. */
export function describeTtl(ttl: Ttl): string {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (!match) return ttl;
  const amount = Number(match[1]);
  const unit = { s: 'second', m: 'minute', h: 'hour', d: 'day' }[
    match[2] as 's' | 'm' | 'h' | 'd'
  ];
  return `${amount} ${unit}${amount === 1 ? '' : 's'}`;
}

/**
 * The time a security email is allowed to quote.
 *
 * To the minute and in UTC. Not the person's own timezone, which would mean
 * reading their profile to write a courtesy email, and not to the second,
 * which implies a precision the notification does not have — the mail is
 * queued and sent by a worker, so it describes a moment that has already
 * passed by an unknown amount. The word "approximate" beside it in the
 * template is the honest part.
 */
export function approximateTime(at: Date): string {
  return `${at.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}
