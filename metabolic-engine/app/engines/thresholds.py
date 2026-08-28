"""Shared evidence thresholds.

Kept in one place so every engine describes uncertainty the same way, and so
the numbers can be reviewed as a set rather than hunted through the codebase.
"""

MIN_SAMPLES_FOR_ANY_FINDING = 5
"""Below this, the engine reports insufficient data rather than a weak finding."""

MIN_SAMPLES_FOR_MODERATE = 10
MIN_SAMPLES_FOR_STRONG = 20

# The target range, in mmol/L.
#
# NOT the source of truth. `TARGET_LOW_MMOL` / `TARGET_HIGH_MMOL` in
# packages/types/src/glucose.ts are, and these exist only because Python cannot
# import TypeScript. Both bounds are inclusive there and must be here.
#
# This copy is not trusted to stay correct by good intentions:
# backend/test/target-range.spec.ts reads this file and fails if these numbers
# disagree with the contract. Changing one side alone breaks the build, which is
# the only kind of "keep in sync" comment worth writing.
TARGET_LOW_MMOL = 3.9
TARGET_HIGH_MMOL = 10.0

POST_MEAL_WINDOW_MINUTES = 120
"""How long after a meal to look for the glucose response."""

WALK_PROXIMITY_MINUTES = 90
"""An activity event this soon after a meal counts as a post-meal walk."""


# --- Post-meal response shape -----------------------------------------------
#
# A meal's response is only worth measuring in time if it was actually watched
# over time. These two say what "watched" means, and they are deliberately
# separate: a curve can have plenty of points bunched into the first half hour,
# and it can span the window on two readings. Neither describes a response.

POST_MEAL_MIN_CURVE_POINTS = 3
"""Baseline, and at least two readings after it.

Two points are a line between the meal and one reading, which can state a rise
but cannot say when the peak came or how long it lasted. Three is the classic
fingerstick pattern — before, an hour, two hours — and that person is exactly
who these measurements are for, so the bar sits just below them rather than at
a cadence only a CGM can meet.
"""

POST_MEAL_MIN_COVERAGE = 0.75
"""How much of the window a response must span before its timings are reported.

A meal whose last reading is forty-five minutes in has not been observed long
enough to say when glucose came back down; reporting "45 minutes above range"
would be reporting when the watching stopped, not when the excursion did. At
0.75 of a two-hour window a response must reach ninety minutes to be counted.
"""

# The single word for the shape of a response. Thresholds rather than
# adjectives in code, so the label can be argued with — and changed — without
# reading the classifier.
SHAPE_FLAT_RISE_MMOL = 2.0
"""Below this rise, and never above range, nothing happened worth describing."""

SHAPE_SHARP_PEAK_MINUTES = 45
"""A peak this early is a fast one, whatever its height."""

SHAPE_DELAYED_PEAK_MINUTES = 90
"""A peak this late is still climbing through the window most people stop watching."""

SHAPE_PROLONGED_MINUTES_ABOVE = 60
"""Half of `POST_MEAL_WINDOW_MINUTES`, and anchored to it rather than chosen.

The excursion's duration rather than its height, which is the half a person
actually feels. Half the window is the one defensible line here: a response
above target for more than half of the time anybody was watching is prolonged
by the only measure this engine has. Any figure between about 45 and 75 could
be argued for, and that is exactly why the number is tied to something rather
than picked — it must not drift toward whatever makes a given record read
better.

All four shape thresholds are a first cut and none has been through clinical
review. They decide a word, never a refusal or a number.
"""


# --- Coverage and evidence quality ------------------------------------------
#
# How complete the glucose record is, which is a different question from how
# many readings it holds. Ten thousand readings clustered into four days say
# nothing about the fortnight either side of them, and a sample count cannot
# tell those apart.

COVERAGE_MAX_GAP_MINUTES = 30
"""The longest gap between readings that still counts as continuous watching.

A CGM reports every five to fifteen minutes, so thirty is generous to it and
unreachable for a meter — which is the honest answer for whole-window coverage.
A person testing four times a day has not observed the other twenty-three
hours, and a coverage figure that pretended otherwise would be the exact
flattery this module exists to remove. What rescues that person is not a looser
gap: it is that a finding is judged on the window it is actually about. See
`coverage_basis`.
"""

SPARSE_DAY_MIN_READINGS = 4
"""Below this, a day has been sampled rather than watched.

Four is the classic pre-meal fingerstick day. It is a low bar on purpose: this
counts days that are thin even by meter standards, not days that fall short of
a CGM.
"""

LARGE_GAP_HOURS = 6
"""A gap this long is a hole in the record rather than a night's sleep.

Six hours will catch a sensor that fell off and will not catch somebody who
slept eight hours without a CGM, which is why it is reported alongside the
overnight coverage rather than instead of it.
"""

IRREGULAR_INTERVAL_TOLERANCE = 2.0
"""How far an interval may stray from the record's own median and still count
as regular — a factor, either way. Absolute minutes would describe a CGM and
call every meter irregular; a ratio asks whether the person sampled the way
they usually sample."""

# Coverage below these fractions caps how strong a finding may be called. A
# ceiling, never a promotion: coverage can lower a claim and can never raise
# one, because a complete record is a precondition for trusting a result and
# not evidence for it.
#
# NOT clinically reviewed. They are a first cut, deliberately conservative, and
# they decide a word rather than a number: no effect estimate, confidence or
# p-value moves because of them.
COVERAGE_FOR_WEAK = 0.25
COVERAGE_FOR_MODERATE = 0.50
COVERAGE_FOR_STRONG = 0.70


def coverage_ceiling(coverage: float) -> str:
    """The strongest a finding may be called, given how complete its record is.

    Mirrors `coverageCeiling()` in @wellovue/types.
    """
    if coverage < COVERAGE_FOR_WEAK:
        return "insufficient"
    if coverage < COVERAGE_FOR_MODERATE:
        return "weak"
    if coverage < COVERAGE_FOR_STRONG:
        return "moderate"
    return "strong"


_STRENGTH_ORDER = ("insufficient", "weak", "moderate", "strong")


def weaker_of(a: str, b: str) -> str:
    """Whichever of two strengths claims less."""
    return a if _STRENGTH_ORDER.index(a) <= _STRENGTH_ORDER.index(b) else b


def evidence_strength(
    sample_count: int, confidence: float, coverage: float | None = None
) -> str:
    """Maps sample size, confidence and record completeness onto one word.

    Mirrors `evidenceStrength()` in @wellovue/types so the API, web app, and
    reports can never disagree about how strong a finding is.

    `coverage` is optional and defaults to not applying, which is exactly what
    this did before it existed: a caller that omits it gets the old answer
    rather than a silently harsher one. It is absent for findings that are not
    about glucose at all — a lab trend has no sampling window to be complete.

    When present it can only lower the answer. Many readings clustered into a
    few days are still many readings, and the sample count is right to say so;
    what it cannot say is that the rest of the period was observed. This is the
    line that stops a finding looking strong because a sensor ran hot for a
    weekend.
    """
    by_sample = _strength_by_sample(sample_count, confidence)
    if coverage is None:
        return by_sample
    return weaker_of(by_sample, coverage_ceiling(coverage))


def _strength_by_sample(sample_count: int, confidence: float) -> str:
    if sample_count < MIN_SAMPLES_FOR_ANY_FINDING:
        return "insufficient"
    if sample_count < MIN_SAMPLES_FOR_MODERATE or confidence < 0.6:
        return "weak"
    if sample_count < MIN_SAMPLES_FOR_STRONG or confidence < 0.8:
        return "moderate"
    return "strong"


# --- Prediabetes ------------------------------------------------------------

MIN_LAB_POINTS_FOR_TREND = 3
"""Two results are a difference; three are the beginning of a direction."""

MIN_DAYS_FOR_ACTIVITY_CONSISTENCY = 14
"""Shorter than a fortnight describes a week, not a habit."""

LAB_TREND_LOOKBACK_DAYS = 730
"""How far back the lab detectors look, regardless of the requested window.

The window on an evidence request describes a period of behaviour: meals,
walks, mornings. A lab trend is not that. HbA1c is taken quarterly, so over the
default thirty-day window a trend would be one result or none, and the finding
would report "not enough results" to somebody with four years of them.

Two years is long enough for a direction and short enough that it is still
about the person's life now. The findings say which span they actually used,
because it is not the span the rest of the screen is showing."""

WEIGHT_TREND_DAYS = 30
"""Weight is reported per month. HbA1c is reported per quarter, because that is
roughly the period the test reflects."""
