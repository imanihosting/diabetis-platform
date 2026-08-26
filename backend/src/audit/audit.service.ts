import { Injectable, Logger } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';

export interface AuditEntry {
  /** Who performed the action. Null for system/background jobs. */
  actorUserId: string | null;
  /** Whose health data was touched. */
  subjectUserId: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Append-only access trail. `audit.events` has a database trigger that rejects
 * UPDATE and DELETE, so the trail cannot be rewritten even by the app role.
 *
 * Pass a transaction client whenever the audit entry must succeed or fail
 * together with the write it describes.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly db: DatabaseService) {}

  async record(entry: AuditEntry, client?: PoolClient): Promise<void> {
    const sql = `
      insert into audit.events
        (actor_user_id, subject_user_id, action, resource_type, resource_id, metadata)
      values ($1, $2, $3, $4, $5, $6)
    `;
    const params = [
      entry.actorUserId,
      entry.subjectUserId,
      entry.action,
      entry.resourceType,
      entry.resourceId ?? null,
      JSON.stringify(entry.metadata ?? {}),
    ];

    if (client) {
      await client.query(sql, params);
      return;
    }

    // Outside a transaction an audit failure must not take the request down,
    // but it must be visible in the logs.
    try {
      await this.db.query(sql, params);
    } catch (err) {
      this.logger.error(
        `Failed to write audit entry ${entry.action}: ${(err as Error).message}`,
      );
    }
  }

  async listForSubject(subjectUserId: string, limit = 100) {
    return this.db.query(
      `select id, actor_user_id, subject_user_id, action, resource_type,
              resource_id, metadata, occurred_at
         from audit.events
        where subject_user_id = $1
        order by occurred_at desc
        limit $2`,
      [subjectUserId, limit],
    );
  }
}
