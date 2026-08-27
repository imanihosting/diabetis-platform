"""The glucose response to a meal, computed once.

Extracted from `patterns` so the prediabetes detectors can use it without
importing that module, which imports the registry, which would close an import
cycle. A pure function over two frames: it belongs to neither care mode.
"""

from datetime import timedelta

import pandas as pd

from app.engines.thresholds import POST_MEAL_WINDOW_MINUTES


def post_meal_responses(
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
