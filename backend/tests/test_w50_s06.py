"""W50-S06: a runoff is decided per position, not from the pooled tally.

``_check_and_create_runoff`` first asks whether *any* candidate in the
cross-position ``overall_results`` is a winner, and only looks at
``results_by_position`` when none is. In a multi-position election the pooled
tally almost always has a winner (under ``most_votes`` the overall top always
is one), so a position whose own race failed its majority never gets a runoff.
When a runoff is created, the advancing candidates are taken from the pooled
ranking and every parent position is copied into it.
"""

import secrets
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.election_service import ElectionService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def two_position_election(db_session: AsyncSession):
    """Org, 5 voters, an OPEN majority election for Chief + Secretary.

    Chief: A, B, C. Secretary: D (unopposed).
    """
    org_id = _uid()
    users = [_uid() for _ in range(5)]
    election_id = _uid()
    now = datetime.now(timezone.utc)

    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, "
            "timezone) VALUES (:id, :name, 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "name": "Runoff FD", "slug": f"runoff-{org_id[:8]}"},
    )
    for i, uid in enumerate(users):
        await db_session.execute(
            text(
                "INSERT INTO users (id, organization_id, username, first_name, "
                "last_name, email, password_hash, status) VALUES "
                "(:id, :org, :un, :fn, 'Voter', :em, 'hashed', 'active')"
            ),
            {
                "id": uid,
                "org": org_id,
                "un": f"voter{i}-{uid[:8]}",
                "fn": f"V{i}",
                "em": f"voter{i}-{uid[:8]}@test.com",
            },
        )

    await db_session.execute(
        text(
            "INSERT INTO elections (id, organization_id, title, election_type, "
            "positions, start_date, end_date, status, anonymous_voting, "
            "allow_write_ins, max_votes_per_position, voting_method, "
            "victory_condition, voter_anonymity_salt, quorum_type, created_by, "
            "email_sent, results_visible_immediately, enable_runoffs, "
            "runoff_type, max_runoff_rounds, is_runoff, runoff_round, "
            "created_at, updated_at) VALUES (:id, :org, 'Officers 2026', "
            "'officer', :positions, :start, :end, 'open', 1, 0, 1, "
            "'simple_majority', 'majority', :salt, 'none', :creator, 0, 0, 1, "
            "'top_two', 3, 0, 0, NOW(), NOW())"
        ),
        {
            "id": election_id,
            "org": org_id,
            "positions": '["Chief", "Secretary"]',
            "start": now - timedelta(days=1),
            "end": now + timedelta(days=1),
            "salt": secrets.token_hex(32),
            "creator": users[0],
        },
    )

    candidates = {}
    for name, position, user in [
        ("A", "Chief", users[0]),
        ("B", "Chief", users[1]),
        ("C", "Chief", users[2]),
        ("D", "Secretary", users[3]),
    ]:
        cid = _uid()
        candidates[name] = cid
        await db_session.execute(
            text(
                "INSERT INTO candidates (id, election_id, user_id, name, "
                "position, accepted, is_write_in, display_order, "
                "nomination_date, created_at, updated_at) VALUES (:id, :eid, "
                ":uid, :name, :pos, 1, 0, 0, NOW(), NOW(), NOW())"
            ),
            {"id": cid, "eid": election_id, "uid": user, "name": name, "pos": position},
        )
    await db_session.flush()

    return {
        "org_id": org_id,
        "users": users,
        "election_id": election_id,
        "candidates": candidates,
    }


async def _vote(svc, data, user, candidate, position):
    _, err = await svc.cast_vote(
        user_id=uuid.UUID(user),
        election_id=uuid.UUID(data["election_id"]),
        candidate_id=uuid.UUID(data["candidates"][candidate]),
        position=position,
        organization_id=uuid.UUID(data["org_id"]),
    )
    assert err is None, err


async def test_position_without_majority_gets_a_runoff_of_its_own(
    db_session: AsyncSession, two_position_election
):
    data = two_position_election
    users = data["users"]
    svc = ElectionService(db_session)

    # Chief: A 2, B 1, C 1 -> 4 votes, majority needs 3, nobody has it.
    await _vote(svc, data, users[0], "A", "Chief")
    await _vote(svc, data, users[1], "A", "Chief")
    await _vote(svc, data, users[2], "B", "Chief")
    await _vote(svc, data, users[3], "C", "Chief")
    # Secretary: D takes all 5 -> a clear majority for that seat, and 5 of
    # the 9 pooled ballots, so the cross-position tally also has a "winner".
    for user in users:
        await _vote(svc, data, user, "D", "Secretary")

    results = await svc.get_election_results(
        uuid.UUID(data["election_id"]),
        uuid.UUID(data["org_id"]),
        _internal_bypass_visibility=True,
    )
    by_position = {p.position: p for p in results.results_by_position}
    assert not any(c.is_winner for c in by_position["Chief"].candidates)
    assert any(c.is_winner for c in by_position["Secretary"].candidates)

    closed, err = await svc.close_election(
        uuid.UUID(data["election_id"]), uuid.UUID(data["org_id"])
    )
    assert err is None
    assert closed is not None

    runoff = (
        await db_session.execute(
            text(
                "SELECT id, positions FROM elections "
                "WHERE parent_election_id = :id AND is_runoff = 1"
            ),
            {"id": data["election_id"]},
        )
    ).first()
    assert runoff is not None, "Chief had no majority: a runoff is required"

    advancing = (
        await db_session.execute(
            text("SELECT name, position FROM candidates WHERE election_id = :id"),
            {"id": runoff.id},
        )
    ).all()
    # Top two of the Chief race advance; the decided Secretary seat is not
    # re-run and its winner is not pulled in by the pooled ranking.
    assert sorted((n, p) for n, p in advancing) == [("A", "Chief"), ("B", "Chief")]
    assert "Secretary" not in str(runoff.positions)
