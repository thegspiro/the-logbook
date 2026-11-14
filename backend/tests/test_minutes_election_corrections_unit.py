"""How each copy of the minutes shows a superseded election result.

The database path is covered by ``test_minutes_election_correction_integration``;
these pin the renderers and the replacement link without one.
"""

from datetime import datetime
from types import SimpleNamespace

import pytest
from reportlab.lib.styles import getSampleStyleSheet

from app.utils.minutes_election_corrections import replaced_corrections
from app.utils.minutes_pdf import _election_block
from app.utils.minutes_public import narrow_for_public

pytestmark = pytest.mark.unit

FILED = datetime(2026, 10, 2, 12, 0)
ROLLED_BACK = datetime(2026, 10, 20, 15, 30)


def _row(row_id, *, created=FILED, superseded=None, election_id="e1"):
    return SimpleNamespace(
        id=row_id,
        election_id=election_id,
        created_at=created,
        superseded_at=superseded,
    )


class TestReplacedCorrections:
    def test_a_later_result_replaces_the_superseded_one(self):
        rows = [
            _row("new", created=datetime(2026, 10, 27)),
            _row("old", superseded=ROLLED_BACK),
        ]

        assert replaced_corrections(rows) == {"new": ROLLED_BACK}

    def test_a_tie_on_the_second_still_puts_the_standing_result_last(self):
        rows = [_row("b-new"), _row("a-old", superseded=ROLLED_BACK)]

        assert replaced_corrections(rows) == {"b-new": ROLLED_BACK}

    def test_each_result_replaces_the_one_superseded_just_before_it(self):
        second = datetime(2026, 10, 25)
        rows = [
            _row("one", superseded=ROLLED_BACK),
            _row("two", created=datetime(2026, 10, 21), superseded=second),
            _row("three", created=datetime(2026, 10, 26)),
        ]

        assert replaced_corrections(rows) == {"two": ROLLED_BACK, "three": second}

    def test_other_elections_and_unsuperseded_results_are_not_linked(self):
        rows = [
            _row("a", superseded=ROLLED_BACK),
            _row("b", created=datetime(2026, 10, 27), election_id="e2"),
            _row("c", created=datetime(2026, 10, 27), election_id=None),
        ]

        assert replaced_corrections(rows) == {}

    def test_a_row_without_the_columns_reads_as_never_superseded(self):
        assert replaced_corrections([SimpleNamespace(id="x")]) == {}


def _printed(**election):
    entry = {
        "title": "Officer election",
        "closed_display": "October 09, 2026",
        "snapshot": {"total_eligible_voters": 12, "total_votes": 9},
        "addendum": True,
        "filed_display": "October 10, 2026",
        "superseded_display": None,
        "superseded_reason": None,
        "replaces_display": None,
        **election,
    }
    return {"election_results": [entry]}


def _pdf_text(entry) -> str:
    styles = getSampleStyleSheet()
    flowables = _election_block(entry, styles, styles["Heading2"])
    return " ".join(f.getPlainText() for f in flowables if hasattr(f, "getPlainText"))


class TestThePrintedCopy:
    def test_the_correction_and_its_reason_are_printed_over_the_result(self):
        entry = _printed(
            superseded_display="October 20, 2026",
            superseded_reason="Two <ballots> counted twice",
        )["election_results"][0]

        text = _pdf_text(entry)

        assert (
            "Correction filed October 20, 2026: this result has been superseded."
            in (text)
        )
        assert "Reason given: Two <ballots> counted twice" in text
        assert "Votes cast: 9" in text

    def test_the_re_runs_result_names_the_correction_it_replaces(self):
        entry = _printed(replaces_display="October 20, 2026")["election_results"][0]

        text = _pdf_text(entry)

        assert "Corrected result: replaces the result superseded on October 20" in text
        assert "Correction filed" not in text


class TestThePublicCopy:
    def test_it_carries_the_dates_but_not_the_reason(self):
        public = narrow_for_public(
            _printed(
                superseded_display="October 20, 2026",
                superseded_reason="Chief Smith's ballots were miscounted",
                replaces_display="October 1, 2026",
            )
        )

        (entry,) = public["election_results"]
        assert entry["superseded_on"] == "October 20, 2026"
        assert entry["replaces_superseded_on"] == "October 1, 2026"
        assert "Smith" not in str(public)
