import { z } from 'zod';
import { confidenceSchema, uuidSchema } from './common';
import { careModeSchema, safetyFlagSchema } from './diabetes';
import { experimentSchema } from './experiments';

/**
 * The contract between the quantitative engine and everything downstream.
 *
 * A finding is produced by a model, never by a language model. An LLM may
 * only phrase an existing finding — it must not create one. See
 * docs/technical-architecture.md, "Metabolic Intelligence Service".
 */
/**
 * One group a finding compared, in glucose a reader would recognise.
 *
 * Absolute mmol/L rather than a rise, because a rise of 3.1 says nothing about
 * whether the person ended up in range and 6.0 rising to 9.1 says it exactly.
 * That is what lets a finding be drawn against the target band instead of
 * printed as a sentence with a number in it.
 *
 * `baselineMmol` is null for a level rather than a movement — morning glucose
 * has nowhere to rise from — and a chart draws one mark instead of a curve.
 */
export const curvePointSchema = z.object({
  /** Minutes since the meal. Zero is the baseline reading. */
  minutes: z.number().int(),
  mmol: z.number(),
});
export type CurvePoint = z.infer<typeof curvePointSchema>;

/**
 * A group's post-meal response, measured in diabetes rather than in statistics.
 *
 * Mirrors `PostMealMetrics` in `metabolic-engine/app/models/findings.py`. These
 * two are the same contract in two languages and must be changed together.
 *
 * Every field is a quantity somebody with diabetes already uses to describe a
 * meal. "A 3.1 mmol/L rise" is a statistic about two readings; peaking at 11.2
 * an hour after eating and taking another hour to come back down is the same
 * meal, said in the language of the condition.
 *
 * The engine measures these on each meal's own curve and then averages, never
 * off the group's mean curve. Peaks land at different times, so averaging the
 * curves first flattens them, and a group whose meals routinely reached 11
 * could otherwise be reported as never leaving target range.
 *
 * `peakMmol` is not repeated here — it is on the group already, and one card
 * showing two peaks counted over slightly different meals is worse than one.
 */
export const postMealMetricsSchema = z.object({
  /**
   * Meals watched long enough for their timings to mean anything.
   *
   * Often smaller than the group's `n`: a meal with a reading twenty minutes
   * after it belongs in the rise average and has nothing to say about when
   * glucose came back. Shown rather than hidden, so a reader comparing this
   * against `n` on the group knows which meals these numbers came from.
   */
  n: z.number().int().min(0),
  /** Mean minutes from the meal to the highest reading after it. */
  timeToPeakMinutes: z.number(),
  /** Mean minutes above the top of target range. Zero is a real answer, and a good one. */
  minutesAboveRange: z.number(),
  /**
   * Mean minutes until glucose was back at or below target, over the meals
   * that came back at all.
   *
   * Null has two meanings, and the other fields separate them: with
   * `minutesAboveRange` at zero nothing went above target and there was nothing
   * to return from; with it above zero, no meal came back before the window
   * ended, and `stillAboveAtWindowEnd` counts them.
   */
  returnToRangeMinutes: z.number().nullable().default(null),
  /** Mean mmol/L x minutes above target: how far above and for how long, together. */
  areaAboveRange: z.number(),
  /** Meals whose last reading in the window was still above target. */
  stillAboveAtWindowEnd: z.number().int().min(0),
  /**
   * One word for the response, from thresholds in the engine.
   *
   * A string rather than an enum on purpose. A shape the engine adds tomorrow
   * must not fail contract validation and take the whole evidence response
   * down with it; `postMealShapeLabel` falls back instead.
   */
  shape: z.string().min(1),
});
export type PostMealMetrics = z.infer<typeof postMealMetricsSchema>;

export interface PostMealShape {
  /** The word itself, as a reader meets it. */
  label: string;
  /** What that word means, in a clause that sits under the measurements. */
  description: string;
}

/**
 * What the engine's shape word says, in a reader's language.
 *
 * A display name for an enum, in the same category as `findingPresentation`
 * and `careModeLabel`. It restates a label the engine already computed from
 * thresholds it already documents; it must never be where a new claim about
 * somebody's glucose is introduced.
 *
 * None of these descriptions names a number. The thresholds live in the
 * engine's `thresholds.py`, and a sentence here saying "an hour or more" would
 * be a second copy of one — wrong the day it moves, and wrong on a surface
 * that has the real figure printed two lines above it.
 *
 * An unrecognised word falls back to itself rather than disappearing, for the
 * same reason `findingPresentation` does: a shape shipped without an entry
 * here should look unfinished to whoever ships it, and never look like an
 * error to a reader.
 */
const POST_MEAL_SHAPES: Record<string, PostMealShape> = {
  flat: { label: 'Flat', description: 'barely moved from where it started' },
  sharp: { label: 'Sharp', description: 'climbed and peaked quickly' },
  delayed: { label: 'Delayed', description: 'peaked late in the two hours' },
  prolonged: {
    label: 'Prolonged',
    description: 'spent a long stretch above target range',
  },
  // The residual, and named for what was measured rather than for a verdict.
  // "Typical" was the first attempt and it was wrong: it read as a reassurance
  // the engine has no basis for, and two groups spending 56 and 11 minutes
  // above target both landed in it.
  rose_and_returned: {
    label: 'Rose and returned',
    description: 'peaked in the middle of the window and came back down',
  },
};

/**
 * Every shape this map can name. Used to prove none of the engine's is missing.
 *
 * The same job `proposableTemplates()` does for experiment templates: the
 * fallback in `postMealShapeLabel` means a word with no entry here reaches a
 * reader looking almost right, so completeness has to be asserted somewhere
 * rather than noticed.
 */
/**
 * The post-meal window the engine measures over, in minutes.
 *
 * A third copy of a number that lives in `metabolic-engine/app/engines/
 * thresholds.py`, for the same reason `TARGET_HIGH_MMOL` is: Python cannot
 * import TypeScript. It is here because the phrase "still above at two hours"
 * is a restatement of this constant, and a surface that hard-codes the words
 * while the engine changes the window is a surface that lies.
 *
 * `backend/test/post-meal-metrics.spec.ts` reads thresholds.py and fails if the
 * two disagree, which is the only kind of "keep in sync" worth writing down.
 */
export const POST_MEAL_WINDOW_MINUTES = 120;

const SMALL_NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six'];

/**
 * How long the window is, in words or in figures.
 *
 * Two forms because the same fact appears in two registers. A table cell is a
 * measurement and takes a numeral — "Still above at 2 hours" — while a
 * sentence takes the word, because the rest of this site's prose writes small
 * numbers out and "the 2 hours ended" reads like a log line in the middle of
 * one.
 */
export function postMealWindowLabel(style: 'figures' | 'words' = 'figures'): string {
  const hours = POST_MEAL_WINDOW_MINUTES / 60;
  if (!Number.isInteger(hours)) return `${POST_MEAL_WINDOW_MINUTES} minutes`;

  const count =
    style === 'words' && hours < SMALL_NUMBERS.length ? SMALL_NUMBERS[hours] : String(hours);
  return hours === 1 ? `${count} hour` : `${count} hours`;
}

/**
 * One measured row of a post-meal response, ready to put on a surface.
 *
 * `measure` says whether the value is a figure. The tabular face is for
 * numbers everywhere in this product — it is what makes a column of them line
 * up — and a word set in it reads as a code rather than as English.
 */
export interface Measurement {
  key: string;
  label: string;
  value: string;
  unit: string | null;
  measure: boolean;
}

/** The post-meal rows are `Measurement`s; so are the data-quality rows. */
export type PostMealMeasurement = Measurement;

/**
 * A group's post-meal response as labelled rows, or null when it has none.
 *
 * Shared because two surfaces show these numbers — the evidence page a person
 * reads and the packet their clinician reads — and they must not describe the
 * same measurement in different words. A clinician being handed "excursion
 * above target" while the person quotes "area above range" from their own
 * screen turns one number into an argument about two.
 *
 * Labels only. Every value here is a restatement of a field the engine already
 * computed, in the same category as `findingPresentation` and
 * `postMealShapeLabel`: nothing is derived, nothing is judged, and this must
 * never be where a claim about somebody's glucose is introduced.
 *
 * Peak and rise are deliberately absent. They are already in the engine's own
 * summary sentence and in the chart legend, and a card that states a peak three
 * times has not said it more clearly.
 */
export function postMealMeasurements(
  group: Pick<GroupMeasure, 'n' | 'postMeal'>,
): PostMealMeasurement[] | null {
  const m = group.postMeal;
  if (!m) return null;

  return [
    {
      key: 'timeToPeak',
      label: 'Time to peak',
      value: String(Math.round(m.timeToPeakMinutes)),
      unit: 'min',
      measure: true,
    },
    {
      key: 'minutesAboveRange',
      label: 'Above target range',
      value: String(Math.round(m.minutesAboveRange)),
      unit: 'min',
      measure: true,
    },
    backInRange(m),
    {
      key: 'areaAboveRange',
      label: 'Excursion above target',
      value: String(Math.round(m.areaAboveRange)),
      unit: 'mmol/L · min',
      measure: true,
    },
    {
      key: 'shape',
      label: 'Shape',
      value: postMealShapeLabel(m.shape).label,
      unit: null,
      measure: false,
    },
    {
      key: 'mealsMeasured',
      label: 'Meals measured',
      // The honest denominator. These are averaged over the meals watched long
      // enough to time, which is not always every meal in the group, and a
      // reader who has just seen the group's own count is owed the difference.
      value: `${m.n} of ${group.n}`,
      unit: null,
      measure: true,
    },
  ];
}

/**
 * Three different answers, and which one it is matters more than the number.
 *
 * Never left range is the good one. Still above when the window closed is the
 * one an em dash would quietly hide, and it is the reason this is not just a
 * nullable number formatted in place.
 */
function backInRange(m: PostMealMetrics): PostMealMeasurement {
  const base = { key: 'returnToRange', label: 'Back in range' };

  if (m.returnToRangeMinutes !== null) {
    return {
      ...base,
      value: String(Math.round(m.returnToRangeMinutes)),
      unit: 'min after eating',
      measure: true,
    };
  }
  if (m.minutesAboveRange === 0) {
    return { ...base, value: 'Never left range', unit: null, measure: false };
  }
  return {
    ...base,
    value: `Still above at ${postMealWindowLabel()}`,
    unit: null,
    measure: false,
  };
}

/**
 * The meals this group could not finish describing, as a sentence.
 *
 * Not a footnote. A meal still above target when the window closed is the one
 * the numbers above leave unresolved, and saying how many there were is the
 * difference between an average and an average with a hole in it. Null when
 * there are none, which is most of the time.
 */
export function postMealCaveat(
  group: Pick<GroupMeasure, 'postMeal'>,
): string | null {
  const count = group.postMeal?.stillAboveAtWindowEnd ?? 0;
  if (count === 0) return null;

  const meals = count === 1 ? 'meal was' : 'meals were';
  const they = count === 1 ? 'it is' : 'they are';
  return (
    `${count} ${meals} still above target range when the ` +
    `${postMealWindowLabel('words')} ended, and ${they} not counted in the ` +
    'time back in range.'
  );
}

export function knownPostMealShapes(): string[] {
  return Object.keys(POST_MEAL_SHAPES);
}

export function postMealShapeLabel(shape: string): PostMealShape {
  const known = POST_MEAL_SHAPES[shape];
  if (known) return known;
  return {
    label: shape.charAt(0).toUpperCase() + shape.slice(1).replace(/_/g, ' '),
    description: 'measured from the response curve',
  };
}

export const groupMeasureSchema = z.object({
  label: z.string(),
  n: z.number().int().min(0),
  baselineMmol: z.number().nullable().default(null),
  peakMmol: z.number().nullable().default(null),
  /**
   * The group's mean response, sampled every fifteen minutes.
   *
   * Averaged across the group's meals at each offset, and a point is kept only
   * where a third of them had a reading — a tail thinning to one meal would
   * draw that meal's noise as the pattern. Empty for a level rather than a
   * movement, where a line would invent motion nobody measured.
   */
  curve: z.array(curvePointSchema).default([]),
  /**
   * The response measured as a post-meal excursion, when it is one.
   *
   * Null for a group that is not a meal response — asking when a morning
   * average returned to range is not a question — and null for a meal group
   * whose responses were not watched long enough to time. A surface renders
   * this section or omits it, and never renders it empty.
   */
  postMeal: postMealMetricsSchema.nullable().default(null),
});
export type GroupMeasure = z.infer<typeof groupMeasureSchema>;

/**
 * How complete the glucose record behind a finding actually is.
 *
 * Mirrors `DataQuality` in `metabolic-engine/app/models/findings.py`. These two
 * are the same contract in two languages and must be changed together.
 *
 * A sample count answers "how much was recorded" and cannot answer "how much of
 * the period was watched". Those come apart in the direction that flatters: ten
 * thousand readings clustered into four days of a month look overwhelming and
 * describe an eighth of it. `findingStrength` uses `coverage` as a ceiling —
 * it can lower what a finding is called and can never raise it.
 *
 * Null on findings that are not computed from glucose. A lab trend has no
 * sampling window to be complete, and a coverage figure attached to one would
 * invite a reader to discount it for missing readings it never needed.
 */
export const dataQualitySchema = z.object({
  /**
   * The share of the window this finding is about that was observed.
   *
   * Which window depends on the finding, and that is the design: a morning
   * finding is judged on mornings, a meal finding on meals. Judging everything
   * on whole-period coverage would mark down every person who tests with a
   * meter rather than wearing a sensor, including those who test faithfully
   * around every meal and so have complete coverage of the windows their
   * findings are actually about.
   */
  coverage: z.number().min(0).max(1),
  /** What `coverage` is a fraction of, in the reader's words. */
  coverageBasis: z.string().min(1),

  daysWithData: z.number().int().min(0),
  daysInWindow: z.number().int().min(0),
  /** Days with readings, but too few to describe the day. */
  sparseDays: z.number().int().min(0),
  /** The longest stretch with no reading at all. */
  largestGapHours: z.number().min(0),
  /** Readings sharing a timestamp: a count that grew without an observation. */
  duplicateReadings: z.number().int().min(0),
  /** How much of the sampling kept to this record's own usual rhythm. */
  regularFraction: z.number().min(0).max(1),
  medianIntervalMinutes: z.number().nullable().default(null),
  /** Where most readings came from: `cgm`, `meter`, `mixed`, `unknown`. */
  primarySource: z.string().min(1),
});
export type DataQuality = z.infer<typeof dataQualitySchema>;

/**
 * Something other than the finding that could produce the same pattern.
 *
 * Mirrors `CompetingExplanation` in `metabolic-engine/app/models/findings.py`.
 * These two are the same contract in two languages and must be changed
 * together.
 *
 * Drawn from a reviewed catalogue in the engine, never generated, and never
 * written here. A competing explanation is a clinical claim about why
 * somebody's glucose did what it did, and the frontend is the one place it
 * must never be composed — a surface may lay these out and must not add to
 * them.
 *
 * Four fields because naming an alternative is not enough to be useful. A
 * reader needs to know why it could produce this pattern, what a record would
 * look like if it were true, what is missing from theirs, and whether they can
 * do anything about that.
 */
export const competingExplanationSchema = z.object({
  label: z.string().min(1),
  /** Why this could produce the pattern the finding describes. */
  why: z.string().min(1),
  /** What a record would look like if this were the reason. */
  supportedBy: z.string().min(1),
  /** What is missing from this person's record today. */
  missing: z.string().min(1),
  /**
   * What to log to separate this from the finding, or null.
   *
   * Null means the product cannot capture it today, said plainly rather than
   * hidden. An explanation asking for data with nowhere to go would send
   * somebody looking for a control that does not exist — but "nobody measured
   * this" is still worth telling them, which is why it stays on the list.
   */
  capture: z.string().nullable().default(null),
});
export type CompetingExplanation = z.infer<typeof competingExplanationSchema>;

export const structuredFindingSchema = z.object({
  findingType: z.string().min(1),
  summary: z.string().min(1),
  effectEstimate: z.number().nullable(),
  effectUnit: z.string().nullable(),
  confidence: confidenceSchema,
  sampleCount: z.number().int().min(0),
  /** Always populated. An empty limitations list is a bug, not a strong finding. */
  limitations: z.array(z.string()),
  /** Set when the finding touches anything a clinician should weigh in on. */
  clinicianReviewRecommended: z.boolean().default(false),

  /** The groups compared, when the finding compared any. Empty for lab trends. */
  comparison: z.array(groupMeasureSchema).default([]),

  /**
   * What else could produce this pattern.
   *
   * Empty for a finding with no effect estimate: there is nothing to explain
   * another way when nothing was measured, and offering alternatives for a
   * result that does not exist would read as though one did.
   */
  competingExplanations: z.array(competingExplanationSchema).default([]),

  /**
   * How complete the record behind this finding is, when it is a glucose one.
   *
   * Null for a finding computed from something else rather than zeroed,
   * because "no coverage" and "coverage is not a question here" are different
   * and a reader must not have to guess which.
   */
  dataQuality: dataQualitySchema.nullable().default(null),

  /**
   * Reported, but not as a limitation.
   *
   * It used to be a sentence inside `limitations`, which made a list of things
   * the finding cannot account for read as a lab report — and a p-value is not
   * a limitation, it is a statistic. Its own field so a surface can put it
   * where a technical detail belongs, or leave it out entirely.
   */
  pValue: z.number().nullable().default(null),
  /** What the user could log to make this answer sharper. */
  wouldImproveWith: z.array(z.string()).default([]),
});
export type StructuredFinding = z.infer<typeof structuredFindingSchema>;

/**
 * How complete the record is, as labelled rows.
 *
 * Same job `postMealMeasurements` does, and shared for the same reason: the
 * person and their clinician read these numbers on different pages and must
 * not meet them under different names.
 *
 * The problem rows — sparse days, duplicates — appear only when there is a
 * problem. A quality panel that lists "0 duplicate readings" on every finding
 * trains a reader to skip the panel, and then it is not there on the finding
 * where it said something.
 */
export function dataQualityMeasurements(quality: DataQuality): Measurement[] {
  const rows: Measurement[] = [
    {
      key: 'coverage',
      label: 'Coverage',
      value: String(Math.round(quality.coverage * 100)),
      unit: `% of ${quality.coverageBasis}`,
      measure: true,
    },
    {
      key: 'days',
      label: 'Days with readings',
      value: `${quality.daysWithData} of ${quality.daysInWindow}`,
      unit: null,
      measure: true,
    },
    {
      key: 'largestGap',
      label: 'Longest gap',
      value: quality.largestGapHours.toFixed(1),
      unit: 'hours',
      measure: true,
    },
    {
      key: 'source',
      label: 'Mostly from',
      value: sourceLabel(quality.primarySource),
      unit: null,
      measure: false,
    },
  ];

  if (quality.medianIntervalMinutes !== null) {
    rows.splice(3, 0, {
      key: 'interval',
      label: 'Usual interval',
      value: String(Math.round(quality.medianIntervalMinutes)),
      unit: 'min',
      measure: true,
    });
  }

  if (quality.sparseDays > 0) {
    rows.push({
      key: 'sparseDays',
      label: 'Thinly sampled days',
      value: String(quality.sparseDays),
      unit: null,
      measure: true,
    });
  }

  if (quality.duplicateReadings > 0) {
    rows.push({
      key: 'duplicates',
      label: 'Duplicate readings',
      value: String(quality.duplicateReadings),
      unit: null,
      measure: true,
    });
  }

  return rows;
}

const SOURCE_LABELS: Record<string, string> = {
  cgm: 'A sensor',
  meter: 'A meter',
  mixed: 'Both a sensor and a meter',
  other: 'Another source',
  unknown: 'An unrecorded source',
};

/**
 * Where the readings came from, in words.
 *
 * Reported because it changes what every other figure means. Two hours of
 * coverage in a day is a thin record from a sensor and an ordinary one from a
 * meter, and a coverage figure read without knowing which is half a sentence.
 */
export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? SOURCE_LABELS.unknown;
}

/**
 * The one line a reader sees before deciding whether to look closer.
 *
 * A restatement of `coverage` and its basis, in the same category as
 * `findingPresentation`: it introduces no claim the engine has not made. The
 * engine adds its own limitation sentence when coverage is low; this is the
 * neutral statement of fact that appears whatever the number.
 */
export function dataQualityHeadline(quality: DataQuality): string {
  const percent = Math.round(quality.coverage * 100);
  return `Glucose was recorded for ${percent}% of ${quality.coverageBasis}.`;
}

export const evidenceStrengthSchema = z.enum([
  'insufficient',
  'weak',
  'moderate',
  'strong',
]);
export type EvidenceStrength = z.infer<typeof evidenceStrengthSchema>;

/**
 * Coverage below these fractions caps how strong a finding may be called.
 *
 * Mirrors the constants in `metabolic-engine/app/engines/thresholds.py`.
 *
 * These are **product** evidence thresholds, not clinical ones, and the
 * distinction is load-bearing. A clinical threshold decides care: what a
 * result means for somebody and what should happen next. These decide one
 * English word on a card. No effect estimate, confidence, p-value or
 * recommendation moves because of them, which is why they can ship without
 * clinical review — and why the moment one starts gating something a person
 * might act on, it has stopped being a product threshold.
 *
 * Reviewable rather than provisional: a considered first cut, conservative on
 * purpose, declared as a set so they can be argued with in one place.
 */
export const COVERAGE_FOR_WEAK = 0.25;
export const COVERAGE_FOR_MODERATE = 0.5;
export const COVERAGE_FOR_STRONG = 0.7;

const STRENGTHS: EvidenceStrength[] = ['insufficient', 'weak', 'moderate', 'strong'];

/** The strongest a finding may be called, given how complete its record is. */
export function coverageCeiling(coverage: number): EvidenceStrength {
  if (coverage < COVERAGE_FOR_WEAK) return 'insufficient';
  if (coverage < COVERAGE_FOR_MODERATE) return 'weak';
  if (coverage < COVERAGE_FOR_STRONG) return 'moderate';
  return 'strong';
}

/** Whichever of two strengths claims less. */
export function weakerOf(a: EvidenceStrength, b: EvidenceStrength): EvidenceStrength {
  return STRENGTHS.indexOf(a) <= STRENGTHS.indexOf(b) ? a : b;
}

/**
 * Maps sample count, confidence and record completeness onto the single word.
 *
 * Kept in shared code so the API, web app, and reports never disagree, and
 * mirrored by `evidence_strength()` in the engine's `thresholds.py`.
 *
 * `coverage` is optional and omitting it means "do not apply a ceiling", which
 * is exactly what this did before coverage existed. It is absent for findings
 * that are not about glucose at all.
 *
 * When present it can only lower the answer. Many readings clustered into a
 * few days are still many readings and the sample count is right to say so;
 * what a count cannot say is that the rest of the period was observed. This is
 * the line that stops a finding looking strong because a sensor ran hot for a
 * weekend.
 */
export function evidenceStrength(
  sampleCount: number,
  confidence: number,
  coverage?: number | null,
): EvidenceStrength {
  const bySample: EvidenceStrength =
    sampleCount < 5
      ? 'insufficient'
      : sampleCount < 10 || confidence < 0.6
        ? 'weak'
        : sampleCount < 20 || confidence < 0.8
          ? 'moderate'
          : 'strong';

  if (coverage === undefined || coverage === null) return bySample;
  return weakerOf(bySample, coverageCeiling(coverage));
}

/**
 * What the engine is asked.
 *
 * Mirrors `PatternRequest` in `metabolic-engine/app/models/findings.py`. These
 * two are the same contract in two languages and must be changed together.
 */
export const patternRequestSchema = z.object({
  userId: uuidSchema,
  from: z.coerce.date(),
  to: z.coerce.date(),
  patterns: z.array(z.string()).optional(),
  /**
   * Which model of a body the record should be read with.
   *
   * Derived by the API from the recorded diagnosis and the flags in force,
   * never taken from a browser. The engine refuses any detector outside the
   * care mode it declares support for, so this is what makes that refusal
   * possible — and the engine defaults it to `unknown`, which nothing
   * supports, so omitting it yields a refusal rather than the Type 2 analysis.
   */
  careMode: careModeSchema,
  /** Safety flags in force. Some detectors are blocked by these whatever the care mode. */
  activeFlags: z.array(safetyFlagSchema).default([]),
  /**
   * The timezone the engine reads hours in.
   *
   * Every timestamp reaches the engine as UTC, and three findings depend on
   * hour-of-day: the morning window, the fasting window, and the late-meal
   * split. Defaults to UTC, which is what the engine did before this existed —
   * so a caller that forgets it gets today's behaviour rather than a silent
   * shift, and the default is a known state rather than a guess.
   */
  timezone: z.string().min(1).max(64).default('UTC'),
});
export type PatternRequest = z.infer<typeof patternRequestSchema>;

export const patternResponseSchema = z.object({
  userId: uuidSchema,
  generatedAt: z.coerce.date(),
  modelVersion: z.string(),
  findings: z.array(structuredFindingSchema),
});
export type PatternResponse = z.infer<typeof patternResponseSchema>;

/**
 * The two questions behind the one word, kept apart.
 *
 * `confidence` and `coverage` are different truths and blending them into a
 * single number would lose both. Confidence asks how stable the measured
 * relationship is inside the data there is. Coverage asks how much of the
 * period that data actually observed. A record can be entirely consistent
 * about the fortnight it watched and silent about the fortnight it did not,
 * and that is not the same as a noisy record — it needs saying differently.
 *
 * So the engine keeps them separate and this is where the awkwardness is
 * resolved: a surface shows both, and the overall word is the weaker. Hiding
 * one inside the other would produce a single honest-looking number that
 * answered neither question.
 */
export interface EvidenceBreakdown {
  /** How stable the relationship is in the readings there are. */
  signal: EvidenceStrength;
  /** How much of the period those readings watched. Null when not a glucose finding. */
  coverage: EvidenceStrength | null;
  /** The weaker of the two, and the word the badge shows. */
  overall: EvidenceStrength;
  /**
   * Set only when coverage is what held the finding back.
   *
   * Absent when the two agree, because a sentence explaining a cap that did
   * not happen is noise on every card where nothing went wrong.
   */
  note: string | null;
}

const SIGNAL_PHRASE: Record<EvidenceStrength, string> = {
  strong: 'A strong signal in the readings we saw',
  moderate: 'A clear signal in the readings we saw',
  weak: 'A weak signal in the readings we saw',
  insufficient: 'Too little signal in the readings we saw',
};

const COVERAGE_PHRASE: Record<EvidenceStrength, string> = {
  strong: 'the record covers the period well',
  moderate: 'the record covers much of the period but not all of it',
  weak: 'the record covers only part of the period',
  insufficient: 'the record covers very little of the period',
};

/** What each half of the judgement is called, where a surface labels them. */
export const EVIDENCE_BREAKDOWN_LABELS = {
  signal: 'Signal in the readings',
  coverage: 'Coverage of the period',
  overall: 'Overall',
} as const;

/**
 * How a finding's evidence word was arrived at.
 *
 * A restatement of numbers the engine already computed — the same category as
 * `findingPresentation`. It introduces no claim: `signal` is what the strength
 * would have been before coverage existed, `coverage` is the ceiling, and
 * `overall` is what `findingStrength` returns.
 */
export function evidenceBreakdown(
  finding: Pick<StructuredFinding, 'effectEstimate' | 'sampleCount' | 'confidence'> & {
    dataQuality?: DataQuality | null;
  },
): EvidenceBreakdown {
  const signal: EvidenceStrength =
    finding.effectEstimate === null
      ? 'insufficient'
      : evidenceStrength(finding.sampleCount, finding.confidence);

  const quality = finding.dataQuality;
  if (!quality) return { signal, coverage: null, overall: signal, note: null };

  const coverage = coverageCeiling(quality.coverage);
  const overall = weakerOf(signal, coverage);

  return {
    signal,
    coverage,
    overall,
    note:
      overall === coverage && coverage !== signal
        ? `${SIGNAL_PHRASE[signal]}, but ${COVERAGE_PHRASE[coverage]}.`
        : null,
  };
}

const STRENGTH_ORDER: Record<EvidenceStrength, number> = {
  strong: 0,
  moderate: 1,
  weak: 2,
  insufficient: 3,
};

/**
 * The strength of a whole finding, rather than of its numbers alone.
 *
 * A finding with no effect estimate has not measured anything, whatever its
 * sample count: the engine returns those when a comparison group is too thin
 * to describe. `evidenceStrength(8, 0)` would call that "weak evidence", which
 * overstates it — there is no evidence yet, only a count of what was logged.
 *
 * Where the finding carries data quality, its coverage caps the answer. That
 * is the second way a count overstates: a record with plenty of readings and
 * none of them in the window being analysed has counted a great deal and
 * observed very little.
 */
export function findingStrength(
  finding: Pick<StructuredFinding, 'effectEstimate' | 'sampleCount' | 'confidence'> & {
    /**
     * Optional so a caller holding a partial finding — a badge, a fixture —
     * still typechecks. Absent means no ceiling, which is what this did before
     * coverage existed.
     */
    dataQuality?: DataQuality | null;
  },
): EvidenceStrength {
  if (finding.effectEstimate === null) return 'insufficient';
  return evidenceStrength(
    finding.sampleCount,
    finding.confidence,
    finding.dataQuality?.coverage,
  );
}

/**
 * Puts the findings the data can support first, firmest first.
 *
 * The engine returns findings in detector order, which is an implementation
 * detail of the engine. Ordering lives here rather than in either caller so
 * the API, the web app, and a printed clinician report present the same
 * record in the same order. Ties keep the larger sample first, then the
 * engine's own order.
 */
export function orderFindings(findings: StructuredFinding[]): StructuredFinding[] {
  return [...findings].sort((a, b) => {
    const byStrength = STRENGTH_ORDER[findingStrength(a)] - STRENGTH_ORDER[findingStrength(b)];
    if (byStrength !== 0) return byStrength;
    return b.sampleCount - a.sampleCount;
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Longest window the evidence endpoint will ask the engine to analyse. */
export const MAX_EVIDENCE_WINDOW_DAYS = 365;

/** Window used when the caller does not name one. */
export const DEFAULT_EVIDENCE_WINDOW_DAYS = 30;

/**
 * The time range an evidence request covers.
 *
 * Deliberately carries no user id. The engine will answer about any user id it
 * is handed, so the identity comes from the verified access token on the
 * server and can never be supplied by the browser.
 *
 * The upper bound on the window is not a performance guess: the engine loads
 * every reading in the range into memory, so an unbounded range is a way to
 * make one request cost arbitrarily much.
 */
export const evidenceQuerySchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .transform((v) => {
    const to = v.to ?? new Date();
    return {
      to,
      from: v.from ?? new Date(to.getTime() - DEFAULT_EVIDENCE_WINDOW_DAYS * DAY_MS),
    };
  })
  .refine((v) => v.to > v.from, { message: '`from` must be before `to`' })
  .refine((v) => v.to.getTime() - v.from.getTime() <= MAX_EVIDENCE_WINDOW_DAYS * DAY_MS, {
    message: `The window cannot be longer than ${MAX_EVIDENCE_WINDOW_DAYS} days`,
  });
export type EvidenceQuery = z.infer<typeof evidenceQuerySchema>;

/**
 * The one safe experiment a finding suggests testing.
 *
 * A finding says what already happened; an experiment is how somebody finds
 * out whether it happens on purpose. This is the join between the two, and it
 * is deliberately narrow: one template per finding type, and only for findings
 * where a week of alternating behaviour would actually settle something.
 *
 * Most finding types are absent, and that is the correct answer rather than a
 * gap to fill later. A morning glucose average has no one-week test a person
 * can run alone. An HbA1c trend moves over quarters. Offering a button that
 * proposes a test which cannot resolve the question would be worse than
 * offering nothing, because it would look like the product knew what to do.
 *
 * Every template here is drawn from ALLOWED_EXPERIMENT_TEMPLATES, and a test
 * asserts it. That does not mean a proposal is always allowed: the classifier
 * still gates it against the person's care profile, so the same finding
 * proposes a runnable test for one reader and a clinician conversation for
 * another. What it does mean is that this map can never be the thing that
 * surfaces a blocked protocol.
 */
const FINDING_EXPERIMENTS: Record<
  string,
  { template: string; title: string; question: string; protocol: Record<string, unknown> }
> = {
  post_meal_walk_effect: {
    template: 'post_meal_walk',
    title: 'Walking after a meal',
    question:
      'Does walking after a meal actually lower the rise for me, or were those days different in some other way?',
    protocol: {
      days: 6,
      instruction:
        'Eat a similar meal on six days. Walk after three of them, chosen at random rather than when you feel like it.',
      records: ['meal', 'activity', 'glucose'],
    },
  },
  late_evening_meal_response: {
    template: 'meal_timing',
    title: 'Eating the same meal earlier',
    question:
      'Is the larger rise about the hour I eat, or about what I happen to eat late?',
    protocol: {
      days: 6,
      instruction:
        'Eat the same meal on six days: three of them before 19:00, three after 20:00.',
      records: ['meal', 'glucose'],
    },
  },
  meal_timing_association: {
    template: 'meal_timing',
    title: 'Eating the same meal earlier',
    question: 'Does the time of day change the rise, holding the meal itself steady?',
    protocol: {
      days: 6,
      instruction:
        'Eat the same meal on six days, half early and half late, and log each one.',
      records: ['meal', 'glucose'],
    },
  },
  post_meal_response: {
    template: 'meal_order',
    title: 'Changing the order of a meal',
    question:
      'Does eating the protein and vegetables before the carbohydrate change my rise?',
    protocol: {
      days: 6,
      instruction:
        'Eat the same meal on six days. On three of them, eat everything else before the carbohydrate.',
      records: ['meal', 'glucose'],
    },
  },
};

export interface ExperimentProposal {
  template: string;
  title: string;
  question: string;
  protocol: Record<string, unknown>;
}

/**
 * The proposal a finding supports, or null when it supports none.
 *
 * Null for a finding with no effect estimate, whatever its type. A detector
 * that could not measure anything has not identified a question worth a week
 * of somebody's life, and "not enough data" is the wrong thing to hand a
 * person a test for.
 */
export function proposalFromFinding(
  finding: Pick<StructuredFinding, 'findingType' | 'effectEstimate'>,
): ExperimentProposal | null {
  if (finding.effectEstimate === null) return null;
  return FINDING_EXPERIMENTS[finding.findingType] ?? null;
}

/**
 * What a finding is called, and what kind of diabetes question it answers.
 *
 * `findingType` is the engine's own identifier and it belongs in the record —
 * a clinician quotes it, the packet keys on it, and it must not drift. It does
 * not belong on a screen: `late_evening_meal_response` tells somebody with
 * diabetes nothing about their evening meal.
 *
 * This is a display name for an enum, in the same category as `careModeLabel`
 * and nothing like a finding. It restates what the detector already measures;
 * it makes no claim the engine has not already made, and it must never be
 * where a new one is introduced. Anything that interprets a person's data
 * belongs in the engine, behind the review that gets it there.
 *
 * The lens exists because the same number means different things in different
 * physiology. "A 3.1 mmol/L larger rise" is a post-meal response question, and
 * saying so is what separates a diabetes platform from an analytics dashboard
 * that happens to be pointed at glucose.
 */
export interface FindingPresentation {
  title: string;
  lens: string;
}

const FINDING_PRESENTATION: Record<string, FindingPresentation> = {
  late_evening_meal_response: {
    title: 'Late meals and glucose rise',
    lens: 'Post-meal glucose response',
  },
  post_meal_walk_effect: {
    title: 'Walking after meals',
    lens: 'Activity and post-meal response',
  },
  post_meal_response: {
    title: 'Your typical meal response',
    lens: 'Post-meal glucose response',
  },
  morning_glucose_pattern: {
    title: 'Morning glucose',
    lens: 'Fasting and waking glucose',
  },
  hba1c_trend: { title: 'HbA1c over time', lens: 'Long-term glucose control' },
  weight_trend: { title: 'Weight over time', lens: 'Metabolic risk factors' },
  fasting_glucose_trend: {
    title: 'Waking glucose over time',
    lens: 'Fasting and waking glucose',
  },
  activity_consistency: { title: 'How regular your activity is', lens: 'Activity patterns' },
  meal_timing_association: {
    title: 'Meal timing and glucose rise',
    lens: 'Post-meal glucose response',
  },
  care_mode_unsupported: {
    title: 'Not yet interpreted for your care profile',
    lens: 'Care profile',
  },
};

/**
 * Falls back to the identifier made readable rather than to the identifier.
 *
 * A detector added tomorrow without an entry here shows "Sleep and morning
 * glucose", not `sleep_morning_glucose`. The fallback is deliberately plain so
 * that a missing entry looks unfinished to whoever ships the detector, without
 * ever showing a reader a database value.
 */
export function findingPresentation(findingType: string): FindingPresentation {
  const known = FINDING_PRESENTATION[findingType];
  if (known) return known;

  const words = findingType.replace(/_/g, ' ').trim();
  return {
    title: words.charAt(0).toUpperCase() + words.slice(1),
    lens: 'Pattern in your data',
  };
}

/** Every template this map can produce. Used to prove none of them is unsafe. */
export function proposableTemplates(): string[] {
  return [...new Set(Object.values(FINDING_EXPERIMENTS).map((e) => e.template))];
}

/**
 * A prediction made before an experiment runs.
 *
 * The point of the platform, and the one record it must never be able to
 * revise. A system that scores itself after the fact can always be right; a
 * system that writes down what it expects, then cannot touch it, produces the
 * only number worth anything — how often it was right about this person
 * specifically.
 *
 * `prediction` and `inputSnapshot` are both generated on the server. Nothing a
 * browser sends decides what was expected, because the accountability is
 * meaningless if the thing being held accountable chose its own answer after
 * seeing the question.
 */
export const predictionSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  /**
   * The experiment this expectation is about.
   *
   * Null only for rows written before migration 0018 gave the link a column of
   * its own. Exposed because a screen showing predicted against observed has to
   * pair the two, and pairing them by reading `inputSnapshot` would mean
   * trusting the shape of a jsonb blob for something the database already
   * enforces as a foreign key.
   */
  experimentId: uuidSchema.nullable(),
  predictionType: z.string(),
  madeAt: z.coerce.date(),
  targetAt: z.coerce.date().nullable(),
  modelVersion: z.string(),
  /** What was expected, in the engine's own terms. */
  prediction: z.record(z.unknown()),
  /** Everything needed to replay the reasoning: the finding, the window, the care mode. */
  inputSnapshot: z.record(z.unknown()),
  confidence: confidenceSchema.nullable(),
  status: z.enum(['pending', 'matched', 'expired', 'unmatchable']),
});
export type Prediction = z.infer<typeof predictionSchema>;

/**
 * What a prediction actually says, once it is read rather than stored.
 *
 * `prediction` is jsonb because the shape belongs to whatever made it, and a
 * column per field would have to change every time a new kind of prediction
 * arrives. Reading it back through a schema rather than a cast is the other
 * half of that bargain: a row this does not recognise comes back as null and
 * is shown as unreadable, instead of rendering `undefined mmol/L` at somebody
 * who is trying to find out whether the platform was right about them.
 */
export const expectationSchema = z.object({
  expectedEffect: z.number(),
  unit: z.string().nullable(),
  statement: z.string(),
  basisFindingType: z.string(),
});
export type Expectation = z.infer<typeof expectationSchema>;

export function expectationFrom(
  prediction: Pick<Prediction, 'prediction'>,
): Expectation | null {
  const parsed = expectationSchema.safeParse(prediction.prediction);
  return parsed.success ? parsed.data : null;
}

/**
 * What was actually observed.
 *
 * Separate from the prediction, in its own table, written once. Attaching an
 * outcome is the only thing that ever touches a prediction, and even then it
 * only advances the status: the expectation itself stays exactly as written.
 *
 * There is one way to send this, and it is completing the experiment. An
 * outcome that could be recorded on its own would leave the experiment running
 * forever with its answer already known, and a second door into the same write
 * is how the two eventually disagree.
 */
export const attachOutcomeSchema = z.object({
  observedAt: z.coerce.date(),
  /** The measured value, in the unit the prediction named. */
  observedEffect: z.number(),
  notes: z.string().max(1000).optional(),
});
export type AttachOutcomeInput = z.infer<typeof attachOutcomeSchema>;

/**
 * The scoring, computed once on the server when the outcome is written.
 *
 * Stored rather than derived on read, because it is part of the record: a
 * figure recomputed at display time is a figure that changes when the code
 * that computes it changes, and the whole point of these rows is that they do
 * not move.
 *
 * `expectedEffect` is nullable for the same reason the engine's own estimates
 * are — a prediction whose expectation could not be read as a number is scored
 * as unscoreable rather than as zero.
 */
export const errorSummarySchema = z.object({
  expectedEffect: z.number().nullable(),
  observedEffect: z.number(),
  /** Signed. Whether the platform over- or under-estimated is the interesting half. */
  error: z.number().nullable(),
  absoluteError: z.number().nullable(),
});
export type ErrorSummary = z.infer<typeof errorSummarySchema>;

export const predictionOutcomeSchema = z.object({
  id: uuidSchema,
  predictionId: uuidSchema,
  observedAt: z.coerce.date(),
  outcome: z.object({
    observedEffect: z.number(),
    notes: z.string().nullable(),
  }),
  errorSummary: errorSummarySchema.nullable(),
  createdAt: z.coerce.date(),
});
export type PredictionOutcome = z.infer<typeof predictionOutcomeSchema>;

/**
 * An experiment with the expectation written before it ran and, once it is
 * finished, what actually happened.
 *
 * One response rather than three requests, because the screen it exists for is
 * meaningless in pieces: predicted without observed is a promise, and observed
 * without predicted is a measurement of nothing in particular.
 */
export const experimentDetailSchema = z.object({
  experiment: experimentSchema,
  prediction: predictionSchema.nullable(),
  outcome: predictionOutcomeSchema.nullable(),
});
export type ExperimentDetail = z.infer<typeof experimentDetailSchema>;
