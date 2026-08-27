import { Injectable } from '@nestjs/common';
import type {
  CreateGlucoseSampleInput,
  GlucoseImportResult,
  GlucoseSummary,
  GlucoseUnit,
  ImportGlucoseInput,
} from '@wellovue/types';
import { glucoseZone, toMgDl, toMmolL } from '@wellovue/types';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';

/**
 * Standard adult Type 2 target range, in mmol/L.
 * Used only to describe data, never to advise. Per-user targets belong to
 * the clinician and will replace these constants when that workflow exists.
 */

/** Below this, a summary is described as provisional rather than representative. */
const MIN_SAMPLES_FOR_SUMMARY = 14;

@Injectable()
export class GlucoseService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async create(userId: string, input: CreateGlucoseSampleInput) {
    // The reading and its audit entry commit together: a stored measurement
    // with no record of who added it is not an acceptable outcome.
    return this.db.transaction(async (client) => {
      const { rows } = await client.query(
        `insert into metabolic.glucose_samples
           (user_id, measured_at, glucose_value, unit, trend, source, device_id, quality)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (user_id, measured_at, source) do nothing
         returning user_id, measured_at, glucose_value, unit, trend, source, inserted_at`,
        [
          userId,
          input.measuredAt,
          input.value,
          input.unit,
          input.trend ?? null,
          input.source,
          input.deviceId ?? null,
          input.quality ?? null,
        ],
      );

      await this.audit.record(
        {
          actorUserId: userId,
          subjectUserId: userId,
          action: 'glucose.create',
          resourceType: 'glucose_sample',
          metadata: { measuredAt: input.measuredAt, source: input.source },
        },
        client,
      );

      return rows[0] ?? null;
    });
  }

  /**
   * Bulk import from a CGM or meter export.
   *
   * Duplicates on (user, time, source) are skipped rather than overwritten:
   * re-importing an overlapping export must never silently change history.
   */
  async import(
    userId: string,
    input: ImportGlucoseInput,
  ): Promise<GlucoseImportResult> {
    const rejected: GlucoseImportResult['rejected'] = [];
    let imported = 0;

    await this.db.transaction(async (client) => {
      for (const [index, sample] of input.samples.entries()) {
        try {
          const { rowCount } = await client.query(
            `insert into metabolic.glucose_samples
               (user_id, measured_at, glucose_value, unit, trend, source, device_id, quality)
             values ($1, $2, $3, $4, $5, $6, $7, $8)
             on conflict (user_id, measured_at, source) do nothing`,
            [
              userId,
              sample.measuredAt,
              sample.value,
              sample.unit,
              sample.trend ?? null,
              sample.source ?? input.source,
              sample.deviceId ?? null,
              sample.quality ?? null,
            ],
          );
          if (rowCount && rowCount > 0) imported += 1;
        } catch (err) {
          rejected.push({ index, reason: (err as Error).message });
        }
      }

      await this.audit.record(
        {
          actorUserId: userId,
          subjectUserId: userId,
          action: 'glucose.import',
          resourceType: 'glucose_sample',
          metadata: {
            source: input.source,
            received: input.samples.length,
            imported,
          },
        },
        client,
      );
    });

    return {
      received: input.samples.length,
      imported,
      duplicates: input.samples.length - imported - rejected.length,
      rejected,
    };
  }

  async list(userId: string, from: Date, to: Date, limit = 1000) {
    return this.db.query(
      `select measured_at, glucose_value, unit, trend, source, quality
         from metabolic.glucose_samples
        where user_id = $1 and measured_at between $2 and $3
        order by measured_at desc
        limit $4`,
      [userId, from, to, limit],
    );
  }

  /**
   * Descriptive statistics only. Everything is normalised to mmol/L internally
   * so mixed-unit data (a meter in mg/dL, a CGM in mmol/L) cannot corrupt
   * the aggregate, then converted once to the requested display unit.
   */
  async summary(
    userId: string,
    from: Date,
    to: Date,
    unit: GlucoseUnit = 'mmol/L',
  ): Promise<GlucoseSummary> {
    const rows = await this.db.query<{ glucose_value: string; unit: GlucoseUnit }>(
      `select glucose_value, unit
         from metabolic.glucose_samples
        where user_id = $1 and measured_at between $2 and $3`,
      [userId, from, to],
    );

    const values = rows.map((r) => toMmolL(Number(r.glucose_value), r.unit));
    const sampleCount = values.length;

    if (sampleCount === 0) {
      return {
        from,
        to,
        unit,
        sampleCount: 0,
        mean: null,
        min: null,
        max: null,
        timeInRange: null,
        timeAboveRange: null,
        timeBelowRange: null,
        dataSufficient: false,
      };
    }

    // Classified by the shared contract rather than by three comparisons
    // written here. This figure is the one a clinician is most likely to read
    // out of the product, so it must agree with the band the charts draw and
    // with the threshold the engine flags mornings against.
    const zones = values.map(glucoseZone);
    const inRange = zones.filter((z) => z === 'in').length;
    const above = zones.filter((z) => z === 'above').length;
    const below = zones.filter((z) => z === 'below').length;

    const display = (mmol: number) =>
      unit === 'mmol/L' ? round(mmol, 1) : round(toMgDl(mmol, 'mmol/L'), 0);

    return {
      from,
      to,
      unit,
      sampleCount,
      mean: display(values.reduce((a, b) => a + b, 0) / sampleCount),
      min: display(Math.min(...values)),
      max: display(Math.max(...values)),
      timeInRange: inRange / sampleCount,
      timeAboveRange: above / sampleCount,
      timeBelowRange: below / sampleCount,
      dataSufficient: sampleCount >= MIN_SAMPLES_FOR_SUMMARY,
    };
  }
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
