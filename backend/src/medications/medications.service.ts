import { Injectable } from '@nestjs/common';
import type {
  CreateMedicationRecordInput,
  MedicationRecord,
} from '@diabetes/types';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';

/**
 * Medication *records* only.
 *
 * This service records what a person reports taking. It never proposes,
 * adjusts, or discontinues a medication — those are clinician-gated
 * workflows by design (see docs/technical-architecture.md).
 */
@Injectable()
export class MedicationsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async create(
    userId: string,
    input: CreateMedicationRecordInput,
  ): Promise<MedicationRecord> {
    const row = await this.db.queryOne<MedicationRow>(
      `insert into clinical.medication_records
         (user_id, medication_name, dose_text, route, frequency_text,
          started_on, ended_on, status, source)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning *`,
      [
        userId,
        input.medicationName,
        input.doseText ?? null,
        input.route ?? null,
        input.frequencyText ?? null,
        input.startedOn ?? null,
        input.endedOn ?? null,
        input.status,
        input.source,
      ],
    );

    await this.audit.record({
      actorUserId: userId,
      subjectUserId: userId,
      action: 'medication.create',
      resourceType: 'medication_record',
      resourceId: row!.id,
      metadata: { medicationName: input.medicationName },
    });

    return toMedication(row!);
  }

  async list(userId: string): Promise<MedicationRecord[]> {
    const rows = await this.db.query<MedicationRow>(
      `select * from clinical.medication_records
        where user_id = $1
        order by coalesce(started_on, created_at::date) desc`,
      [userId],
    );
    return rows.map(toMedication);
  }

  /** Records that a dose was taken, as a timeline event. */
  async recordTaken(
    userId: string,
    medicationRecordId: string,
    takenAt: Date,
  ): Promise<void> {
    await this.db.query(
      `insert into metabolic.events
         (user_id, occurred_at, event_type, source, confidence, payload)
       values ($1, $2, 'medication_taken', 'manual', 1.0, $3)`,
      [userId, takenAt, JSON.stringify({ medicationRecordId })],
    );

    await this.audit.record({
      actorUserId: userId,
      subjectUserId: userId,
      action: 'medication.taken',
      resourceType: 'medication_record',
      resourceId: medicationRecordId,
    });
  }
}

interface MedicationRow {
  id: string;
  user_id: string;
  medication_name: string;
  dose_text: string | null;
  route: string | null;
  frequency_text: string | null;
  started_on: Date | null;
  ended_on: Date | null;
  status: MedicationRecord['status'];
  source: MedicationRecord['source'];
  created_at: Date;
}

function toMedication(row: MedicationRow): MedicationRecord {
  return {
    id: row.id,
    userId: row.user_id,
    medicationName: row.medication_name,
    doseText: row.dose_text,
    route: row.route,
    frequencyText: row.frequency_text,
    startedOn: row.started_on,
    endedOn: row.ended_on,
    status: row.status,
    source: row.source,
    createdAt: row.created_at,
  };
}
