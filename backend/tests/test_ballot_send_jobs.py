"""Background ballot sends.

A forty-member send outlasted the browser's 30-second timeout, so the
secretary was told it failed while the server carried on and sent it. The
send now runs as a job after a ``202``; these tests cover queueing, the
one-send-per-election guard, running the job to an outcome, and the
interrupted-job recovery.
"""

import secrets
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.elections import (
    get_ballot_send_job_endpoint,
)
from app.api.v1.endpoints.elections import send_ballot_emails as send_ballot_endpoint
from app.api.v1.endpoints.elections import start_ballot_send_job_endpoint
from app.models.election import BallotSendJob, BallotSendJobStatus, Election
from app.schemas.election import EmailBallot
from app.services.ballot_send_jobs import (
    INTERRUPTED_JOB_ERROR,
    SEND_IN_PROGRESS_DETAIL,
    STALE_JOB_AFTER,
    run_ballot_send_job,
)

pytestmark = [pytest.mark.integration]

SEND_BATCH = "app.services.email_service.EmailService.send_batch"
START_JOB = "app.api.v1.endpoints.elections.start_ballot_send_job"


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
        {"id": org_id, "name": "Jobs FD", "slug": f"jobs-{org_id[:8]}"},
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
                "un": f"jobvoter{i}-{uid[:8]}",
                "fn": f"V{i}",
                "em": f"jobvoter{i}-{uid[:8]}@test.com",
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


def _user(data: dict) -> SimpleNamespace:
    return SimpleNamespace(id=data["users"][0], organization_id=data["org_id"])


def _session_factory(db_session: AsyncSession):
    """Hand the runner the test's session instead of a fresh one.

    The runner normally opens its own session, which would not see rows the
    test wrote inside its rolled-back transaction.
    """

    @asynccontextmanager
    async def factory():
        yield db_session

    return factory


async def _queue(db_session: AsyncSession, data: dict, **email) -> MagicMock:
    start = MagicMock()
    with patch(START_JOB, new=start):
        response = await start_ballot_send_job_endpoint(
            election_id=uuid.UUID(data["election_id"]),
            email_data=EmailBallot(**email),
            db=db_session,
            current_user=_user(data),
        )
    assert response.status == BallotSendJobStatus.QUEUED.value
    assert response.result is None
    return start


async def _run(db_session: AsyncSession, start: MagicMock, send_batch) -> str:
    args, kwargs = start.call_args
    with patch(SEND_BATCH, new=send_batch):
        await run_ballot_send_job(
            *args, **kwargs, session_factory=_session_factory(db_session)
        )
    return args[0]


async def test_queueing_records_a_job_and_hands_it_to_the_runner(
    db_session: AsyncSession,
):
    data = await _make_election(db_session)

    start = await _queue(db_session, data, subject="Vote now")

    job_id, org_id = start.call_args.args
    assert org_id == data["org_id"]
    assert start.call_args.kwargs["subject"] == "Vote now"
    assert start.call_args.kwargs["base_ballot_url"].endswith("/ballot")
    job = await db_session.get(BallotSendJob, job_id)
    assert job is not None
    assert job.election_id == data["election_id"]
    assert job.requested_by == data["users"][0]


async def test_a_completed_job_reports_what_the_send_did(db_session: AsyncSession):
    data = await _make_election(db_session)
    start = await _queue(db_session, data, send_eligibility_summary=False)

    job_id = await _run(
        db_session, start, AsyncMock(side_effect=lambda b: [True] * len(b))
    )

    response = await get_ballot_send_job_endpoint(
        election_id=uuid.UUID(data["election_id"]),
        job_id=uuid.UUID(job_id),
        db=db_session,
        current_user=_user(data),
    )
    assert response.status == BallotSendJobStatus.COMPLETED.value
    assert response.started_at is not None
    assert response.finished_at is not None
    assert response.result is not None
    assert response.result.success is True
    assert response.result.recipients_count == 2
    assert response.result.failed_count == 0
    assert "Ballot emails sent to 2 recipient(s)" in response.result.message
    election = (
        await db_session.execute(
            select(Election).where(Election.id == data["election_id"])
        )
    ).scalar_one()
    await db_session.refresh(election)
    assert election.email_sent is True
    assert sorted(election.email_recipients) == sorted(data["users"])


async def test_a_second_send_is_refused_while_one_is_in_progress(
    db_session: AsyncSession,
):
    # Each send mints new tokens; two overlapping ones void the first links.
    data = await _make_election(db_session)
    await _queue(db_session, data)

    with patch(START_JOB, new=MagicMock()) as start, pytest.raises(
        HTTPException
    ) as exc:
        await start_ballot_send_job_endpoint(
            election_id=uuid.UUID(data["election_id"]),
            email_data=EmailBallot(),
            db=db_session,
            current_user=_user(data),
        )
    assert exc.value.status_code == 409
    assert exc.value.detail == SEND_IN_PROGRESS_DETAIL
    start.assert_not_called()

    send_batch = AsyncMock(side_effect=lambda b: [True] * len(b))
    with patch(SEND_BATCH, new=send_batch), pytest.raises(HTTPException) as exc:
        await send_ballot_endpoint(
            election_id=uuid.UUID(data["election_id"]),
            email_data=EmailBallot(),
            request=SimpleNamespace(),
            db=db_session,
            current_user=_user(data),
        )
    assert exc.value.status_code == 409
    assert send_batch.await_count == 0


async def test_a_finished_send_does_not_block_the_next(db_session: AsyncSession):
    data = await _make_election(db_session)
    start = await _queue(db_session, data)
    await _run(db_session, start, AsyncMock(side_effect=lambda b: [True] * len(b)))

    await _queue(db_session, data)


async def test_an_abandoned_job_stops_blocking_and_reads_as_interrupted(
    db_session: AsyncSession,
):
    # A restart mid-send leaves the row "running" with nothing behind it.
    data = await _make_election(db_session)
    start = await _queue(db_session, data)
    job_id = start.call_args.args[0]
    job = await db_session.get(BallotSendJob, job_id)
    assert job is not None
    job.status = BallotSendJobStatus.RUNNING.value
    job.created_at = datetime.now(timezone.utc) - STALE_JOB_AFTER - timedelta(minutes=1)
    await db_session.commit()

    await _queue(db_session, data)

    response = await get_ballot_send_job_endpoint(
        election_id=uuid.UUID(data["election_id"]),
        job_id=uuid.UUID(job_id),
        db=db_session,
        current_user=_user(data),
    )
    assert response.status == BallotSendJobStatus.FAILED.value
    assert response.error == INTERRUPTED_JOB_ERROR
    assert response.result is None


async def test_a_job_for_an_election_closed_before_it_ran_fails_and_sends_nothing(
    db_session: AsyncSession,
):
    data = await _make_election(db_session)
    start = await _queue(db_session, data)
    await db_session.execute(
        text("UPDATE elections SET status = 'closed' WHERE id = :id"),
        {"id": data["election_id"]},
    )
    send_batch = AsyncMock(side_effect=lambda b: [True] * len(b))

    job_id = await _run(db_session, start, send_batch)

    assert send_batch.await_count == 0
    job = await db_session.get(BallotSendJob, job_id)
    assert job is not None
    await db_session.refresh(job)
    assert job.status == BallotSendJobStatus.FAILED.value
    assert job.error == "Ballot emails cannot be sent for a closed election"


async def test_a_send_that_raises_fails_the_job_without_leaking_internals(
    db_session: AsyncSession,
):
    data = await _make_election(db_session)
    start = await _queue(db_session, data)

    job_id = await _run(
        db_session,
        start,
        AsyncMock(side_effect=RuntimeError("smtp://user:secret@host refused")),
    )

    job = await db_session.get(BallotSendJob, job_id)
    assert job is not None
    await db_session.refresh(job)
    assert job.status == BallotSendJobStatus.FAILED.value
    assert job.error is not None
    assert "secret" not in job.error
    assert job.finished_at is not None


async def test_a_job_is_not_readable_from_another_organization(
    db_session: AsyncSession,
):
    data = await _make_election(db_session)
    other = await _make_election(db_session)
    start = await _queue(db_session, data)
    job_id = start.call_args.args[0]

    for election_id, user in (
        (data["election_id"], _user(other)),
        (other["election_id"], _user(other)),
    ):
        with pytest.raises(HTTPException) as exc:
            await get_ballot_send_job_endpoint(
                election_id=uuid.UUID(election_id),
                job_id=uuid.UUID(job_id),
                db=db_session,
                current_user=user,
            )
        assert exc.value.status_code == 404


async def test_queueing_refuses_an_election_that_is_not_open(
    db_session: AsyncSession,
):
    data = await _make_election(db_session, status="draft")

    with patch(START_JOB, new=MagicMock()) as start, pytest.raises(
        HTTPException
    ) as exc:
        await start_ballot_send_job_endpoint(
            election_id=uuid.UUID(data["election_id"]),
            email_data=EmailBallot(),
            db=db_session,
            current_user=_user(data),
        )
    assert exc.value.status_code == 400
    start.assert_not_called()
    count = (
        await db_session.execute(
            text("SELECT COUNT(*) FROM ballot_send_jobs WHERE election_id = :id"),
            {"id": data["election_id"]},
        )
    ).scalar_one()
    assert count == 0
