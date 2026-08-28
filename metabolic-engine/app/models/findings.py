"""The structured-finding contract.

Mirrors `insights.ts` in @wellovue/types. These two definitions are the same
contract in two languages and must be changed together.

The rule this contract exists to enforce: a finding is produced by a
quantitative model, never by a language model. An LLM may only phrase a finding
that already exists.
"""

from datetime import datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from pydantic import BaseModel, Field, field_validator


class CurvePoint(BaseModel):
    """One point on a mean response curve: minutes since the meal, and glucose."""

    minutes: int
    mmol: float


class PostMealMetrics(BaseModel):
    """A group's post-meal response measured in diabetes, not in statistics.

    Every one of these is a number somebody with diabetes already uses to talk
    about a meal: how high it went, how long it took to get there, how long it
    stayed above target, and when it came back. A rise of 3.1 mmol/L is a
    statistic. Peaking at 11.2 an hour after eating and taking another hour and
    a half to come back down is the same meal, described.

    Computed per meal from that meal's own response curve, then averaged. Not
    measured off the group's mean curve, which would be the wrong number and
    wrong in a specific, dangerous direction: peaks land at different times, so
    averaging the curves first flattens them, and a group whose meals routinely
    reached 11 could be reported as never leaving target range. Averaging the
    measurements instead keeps each excursion at its own height.

    `peak_mmol` is not repeated here. It is on the group already, and one card
    showing two peaks that differ because they were counted over slightly
    different meals is worse than showing one.
    """

    n: int = Field(ge=0)
    """Meals watched long enough for their timings to mean anything.

    Not the group's sample count, and often smaller. A meal logged with a
    reading before and one twenty minutes after belongs in the rise average and
    has nothing to say about when glucose came back, so it counts toward the
    group and not toward this. Reported rather than hidden, because a reader
    comparing "n=40" on the group against these numbers deserves to know they
    were measured over fewer.
    """

    time_to_peak_minutes: float = Field(serialization_alias="timeToPeakMinutes")
    """Mean minutes from the meal to the highest reading after it.

    Read off the same fifteen-minute curve the chart draws, so the number and
    the picture cannot disagree.
    """

    minutes_above_range: float = Field(serialization_alias="minutesAboveRange")
    """Mean minutes spent above the top of target range within the window.

    Interpolated between readings rather than counted in whole bins, which
    makes it exactly the width of the region between the drawn trace and the
    drawn target line. Zero is a real answer and a good one.
    """

    return_to_range_minutes: float | None = Field(
        default=None, serialization_alias="returnToRangeMinutes"
    )
    """Mean minutes from the meal until glucose was back at or below target.

    Averaged only over the meals that did come back inside the window, so it
    answers "when it returns, it returns after about this long" rather than
    quietly averaging in the ones that never did.

    Null has two meanings and the other fields separate them: with
    `minutes_above_range` at zero, no meal went above target and there was
    nothing to return from; with it above zero, no meal came back before the
    window ended, and `still_above_at_window_end` counts them.
    """

    area_above_range: float = Field(serialization_alias="areaAboveRange")
    """Mean mmol/L x minutes above target: how far above, for how long, together.

    The one number here that is not something a person already says out loud,
    and it is kept because it is the only one that separates a brief spike from
    a long shallow drift when both spend the same time above target.
    """

    still_above_at_window_end: int = Field(
        ge=0, serialization_alias="stillAboveAtWindowEnd"
    )
    """Meals whose last reading in the window was still above target.

    The honest denominator for `return_to_range_minutes`. Without it, a group
    where a third of meals never came down reads as though they all did.
    """

    shape: str
    """One word for the response: flat, sharp, delayed, prolonged, or typical.

    Derived from the numbers above and the group's own rise, by thresholds in
    `thresholds.py` rather than by adjectives buried in a classifier. It is a
    restatement of measurements already on this object, in the same category as
    `evidence_strength()` — not a new claim, and not a place to put one.
    """

    model_config = {"populate_by_name": True}


class GroupMeasure(BaseModel):
    """One group a finding compared, in glucose the reader would recognise.

    Detectors already compute these numbers and then throw them away, keeping
    only the difference. That made every finding a sentence with one number
    attached, which is why the interface could only ever render a sentence with
    one number attached.

    Baseline and peak are absolute mmol/L rather than a rise, so a chart can
    draw them against the target band. A rise of 3.1 says nothing about whether
    the reader ended up in range; 6.0 rising to 9.1 says it precisely.
    """

    label: str
    """What this group is, in the reader's terms: "Meals followed by a walk"."""

    n: int = Field(ge=0)
    baseline_mmol: float | None = Field(default=None, serialization_alias="baselineMmol")
    peak_mmol: float | None = Field(default=None, serialization_alias="peakMmol")

    curve: list[CurvePoint] = Field(default_factory=list)
    """The group's mean glucose response, sampled every fifteen minutes.

    Averaged across the meals in the group at each offset, so it is the shape
    of a typical response rather than any single meal's. Empty for a group with
    nothing to trace over time — a morning average is a level, not a curve, and
    drawing a line through it would invent movement that was never measured.
    """

    post_meal: PostMealMetrics | None = Field(
        default=None, serialization_alias="postMeal"
    )
    """The response measured as a post-meal excursion, when it is one.

    Null carries two things, and both are correct. A group that is not a meal
    response at all has none — a morning average is a level, and asking when it
    returned to range is not a question. So does a meal group whose responses
    were not watched long enough to time; see `PostMealMetrics.n`. A surface
    renders this section or omits it, and never renders it empty.
    """

    model_config = {"populate_by_name": True}


class StructuredFinding(BaseModel):
    finding_type: str = Field(serialization_alias="findingType")
    summary: str
    effect_estimate: float | None = Field(serialization_alias="effectEstimate")
    effect_unit: str | None = Field(serialization_alias="effectUnit")
    confidence: float = Field(ge=0.0, le=1.0)
    sample_count: int = Field(ge=0, serialization_alias="sampleCount")

    limitations: list[str]
    """Never empty in practice. An unqualified finding is a bug, not a strong result."""

    clinician_review_recommended: bool = Field(
        default=False, serialization_alias="clinicianReviewRecommended"
    )
    would_improve_with: list[str] = Field(
        default_factory=list, serialization_alias="wouldImproveWith"
    )

    comparison: list[GroupMeasure] = Field(default_factory=list)
    """The groups this finding actually compared, if it compared any.

    Empty for findings that are not a glucose comparison — a lab trend has no
    target band to sit against, and drawing one would be decoration.
    """

    p_value: float | None = Field(default=None, serialization_alias="pValue")
    """Moved out of `limitations`, where it used to be a sentence.

    A reader with diabetes is not helped by "Statistical p-value: 0.000" in a
    list of things the finding cannot account for; it is not a limitation, it
    is a statistic, and mixing the two made the list read as a lab report. It
    is still reported, because withholding it would be worse, but as its own
    field so the interface can put it where a technical detail belongs.
    """

    model_config = {"populate_by_name": True}


class PatternRequest(BaseModel):
    user_id: UUID = Field(validation_alias="userId")
    from_: datetime = Field(validation_alias="from")
    to: datetime
    patterns: list[str] | None = None

    care_mode: str = Field(default="unknown", validation_alias="careMode")
    """Which model of a body this record should be read with.

    Derived by the backend from the recorded diagnosis and the flags in force,
    never taken from a browser. The engine does not read the profile itself:
    care mode arrives here so there is one source of truth for it.

    Defaults to `unknown`, which no detector supports. A caller that forgets to
    send it therefore gets nothing rather than the Type 2 analysis, which is
    the safe direction for an omission to fail in.
    """

    active_flags: list[str] = Field(default_factory=list, validation_alias="activeFlags")
    """Safety flags currently in force. Some detectors are blocked by these
    regardless of care mode."""

    timezone: str = Field(default="UTC")
    """The zone whose clock decides morning, fasting and late-meal windows.

    Readings arrive as UTC and three findings turn on hour-of-day, so without
    this a 20:00 dinner in UTC+10 is counted as an earlier meal and the morning
    window reads somebody's evening. Sent by the backend from the account
    record rather than by a browser, for the same reason `care_mode` is.

    Defaults to UTC, which is exactly what the engine did before the field
    existed: a caller that omits it gets the old behaviour rather than a silent
    shift into some other zone. An omission and an unrecognised name are
    different things, and only the first has a safe default — see the validator.
    """

    @field_validator("timezone")
    @classmethod
    def _known_zone(cls, value: str) -> str:
        """Refuses a zone this system cannot resolve.

        Falling back to UTC here was the earlier behaviour and it was wrong.
        The engine fails closed everywhere else — `care_mode` defaults to
        `unknown`, which no detector supports, precisely so an omission cannot
        be quietly interpreted — and a zone it cannot resolve is not an
        omission, it is an unrecognised input. Accepting it would produce a
        confident finding computed on the wrong clock, which is the single
        worst thing this service can return.
        """
        try:
            ZoneInfo(value)
        except Exception as error:  # noqa: BLE001 - any resolution failure
            raise ValueError(
                f"Unknown timezone {value!r}. Expected an IANA name such as "
                "Europe/Dublin."
            ) from error
        return value

    model_config = {"populate_by_name": True}


class PatternResponse(BaseModel):
    user_id: UUID = Field(serialization_alias="userId")
    generated_at: datetime = Field(serialization_alias="generatedAt")
    model_version: str = Field(serialization_alias="modelVersion")
    findings: list[StructuredFinding]

    model_config = {"populate_by_name": True}
