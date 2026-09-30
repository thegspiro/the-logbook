"""W50-S08: ballot-email state is stamped even when nothing was sent.

``send_ballot_emails`` sets ``email_sent`` / ``email_sent_at`` after the
batch regardless of how many messages the mail service accepted, so an
SMTP outage that rejects every message leaves the election reporting
"Ballot emails sent" and the detail page offering only a *Resend*.
``remind_non_voters`` then stamps ``reminder_sent_at`` on top of an
all-failed send, which starts the 60-minute cooldown against a retry and
permanently disarms the automatic pre-close reminder (it fires only while
``reminder_sent_at`` is NULL). And ``POST /{id}/send-ballot`` has no status
precondition: a CLOSED election accepts a send, mints live-looking voting
tokens and answers with a success message — and (W50-35) so does a DRAFT or
NOMINATIONS one, mailing every member a "Vote Now" link that answers
"Election is draft". Only the sender-only ``/send-test-ballot`` preview may
go out before opening.
"""

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.elections import send_ballot_emails as send_ballot_endpoint
from app.models.election import Election
from app.schemas.election import EmailBallot
from app.services.election_service import ElectionService

pytestmark = [pytest.mark.integration]

SEND_BATCH = "app.services.email_service.EmailService.send_batch"


def _uid() -> str:
    return str(uuid.uuid4())


async def _make_election(db_session: AsyncSession, *, status: str = "open") -> dict:
    """An org with two active members and one Chief election."""
    org_id = _uid()
    users = [_uid(), _uid()]
    election_id = _uid()
    now = datetime.now(timezone.utc)

    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, "
            "timezone) VALUES (:id, :name, 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "name": "S08 FD", "slug": f"s08-{org_id[:8]}"},
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
                "un": f"s08voter{i}-{uid[:8]}",
                "fn": f"V{i}",
                "em": f"s08voter{i}-{uid[:8]}@test.com",
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
            "'officer', '[\"Chief\"]', :start, :end, :status, 1, 0, 1, "
            "'simple_majority', 'most_votes', :salt, 'none', :creator, 0, 0, 0, "
            "'top_two', 3, 0, 0, NOW(), NOW())"
        ),
        {
            "id": election_id,
            "org": org_id,
            "start": now - timedelta(days=1),
            "end": now + timedelta(days=1),
            "status": status,
            "salt": secrets.token_hex(32),
            "creator": users[0],
        },
    )
    await db_session.execute(
        text(
            "INSERT INTO candidates (id, election_id, name, position, accepted, "
            "is_write_in, display_order, nomination_date, created_at, "
            "updated_at) VALUES (:id, :eid, 'Casey Chief', 'Chief', 1, 0, 0, "
            "NOW(), NOW(), NOW())"
        ),
        {"id": _uid(), "eid": election_id},
    )
    await db_session.flush()
    return {"org_id": org_id, "users": users, "election_id": election_id}


async def _reload(db_session: AsyncSession, election_id: str) -> Election:
    result = await db_session.execute(
        select(Election).where(Election.id == election_id)
    )
    election = result.scalar_one()
    await db_session.refresh(election)
    return election


async def test_all_failed_send_does_not_stamp_email_sent(db_session: AsyncSession):
    data = await _make_election(db_session)
    svc = ElectionService(db_session)

    with patch(SEND_BATCH, new=AsyncMock(side_effect=lambda b: [False] * len(b))):
        sent, failed, _skipped, _details, sent_ids = await svc.send_ballot_emails(
            election_id=uuid.UUID(data["election_id"]),
            organization_id=uuid.UUID(data["org_id"]),
            base_ballot_url="https://fd.example/ballot",
        )

    assert sent == 0
    assert failed == 2
    assert sent_ids == []
    election = await _reload(db_session, data["election_id"])
    assert election.email_recipients in (None, [])
    assert (
        election.email_sent is False
    ), "no member received a ballot, yet the election reports emails sent"
    assert election.email_sent_at is None


async def test_all_failed_reminder_does_not_start_cooldown(db_session: AsyncSession):
    data = await _make_election(db_session)
    svc = ElectionService(db_session)

    with patch(SEND_BATCH, new=AsyncMock(side_effect=lambda b: [False] * len(b))):
        reminded, failed, _skipped, _details = await svc.remind_non_voters(
            election_id=uuid.UUID(data["election_id"]),
            organization_id=uuid.UUID(data["org_id"]),
            base_ballot_url="https://fd.example/ballot",
        )

    assert reminded == 0
    assert failed == 2
    election = await _reload(db_session, data["election_id"])
    assert election.reminder_sent_at is None, (
        "an all-failed reminder must not start the cooldown or disarm the "
        "automatic pre-close reminder"
    )


async def test_nobody_to_remind_still_starts_the_cooldown(db_session: AsyncSession):
    """Every non-voter skipped (here: none is on the frozen roll) is not a
    failure; leaving the stamp NULL made the lifecycle task retry, and warn,
    on every pre-close tick."""
    data = await _make_election(db_session)
    await db_session.execute(
        text("UPDATE elections SET eligible_roster_snapshot = '[]' WHERE id = :id"),
        {"id": data["election_id"]},
    )
    svc = ElectionService(db_session)

    send_batch = AsyncMock(side_effect=lambda b: [True] * len(b))
    with patch(SEND_BATCH, new=send_batch):
        reminded, failed, skipped, _details = await svc.remind_non_voters(
            election_id=uuid.UUID(data["election_id"]),
            organization_id=uuid.UUID(data["org_id"]),
            base_ballot_url="https://fd.example/ballot",
        )

    assert (reminded, failed, skipped) == (0, 0, 2)
    election = await _reload(db_session, data["election_id"])
    assert election.reminder_sent_at is not None


@pytest.mark.parametrize(
    "election_status", ["closed", "cancelled", "draft", "nominations"]
)
async def test_send_ballot_endpoint_refuses_an_election_that_is_not_open(
    db_session: AsyncSession, election_status: str
):
    # W50-35: a draft/nominations send mailed the whole department a "Vote
    # Now" link that answered "Election is draft"; only OPEN may send live.
    data = await _make_election(db_session, status=election_status)
    send_batch = AsyncMock(side_effect=lambda b: [True] * len(b))

    with patch(SEND_BATCH, new=send_batch), pytest.raises(HTTPException) as exc:
        await send_ballot_endpoint(
            election_id=uuid.UUID(data["election_id"]),
            email_data=EmailBallot(),
            request=SimpleNamespace(),
            db=db_session,
            current_user=SimpleNamespace(
                id=data["users"][0], organization_id=data["org_id"]
            ),
        )

    assert exc.value.status_code == 400
    assert (
        send_batch.await_count == 0
    ), f"no live ballot may leave for a {election_status} election"
    tokens = (
        await db_session.execute(
            text("SELECT COUNT(*) FROM voting_tokens WHERE election_id = :eid"),
            {"eid": data["election_id"]},
        )
    ).scalar()
    assert tokens == 0
