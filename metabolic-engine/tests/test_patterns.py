"""Tests for the pattern engine's honesty guarantees.

These are less about the arithmetic and more about the promises the product
makes: thin evidence must never look confident, and every finding must say what
it does not account for.
"""

from datetime import UTC, datetime, timedelta

import pandas as pd
import pytest

from app.engines import patterns, prediabetes, registry, suggestions
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


TYPE_2_DETECTORS = (
    "morning_glucose_pattern",
    "post_meal_response",
    "late_evening_meal_response",
    "post_meal_walk_effect",
)

PREDIABETES_DETECTORS = (
    "hba1c_trend",
    "weight_trend",
    "fasting_glucose_trend",
    "activity_consistency",
    "meal_timing_association",
)


def detectors_for(care_mode: str, flags: list[str] | None = None) -> list[str]:
    return [
        d.name for d in patterns.DETECTORS if d.allowed_for(care_mode, flags or [])
    ]


class TestDetectorRegistry:
    def test_type_2_gets_exactly_its_four_detectors_in_order(self) -> None:
        # The regression that matters. Prediabetes detectors would very likely
        # be useful here, and switching them on by assumption is precisely how
        # "Type 2 is unchanged" would stop being checkable.
        assert detectors_for(registry.CARE_MODE_TYPE_2_STANDARD) == list(
            TYPE_2_DETECTORS
        )

    def test_prediabetes_gets_only_its_own_set(self) -> None:
        assert detectors_for(registry.CARE_MODE_PREDIABETES) == list(
            PREDIABETES_DETECTORS
        )

    def test_the_two_sets_do_not_overlap(self) -> None:
        assert set(TYPE_2_DETECTORS).isdisjoint(PREDIABETES_DETECTORS)

    @pytest.mark.parametrize(
        "care_mode",
        [
            registry.CARE_MODE_TYPE_1,
            registry.CARE_MODE_GESTATIONAL,
            registry.CARE_MODE_OTHER,
            registry.CARE_MODE_UNKNOWN,
        ],
    )
    def test_unsupported_modes_get_nothing_at_all(self, care_mode: str) -> None:
        assert detectors_for(care_mode) == []

    def test_insulin_supported_type_2_is_read_the_same_way_as_type_2(self) -> None:
        # Same physiology, same analysis. What insulin changes is which
        # experiments may be proposed, and that gate is the safety
        # classifier's. Withholding a correct analysis would be the wrong
        # caution.
        assert detectors_for(registry.CARE_MODE_TYPE_2_INSULIN) == list(
            TYPE_2_DETECTORS
        )

    def test_pregnancy_stops_every_detector_whatever_the_mode(self) -> None:
        for care_mode in (
            registry.CARE_MODE_TYPE_2_STANDARD,
            registry.CARE_MODE_TYPE_2_INSULIN,
            registry.CARE_MODE_PREDIABETES,
        ):
            assert detectors_for(care_mode) != []
            assert detectors_for(care_mode, ["pregnancy"]) == []

    def test_an_unrecognised_care_mode_is_refused_rather_than_defaulted(self) -> None:
        assert detectors_for("something_invented") == []

    def test_only_the_lab_detectors_ask_for_labs(self) -> None:
        # The loader skips that query when nothing permitted wants it, so this
        # is what keeps a Type 2 request doing exactly the work it always did.
        needs = {d.name for d in patterns.DETECTORS if d.needs_labs}
        assert needs == {"hba1c_trend", "weight_trend"}

    def test_the_registry_refuses_a_detector_with_an_invalid_care_mode(self) -> None:
        # A typo would otherwise disable a detector silently and forever: it
        # would declare support for a mode nothing ever asks for.
        with pytest.raises(ValueError, match="unknown care modes"):
            registry.build_registry(
                [
                    registry.Detector(
                        "typo",
                        lambda _i: None,
                        frozenset({"type_2_standrd"}),
                    )
                ]
            )

    def test_the_registry_refuses_duplicate_names(self) -> None:
        with pytest.raises(ValueError, match="Duplicate detector names"):
            registry.build_registry(
                [
                    registry.Detector("same", lambda _i: None, registry.TYPE_2_CARE_MODES),
                    registry.Detector("same", lambda _i: None, registry.TYPE_2_CARE_MODES),
                ]
            )

    def test_refusal_is_a_finding_and_says_why(self) -> None:
        finding = registry.unsupported_finding(registry.CARE_MODE_TYPE_1)
        assert finding.finding_type == "care_mode_unsupported"
        assert finding.effect_estimate is None
        assert finding.sample_count == 0
        # Never an unqualified refusal, for the same reason a finding is never
        # an unqualified claim.
        assert finding.limitations


class TestSuggestionsAreCapturable:
    """Every suggestion must name something the product can actually record.

    The rule this enforces was broken before it existed: findings asked people
    to log sleep the product cannot store, meal end times the form does not
    collect, walking intensity nothing captures, and to run Living Trials,
    which do not exist. Someone following those would have gone looking for a
    control that was not there and concluded the product was broken.
    """

    def test_every_catalogued_suggestion_is_capturable(self) -> None:
        for suggestion in suggestions.ALL:
            assert suggestions.is_capturable(suggestion)

    def test_the_generated_one_is_recognised(self) -> None:
        assert suggestions.is_capturable(suggestions.paired_meals_needed(5))

    def test_something_uncatalogued_is_not(self) -> None:
        # The check has to be able to fail, or it is decoration.
        assert not suggestions.is_capturable("Log your sleep start and end times")
        assert not suggestions.is_capturable("Run a Living Trial")

    def test_no_detector_can_emit_an_uncapturable_suggestion(self) -> None:
        # Reads the source rather than running every detector against every
        # data shape: a suggestion that only appears on one rare branch is
        # exactly the one that would slip through a behavioural test.
        import inspect

        from app.engines import prediabetes

        for module in (patterns, prediabetes, registry):
            source = inspect.getsource(module)
            assert "Living Trial" not in source.replace(
                "that is what the Living Trials experiments exist to test", ""
            ), f"{module.__name__} still names a feature that does not exist"


class TestLabTrendReadsWhatWasRecorded:
    """The two ways a lab trend silently reports nothing, or reports nonsense.

    Both were real. The demo record stores HbA1c as "HbA1c" with the unit "%",
    while the contract's enum says "hba1c" and the detector assumed mmol/mol.
    An exact-match filter told somebody with eight results that they had none,
    and the unit assumption would have labelled a 7.4% reading as 7.4 mmol/mol.
    """

    @staticmethod
    def labs(rows: list[tuple[str, float, str, int]]) -> pd.DataFrame:
        return pd.DataFrame(
            {
                "id": [f"lab-{i}" for i in range(len(rows))],
                "test_name": [r[0] for r in rows],
                "value_numeric": [r[1] for r in rows],
                "unit": [r[2] for r in rows],
                "collected_at": pd.to_datetime(
                    [BASE - timedelta(days=r[3]) for r in rows], utc=True
                ),
                "source": ["lab_import"] * len(rows),
            }
        )

    def inputs(self, labs: pd.DataFrame) -> registry.DetectorInputs:
        empty = pd.DataFrame()
        return registry.DetectorInputs(
            glucose=empty, meals=empty, activity=empty, labs=labs
        )

    def test_matches_the_test_name_whatever_its_casing(self) -> None:
        # "HbA1c" is what a lab import writes. "hba1c" is what the enum says.
        finding = prediabetes.hba1c_trend(
            self.inputs(
                self.labs(
                    [("HbA1c", 42.0, "mmol/mol", 300),
                     ("HbA1c", 45.0, "mmol/mol", 150),
                     ("hba1c", 48.0, "mmol/mol", 10)]
                )
            )
        )
        assert finding is not None
        assert finding.sample_count == 3
        assert finding.effect_estimate is not None

    def test_reports_the_unit_the_results_were_recorded_in(self) -> None:
        # Percent, not the mmol/mol the detector was written around.
        finding = prediabetes.hba1c_trend(
            self.inputs(
                self.labs(
                    [("HbA1c", 6.8, "%", 300),
                     ("HbA1c", 7.1, "%", 150),
                     ("HbA1c", 7.4, "%", 10)]
                )
            )
        )
        assert finding is not None
        assert finding.effect_unit is not None
        assert "%" in finding.effect_unit
        assert "mmol/mol" not in finding.effect_unit
        assert "mmol/mol" not in finding.summary

    def test_refuses_to_trend_across_two_units(self) -> None:
        # 7% and 53 mmol/mol are the same reading on scales an order of
        # magnitude apart. A line through both is not a weak trend.
        finding = prediabetes.hba1c_trend(
            self.inputs(
                self.labs(
                    [("HbA1c", 6.8, "%", 300),
                     ("HbA1c", 53.0, "mmol/mol", 150),
                     ("HbA1c", 7.4, "%", 10)]
                )
            )
        )
        assert finding is not None
        assert finding.effect_estimate is None
        assert "more than one unit" in finding.summary

    def test_says_so_when_nothing_of_that_kind_was_recorded(self) -> None:
        finding = prediabetes.hba1c_trend(
            self.inputs(self.labs([("weight", 88.0, "kg", 30)]))
        )
        assert finding is not None
        assert finding.sample_count == 0
        assert finding.would_improve_with
        assert all(suggestions.is_capturable(w) for w in finding.would_improve_with)
