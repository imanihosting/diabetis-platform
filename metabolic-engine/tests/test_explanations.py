"""Tests for the competing-explanations catalogue.

Two rules, and both are about what the product is allowed to say.

**Nothing is generated.** A competing explanation is a clinical claim about why
somebody's glucose did what it did. Every one comes from a reviewed catalogue,
and a detector that produces a finding with no entry is a gap in that review
rather than a finding that quietly ships without alternatives.

**Nothing asks for data the product cannot hold.** An explanation that says
"log your sleep" when there is nowhere to put it sends a person looking for a
control that does not exist. Where the data genuinely cannot be captured, the
explanation says so and stops — which is still worth telling somebody, and is
the reason those entries stay on the list rather than being dropped.
"""

from datetime import UTC, datetime, timedelta

import pandas as pd

from app.engines import explanations, patterns, registry, suggestions

BASE = datetime(2026, 8, 1, tzinfo=UTC)


class TestTheCatalogueIsReviewed:
    def test_every_detector_has_entries_or_is_excused(self) -> None:
        """A detector shipped without alternatives fails here, not in front of
        a reader.

        This is the test the whole module exists for. Adding a detector without
        thinking about what else could explain its pattern is easy and silent;
        this makes it loud.
        """
        for detector in patterns.DETECTORS:
            assert (
                detector.name in explanations.CATALOGUE
                or detector.name in explanations.NO_EXPLANATIONS_NEEDED
            ), (
                f"{detector.name} has no competing explanations and is not "
                "listed as needing none. Decide which, in explanations.py."
            )

    def test_the_catalogue_does_not_describe_detectors_that_do_not_exist(self) -> None:
        # The other direction: an entry left behind after a detector was
        # removed is a reviewed claim about nothing.
        names = {d.name for d in patterns.DETECTORS}
        assert set(explanations.CATALOGUE) <= names

    def test_nothing_is_excused_and_catalogued_at_once(self) -> None:
        assert not (set(explanations.CATALOGUE) & explanations.NO_EXPLANATIONS_NEEDED)

    def test_every_entry_answers_all_four_questions(self) -> None:
        # An explanation that only names itself is not usable: a reader needs
        # why it could produce this, what would support it, and what is missing.
        for entry in explanations.ALL:
            assert entry.label.strip()
            assert entry.why.strip()
            assert entry.supported_by.strip()
            assert entry.missing.strip()

    def test_no_two_explanations_share_a_label(self) -> None:
        labels = [e.label for e in explanations.ALL]
        assert len(set(labels)) == len(labels)

    def test_a_detector_does_not_repeat_itself(self) -> None:
        for name, entries in explanations.CATALOGUE.items():
            labels = [e.label for e in entries]
            assert len(set(labels)) == len(labels), f"{name} lists one twice"


class TestNothingAsksForDataWeCannotHold:
    def test_every_capture_is_something_the_product_can_record(self) -> None:
        """The honesty rule.

        `capture` is a reference into `suggestions.py`, where every value names
        the endpoint that stores it. A boolean would have been somebody's
        opinion at the time of writing and would stay true-looking long after
        the capture path was removed.
        """
        for entry in explanations.ALL:
            if entry.capture is None:
                continue
            assert suggestions.is_capturable(entry.capture), (
                f'"{entry.label}" asks for {entry.capture!r}, which nothing in '
                "the product records. Point it at a real suggestion, or set "
                "capture=None to say plainly that it is not captured yet."
            )

    def test_what_cannot_be_captured_says_so_rather_than_going_quiet(self) -> None:
        # Sleep is the case this rule was written around: it genuinely matters
        # to several of these findings and the product has nowhere to put it.
        # Dropping it would make the list look complete when it is not.
        uncapturable = [e for e in explanations.ALL if e.capture is None]

        assert uncapturable, "at least one honest gap is expected here"
        for entry in uncapturable:
            assert entry.missing.strip()

    def test_the_check_would_catch_an_invented_capture(self) -> None:
        # Guards the guard. The rule is only worth having if it fails on the
        # thing it exists to catch.
        invented = explanations.Explanation(
            label="Made up",
            why="...",
            supported_by="...",
            missing="...",
            capture="Log your sleep and your stress levels",
        )
        assert not suggestions.is_capturable(invented.capture or "")


class TestOnTheFindings:
    @staticmethod
    def frames() -> registry.DetectorInputs:
        starts = [BASE + timedelta(days=d, hours=12) for d in range(12)]
        rows: list[tuple[datetime, float]] = []
        for start in starts:
            rows.extend(
                [
                    (start - timedelta(minutes=5), 6.0),
                    (start + timedelta(minutes=60), 9.5),
                    (start + timedelta(minutes=120), 6.4),
                ]
            )

        glucose = pd.DataFrame(
            {
                "measured_at": pd.to_datetime([r[0] for r in rows], utc=True),
                "value_mmol": [r[1] for r in rows],
                "source": ["cgm_device"] * len(rows),
            }
        )
        meals = pd.DataFrame(
            {
                "id": [f"meal-{i}" for i in range(len(starts))],
                "started_at": pd.to_datetime(starts, utc=True),
                "meal_type": ["lunch"] * len(starts),
                "description": ["Test meal"] * len(starts),
                "confidence": [1.0] * len(starts),
                "carbs_g": [45.0] * len(starts),
                "protein_g": [20.0] * len(starts),
                "fat_g": [10.0] * len(starts),
                "fiber_g": [5.0] * len(starts),
                "item_count": [1] * len(starts),
            }
        )
        empty = pd.DataFrame()
        return registry.DetectorInputs(
            glucose=glucose, meals=meals, activity=empty, labs=empty
        )

    def test_a_measured_finding_carries_its_alternatives(self) -> None:
        inputs = self.frames()
        finding = patterns._post_meal_detector(inputs)  # noqa: SLF001
        assert finding is not None

        attached = patterns._with_explanations(finding)  # noqa: SLF001
        assert attached.effect_estimate is not None
        assert attached.competing_explanations

        labels = {e.label for e in attached.competing_explanations}
        assert labels == {
            e.label for e in explanations.CATALOGUE["post_meal_response"]
        }

    def test_a_finding_that_measured_nothing_offers_none(self) -> None:
        # Four alternatives for a result that does not exist would read as
        # though one did.
        two_mornings = pd.DataFrame(
            {
                "measured_at": pd.to_datetime(
                    [BASE.replace(hour=7), BASE.replace(hour=7) + timedelta(days=1)],
                    utc=True,
                ),
                "value_mmol": [6.5, 6.7],
                "source": ["cgm_device"] * 2,
            }
        )
        finding = patterns._morning_glucose_pattern(two_mornings)  # noqa: SLF001

        assert finding.effect_estimate is None
        assert patterns._with_explanations(finding).competing_explanations == []  # noqa: SLF001

    def test_nothing_is_emitted_that_is_not_in_the_catalogue(self) -> None:
        """The acceptance rule, checked on real findings rather than on the map.

        Runs every detector over a record that produces measurements, and
        asserts every explanation that comes out is one somebody reviewed.
        """
        inputs = self.frames()
        approved = {e.label for e in explanations.ALL}

        for detector in patterns.DETECTORS:
            produced = detector.run(inputs)
            if produced is None:
                continue

            for entry in patterns._with_explanations(produced).competing_explanations:  # noqa: SLF001
                assert entry.label in approved

    def test_the_contract_travels_under_the_names_typescript_expects(self) -> None:
        entry = explanations.for_finding("post_meal_response")[0]

        assert set(entry.model_dump(by_alias=True)) == {
            "label",
            "why",
            "supportedBy",
            "missing",
            "capture",
        }
