import { Injectable } from '@nestjs/common';
import type { CreateLabResultInput, LabListQuery, LabResult } from '@wellovue/types';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';

/**
 * Lab and body measurements: HbA1c, fasting glucose, weight, BMI, and anything
 * else a printout carries.
 *
 * One table for all of them, which looks like a shortcut and is not. A lab
 * result is a named measurement with a value, a unit and a collection time,
 * and weight fits that shape exactly. Splitting body metrics into their own
 * table would have produced two schemas, two write paths and two loaders for
 * one idea, and a trend detector that had to know which was which.
 *
 * Values are stored as entered. A reading that arrived in mg/dL stays in
 * mg/dL with its unit beside it, because a converted number that later turns
 * out to have been converted wrongly cannot be recovered, and a lab printout
 * is evidence someone may need to reproduce.
 */
@Injectable()
export class LabsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async create(userId: string, input: CreateLabResultInput): Promise<LabResult> {
    return this.db.transaction(async (client) => {
      const { rows } = await client.query<LabRow>(
        `insert into clinical.lab_results
           (user_id, test_name, code_system, code, value_numeric, value_text,
            unit, reference_range, collected_at, source)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         returning *`,
        [
          userId,
          input.testName,
          input.codeSystem ?? null,
          input.code ?? null,
          input.valueNumeric ?? null,
          input.valueText ?? null,
          input.unit ?? null,
          input.referenceRange ?? null,
          input.collectedAt,
          input.source,
        ],
      );
      const row = rows[0];

      // Same transaction as the write it describes. A lab result is health
      // data, and an unrecorded touch of health data is worse than a failed
      // request because it leaves no trace that the access happened.
      await this.audit.record(
        {
          actorUserId: userId,
          subjectUserId: userId,
          action: 'lab.create',
          resourceType: 'lab_result',
          resourceId: row.id,
          // The test name, never the value. The audit table is append-only, so
          // anything written there can never be removed.
          metadata: { testName: input.testName },
        },
        client,
      );

      return toLabResult(row);
    });
  }

  async list(userId: string, query: LabListQuery): Promise<LabResult[]> {
    const rows = await this.db.query<LabRow>(
      `select * from clinical.lab_results
        where user_id = $1
          and collected_at between $2 and $3
          and ($4::text is null or test_name = $4::text)
        order by collected_at desc`,
      [userId, query.from, query.to, query.testName ?? null],
    );
    return rows.map(toLabResult);
  }
}

interface LabRow {
  id: string;
  user_id: string;
  test_name: string;
  code_system: string | null;
  code: string | null;
  value_numeric: string | null;
  value_text: string | null;
  unit: string | null;
  reference_range: string | null;
  collected_at: Date;
  source: LabResult['source'];
  created_at: Date;
}

function toLabResult(row: LabRow): LabResult {
  return {
    id: row.id,
    userId: row.user_id,
    testName: row.test_name,
    codeSystem: row.code_system,
    code: row.code,
    // numeric arrives from pg as a string, because a float would lose precision
    // the column was chosen to keep.
    valueNumeric: row.value_numeric === null ? null : Number(row.value_numeric),
    valueText: row.value_text,
    unit: row.unit,
    referenceRange: row.reference_range,
    collectedAt: row.collected_at,
    source: row.source,
    createdAt: row.created_at,
  };
}
