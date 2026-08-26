import { z } from 'zod';
import { confidenceSchema, dataSourceSchema, uuidSchema } from './common';

/**
 * The metabolic timeline is the product's central primitive: one ordered
 * stream of everything that happened, each entry carrying where it came from
 * and how much the platform trusts it.
 */
export const timelineEventTypeSchema = z.enum([
  'glucose_sample',
  'meal_started',
  'meal_ended',
  'medication_taken',
  'exercise_started',
  'exercise_ended',
  'sleep_started',
  'sleep_ended',
  'stress_reported',
  'symptom_reported',
  'lab_collected',
  'appointment',
]);
export type TimelineEventType = z.infer<typeof timelineEventTypeSchema>;

export const createTimelineEventSchema = z.object({
  occurredAt: z.coerce.date(),
  eventType: timelineEventTypeSchema,
  source: dataSourceSchema.default('manual'),
  confidence: confidenceSchema.default(1.0),
  payload: z.record(z.unknown()).default({}),
});
export type CreateTimelineEventInput = z.infer<typeof createTimelineEventSchema>;

export const timelineEventSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  occurredAt: z.coerce.date(),
  eventType: timelineEventTypeSchema,
  source: dataSourceSchema,
  confidence: confidenceSchema,
  payload: z.record(z.unknown()),
  createdAt: z.coerce.date(),
});
export type TimelineEvent = z.infer<typeof timelineEventSchema>;

export const timelineQuerySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  eventTypes: z.array(timelineEventTypeSchema).optional(),
  limit: z.coerce.number().int().min(1).max(2000).default(500),
});
export type TimelineQuery = z.infer<typeof timelineQuerySchema>;

/**
 * What arrives on the wire: `from` and `to` are optional and default to the
 * last seven days, and `eventTypes` may be a single value or a repeated one.
 *
 * Defaults belong here rather than in the controller so one pipe validates the
 * whole query — nothing is parsed by hand, so bad input is always a 400.
 */
export const timelineQueryInputSchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    eventTypes: z
      .union([timelineEventTypeSchema, z.array(timelineEventTypeSchema)])
      .optional()
      .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v])),
    limit: z.coerce.number().int().min(1).max(2000).default(500),
  })
  .transform((v) => {
    const to = v.to ?? new Date();
    return {
      to,
      from: v.from ?? new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000),
      eventTypes: v.eventTypes,
      limit: v.limit,
    };
  })
  .refine((v) => v.to > v.from, { message: '`from` must be before `to`' });
export type TimelineQueryInput = z.infer<typeof timelineQueryInputSchema>;

/**
 * A timeline entry as the UI consumes it: the raw event plus the display
 * metadata the interface needs to show provenance honestly.
 */
export const timelineEntrySchema = timelineEventSchema.extend({
  label: z.string(),
  /** True when `confidence` < 1 or the source is `inferred`. */
  isInferred: z.boolean(),
});
export type TimelineEntry = z.infer<typeof timelineEntrySchema>;
