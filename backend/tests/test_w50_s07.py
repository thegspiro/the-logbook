"""W50-S07: the runoff link survives a rollback, and blocks a delete.

``close_election`` decides whether to spawn a runoff from the parent's own
``runoff_round`` alone, so closing a CLOSED->OPEN rolled-back election a
second time mints a second "Runoff Round 1" beside the first. And the
runoff's ``parent_election_id`` is ``ondelete="RESTRICT"`` with no ORM
cascade, so ``DELETE /elections/{id}`` on a parent that has one lets the
IntegrityError out of the endpoint after the leadership alert has gone out.
"""

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.elections import delete_election
from app.schemas.election import ElectionDelete
from app.services.election_service import ElectionService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def runoff_parent(db_session: AsyncSession):
    """A non-anonymous OPEN majority election for Chief, closed once with
    A 2 / B 1 / C 1 so that it has exactly one runoff child."""
    org_id = _uid()
    users = [_uid() for _ in range(4)]
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
            "created_at, updated_at) VALUES (:id, :org, 'Chief 2026', "
            "'officer', '[\"Chief\"]', :start, :end, 'open', 0, 0, 1, "
            "'simple_majority', 'majority', :salt, 'none', :creator, 0, 0, 1, "
            "'top_two', 3, 0, 0, NOW(), NOW())"
        ),
        {
            "id": election_id,
            "org": org_id,
            "start": now - timedelta(days=1),
            "end": now + timedelta(days=1),
            "salt": secrets.token_hex(32),
            "creator": users[0],
        },
    )

    candidates = {}
    for name, user in [("A", users[0]), ("B", users[1]), ("C", users[2])]:
        cid = _uid()
        candidates[name] = cid
        await db_session.execute(
            text(
                "INSERT INTO candidates (id, election_id, user_id, name, "
                "position, accepted, is_write_in, display_order, "
                "nomination_date, created_at, updated_at) VALUES (:id, :eid, "
                ":uid, :name, 'Chief', 1, 0, 0, NOW(), NOW(), NOW())"
            ),
            {"id": cid, "eid": election_id, "uid": user, "name": name},
        )
    await db_session.flush()

    svc = ElectionService(db_session)
    for user, name in zip(users, ["A", "A", "B", "C"]):
        _, err = await svc.cast_vote(
            user_id=uuid.UUID(user),
            election_id=uuid.UUID(election_id),
            candidate_id=uuid.UUID(candidates[name]),
            position="Chief",
            organization_id=uuid.UUID(org_id),
        )
        assert err is None, err

    closed, err = await svc.close_election(uuid.UUID(election_id), uuid.UUID(org_id))
    assert err is None
    assert closed is not None
    assert await _runoff_children(db_session, election_id) == 1

    return {"org_id": org_id, "users": users, "election_id": election_id}


async def _runoff_children(db_session: AsyncSession, election_id: str) -> int:
    return (
        await db_session.execute(
            text(
                "SELECT COUNT(*) FROM elections "
                "WHERE parent_election_id = :id AND is_runoff = 1"
            ),
            {"id": election_id},
        )
    ).scalar()


async def test_reclosing_after_rollback_keeps_one_runoff(
    db_session: AsyncSession, runoff_parent
):
    data = runoff_parent
    svc = ElectionService(db_session)

    reopened, _, err = await svc.rollback_election(
        uuid.UUID(data["election_id"]),
        uuid.UUID(data["org_id"]),
        uuid.UUID(data["users"][0]),
        "Closed the meeting vote by mistake",
    )
    assert err is None
    assert reopened is not None

    closed, err = await svc.close_election(
        uuid.UUID(data["election_id"]), uuid.UUID(data["org_id"])
    )
    assert err is None
    assert closed is not None

    assert (
        await _runoff_children(db_session, data["election_id"]) == 1
    ), "closing a rolled-back election must not mint a second Runoff Round 1"


async def test_deleting_a_parent_with_a_runoff_is_refused_before_side_effects(
    db_session: AsyncSession, runoff_parent
):
    data = runoff_parent
    notify = AsyncMock(return_value=0)
    audit = AsyncMock()
    with (
        patch.object(ElectionService, "_notify_leadership_of_deletion", notify),
        patch("app.api.v1.endpoints.elections.log_audit_event", audit),
    ):
        with pytest.raises(HTTPException) as exc:
            await delete_election(
                election_id=uuid.UUID(data["election_id"]),
                delete_data=ElectionDelete(reason="Set up under the wrong bylaws"),
                db=db_session,
                current_user=SimpleNamespace(
                    id=data["users"][0], organization_id=data["org_id"]
                ),
            )
    # The RESTRICT constraint must never escape as a 500, and the refusal
    # has to come before the leadership alert and the audit row — both used
    # to record a deletion that never happened.
    assert exc.value.status_code == 409
    notify.assert_not_awaited()
    audit.assert_not_awaited()
    assert await _runoff_children(db_session, data["election_id"]) == 1
