"""The things a finding may ask someone to do.

Every `would_improve_with` entry in every detector comes from this module, and
`tests/test_patterns.py` fails if one does not. That is the whole mechanism: a
free-text suggestion is a promise the product may not be able to keep, and
nothing about writing one tells you whether it can.

The rule each entry has to satisfy: **there is a way to record this in the
product today.** Not planned, not designed, shipped. The capture path is named
in the comment beside it so the claim can be checked rather than trusted.

An audit against that rule found several suggestions that failed it. They asked
for sleep times the product cannot store, meal end times the form does not
collect, walking intensity nothing captures, and Living Trials, which do not
exist. A person following those would have gone looking for a control that was
not there and concluded the product was broken, which is the opposite of what a
suggestion is for.

Where the useful improvement genuinely is not capturable, it belongs in
`limitations` instead. Saying "sleep was not accounted for" is honest. Saying
"log your sleep" when nothing can is not.
"""

# --- Glucose --- POST /api/glucose, POST /api/glucose/import/csv ------------
LOG_GLUCOSE = "Add glucose readings manually, or import a CGM or meter export"
LOG_WAKING_GLUCOSE = "Take a reading shortly after waking, or wear a CGM overnight"
LOG_AROUND_MEALS = (
    "Wear a CGM, or take a reading before and about 90 minutes after meals"
)

# --- Meals --- POST /api/meals ---------------------------------------------
LOG_MEALS_PROMPTLY = "Log meals close to when you eat"
LOG_MEAL_CARBS = "Record a carbohydrate estimate with each meal"
LOG_MEALS_ACROSS_THE_DAY = "Keep logging meals across different times of day"

# --- Activity --- POST /api/timeline/events, kind 'walk' with minutes ------
LOG_ACTIVITY_MINUTES = "Log how many minutes you walked"

# --- Labs and body measurements --- POST /api/labs -------------------------
LOG_HBA1C = "Record your HbA1c the next time you have one taken"
LOG_WEIGHT = "Record your weight every few weeks"
LOG_FASTING_GLUCOSE = "Record a fasting glucose result when a lab reports one"

# --- Medication --- POST /api/medications, POST /api/medications/:id/taken --
LOG_MEDICATION_TIMING = "Record when you take your medication"

# --- Care profile --- PUT /api/diabetes-profile, /profile in the app --------
CONFIRM_DIAGNOSIS = "Confirm the kind of diabetes recorded on your care profile"

# --- Deliberate self-experiments -------------------------------------------
#
# Living Trials do not exist yet, and two suggestions used to name them. These
# describe the same experiment in terms of what the product can already record:
# meals and activity, logged either side of a choice the person makes.
ALTERNATE_WALKING = (
    "Alternate walking and not walking after a similar meal, and log both"
)
ALTERNATE_MEAL_TIMING = (
    "Eat a similar meal early on some days and later on others, and log both"
)


def paired_meals_needed(minimum: int) -> str:
    """The one suggestion that needs a number in it."""
    return (
        f"Log at least {minimum} meals both with and without a walk afterwards"
    )


ALL: frozenset[str] = frozenset(
    {
        LOG_GLUCOSE,
        LOG_WAKING_GLUCOSE,
        LOG_AROUND_MEALS,
        LOG_MEALS_PROMPTLY,
        LOG_MEAL_CARBS,
        LOG_MEALS_ACROSS_THE_DAY,
        LOG_ACTIVITY_MINUTES,
        LOG_HBA1C,
        LOG_WEIGHT,
        LOG_FASTING_GLUCOSE,
        LOG_MEDICATION_TIMING,
        CONFIRM_DIAGNOSIS,
        ALTERNATE_WALKING,
        ALTERNATE_MEAL_TIMING,
    }
)


def is_capturable(suggestion: str) -> bool:
    """Whether the product has somewhere to put what this asks for."""
    if suggestion in ALL:
        return True
    # The only generated one. Checked by shape rather than by value so the
    # threshold can change without this drifting.
    return suggestion.startswith("Log at least ") and suggestion.endswith(
        "meals both with and without a walk afterwards"
    )
