"""
The printed ballot follows each contest's own voting method.

A Ballot Builder item may override the election's voting method, and both
vote-submission routes honour that override (``_effective_voting_method``).
The printout used the election-level method for every contest, so a ranked
item on a plurality election told the voter to "Mark ONE box" and gave no
room to write a rank. Each contest now carries its effective method, resolved
by the same function the submission routes use.
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

ONE_BOX = "Mark ONE box per position."
RANK = "Rank the candidates"
APPROVE_EVERY = "Mark the box next to EVERY candidate you approve of."


def _text(buf: BytesIO) -> str:
    pages = PdfReader(BytesIO(buf.getvalue())).pages
    return " ".join(" ".join(page.extract_text().split()) for page in pages)


def _render(positions, *, method="simple_majority", max_votes=1) -> str:
    return _text(
        render_printable_ballot_pdf(
            {
                "election": {
                    "title": "Annual Meeting",
                    "voting_method": method,
                    "max_votes_per_position": max_votes,
                },
                "positions": positions,
            },
            {"org_name": "Test FD", "generated_at": "today"},
        )
    )


def _race(name, voting_method=None):
    race = {"name": name, "candidates": [f"{name} Candidate"]}
    if voting_method is not None:
        race["voting_method"] = voting_method
    return race


@pytest.mark.unit
class TestRendererPerContestMethod:
    def test_each_contest_prints_its_own_instruction(self):
        out = _render(
            [
                _race("Chief"),
                _race("Captain", "ranked_choice"),
                _race("Trustee", "approval"),
            ]
        )
        assert out.count(ONE_BOX) == 1
        assert out.count(RANK) == 1
        assert out.count(APPROVE_EVERY) == 1
        # Each instruction sits under its own contest.
        assert out.index("Chief") < out.index(ONE_BOX) < out.index("Captain")
        assert out.index("Captain") < out.index(RANK) < out.index("Trustee")
        assert out.index("Trustee") < out.index(APPROVE_EVERY)

    def test_contest_without_an_override_uses_the_election_method(self):
        out = _render([_race("Chief")], method="ranked_choice")
        assert RANK in out
        assert ONE_BOX not in out

    def test_vote_limit_does_not_cap_an_approval_override(self):
        out = _render(
            [_race("Chief"), _race("Trustee", "approval")],
            max_votes=3,
        )
        assert out.count("Mark UP TO 3 boxes per position.") == 1
        assert APPROVE_EVERY in out

    def test_vote_limit_does_not_apply_to_a_ranked_override(self):
        out = _render([_race("Captain", "ranked_choice")], max_votes=3)
        assert RANK in out
        assert "UP TO" not in out


@pytest.mark.integration
class TestServiceResolvesItemMethods:
    @pytest.fixture
    async def org_and_user(self, db_session: AsyncSession):
        org_id, user_id = str(uuid.uuid4()), str(uuid.uuid4())
        await db_session.execute(
            text(
                "INSERT INTO organizations "
                "(id, name, organization_type, slug, timezone, settings) "
                "VALUES (:id, 'Method FD', 'fire_department', :slug, 'UTC', '{}')"
            ),
            {"id": org_id, "slug": f"pbm-{org_id[:8]}"},
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
                "un": f"pbm-{user_id[:8]}",
                "em": f"pbm-{user_id[:8]}@test.com",
            },
        )
        await db_session.flush()
        return org_id, user_id

    async def _election(self, db_session, org_id, creator_id, *, positions, items):
        now = datetime.now(timezone.utc)
        election_id = str(uuid.uuid4())
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
                "VALUES (:id, :org, 'Method Election', 'officer', :positions, "
                ":items, :start, :end, 'open', 1, 0, 1, 'simple_majority', "
                "'most_votes', :salt, 'none', :creator, 0, 0, 0, 'top_two', 3, "
                "0, 0, 'co_winners', NOW(), NOW())"
            ),
            {
                "id": election_id,
                "org": org_id,
                "positions": json.dumps(positions) if positions else None,
                "items": json.dumps(items),
                "start": now - timedelta(days=1),
                "end": now + timedelta(days=1),
                "salt": secrets.token_hex(32),
                "creator": creator_id,
            },
        )
        for name, position in (("Casey Cole", "Chief"), ("Pat Quinn", "Captain")):
            await db_session.execute(
                text(
                    "INSERT INTO candidates "
                    "(id, election_id, name, position, accepted, is_write_in, "
                    "display_order, created_at, updated_at) "
                    "VALUES (:id, :eid, :name, :pos, 1, 0, 0, NOW(), NOW())"
                ),
                {
                    "id": str(uuid.uuid4()),
                    "eid": election_id,
                    "name": name,
                    "pos": position,
                },
            )
        await db_session.flush()
        return election_id

    async def _print(self, db_session, election_id, org_id) -> str:
        buf, err, _ = await ElectionService(db_session).build_printable_ballot_pdf(
            uuid.UUID(election_id), uuid.UUID(org_id)
        )
        assert err is None, err
        return _text(buf)

    async def test_ballot_builder_item_override_reaches_the_paper(
        self, db_session: AsyncSession, org_and_user
    ):
        org_id, user_id = org_and_user
        election_id = await self._election(
            db_session,
            org_id,
            user_id,
            positions=None,
            items=[
                {
                    "id": "chief",
                    "type": "officer_election",
                    "vote_type": "candidate_selection",
                    "title": "Chief",
                    "position": "Chief",
                },
                {
                    "id": "captain",
                    "type": "officer_election",
                    "vote_type": "candidate_selection",
                    "title": "Captain",
                    "position": "Captain",
                    "voting_method": "ranked_choice",
                },
            ],
        )
        out = await self._print(db_session, election_id, org_id)
        assert out.count(ONE_BOX) == 1
        assert out.count(RANK) == 1
        assert out.index("Captain") < out.index(RANK)

    async def test_plain_position_takes_its_matching_items_override(
        self, db_session: AsyncSession, org_and_user
    ):
        # A plain position with a Ballot Builder item for the same race is
        # printed once, as the position; the item's override still governs
        # how its votes are accepted, so it governs the paper too.
        org_id, user_id = org_and_user
        election_id = await self._election(
            db_session,
            org_id,
            user_id,
            positions=["Chief", "Captain"],
            items=[
                {
                    "id": "captain",
                    "type": "officer_election",
                    "vote_type": "candidate_selection",
                    "title": "Election for Captain",
                    "position": "Captain",
                    "voting_method": "approval",
                }
            ],
        )
        out = await self._print(db_session, election_id, org_id)
        assert "Election for Captain" not in out
        assert out.count(ONE_BOX) == 1
        assert out.count(APPROVE_EVERY) == 1
        assert out.index("Captain") < out.index(APPROVE_EVERY)
