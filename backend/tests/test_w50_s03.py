"""
W50 S03 — one member, two ballots, in a NON-anonymous election.

``cast_vote`` (the in-app path) stores ``voter_id`` and checks duplicates by
``voter_id``; ``cast_vote_with_token`` (the emailed-link path) stores
``voter_id=NULL`` / ``voter_hash`` and checks duplicates by ``voter_hash``.
In an anonymous election both paths key on the hash, so they see each
other's rows. In a named election the in-app rows carry no hash and the
token rows carry no id, so each path is blind to the other: a member with a
ballot email can vote once in the app and once by link, and
``get_non_voters`` (keyed on ``voter_id`` for named elections) still lists
the member who voted by link.

These tests fail on the current code and pass once the two paths share a
duplicate check.
"""

import secrets
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.election import Vote
from app.services.election_service import ElectionService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def named_election(db_session: AsyncSession):
    """Org, a voter and a rival, an OPEN non-anonymous 'Chief' election."""
    org_id = _uid()
    voter_id = _uid()
    rival_id = _uid()
    election_id = _uid()
    candidate_a_id = _uid()
    candidate_b_id = _uid()
    salt = secrets.token_hex(32)
    now = datetime.now(timezone.utc)

    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, :otype, :slug, :tz)"
        ),
        {
            "id": org_id,
            "name": "Named Ballot FD",
            "otype": "fire_department",
            "slug": f"s03-{org_id[:8]}",
            "tz": "America/New_York",
        },
    )
    for uid, uname, fn, ln in [
        (voter_id, "s03voter", "Vera", "Voter"),
        (rival_id, "s03rival", "Rob", "Rival"),
    ]:
        await db_session.execute(
            text(
                "INSERT INTO users "
                "(id, organization_id, username, first_name, last_name, "
                "email, password_hash, status) "
                "VALUES (:id, :org, :un, :fn, :ln, :em, :pw, 'active')"
            ),
            {
                "id": uid,
                "org": org_id,
                "un": uname,
                "fn": fn,
                "ln": ln,
                "em": f"{uname}@test.com",
                "pw": "hashed",
            },
        )
    await db_session.execute(
        text(
            "INSERT INTO elections "
            "(id, organization_id, title, election_type, positions, "
            "start_date, end_date, status, anonymous_voting, "
            "allow_write_ins, max_votes_per_position, voting_method, "
            "victory_condition, voter_anonymity_salt, quorum_type, "
            "created_by, email_sent, results_visible_immediately, "
            "enable_runoffs, runoff_type, max_runoff_rounds, "
            "is_runoff, runoff_round, created_at, updated_at) "
            "VALUES (:id, :org, :title, :etype, :positions, "
            ":start, :end, 'open', 0, 0, 1, 'simple_majority', "
            "'most_votes', :salt, 'none', :creator, 0, 0, 0, 'top_two', 3, "
            "0, 0, NOW(), NOW())"
        ),
        {
            "id": election_id,
            "org": org_id,
            "title": "Named Officer Election",
            "etype": "officer",
            "positions": '["Chief"]',
            "start": now - timedelta(days=1),
            "end": now + timedelta(days=1),
            "salt": salt,
            "creator": voter_id,
        },
    )
    for cid, cuser, cname, order in [
        (candidate_a_id, voter_id, "Vera Voter", 0),
        (candidate_b_id, rival_id, "Rob Rival", 1),
    ]:
        await db_session.execute(
            text(
                "INSERT INTO candidates "
                "(id, election_id, user_id, name, position, accepted, "
                "is_write_in, display_order, nomination_date, created_at, "
                "updated_at) "
                "VALUES (:id, :eid, :uid, :name, 'Chief', 1, 0, :ord, "
                "NOW(), NOW(), NOW())"
            ),
            {"id": cid, "eid": election_id, "uid": cuser, "name": cname, "ord": order},
        )
    await db_session.flush()

    return {
        "org_id": org_id,
        "voter_id": voter_id,
        "election_id": election_id,
        "candidate_a_id": candidate_a_id,
        "candidate_b_id": candidate_b_id,
        "salt": salt,
    }


async def _issue_token(db_session: AsyncSession, data: dict) -> str:
    """Mint a real ballot token for the voter, the way send_ballot_emails does."""
    _, raw = await ElectionService(db_session)._generate_voting_token(
        user_id=uuid.UUID(data["voter_id"]),
        election_id=uuid.UUID(data["election_id"]),
        organization_id=uuid.UUID(data["org_id"]),
        election_end_date=datetime.now(timezone.utc) + timedelta(days=1),
        anonymity_salt=data["salt"],
    )
    await db_session.flush()
    return raw


async def _counted_votes(db_session: AsyncSession, election_id: str) -> int:
    result = await db_session.execute(
        select(func.count(Vote.id))
        .where(Vote.election_id == election_id)
        .where(Vote.deleted_at.is_(None))
        .where(Vote.is_test.is_(False))
    )
    return result.scalar() or 0


class TestNamedElectionDoubleVote:
    async def test_token_vote_after_app_vote_is_rejected(
        self, db_session: AsyncSession, named_election
    ):
        data = named_election
        svc = ElectionService(db_session)

        vote, err = await svc.cast_vote(
            user_id=uuid.UUID(data["voter_id"]),
            election_id=uuid.UUID(data["election_id"]),
            candidate_id=uuid.UUID(data["candidate_a_id"]),
            position="Chief",
            organization_id=uuid.UUID(data["org_id"]),
        )
        assert err is None, err
        assert vote is not None

        raw_token = await _issue_token(db_session, data)
        second, err2 = await svc.cast_vote_with_token(
            token=raw_token,
            candidate_id=uuid.UUID(data["candidate_b_id"]),
            position="Chief",
        )

        assert second is None, "the emailed ballot cast a second Chief vote"
        assert err2, "a second vote for Chief must be refused with a reason"
        assert await _counted_votes(db_session, data["election_id"]) == 1

    async def test_app_vote_after_token_vote_is_rejected(
        self, db_session: AsyncSession, named_election
    ):
        data = named_election
        svc = ElectionService(db_session)

        raw_token = await _issue_token(db_session, data)
        vote, err = await svc.cast_vote_with_token(
            token=raw_token,
            candidate_id=uuid.UUID(data["candidate_b_id"]),
            position="Chief",
        )
        assert err is None, err
        assert vote is not None

        non_voters = await svc.get_non_voters(
            uuid.UUID(data["election_id"]), uuid.UUID(data["org_id"])
        )
        assert data["voter_id"] not in {
            nv["id"] for nv in non_voters
        }, "a member who voted by ballot link is still listed as a non-voter"

        second, err2 = await svc.cast_vote(
            user_id=uuid.UUID(data["voter_id"]),
            election_id=uuid.UUID(data["election_id"]),
            candidate_id=uuid.UUID(data["candidate_a_id"]),
            position="Chief",
            organization_id=uuid.UUID(data["org_id"]),
        )

        assert second is None, "the app cast a second Chief vote after the link"
        assert err2, "a second vote for Chief must be refused with a reason"
        assert await _counted_votes(db_session, data["election_id"]) == 1
