"""Hour-of-day findings must use the reader's clock, not the server's.

Three findings turn on hour-of-day — the morning window, the fasting window,
and the late-meal split at 20:00 — and every timestamp reaches the engine as
UTC. Before the timezone argument existed, a 20:00 dinner in Sydney was logged
at 10:00 UTC and counted as an earlier meal.

The bug was invisible in development because `scripts/seed-demo.mjs` authors
meals with `setUTCHours`, so the seeded ground truth and the detector agreed in
UTC and every demo finding looked right. These tests are the thing that would
have caught it.
"""

from datetime import UTC, datetime, timedelta

import pandas as pd

from app.engines.patterns import _localise


def _frame(hours_utc: list[int]) -> pd.DataFrame:
    base = datetime(2026, 6, 1, tzinfo=UTC)
    return pd.DataFrame(
        {
            "measured_at": pd.to_datetime(
                [base + timedelta(hours=h) for h in hours_utc], utc=True
            ),
            "value_mmol": [7.0] * len(hours_utc),
        }
    )


def test_late_meal_hour_is_local_not_utc() -> None:
    # 10:00 UTC is 20:00 in Sydney: a late meal there, an early one in UTC.
    frame = _localise(_frame([10]), "measured_at", "Australia/Sydney")
    assert int(frame["measured_at"].dt.hour.iloc[0]) == 20


def test_morning_window_follows_the_reader() -> None:
    # 05:00-09:00 local is the morning window. In Los Angeles that is 12:00 to
    # 16:00 UTC, so a UTC-hour window would read the middle of their afternoon.
    frame = _localise(_frame([13]), "measured_at", "America/Los_Angeles")
    hour = int(frame["measured_at"].dt.hour.iloc[0])
    assert 5 <= hour < 9


def test_daylight_saving_is_handled_by_the_zone() -> None:
    # The reason this takes an IANA name rather than an offset: Dublin is UTC+1
    # in June and UTC+0 in December, and these are exactly the hours that move.
    june = _localise(_frame([8]), "measured_at", "Europe/Dublin")
    december = pd.DataFrame(
        {
            "measured_at": pd.to_datetime([datetime(2026, 12, 1, 8, tzinfo=UTC)], utc=True),
            "value_mmol": [7.0],
        }
    )
    assert int(june["measured_at"].dt.hour.iloc[0]) == 9
    assert (
        int(
            _localise(december, "measured_at", "Europe/Dublin")["measured_at"]
            .dt.hour.iloc[0]
        )
        == 8
    )


def test_instants_are_relabelled_never_shifted() -> None:
    # tz_convert must not move anything in absolute time: every window width,
    # ordering and difference has to survive unchanged.
    original = _frame([10, 12, 14])
    converted = _localise(original, "measured_at", "Asia/Tokyo")
    assert list(converted["measured_at"].astype("int64")) == list(
        original["measured_at"].astype("int64")
    )


def test_an_unknown_zone_falls_back_rather_than_failing() -> None:
    # The request is already authorised and the data already read. Refusing
    # here would turn a bad profile field into a failed analysis; UTC is what
    # this did before the argument existed.
    frame = _localise(_frame([10]), "measured_at", "Mars/Olympus_Mons")
    assert int(frame["measured_at"].dt.hour.iloc[0]) == 10


def test_an_empty_frame_is_returned_untouched() -> None:
    empty = pd.DataFrame(columns=["measured_at", "value_mmol"])
    assert _localise(empty, "measured_at", "Europe/Dublin").empty
