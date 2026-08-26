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

  /**
   * Writes an audit entry, throwing if it cannot.
   *
   * Failing loudly is deliberate: an unrecorded touch of health data is worse
   * than a failed request, because it leaves no trace that the access
   * happened. Pass the transaction client whenever this describes a write, so
   * the record and its audit entry commit or roll back together.
   */
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

    await this.db.query(sql, params);
  }

  /**
   * Records an entry without failing the caller if the write does not land.
   *
   * Deliberately separate and deliberately verbose: swallowing an audit
   * failure should be a decision someone made on purpose and can grep for,
   * never the default a caller gets by forgetting to pass a client. Use only
   * where the audited action has already completed irreversibly and failing
   * the request would misrepresent what happened.
   */
  async recordBestEffort(entry: AuditEntry): Promise<void> {
    try {
      await this.record(entry);
    } catch (err) {
      this.logger.error(
        `Audit entry ${entry.action} was not recorded: ${(err as Error).message}`,
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
