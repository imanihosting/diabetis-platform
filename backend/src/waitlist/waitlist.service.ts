import { Injectable } from '@nestjs/common';
import type { WaitlistSignupInput, WaitlistSignupResult } from '@diabetes/types';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class WaitlistService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Records an address, or quietly accepts one already present.
   *
   * The response never distinguishes a new signup from a repeat, so this
   * endpoint cannot be used to test whether a given person is on the list.
   * It is public and unauthenticated, so that matters.
   */
  async signUp(input: WaitlistSignupInput): Promise<WaitlistSignupResult> {
    await this.db.transaction(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into identity.waitlist_signups (email, source)
         values ($1, 'landing')
         on conflict do nothing
         returning id`,
        [input.email],
      );

      // Only audit a genuinely new row: repeats would otherwise let anyone
      // pad the audit trail from an unauthenticated endpoint.
      if (rows[0]) {
        await this.audit.record(
          {
            actorUserId: null,
            subjectUserId: null,
            action: 'waitlist.signup',
            resourceType: 'waitlist_signup',
            resourceId: rows[0].id,
            // The address is the record; it is not repeated into the metadata.
            metadata: { source: 'landing' },
          },
          client,
        );
      }
    });

    return { subscribed: true };
  }
}
