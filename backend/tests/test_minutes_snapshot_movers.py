"""What the sealed snapshot says about motions and who moved the adoption.

The new keys are added only when they hold a value, so a snapshot sealed before
this feature existed hashes exactly as it did the day it was sealed.
"""

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.utils.minutes_snapshot import build_snapshot

pytestmark = [pytest.mark.unit]


def _minutes(**overrides):
    base = dict(
        title="Monthly",
        meeting_type="business",
        meeting_date=datetime(2026, 10, 1, 19, 0, tzinfo=timezone.utc),
        location="Station 1",
        called_by=None,
        called_to_order_at=None,
        adjourned_at=None,
        attendees=[],
        adopted_on=None,
        adopted_as_amended=None,
        adopting_minutes_id=None,
        quorum_met=None,
        quorum_count=None,
        quorum_type=None,
        quorum_threshold=None,
        motions=[],
        action_items=[],
        get_sections=lambda: [],
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def _motion(**overrides):
    base = dict(
        id="m1",
        order=0,
        motion_text="Motion to adjourn.",
        moved_by="A",
        seconded_by="B",
        discussion_notes=None,
        status="passed",
        votes_for=None,
        votes_against=None,
        votes_abstain=None,
        election_id=None,
        ballot_item_id=None,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def test_adoption_movers_are_sealed_when_recorded():
    snap = build_snapshot(
        _minutes(adoption_moved_by="A", adoption_seconded_by="B"), [], []
    )

    assert snap["adoption"]["moved_by"] == "A"
    assert snap["adoption"]["seconded_by"] == "B"


def test_adoption_without_movers_keeps_its_earlier_shape():
    snap = build_snapshot(_minutes(), [], [])

    assert set(snap["adoption"]) == {"adopted_on", "as_amended", "adopting_minutes_id"}


def test_a_motions_section_is_sealed_only_when_it_has_one():
    snap = build_snapshot(
        _minutes(
            motions=[
                _motion(id="m1", order=0, section_key="adjournment"),
                _motion(id="m2", order=1, section_key=None),
                _motion(id="m3", order=2),
            ]
        ),
        [],
        [],
    )

    first, second, third = snap["motions"]
    assert first["section_key"] == "adjournment"
    assert "section_key" not in second
    assert "section_key" not in third
