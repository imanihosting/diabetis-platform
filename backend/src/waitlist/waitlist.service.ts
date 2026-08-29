import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type {
  WaitlistConfirmResult,
  WaitlistSignupInput,
  WaitlistSignupResult,
} from '@wellovue/types';
import { ENV, type Env } from '../config/env';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../notifications/mail.service';
import { describeTtl, toPostgresInterval } from '../common/ttl';

/**
 * The landing page's email capture, and the confirmation that makes it a list.
 *
 * An address arrives here unconfirmed and stays that way until somebody clicks
 * a link. That is more machinery than "store the address", and the reason is
 * the sending domain: this platform has one, and account mail — verification,
 * password reset — depends on its reputation. A future send to addresses that
 * never opted in is how that reputation is spent, and the first thing it takes
 * with it is the verification email somebody needs to get into their record.
 *
 * Nothing here ever reveals whether an address is already on the list. The
 * form is public and takes an email, so any difference between the two cases
 * makes it a way to check who signed up for a diabetes product.
 */
@Injectable()
export class WaitlistService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  /**
   * Records an address and asks it to confirm.
   *
   * Three cases, one answer:
   *
   * - **New.** The row is written and a confirmation is queued.
   * - **Present but unconfirmed.** A fresh token replaces the old one and
   *   another confirmation goes out. Somebody who did not receive the first
   *   one is trying again, and the previous link stops working, so there is
   *   never more than one live token for an address.
   * - **Already confirmed.** Nothing happens and nothing is sent. Re-entering
   *   an address that is already on the list must not produce another email.
   *
   * `on conflict ... do update ... where confirmed_at is null` is what makes
   * the third case fall out rather than needing a read first: a confirmed row
   * fails the WHERE, no row is returned, and no mail is queued.
   */
  async signUp(input: WaitlistSignupInput): Promise<WaitlistSignupResult> {
    const token = randomBytes(32).toString('base64url');

    await this.db.transaction(async (client) => {
      const { rows } = await client.query<{ id: string; is_new: boolean }>(
        `insert into identity.waitlist_signups
           (email, source, confirm_token_hash, confirm_expires_at)
         values ($1, 'landing', $2, now() + $3::interval)
         on conflict (lower(email)) do update
            set confirm_token_hash = excluded.confirm_token_hash,
                confirm_expires_at = excluded.confirm_expires_at
          where identity.waitlist_signups.confirmed_at is null
         returning id, (xmax = 0) as is_new`,
        [input.email, hashToken(token), toPostgresInterval(this.env.WAITLIST_CONFIRM_TTL)],
      );

      const row = rows[0];
      if (!row) return;

      await this.mail.queue(
        {
          template: 'waitlist_confirmation',
          to: input.email,
          // Nobody here has an account. That is the whole reason this flow
          // exists separately from email verification.
          userId: null,
          vars: {
            confirmUrl: `${this.env.APP_PUBLIC_URL}/waitlist/confirm?token=${token}`,
            expiresIn: describeTtl(this.env.WAITLIST_CONFIRM_TTL),
          },
          metadata: { flow: 'waitlist_confirmation' },
        },
        client,
      );

      // Only a genuinely new row is audited. Repeats would otherwise let
      // anyone pad the audit trail from an unauthenticated endpoint.
      if (row.is_new) {
        await this.audit.record(
          {
            actorUserId: null,
            subjectUserId: null,
            action: 'waitlist.signup',
            resourceType: 'waitlist_signup',
            resourceId: row.id,
            // The address is the record; it is not repeated into the metadata.
            metadata: { source: 'landing' },
          },
          client,
        );
      }
    });

    return { subscribed: true };
  }

  /**
   * Spends a confirmation token.
   *
   * One statement, like the email-verification claim it mirrors: find a row
   * whose token hash matches and has not expired, mark it confirmed, and clear
   * the token so it cannot be used again. A read followed by a write would
   * leave a window in which a link opened twice — which mail clients that
   * prefetch do routinely — passes twice.
   *
   * `expired` and `invalid` are told apart. The token is a secret only its
   * holder has, so saying which one it is reveals nothing to anybody who did
   * not already have it, and it is the difference between a page that offers
   * to send another and one that says something went wrong.
   */
  async confirm(token: string): Promise<WaitlistConfirmResult> {
    const hash = hashToken(token);

    const confirmed = await this.db.transaction(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `update identity.waitlist_signups
            set confirmed_at = now(),
                confirm_token_hash = null,
                confirm_expires_at = null
          where confirm_token_hash = $1
            and confirm_expires_at > now()
            and confirmed_at is null
         returning id`,
        [hash],
      );

      const row = rows[0];
      if (!row) return null;

      await this.audit.record(
        {
          actorUserId: null,
          subjectUserId: null,
          action: 'waitlist.confirmed',
          resourceType: 'waitlist_signup',
          resourceId: row.id,
        },
        client,
      );

      return row;
    });

    if (confirmed) return { confirmed: true };

    // Nothing matched: the token never existed, or it has been spent, or it
    // has run out. Only the last is worth a different sentence on the page.
    const known = await this.db.queryOne<{ expired: boolean }>(
      `select (confirm_expires_at <= now()) as expired
         from identity.waitlist_signups
        where confirm_token_hash = $1`,
      [hash],
    );

    return { confirmed: false, reason: known?.expired ? 'expired' : 'invalid' };
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
