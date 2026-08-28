"""Tests for coverage and evidence quality.

The rule being protected is one sentence: a finding must never look strong
because there are many readings, when those readings are clustered, incomplete,
or missing the window the finding is actually about.

Every way of getting this wrong flatters the record, so most of these tests are
about a number coming out lower than a sample count alone would give — and the
last group is the other half of the bargain, that a genuinely complete record
is not penalised for the new machinery existing.
"""

from datetime import UTC, datetime, timedelta

import pandas as pd

from app.engines import coverage, patterns
from app.engines.thresholds import (
    COVERAGE_FOR_MODERATE,
    COVERAGE_FOR_STRONG,
    COVERAGE_FOR_WEAK,
    evidence_strength,
)
from app.models.findings import DataQuality

WINDOW_START = datetime(2026, 8, 1, tzinfo=UTC)
WINDOW_DAYS = 30
WINDOW_END = WINDOW_START + timedelta(days=WINDOW_DAYS)


def glucose(times: list[datetime], source: str = "cgm_device") -> pd.DataFrame:
    return pd.DataFrame(
        {
            "measured_at": pd.to_datetime(times, utc=True),
            "value_mmol": [6.0] * len(times),
            "source": [source] * len(times),
        }
    )


def cgm(days: int, start: datetime = WINDOW_START, minutes: int = 15) -> list[datetime]:
    """A sensor worn continuously for `days`, at the usual cadence."""
    step = timedelta(minutes=minutes)
    count = int(days * 24 * 60 / minutes)
    return [start + step * i for i in range(count)]


def meter(days: int, hours: tuple[int, ...] = (7, 12, 18, 22)) -> list[datetime]:
    """Somebody testing by finger at the same times each day."""
    return [
        WINDOW_START + timedelta(days=d, hours=h) for d in range(days) for h in hours
    ]


def assess(
    times: list[datetime], basis: str, source: str = "cgm_device"
) -> DataQuality | None:
    return coverage.assess(glucose(times, source), WINDOW_START, WINDOW_END, basis)


class TestTheRuleThisExistsFor:
    def test_many_clustered_readings_cannot_be_strong_evidence(self) -> None:
        # Three days of sensor inside a thirty-day window: 288 readings, which
        # is far past any sample threshold, describing a tenth of the period.
        # This is the exact shape the ticket was written about.
        quality = assess(cgm(days=3), coverage.WHOLE_WINDOW)

        assert quality is not None
        assert quality.coverage < COVERAGE_FOR_MODERATE
        assert evidence_strength(288, 0.95) == "strong"
        assert evidence_strength(288, 0.95, quality.coverage) != "strong"

    def test_a_complete_record_is_not_penalised(self) -> None:
        # The other half. A month of continuous sensor keeps every word it had.
        quality = assess(cgm(days=WINDOW_DAYS), coverage.WHOLE_WINDOW)

        assert quality is not None
        assert quality.coverage >= COVERAGE_FOR_STRONG
        assert evidence_strength(288, 0.95, quality.coverage) == evidence_strength(288, 0.95)

    def test_coverage_can_only_lower_a_claim(self) -> None:
        # A ceiling, never a promotion. Perfect coverage over four readings is
        # still four readings, and a complete record is a precondition for
        # trusting a result rather than evidence for one.
        assert evidence_strength(4, 0.99, 1.0) == "insufficient"
        assert evidence_strength(12, 0.95, 1.0) == evidence_strength(12, 0.95)

    def test_omitting_coverage_is_the_behaviour_that_came_before(self) -> None:
        for n, confidence in ((3, 0.1), (8, 0.9), (15, 0.9), (40, 0.95)):
            assert evidence_strength(n, confidence, None) == evidence_strength(n, confidence)


class TestFairnessToAMeter:
    """A person who tests by finger must not be marked down for that alone."""

    def test_a_meter_covers_little_of_a_whole_month(self) -> None:
        # True, and the reason a whole-window figure is the wrong one to judge
        # most findings on.
        quality = assess(meter(WINDOW_DAYS), coverage.WHOLE_WINDOW, "glucose_meter")
        assert quality is not None
        assert quality.coverage < COVERAGE_FOR_WEAK

    def test_but_covers_its_mornings_completely(self) -> None:
        # One waking reading every morning is a complete morning record: the
        # finding takes one average per morning and there is one for each.
        quality = assess(meter(WINDOW_DAYS), coverage.MORNING, "glucose_meter")
        assert quality is not None
        assert quality.coverage == 1.0
        assert quality.primary_source == "meter"

    def test_a_sensor_worn_half_the_month_covers_half_the_mornings(self) -> None:
        quality = assess(cgm(days=15), coverage.MORNING)
        assert quality is not None
        assert quality.coverage == 0.5


class TestSignals:
    def test_counts_days_with_readings_against_days_in_the_window(self) -> None:
        quality = assess(cgm(days=4), coverage.WHOLE_WINDOW)
        assert quality is not None
        assert quality.days_with_data == 4
        assert quality.days_in_window == WINDOW_DAYS

    def test_reports_the_longest_stretch_with_nothing_in_it(self) -> None:
        times = cgm(days=1) + cgm(days=1, start=WINDOW_START + timedelta(days=9))
        quality = assess(times, coverage.WHOLE_WINDOW)
        assert quality is not None
        assert round(quality.largest_gap_hours) == 8 * 24

    def test_counts_repeated_timestamps(self) -> None:
        # A re-import adds rows and no observations, which is the one way a
        # sample count climbs while the record stands still.
        times = cgm(days=2)
        quality = assess(times + times[:10], coverage.WHOLE_WINDOW)
        assert quality is not None
        assert quality.duplicate_readings == 10

    def test_counts_days_too_thin_to_describe(self) -> None:
        # Placed after the dense stretch, so they are days in their own right
        # rather than single readings landing inside a day already covered.
        thin = [WINDOW_START + timedelta(days=d + 5, hours=8) for d in range(6)]
        quality = assess(cgm(days=2) + thin, coverage.WHOLE_WINDOW)
        assert quality is not None
        assert quality.sparse_days == 6

    def test_regularity_is_measured_against_the_record_s_own_rhythm(self) -> None:
        # A meter user testing at the same four times every day is sampling
        # regularly. A rule written around a sensor's cadence would call them
        # chaotic for it, and would be describing the device rather than them.
        steady = assess(meter(WINDOW_DAYS), coverage.WHOLE_WINDOW, "glucose_meter")
        assert steady is not None
        assert steady.regular_fraction > 0.5

    def test_names_where_the_readings_came_from(self) -> None:
        sensor = assess(cgm(days=2), coverage.WHOLE_WINDOW)
        finger = assess(meter(10), coverage.WHOLE_WINDOW, "glucose_meter")

        assert sensor is not None and finger is not None
        assert sensor.primary_source == "cgm"
        assert finger.primary_source == "meter"

        mixed = pd.concat(
            [glucose(cgm(days=2), "cgm_device"), glucose(meter(10), "glucose_meter")]
        ).sort_values("measured_at")
        quality = coverage.assess(mixed, WINDOW_START, WINDOW_END, coverage.WHOLE_WINDOW)
        assert quality is not None
        assert quality.primary_source in {"cgm", "mixed"}

    def test_says_nothing_at_all_for_an_empty_record(self) -> None:
        # The detector already reports "no readings" as its own finding. A
        # coverage of zero beside it would be a second, quieter way of saying
        # the same thing.
        assert coverage.assess(glucose([]), WINDOW_START, WINDOW_END, coverage.WHOLE_WINDOW) is None


class TestTheSentenceItAdds:
    def test_a_partial_record_says_so_in_the_finding(self) -> None:
        quality = assess(cgm(days=3), coverage.WHOLE_WINDOW)
        note = coverage.coverage_limitation(quality)

        assert note is not None
        assert "%" in note
        assert coverage.WHOLE_WINDOW in note

    def test_a_complete_record_stays_quiet(self) -> None:
        # Saying "coverage was fine" on every finding trains a reader to skip
        # the line, and then it is not read on the finding where it mattered.
        quality = assess(cgm(days=WINDOW_DAYS), coverage.WHOLE_WINDOW)
        assert coverage.coverage_limitation(quality) is None
        assert coverage.coverage_limitation(None) is None


class TestOnTheFindings:
    """The whole path: frames in, a finding carrying its own record quality."""

    @staticmethod
    def frames(sensor_days: int) -> tuple[pd.DataFrame, pd.DataFrame]:
        """A record with meals every day, and a sensor worn for only some."""
        starts = [WINDOW_START + timedelta(days=d, hours=12) for d in range(WINDOW_DAYS)]
        rows: list[datetime] = cgm(days=sensor_days)

        meals = pd.DataFrame(
            {
                "id": [f"meal-{i}" for i in range(len(starts))],
                "started_at": pd.to_datetime(starts, utc=True),
                "meal_type": ["lunch"] * len(starts),
                "description": ["Test meal"] * len(starts),
                "confidence": [1.0] * len(starts),
                "carbs_g": [45.0] * len(starts),
                "protein_g": [20.0] * len(starts),
                "fat_g": [10.0] * len(starts),
                "fiber_g": [5.0] * len(starts),
                "item_count": [1] * len(starts),
            }
        )
        return glucose(rows), meals

    def test_a_morning_finding_carries_its_morning_coverage(self) -> None:
        g, _ = self.frames(sensor_days=WINDOW_DAYS)
        finding = patterns._morning_glucose_pattern(  # noqa: SLF001
            g, (WINDOW_START, WINDOW_END)
        )

        assert finding.data_quality is not None
        assert finding.data_quality.coverage_basis == coverage.MORNING
        assert finding.data_quality.coverage == 1.0

    def test_a_meal_finding_is_judged_on_the_meals_it_watched(self) -> None:
        # Thirty meals logged, ten days of sensor. Two thirds of those meals
        # have no response recorded at all, and that is the coverage figure —
        # not the fraction of the month the sensor was on.
        g, meals = self.frames(sensor_days=10)
        finding = patterns._post_meal_response(  # noqa: SLF001
            g, meals, (WINDOW_START, WINDOW_END)
        )

        assert finding is not None
        assert finding.data_quality is not None
        assert finding.data_quality.coverage_basis == coverage.POST_MEAL
        assert 0.0 < finding.data_quality.coverage < 0.5

    def test_a_partial_record_reaches_the_limitations(self) -> None:
        g, meals = self.frames(sensor_days=10)
        finding = patterns._post_meal_response(  # noqa: SLF001
            g, meals, (WINDOW_START, WINDOW_END)
        )

        assert finding is not None
        assert any("partial record" in limit for limit in finding.limitations)

    def test_without_a_window_a_detector_behaves_as_it_did_before(self) -> None:
        # Every engine test written before coverage existed builds frames by
        # hand and asks a detector directly. Those must keep getting the
        # finding they got, not one claiming zero coverage.
        g, meals = self.frames(sensor_days=WINDOW_DAYS)

        without_window = patterns._post_meal_response(g, meals)  # noqa: SLF001
        assert without_window is not None
        assert without_window.data_quality is None
        assert patterns._morning_glucose_pattern(g).data_quality is None  # noqa: SLF001

    def test_a_complete_record_keeps_every_word_it_had(self) -> None:
        """The stability half of the ticket, on the whole path.

        A dense sensor record with a meal every day is the shape the demo
        account has, and it is the case that must not move: this change adds a
        ceiling, and a ceiling that lowers a complete record is a regression
        rather than a feature. Asserted by running each detector with and
        without the window and comparing the finding both ways, which is
        exactly the before and after of shipping this.
        """
        g, meals = self.frames(sensor_days=WINDOW_DAYS)
        window = (WINDOW_START, WINDOW_END)

        pairs = [
            (
                patterns._morning_glucose_pattern(g),  # noqa: SLF001
                patterns._morning_glucose_pattern(g, window),  # noqa: SLF001
            ),
            (
                patterns._post_meal_response(g, meals),  # noqa: SLF001
                patterns._post_meal_response(g, meals, window),  # noqa: SLF001
            ),
        ]

        for before, after in pairs:
            assert before is not None and after is not None

            assert after.effect_estimate == before.effect_estimate
            assert after.confidence == before.confidence
            assert after.sample_count == before.sample_count
            assert after.summary == before.summary

            # And the word itself, which is the thing this ticket changed.
            assert evidence_strength(
                after.sample_count,
                after.confidence,
                after.data_quality.coverage if after.data_quality else None,
            ) == evidence_strength(before.sample_count, before.confidence)

            # A complete record earns no caveat about being partial.
            assert after.limitations == before.limitations

    def test_the_contract_travels_under_the_names_typescript_expects(self) -> None:
        g, _ = self.frames(sensor_days=WINDOW_DAYS)
        finding = patterns._morning_glucose_pattern(  # noqa: SLF001
            g, (WINDOW_START, WINDOW_END)
        )
        assert finding.data_quality is not None

        assert set(finding.data_quality.model_dump(by_alias=True)) == {
            "coverage",
            "coverageBasis",
            "daysWithData",
            "daysInWindow",
            "sparseDays",
            "largestGapHours",
            "duplicateReadings",
            "regularFraction",
            "medianIntervalMinutes",
            "primarySource",
        }
        assert "dataQuality" in finding.model_dump(by_alias=True)
