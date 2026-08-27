"""Tests for the pattern engine's honesty guarantees.

These are less about the arithmetic and more about the promises the product
makes: thin evidence must never look confident, and every finding must say what
it does not account for.
"""

from datetime import UTC, datetime, timedelta

import pandas as pd
import pytest

from app.engines import patterns, registry
from app.engines.thresholds import MIN_SAMPLES_FOR_ANY_FINDING, evidence_strength

BASE = datetime(2026, 8, 1, tzinfo=UTC)


def glucose_frame(rows: list[tuple[datetime, float]]) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "measured_at": pd.to_datetime([r[0] for r in rows], utc=True),
            "value_mmol": [r[1] for r in rows],
            "source": ["cgm_device"] * len(rows),
        }
    )


def meal_frame(starts: list[datetime], carbs: float = 45.0) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "id": [f"meal-{i}" for i in range(len(starts))],
            "started_at": pd.to_datetime(starts, utc=True),
            "meal_type": ["lunch"] * len(starts),
            "description": ["Test meal"] * len(starts),
            "confidence": [1.0] * len(starts),
            "carbs_g": [carbs] * len(starts),
            "protein_g": [20.0] * len(starts),
            "fat_g": [10.0] * len(starts),
            "fiber_g": [5.0] * len(starts),
            "item_count": [1] * len(starts),
        }
    )


def meal_with_response(
    start: datetime, baseline: float, peak: float
) -> list[tuple[datetime, float]]:
    """Readings that give a meal a measurable baseline and post-meal peak."""
    return [
        (start - timedelta(minutes=5), baseline),
        (start + timedelta(minutes=60), peak),
        (start + timedelta(minutes=120), baseline + 0.3),
    ]


class TestInsufficientData:
    def test_no_glucose_returns_an_explicit_insufficient_finding(self) -> None:
        result = patterns._morning_glucose_pattern(  # noqa: SLF001
            glucose_frame([(BASE.replace(hour=7), 6.5)])
        )
        assert result.confidence == 0.0
        assert result.sample_count < MIN_SAMPLES_FOR_ANY_FINDING
        assert result.effect_estimate is None
        assert result.limitations, "an insufficient finding must still say why"

    def test_thin_meal_data_never_produces_an_effect_estimate(self) -> None:
        starts = [BASE + timedelta(days=d, hours=12) for d in range(3)]
        rows: list[tuple[datetime, float]] = []
        for s in starts:
            rows.extend(meal_with_response(s, 6.0, 9.0))

        finding = patterns._post_meal_response(  # noqa: SLF001
            glucose_frame(rows), meal_frame(starts)
        )
        assert finding is not None
        assert finding.effect_estimate is None
        assert finding.confidence == 0.0
        assert finding.would_improve_with


class TestPostMealResponse:
    def test_recovers_a_known_average_rise(self) -> None:
        starts = [BASE + timedelta(days=d, hours=12) for d in range(20)]
        rows: list[tuple[datetime, float]] = []
        for s in starts:
            rows.extend(meal_with_response(s, 6.0, 9.0))

        finding = patterns._post_meal_response(  # noqa: SLF001
            glucose_frame(rows), meal_frame(starts)
        )
        assert finding is not None
        assert finding.effect_estimate == pytest.approx(3.0, abs=0.1)
        assert finding.sample_count == 20
        assert finding.limitations

    def test_skips_meals_without_a_baseline_reading(self) -> None:
        """A meal with no reading before it says nothing about the response."""
        starts = [BASE + timedelta(days=d, hours=12) for d in range(10)]
        rows: list[tuple[datetime, float]] = []
        for i, s in enumerate(starts):
            if i < 5:
                rows.extend(meal_with_response(s, 6.0, 9.0))
            else:
                rows.append((s + timedelta(minutes=60), 9.0))  # no baseline

        finding = patterns._post_meal_response(  # noqa: SLF001
            glucose_frame(rows), meal_frame(starts)
        )
        assert finding is not None
        assert finding.sample_count == 5


class TestWalkEffect:
    def test_recovers_a_planted_walk_effect(self) -> None:
        walk_starts = [BASE + timedelta(days=d, hours=12) for d in range(10)]
        no_walk_starts = [BASE + timedelta(days=d, hours=18) for d in range(10)]

        rows: list[tuple[datetime, float]] = []
        for i, s in enumerate(walk_starts):
            rows.extend(meal_with_response(s, 6.0, 8.0 + i * 0.05))  # rise ~2.0
        for i, s in enumerate(no_walk_starts):
            rows.extend(meal_with_response(s, 6.0, 9.5 + i * 0.05))  # rise ~3.5

        activity = pd.DataFrame(
            {
                "id": [f"act-{i}" for i in range(len(walk_starts))],
                "occurred_at": pd.to_datetime(
                    [s + timedelta(minutes=20) for s in walk_starts], utc=True
                ),
                "event_type": ["exercise_started"] * len(walk_starts),
                "source": ["manual"] * len(walk_starts),
                "confidence": [1.0] * len(walk_starts),
                "payload": [{}] * len(walk_starts),
            }
        )

        finding = patterns._post_meal_walk_effect(  # noqa: SLF001
            glucose_frame(rows),
            meal_frame(walk_starts + no_walk_starts),
            activity,
        )
        assert finding is not None
        assert finding.effect_estimate == pytest.approx(-1.5, abs=0.2)

    def test_reports_association_not_causation(self) -> None:
        """The wording and limitations must not imply a controlled result."""
        walk_starts = [BASE + timedelta(days=d, hours=12) for d in range(10)]
        no_walk_starts = [BASE + timedelta(days=d, hours=18) for d in range(10)]

        rows: list[tuple[datetime, float]] = []
        for i, s in enumerate(walk_starts):
            rows.extend(meal_with_response(s, 6.0, 8.0 + i * 0.05))
        for i, s in enumerate(no_walk_starts):
            rows.extend(meal_with_response(s, 6.0, 9.5 + i * 0.05))

        activity = pd.DataFrame(
            {
                "id": [f"act-{i}" for i in range(len(walk_starts))],
                "occurred_at": pd.to_datetime(
                    [s + timedelta(minutes=20) for s in walk_starts], utc=True
                ),
                "event_type": ["exercise_started"] * len(walk_starts),
                "source": ["manual"] * len(walk_starts),
                "confidence": [1.0] * len(walk_starts),
                "payload": [{}] * len(walk_starts),
            }
        )

        finding = patterns._post_meal_walk_effect(  # noqa: SLF001
            glucose_frame(rows), meal_frame(walk_starts + no_walk_starts), activity
        )
        assert finding is not None
        assert "associated with" in finding.summary
        assert any("not a controlled comparison" in lim for lim in finding.limitations)
        # Observational findings are capped below certainty however clean the split.
        assert finding.confidence <= 0.85


class TestEvidenceStrength:
    def test_matches_the_typescript_contract(self) -> None:
        """Mirrors the cases asserted in backend/test/safety.spec.ts."""
        assert evidence_strength(4, 0.99) == "insufficient"
        assert evidence_strength(500, 0.5) == "weak"
        assert evidence_strength(500, 0.7) == "moderate"
        assert evidence_strength(20, 0.8) == "strong"
        assert evidence_strength(19, 0.8) == "moderate"
        assert evidence_strength(20, 0.79) == "moderate"


# --- Detector registry ------------------------------------------------------
#
# The engine's own gate. These test that it refuses independently of whatever
# the backend does, because the backend is not the only thing that can call
# this service and a gate with one enforcement point is not a gate.


class TestDetectorRegistry:
    def test_type_2_detectors_declare_only_type_2_care_modes(self) -> None:
        # Every detector implemented today models Type 2 physiology. If one
        # ever declares support for another mode, that is a claim about the
        # body it was written for and should not pass unnoticed.
        for detector in patterns.DETECTORS:
            assert detector.supported_care_modes == registry.TYPE_2_CARE_MODES

    @pytest.mark.parametrize(
        "care_mode",
        [
            registry.CARE_MODE_TYPE_1,
            registry.CARE_MODE_GESTATIONAL,
            registry.CARE_MODE_PREDIABETES,
            registry.CARE_MODE_OTHER,
            registry.CARE_MODE_UNKNOWN,
        ],
    )
    def test_no_detector_runs_outside_its_care_modes(self, care_mode: str) -> None:
        for detector in patterns.DETECTORS:
            assert detector.allowed_for(care_mode, []) is False

    def test_insulin_supported_type_2_is_still_read_the_same_way(self) -> None:
        # Same physiology, same analysis. What insulin changes is which
        # experiments may be proposed, and that gate is elsewhere. Withholding
        # a correct analysis from these people would be the wrong caution.
        for detector in patterns.DETECTORS:
            assert detector.allowed_for(registry.CARE_MODE_TYPE_2_INSULIN, []) is True

    def test_a_blocked_flag_stops_a_detector_its_care_mode_allows(self) -> None:
        for detector in patterns.DETECTORS:
            assert detector.allowed_for(registry.CARE_MODE_TYPE_2_STANDARD, []) is True
            assert (
                detector.allowed_for(registry.CARE_MODE_TYPE_2_STANDARD, ["pregnancy"])
                is False
            )

    def test_an_unrecognised_care_mode_is_refused_rather_than_defaulted(self) -> None:
        for detector in patterns.DETECTORS:
            assert detector.allowed_for("something_invented", []) is False

    def test_refusal_is_a_finding_and_says_why(self) -> None:
        finding = registry.unsupported_finding(registry.CARE_MODE_TYPE_1)
        assert finding.finding_type == "care_mode_unsupported"
        assert finding.effect_estimate is None
        assert finding.sample_count == 0
        # Never an unqualified refusal, for the same reason a finding is never
        # an unqualified claim.
        assert finding.limitations
