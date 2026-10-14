"""Meeting-minutes record keeping — the parts that need no database.

* the canonical attendee shape and what counts toward a quorum,
* the approved-version snapshot and its hash,
* the PDF renderer,
* that the migration's frozen copy of the attendee mapping agrees with the live
  one today (it is allowed to diverge later; it must not start out different).
"""

import importlib.util
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.schemas.minute import AttendeeEntry, MinutesUpdate
from app.utils.minutes_attendance import (
    ATTENDANCE_STATUSES,
    COUNTS_TOWARD_QUORUM,
    counts_toward_quorum,
    derive_status,
    normalize_attendee,
    normalize_attendees,
)
from app.utils.minutes_pdf import render_minutes_pdf
from app.utils.minutes_snapshot import build_snapshot, content_hash

pytestmark = pytest.mark.unit


class TestAttendanceShape:
    @pytest.mark.parametrize(
        ("entry", "expected"),
        [
            ({"name": "A", "present": True}, "present"),
            ({"name": "A", "present": False}, "absent"),
            ({"name": "A", "present": False, "excused": True}, "excused"),
            # A legacy free-text guest was stored present and counted toward
            # the quorum recorded beside it; it must not silently stop counting.
            ({"name": "Visitor", "present": True}, "present"),
            ({"name": "A", "status": "late", "present": False}, "late"),
            ({"name": "A", "status": "nonsense", "present": True}, "present"),
        ],
    )
    def test_status_is_derived_from_legacy_entries(self, entry, expected):
        assert derive_status(entry) == expected

    def test_only_members_in_the_room_count_toward_quorum(self):
        assert COUNTS_TOWARD_QUORUM == {"present", "late", "left_early"}
        for status in ATTENDANCE_STATUSES:
            entry = {"name": "A", "status": status}
            assert counts_toward_quorum(entry) is (status in COUNTS_TOWARD_QUORUM)

    def test_a_guest_never_counts(self):
        assert counts_toward_quorum({"name": "Visitor", "status": "guest"}) is False

    def test_normalize_keeps_status_and_agrees_present_with_it(self):
        entry = normalize_attendee(
            {"user_id": "u1", "name": "A", "status": "left_early", "present": False}
        )
        assert entry == {
            "user_id": "u1",
            "name": "A",
            "role": None,
            "status": "left_early",
            "present": True,
            "note": None,
        }

    def test_normalizing_twice_changes_nothing(self):
        once = normalize_attendees([{"name": "A", "present": False, "excused": True}])
        assert normalize_attendees(once) == once

    def test_no_roll_taken_stays_none(self):
        assert normalize_attendees(None) is None


class TestAttendeeSchema:
    def test_only_present_given_derives_the_status(self):
        entry = AttendeeEntry(name="A", present=False)
        assert (entry.status, entry.present) == ("absent", False)

    def test_status_wins_and_present_is_corrected(self):
        entry = AttendeeEntry(name="A", status="late", present=False)
        assert (entry.status, entry.present) == ("late", True)

    def test_a_guest_is_not_present_for_quorum(self):
        assert AttendeeEntry(name="V", status="guest").present is False

    def test_an_unknown_status_is_refused(self):
        with pytest.raises(ValidationError):
            AttendeeEntry(name="A", status="maybe")

    def test_a_member_listed_twice_is_refused(self):
        with pytest.raises(ValidationError, match="only once"):
            MinutesUpdate(
                attendees=[
                    {"name": "A", "user_id": "u1"},
                    {"name": "A again", "user_id": "u1"},
                ]
            )

    def test_two_free_text_guests_are_allowed(self):
        update = MinutesUpdate(
            attendees=[
                {"name": "Visitor 1", "status": "guest"},
                {"name": "Visitor 2", "status": "guest"},
            ]
        )
        assert len(update.attendees or []) == 2


def _minutes(**overrides):
    base = dict(
        title="October meeting",
        meeting_type="business",
        meeting_date=datetime(2026, 10, 1, 19, 0, tzinfo=timezone.utc),
        location="Station 1",
        called_by="Chief",
        called_to_order_at=None,
        adjourned_at=None,
        attendees=[normalize_attendee({"name": "A", "status": "present"})],
        quorum_met=True,
        quorum_count=1,
        quorum_type="percentage",
        quorum_threshold=66.7,
        motions=[
            SimpleNamespace(
                id="m1",
                order=0,
                motion_text="Buy hose",
                moved_by="A",
                seconded_by="B",
                discussion_notes=None,
                status="passed",
                votes_for=5,
                votes_against=1,
                votes_abstain=0,
            )
        ],
        action_items=[
            SimpleNamespace(
                id="a1",
                description="Order the hose",
                assignee_id="u1",
                assignee_name="A",
                due_date=datetime(2026, 11, 1, tzinfo=timezone.utc),
                priority="high",
                status="pending",
            )
        ],
    )
    base.update(overrides)
    minutes = SimpleNamespace(**base)
    minutes.get_sections = lambda: [
        {"order": 1, "key": "new", "title": "New Business", "content": "Hose."},
        {"order": 0, "key": "call", "title": "Call to Order", "content": "7pm."},
    ]
    return minutes


def _election():
    return SimpleNamespace(
        id="r1", election_id="e1", election_title="Board", snapshot={"total_votes": 9}
    )


def _attachment(category="report", sha="a" * 64, id_="f1"):
    return SimpleNamespace(
        id=id_,
        title="Treasurer report",
        category=category,
        original_name="report.pdf",
        sha256=sha,
        file_size=10,
    )


class TestSnapshotAndHash:
    def test_the_hash_does_not_depend_on_key_or_row_order(self):
        a = build_snapshot(_minutes(), [_election()], [_attachment()])
        b = dict(reversed(list(a.items())))
        assert content_hash(a) == content_hash(b)

    def test_it_is_a_sha256_hex_digest(self):
        digest = content_hash(build_snapshot(_minutes(), [], []))
        assert len(digest) == 64
        int(digest, 16)

    def test_changing_the_record_changes_the_hash(self):
        base = content_hash(build_snapshot(_minutes(), [], []))
        edited = _minutes(location="Station 2")
        assert content_hash(build_snapshot(edited, [], [])) != base

    def test_an_action_items_progress_is_not_part_of_what_was_approved(self):
        minutes = _minutes()
        before = content_hash(build_snapshot(minutes, [], []))
        minutes.action_items[0].status = "completed"
        minutes.action_items[0].completion_notes = "Done"
        assert content_hash(build_snapshot(minutes, [], [])) == before

    def test_reassigning_an_action_item_is(self):
        minutes = _minutes()
        before = content_hash(build_snapshot(minutes, [], []))
        minutes.action_items[0].assignee_id = "u2"
        assert content_hash(build_snapshot(minutes, [], [])) != before

    def test_a_signed_copy_filed_after_approval_is_outside_the_hash(self):
        minutes = _minutes()
        before = content_hash(build_snapshot(minutes, [], [_attachment()]))
        signed = _attachment(category="signed_copy", sha="b" * 64, id_="f2")
        after = content_hash(build_snapshot(minutes, [], [_attachment(), signed]))
        assert after == before

    def test_any_other_attachment_is(self):
        minutes = _minutes()
        before = content_hash(build_snapshot(minutes, [], []))
        assert content_hash(build_snapshot(minutes, [], [_attachment()])) != before

    def test_the_election_result_filed_is(self):
        minutes = _minutes()
        before = content_hash(build_snapshot(minutes, [], []))
        assert content_hash(build_snapshot(minutes, [_election()], [])) != before

    def test_fractions_of_a_second_and_naive_utc_do_not_matter(self):
        precise = _minutes(
            meeting_date=datetime(2026, 10, 1, 19, 0, 0, 987654, tzinfo=timezone.utc)
        )
        naive = _minutes(meeting_date=datetime(2026, 10, 1, 19, 0, 0))
        assert content_hash(build_snapshot(precise, [], [])) == content_hash(
            build_snapshot(naive, [], [])
        )

    def test_a_float_column_read_back_in_single_precision_hashes_the_same(self):
        exact = _minutes(quorum_threshold=66.7)
        read_back = _minutes(quorum_threshold=66.69999694824219)
        assert content_hash(build_snapshot(exact, [], [])) == content_hash(
            build_snapshot(read_back, [], [])
        )


class TestPdf:
    def _data(self, **extra):
        data = {
            "title": "October <b>meeting</b>",
            "meeting_type_display": "Business",
            "meeting_date_display": "October 01, 2026 at 07:00 PM",
            "location": "Station 1",
            "called_by": "Chief",
            "status_display": "Approved",
            "attendees": [
                {"name": "Alex", "role": "Chief", "status": "present", "note": None},
                {"name": "Blake", "role": None, "status": "excused", "note": "Away"},
                {"name": "Visitor", "role": None, "status": "guest", "note": None},
            ],
            "quorum_display": "Quorum met (1 present)",
            "sections": [{"title": "Call", "content": "Line one\nLine two <script>"}],
            "motions": [
                {
                    "number": 1,
                    "text": "Buy hose",
                    "status": "passed",
                    "moved_by": "Alex",
                    "seconded_by": "Blake",
                    "notes": None,
                    "vote_display": "Vote 5-1",
                }
            ],
            "action_items": [
                {
                    "description": "Order it",
                    "assignee": "Alex",
                    "due": "2026-11-01",
                    "priority": "high",
                    "status": "pending",
                }
            ],
            "election_results": [
                {
                    "title": "Board",
                    "closed_display": "October 01, 2026",
                    "snapshot": {
                        "total_eligible_voters": 12,
                        "total_votes": 9,
                        "voter_turnout_percentage": 75.0,
                        "quorum_met": True,
                        "results_by_position": [
                            {
                                "position": "Chief",
                                "candidates": [
                                    {
                                        "candidate_name": "Alex",
                                        "vote_count": 6,
                                        "percentage": 66.7,
                                        "is_winner": True,
                                    }
                                ],
                            }
                        ],
                        "overall_results": [],
                    },
                }
            ],
            "attachments": [
                {
                    "title": "Report",
                    "category": "report",
                    "name": "r.pdf",
                    "sha256": "a" * 64,
                }
            ],
            "approval": {
                "submitted_by": "Blake",
                "approved_by": "Casey",
                "approved_at_display": "October 05, 2026",
                "version": 2,
                "content_hash": "c" * 64,
            },
            "header": {"org_name": "Falls Church Fire", "subtitle": "Official"},
            "footer": {"confidentiality_notice": "Members only"},
        }
        data.update(extra)
        return data

    def test_a_full_record_renders_a_pdf(self):
        pdf = render_minutes_pdf(self._data(), {"generated_at": "now"}).read()
        assert pdf.startswith(b"%PDF")
        assert len(pdf) > 2000

    def test_a_bare_draft_renders(self):
        pdf = render_minutes_pdf(
            {"title": "Draft", "approval": None}, {"generated_at": "now"}
        ).read()
        assert pdf.startswith(b"%PDF")

    def test_markup_in_user_text_does_not_break_rendering(self):
        data = self._data(
            title="</para><b>unclosed",
            sections=[{"title": "<i>x", "content": "a & b < c"}],
        )
        assert (
            render_minutes_pdf(data, {"generated_at": "now"}).read().startswith(b"%PDF")
        )


class TestMigrationParity:
    def test_the_frozen_copy_agrees_with_the_live_mapping_today(self):
        path = next(
            (Path(__file__).resolve().parents[1] / "alembic" / "versions").glob(
                "*_8efc77d4c0c3_*.py"
            )
        )
        spec = importlib.util.spec_from_file_location("_minutes_record", path)
        assert spec is not None
        assert spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        cases = [
            {"name": "A", "present": True},
            {"name": "A", "present": False},
            {"name": "A", "present": False, "excused": True},
            {"user_id": "u", "name": "A", "role": "Chief", "status": "late"},
            {"name": "A", "status": "guest", "note": "Visitor"},
            {"name": "", "present": True},
            {"name": "A", "status": "bogus", "present": False},
        ]
        for case in cases:
            assert module._normalize(case) == normalize_attendee(case), case
