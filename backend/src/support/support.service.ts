import { Injectable } from '@nestjs/common';
import type { ContactMessageInput, ContactMessageResult } from '@wellovue/types';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class SupportService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Stores an inbound message from the contact page.
   *
   * `userId` is attached when the sender is signed in, so a reply can be tied
   * to an account without asking them to prove who they are again.
   *
   * The message body never reaches the audit trail. People write more than
   * they mean to in a free-text box on a health site, and the audit table is
   * append-only: anything landing there cannot be taken back out.
   */
  async submit(
    input: ContactMessageInput,
    userId: string | null,
  ): Promise<ContactMessageResult> {
    await this.db.transaction(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into support.contact_messages (name, email, topic, message, user_id)
         values ($1, $2, $3, $4, $5)
         returning id`,
        [input.name ?? null, input.email, input.topic, input.message, userId],
      );

      await this.audit.record(
        {
          actorUserId: userId,
          subjectUserId: userId,
          action: 'support.contact',
          resourceType: 'contact_message',
          resourceId: rows[0].id,
          metadata: { topic: input.topic, length: input.message.length },
        },
        client,
      );
    });

    return { received: true };
  }
}
