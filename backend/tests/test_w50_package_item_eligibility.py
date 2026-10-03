"""
W50-20 — the pre-meeting package must say, per ballot item, who can vote.

The election-level counts answer "who receives a ballot"; a member blocked on
one attendance-gated item still receives one, so the package read "Not
eligible 0 / every active member is eligible" while 18 of 20 could not vote
on that item. The roster already carries per-item verdicts; the package now
folds them into a per-item block, and the full variant names the blocked
members.
"""

import json
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from io import BytesIO

import pytest
from pypdf import PdfReader
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.election_service import ElectionService
from app.utils.pre_meeting_package_pdf import (
    render_pre_meeting_package_pdf,
    summarize_item_eligibility,
)

GATED_TITLE = "Accept Rowan Pike as a Probationary Member"
OPEN_TITLE = "Approve the 2027 Budget"


def _uid() -> str:
    return str(uuid.uuid4())


def _text(buf: BytesIO) -> str:
    return " ".join(
        " ".join(page.extract_text().split())
        for page in PdfReader(BytesIO(buf.getvalue())).pages
    )


def _items():
    return [
        {"id": "gated", "title": GATED_TITLE, "require_attendance": True},
        {"id": "open", "title": OPEN_TITLE},
    ]


def _roster_members():
    def member(name, gated_ok, *, override=False):
        return {
            "user_id": name.lower().replace(" ", "-"),
            "full_name": name,
            "has_override": override,
            "will_receive_ballot": True,
            "item_eligibility": [
                {
                    "ballot_item_id": "gated",
                    "ballot_item_title": GATED_TITLE,
                    "eligible": gated_ok,
                    "reason": None if gated_ok else "Not checked in for meeting",
                },
                {
                    "ballot_item_id": "open",
                    "ballot_item_title": OPEN_TITLE,
                    "eligible": True,
                    "reason": None,
                },
            ],
        }

    return [
        member("Alex Brooks", True),
        member("Blaire Carter", True, override=True),
        member("Cameron Diaz", False),
        member("Dana Evans", False),
        member("Eli Foster", False),
    ]


def _data(include_items=True):
    members = _roster_members()
    return {
        "election": {"title": "Special Meeting"},
        "ballot_items": _items(),
        "candidates": [],
        "roster": {
            "total_members": len(members),
            "total_eligible": len(members),
            "total_ineligible": 0,
            "total_overrides": 1,
            "eligible": [{"full_name": m["full_name"]} for m in members],
            "ineligible": [],
            "overrides": [],
            "items": (
                summarize_item_eligibility(_items(), members) if include_items else []
            ),
        },
    }


def _meta():
    return {"org_name": "W50-20 FD", "generated_at": datetime(2026, 9, 30, 9, 0)}


@pytest.mark.unit
class TestSummarizeItemEligibility:
    def test_folds_roster_verdicts_per_item(self):
        summary = summarize_item_eligibility(_items(), _roster_members())
        gated, open_item = summary
        assert gated["title"] == GATED_TITLE
        assert gated["eligible_count"] == 2
        assert gated["eligible_by_override"] == 1
        assert gated["blocked_count"] == 3
        assert gated["blocked_reasons"] == [
            {"reason": "Not checked in for meeting", "count": 3}
        ]
        assert [m["full_name"] for m in gated["blocked_members"]] == [
            "Cameron Diaz",
            "Dana Evans",
            "Eli Foster",
        ]
        assert open_item["eligible_count"] == 5
        assert open_item["blocked_count"] == 0
        assert open_item["blocked_members"] == []

    def test_positional_election_has_no_rows(self):
        assert summarize_item_eligibility([], _roster_members()) == []


@pytest.mark.unit
class TestRenderer:
    def test_member_variant_carries_counts_but_no_names(self):
        pdf = _text(render_pre_meeting_package_pdf(_data(), _meta()))
        assert "Eligibility by Ballot Item" in pdf
        assert GATED_TITLE in pdf
        assert "Not checked in for meeting: 3" in pdf
        assert "(1 by override)" in pdf
        # Per-member reasons are leadership detail; the member copy keeps
        # the per-item block to counts.
        assert "Not eligible for" not in pdf

    def test_full_variant_names_blocked_members_per_item(self):
        pdf = _text(
            render_pre_meeting_package_pdf(
                _data(), _meta(), include_ineligibility_detail=True
            )
        )
        assert f"Not eligible for {GATED_TITLE} (3)" in pdf
        assert "Cameron Diaz" in pdf
        assert "Eli Foster" in pdf
        assert "every active member is eligible" not in pdf
        assert "every active member receives a ballot" in pdf

    def test_election_without_blocked_items_keeps_old_wording(self):
        data = _data()
        for member in data["roster"]["eligible"]:
            member["has_override"] = False
        for row in data["roster"]["items"]:
            row.update(blocked_count=0, blocked_reasons=[], blocked_members=[])
        pdf = _text(
            render_pre_meeting_package_pdf(
                data, _meta(), include_ineligibility_detail=True
            )
        )
        assert "every active member is eligible" in pdf
        assert "Not eligible for" not in pdf


@pytest.mark.integration
class TestPackageServiceItemEligibility:
    """The service builds the block from the roster it already computes."""

    @pytest.fixture
    async def gated_election(self, db_session: AsyncSession):
        org_id = _uid()
        await db_session.execute(
            text(
                "INSERT INTO organizations "
                "(id, name, organization_type, slug, timezone, settings) "
                "VALUES (:id, 'W50-20 FD', 'fire_department', :slug, 'UTC', '{}')"
            ),
            {"id": org_id, "slug": f"w5020-{org_id[:8]}"},
        )
        user_ids = {}
        for first, last in [("Alex", "Brooks"), ("Cameron", "Diaz"), ("Dana", "Evans")]:
            uid = _uid()
            user_ids[f"{first} {last}"] = uid
            await db_session.execute(
                text(
                    "INSERT INTO users "
                    "(id, organization_id, username, first_name, last_name, "
                    "email, password_hash, status) "
                    "VALUES (:id, :org, :un, :fn, :ln, :em, 'hashed', 'active')"
                ),
                {
                    "id": uid,
                    "org": org_id,
                    "un": f"w5020-{uid[:8]}",
                    "fn": first,
                    "ln": last,
                    "em": f"w5020-{uid[:8]}@test.com",
                },
            )
        now = datetime.now(timezone.utc)
        election_id = _uid()
        checked_in = user_ids["Alex Brooks"]
        await db_session.execute(
            text(
                "INSERT INTO elections "
                "(id, organization_id, title, election_type, positions, "
                "ballot_items, attendees, start_date, end_date, status, "
                "anonymous_voting, allow_write_ins, max_votes_per_position, "
                "voting_method, victory_condition, voter_anonymity_salt, "
                "quorum_type, created_by, email_sent, "
                "results_visible_immediately, enable_runoffs, runoff_type, "
                "max_runoff_rounds, is_runoff, runoff_round, tie_policy, "
                "created_at, updated_at) "
                "VALUES (:id, :org, 'Special Meeting', 'general', NULL, "
                ":items, :attendees, :start, :end, 'draft', 1, 0, 1, "
                "'simple_majority', 'most_votes', :salt, 'none', :creator, 0, "
                "0, 0, 'top_two', 3, 0, 0, 'co_winners', NOW(), NOW())"
            ),
            {
                "id": election_id,
                "org": org_id,
                "items": json.dumps(
                    [
                        {
                            "id": "gated",
                            "title": GATED_TITLE,
                            "type": "general_vote",
                            "vote_type": "approval",
                            "eligible_voter_types": ["all"],
                            "require_attendance": True,
                        },
                        {
                            "id": "open",
                            "title": OPEN_TITLE,
                            "type": "general_vote",
                            "vote_type": "approval",
                            "eligible_voter_types": ["all"],
                        },
                    ]
                ),
                "attendees": json.dumps(
                    [{"user_id": checked_in, "checked_in_at": now.isoformat()}]
                ),
                "start": now + timedelta(days=1),
                "end": now + timedelta(days=2),
                "salt": secrets.token_hex(32),
                "creator": checked_in,
            },
        )
        await db_session.flush()
        return org_id, election_id

    async def test_full_package_reports_attendance_block_per_item(
        self, db_session: AsyncSession, gated_election
    ):
        org_id, election_id = gated_election
        svc = ElectionService(db_session)
        buf, err, _ = await svc.build_pre_meeting_package_pdf(
            uuid.UUID(election_id),
            uuid.UUID(org_id),
            include_ineligibility_detail=True,
        )
        assert err is None, err
        pdf = _text(buf)
        assert "Not checked in for meeting: 2" in pdf
        assert f"Not eligible for {GATED_TITLE} (2)" in pdf
        assert "Cameron Diaz" in pdf
        assert "Dana Evans" in pdf
        # Everyone still receives a ballot (the budget item is open to all),
        # so the election-level count stays 0 — and no longer claims that
        # every member is eligible for everything.
        assert "every active member is eligible" not in pdf
