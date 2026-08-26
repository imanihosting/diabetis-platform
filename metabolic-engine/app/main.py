"""Metabolic intelligence service.

Owns scientific computation: pattern detection, prediction, causal analysis,
hypothesis ranking, experiment design support, and confidence scoring.

It does not own application state, user workflows, or clinical decisions.
Those belong to the NestJS API. See docs/technical-architecture.md.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime

from fastapi import Depends, FastAPI, HTTPException, Request, status

from app import db
from app.config import get_settings
from app.engines import patterns
from app.models.findings import PatternRequest, PatternResponse


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    db.get_pool()
    yield
    db.close_pool()


app = FastAPI(
    title="Metabolic Intelligence Service",
    description=(
        "Produces structured findings with effect estimates, confidence, sample "
        "counts, and explicit limitations. Never produces clinical advice."
    ),
    version="0.1.0",
    lifespan=lifespan,
)


async def require_service_token(request: Request) -> None:
    """Only the backend should reach this service.

    When no token is configured the check is skipped, which is intended for
    local development only — set METABOLIC_ENGINE_TOKEN everywhere else.
    """
    settings = get_settings()
    if settings.metabolic_engine_token is None:
        return

    header = request.headers.get("authorization", "")
    if header != f"Bearer {settings.metabolic_engine_token}":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid service token",
        )


@app.get("/health/live", tags=["health"])
async def live() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/ready", tags=["health"])
async def ready() -> dict[str, object]:
    database = db.ping()
    return {
        "status": "ok" if database else "degraded",
        "checks": {"database": database},
    }


@app.post(
    "/patterns/detect",
    response_model=PatternResponse,
    response_model_by_alias=True,
    tags=["patterns"],
    dependencies=[Depends(require_service_token)],
)
async def detect_patterns(request: PatternRequest) -> PatternResponse:
    """Runs the pattern engine over a user's data for a time window.

    Always returns findings — including "insufficient data" findings, which are
    a real answer and are shown to the user as such rather than hidden.
    """
    if request.to <= request.from_:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="`to` must be after `from`",
        )

    findings = patterns.detect_all(request.user_id, request.from_, request.to)

    return PatternResponse(
        user_id=request.user_id,
        generated_at=datetime.now(UTC),
        model_version=patterns.MODEL_VERSION,
        findings=findings,
    )
