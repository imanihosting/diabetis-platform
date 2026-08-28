"""Detectors for prediabetes.

A different question from the Type 2 ones. Type 2 asks what a body is doing
with a meal today; prediabetes asks which way things are moving over months,
because the thing a person can act on is a direction rather than a single
morning. So these are trends and consistencies, and their units are "per 90
days" rather than "mmol/L above baseline".

Nothing here claims a threshold has been crossed or a diagnosis has changed.
A trend is a description of the recorded numbers, and a lab result is what
decides anything — which is why the findings say so and point at recording the
next one rather than at interpreting this one.
"""

import numpy as np
import pandas as pd
from scipy import stats

from app.engines import suggestions
from app.engines.meal_response import post_meal_responses
from app.engines.registry import DetectorFn, DetectorInputs
from app.engines.thresholds import (
    MIN_DAYS_FOR_ACTIVITY_CONSISTENCY,
    MIN_LAB_POINTS_FOR_TREND,
    MIN_SAMPLES_FOR_ANY_FINDING,
    WEIGHT_TREND_DAYS,
)
from app.models.findings import StructuredFinding


def _linear_trend(
    times: pd.Series, values: pd.Series
) -> tuple[float, float, float] | None:
    """Slope per day, r-squared, and the p-value. None when it cannot be fitted.

    Ordinary least squares over elapsed days. Deliberately not a smarter model:
    with a handful of quarterly lab results there is nothing for one to learn,
    and a curve fitted through four points would look far more certain than it
    is.
    """
    if len(values) < 2:
        return None

    days = (times - times.min()).dt.total_seconds() / 86_400.0
    if float(days.max()) <= 0:
        # Everything on the same day. A trend needs elapsed time, and dividing
        # by a zero span would produce an infinite slope rather than an error.
        return None

    result = stats.linregress(days.to_numpy(dtype=float), values.to_numpy(dtype=float))
    return float(result.slope), float(result.rvalue) ** 2, float(result.pvalue)


def lab_trend_detector(
    *,
    test_name: str,
    finding_type: str,
    label: str,
    per_days: int,
    unit: str,
    log_suggestion: str,
) -> DetectorFn:
    """Builds a trend detector for one named lab or body measurement.

    Parameterised because HbA1c and weight are the same computation with
    different words around them: a series of dated numbers, a slope, and a
    statement about direction. Writing them twice would mean fixing any
    weakness in the reasoning twice.

    `unit` is a fallback only. The real unit comes from the recorded results,
    because HbA1c is reported as a percentage in some places and in mmol/mol
    in others, and a detector that assumed one would put the wrong label on the
    other's numbers.
    """

    def detect(inputs: DetectorInputs) -> StructuredFinding | None:
        labs = inputs.labs
        if labs.empty:
            return None
        # Case-insensitive. A lab import carries whatever the source called the
        # test — the demo record holds "HbA1c", the contract's enum says
        # "hba1c" — and an exact match would tell somebody with eight results
        # that they had none.
        matches = labs["test_name"].str.strip().str.casefold() == test_name.casefold()
        series = labs[matches].sort_values("collected_at")
        if series.empty:
            # Nothing of this kind recorded at all. Distinct from too few to
            # trend: the person may not know the product accepts it.
            return StructuredFinding(
                finding_type=finding_type,
                summary=f"No {label} results have been recorded, so there is no trend to show.",
                effect_estimate=None,
                effect_unit=None,
                confidence=0.0,
                sample_count=0,
                limitations=[f"No {label} results in this period"],
                would_improve_with=[log_suggestion],
            )

        n = len(series)
        if n < MIN_LAB_POINTS_FOR_TREND:
            return StructuredFinding(
                finding_type=finding_type,
                summary=(
                    f"There {'is' if n == 1 else 'are'} {n} {label} "
                    f"result{'' if n == 1 else 's'} recorded, which is not enough "
                    "to describe a direction."
                ),
                effect_estimate=None,
                effect_unit=None,
                confidence=0.0,
                sample_count=n,
                limitations=[
                    f"A trend needs at least {MIN_LAB_POINTS_FOR_TREND} results",
                    "Two results are a difference, not a direction",
                ],
                would_improve_with=[log_suggestion],
            )

        fitted = _linear_trend(series["collected_at"], series["value_numeric"])
        if fitted is None:
            return StructuredFinding(
                finding_type=finding_type,
                summary=(
                    f"All {n} {label} results were recorded on the same day, so "
                    "no direction can be read from them."
                ),
                effect_estimate=None,
                effect_unit=None,
                confidence=0.0,
                sample_count=n,
                limitations=["A trend needs results spread over time"],
                would_improve_with=[log_suggestion],
            )

        # Units are taken from the results, never assumed. Two HbA1c results,
        # one in % and one in mmol/mol, describe the same thing on scales that
        # differ by roughly a factor of ten: a slope fitted across both is not
        # a weak trend, it is a meaningless one.
        recorded_units = {
            str(u).strip() for u in series["unit"].dropna().unique() if str(u).strip()
        }
        if len(recorded_units) > 1:
            return StructuredFinding(
                finding_type=finding_type,
                summary=(
                    f"{label} results are recorded in more than one unit "
                    f"({', '.join(sorted(recorded_units))}), so they cannot be "
                    "put on one trend."
                ),
                effect_estimate=None,
                effect_unit=None,
                confidence=0.0,
                sample_count=n,
                limitations=[
                    "Values on different scales cannot be compared directly",
                    "Nothing has been converted, because a converted result "
                    "that was converted wrongly cannot be recovered",
                ],
                would_improve_with=[log_suggestion],
            )
        measured_in = recorded_units.pop() if recorded_units else unit

        slope_per_day, r_squared, p_value = fitted
        change = slope_per_day * per_days
        span_days = float(
            (series["collected_at"].max() - series["collected_at"].min()).total_seconds()
            / 86_400.0
        )

        # How well a straight line fits, tempered by how few points it was
        # fitted through. Four results that happen to line up are not the same
        # evidence as twelve that do.
        confidence = float(min(0.8, r_squared * min(n, 8) / 8))

        direction = "rising" if change > 0 else "falling" if change < 0 else "flat"
        first = float(series["value_numeric"].iloc[0])
        last = float(series["value_numeric"].iloc[-1])

        limitations = [
            f"A straight line through {n} results over {span_days:.0f} days",
            # The rest of the screen shows the window the reader chose. This
            # does not, and saying so is the difference between a longer view
            # and a wrong one.
            "Looks back further than the period selected above, because these "
            "results are taken months apart",
            "Lab results come from different draws and sometimes different "
            "laboratories, which vary between themselves",
        ]
        if n < 5:
            limitations.append("Any single result moves this trend noticeably")

        return StructuredFinding(
            finding_type=finding_type,
            summary=(
                f"{label} has been {direction} by about {abs(change):.1f} {measured_in} "
                f"per {per_days} days across {n} results "
                f"({first:.1f} to {last:.1f} {measured_in})."
            ),
            effect_estimate=round(change, 2),
            effect_unit=f"{measured_in} per {per_days} days",
            confidence=round(confidence, 2),
            sample_count=n,
            limitations=limitations,
            would_improve_with=[log_suggestion],
            p_value=float(p_value),
        )

    return detect


def fasting_glucose_trend(inputs: DetectorInputs) -> StructuredFinding | None:
    """Which way waking glucose is moving across the window.

    Read from the dense glucose record rather than from lab fasting-glucose
    results: a CGM or a habit of testing on waking produces far more points
    than a lab does, and a direction is what this detector is for.
    """
    glucose = inputs.glucose
    if glucose.empty:
        return None

    morning = glucose[
        (glucose["measured_at"].dt.hour >= 5) & (glucose["measured_at"].dt.hour < 9)
    ]
    daily = morning.groupby(morning["measured_at"].dt.date)["value_mmol"].mean()
    n_days = int(len(daily))

    if n_days < MIN_SAMPLES_FOR_ANY_FINDING:
        return StructuredFinding(
            finding_type="fasting_glucose_trend",
            summary=(
                f"Waking glucose is recorded on {n_days} day(s), which is not "
                "enough to show a direction."
            ),
            effect_estimate=None,
            effect_unit=None,
            confidence=0.0,
            sample_count=n_days,
            limitations=["Too few mornings with readings"],
            would_improve_with=[suggestions.LOG_WAKING_GLUCOSE],
        )

    times = pd.to_datetime(pd.Series(daily.index.astype(str)), utc=True)
    fitted = _linear_trend(times, pd.Series(daily.to_numpy(dtype=float)))
    if fitted is None:
        return None

    slope_per_day, r_squared, p_value = fitted
    change = slope_per_day * 30
    confidence = float(min(0.8, r_squared * min(n_days, 30) / 30))
    direction = "rising" if change > 0 else "falling" if change < 0 else "flat"

    return StructuredFinding(
        finding_type="fasting_glucose_trend",
        summary=(
            f"Waking glucose has been {direction} by about {abs(change):.2f} mmol/L "
            f"every 30 days across {n_days} days."
        ),
        effect_estimate=round(change, 2),
        effect_unit="mmol/L per 30 days",
        confidence=round(confidence, 2),
        sample_count=n_days,
        limitations=[
            "Daily averages across the 05:00-09:00 window, not true fasting values",
            "A reading taken after eating early would be counted as a morning value",
        ],
        would_improve_with=[suggestions.LOG_WAKING_GLUCOSE, suggestions.LOG_HBA1C],
        p_value=float(p_value),
    )


def activity_consistency(inputs: DetectorInputs) -> StructuredFinding | None:
    """How regularly activity happens, rather than how much of it there is.

    Consistency rather than volume on purpose. Total minutes rewards one long
    walk a fortnight, which is not what changes anything, and it is the kind of
    number that makes somebody feel they have done well while nothing moves.
    """
    activity = inputs.activity
    glucose = inputs.glucose
    if glucose.empty:
        return None

    span_days = int(
        (glucose["measured_at"].max() - glucose["measured_at"].min()).days
    ) + 1
    if span_days < MIN_DAYS_FOR_ACTIVITY_CONSISTENCY:
        return StructuredFinding(
            finding_type="activity_consistency",
            summary=(
                f"There are only {span_days} days of records here, which is too "
                "short a period to describe a habit."
            ),
            effect_estimate=None,
            effect_unit=None,
            confidence=0.0,
            sample_count=span_days,
            limitations=[
                f"At least {MIN_DAYS_FOR_ACTIVITY_CONSISTENCY} days are needed"
            ],
            would_improve_with=[suggestions.LOG_ACTIVITY_MINUTES],
        )

    starts = (
        activity[activity["event_type"] == "exercise_started"]
        if not activity.empty
        else pd.DataFrame(columns=["occurred_at"])
    )
    active_days = (
        int(starts["occurred_at"].dt.date.nunique()) if not starts.empty else 0
    )
    share = active_days / span_days

    return StructuredFinding(
        finding_type="activity_consistency",
        summary=(
            f"Activity was recorded on {active_days} of {span_days} days, "
            f"about {share * 100:.0f}% of them."
        ),
        effect_estimate=round(share * 100, 1),
        effect_unit="% of days with recorded activity",
        confidence=round(float(min(0.7, span_days / 60)), 2),
        sample_count=span_days,
        limitations=[
            "Counts only activity that was logged, so unlogged movement is missing",
            "A day counts the same whether the walk was five minutes or an hour",
        ],
        would_improve_with=[suggestions.LOG_ACTIVITY_MINUTES],
    )


def meal_timing_association(inputs: DetectorInputs) -> StructuredFinding | None:
    """Whether the hour a meal is eaten tracks with the rise that follows.

    A correlation across every meal rather than the early/late split the Type 2
    detector uses. For someone who is not diabetic yet the interesting question
    is whether a pattern exists at all, not whether one particular boundary
    matters.
    """
    responses = post_meal_responses(inputs.glucose, inputs.meals)
    n = len(responses)
    if n == 0:
        return None

    if n < MIN_SAMPLES_FOR_ANY_FINDING:
        return StructuredFinding(
            finding_type="meal_timing_association",
            summary=(
                f"Only {n} meal(s) have both a before and after reading, which "
                "is not enough to compare timings."
            ),
            effect_estimate=None,
            effect_unit=None,
            confidence=0.0,
            sample_count=n,
            limitations=["Too few meals with paired glucose readings"],
            would_improve_with=[
                suggestions.LOG_MEALS_PROMPTLY,
                suggestions.LOG_AROUND_MEALS,
            ],
        )

    hours = np.array([float(r["hour"]) for r in responses])
    rises = np.array([float(r["rise"]) for r in responses])

    if float(np.std(hours)) == 0.0:
        return StructuredFinding(
            finding_type="meal_timing_association",
            summary=(
                f"All {n} recorded meals were eaten at the same hour, so timing "
                "cannot be compared."
            ),
            effect_estimate=None,
            effect_unit=None,
            confidence=0.0,
            sample_count=n,
            limitations=["Every meal was logged at the same time of day"],
            would_improve_with=[suggestions.LOG_MEALS_ACROSS_THE_DAY],
        )

    correlation, p_value = stats.pearsonr(hours, rises)
    direction = "larger" if correlation > 0 else "smaller"

    return StructuredFinding(
        finding_type="meal_timing_association",
        summary=(
            f"Later meals were associated with a {direction} glucose rise across "
            f"{n} meals (correlation {float(correlation):.2f})."
        ),
        effect_estimate=round(float(correlation), 2),
        effect_unit="correlation between meal hour and glucose rise",
        confidence=round(float(min(0.75, (1.0 - float(p_value)) * 0.8)), 2),
        sample_count=n,
        limitations=[
            "An association across meals that differ in what they contained",
            "Correlation describes a tendency, not a cause",
            "The hour a meal is logged is not always the hour it was eaten",
        ],
        would_improve_with=[
            suggestions.LOG_MEAL_CARBS,
            suggestions.ALTERNATE_MEAL_TIMING,
        ],
        p_value=float(p_value),
    )


hba1c_trend = lab_trend_detector(
    test_name="hba1c",
    finding_type="hba1c_trend",
    label="HbA1c",
    # A quarter, because that is roughly the period an HbA1c reflects and
    # roughly how often one is taken.
    per_days=90,
    unit="mmol/mol",
    log_suggestion=suggestions.LOG_HBA1C,
)

weight_trend = lab_trend_detector(
    test_name="weight",
    finding_type="weight_trend",
    label="Weight",
    per_days=WEIGHT_TREND_DAYS,
    unit="kg",
    log_suggestion=suggestions.LOG_WEIGHT,
)
