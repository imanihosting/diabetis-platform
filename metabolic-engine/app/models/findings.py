"""The structured-finding contract.

Mirrors `insights.ts` in @diabetes/types. These two definitions are the same
contract in two languages and must be changed together.

The rule this contract exists to enforce: a finding is produced by a
quantitative model, never by a language model. An LLM may only phrase a finding
that already exists.
"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


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

    model_config = {"populate_by_name": True}


class PatternRequest(BaseModel):
    user_id: UUID = Field(validation_alias="userId")
    from_: datetime = Field(validation_alias="from")
    to: datetime
    patterns: list[str] | None = None

    model_config = {"populate_by_name": True}


class PatternResponse(BaseModel):
    user_id: UUID = Field(serialization_alias="userId")
    generated_at: datetime = Field(serialization_alias="generatedAt")
    model_version: str = Field(serialization_alias="modelVersion")
    findings: list[StructuredFinding]

    model_config = {"populate_by_name": True}
