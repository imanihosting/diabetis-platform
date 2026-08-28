"""How complete a glucose record is, as distinct from how large it is.

The engine could already say how many readings a finding rested on. It could
not say how much of the period those readings actually watched, and the two
come apart in the direction that flatters: a sensor worn hard for four days of
a month produces thousands of readings and describes an eighth of it. Sample
count is right that there is a lot of data and wrong that the month was
observed.

Three ideas do the work here.

**A reading vouches for the time around it, not for the time after it.** Each
one covers half a maximum gap either side; the covered spans are unioned and
measured against the window. So a CGM at fifteen-minute cadence covers its
window continuously, and four fingersticks cover two hours of a day — which is
true, and is the number a person deserves to see.

**A finding is judged on the window it is about.** Whole-window coverage would
mark every meter user's evidence down, including the ones who test faithfully
before and after every meal and therefore have excellent coverage of the only
windows their findings concern. `Basis` is what makes the figure fair.

**Coverage is a ceiling, never a promotion.** A complete record is a
precondition for trusting a result, not evidence for it. See `evidence_strength`.
"""

from collections.abc import Sequence
from datetime import datetime, timedelta

import numpy as np
import pandas as pd

from app.engines.meal_response import MealResponse
from app.engines.post_meal import measurable_responses
from app.engines.thresholds import (
    COVERAGE_FOR_STRONG,
    COVERAGE_MAX_GAP_MINUTES,
    IRREGULAR_INTERVAL_TOLERANCE,
    SPARSE_DAY_MIN_READINGS,
)
from app.models.findings import DataQuality

# What a coverage figure is a fraction of. The label travels with the number
# because the number is meaningless without it: 0.4 of the mornings and 0.4 of
# the month are different findings about different problems.
#
# The three are measured differently on purpose, because each names the thing
# its findings are actually built from. A morning-glucose finding takes one
# average per morning, so what it needs is a reading in each morning — not four
# unbroken hours of them, which no meter user has ever had and which the
# finding would not use if they did. A meal-response finding needs the response
# watched. Only the whole-period figure is about continuous time.
WHOLE_WINDOW = "the whole period"
MORNING = "mornings in the period"
POST_MEAL = "logged meals"

MORNING_START_HOUR = 5
MORNING_END_HOUR = 9

# Where readings come from, collapsed to what changes their interpretation.
_CGM_SOURCES = frozenset({"cgm_device", "wearable"})
_METER_SOURCES = frozenset({"glucose_meter", "manual", "csv_import"})


def assess(
    glucose: pd.DataFrame,
    start: datetime,
    end: datetime,
    basis: str,
    responses: Sequence[MealResponse] = (),
    meals_logged: int | None = None,
) -> DataQuality | None:
    """The completeness of a glucose record, judged on one window.

    Returns None for an empty frame: a finding with no readings behind it is
    already reported as insufficient by its own detector, and a coverage of
    zero would add a second, quieter way of saying the same thing.

    `responses` and `meals_logged` are only read for the post-meal basis, where
    coverage is not a span calculation at all — see `_post_meal_coverage`.
    """
    if glucose.empty:
        return None

    times = glucose["measured_at"].sort_values()
    zone = times.iloc[0].tz
    window_start = pd.Timestamp(start).tz_convert(zone)
    window_end = pd.Timestamp(end).tz_convert(zone)

    if basis == POST_MEAL:
        coverage = _post_meal_coverage(responses, meals_logged)
    elif basis == MORNING:
        coverage = _morning_coverage(times, window_start, window_end)
    else:
        coverage = _span_coverage(times, [(window_start, window_end)])

    per_day = times.dt.date.value_counts()
    intervals = times.diff().dropna().dt.total_seconds() / 60.0

    return DataQuality(
        coverage=round(coverage, 3),
        coverage_basis=basis,
        days_with_data=int(per_day.size),
        days_in_window=max(1, int(np.ceil((window_end - window_start).total_seconds() / 86400))),
        sparse_days=int((per_day < SPARSE_DAY_MIN_READINGS).sum()),
        largest_gap_hours=round(float(intervals.max() / 60.0) if len(intervals) else 0.0, 2),
        # A timestamp already present adds a row and no observation, which is
        # the one way a sample count can climb while the record does not.
        duplicate_readings=int(times.duplicated().sum()),
        regular_fraction=round(_regular_fraction(intervals), 3),
        median_interval_minutes=round(float(intervals.median()), 1) if len(intervals) else None,
        primary_source=_primary_source(glucose),
    )


def coverage_limitation(quality: DataQuality | None) -> str | None:
    """What an incomplete record means for this finding, in one sentence.

    The engine qualifying its own answer, which is its job and which it already
    does everywhere else — a finding whose `limitations` list is empty is a bug
    in this codebase, not a strong result. Returning a sentence rather than
    letting a surface compose one keeps the claim where claims belong.

    Silent above the strong threshold. A complete record is the expected case
    and saying so on every finding would train readers to skip the line on the
    findings where it matters.
    """
    if quality is None or quality.coverage >= COVERAGE_FOR_STRONG:
        return None

    percent = round(quality.coverage * 100)
    return (
        f"Glucose was recorded for {percent}% of {quality.coverage_basis}, "
        "so this rests on a partial record"
    )


def _span_coverage(
    times: pd.Series, spans: Sequence[tuple[pd.Timestamp, pd.Timestamp]]
) -> float:
    """The share of the given spans that readings actually watched.

    Each reading vouches for half a maximum gap either side of itself. Those
    intervals are merged before they are measured, so a burst of readings a
    minute apart counts once rather than crediting the record for every one of
    them — which is the specific way a clustered record would otherwise look
    complete.
    """
    total = sum((e - s).total_seconds() for s, e in spans)
    if total <= 0:
        return 0.0

    reach = timedelta(minutes=COVERAGE_MAX_GAP_MINUTES / 2)
    watched = _merge([(t - reach, t + reach) for t in times])

    covered = 0.0
    for span_start, span_end in spans:
        for watch_start, watch_end in watched:
            overlap = (
                min(span_end, watch_end) - max(span_start, watch_start)
            ).total_seconds()
            if overlap > 0:
                covered += overlap

    return min(1.0, covered / total)


def _merge(
    intervals: Sequence[tuple[pd.Timestamp, pd.Timestamp]],
) -> list[tuple[pd.Timestamp, pd.Timestamp]]:
    """Overlapping intervals collapsed into disjoint ones."""
    merged: list[tuple[pd.Timestamp, pd.Timestamp]] = []
    for start, end in sorted(intervals):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def _morning_coverage(
    times: pd.Series, start: pd.Timestamp, end: pd.Timestamp
) -> float:
    """The share of mornings in the period that have a reading at all.

    Presence, not continuity, because that is what the finding is built from: a
    morning-glucose pattern takes one average per morning, so a morning with a
    single waking reading is a morning it can use and a morning with none is
    one it cannot. Measuring unbroken hours instead would mark down every
    person who tests on waking — the exact record this finding was written for
    — for not wearing a sensor.

    Read on the reader's own clock, because `patterns` has already moved these
    timestamps onto it and a morning has to be their morning.
    """
    days = max(1, int(np.ceil((end - start).total_seconds() / 86400)))

    in_morning = times[
        (times.dt.hour >= MORNING_START_HOUR) & (times.dt.hour < MORNING_END_HOUR)
    ]
    if in_morning.empty:
        return 0.0

    return min(1.0, float(in_morning.dt.date.nunique()) / days)


def _post_meal_coverage(
    responses: Sequence[MealResponse], meals_logged: int | None
) -> float:
    """The share of logged meals whose response was actually watched.

    Not a span calculation, and deliberately the same rule the post-meal
    measurements already use: a meal counts when its curve has enough points
    and runs most of the way through the window. That rule was written for
    those measurements and it is exactly the question here, so it is imported
    rather than reimplemented — two definitions of "watched long enough"
    drifting apart would put a coverage figure beside a set of measurements
    that disagreed with it.

    The denominator is every meal logged in the window, not every meal that
    produced a response. Those differ by exactly the meals with no glucose
    near them at all, which are the ones this figure most needs to count: a
    person who logged thirty meals and wore a sensor for ten days has twenty
    meals nobody watched, and dividing the watched meals by the meals that
    happened to have readings would report that record as complete.
    """
    total = len(responses) if meals_logged is None else meals_logged
    if total <= 0:
        return 0.0
    return min(1.0, len(measurable_responses(responses)) / total)


def _regular_fraction(intervals: pd.Series) -> float:
    """How much of the sampling kept to this record's own usual rhythm.

    Against the person's median rather than an absolute cadence: a meter user
    testing four times a day, every day, is sampling regularly, and a rule
    written around a sensor would call them chaotic for it.
    """
    if len(intervals) < 2:
        return 0.0

    median = float(intervals.median())
    if median <= 0:
        return 0.0

    low = median / IRREGULAR_INTERVAL_TOLERANCE
    high = median * IRREGULAR_INTERVAL_TOLERANCE
    return float(((intervals >= low) & (intervals <= high)).mean())


def _primary_source(glucose: pd.DataFrame) -> str:
    """Where most of these readings came from.

    Reported because it changes what the other figures mean. Two hours of
    coverage in a day is a thin record from a sensor and a normal one from a
    meter, and a clinician reading a coverage figure without knowing which is
    reading half a sentence.
    """
    if "source" not in glucose.columns or glucose.empty:
        return "unknown"

    kinds = glucose["source"].map(
        lambda s: "cgm" if s in _CGM_SOURCES else "meter" if s in _METER_SOURCES else "other"
    )
    counts = kinds.value_counts(normalize=True)
    top = str(counts.index[0])
    return top if float(counts.iloc[0]) >= 0.8 else "mixed"
