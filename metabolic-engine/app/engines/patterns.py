"""Pattern engine v1.

Finds repeatable personal patterns and reports them as structured findings with
an effect estimate, a confidence, a sample count, and explicit limitations.

Design rules this module follows:

* Every finding states what would make it stronger.
* Thin evidence produces an "insufficient data" finding, never a confident one.
* Association is reported as association. Nothing here claims causation —
  that is what the Living Trials experiments exist to test.
"""

from collections.abc import Sequence
from datetime import datetime, timedelta
from uuid import UUID

import numpy as np
import pandas as pd
from scipy import stats

from app.engines import glucose_data, prediabetes, registry, suggestions
from app.engines.meal_response import MealResponse, post_meal_responses
from app.engines.thresholds import (
    LAB_TREND_LOOKBACK_DAYS,
    MIN_SAMPLES_FOR_ANY_FINDING,
    TARGET_HIGH_MMOL,
    WALK_PROXIMITY_MINUTES,
)
from app.models.findings import CurvePoint, GroupMeasure, StructuredFinding

MODEL_VERSION = "pattern-engine-v1.0.0"

_EMPTY_LABS = pd.DataFrame(
    columns=["id", "test_name", "value_numeric", "unit", "collected_at", "source"]
)


def detect_all(
    user_id: UUID,
    start: datetime,
    end: datetime,
    care_mode: str = registry.CARE_MODE_UNKNOWN,
    active_flags: Sequence[str] = (),
) -> list[StructuredFinding]:
    """Runs the detectors permitted for this care mode, and no others.

    The permission check happens before any data is loaded. Refusing after
    reading somebody's glucose would still be a refusal, but it would mean the
    engine had gone and fetched a record it had already decided it could not
    interpret.

    `care_mode` defaults to `unknown`, which nothing supports. A caller that
    omits it gets a refusal rather than the Type 2 analysis.
    """
    permitted = [d for d in DETECTORS if d.allowed_for(care_mode, active_flags)]
    if not permitted:
        return [registry.unsupported_finding(care_mode)]

    glucose = glucose_data.load_glucose(user_id, start, end)
    meals = glucose_data.load_meals(user_id, start, end)
    activity = glucose_data.load_events(
        user_id, start, end, ["exercise_started", "exercise_ended"]
    )
    # Only queried when something permitted here actually reads it, so a Type 2
    # request does exactly the work it did before labs existed.
    # Deliberately not the requested window. See LAB_TREND_LOOKBACK_DAYS: a
    # quarterly test has nothing to say inside thirty days, and reporting "not
    # enough results" to somebody with four years of them would be false.
    labs = (
        glucose_data.load_labs(
            user_id, end - timedelta(days=LAB_TREND_LOOKBACK_DAYS), end
        )
        if any(d.needs_labs for d in permitted)
        else _EMPTY_LABS
    )

    if glucose.empty:
        return [
            StructuredFinding(
                finding_type="insufficient_data",
                summary=(
                    "There are no glucose readings in this period, "
                    "so no patterns can be assessed."
                ),
                effect_estimate=None,
                effect_unit=None,
                confidence=0.0,
                sample_count=0,
                limitations=["No glucose data in the selected window"],
                would_improve_with=[suggestions.LOG_GLUCOSE],
            )
        ]

    inputs = registry.DetectorInputs(
        glucose=glucose, meals=meals, activity=activity, labs=labs
    )

    # A detector returns None when the signal it needs is absent entirely —
    # distinct from returning an "insufficient data" finding, which is a real
    # answer worth showing the user.
    candidates: list[StructuredFinding | None] = [d.run(inputs) for d in permitted]

    return [f for f in candidates if f is not None]


def _post_meal_response(
    glucose: pd.DataFrame, meals: pd.DataFrame
) -> StructuredFinding | None:
    responses = post_meal_responses(glucose, meals)
    n = len(responses)

    if n < MIN_SAMPLES_FOR_ANY_FINDING:
        return StructuredFinding(
            finding_type="post_meal_response",
            summary=(
                f"Only {n} meal(s) have both a before and after glucose reading, "
                "which is not enough to describe a typical response yet."
            ),
            effect_estimate=None,
            effect_unit=None,
            confidence=0.0,
            sample_count=n,
            limitations=[
                "Too few meals with paired glucose readings",
                "A meal needs a reading shortly before and within 2 hours after",
            ],
            would_improve_with=[
                suggestions.LOG_MEALS_PROMPTLY,
                suggestions.LOG_AROUND_MEALS,
            ],
        )

    rises = np.array([r["rise"] for r in responses], dtype=float)
    peaks = np.array([r["peak"] for r in responses], dtype=float)
    mean_rise = float(np.mean(rises))

    # Confidence combines sample size with how consistent the responses are:
    # a tight spread over many meals is trustworthy, a wide spread is not.
    spread = float(np.std(rises))
    consistency = 1.0 / (1.0 + spread) if spread > 0 else 1.0
    confidence = float(min(0.95, (min(n, 30) / 30) * 0.6 + consistency * 0.4))

    limitations = ["Meal composition varies between meals"]
    if float(np.mean([r["carbs_g"] for r in responses])) == 0.0:
        limitations.append(
            "No carbohydrate estimates were recorded, so meals cannot be compared by size"
        )
    if spread > 2.0:
        limitations.append(
            "Responses vary widely, so the average hides meal-to-meal differences"
        )

    return StructuredFinding(
        finding_type="post_meal_response",
        summary=(
            f"Across {n} meals, glucose rose by about {mean_rise:.1f} mmol/L on average, "
            f"peaking near {float(np.mean(peaks)):.1f} mmol/L."
        ),
        effect_estimate=round(mean_rise, 2),
        effect_unit="mmol/L rise from baseline",
        confidence=round(confidence, 2),
        sample_count=n,
        limitations=limitations,
        would_improve_with=[
            suggestions.LOG_MEAL_CARBS,
        ],
        comparison=[
            _group("A typical meal", responses)
        ],
    )


def _group(label: str, responses: Sequence[MealResponse]) -> GroupMeasure:
    """A comparison group: its endpoints, and the shape between them.

    Means rather than medians, to match the difference the finding reports — a
    chart drawn from medians beside a claim computed from means would be two
    different comparisons on one card.

    The curve is averaged per fifteen-minute bin across the group's meals, and
    a bin is kept only when at least a third of them have a reading in it. A
    mean over one straggling meal is not the group's response, and a curve that
    thinned out to a single meal at the tail would draw its noise as though it
    were the pattern.
    """
    if not responses:
        return GroupMeasure(label=label, n=0)

    baselines = [r["baseline"] for r in responses]
    peaks = [r["peak"] for r in responses]

    binned: dict[int, list[float]] = {}
    for response in responses:
        for minute, value in response["samples"].items():
            binned.setdefault(minute, []).append(value)

    threshold = max(1, len(responses) // 3)
    curve = [
        CurvePoint(minutes=minute, mmol=round(float(np.mean(values)), 2))
        for minute, values in sorted(binned.items())
        if len(values) >= threshold
    ]

    return GroupMeasure(
        label=label,
        n=len(responses),
        baseline_mmol=round(float(np.mean(baselines)), 2),
        peak_mmol=round(float(np.mean(peaks)), 2),
        curve=curve,
    )


def _post_meal_walk_effect(
    glucose: pd.DataFrame, meals: pd.DataFrame, activity: pd.DataFrame
) -> StructuredFinding | None:
    """Compares meals followed by activity against meals that were not.

    This is an association between two groups the user created by living their
    life, not a randomised comparison. The finding says so, and points at the
    experiment that would actually test it.
    """
    responses = post_meal_responses(glucose, meals)
    if not responses:
        return None

    starts = activity[activity["event_type"] == "exercise_started"]["occurred_at"]

    with_walk: list[float] = []
    without_walk: list[float] = []
    # Baselines and peaks alongside the rises. The difference is the finding;
    # these are what let it be drawn against the target band, which is the only
    # form in which a reader can see whether either group ended up in range.
    with_walk_group: list[MealResponse] = []
    without_walk_group: list[MealResponse] = []
    for response in responses:
        meal_time = response["meal_started_at"]
        walked = any(
            timedelta(0) <= (t - meal_time) <= timedelta(minutes=WALK_PROXIMITY_MINUTES)
            for t in starts
        )
        (with_walk if walked else without_walk).append(float(response["rise"]))
        (with_walk_group if walked else without_walk_group).append(response)

    n_with, n_without = len(with_walk), len(without_walk)

    if n_with < MIN_SAMPLES_FOR_ANY_FINDING or n_without < MIN_SAMPLES_FOR_ANY_FINDING:
        return StructuredFinding(
            finding_type="post_meal_walk_effect",
            summary=(
                f"There are {n_with} meals followed by activity and {n_without} without, "
                "which is not yet enough to compare the two."
            ),
            effect_estimate=None,
            effect_unit=None,
            confidence=0.0,
            sample_count=n_with + n_without,
            limitations=["Too few meals in one or both groups"],
            would_improve_with=[
                suggestions.paired_meals_needed(MIN_SAMPLES_FOR_ANY_FINDING),
                suggestions.ALTERNATE_WALKING,
            ],
        )

    difference = float(np.mean(with_walk) - np.mean(without_walk))
    t_stat, p_value = stats.ttest_ind(with_walk, without_walk, equal_var=False)

    # Statistical confidence is capped: this is observational data, and the
    # groups differ in ways beyond whether a walk happened.
    confidence = float(min(0.85, (1.0 - float(p_value)) * 0.9))

    direction = "lower" if difference < 0 else "higher"
    return StructuredFinding(
        finding_type="post_meal_walk_effect",
        summary=(
            f"Meals followed by activity within {WALK_PROXIMITY_MINUTES} minutes "
            f"were associated with a {abs(difference):.1f} mmol/L {direction} "
            f"glucose rise ({n_with} meals with activity vs {n_without} without)."
        ),
        effect_estimate=round(difference, 2),
        effect_unit="mmol/L difference in glucose rise",
        confidence=round(confidence, 2),
        sample_count=n_with + n_without,
        limitations=[
            "This is an observed association, not a controlled comparison",
            "Meals in the two groups were not matched for size or composition",
            "Activity intensity and duration were not accounted for",
        ],
        would_improve_with=[
            suggestions.ALTERNATE_WALKING,
            suggestions.LOG_ACTIVITY_MINUTES,
        ],
        comparison=[
            _group("Meals followed by a walk", with_walk_group),
            _group("Meals without one", without_walk_group),
        ],
        p_value=float(p_value),
    )


def _late_meal_effect(
    glucose: pd.DataFrame, meals: pd.DataFrame
) -> StructuredFinding | None:
    """Whether meals after 20:00 are followed by a different response."""
    responses = post_meal_responses(glucose, meals)
    if not responses:
        return None

    late = [float(r["rise"]) for r in responses if int(r["hour"]) >= 20]
    earlier = [float(r["rise"]) for r in responses if int(r["hour"]) < 20]
    late_group = [r for r in responses if r["hour"] >= 20]
    earlier_group = [r for r in responses if r["hour"] < 20]

    too_few_late = len(late) < MIN_SAMPLES_FOR_ANY_FINDING
    too_few_earlier = len(earlier) < MIN_SAMPLES_FOR_ANY_FINDING
    if too_few_late or too_few_earlier:
        return StructuredFinding(
            finding_type="late_evening_meal_response",
            summary=(
                f"There are {len(late)} late meals and {len(earlier)} earlier meals with "
                "paired readings — not enough to compare timing yet."
            ),
            effect_estimate=None,
            effect_unit=None,
            confidence=0.0,
            sample_count=len(late) + len(earlier),
            limitations=["Too few meals in one or both time groups"],
            would_improve_with=[suggestions.LOG_MEALS_ACROSS_THE_DAY],
        )

    difference = float(np.mean(late) - np.mean(earlier))
    _, p_value = stats.ttest_ind(late, earlier, equal_var=False)
    confidence = float(min(0.85, (1.0 - float(p_value)) * 0.9))

    direction = "larger" if difference > 0 else "smaller"
    return StructuredFinding(
        finding_type="late_evening_meal_response",
        summary=(
            f"Meals after 20:00 were followed by a {abs(difference):.1f} mmol/L {direction} "
            f"glucose rise than earlier meals ({len(late)} late vs {len(earlier)} earlier)."
        ),
        effect_estimate=round(difference, 2),
        effect_unit="mmol/L difference in glucose rise",
        confidence=round(confidence, 2),
        sample_count=len(late) + len(earlier),
        limitations=[
            "Late and earlier meals differ in composition as well as timing",
            "Sleep data was not included in this comparison",
        ],
        comparison=[
            _group("Meals after 20:00", late_group),
            _group("Earlier meals", earlier_group),
        ],
        p_value=float(p_value),
        would_improve_with=[
            suggestions.ALTERNATE_MEAL_TIMING,
        ],
    )


def _morning_glucose_pattern(glucose: pd.DataFrame) -> StructuredFinding:
    """Describes waking glucose (05:00-09:00) across the window."""
    morning = glucose[
        (glucose["measured_at"].dt.hour >= 5) & (glucose["measured_at"].dt.hour < 9)
    ]
    n_days = int(morning["measured_at"].dt.date.nunique()) if not morning.empty else 0

    if n_days < MIN_SAMPLES_FOR_ANY_FINDING:
        return StructuredFinding(
            finding_type="morning_glucose_pattern",
            summary=(
                f"Morning readings are available on only {n_days} day(s), "
                "which is not enough to describe a waking pattern."
            ),
            effect_estimate=None,
            effect_unit=None,
            confidence=0.0,
            sample_count=n_days,
            limitations=["Too few mornings with readings"],
            would_improve_with=[suggestions.LOG_WAKING_GLUCOSE],
        )

    daily_means = morning.groupby(morning["measured_at"].dt.date)["value_mmol"].mean()
    mean_morning = float(daily_means.mean())
    variability = float(daily_means.std())

    limitations = ["Morning readings are averaged across the 05:00-09:00 window"]
    if variability > 1.5:
        limitations.append("Morning glucose varies substantially between days")

    above_target_days = int((daily_means > TARGET_HIGH_MMOL).sum())
    if above_target_days:
        limitations.append(
            f"{above_target_days} of {n_days} mornings averaged above {TARGET_HIGH_MMOL} mmol/L"
        )

    return StructuredFinding(
        finding_type="morning_glucose_pattern",
        summary=(
            f"Morning glucose averaged {mean_morning:.1f} mmol/L across {n_days} days, "
            f"varying by about {variability:.1f} mmol/L between days."
        ),
        effect_estimate=round(mean_morning, 2),
        effect_unit="mmol/L average morning glucose",
        confidence=round(float(min(0.9, n_days / 30 * 0.9)), 2),
        sample_count=n_days,
        limitations=limitations,
        # Persistently raised morning glucose is a pattern worth a clinician's
        # eyes; the platform surfaces it rather than interpreting it.
        clinician_review_recommended=above_target_days >= max(3, n_days // 2),
        # A level rather than a rise: there is no baseline to move from, so the
        # value sits in `peak` and a chart draws one mark against the band
        # instead of a curve.
        comparison=[
            GroupMeasure(label="Morning average", n=n_days, peak_mmol=round(mean_morning, 2))
        ],
        would_improve_with=[
            suggestions.LOG_MEDICATION_TIMING,
        ],
    )


# --- Registry wiring --------------------------------------------------------
#
# The detectors above take the frames they actually need. Every detector in the
# registry is handed the same `DetectorInputs`, so these adapters bridge the two
# and keep the emptiness guards that used to live inline in `detect_all`.
#
# Those guards are behaviour, not tidiness. `_post_meal_response` called with no
# meals returns a real "insufficient data" finding saying zero meals had paired
# readings, which is true and which nobody asked: a person who has never logged
# a meal has not failed to log enough of them. Dropping the guard would put two
# new findings on the screen of every user who only records glucose.


def _morning_detector(i: registry.DetectorInputs) -> StructuredFinding | None:
    return _morning_glucose_pattern(i.glucose)


def _post_meal_detector(i: registry.DetectorInputs) -> StructuredFinding | None:
    return None if i.meals.empty else _post_meal_response(i.glucose, i.meals)


def _late_meal_detector(i: registry.DetectorInputs) -> StructuredFinding | None:
    return None if i.meals.empty else _late_meal_effect(i.glucose, i.meals)


def _walk_detector(i: registry.DetectorInputs) -> StructuredFinding | None:
    if i.meals.empty or i.activity.empty:
        return None
    return _post_meal_walk_effect(i.glucose, i.meals, i.activity)


_TYPE_2 = registry.TYPE_2_CARE_MODES
_PREDIABETES = frozenset({registry.CARE_MODE_PREDIABETES})
_BLOCKED = registry.PREGNANCY_BLOCKED

DETECTORS = registry.build_registry(
    [
        # --- Type 2. Unchanged, in the order they have always run. ----------
        registry.Detector("morning_glucose_pattern", _morning_detector, _TYPE_2, _BLOCKED),
        registry.Detector("post_meal_response", _post_meal_detector, _TYPE_2, _BLOCKED),
        registry.Detector("late_evening_meal_response", _late_meal_detector, _TYPE_2, _BLOCKED),
        registry.Detector("post_meal_walk_effect", _walk_detector, _TYPE_2, _BLOCKED),
        # --- Prediabetes. Deliberately not offered to Type 2 yet. -----------
        #
        # They would very likely be useful there, and that is exactly why they
        # are not switched on by assumption: "Type 2 output is unchanged" has
        # to be checkable, and adding four findings to every Type 2 screen in
        # the same change that introduces them would make it untestable.
        registry.Detector(
            "hba1c_trend", prediabetes.hba1c_trend, _PREDIABETES, _BLOCKED, needs_labs=True
        ),
        registry.Detector(
            "weight_trend", prediabetes.weight_trend, _PREDIABETES, _BLOCKED, needs_labs=True
        ),
        registry.Detector(
            "fasting_glucose_trend", prediabetes.fasting_glucose_trend, _PREDIABETES, _BLOCKED
        ),
        registry.Detector(
            "activity_consistency", prediabetes.activity_consistency, _PREDIABETES, _BLOCKED
        ),
        registry.Detector(
            "meal_timing_association", prediabetes.meal_timing_association, _PREDIABETES, _BLOCKED
        ),
    ]
)
