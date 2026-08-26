"""Shared evidence thresholds.

Kept in one place so every engine describes uncertainty the same way, and so
the numbers can be reviewed as a set rather than hunted through the codebase.
"""

MIN_SAMPLES_FOR_ANY_FINDING = 5
"""Below this, the engine reports insufficient data rather than a weak finding."""

MIN_SAMPLES_FOR_MODERATE = 10
MIN_SAMPLES_FOR_STRONG = 20

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
