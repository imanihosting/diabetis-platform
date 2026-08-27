"""Loading and normalising the raw signals the pattern engines run on."""

from datetime import datetime
from uuid import UUID

import pandas as pd

from app import db

MG_DL_PER_MMOL_L = 18.0182


def load_glucose(user_id: UUID, start: datetime, end: datetime) -> pd.DataFrame:
    """Glucose samples in the window, normalised to mmol/L.

    Users commonly mix devices — a meter reporting mg/dL and a CGM reporting
    mmol/L. Everything is converted on load so no downstream engine has to
    remember to check the unit.
    """
    rows = db.fetch_all(
        """
        select measured_at, glucose_value, unit, source
          from metabolic.glucose_samples
         where user_id = %s and measured_at between %s and %s
         order by measured_at
        """,
        (str(user_id), start, end),
    )
    if not rows:
        return pd.DataFrame(columns=["measured_at", "value_mmol", "source"])

    frame = pd.DataFrame(rows)
    frame["glucose_value"] = frame["glucose_value"].astype(float)
    frame["value_mmol"] = frame.apply(
        lambda r: r["glucose_value"]
        if r["unit"] == "mmol/L"
        else r["glucose_value"] / MG_DL_PER_MMOL_L,
        axis=1,
    )
    frame["measured_at"] = pd.to_datetime(frame["measured_at"], utc=True)
    return frame[["measured_at", "value_mmol", "source"]]


def load_events(
    user_id: UUID, start: datetime, end: datetime, event_types: list[str] | None = None
) -> pd.DataFrame:
    """Timeline events in the window."""
    sql = """
        select id, occurred_at, event_type, source, confidence, payload
          from metabolic.events
         where user_id = %s and occurred_at between %s and %s
    """
    params: list[object] = [str(user_id), start, end]
    if event_types:
        sql += " and event_type = any(%s)"
        params.append(event_types)
    sql += " order by occurred_at"

    rows = db.fetch_all(sql, tuple(params))
    if not rows:
        return pd.DataFrame(
            columns=["id", "occurred_at", "event_type", "source", "confidence", "payload"]
        )

    frame = pd.DataFrame(rows)
    frame["occurred_at"] = pd.to_datetime(frame["occurred_at"], utc=True)
    frame["confidence"] = frame["confidence"].astype(float)
    return frame


def load_meals(user_id: UUID, start: datetime, end: datetime) -> pd.DataFrame:
    """Meals with their aggregate estimated macros."""
    rows = db.fetch_all(
        """
        select m.id, m.started_at, m.meal_type, m.description, m.confidence,
               coalesce(sum(i.estimated_carbs_g), 0)   as carbs_g,
               coalesce(sum(i.estimated_protein_g), 0) as protein_g,
               coalesce(sum(i.estimated_fat_g), 0)     as fat_g,
               coalesce(sum(i.estimated_fiber_g), 0)   as fiber_g,
               count(i.id)                             as item_count
          from nutrition.meals m
          left join nutrition.meal_items i on i.meal_id = m.id
         where m.user_id = %s and m.started_at between %s and %s
         group by m.id
         order by m.started_at
        """,
        (str(user_id), start, end),
    )
    if not rows:
        return pd.DataFrame(
            columns=[
                "id", "started_at", "meal_type", "description", "confidence",
                "carbs_g", "protein_g", "fat_g", "fiber_g", "item_count",
            ]
        )

    frame = pd.DataFrame(rows)
    frame["started_at"] = pd.to_datetime(frame["started_at"], utc=True)
    for column in ("carbs_g", "protein_g", "fat_g", "fiber_g", "confidence"):
        frame[column] = frame[column].astype(float)
    return frame


def load_labs(
    user_id: UUID, start: datetime, end: datetime, test_names: list[str] | None = None
) -> pd.DataFrame:
    """Lab and body measurements in the window.

    One table carries HbA1c, fasting glucose, weight and BMI alike: a lab
    result is a named measurement with a value, a unit and a collection time,
    and weight fits that shape exactly.

    Rows without a numeric value are dropped. A result recorded only as text
    ("normal", "see report") is worth keeping in the record and cannot be put
    on a trend line, and silently coercing it would invent a number nobody
    measured.
    """
    sql = """
        select id, test_name, value_numeric, unit, collected_at, source
          from clinical.lab_results
         where user_id = %s and collected_at between %s and %s
           and value_numeric is not null
    """
    params: list[object] = [str(user_id), start, end]
    if test_names:
        sql += " and test_name = any(%s)"
        params.append(test_names)
    sql += " order by collected_at"

    rows = db.fetch_all(sql, tuple(params))
    if not rows:
        return pd.DataFrame(
            columns=["id", "test_name", "value_numeric", "unit", "collected_at", "source"]
        )

    frame = pd.DataFrame(rows)
    frame["collected_at"] = pd.to_datetime(frame["collected_at"], utc=True)
    frame["value_numeric"] = frame["value_numeric"].astype(float)
    return frame
