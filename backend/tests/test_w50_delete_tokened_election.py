"""
W50-1 — deleting an election that has issued ballot tokens.

``VotingToken.election`` was a plain ``backref="voting_tokens"``: no ORM
cascade, so ``db.delete(election)`` nulled ``election_id`` on every loaded
token, a NOT NULL column, and the commit failed with MySQL 1048. By then the
endpoint had already emailed leadership "permanently deleted" and written the
critical audit row, so every attempt sent another pair of alerts for an
election that was still there with its votes and results intact.

The relationship now cascades (the FK is ondelete=CASCADE), and the alert
and audit row are written only after the commit succeeds.
"""

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.elections import delete_election
from app.models.election import Election, ElectionStatus
from app.schemas.election import ElectionDelete
from app.services.election_service import ElectionService


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def tokened_closed_election(db_session: AsyncSession):
    """Org, three members, an election opened, sent as a ballot (one token
    per member) and then closed — the shape every observed 500 shared."""
    org_id = _uid()
    users = [_uid() for _ in range(3)]
    election_id = _uid()
    now = datetime.now(timezone.utc)

    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, "
            "timezone) VALUES (:id, :name, 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "name": "W50-1 FD", "slug": f"w501-{org_id[:8]}"},
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
    salt = secrets.token_hex(32)
    await db_session.execute(
        text(
            "INSERT INTO elections (id, organization_id, title, election_type, "
            "positions, start_date, end_date, status, anonymous_voting, "
            "allow_write_ins, max_votes_per_position, voting_method, "
            "victory_condition, voter_anonymity_salt, quorum_type, created_by, "
            "email_sent, results_visible_immediately, enable_runoffs, "
            "runoff_type, max_runoff_rounds, is_runoff, runoff_round, "
            "created_at, updated_at) VALUES (:id, :org, 'Chief 2026', "
            "'officer', '[\"Chief\"]', :start, :end, 'open', 1, 0, 1, "
            "'simple_majority', 'most_votes', :salt, 'none', :creator, 1, 0, 0, "
            "'top_two', 3, 0, 0, NOW(), NOW())"
        ),
        {
            "id": election_id,
            "org": org_id,
            "start": now - timedelta(days=1),
            "end": now + timedelta(days=1),
            "salt": salt,
            "creator": users[0],
        },
    )
    for name, user in [("A", users[0]), ("B", users[1])]:
        await db_session.execute(
            text(
                "INSERT INTO candidates (id, election_id, user_id, name, "
                "position, accepted, is_write_in, display_order, "
                "nomination_date, created_at, updated_at) VALUES (:id, :eid, "
                ":uid, :name, 'Chief', 1, 0, 0, NOW(), NOW(), NOW())"
            ),
            {"id": _uid(), "eid": election_id, "uid": user, "name": name},
        )
    await db_session.flush()

    svc = ElectionService(db_session)
    for uid in users:
        await svc._generate_voting_token(
            user_id=uuid.UUID(uid),
            election_id=uuid.UUID(election_id),
            organization_id=uuid.UUID(org_id),
            election_end_date=now + timedelta(days=1),
            anonymity_salt=salt,
        )
    await db_session.flush()

    closed, err = await svc.close_election(uuid.UUID(election_id), uuid.UUID(org_id))
    assert err is None
    assert closed is not None
    assert closed.status == ElectionStatus.CLOSED

    # The tokens stay in the identity map, as they do after the endpoint's
    # own reads in production — the ORM only nulls the FK on what it holds.
    assert await _token_count(db_session, election_id) == 3

    return {"org_id": org_id, "users": users, "election_id": election_id}


async def _token_count(db_session: AsyncSession, election_id: str) -> int:
    return (
        await db_session.execute(
            text("SELECT COUNT(*) FROM voting_tokens WHERE election_id = :id"),
            {"id": election_id},
        )
    ).scalar()


@pytest.mark.integration
async def test_deleting_a_tokened_election_commits_then_alerts_once(
    db_session: AsyncSession, tokened_closed_election
):
    data = tokened_closed_election
    notify = AsyncMock(return_value=1)
    audit = AsyncMock()

    with (
        patch.object(ElectionService, "_notify_leadership_of_deletion", notify),
        patch("app.api.v1.endpoints.elections.log_audit_event", audit),
    ):
        response = await delete_election(
            election_id=uuid.UUID(data["election_id"]),
            delete_data=ElectionDelete(reason="Superseded by the bylaws vote"),
            db=db_session,
            current_user=SimpleNamespace(
                id=data["users"][0], organization_id=data["org_id"]
            ),
        )

    assert response.success is True
    assert response.notifications_sent == 1
    assert await _token_count(db_session, data["election_id"]) == 0
    assert (
        await db_session.execute(
            text("SELECT COUNT(*) FROM elections WHERE id = :id"),
            {"id": data["election_id"]},
        )
    ).scalar() == 0

    notify.assert_awaited_once()
    assert notify.await_args.kwargs["election"].title == "Chief 2026"
    audit.assert_awaited_once()
    assert audit.await_args.kwargs["event_type"] == "election_deleted_critical"
    assert audit.await_args.kwargs["event_data"]["notifications_sent"] == 1


def _mocked_db(election: Election) -> AsyncMock:
    """A session whose reads find no runoff children and no votes, and whose
    commit fails the way the un-cascaded backref made it fail."""
    db = AsyncMock()
    reads = MagicMock()
    reads.scalars.return_value.all.return_value = []
    reads.scalar.return_value = 0
    db.execute = AsyncMock(return_value=reads)
    db.commit = AsyncMock(
        side_effect=IntegrityError(
            "UPDATE voting_tokens SET election_id=%s",
            {},
            Exception("(1048, \"Column 'election_id' cannot be null\")"),
        )
    )
    return db


@pytest.mark.unit
async def test_failed_commit_sends_no_alert_and_writes_no_audit_row():
    election = Election(
        id=_uid(),
        organization_id=_uid(),
        title="Chief 2026",
        status=ElectionStatus.CLOSED,
    )
    db = _mocked_db(election)
    notify = AsyncMock(return_value=1)
    audit = AsyncMock()

    with (
        patch.object(ElectionService, "get_election", AsyncMock(return_value=election)),
        patch.object(ElectionService, "_notify_leadership_of_deletion", notify),
        patch("app.api.v1.endpoints.elections.log_audit_event", audit),
    ):
        with pytest.raises(HTTPException) as exc:
            await delete_election(
                election_id=uuid.UUID(election.id),
                delete_data=ElectionDelete(reason="Superseded by the bylaws vote"),
                db=db,
                current_user=SimpleNamespace(
                    id=_uid(), organization_id=election.organization_id
                ),
            )

    # A refused delete is a conflict, not an internal error, and nothing
    # downstream may claim the election is gone.
    assert exc.value.status_code == 409
    db.rollback.assert_awaited_once()
    notify.assert_not_awaited()
    audit.assert_not_awaited()
