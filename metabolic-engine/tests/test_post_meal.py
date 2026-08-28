"""Tests for the post-meal measurements.

Two things are being protected here, and they pull in opposite directions.

The arithmetic has to be right, because these numbers are the ones a person
will repeat to a clinician: "it peaks about an hour after I eat and takes
another hour to come down" is a sentence somebody will say out loud on the
strength of this screen. Every expected value below was worked out by hand from
the curve in the test, not read off the implementation.

And the absence has to be right, because every way this can be wrong makes a
meal look better than it was. A response watched for forty-five minutes reports
a shorter time above range and an earlier return than the same meal watched for
two hours. Silence is the only honest answer there, and most of these tests are
about getting silence rather than a number.
"""

import pandas as pd
import pytest

from app.engines import patterns
from app.engines.meal_response import MealResponse
from app.engines.post_meal import post_meal_metrics
from app.engines.thresholds import (
    MIN_SAMPLES_FOR_ANY_FINDING,
    POST_MEAL_MIN_COVERAGE,
    POST_MEAL_MIN_CURVE_POINTS,
    POST_MEAL_WINDOW_MINUTES,
    TARGET_HIGH_MMOL,
)
from app.models.findings import PostMealMetrics

# A response that rises through target range, peaks at an hour, and is back
# under the line before the window closes. Worked through by hand:
#
#   crosses 10.0 upward between 30 and 45  ->  9.0 + (11.0-9.0)/2 = 10.0 at 37.5
#   crosses 10.0 downward between 90 and 105 -> 10.5 falls 1.5 over 15 min,
#                                               reaching 10.0 a third of the way, at 95.0
#   time above range  = 95.0 - 37.5 = 57.5 min
#   area above range  = 3.75 + 22.5 + 22.5 + 11.25 + 1.25 = 61.25 mmol/L*min
RETURNS = {0: 6.0, 15: 7.0, 30: 9.0, 45: 11.0, 60: 12.0, 75: 11.0, 90: 10.5, 105: 9.0, 120: 8.0}

# Never leaves range, and barely moves: 1.5 mmol/L from baseline.
FLAT = {0: 5.0, 30: 6.0, 60: 6.5, 90: 6.2, 120: 5.8}

# Up fast, peaked at half an hour, down again.
#   up-crossing between 15 and 30 at 22.5, down-crossing at exactly 45
#   time above = 22.5, area = 3.75 + 7.5 = 11.25
SHARP = {0: 6.0, 15: 9.0, 30: 11.0, 45: 10.0, 60: 9.0, 90: 8.0, 120: 7.5}

# Still climbing when the window ends, but never above the line.
DELAYED = {0: 6.0, 30: 6.5, 60: 7.5, 90: 8.5, 120: 9.5}

# Above the line for most of two hours and still above at the end.
#   up-crossing between 0 and 30 at 22.5 -> 97.5 min above
#   area = 3.75 + 45 + 67.5 + 60 = 176.25
PROLONGED = {0: 7.0, 30: 11.0, 60: 12.0, 90: 12.5, 120: 11.5}

# The classic fingerstick pattern: before, an hour, two hours. Three points and
# nothing else, and this person is exactly who these measurements are for.
#   up-crossing at 12 min after the meal, down-crossing at 80
FINGERSTICK = {0: 6.0, 60: 11.0, 120: 8.0}


def response(samples: dict[int, float]) -> MealResponse:
    """One meal's response, built from its curve alone.

    Baseline and peak are derived from the samples rather than passed in, so a
    test cannot accidentally describe a meal whose curve and whose endpoints
    disagree.
    """
    after = {m: v for m, v in samples.items() if m > 0}
    return MealResponse(
        meal_started_at=pd.Timestamp("2026-08-01T12:00:00Z"),
        baseline=samples[0],
        peak=max(after.values()),
        rise=max(after.values()) - samples[0],
        carbs_g=45.0,
        hour=12,
        samples=dict(samples),
    )


def group_of(samples: dict[int, float], count: int) -> list[MealResponse]:
    return [response(samples) for _ in range(count)]


def rise_of(samples: dict[int, float]) -> float:
    after = [v for m, v in samples.items() if m > 0]
    return max(after) - samples[0]


def metrics_for(
    samples: dict[int, float], count: int = MIN_SAMPLES_FOR_ANY_FINDING
) -> PostMealMetrics | None:
    return post_meal_metrics(group_of(samples, count), rise_of(samples))


class TestArithmetic:
    """Every expectation here was computed from the curve by hand."""

    def test_measures_the_response_a_reader_would_describe(self) -> None:
        m = metrics_for(RETURNS)

        assert m is not None
        assert m.time_to_peak_minutes == 60.0
        assert m.minutes_above_range == 57.5
        assert m.return_to_range_minutes == 95.0
        # 61.25 by hand; the model reports one decimal place.
        assert m.area_above_range == pytest.approx(61.25, abs=0.05)
        assert m.still_above_at_window_end == 0

    def test_interpolates_the_crossings_rather_than_counting_whole_bins(self) -> None:
        # The up-crossing is mid-bin at 37.5 and the down-crossing a third of
        # the way through its bin at 95.0. Counting bins whole would give 60
        # minutes above range and an exact multiple of the step, which is the
        # tell that a number was rounded to the sampling cadence rather than
        # measured against the target line the chart draws.
        m = metrics_for(RETURNS)

        assert m is not None
        assert m.minutes_above_range % 15 != 0

    def test_reports_nothing_above_range_when_a_response_stays_in_it(self) -> None:
        m = metrics_for(FLAT)

        assert m is not None
        assert m.minutes_above_range == 0.0
        assert m.area_above_range == 0.0
        # Nothing went above target, so there was nothing to come back from.
        assert m.return_to_range_minutes is None
        assert m.still_above_at_window_end == 0

    def test_times_the_peak_from_the_readings_after_the_meal(self) -> None:
        # Minute zero is the baseline. A response that only ever fell would
        # otherwise be reported as peaking at the moment of the meal.
        m = metrics_for({0: 9.0, 30: 8.0, 60: 7.5, 90: 7.0, 120: 6.5})

        assert m is not None
        assert m.time_to_peak_minutes == 30.0

    def test_measures_a_three_point_fingerstick_response(self) -> None:
        m = metrics_for(FINGERSTICK)

        assert m is not None
        assert m.time_to_peak_minutes == 60.0
        assert m.minutes_above_range == pytest.approx(32.0)
        assert m.return_to_range_minutes == pytest.approx(80.0)

    def test_averages_the_meals_rather_than_the_curves(self) -> None:
        # The whole reason these are computed per meal and then averaged. Two
        # meals that both peak above target, a bin apart, average into a mean
        # curve that peaks lower than either of them — at 9.75 here, inside
        # range. Measuring off that curve would report a person who was above
        # target in both meals as never having left it.
        early = {0: 6.0, 30: 10.5, 60: 6.5, 90: 6.2, 120: 6.0}
        late = {0: 6.0, 30: 6.5, 60: 10.5, 90: 6.2, 120: 6.0}

        m = post_meal_metrics(
            group_of(early, 3) + group_of(late, 3), rise_of(early)
        )

        assert m is not None
        assert m.n == 6
        assert m.minutes_above_range > 0


class TestReturnToRange:
    def test_says_when_glucose_came_back_under_the_line(self) -> None:
        m = metrics_for(RETURNS)
        assert m is not None
        assert m.return_to_range_minutes == 95.0

    def test_refuses_to_call_the_window_ending_a_return(self) -> None:
        # The failure this exists to prevent: a meal still at 11.5 mmol/L when
        # the two hours ran out is the one that most needs to be visible, and
        # reporting "back in range at 120 minutes" would bury it.
        m = metrics_for(PROLONGED)

        assert m is not None
        assert m.return_to_range_minutes is None
        assert m.still_above_at_window_end == MIN_SAMPLES_FOR_ANY_FINDING
        assert m.minutes_above_range > 0

    def test_averages_only_the_meals_that_did_come_back(self) -> None:
        # Three returned at 95 minutes and two never did. The average is of the
        # three, not of five with the stragglers counted as though the window
        # closing were a return — that would drag it toward 120 and understate
        # how long a return actually takes.
        m = post_meal_metrics(
            group_of(RETURNS, 3) + group_of(PROLONGED, 2), rise_of(RETURNS)
        )

        assert m is not None
        assert m.n == 5
        assert m.return_to_range_minutes == 95.0
        assert m.still_above_at_window_end == 2

    def test_the_two_meanings_of_no_return_are_distinguishable(self) -> None:
        # Both report no return time. Nothing else about them is the same, and
        # a surface must be able to tell "never left range" from "never came
        # back" without asking.
        never_left = metrics_for(FLAT)
        never_came_back = metrics_for(PROLONGED)

        assert never_left is not None and never_came_back is not None
        assert never_left.return_to_range_minutes is None
        assert never_came_back.return_to_range_minutes is None

        assert never_left.minutes_above_range == 0.0
        assert never_came_back.minutes_above_range > 0.0
        assert never_left.still_above_at_window_end == 0
        assert never_came_back.still_above_at_window_end > 0


class TestShape:
    def test_a_response_that_barely_moved_is_flat(self) -> None:
        m = metrics_for(FLAT)
        assert m is not None
        assert m.shape == "flat"

    def test_a_fast_peak_is_sharp(self) -> None:
        m = metrics_for(SHARP)
        assert m is not None
        assert m.time_to_peak_minutes == 30.0
        assert m.shape == "sharp"

    def test_a_late_peak_is_delayed(self) -> None:
        m = metrics_for(DELAYED)
        assert m is not None
        assert m.shape == "delayed"

    def test_a_long_stretch_above_target_is_prolonged(self) -> None:
        # This response peaks at 90 minutes, which would also read as delayed.
        # Time above range is what a person feels, so it is what the one word
        # reports. The precedence is deliberate, and this is what pins it.
        m = metrics_for(PROLONGED)
        assert m is not None
        assert m.time_to_peak_minutes == 90.0
        assert m.shape == "prolonged"

    def test_flat_needs_both_halves(self) -> None:
        # A small rise from a high start. The movement was flat; the meal was
        # not, because glucose sat above target throughout. Calling this flat
        # would be true about the curve and misleading about the person.
        started_high = {0: 10.5, 30: 11.5, 60: 11.8, 90: 11.6, 120: 11.4}
        m = metrics_for(started_high)

        assert m is not None
        assert rise_of(started_high) < 2.0
        assert m.minutes_above_range == 120.0
        assert m.shape != "flat"

    def test_a_response_that_rose_and_came_back_says_only_that(self) -> None:
        # The residual bucket. Deliberately not called "typical": two groups
        # can land here having spent very different times above target, and the
        # word would claim a normality nothing here measured.
        m = metrics_for(RETURNS)
        assert m is not None
        assert m.shape == "rose_and_returned"


class TestAbsentWhenThin:
    """The half of this feature that is about not answering."""

    def test_absent_below_the_sample_floor(self) -> None:
        assert metrics_for(RETURNS, MIN_SAMPLES_FOR_ANY_FINDING - 1) is None
        assert metrics_for(RETURNS, MIN_SAMPLES_FOR_ANY_FINDING) is not None

    def test_absent_when_a_response_has_no_shape(self) -> None:
        # A baseline and one later reading state a rise and nothing about time.
        two_points = {0: 6.0, 120: 11.0}
        assert len(two_points) < POST_MEAL_MIN_CURVE_POINTS
        assert metrics_for(two_points, 20) is None

    def test_absent_when_the_watching_stopped_early(self) -> None:
        # Above target at 60 minutes and then nobody looked again. The honest
        # answer to "how long were you above range" is not "45 minutes"; it is
        # that this meal cannot say.
        stopped_early = {0: 6.0, 30: 9.0, 60: 11.0}
        assert max(stopped_early) < POST_MEAL_WINDOW_MINUTES * POST_MEAL_MIN_COVERAGE
        assert metrics_for(stopped_early, 20) is None

    def test_the_coverage_bar_is_where_it_says_it_is(self) -> None:
        cutoff = int(POST_MEAL_WINDOW_MINUTES * POST_MEAL_MIN_COVERAGE)
        just_short = {0: 6.0, 30: 9.0, cutoff - 15: 11.0}
        just_enough = {0: 6.0, 30: 9.0, cutoff: 11.0}

        assert metrics_for(just_short, 20) is None
        assert metrics_for(just_enough, 20) is not None

    def test_counts_only_the_meals_it_could_measure(self) -> None:
        # Five full responses and twenty truncated ones. The five are reported
        # and the twenty are not silently averaged in — nor do they inflate the
        # count, which is what a reader checks these numbers against.
        truncated = {0: 6.0, 30: 9.0, 45: 11.0}
        m = post_meal_metrics(
            group_of(RETURNS, 5) + group_of(truncated, 20), rise_of(RETURNS)
        )

        assert m is not None
        assert m.n == 5
        assert m.minutes_above_range == 57.5

    def test_thin_measurable_meals_inside_a_large_group_stay_silent(self) -> None:
        # Four measurable meals among fifty. The group is large enough for a
        # finding; the timings are not, and the timings are what this reports.
        truncated = {0: 6.0, 30: 9.0, 45: 11.0}
        assert (
            post_meal_metrics(
                group_of(RETURNS, 4) + group_of(truncated, 46), rise_of(RETURNS)
            )
            is None
        )


class TestOnTheFinding:
    """That the measurements reach the contract, on the groups that have them."""

    def test_a_meal_group_carries_its_measurements(self) -> None:
        group = patterns._group("A typical meal", group_of(RETURNS, 8))  # noqa: SLF001

        assert group.n == 8
        assert group.post_meal is not None
        assert group.post_meal.n == 8
        assert group.post_meal.time_to_peak_minutes == 60.0

    def test_an_empty_group_has_none(self) -> None:
        group = patterns._group("Nothing", [])  # noqa: SLF001
        assert group.post_meal is None

    def test_a_level_is_not_a_post_meal_response(self) -> None:
        # Morning glucose is a level, not a movement. Asking when it returned
        # to range is not a question, and the group says so by carrying nothing
        # rather than by carrying zeroes.
        rows = [
            (pd.Timestamp("2026-08-01T07:00:00Z") + pd.Timedelta(days=d), 6.4)
            for d in range(10)
        ]
        glucose = pd.DataFrame(
            {
                "measured_at": pd.to_datetime([r[0] for r in rows], utc=True),
                "value_mmol": [r[1] for r in rows],
                "source": ["cgm_device"] * len(rows),
            }
        )

        finding = patterns._morning_glucose_pattern(glucose)  # noqa: SLF001

        assert finding.comparison
        assert all(g.post_meal is None for g in finding.comparison)

    def test_the_contract_is_serialised_in_the_names_typescript_expects(self) -> None:
        # findings.py and insights.ts are the same contract in two languages.
        # The engine speaks snake_case internally and camelCase on the wire, and
        # a field that forgets its alias is dropped silently by the zod schema
        # on the other side rather than failing anything.
        m = metrics_for(RETURNS)
        assert m is not None

        assert set(m.model_dump(by_alias=True)) == {
            "n",
            "timeToPeakMinutes",
            "minutesAboveRange",
            "returnToRangeMinutes",
            "areaAboveRange",
            "stillAboveAtWindowEnd",
            "shape",
        }

    def test_the_group_exposes_it_under_the_agreed_name(self) -> None:
        group = patterns._group("A typical meal", group_of(RETURNS, 8))  # noqa: SLF001
        assert "postMeal" in group.model_dump(by_alias=True)


class TestThroughTheDetector:
    """The whole path: readings and meals in, measurements out."""

    @staticmethod
    def frames(count: int) -> tuple[pd.DataFrame, pd.DataFrame]:
        base = pd.Timestamp("2026-08-01T12:00:00Z")
        starts = [base + pd.Timedelta(days=d) for d in range(count)]

        rows: list[tuple[pd.Timestamp, float]] = []
        for start in starts:
            rows.append((start - pd.Timedelta(minutes=5), RETURNS[0]))
            for minute, value in RETURNS.items():
                if minute > 0:
                    rows.append((start + pd.Timedelta(minutes=minute), value))

        glucose = pd.DataFrame(
            {
                "measured_at": pd.to_datetime([r[0] for r in rows], utc=True),
                "value_mmol": [r[1] for r in rows],
                "source": ["cgm_device"] * len(rows),
            }
        )
        meals = pd.DataFrame(
            {
                "id": [f"meal-{i}" for i in range(count)],
                "started_at": pd.to_datetime(starts, utc=True),
                "meal_type": ["dinner"] * count,
                "description": ["Test meal"] * count,
                "confidence": [1.0] * count,
                "carbs_g": [45.0] * count,
                "protein_g": [20.0] * count,
                "fat_g": [10.0] * count,
                "fiber_g": [5.0] * count,
                "item_count": [1] * count,
            }
        )
        return glucose, meals

    def test_the_finding_carries_the_measurements(self) -> None:
        glucose, meals = self.frames(8)
        finding = patterns._post_meal_response(glucose, meals)  # noqa: SLF001

        assert finding is not None
        assert finding.comparison
        measured = finding.comparison[0].post_meal
        assert measured is not None
        assert measured.n == 8
        assert measured.time_to_peak_minutes == 60.0
        assert measured.minutes_above_range == 57.5
        assert measured.return_to_range_minutes == 95.0
        assert measured.shape == "rose_and_returned"

    def test_the_summary_and_the_effect_estimate_are_untouched(self) -> None:
        # This ticket adds output. It does not move any number the product was
        # already reporting, and the experiment flow keys on the effect
        # estimate and the finding type.
        glucose, meals = self.frames(8)
        finding = patterns._post_meal_response(glucose, meals)  # noqa: SLF001

        assert finding is not None
        assert finding.finding_type == "post_meal_response"
        assert finding.effect_estimate == round(
            max(v for m, v in RETURNS.items() if m > 0) - RETURNS[0], 2
        )
        assert finding.effect_unit == "mmol/L rise from baseline"
        assert "rose by about" in finding.summary

    def test_a_thin_finding_has_no_group_to_measure(self) -> None:
        glucose, meals = self.frames(MIN_SAMPLES_FOR_ANY_FINDING - 1)
        finding = patterns._post_meal_response(glucose, meals)  # noqa: SLF001

        assert finding is not None
        assert finding.effect_estimate is None
        assert finding.comparison == []


def test_the_target_line_these_are_measured_against_is_the_shared_one() -> None:
    # Not a restatement of the constant: it is the one number that decides
    # every figure on this object, and it is a copy of a value that lives in
    # TypeScript. backend/test/target-range.spec.ts holds the other end.
    assert TARGET_HIGH_MMOL == 10.0
