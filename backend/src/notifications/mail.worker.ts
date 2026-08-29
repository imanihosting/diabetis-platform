import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { MailService } from './mail.service';

/**
 * Drains the outbox on a timer.
 *
 * Deliberately a timer and not a Redis queue, for now. The volume is one
 * message per account event: a queue with its own broker, its own failure
 * modes and its own operational surface would be more machinery than the
 * problem has. What matters — that a send is retried, that two replicas do not
 * send the same row twice, that a crashed worker's row is not stranded — is
 * handled in the database by `for update skip locked` and `next_attempt_at`,
 * which is where it has to be handled anyway once there is more than one
 * process.
 *
 * The pass is serialised against itself: a slow Graph call must not have a
 * second timer firing on top of the first, or the batch size stops meaning
 * anything.
 */
@Injectable()
export class MailWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly mail: MailService,
  ) {}

  onModuleInit(): void {
    if (!this.env.MAIL_ENABLED) {
      // Said once, at boot, rather than never. A deployment where nobody can
      // receive a verification email should not be a thing you discover from a
      // support ticket.
      this.logger.warn(
        'MAIL_ENABLED is false: mail is queued and marked skipped, never sent.',
      );
      return;
    }

    this.timer = setInterval(() => {
      void this.pass();
    }, this.env.MAIL_WORKER_INTERVAL_MS);

    // Does not hold the process open. A backend that cannot shut down because
    // an idle mail timer is pending is a deployment that hangs on restart.
    this.timer.unref();

    this.logger.log(
      `Mail worker started (every ${this.env.MAIL_WORKER_INTERVAL_MS}ms` +
        `${this.env.MAIL_DRY_RUN ? ', dry run' : ''})`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass. Exposed so a test can drive the worker without waiting. */
  async pass(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const summary = await this.mail.sendDue();
      if (summary.attempted > 0) {
        this.logger.log(
          `Mail pass: ${summary.sent} accepted, ${summary.failed} not, ` +
            `of ${summary.attempted} attempted`,
        );
      }
    } catch (err) {
      // The timer must survive anything a pass can do to itself. A database
      // blip should cost one pass, not the worker.
      this.logger.error(`Mail pass failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
