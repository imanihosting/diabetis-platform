import { Injectable } from '@nestjs/common';
import type {
  CreateTimelineEventInput,
  TimelineEntry,
  TimelineQuery,
} from '@wellovue/types';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';

/**
 * The metabolic timeline.
 *
 * Glucose samples live in a hypertable for density; everything else lives in
 * `metabolic.events`. The timeline reads both and merges them into one ordered
 * stream, because to the user there is only one story.
 */
@Injectable()
export class TimelineService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async addEvent(userId: string, input: CreateTimelineEventInput) {
    return this.db.transaction(async (client) => {
      const { rows } = await client.query<EventRow>(
        `insert into metabolic.events
           (user_id, occurred_at, event_type, source, confidence, payload)
         values ($1, $2, $3, $4, $5, $6)
         returning *`,
        [
          userId,
          input.occurredAt,
          input.eventType,
          input.source,
          input.confidence,
          JSON.stringify(input.payload),
        ],
      );
      const row = rows[0];

      await this.audit.record(
        {
          actorUserId: userId,
          subjectUserId: userId,
          action: 'timeline.event.create',
          resourceType: 'timeline_event',
          resourceId: row.id,
          metadata: { eventType: input.eventType },
        },
        client,
      );

      return toEntry(row);
    });
  }

  async query(userId: string, params: TimelineQuery): Promise<TimelineEntry[]> {
    const events = await this.db.query<EventRow>(
      `select * from metabolic.events
        where user_id = $1
          and occurred_at between $2 and $3
          and ($4::text[] is null or event_type = any($4::text[]))
        order by occurred_at desc
        limit $5`,
      [
        userId,
        params.from,
        params.to,
        params.eventTypes && params.eventTypes.length > 0 ? params.eventTypes : null,
        params.limit,
      ],
    );

    const entries = events.map(toEntry);

    // Glucose lives in the hypertable, not in `events`. Merge it in unless the
    // caller explicitly asked for other event types only.
    const wantsGlucose =
      !params.eventTypes || params.eventTypes.includes('glucose_sample');

    if (wantsGlucose) {
      const samples = await this.db.query<GlucoseRow>(
        `select measured_at, glucose_value, unit, trend, source
           from metabolic.glucose_samples
          where user_id = $1 and measured_at between $2 and $3
          order by measured_at desc
          limit $4`,
        [userId, params.from, params.to, params.limit],
      );

      for (const s of samples) {
        entries.push({
          // Glucose samples are keyed by (user, time, source), not by a uuid.
          // The synthetic id is stable for the same reading.
          id: syntheticId(userId, s.measured_at, s.source),
          userId,
          occurredAt: s.measured_at,
          eventType: 'glucose_sample',
          source: s.source,
          confidence: 1,
          payload: {
            value: Number(s.glucose_value),
            unit: s.unit,
            trend: s.trend,
          },
          createdAt: s.measured_at,
          label: `Glucose ${Number(s.glucose_value)} ${s.unit}`,
          isInferred: false,
        });
      }
    }

    return entries
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
      .slice(0, params.limit);
  }
}

interface EventRow {
  id: string;
  user_id: string;
  occurred_at: Date;
  event_type: TimelineEntry['eventType'];
  source: TimelineEntry['source'];
  confidence: string;
  payload: Record<string, unknown>;
  created_at: Date;
}

interface GlucoseRow {
  measured_at: Date;
  glucose_value: string;
  unit: string;
  trend: string | null;
  source: TimelineEntry['source'];
}

function toEntry(row: EventRow): TimelineEntry {
  const confidence = Number(row.confidence);
  return {
    id: row.id,
    userId: row.user_id,
    occurredAt: row.occurred_at,
    eventType: row.event_type,
    source: row.source,
    confidence,
    payload: row.payload,
    createdAt: row.created_at,
    label: labelFor(row),
    // Surfaced so the UI can mark anything the platform did not directly
    // observe. Provenance is a first-class part of the interface.
    isInferred: confidence < 1 || row.source === 'inferred',
  };
}

function labelFor(row: EventRow): string {
  const payload = row.payload as Record<string, unknown>;
  switch (row.event_type) {
    case 'meal_started':
      return (payload.description as string) ?? 'Meal';
    case 'medication_taken':
      return 'Medication taken';
    case 'exercise_started':
      return 'Activity started';
    case 'sleep_started':
      return 'Sleep started';
    case 'stress_reported':
      return 'Stress reported';
    case 'symptom_reported':
      return (payload.symptom as string) ?? 'Symptom reported';
    case 'lab_collected':
      return (payload.testName as string) ?? 'Lab collected';
    default:
      return row.event_type.replace(/_/g, ' ');
  }
}

function syntheticId(userId: string, measuredAt: Date, source: string): string {
  return `glucose:${userId}:${measuredAt.toISOString()}:${source}`;
}
