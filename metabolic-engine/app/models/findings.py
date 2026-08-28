"""The structured-finding contract.

Mirrors `insights.ts` in @wellovue/types. These two definitions are the same
contract in two languages and must be changed together.

The rule this contract exists to enforce: a finding is produced by a
quantitative model, never by a language model. An LLM may only phrase a finding
that already exists.
"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class CurvePoint(BaseModel):
    """One point on a mean response curve: minutes since the meal, and glucose."""

    minutes: int
    mmol: float


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
    shift into some other zone.
    """

    model_config = {"populate_by_name": True}


class PatternResponse(BaseModel):
    user_id: UUID = Field(serialization_alias="userId")
    generated_at: datetime = Field(serialization_alias="generatedAt")
    model_version: str = Field(serialization_alias="modelVersion")
    findings: list[StructuredFinding]

    model_config = {"populate_by_name": True}
