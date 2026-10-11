"""W50-47: a ballot change retires issued links and prompts a resend.

A ballot link serves the item ids snapshotted when its token was minted, so
a link sent before an item was added kept showing the old ballot, and
nothing told the officer to resend. The owner decided (2026-10-08) to
invalidate outstanding tokens when the ballot changes and prompt a resend
through the W50-36 banner. The election response now reports
``ballots_must_be_resent`` with a reason, and the retired link says the
ballot changed.
"""

import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.elections import get_election, update_election
from app.models.election import Election, VotingToken
from app.models.user import User
from app.schemas.election import ElectionUpdate
from app.services.election_service import (
    BALLOT_CHANGED_TOKEN_MESSAGE,
    REOPENED_TOKEN_MESSAGE,
    ElectionService,
)
from tests.test_election_voting_flow import TestElectionSetup

MOTION = {
    "id": "budget",
    "type": "general_vote",
    "title": "Approve the 2027 budget",
    "vote_type": "approval",
    "eligible_voter_types": ["all"],
}
LATE = {
    "id": "late",
    "type": "general_vote",
    "title": "Approve the new engine",
    "vote_type": "approval",
    "eligible_voter_types": ["all"],
}


async def _draft_with_sent_ballot(db: AsyncSession, data: dict) -> str:
    """A draft (as after an OPEN -> DRAFT rollback) whose ballots went out
    an hour ago; returns a live raw token minted then."""
    sent_at = datetime.now(timezone.utc) - timedelta(hours=1)
    await db.execute(
        text(
            "UPDATE elections SET status = 'draft', ballot_items = :items, "
            "email_sent = 1, email_sent_at = :sent WHERE id = :id"
        ),
        {"items": json.dumps([MOTION]), "sent": sent_at, "id": data["election_id"]},
    )
    await db.flush()
    _row, raw = await ElectionService(db)._generate_voting_token(
        user_id=uuid.UUID(data["user3_id"]),
        election_id=uuid.UUID(data["election_id"]),
        organization_id=uuid.UUID(data["org_id"]),
        election_end_date=datetime.now(timezone.utc) + timedelta(days=1),
        anonymity_salt=data["salt"],
        eligible_item_ids=["budget"],
    )
    await db.flush()
    return raw


async def _manager(db: AsyncSession, data: dict) -> User:
    return (
        await db.execute(select(User).where(User.id == data["user1_id"]))
    ).scalar_one()


@pytest.mark.integration
class TestBallotChangeRetiresLinks(TestElectionSetup):
    async def test_adding_an_item_retires_links_and_reports_a_resend(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        raw = await _draft_with_sent_ballot(db_session, data)
        manager = await _manager(db_session, data)

        response = await update_election(
            election_id=uuid.UUID(data["election_id"]),
            election_update=ElectionUpdate(ballot_items=[MOTION, LATE]),
            db=db_session,
            current_user=manager,
        )

        assert response.ballots_must_be_resent is True
        assert response.ballots_resend_reason == "ballot_changed"
        _e, _t, err = await ElectionService(db_session).get_ballot_by_token(raw)
        assert err == BALLOT_CHANGED_TOKEN_MESSAGE

    async def test_resaving_the_same_ballot_retires_nothing(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        raw = await _draft_with_sent_ballot(db_session, data)
        manager = await _manager(db_session, data)

        response = await update_election(
            election_id=uuid.UUID(data["election_id"]),
            election_update=ElectionUpdate(ballot_items=[MOTION], title="Renamed"),
            db=db_session,
            current_user=manager,
        )

        assert response.ballots_must_be_resent is False
        token = (
            await db_session.execute(
                select(VotingToken).where(
                    VotingToken.token == ElectionService._hash_voting_token(raw)
                )
            )
        ).scalar_one()
        assert token.superseded_at is None
        assert token.expires_at.replace(tzinfo=timezone.utc) > datetime.now(
            timezone.utc
        )

    async def test_a_later_send_clears_the_prompt(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        await _draft_with_sent_ballot(db_session, data)
        manager = await _manager(db_session, data)
        await update_election(
            election_id=uuid.UUID(data["election_id"]),
            election_update=ElectionUpdate(ballot_items=[MOTION, LATE]),
            db=db_session,
            current_user=manager,
        )

        election = (
            await db_session.execute(
                select(Election).where(Election.id == data["election_id"])
            )
        ).scalar_one()
        election.email_sent_at = datetime.now(timezone.utc) + timedelta(seconds=5)
        await db_session.flush()

        response = await get_election(
            election_id=uuid.UUID(data["election_id"]),
            db=db_session,
            current_user=manager,
        )
        assert response.ballots_must_be_resent is False
        assert response.ballots_resend_reason is None

    async def test_a_reopen_is_reported_as_a_reopen(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        raw = await _draft_with_sent_ballot(db_session, data)
        svc = ElectionService(db_session)
        election = (
            await db_session.execute(
                select(Election).where(Election.id == data["election_id"])
            )
        ).scalar_one()
        retired = await svc.invalidate_tokens_for_ballot_change(election)
        assert retired == 1
        election.rollback_history = [
            {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "from_status": "closed",
                "to_status": "open",
                "ballots_must_be_resent": True,
            }
        ]
        await db_session.flush()

        assert await svc.ballot_resend_state(election) == (True, "reopened")
        _e, _t, err = await svc.get_ballot_by_token(raw)
        assert err == REOPENED_TOKEN_MESSAGE
