"""Pattern engine v1.

Finds repeatable personal patterns and reports them as structured findings with
an effect estimate, a confidence, a sample count, and explicit limitations.

Design rules this module follows:

* Every finding states what would make it stronger.
* Thin evidence produces an "insufficient data" finding, never a confident one.
* Association is reported as association. Nothing here claims causation —
  that is what the Living Trials experiments exist to test.
"""

from datetime import datetime, timedelta
from uuid import UUID

import numpy as np
import pandas as pd
from scipy import stats

from app.engines import glucose_data
from app.engines.thresholds import (
    MIN_SAMPLES_FOR_ANY_FINDING,
    POST_MEAL_WINDOW_MINUTES,
    TARGET_HIGH_MMOL,
    WALK_PROXIMITY_MINUTES,
)
from app.models.findings import StructuredFinding

MODEL_VERSION = "pattern-engine-v1.0.0"


def detect_all(user_id: UUID, start: datetime, end: datetime) -> list[StructuredFinding]:
    """Runs every pattern detector and returns whatever each could support."""
    glucose = glucose_data.load_glucose(user_id, start, end)
    meals = glucose_data.load_meals(user_id, start, end)
    activity = glucose_data.load_events(
        user_id, start, end, ["exercise_started", "exercise_ended"]
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
                would_improve_with=[
                    "Add glucose readings manually, or import a CGM or meter export"
                ],
            )
        ]

    findings: list[StructuredFinding] = []
    findings.append(_morning_glucose_pattern(glucose))

    if not meals.empty:
        findings.append(_post_meal_response(glucose, meals))
        findings.append(_late_meal_effect(glucose, meals))
        if not activity.empty:
            findings.append(_post_meal_walk_effect(glucose, meals, activity))

    return [f for f in findings if f is not None]


def _post_meal_responses(
    glucose: pd.DataFrame, meals: pd.DataFrame
) -> list[dict[str, float | pd.Timestamp]]:
    """For each meal, the glucose peak and rise within the post-meal window."""
    responses: list[dict[str, float | pd.Timestamp]] = []

    for _, meal in meals.iterrows():
        start = meal["started_at"]
        window_end = start + timedelta(minutes=POST_MEAL_WINDOW_MINUTES)

        # Baseline: the last reading at or just before the meal.
        baseline_rows = glucose[
            (glucose["measured_at"] <= start)
            & (glucose["measured_at"] >= start - timedelta(minutes=30))
        ]
        window = glucose[
            (glucose["measured_at"] > start) & (glucose["measured_at"] <= window_end)
        ]

        # A meal without a baseline reading *and* post-meal readings tells us
        # nothing about the response, so it is skipped rather than guessed at.
        if baseline_rows.empty or window.empty:
            continue

        baseline = float(baseline_rows.iloc[-1]["value_mmol"])
        peak = float(window["value_mmol"].max())

        responses.append(
            {
                "meal_started_at": start,
                "baseline": baseline,
                "peak": peak,
                "rise": peak - baseline,
                "carbs_g": float(meal["carbs_g"]),
                "hour": start.hour,
            }
        )

    return responses


def _post_meal_response(
    glucose: pd.DataFrame, meals: pd.DataFrame
) -> StructuredFinding | None:
    responses = _post_meal_responses(glucose, meals)
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
                "Log meals close to when you eat",
                "Wear a CGM, or take a reading before and about 90 minutes after meals",
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
            "Record portion sizes and carbohydrate estimates",
            "Log meal end times as well as start times",
        ],
    )


def _post_meal_walk_effect(
    glucose: pd.DataFrame, meals: pd.DataFrame, activity: pd.DataFrame
) -> StructuredFinding | None:
    """Compares meals followed by activity against meals that were not.

    This is an association between two groups the user created by living their
    life, not a randomised comparison. The finding says so, and points at the
    experiment that would actually test it.
    """
    responses = _post_meal_responses(glucose, meals)
    if not responses:
        return None

    starts = activity[activity["event_type"] == "exercise_started"]["occurred_at"]

    with_walk: list[float] = []
    without_walk: list[float] = []
    for response in responses:
        meal_time = response["meal_started_at"]
        walked = any(
            timedelta(0) <= (t - meal_time) <= timedelta(minutes=WALK_PROXIMITY_MINUTES)
            for t in starts
        )
        (with_walk if walked else without_walk).append(float(response["rise"]))

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
                f"Log at least {MIN_SAMPLES_FOR_ANY_FINDING} meals both with "
                "and without a walk afterwards",
                "Run a Living Trial that alternates walking and not walking after a similar meal",
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
            f"Statistical p-value: {float(p_value):.3f}",
        ],
        would_improve_with=[
            "Run a Living Trial: the same meal, alternating a walk and no walk",
            "Record how long and how briskly you walked",
        ],
    )


def _late_meal_effect(
    glucose: pd.DataFrame, meals: pd.DataFrame
) -> StructuredFinding | None:
    """Whether meals after 20:00 are followed by a different response."""
    responses = _post_meal_responses(glucose, meals)
    if not responses:
        return None

    late = [float(r["rise"]) for r in responses if int(r["hour"]) >= 20]
    earlier = [float(r["rise"]) for r in responses if int(r["hour"]) < 20]

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
            would_improve_with=["Keep logging meals across different times of day"],
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
            f"Statistical p-value: {float(p_value):.3f}",
        ],
        would_improve_with=[
            "Log sleep times so overnight recovery can be separated from meal timing",
            "Compare a similar meal eaten early and late in a Living Trial",
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
            would_improve_with=["Take a reading shortly after waking, or wear a CGM overnight"],
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
        would_improve_with=[
            "Log sleep start and end times",
            "Record evening meal times and medication timing",
        ],
    )
