"""
Pre-Meeting Package PDF renderer — unit tests (no database required).
"""

from datetime import datetime

from app.utils.pre_meeting_package_pdf import render_pre_meeting_package_pdf


def _sample_data():
    return {
        "election": {
            "title": "2027 Annual Officer Election",
            "description": "Annual election of department officers.",
            "positions": ["Chief"],
            "start_display": "August 1, 2026 at 07:00 PM",
            "end_display": "August 1, 2026 at 09:00 PM",
            "voting_method": "simple_majority",
            "victory_condition": "majority",
            "victory_percentage": None,
            "victory_threshold": None,
            "anonymous_voting": True,
            "allow_write_ins": False,
            "quorum_type": "percentage",
            "quorum_value": 51,
            "enable_runoffs": True,
            "runoff_type": "top_two",
            "max_runoff_rounds": 3,
            "proxy_voting_enabled": True,
        },
        "meeting": {
            "title": "Annual Business Meeting",
            "meeting_type": "Business",
            "date_display": "August 1, 2026 at 07:00 PM",
            "location": "Station 1",
            "agenda": "1. Call to order\n2. Officer election\n3. Adjourn",
        },
        "ballot_items": [
            {
                "id": "item-1",
                "title": "Fire Chief",
                "position": "Chief",
                "type": "officer_election",
                "vote_type": "candidate_selection",
                "eligible_voter_types": ["operational"],
                "require_attendance": True,
            },
            {
                "id": "item-2",
                "title": "Bylaw Amendment 2027-1",
                "type": "general_vote",
                "vote_type": "approval",
                "eligible_voter_types": ["regular"],
                "victory_condition": "supermajority",
                "victory_percentage": 67,
            },
        ],
        "candidates": [
            {
                "name": "Jane Doe",
                "position": "Chief",
                "statement": "Twenty years of service & counting.",
            },
            {"name": "Bob <script> Baker", "position": "Chief", "statement": None},
        ],
        "roster": {
            "total_members": 4,
            "total_eligible": 2,
            "total_ineligible": 2,
            "total_overrides": 1,
            "eligible": [
                {
                    "full_name": "Jane Doe",
                    "membership_type": "active",
                    "has_override": False,
                },
                {
                    "full_name": "Ova Ride",
                    "membership_type": "social",
                    "has_override": True,
                },
            ],
            "ineligible": [
                {
                    "full_name": "Sam Social",
                    "reason": "Membership tier 'Social' is not eligible to vote",
                },
                {
                    "full_name": "Pat Probie",
                    "reason": "membership type not eligible (requires: regular)",
                },
            ],
            "overrides": [
                {
                    "full_name": "Ova Ride",
                    "reason": "Excused absence approved by board",
                    "overridden_by_name": "Secretary Kim",
                }
            ],
        },
    }


def _meta():
    return {
        "org_name": "Test Fire Department",
        "generated_at": datetime(2026, 7, 28, 14, 30),
    }


class TestRenderPreMeetingPackagePdf:
    def test_member_variant_renders_valid_pdf(self):
        buf = render_pre_meeting_package_pdf(_sample_data(), _meta())
        content = buf.getvalue()
        assert content.startswith(b"%PDF"), "Output must be a PDF"
        assert len(content) > 1000

    def test_full_variant_renders_valid_pdf(self):
        buf = render_pre_meeting_package_pdf(
            _sample_data(), _meta(), include_ineligibility_detail=True
        )
        assert buf.getvalue().startswith(b"%PDF")

    def test_full_variant_carries_more_content_than_member(self):
        """The full variant adds the ineligible-members and overrides tables,
        so with the same input it must render strictly more content."""
        member = render_pre_meeting_package_pdf(_sample_data(), _meta())
        full = render_pre_meeting_package_pdf(
            _sample_data(), _meta(), include_ineligibility_detail=True
        )
        assert len(full.getvalue()) > len(member.getvalue())

    def test_handles_minimal_data_without_crashing(self):
        buf = render_pre_meeting_package_pdf(
            {"election": {"title": "Bare Election"}},
            {"org_name": "FD", "generated_at": datetime(2026, 1, 1)},
            include_ineligibility_detail=True,
        )
        assert buf.getvalue().startswith(b"%PDF")

    def test_positional_election_without_ballot_items(self):
        data = _sample_data()
        data["ballot_items"] = []
        buf = render_pre_meeting_package_pdf(data, _meta())
        assert buf.getvalue().startswith(b"%PDF")

    def test_markup_in_user_content_is_escaped_not_executed(self):
        """Names/statements with markup or entities must not break the
        reportlab mini-HTML parser."""
        data = _sample_data()
        data["candidates"].append(
            {
                "name": "<b>Bold</b> & 'Quoted' <i>",
                "position": "Chief",
                "statement": "A&B <br> </para>",
            }
        )
        data["meeting"]["agenda"] = "<para>broken & markup\nsecond line"
        buf = render_pre_meeting_package_pdf(
            data, _meta(), include_ineligibility_detail=True
        )
        assert buf.getvalue().startswith(b"%PDF")
