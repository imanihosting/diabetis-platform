"""Post-meal responses measured the way diabetes is talked about.

The engine already had the curve. What it reported off it was a rise and a
peak, which is what a statistics package would say about any two numbers. This
module says the rest: when the peak came, how long glucose stayed above target,
when it came back, and how much excursion there was altogether.

Nothing here is a new claim about anybody. Every figure is arithmetic over
readings the engine already loaded and already draws, and each one is a
quantity a person with diabetes and their clinician already use. That is the
point — the platform should describe a meal in the language of the condition
rather than in the language of the comparison it happens to be running.

Kept out of `patterns` because it is arithmetic over one curve and has no
opinion about detectors, and out of `meal_response` because that module is
deliberately ignorant of the target range: it turns two frames into responses,
and this turns a response into measurements.
"""

from collections.abc import Sequence

from app.engines.meal_response import MealResponse
from app.engines.thresholds import (
    MIN_SAMPLES_FOR_ANY_FINDING,
    POST_MEAL_MIN_COVERAGE,
    POST_MEAL_MIN_CURVE_POINTS,
    POST_MEAL_WINDOW_MINUTES,
    SHAPE_DELAYED_PEAK_MINUTES,
    SHAPE_FLAT_RISE_MMOL,
    SHAPE_PROLONGED_MINUTES_ABOVE,
    SHAPE_SHARP_PEAK_MINUTES,
    TARGET_HIGH_MMOL,
)
from app.models.findings import PostMealMetrics

Point = tuple[float, float]
"""Minutes since the meal, and glucose in mmol/L."""


def post_meal_metrics(
    responses: Sequence[MealResponse], rise_mmol: float | None
) -> PostMealMetrics | None:
    """A group's post-meal measurements, or None when too few can be measured.

    `rise_mmol` is the group's own mean rise — the same one the chart's legend
    shows as baseline to peak — and it is passed in rather than recomputed so
    the shape label can never be argued with by the numbers printed beside it.

    Returns None rather than a set of zeroes when fewer than
    `MIN_SAMPLES_FOR_ANY_FINDING` meals were watched long enough. A mean time
    to peak over two meals is one of those meals, and this product does not
    print those.
    """
    measured = [m for m in (_measure(r) for r in responses) if m is not None]

    if len(measured) < MIN_SAMPLES_FOR_ANY_FINDING:
        return None

    n = len(measured)
    returned = [m.return_to_range for m in measured if m.return_to_range is not None]
    still_above = sum(1 for m in measured if m.ended_above)

    minutes_above = _mean([m.minutes_above for m in measured])
    time_to_peak = _mean([m.time_to_peak for m in measured])
    area_above = _mean([m.area_above for m in measured])

    return PostMealMetrics(
        n=n,
        time_to_peak_minutes=round(time_to_peak, 1),
        minutes_above_range=round(minutes_above, 1),
        # Averaged over the meals that came back, not over all of them. See the
        # field's own note: the ones that did not are counted separately rather
        # than folded in as though the window ending were a return.
        return_to_range_minutes=round(_mean(returned), 1) if returned else None,
        area_above_range=round(area_above, 1),
        still_above_at_window_end=still_above,
        shape=_shape(
            rise_mmol=rise_mmol,
            time_to_peak=time_to_peak,
            minutes_above=minutes_above,
        ),
    )


def measurable_responses(
    responses: Sequence[MealResponse],
) -> list[MealResponse]:
    """The meals watched long enough for their timings to mean anything.

    Exported because coverage asks the same question these measurements do —
    "was this meal actually observed?" — and two definitions of it drifting
    apart would put a coverage figure beside a set of measurements that
    disagreed with it. See `app.engines.coverage`.
    """
    return [r for r in responses if _measure(r) is not None]


class _Measured:
    """One meal's timings. A small class rather than a tuple because five
    positional floats at the call site is how the wrong two get swapped."""

    __slots__ = ("time_to_peak", "minutes_above", "return_to_range", "area_above", "ended_above")

    def __init__(
        self,
        time_to_peak: float,
        minutes_above: float,
        return_to_range: float | None,
        area_above: float,
        ended_above: bool,
    ) -> None:
        self.time_to_peak = time_to_peak
        self.minutes_above = minutes_above
        self.return_to_range = return_to_range
        self.area_above = area_above
        self.ended_above = ended_above


def _measure(response: MealResponse) -> _Measured | None:
    """One meal's timings, or None if it was not watched long enough to have any.

    The two guards are the whole honesty of this module. A response with two
    points has a rise and no shape; a response that stops at forty-five minutes
    can report when the watching ended and not when the excursion did. Either
    one, measured anyway, would produce a confident number pointing the wrong
    way — shorter time above range, earlier return — which is the direction
    that makes a meal look better than it was.
    """
    points = _curve(response)

    if len(points) < POST_MEAL_MIN_CURVE_POINTS:
        return None
    if points[-1][0] < POST_MEAL_WINDOW_MINUTES * POST_MEAL_MIN_COVERAGE:
        return None

    minutes_above, area_above = _above(points, TARGET_HIGH_MMOL)

    return _Measured(
        time_to_peak=_time_to_peak(points),
        minutes_above=minutes_above,
        return_to_range=_return_to_range(points, TARGET_HIGH_MMOL),
        area_above=area_above,
        ended_above=points[-1][1] > TARGET_HIGH_MMOL,
    )


def _curve(response: MealResponse) -> list[Point]:
    """The meal's response as points in time, baseline first."""
    return [(float(m), float(v)) for m, v in sorted(response["samples"].items())]


def _time_to_peak(points: Sequence[Point]) -> float:
    """Minutes to the highest reading after the meal.

    Minute zero is excluded because it is the baseline, and the peak this
    reports has to be the same event `MealResponse.peak` reports — that one is
    measured over the post-meal window alone, so a meal whose glucose only ever
    fell has its peak at its least-low point rather than at the meal itself.

    Ties go to the earlier reading: a plateau's peak is where it started.
    """
    after = [p for p in points if p[0] > 0]
    return max(after, key=lambda p: (p[1], -p[0]))[0]


def _above(points: Sequence[Point], threshold: float) -> tuple[float, float]:
    """Minutes above the threshold, and the area above it.

    Reads the curve as the straight lines between readings, which is what the
    chart draws, so this measures exactly the region a reader can see between
    the trace and the target line. The alternative — counting whole
    fifteen-minute bins — would round a four-minute excursion up to fifteen and
    a crossing at the boundary down to nothing.
    """
    minutes = 0.0
    area = 0.0

    for (t0, v0), (t1, v1) in zip(points, points[1:], strict=False):
        span = t1 - t0
        if span <= 0:
            continue

        a0 = v0 - threshold
        a1 = v1 - threshold

        if a0 <= 0 and a1 <= 0:
            continue

        if a0 > 0 and a1 > 0:
            minutes += span
            area += (a0 + a1) / 2 * span
            continue

        # One crossing inside this segment. `fraction` is where the line meets
        # the threshold, as a share of the segment.
        fraction = a0 / (a0 - a1)
        if a0 > 0:
            above_span = span * fraction
            area += a0 / 2 * above_span
        else:
            above_span = span * (1 - fraction)
            area += a1 / 2 * above_span
        minutes += above_span

    return minutes, area


def _return_to_range(points: Sequence[Point], threshold: float) -> float | None:
    """When glucose last came back to at or below the top of target range.

    The last crossing rather than the first, so a response that dips, climbs
    again and comes down reports the time it finally settled. None when the
    curve never went above, and none when it was still above at the last
    reading — the window ending is not a return, and treating it as one would
    put a number on the meals that most need to be visible as unresolved.

    "Back in range" here means back under the upper bound. It does not claim
    glucose stayed there: the window ends where it ends.
    """
    last: float | None = None

    for (t0, v0), (t1, v1) in zip(points, points[1:], strict=False):
        a0 = v0 - threshold
        a1 = v1 - threshold
        if a0 > 0 and a1 <= 0:
            last = t0 + (t1 - t0) * (a0 / (a0 - a1))

    return last


def _shape(
    rise_mmol: float | None, time_to_peak: float, minutes_above: float
) -> str:
    """One word for the response, by documented thresholds in a documented order.

    A response can be several of these at once — sharp and prolonged is a
    common and unhappy combination — and one word can only carry one. The order
    is what a person is served by hearing first: that it stayed high, then that
    the peak came late, then that it came fast.

    `flat` leads because it is a statement that the other three are not worth
    making. It needs both halves: a small rise that still spent time above
    target started high, and describing that as flat would be true about the
    movement and misleading about the meal.

    The last case says what the response did and stops there. It was `typical`
    until somebody read two of them side by side: a group spending 56 minutes
    above target and a group spending 11 were both labelled typical, and the
    word claims a normality this engine has not computed and has no basis for —
    typical of whom? A residual bucket has to be named for the measurements
    that put a response in it, not for a judgement about the person in it.
    """
    if (
        rise_mmol is not None
        and rise_mmol < SHAPE_FLAT_RISE_MMOL
        and minutes_above == 0.0
    ):
        return "flat"
    if minutes_above >= SHAPE_PROLONGED_MINUTES_ABOVE:
        return "prolonged"
    if time_to_peak >= SHAPE_DELAYED_PEAK_MINUTES:
        return "delayed"
    if time_to_peak <= SHAPE_SHARP_PEAK_MINUTES:
        return "sharp"
    return "rose_and_returned"


def _mean(values: Sequence[float]) -> float:
    return sum(values) / len(values)
