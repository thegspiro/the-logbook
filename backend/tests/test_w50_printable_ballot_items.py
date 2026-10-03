"""
W50-8: the printable paper ballot carries every contest, not only the
position races.

"Print Blank Ballots" rendered `election.positions` alone, so a motion or
membership vote on the same ballot never reached the paper path — the
in-room voter could not answer a question the electronic ballot asked.
Each approval item is now its own contest with Approve / Deny boxes, and a
ballot made of approval items only (no positions) prints too.
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
from app.utils.election_ballot_pdf import render_printable_ballot_pdf

MOTION_TITLE = "Approve the 2027 Apparatus Budget"
MEMBERSHIP_TITLE = "Approve Pat Quinn for Regular Membership"


def _uid() -> str:
    return str(uuid.uuid4())


def _text(buf: BytesIO) -> str:
    return "\n".join(
        page.extract_text() for page in PdfReader(BytesIO(buf.getvalue())).pages
    )


@pytest.mark.unit
class TestRenderer:
    def test_approval_items_render_as_approve_deny_contests(self):
        buf = render_printable_ballot_pdf(
            {
                "election": {"title": "Annual Meeting", "voting_method": "approval"},
                "positions": [{"name": "Chief", "candidates": ["Casey Chief"]}],
                "approval_items": [
                    {"title": MOTION_TITLE, "description": "Motion from the floor"}
                ],
            },
            {"org_name": "Test FD", "generated_at": "today"},
        )
        pdf_text = _text(buf)
        assert MOTION_TITLE in pdf_text
        assert "Motion from the floor" in pdf_text
        assert "Approve" in pdf_text
        assert "Deny" in pdf_text
        # The position race is untouched by the new section.
        assert "Casey Chief" in pdf_text


@pytest.mark.integration
class TestPrintableBallotItems:

    @pytest.fixture
    async def org_and_user(self, db_session: AsyncSession):
        org_id, user_id = _uid(), _uid()
        await db_session.execute(
            text(
                "INSERT INTO organizations "
                "(id, name, organization_type, slug, timezone, settings) "
                "VALUES (:id, 'W50-8 FD', 'fire_department', :slug, 'UTC', '{}')"
            ),
            {"id": org_id, "slug": f"w508-{org_id[:8]}"},
        )
        await db_session.execute(
            text(
                "INSERT INTO users "
                "(id, organization_id, username, first_name, last_name, "
                "email, password_hash, status) "
                "VALUES (:id, :org, :un, 'Sec', 'Retary', :em, 'hashed', 'active')"
            ),
            {
                "id": user_id,
                "org": org_id,
                "un": f"w508-{user_id[:8]}",
                "em": f"w508-{user_id[:8]}@test.com",
            },
        )
        await db_session.flush()
        return org_id, user_id

    async def _insert_election(
        self, db_session, org_id, creator_id, *, positions, ballot_items
    ) -> str:
        now = datetime.now(timezone.utc)
        election_id = _uid()
        await db_session.execute(
            text(
                "INSERT INTO elections "
                "(id, organization_id, title, election_type, positions, "
                "ballot_items, start_date, end_date, status, anonymous_voting, "
                "allow_write_ins, max_votes_per_position, voting_method, "
                "victory_condition, voter_anonymity_salt, quorum_type, "
                "created_by, email_sent, results_visible_immediately, "
                "enable_runoffs, runoff_type, max_runoff_rounds, "
                "is_runoff, runoff_round, tie_policy, created_at, updated_at) "
                "VALUES (:id, :org, 'W50-8 Election', 'officer', :positions, "
                ":items, :start, :end, 'open', 1, 0, 1, 'simple_majority', "
                "'most_votes', :salt, 'none', :creator, 0, 0, 0, 'top_two', 3, "
                "0, 0, 'co_winners', NOW(), NOW())"
            ),
            {
                "id": election_id,
                "org": org_id,
                "positions": json.dumps(positions) if positions else None,
                "items": json.dumps(ballot_items),
                "start": now - timedelta(days=1),
                "end": now + timedelta(days=1),
                "salt": secrets.token_hex(32),
                "creator": creator_id,
            },
        )
        await db_session.flush()
        return election_id

    async def _insert_candidate(self, db_session, election_id, name, position):
        await db_session.execute(
            text(
                "INSERT INTO candidates "
                "(id, election_id, name, position, accepted, is_write_in, "
                "display_order, created_at, updated_at) "
                "VALUES (:id, :eid, :name, :pos, 1, 0, 0, NOW(), NOW())"
            ),
            {"id": _uid(), "eid": election_id, "name": name, "pos": position},
        )
        await db_session.flush()

    async def test_mixed_ballot_prints_positions_and_approval_items(
        self, db_session: AsyncSession, org_and_user
    ):
        org_id, user_id = org_and_user
        election_id = await self._insert_election(
            db_session,
            org_id,
            user_id,
            positions=["Chief"],
            ballot_items=[
                {
                    "id": "chief",
                    "type": "officer_election",
                    "vote_type": "candidate_selection",
                    "title": "Election for Chief",
                    "position": "Chief",
                },
                {
                    "id": "budget",
                    "type": "general_vote",
                    "vote_type": "approval",
                    "title": MOTION_TITLE,
                },
                {
                    "id": "member",
                    "type": "membership_approval",
                    "vote_type": "approval",
                    "title": MEMBERSHIP_TITLE,
                },
            ],
        )
        await self._insert_candidate(db_session, election_id, "Casey Chief", "Chief")

        buf, err, _fn = await ElectionService(db_session).build_printable_ballot_pdf(
            uuid.UUID(election_id), uuid.UUID(org_id)
        )
        assert err is None, err
        pdf_text = _text(buf)
        assert "Casey Chief" in pdf_text
        assert MOTION_TITLE in pdf_text
        assert MEMBERSHIP_TITLE in pdf_text
        assert pdf_text.count("Approve") >= 2
        assert pdf_text.count("Deny") >= 2

    async def test_approval_only_ballot_prints_without_positions(
        self, db_session: AsyncSession, org_and_user
    ):
        org_id, user_id = org_and_user
        election_id = await self._insert_election(
            db_session,
            org_id,
            user_id,
            positions=None,
            ballot_items=[
                {
                    "id": "budget",
                    "type": "general_vote",
                    "vote_type": "approval",
                    "title": MOTION_TITLE,
                }
            ],
        )

        buf, err, _fn = await ElectionService(db_session).build_printable_ballot_pdf(
            uuid.UUID(election_id), uuid.UUID(org_id)
        )
        assert err is None, err
        pdf_text = _text(buf)
        assert MOTION_TITLE in pdf_text
        assert "Deny" in pdf_text
