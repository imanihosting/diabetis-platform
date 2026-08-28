"""The glucose response to a meal, computed once.

Extracted from `patterns` so the prediabetes detectors can use it without
importing that module, which imports the registry, which would close an import
cycle. A pure function over two frames: it belongs to neither care mode.
"""

from datetime import timedelta
from typing import TypedDict

import pandas as pd

from app.engines.thresholds import POST_MEAL_WINDOW_MINUTES

CURVE_STEP_MINUTES = 15
"""How finely a response is sampled when its shape is kept.

Fifteen minutes matches a CGM's own cadence closely enough that the mean curve
is drawn through real readings rather than through interpolation between two
distant ones, and coarsely enough that a meal logged against a fingerstick
meter still lands in a bin.
"""


class MealResponse(TypedDict):
    """One meal's glucose response.

    A TypedDict rather than a loose dict because the shape grew: it used to be
    five floats and a timestamp, and `samples` made it heterogeneous enough
    that every caller was casting on the way out.
    """

    meal_started_at: pd.Timestamp
    baseline: float
    peak: float
    rise: float
    carbs_g: float
    hour: int
    samples: dict[int, float]


def post_meal_responses(
    glucose: pd.DataFrame, meals: pd.DataFrame
) -> list[MealResponse]:
    """For each meal, the glucose peak and rise within the post-meal window."""
    responses: list[MealResponse] = []

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
            MealResponse(
                meal_started_at=start,
                baseline=baseline,
                peak=peak,
                rise=peak - baseline,
                carbs_g=float(meal["carbs_g"]),
                hour=int(start.hour),
                # The shape, not just its two extremes. A finding that keeps
                # only baseline and peak can be stated as a sentence and drawn
                # as two dots; keeping the samples lets it be drawn as the
                # glucose curve it actually was.
                samples=_samples(start, baseline, window),
            )
        )

    return responses


def _samples(
    start: pd.Timestamp, baseline: float, window: pd.DataFrame
) -> dict[int, float]:
    """Readings in the window, binned by minutes since the meal.

    Keyed by bin so several meals can be averaged at the same offset without
    any of them needing to have a reading at exactly that moment. Minute zero
    is the baseline, which is what makes every curve start from the reading the
    rise was measured against rather than from wherever the first post-meal
    sample happened to land.
    """
    samples: dict[int, list[float]] = {0: [baseline]}

    for _, row in window.iterrows():
        offset = (row["measured_at"] - start).total_seconds() / 60.0
        binned = int(round(offset / CURVE_STEP_MINUTES) * CURVE_STEP_MINUTES)
        if binned <= 0:
            continue
        samples.setdefault(binned, []).append(float(row["value_mmol"]))

    return {minute: sum(values) / len(values) for minute, values in samples.items()}
