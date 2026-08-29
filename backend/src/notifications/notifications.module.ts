import { Global, Module } from '@nestjs/common';
import { GraphMailClient } from './graph-mail.client';
import { MailService } from './mail.service';
import { MailWorker } from './mail.worker';

/**
 * The one way mail leaves this platform.
 *
 * Global because the modules that need it — auth today, others later — should
 * not each have to import it, and because there must be exactly one worker.
 * Two instances would be two timers claiming from the same table; the database
 * would keep them honest, but there is no reason to have them.
 */
@Global()
@Module({
  providers: [GraphMailClient, MailService, MailWorker],
  exports: [MailService, GraphMailClient],
})
export class NotificationsModule {}
