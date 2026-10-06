"""W50-8: a motion decided on paper can be keyed in.

Print Blank Ballots prints every approval item as "Approve / Deny", but
Record Paper Ballots takes candidate ids, and an item's Approve/Deny rows
existed only once an electronic vote materialised them. The owner decided
(2026-10-05) to create them when the election opens. A candidate-selection
item whose race is not a plain position is now printed as well.
"""

import json
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.election import Candidate
from app.services.election_service import ElectionService
from tests.test_w50_printable_ballot_items import MOTION_TITLE, _text, _uid

pytestmark = [pytest.mark.integration]

MOTION = {
    "id": "budget",
    "type": "general_vote",
    "vote_type": "approval",
    "title": MOTION_TITLE,
}
BOARD = {
    "id": "board",
    "type": "officer_election",
    "vote_type": "candidate_selection",
    "title": "Board of Directors",
    "position": "Board",
}


async def _options(db: AsyncSession, election_id: str):
    result = await db.execute(
        select(Candidate.position, Candidate.name)
        .where(Candidate.election_id == election_id)
        .where(Candidate.name.in_(["Approve", "Deny"]))
    )
    return sorted(result.all())


class TestPaperMotionOptions:
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

    async def _draft(self, db, org_id, user_id, items, positions=None):
        election_id = await self._insert_election(
            db, org_id, user_id, positions=positions, ballot_items=items
        )
        await db.execute(
            text("UPDATE elections SET status = 'draft' WHERE id = :id"),
            {"id": election_id},
        )
        await db.flush()
        return election_id

    async def test_opening_creates_approve_and_deny_for_each_approval_item(
        self, db_session: AsyncSession, org_and_user
    ):
        org_id, user_id = org_and_user
        election_id = await self._draft(db_session, org_id, user_id, [MOTION])
        svc = ElectionService(db_session)

        opened, err = await svc.open_election(uuid.UUID(election_id), uuid.UUID(org_id))

        assert err is None, err
        assert await _options(db_session, election_id) == [
            ("budget", "Approve"),
            ("budget", "Deny"),
        ]

    async def test_an_existing_option_row_is_reused_not_duplicated(
        self, db_session: AsyncSession, org_and_user
    ):
        org_id, user_id = org_and_user
        election_id = await self._draft(db_session, org_id, user_id, [MOTION])
        await self._insert_candidate(db_session, election_id, "Approve", "budget")
        svc = ElectionService(db_session)

        _opened, err = await svc.open_election(
            uuid.UUID(election_id), uuid.UUID(org_id)
        )

        assert err is None, err
        assert await _options(db_session, election_id) == [
            ("budget", "Approve"),
            ("budget", "Deny"),
        ]

    async def test_a_paper_tally_for_a_motion_is_recorded_and_counted(
        self, db_session: AsyncSession, org_and_user
    ):
        org_id, user_id = org_and_user
        # No attestation step, so the batch counts as soon as it is keyed.
        await db_session.execute(
            text("UPDATE organizations SET settings = :s WHERE id = :id"),
            {
                "s": json.dumps(
                    {"election_features": {"paper_ballot_attestations_required": 0}}
                ),
                "id": org_id,
            },
        )
        election_id = await self._draft(db_session, org_id, user_id, [MOTION])
        svc = ElectionService(db_session)
        await svc.open_election(uuid.UUID(election_id), uuid.UUID(org_id))
        rows = await db_session.execute(
            select(Candidate.id, Candidate.name).where(
                Candidate.election_id == election_id
            )
        )
        option = {name: cid for cid, name in rows.all()}

        count, _batch, err = await svc.record_manual_ballots(
            uuid.UUID(election_id),
            uuid.UUID(org_id),
            recorded_by=user_id,
            entries=[
                {"candidate_id": option["Approve"], "count": 3},
                {"candidate_id": option["Deny"], "count": 1},
            ],
            allow_over_count=True,
        )
        assert err is None, err
        assert count == 4

        results = await svc.get_election_results(
            uuid.UUID(election_id),
            uuid.UUID(org_id),
            _internal_bypass_visibility=True,
        )
        (contest,) = [r for r in results.results_by_position if r.position == "budget"]
        tally = {c.candidate_name: c.vote_count for c in contest.candidates}
        assert tally == {"Approve": 3, "Deny": 1}

    async def test_rollback_to_draft_drops_only_unused_option_rows(
        self, db_session: AsyncSession, org_and_user
    ):
        org_id, user_id = org_and_user
        election_id = await self._draft(db_session, org_id, user_id, [MOTION])
        svc = ElectionService(db_session)
        await svc.open_election(uuid.UUID(election_id), uuid.UUID(org_id))
        approve_id = (
            await db_session.execute(
                select(Candidate.id)
                .where(Candidate.election_id == election_id)
                .where(Candidate.name == "Approve")
            )
        ).scalar_one()
        await svc.record_manual_ballots(
            uuid.UUID(election_id),
            uuid.UUID(org_id),
            recorded_by=user_id,
            entries=[{"candidate_id": approve_id, "count": 1}],
            allow_over_count=True,
        )

        _rolled, _n, err = await svc.rollback_election(
            uuid.UUID(election_id),
            uuid.UUID(org_id),
            uuid.UUID(user_id),
            "ballot needs another motion",
        )

        assert err is None, err
        assert await _options(db_session, election_id) == [("budget", "Approve")]

    async def test_a_candidate_selection_item_outside_positions_is_printed(
        self, db_session: AsyncSession, org_and_user
    ):
        org_id, user_id = org_and_user
        election_id = await self._insert_election(
            db_session, org_id, user_id, positions=None, ballot_items=[BOARD]
        )
        await self._insert_candidate(db_session, election_id, "Dana Director", "Board")

        buf, err, _fn = await ElectionService(db_session).build_printable_ballot_pdf(
            uuid.UUID(election_id), uuid.UUID(org_id)
        )

        assert err is None, err
        pdf_text = _text(buf)
        assert "Board of Directors" in pdf_text
        assert "Dana Director" in pdf_text
