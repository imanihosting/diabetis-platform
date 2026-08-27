"""Which detectors are allowed to run, for whom.

The second of two independent gates. NestJS refuses to *ask* for an analysis it
should not request; this refuses to *run* one it should not perform. Neither
delegates to the other, and that is the point: a gate with one enforcement
point is a gate that opens the moment something new calls the service. The
engine answers questions about any user id it is handed, so it has to be able
to say no on its own.

Every detector here models Type 2 physiology. Run over a Type 1 record they
would return confident numbers computed from the wrong model of a body, and
nothing in the output would say so. That is the failure this module exists to
make impossible rather than merely unlikely.

The declaration is on the detector, not on the caller. A detector that gains a
new care mode says so in one place, next to the code whose assumptions changed.
"""

from collections.abc import Callable, Iterable
from dataclasses import dataclass, field

import pandas as pd

from app.models.findings import StructuredFinding

# Care modes, mirroring `careModeSchema` in @wellovue/types. These two are the
# same contract in two languages and must be changed together.
CARE_MODE_TYPE_2_STANDARD = "type_2_standard"
CARE_MODE_TYPE_2_INSULIN = "type_2_insulin_supported"
CARE_MODE_PREDIABETES = "prediabetes"
CARE_MODE_GESTATIONAL = "gestational"
CARE_MODE_TYPE_1 = "type_1_cgm_insulin"
CARE_MODE_OTHER = "other_specific"
CARE_MODE_UNKNOWN = "unknown"

ALL_CARE_MODES = frozenset(
    {
        CARE_MODE_TYPE_2_STANDARD,
        CARE_MODE_TYPE_2_INSULIN,
        CARE_MODE_PREDIABETES,
        CARE_MODE_GESTATIONAL,
        CARE_MODE_TYPE_1,
        CARE_MODE_OTHER,
        CARE_MODE_UNKNOWN,
    }
)

# What a detector is handed. Loaded once per request and shared, because every
# detector wants some subset of the same three frames.
DetectorInputs = tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]

# A detector returns None when the signal it needs is absent entirely, which is
# different from returning an "insufficient data" finding — that is a real
# answer and is shown to the user as one.
DetectorFn = Callable[[pd.DataFrame, pd.DataFrame, pd.DataFrame], StructuredFinding | None]


@dataclass(frozen=True)
class Detector:
    """One analysis, and the circumstances it is valid in."""

    name: str
    run: DetectorFn

    supported_care_modes: frozenset[str]
    """Care modes whose physiology this detector's assumptions actually fit."""

    blocked_flags: frozenset[str] = field(default_factory=frozenset)
    """
    Safety flags that disqualify the detector regardless of care mode.

    Separate from the care mode because risk is not always implied by the
    diagnosis: a Type 2 record belonging to someone who is pregnant needs the
    pregnancy detectors nobody has written yet, not the ones written for a
    body that is not.
    """

    def allowed_for(self, care_mode: str, active_flags: Iterable[str]) -> bool:
        if care_mode not in self.supported_care_modes:
            return False
        return not self.blocked_flags.intersection(active_flags)


# The care modes the Type 2 detectors were written for.
#
# Insulin-supported Type 2 is included: the same physiology, read the same way.
# What insulin changes is which *experiments* may be proposed, and that gate
# lives in the safety classifier rather than here. Excluding it would withhold
# a correct analysis from people who need it most.
TYPE_2_CARE_MODES = frozenset({CARE_MODE_TYPE_2_STANDARD, CARE_MODE_TYPE_2_INSULIN})

# Pregnancy changes what these numbers mean and who should read them. A Type 2
# diagnosis plus a pregnancy flag derives to `gestational` upstream, so this is
# belt and braces — which is what a second gate is for.
PREGNANCY_BLOCKED = frozenset({"pregnancy"})


def build_registry(
    morning: DetectorFn,
    post_meal: DetectorFn,
    late_meal: DetectorFn,
    walk_effect: DetectorFn,
) -> tuple[Detector, ...]:
    """The registry, wired from the detector functions in `patterns`.

    Built by a function taking the callables rather than importing them, so
    `patterns` can own the analysis and this module can own the permissions
    without the two importing each other in a circle.
    """
    return (
        Detector(
            name="morning_glucose_pattern",
            run=morning,
            supported_care_modes=TYPE_2_CARE_MODES,
            blocked_flags=PREGNANCY_BLOCKED,
        ),
        Detector(
            name="post_meal_response",
            run=post_meal,
            supported_care_modes=TYPE_2_CARE_MODES,
            blocked_flags=PREGNANCY_BLOCKED,
        ),
        Detector(
            name="late_evening_meal_response",
            run=late_meal,
            supported_care_modes=TYPE_2_CARE_MODES,
            blocked_flags=PREGNANCY_BLOCKED,
        ),
        Detector(
            name="post_meal_walk_effect",
            run=walk_effect,
            supported_care_modes=TYPE_2_CARE_MODES,
            blocked_flags=PREGNANCY_BLOCKED,
        ),
    )


def unsupported_finding(care_mode: str) -> StructuredFinding:
    """What a caller gets when no detector is willing to run.

    Shaped like every other finding, and deliberately not an error: nothing
    failed. The engine was asked to interpret a body it has no reviewed model
    for, and declining is the correct result rather than a fault. An HTTP error
    would invite a retry, and retrying changes nothing.
    """
    known = care_mode in ALL_CARE_MODES
    return StructuredFinding(
        finding_type="care_mode_unsupported",
        summary=(
            f"No reviewed detector exists for the care mode '{care_mode}', so "
            "nothing in this period has been interpreted."
            if known
            else f"'{care_mode}' is not a care mode this engine recognises, so "
            "nothing has been interpreted."
        ),
        effect_estimate=None,
        effect_unit=None,
        confidence=0.0,
        sample_count=0,
        limitations=[
            "Every detector currently implemented models Type 2 physiology",
            "Applying them here would produce confident numbers from the wrong "
            "model of the body",
        ],
        would_improve_with=[
            "Confirm the kind of diabetes recorded on the profile",
        ],
    )
