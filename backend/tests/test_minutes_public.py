"""What the public copy of a set of minutes may show.

Each private value below is planted somewhere the printed copy carries it and
the public copy must not. The assertions are on the serialized output, so a
leak through a field nobody thought to name still fails.
"""

import json

import pytest

from app.utils.minutes_public import narrow_for_public

pytestmark = [pytest.mark.unit]

SECRETS = [
    "Dana Rollcall",
    "dana@private.example",
    "Participant Behindclosed",
    "Discussion nobody should read",
    "Closed session summary text",
    "secret-attachment.pdf",
    "a" * 64,
    "Approver Name",
    "Submitter Name",
    "Voter Level Detail",
    "agenda-library-link",
    "Individual Voter Name",
]


def printed() -> dict:
    return {
        "title": "October business meeting",
        "meeting_type_display": "Business",
        "meeting_date_display": "October 20, 2026 at 07:00 PM",
        "location": "Station 1",
        "called_by": "Chief Morgan",
        "called_to_order": "07:02 PM",
        "adjourned": "08:30 PM",
        "status_display": "Approved",
        "quorum_display": "Quorum met (9 present)",
        "attendees": [
            {"name": "Chief Morgan", "role": "Chief", "status": "present"},
            {
                "name": "Dana Rollcall",
                "role": None,
                "status": "present",
                "note": "dana@private.example",
            },
            {"name": "Lee Excused", "role": None, "status": "excused"},
            {"name": "Sam Absent", "role": None, "status": "absent"},
            {"name": "A visitor", "role": None, "status": "guest"},
        ],
        "sections": [
            {
                "order": 0,
                "key": "agenda-a",
                "title": "Treasurer's report",
                "content": "<p>Balance reported.</p><script>bad()</script>",
                "format": "html",
                "presenter": "Lee Treasurer",
                "agenda_key": "a",
                "documents": [{"id": "agenda-library-link", "name": "Ledger"}],
            },
            {
                "order": 1,
                "key": "b",
                "title": "Old business",
                "content": "",
                "not_taken_up": True,
            },
            {"order": 2, "key": "c", "title": "Empty heading", "content": ""},
        ],
        "motions": [
            {
                "number": 1,
                "text": "Move to adopt the budget.",
                "status": "passed",
                "moved_by": "Pat Mover",
                "seconded_by": "Sam Seconder",
                "notes": "Discussion nobody should read",
                "ballot": "Individual Voter Name",
                "vote_display": "For 7, Against 1, Abstain 1",
                "roll_call": [{"name": "Individual Voter Name", "vote": "for"}],
            }
        ],
        "action_items": [
            {
                "description": "Order hose",
                "assignee": "Pat Mover",
                "due": "2026-11-01",
                "priority": "high",
                "status": "pending",
            }
        ],
        "closed_sessions": [
            {
                "reason": "Personnel matter",
                "legal_basis": "Va. Code 2.2-3711(A)(1)",
                "started": "08:00 PM",
                "ended": "08:20 PM",
                "participants": [{"name": "Participant Behindclosed"}],
                "summary": "Closed session summary text",
            }
        ],
        "election_results": [
            {
                "title": "Officer election",
                "closed_display": "October 1, 2026",
                "addendum": False,
                "snapshot": {
                    "total_eligible_voters": 40,
                    "total_votes": 30,
                    "voter_turnout_percentage": 75,
                    "voters": [{"name": "Voter Level Detail"}],
                    "results_by_position": [
                        {
                            "position": "President",
                            "candidates": [
                                {
                                    "candidate_name": "Pat Candidate",
                                    "vote_count": 20,
                                    "percentage": 66.7,
                                    "is_winner": True,
                                },
                                {
                                    "candidate_name": "Lee Candidate",
                                    "vote_count": 10,
                                    "percentage": 33.3,
                                },
                            ],
                        }
                    ],
                },
            }
        ],
        "attachments": [
            {"title": "Budget", "name": "secret-attachment.pdf", "sha256": "a" * 64}
        ],
        "approval": {
            "submitted_by": "Submitter Name",
            "approved_by": "Approver Name",
            "adopted_on_display": "October 21, 2026",
            "as_amended": False,
            "version": 2,
            "content_hash": "a" * 64,
            "signatures": [
                {
                    "title": "Recording Secretary",
                    "name": "Lee Secretary",
                    "signed_at_display": "October 22, 2026",
                }
            ],
        },
        "header": {"org_name": "Falls Church FD"},
        "footer": {"text": "internal footer"},
    }


def dump() -> str:
    return json.dumps(narrow_for_public(printed()))


class TestNothingPrivateGoesOut:
    @pytest.mark.parametrize("secret", SECRETS)
    def test_a_private_value_never_reaches_the_public_copy(self, secret):
        assert secret not in dump()

    def test_the_output_is_built_from_names_not_copied(self):
        data = printed()
        data["something_new_on_the_printed_copy"] = "future private field"
        data["motions"][0]["new_motion_field"] = "future private motion field"
        assert "future private" not in json.dumps(narrow_for_public(data))


class TestWhatIsShown:
    def test_attendance_is_counts_and_officers(self):
        attendance = narrow_for_public(printed())["attendance"]
        assert attendance["present"] == 2
        assert attendance["excused"] == 1
        assert attendance["absent"] == 1
        assert attendance["guests"] == 1
        assert attendance["officers_present"] == [
            {"name": "Chief Morgan", "role": "Chief"}
        ]

    def test_motions_keep_wording_movers_totals_and_result(self):
        (motion,) = narrow_for_public(printed())["motions"]
        assert motion["text"] == "Move to adopt the budget."
        assert motion["moved_by"] == "Pat Mover"
        assert motion["seconded_by"] == "Sam Seconder"
        assert motion["status"] == "passed"
        assert motion["vote_display"] == "For 7, Against 1, Abstain 1"

    def test_closed_sessions_show_why_authority_and_times_only(self):
        (session,) = narrow_for_public(printed())["closed_sessions"]
        assert session == {
            "reason": "Personnel matter",
            "legal_basis": "Va. Code 2.2-3711(A)(1)",
            "started": "08:00 PM",
            "ended": "08:20 PM",
        }

    def test_elections_show_turnout_and_candidate_counts(self):
        (election,) = narrow_for_public(printed())["election_results"]
        assert election["eligible_voters"] == 40
        assert election["ballots_cast"] == 30
        winner = election["contests"][0]["candidates"][0]
        assert winner == {
            "name": "Pat Candidate",
            "votes": 20,
            "percentage": 66.7,
            "outcome": "winner",
        }

    def test_signatures_and_adoption_are_shown_without_the_approvers(self):
        approval = narrow_for_public(printed())["approval"]
        assert approval["adopted_on"] == "October 21, 2026"
        assert approval["version"] == 2
        assert approval["signatures"][0]["name"] == "Lee Secretary"


class TestSections:
    def test_an_empty_section_is_left_out_and_not_taken_up_is_kept(self):
        titles = [s["title"] for s in narrow_for_public(printed())["sections"]]
        assert titles == ["Treasurer's report", "Old business"]
        old = narrow_for_public(printed())["sections"][1]
        assert old["not_taken_up"] is True

    def test_rich_text_is_cleaned_again(self):
        section = narrow_for_public(printed())["sections"][0]
        assert "<script" not in section["content"]
        assert "Balance reported." in section["content"]
        assert section["presenter"] == "Lee Treasurer"
        assert "documents" not in section


class TestDefensive:
    @pytest.mark.parametrize(
        "bad", [None, "text", 5, [], {"sections": "x", "motions": 3, "attendees": {}}]
    )
    def test_malformed_input_does_not_raise(self, bad):
        result = narrow_for_public(bad if isinstance(bad, dict) else {})
        assert result["sections"] == []
        assert result["attendance"]["present"] == 0

    def test_a_huge_list_is_capped(self):
        data = printed()
        data["motions"] = [{"number": n, "text": "x"} for n in range(5000)]
        assert len(narrow_for_public(data)["motions"]) <= 500
