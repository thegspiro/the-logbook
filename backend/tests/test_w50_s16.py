"""
W50 S16 — a manager's own test ballot must not block their real in-app vote.

``send-test-ballot`` mints an ``is_test`` token keyed to the same
``voter_hash`` the in-app path derives for that member, and the vote it
records is ``is_test=True`` with ``voter_id`` NULL. On an anonymous election
(the default) ``check_voter_eligibility`` and ``cast_vote``'s
``_get_user_votes`` look up existing votes by ``voter_hash`` with no
``is_test`` filter, so the test ballot reads as the member's real vote and
the in-app ballot is refused. The token route already matches ``is_test``
(``cast_vote_with_token``) — these tests hold the in-app route to the same
rule.

Reuses the raw-SQL ``setup_election`` fixture (anonymous, OPEN, two
candidates for "Chief") from ``test_election_voting_flow``.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.election_service import ElectionService
from tests.test_election_voting_flow import TestElectionSetup

pytestmark = [pytest.mark.integration]


async def _cast_test_ballot(db_session: AsyncSession, data: dict) -> None:
    """Cast a test ballot for user1 the way send-test-ballot + the ballot page do."""
    svc = ElectionService(db_session)
    _token, raw = await svc._generate_voting_token(
        user_id=uuid.UUID(data["user1_id"]),
        election_id=uuid.UUID(data["election_id"]),
        organization_id=uuid.UUID(data["org_id"]),
        election_end_date=datetime.now(timezone.utc) + timedelta(days=1),
        anonymity_salt=data["salt"],
        is_test=True,
    )
    await db_session.flush()
    vote, err = await svc.cast_vote_with_token(
        token=raw,
        candidate_id=uuid.UUID(data["candidate_b_id"]),
        position="Chief",
    )
    assert err is None, f"test ballot failed: {err}"
    assert vote.is_test is True


class TestTestBallotDoesNotBlockRealVote(TestElectionSetup):
    async def test_eligibility_ignores_own_test_ballot(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        await _cast_test_ballot(db_session, data)

        eligibility = await ElectionService(db_session).check_voter_eligibility(
            user_id=uuid.UUID(data["user1_id"]),
            election_id=uuid.UUID(data["election_id"]),
            organization_id=uuid.UUID(data["org_id"]),
            position="Chief",
        )

        assert eligibility.is_eligible is True
        assert eligibility.has_voted is False, (
            "a test ballot is reported as the member's real vote: "
            f"positions_voted={eligibility.positions_voted}"
        )
        assert eligibility.positions_remaining == ["Chief"]

    async def test_in_app_vote_succeeds_after_own_test_ballot(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        await _cast_test_ballot(db_session, data)

        vote, err = await ElectionService(db_session).cast_vote(
            user_id=uuid.UUID(data["user1_id"]),
            election_id=uuid.UUID(data["election_id"]),
            candidate_id=uuid.UUID(data["candidate_a_id"]),
            position="Chief",
            organization_id=uuid.UUID(data["org_id"]),
        )

        assert err is None, f"real in-app vote refused after a test ballot: {err}"
        assert vote is not None
        assert vote.is_test is False
