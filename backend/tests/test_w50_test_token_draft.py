"""W50-19: a draft election's test ballot can be opened and tried.

Election Settings offers test ballots for drafts only, and send-ballot sends
a draft test token, but the public lookup refused every non-open election,
so the link answered "Election is draft". The owner decided (2026-10-05)
that a test token is admitted on a draft. A live token still is not, and
nothing a test token writes counts.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.election_service import ElectionService
from tests.test_election_voting_flow import TestElectionSetup
from tests.test_w50_test_ballot_marking import _mint_token

pytestmark = [pytest.mark.integration]


async def _make_draft(db: AsyncSession, election_id: str) -> None:
    # A draft's start is normally still ahead; the preview must not care.
    await db.execute(
        text(
            "UPDATE elections SET status = 'draft', start_date = :start "
            "WHERE id = :id"
        ),
        {"id": election_id, "start": datetime.now(timezone.utc) + timedelta(days=2)},
    )
    await db.flush()


class TestDraftTestBallot(TestElectionSetup):
    async def test_test_token_opens_a_draft_ballot(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        await _make_draft(db_session, data["election_id"])
        raw = await _mint_token(db_session, data, is_test=True)

        election, token, error = await ElectionService(db_session).get_ballot_by_token(
            raw
        )

        assert error is None, error
        assert str(election.id) == data["election_id"]
        assert token.is_test is True

    async def test_live_token_on_a_draft_is_still_refused(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        await _make_draft(db_session, data["election_id"])
        raw = await _mint_token(db_session, data, is_test=False)

        _election, _token, error = await ElectionService(
            db_session
        ).get_ballot_by_token(raw)

        assert error == "Election is draft"

    async def test_test_vote_on_a_draft_is_recorded_as_a_test(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        await _make_draft(db_session, data["election_id"])
        raw = await _mint_token(db_session, data, is_test=True)

        vote, err = await ElectionService(db_session).cast_vote_with_token(
            token=raw,
            candidate_id=uuid.UUID(data["candidate_b_id"]),
            position="Chief",
        )

        assert err is None, err
        assert vote.is_test is True
        stats = await ElectionService(db_session).get_election_stats(
            uuid.UUID(data["election_id"]), uuid.UUID(data["org_id"])
        )
        assert stats.total_votes_cast == 0, "a draft preview vote must not count"

    async def test_test_token_on_a_cancelled_election_is_refused(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        await db_session.execute(
            text("UPDATE elections SET status = 'cancelled' WHERE id = :id"),
            {"id": data["election_id"]},
        )
        raw = await _mint_token(db_session, data, is_test=True)

        _election, _token, error = await ElectionService(
            db_session
        ).get_ballot_by_token(raw)

        assert error == "Election is cancelled"
