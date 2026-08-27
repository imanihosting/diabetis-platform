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


def evidence_strength(sample_count: int, confidence: float) -> str:
    """Maps sample size and confidence onto the single word shown to the user.

    Mirrors `evidenceStrength()` in @wellovue/types so the API, web app, and
    reports can never disagree about how strong a finding is.
    """
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
