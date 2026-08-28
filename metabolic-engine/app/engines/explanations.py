"""What else could plausibly explain a pattern.

The fourth step of the product loop, and the one that was never built. A
detector that reports "meals followed by a walk were followed by a smaller
rise" has found an association between two groups a person created by living
their life. Those groups differ in more than the walk — in what was eaten, when
it was eaten, how the rest of the day went — and a product that reports the
association without naming those is asking to be read as cause.

Every explanation here is written down in advance and reviewed as a set. None
is generated. That rule is not stylistic: a competing explanation is a clinical
claim about why somebody's glucose did what it did, and a sentence assembled at
request time is a claim nobody approved. `suggestions.py` earned this treatment
first and for the same reason.

Each entry answers four questions, because an explanation that only names
itself is not usable:

* **why** it could produce this pattern,
* **what would support it** — what a record would look like if it were true,
* **what is missing** from the record today, and
* **whether this product can capture that**, which is proved by naming the
  suggestion that captures it rather than by asserting a boolean.

That last one is the honesty rule. An explanation that asks for data the
product cannot store sends a person looking for a control that does not exist,
which is how a helpful list becomes a broken promise. Where the missing data
genuinely cannot be captured, `capture` is None and the explanation says so
plainly — that is still worth telling somebody, because "nobody measured this"
is a real answer and pretending otherwise is not.
"""

from dataclasses import dataclass

from app.engines import suggestions
from app.models.findings import CompetingExplanation


@dataclass(frozen=True)
class Explanation:
    """One reason a pattern might exist that is not the one the finding names."""

    label: str
    why: str
    supported_by: str
    missing: str

    capture: str | None = None
    """The suggestion that would capture the missing data, or None.

    A reference into `suggestions.py` rather than a boolean, so "the product
    can capture this" is a claim something else already checks: every value in
    that module names the endpoint that stores it, and a test asserts every
    `capture` here is one of them. A boolean would be somebody's opinion at the
    time of writing and would stay true-looking forever after the capture path
    was removed.
    """

    def to_model(self) -> CompetingExplanation:
        return CompetingExplanation(
            label=self.label,
            why=self.why,
            supported_by=self.supported_by,
            missing=self.missing,
            capture=self.capture,
        )


# --- Shared explanations ----------------------------------------------------
#
# Several detectors compare groups of meals, and the same handful of things
# confound all of them. Declared once so the wording cannot drift between two
# findings a reader meets on the same screen.

MEAL_COMPOSITION = Explanation(
    label="The meals themselves were different",
    why=(
        "Two groups of meals a person chose for themselves rarely differ only "
        "in the one thing being compared. Carbohydrate, fat and portion size "
        "move a glucose response more than most other things do."
    ),
    supported_by=(
        "Carbohydrate estimates recorded with each meal, so the groups can be "
        "compared at a similar size"
    ),
    missing="No carbohydrate estimate is recorded for most of these meals",
    capture=suggestions.LOG_MEAL_CARBS,
)

REST_OF_THE_DAY = Explanation(
    label="The rest of the day was different",
    why=(
        "A glucose response follows from more than the meal in front of it. A "
        "day with more movement in it behaves differently from a still one, "
        "whatever happened at the table."
    ),
    supported_by="Logged activity through the day, with how long it lasted",
    missing="Activity is recorded as an event without a duration",
    capture=suggestions.LOG_ACTIVITY_MINUTES,
)

MEDICATION_TIMING = Explanation(
    label="Medication was taken at a different time",
    why=(
        "Glucose-lowering medication acts over hours, so the same meal eaten "
        "before and after a dose is two different situations."
    ),
    supported_by="Recorded times for when medication was actually taken",
    missing="Medication is recorded as a prescription rather than as doses taken",
    capture=suggestions.LOG_MEDICATION_TIMING,
)

MEAL_LOGGING_TIME = Explanation(
    label="The meal happened at a different time than it was logged",
    why=(
        "Every post-meal measurement is counted from the logged start. A meal "
        "written down an hour later moves its whole response with it, and the "
        "shift is invisible in the record."
    ),
    supported_by="Meals logged close to when they were eaten",
    missing="Nothing records the gap between eating and logging",
    capture=suggestions.LOG_MEALS_PROMPTLY,
)

SLEEP = Explanation(
    label="Sleep the night before",
    why=(
        "Short or broken sleep raises glucose the following day, and it tracks "
        "with the things being compared here — late meals, quiet days — rather "
        "than falling evenly across both groups."
    ),
    supported_by="Sleep timing and duration for each night in the period",
    missing="Sleep is not recorded",
    # Deliberately not capturable. The product has nowhere to put sleep, and a
    # suggestion to log it would send somebody looking for a control that does
    # not exist. Naming it as unmeasured is the honest half of that.
    capture=None,
)

ILLNESS_OR_STRESS = Explanation(
    label="Illness, stress or hormonal changes",
    why=(
        "All three raise glucose for days at a time and none of them respects "
        "the boundary between the groups being compared."
    ),
    supported_by="A record of days affected by illness, stress or a cycle",
    missing="None of these is recorded",
    capture=None,
)

TIME_OF_DAY = Explanation(
    label="The time of day the groups fall into",
    why=(
        "The same meal produces a different response in the morning and in the "
        "evening. If one group clusters at one end of the day, that clustering "
        "is part of what is being measured."
    ),
    supported_by=(
        "Similar meals eaten deliberately at different hours, so timing varies "
        "independently of everything else"
    ),
    missing="Meal times were chosen by living, not varied on purpose",
    capture=suggestions.ALTERNATE_MEAL_TIMING,
)

SENSOR_BEHAVIOUR = Explanation(
    label="How the sensor behaved",
    why=(
        "A sensor reads differently in its first day and its last, and lying "
        "on one overnight can push readings down for hours. Neither is a change "
        "in the person."
    ),
    supported_by="Sensor session start and end dates, and calibration checks",
    missing="Readings are stored without the sensor session they came from",
    capture=None,
)

WEIGHT_CHANGE = Explanation(
    label="Weight changed over the same period",
    why=(
        "Weight moves insulin sensitivity over weeks to months, which is the "
        "same timescale this finding covers, so the two are easily confused."
    ),
    supported_by="Weight recorded every few weeks across the period",
    missing="Too few weight measurements to compare against this trend",
    capture=suggestions.LOG_WEIGHT,
)

DIFFERENT_ASSAY = Explanation(
    label="The results came from different laboratories",
    why=(
        "Two laboratories can report the same sample slightly differently. A "
        "trend across results from more than one is partly a trend in where "
        "they were measured."
    ),
    supported_by="The laboratory or assay recorded with each result",
    missing="Results are stored without which laboratory produced them",
    capture=None,
)

ACTIVITY_NOT_LOGGED = Explanation(
    label="Activity happened but was not logged",
    why=(
        "This counts logged activity, so a quiet record can mean a quiet "
        "period or a period nobody wrote down. The two look identical here."
    ),
    supported_by="Activity logged consistently, whether or not it felt notable",
    missing="Nothing distinguishes an unlogged day from an inactive one",
    capture=suggestions.LOG_ACTIVITY_MINUTES,
)


# --- Per detector -----------------------------------------------------------
#
# Ordered most to least likely to matter for that particular comparison, since
# a reader works down the list and stops.

CATALOGUE: dict[str, tuple[Explanation, ...]] = {
    "post_meal_walk_effect": (
        MEAL_COMPOSITION,
        REST_OF_THE_DAY,
        TIME_OF_DAY,
        MEDICATION_TIMING,
        SLEEP,
    ),
    "late_evening_meal_response": (
        MEAL_COMPOSITION,
        REST_OF_THE_DAY,
        MEDICATION_TIMING,
        SLEEP,
    ),
    "post_meal_response": (
        MEAL_COMPOSITION,
        MEAL_LOGGING_TIME,
        MEDICATION_TIMING,
        ILLNESS_OR_STRESS,
    ),
    "morning_glucose_pattern": (
        MEDICATION_TIMING,
        SLEEP,
        SENSOR_BEHAVIOUR,
        ILLNESS_OR_STRESS,
    ),
    "fasting_glucose_trend": (
        WEIGHT_CHANGE,
        MEDICATION_TIMING,
        SENSOR_BEHAVIOUR,
        SLEEP,
    ),
    "meal_timing_association": (
        MEAL_COMPOSITION,
        REST_OF_THE_DAY,
        TIME_OF_DAY,
        SLEEP,
    ),
    "hba1c_trend": (
        MEDICATION_TIMING,
        WEIGHT_CHANGE,
        DIFFERENT_ASSAY,
    ),
    "weight_trend": (
        REST_OF_THE_DAY,
        ILLNESS_OR_STRESS,
    ),
    "activity_consistency": (
        ACTIVITY_NOT_LOGGED,
        ILLNESS_OR_STRESS,
    ),
}

NO_EXPLANATIONS_NEEDED: frozenset[str] = frozenset(
    {
        # Not findings about a pattern. There is nothing to explain another way:
        # one reports that a care mode has no reviewed detectors, the other that
        # there were no readings to look at.
        "care_mode_unsupported",
        "insufficient_data",
    }
)


def for_finding(finding_type: str) -> list[CompetingExplanation]:
    """The reviewed alternatives for this kind of finding.

    Empty for a finding type with no catalogue entry, rather than raising. A
    detector shipped without one is a gap in the review, and the right place to
    fail is the test that checks the catalogue covers the registry — not a
    request from somebody trying to read their own data.
    """
    return [e.to_model() for e in CATALOGUE.get(finding_type, ())]


ALL: frozenset[Explanation] = frozenset(
    e for entries in CATALOGUE.values() for e in entries
)
