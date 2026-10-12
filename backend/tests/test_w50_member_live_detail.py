"""W50-70: while voting is open, recipients and live counts are the managers'.

``GET /elections/{id}`` gave every ``elections.view`` holder the ballot
recipient list and live vote counts while ``/results`` refused them, and the
ballot lookup (and the in-app ballot) handed every candidate's ``user_id``
and ``nominated_by`` to token holders. The owner decided (2026-10-08): while
open, counts and recipient details go to managers only, and ids are
stripped for everyone else.
"""

import json
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.elections import (
    BallotLookupRequest,
    get_election,
    get_member_ballot,
    list_elections,
    lookup_ballot_by_token,
)
from app.models.user import User
from app.services.election_service import ElectionService
from tests.test_election_voting_flow import TestElectionSetup

PERMISSION = "app.api.v1.endpoints.elections.user_has_permission"


async def _open_with_a_vote(db: AsyncSession, data: dict, *, public: bool = False):
    await db.execute(
        text(
            "UPDATE elections SET email_sent = 1, email_recipients = :r, "
            "eligible_voters = :r, results_visible_immediately = :pub "
            "WHERE id = :id"
        ),
        {
            "r": json.dumps([data["user2_id"], data["user3_id"]]),
            "pub": public,
            "id": data["election_id"],
        },
    )
    await db.flush()
    _vote, err = await ElectionService(db).cast_vote(
        user_id=uuid.UUID(data["user2_id"]),
        election_id=uuid.UUID(data["election_id"]),
        candidate_id=uuid.UUID(data["candidate_a_id"]),
        position="Chief",
        organization_id=uuid.UUID(data["org_id"]),
    )
    assert err is None, err


async def _user(db: AsyncSession, user_id: str) -> User:
    return (await db.execute(select(User).where(User.id == user_id))).scalar_one()


@pytest.mark.integration
class TestLiveDetailWithheld(TestElectionSetup):
    async def test_a_member_sees_no_recipients_or_counts_while_open(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        await _open_with_a_vote(db_session, data)
        member = await _user(db_session, data["user3_id"])

        with patch(PERMISSION, return_value=False):
            detail = await get_election(
                election_id=uuid.UUID(data["election_id"]),
                db=db_session,
                current_user=member,
            )
            listing = await list_elections(db=db_session, current_user=member)

        assert detail.email_recipients is None
        assert detail.eligible_voters is None
        assert detail.total_votes is None
        assert detail.total_voters is None
        assert detail.voter_turnout_percentage is None
        [row] = [e for e in listing if str(e.id) == data["election_id"]]
        assert row.total_votes is None

    async def test_a_manager_still_sees_them(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        await _open_with_a_vote(db_session, data)
        manager = await _user(db_session, data["user1_id"])

        with patch(PERMISSION, return_value=True):
            detail = await get_election(
                election_id=uuid.UUID(data["election_id"]),
                db=db_session,
                current_user=manager,
            )

        assert {str(u) for u in detail.email_recipients} == {
            data["user2_id"],
            data["user3_id"],
        }
        assert detail.total_votes == 1

    async def test_public_results_keep_their_counts_but_not_recipients(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        await _open_with_a_vote(db_session, data, public=True)
        member = await _user(db_session, data["user3_id"])

        with patch(PERMISSION, return_value=False):
            detail = await get_election(
                election_id=uuid.UUID(data["election_id"]),
                db=db_session,
                current_user=member,
            )

        assert detail.total_votes == 1
        assert detail.email_recipients is None

    async def test_after_close_a_member_sees_the_counts(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        await _open_with_a_vote(db_session, data)
        await db_session.execute(
            text("UPDATE elections SET status = 'closed' WHERE id = :id"),
            {"id": data["election_id"]},
        )
        await db_session.flush()
        member = await _user(db_session, data["user3_id"])

        with patch(PERMISSION, return_value=False):
            detail = await get_election(
                election_id=uuid.UUID(data["election_id"]),
                db=db_session,
                current_user=member,
            )
        assert detail.total_votes == 1


@pytest.mark.integration
class TestBallotCandidatesCarryNoIds(TestElectionSetup):
    async def test_lookup_and_member_ballot_strip_member_ids(
        self, db_session: AsyncSession, setup_election
    ):
        data = setup_election
        _row, raw = await ElectionService(db_session)._generate_voting_token(
            user_id=uuid.UUID(data["user3_id"]),
            election_id=uuid.UUID(data["election_id"]),
            organization_id=uuid.UUID(data["org_id"]),
            election_end_date=datetime.now(timezone.utc) + timedelta(days=1),
            anonymity_salt=data["salt"],
        )
        await db_session.flush()

        looked_up = await lookup_ballot_by_token(
            BallotLookupRequest(token=raw), db=db_session, _rate=None
        )
        in_app = await get_member_ballot(
            election_id=uuid.UUID(data["election_id"]),
            proxy_authorization_id=None,
            db=db_session,
            current_user=await _user(db_session, data["user3_id"]),
        )

        for response in (looked_up, in_app):
            assert {c.name for c in response.candidates} == {
                "Alice Anderson",
                "Bob Baker",
            }
            for candidate in response.candidates:
                dumped = candidate.model_dump()
                assert "user_id" not in dumped
                assert "nominated_by" not in dumped
                assert "accepted_on_behalf_by" not in dumped
