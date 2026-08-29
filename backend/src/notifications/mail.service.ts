import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { ENV, type Env } from '../config/env';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { GraphMailClient } from './graph-mail.client';
import {
  renderMail,
  templateId,
  type MailBranding,
  type MailTemplateName,
  type MailTemplateVars,
} from './mail.templates';

/**
 * The queue every outbound message goes through.
 *
 * Nothing in this platform sends mail directly. A caller queues, in the same
 * transaction as whatever caused the message, and a worker sends afterwards.
 * That split is the point of the module:
 *
 * - A signup that rolls back has not emailed anybody. The outbox row rolls
 *   back with the account.
 * - Microsoft Graph being slow, throttled or down does not decide whether an
 *   account gets created. It decides when a message goes out, which is the
 *   thing it should decide.
 * - Every send attempt leaves a row, so "did they get the verification email"
 *   has an answer that does not involve reading a log.
 *
 * The row holds the template name, the subject and safe metadata — never a
 * rendered body. See the migration for why, and for the one exception, which
 * is erased as soon as the message is dealt with.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly branding: MailBranding;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly graph: GraphMailClient,
  ) {
    this.branding = {
      appUrl: env.APP_PUBLIC_URL,
      supportEmail: env.MAIL_SUPPORT_EMAIL,
    };
  }

  /**
   * Queues a message, or records why it was not queued.
   *
   * Pass `client` whenever the message must not exist if the thing that caused
   * it does not — a verification email for an account whose insert rolled back
   * is a link to nowhere.
   *
   * Never throws for an ordinary refusal. A duplicate and a rate limit are
   * answers, not failures, and a caller in the middle of a signup transaction
   * must not be aborted by either.
   */
  async queue<T extends MailTemplateName>(
    request: QueueRequest<T>,
    client?: PoolClient,
  ): Promise<QueueOutcome> {
    // Rendered here rather than in the worker, so a template that cannot
    // render — or one whose variables carry something clinical — fails at the
    // point the mistake was made, with a stack that names the caller. The
    // worker renders again at send time from the stored variables; this render
    // is thrown away.
    const rendered = renderMail(request.template, request.vars, this.branding);

    // Off is a real mode, not a broken one. The row is still written so the
    // trail says what would have gone out; it is simply never picked up.
    const disabled = !this.env.MAIL_ENABLED;

    if (!disabled && (await this.recipientOverLimit(request.to, client))) {
      // The address, not the account: an attacker who cannot see whether an
      // account exists can still aim requests at somebody's inbox, and the
      // limit that stops that has to be keyed on where the mail would land.
      await this.insert(request, rendered.subject, 'skipped', 'per-recipient rate limit', client);
      this.logger.warn(
        `Mail ${templateId(request.template)} skipped: recipient limit reached`,
      );
      return { queued: false, reason: 'rate_limited' };
    }

    const id = await this.insert(
      request,
      rendered.subject,
      disabled ? 'skipped' : 'queued',
      disabled ? 'MAIL_ENABLED=false' : null,
      client,
    );

    if (!id) {
      // The unique index on dedupe_key rejected it. Something already queued
      // this exact message, which is the guard doing its job.
      return { queued: false, reason: 'duplicate' };
    }

    await this.audit.record(
      {
        actorUserId: request.userId ?? null,
        subjectUserId: request.userId ?? null,
        action: disabled ? 'mail.skipped' : 'mail.queued',
        resourceType: 'mail_outbox',
        resourceId: id,
        // The template and the reason, never the recipient or the body: the
        // audit trail is append-only, so an address written into it cannot be
        // taken back out when somebody asks to be erased. The outbox row it
        // points at holds the address, and that row can be deleted.
        metadata: { template: templateId(request.template) },
      },
      client,
    );

    return { queued: !disabled, id, reason: disabled ? 'mail_disabled' : undefined };
  }

  /**
   * Sends what is due, oldest first.
   *
   * Rows are claimed with `for update skip locked`, so two workers — or two
   * replicas — never send the same message twice. Claiming also moves
   * `next_attempt_at` forward, which is what recovers a row from a worker that
   * died mid-send: it stays `sending` until its backoff elapses and is then
   * picked up again, rather than being stranded forever.
   */
  async sendDue(limit = this.env.MAIL_WORKER_BATCH): Promise<SendSummary> {
    if (!this.env.MAIL_ENABLED) return { attempted: 0, sent: 0, failed: 0 };

    const claimed = await this.db.query<OutboxRow>(
      `update notify.mail_outbox o
          set status = 'sending',
              attempt_count = o.attempt_count + 1,
              next_attempt_at = now() + make_interval(secs => $2::double precision)
        from (
          select id from notify.mail_outbox
           where status in ('queued', 'sending')
             and next_attempt_at <= now()
           order by next_attempt_at
           limit $1
           for update skip locked
        ) due
       where o.id = due.id
      returning o.id, o.user_id, o.recipient_email, o.template, o.subject,
                o.attempt_count, o.payload`,
      [limit, backoffSeconds(1)],
    );

    let sent = 0;
    let failed = 0;
    for (const row of claimed) {
      const ok = await this.deliver(row);
      if (ok) sent += 1;
      else failed += 1;
    }

    return { attempted: claimed.length, sent, failed };
  }

  /** One row, start to finish. Never throws: a throw would strand the batch. */
  private async deliver(row: OutboxRow): Promise<boolean> {
    let rendered;
    try {
      rendered = renderMail(
        row.template.replace(/\.v\d+$/, '') as MailTemplateName,
        row.payload as never,
        this.branding,
      );
    } catch (err) {
      // A row whose template no longer exists, or whose stored variables no
      // longer satisfy it. Retrying cannot help.
      await this.settle(row, 'failed', (err as Error).message);
      return false;
    }

    if (this.env.MAIL_DRY_RUN) {
      // The whole path except the network.
      //
      // The link is logged deliberately, and it is the one place a live token
      // reaches a log. Without it there is no way to finish a verification on
      // a machine with no mailbox, which is the entire reason dry run exists.
      // What keeps it out of production is not a convention: MAIL_DRY_RUN is a
      // launch blocker, so a deployment with PUBLIC_LAUNCH set refuses to
      // start while it is on. See config/launch.ts.
      this.logger.log(
        `[dry run] ${row.template} → ${row.recipient_email}\n${rendered.text}`,
      );
      await this.settle(row, 'sent', null);
      await this.recordOutcome(row, 'mail.sent', { dryRun: true });
      return true;
    }

    const result = await this.graph.send({
      to: row.recipient_email,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });

    if (result.accepted) {
      // `sent` means Graph returned 202 and took the message. It is not
      // evidence of delivery, and nothing downstream should read it as such.
      await this.settle(row, 'sent', null, result.messageId ?? null);
      await this.recordOutcome(row, 'mail.sent', {});
      return true;
    }

    const exhausted = row.attempt_count >= this.env.MAIL_MAX_ATTEMPTS;
    const giveUp = !result.transient || exhausted;

    if (giveUp) {
      await this.settle(row, 'failed', result.error ?? 'unknown provider error');
      await this.recordOutcome(row, 'mail.failed', {
        attempts: row.attempt_count,
        permanent: !result.transient,
      });
      this.logger.error(
        `Mail ${row.template} to a recipient gave up after ${row.attempt_count} ` +
          `attempt(s): ${result.error}`,
      );
      return false;
    }

    // Back to the queue. Graph's own Retry-After wins over our backoff when it
    // named one — Microsoft's throttling guidance is that a client waits the
    // period given, and a service that applies its own shorter schedule gets
    // throttled harder.
    const waitMs = result.retryAfterMs ?? backoffSeconds(row.attempt_count) * 1000;
    await this.db.query(
      `update notify.mail_outbox
          set status = 'queued',
              last_error = $2,
              next_attempt_at = now() + make_interval(secs => $3::double precision)
        where id = $1`,
      [row.id, truncate(result.error ?? ''), Math.round(waitMs / 1000)],
    );
    return false;
  }

  /**
   * Puts a row into a terminal state and erases its render variables.
   *
   * The erase is the reason this is one statement rather than two: a live
   * verification token must not survive in the database because a second
   * update failed. See the migration for what `payload` holds.
   */
  private async settle(
    row: OutboxRow,
    status: 'sent' | 'failed',
    error: string | null,
    messageId: string | null = null,
  ): Promise<void> {
    await this.db.query(
      `update notify.mail_outbox
          set status = $2,
              last_error = $3,
              provider_message_id = coalesce($4, provider_message_id),
              sent_at = case when $2 = 'sent' then now() else sent_at end,
              payload = '{}'::jsonb
        where id = $1`,
      [row.id, status, error ? truncate(error) : null, messageId],
    );
  }

  /**
   * Records what became of a message, without failing the worker if it cannot.
   *
   * Best effort deliberately: the message has already left the building, and a
   * failed audit write must not make the worker retry a send that succeeded.
   */
  private async recordOutcome(
    row: OutboxRow,
    action: string,
    extra: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.recordBestEffort({
      actorUserId: null,
      subjectUserId: row.user_id,
      action,
      resourceType: 'mail_outbox',
      resourceId: row.id,
      metadata: { template: row.template, ...extra },
    });
  }

  /**
   * Whether this address has had its share of mail lately.
   *
   * Counted in the outbox rather than in the throttler, so it holds across
   * replicas and restarts with no Redis, and so it bounds mail caused by
   * anything at all rather than per endpoint. The endpoint limits sit in front
   * of it; this is the backstop that stops a stranger's inbox being used as
   * the weapon.
   *
   * `skipped` rows do not count. They are the record of a refusal, and letting
   * them count would mean the first refusal extended the window for the next.
   */
  private async recipientOverLimit(email: string, client?: PoolClient): Promise<boolean> {
    const sql = `select count(*)::int as n
                   from notify.mail_outbox
                  where lower(recipient_email) = lower($1)
                    and status <> 'skipped'
                    and created_at > now() - make_interval(secs => $2::double precision)`;
    const params = [email, this.env.MAIL_PER_RECIPIENT_WINDOW_S];

    const rows = client
      ? (await client.query<{ n: number }>(sql, params)).rows
      : await this.db.query<{ n: number }>(sql, params);

    return (rows[0]?.n ?? 0) >= this.env.MAIL_PER_RECIPIENT_LIMIT;
  }

  private async insert<T extends MailTemplateName>(
    request: QueueRequest<T>,
    subject: string,
    status: 'queued' | 'skipped',
    error: string | null,
    client?: PoolClient,
  ): Promise<string | null> {
    const sql = `insert into notify.mail_outbox
                   (user_id, recipient_email, template, subject, status, last_error,
                    dedupe_key, metadata, payload)
                 values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 on conflict (dedupe_key) where dedupe_key is not null do nothing
                 returning id`;
    const params = [
      request.userId ?? null,
      request.to,
      templateId(request.template),
      subject,
      status,
      error,
      request.dedupeKey ?? null,
      JSON.stringify(request.metadata ?? {}),
      // A skipped row is never sent, so it has no reason to hold a token.
      JSON.stringify(status === 'queued' ? request.vars : {}),
    ];

    const rows = client
      ? (await client.query<{ id: string }>(sql, params)).rows
      : await this.db.query<{ id: string }>(sql, params);

    return rows[0]?.id ?? null;
  }
}

export interface QueueRequest<T extends MailTemplateName> {
  template: T;
  to: string;
  /** Null for somebody with no account. */
  userId: string | null;
  vars: MailTemplateVars[T];
  /**
   * What makes this message the same as another one.
   *
   * Unique in the database, so the guard is not a service remembering to
   * check. Must not contain a secret: it is retained for the life of the row.
   */
  dedupeKey?: string;
  /** Safe context for the runbook. Never a health field, never a secret. */
  metadata?: Record<string, unknown>;
}

export interface QueueOutcome {
  queued: boolean;
  id?: string;
  reason?: 'duplicate' | 'rate_limited' | 'mail_disabled';
}

export interface SendSummary {
  attempted: number;
  sent: number;
  failed: number;
}

interface OutboxRow {
  id: string;
  user_id: string | null;
  recipient_email: string;
  template: string;
  subject: string;
  attempt_count: number;
  payload: Record<string, unknown>;
}

/**
 * How long to wait before attempt n+1.
 *
 * Doubling from 30 seconds and capped at ten minutes. The cap matters more
 * than the curve: these are verification and reset emails, and somebody is
 * sitting in front of a "check your email" screen while this backs off.
 */
function backoffSeconds(attempt: number): number {
  return Math.min(30 * 2 ** Math.max(0, attempt - 1), 600);
}

function truncate(value: string, max = 500): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
