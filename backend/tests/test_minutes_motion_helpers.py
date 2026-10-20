"""Pending motions are wording only; nothing sealed or printed may include them."""

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.utils.minutes_snapshot import build_snapshot, content_hash
from app.utils.motion_votes import acceptance_label, recorded_motions

pytestmark = pytest.mark.unit


def _motion(status="passed", **extra):
    base = dict(
        id=extra.pop("id", "m"),
        order=0,
        motion_text="Motion",
        moved_by=None,
        seconded_by=None,
        discussion_notes=None,
        status=status,
        votes_for=None,
        votes_against=None,
        votes_abstain=None,
        votes_recused=None,
        threshold=None,
        roll_call=None,
        election_id=None,
        ballot_item_id=None,
        section_key=None,
        acceptance=None,
        previous_minutes_id=None,
    )
    base.update(extra)
    return SimpleNamespace(**base)


def _minutes(motions):
    return SimpleNamespace(
        title="T",
        meeting_type="business",
        meeting_date=datetime(2026, 10, 1, tzinfo=timezone.utc),
        location=None,
        called_by=None,
        called_to_order_at=None,
        adjourned_at=None,
        attendees=[],
        quorum_met=None,
        quorum_count=None,
        quorum_type=None,
        quorum_threshold=None,
        adopted_on=None,
        adopted_as_amended=None,
        adopting_minutes_id=None,
        adoption_moved_by=None,
        adoption_seconded_by=None,
        get_sections=lambda: [],
        motions=motions,
        action_items=[],
    )


class TestRecorded:
    def test_pending_is_left_out(self):
        motions = [_motion("pending", id="a"), _motion("passed", id="b")]
        assert [m.id for m in recorded_motions(motions)] == ["b"]

    def test_none_is_empty(self):
        assert recorded_motions(None) == []

    def test_an_enum_status_is_read_too(self):
        from app.models.minute import MotionStatus

        assert recorded_motions([_motion(MotionStatus.PENDING)]) == []
        assert len(recorded_motions([_motion(MotionStatus.FAILED)])) == 1


class TestAcceptanceLabel:
    @pytest.mark.parametrize(
        ("value", "label"),
        [
            ("as_submitted", "Accepted as submitted"),
            ("as_revised", "Accepted as revised"),
            (None, None),
            ("other", None),
        ],
    )
    def test_a_passed_motion(self, value, label):
        assert acceptance_label(_motion("passed", acceptance=value)) == label

    @pytest.mark.parametrize("status", ["failed", "tabled", "withdrawn", "pending"])
    def test_only_a_passed_motion_is_accepted(self, status):
        assert acceptance_label(_motion(status, acceptance="as_submitted")) is None


class TestSnapshot:
    def test_a_pending_motion_does_not_change_the_sealed_hash(self):
        decided = _motion("passed", id="b")
        without = content_hash(build_snapshot(_minutes([decided]), [], []))
        with_pending = content_hash(
            build_snapshot(_minutes([_motion("pending", id="a"), decided]), [], [])
        )
        assert without == with_pending

    def test_acceptance_is_sealed_only_when_recorded(self):
        plain = content_hash(build_snapshot(_minutes([_motion("passed")]), [], []))
        accepted = content_hash(
            build_snapshot(
                _minutes([_motion("passed", acceptance="as_revised")]), [], []
            )
        )
        assert plain != accepted
