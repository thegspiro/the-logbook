"""
Ballot sends: the shared send-and-report step, and the background job that
runs it outside the HTTP request.

Emailing ballots to a department checks every member's eligibility, mints a
voting token each, and pushes the batch through one SMTP connection with a
pause between messages. Around forty members that outlasts the browser's
30-second timeout and, a little later, nginx's 60-second proxy timeout, while
the server carries on and sends anyway — so the secretary is told it failed
and is invited to send again, which mints new tokens and voids the links
already in members' inboxes.

``POST /elections/{id}/ballot-send-jobs`` therefore records a
:class:`BallotSendJob`, returns at once, and the send runs in this process
after the response. The page polls the row for the outcome. The synchronous
``POST /elections/{id}/send-ballot`` is kept for API callers and runs the same
:func:`perform_ballot_send`, so both report a send identically.

Remind Non-Voters goes the same way through
``POST /elections/{id}/reminder-send-jobs``: a reminder is a ballot send to
the members who have not voted, with fresh tokens, and outlasts the timeout
just the same. Both kinds share the table and the one-send-at-a-time guard,
because two overlapping sends of either kind mint tokens over each other.
"""

import asyncio
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable, List, Optional, Set, Union
from uuid import UUID

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import async_session_factory
from app.core.utils import safe_error_detail
from app.models.election import (
    BallotSendJob,
    BallotSendJobKind,
    BallotSendJobStatus,
    Election,
    ElectionStatus,
)
from app.schemas.election import (
    BallotSendJobResponse,
    EmailBallotResponse,
    SkippedVoterDetail,
)
from app.services.election_service import ElectionService

# A queued or running job older than this is taken to have been interrupted —
# the process that owned it restarted mid-send — and stops blocking a new
# send. A send runs at roughly a second per member, so this leaves room for a
# roster of well over a thousand before a live send could be mistaken for a
# dead one.
STALE_JOB_AFTER = timedelta(minutes=30)

INTERRUPTED_JOB_ERROR = (
    "This send was interrupted before it finished, most likely by a server "
    "restart. Some members may have received a ballot. Check who received one "
    "on the election page before sending again."
)

SEND_IN_PROGRESS_DETAIL = (
    "Ballot emails for this election are already being sent. "
    "Wait for that send to finish before sending again."
)

_ACTIVE_STATUSES = (
    BallotSendJobStatus.QUEUED.value,
    BallotSendJobStatus.RUNNING.value,
)

# asyncio keeps only a weak reference to a task, so a fire-and-forget send
# could be garbage-collected mid-flight without a strong reference held here.
_running_tasks: Set["asyncio.Task[None]"] = set()

SessionFactory = Callable[[], AbstractAsyncContextManager[AsyncSession]]


def ballot_send_message(
    recipients_count: int,
    failed_count: int,
    skipped_count: int,
    *,
    summary_requested: bool,
    summary_sent: bool,
    skipped_details: Optional[list[dict]] = None,
) -> str:
    """The secretary's account of a ballot send.

    The summary line reports whether the summary email actually went. It used
    to say "emailed to you" whenever one was asked for, including when email
    was off and nothing was sent.

    The skipped clause names the reasons the send actually recorded when it
    has them. The fixed "did not meet ballot item requirements" named an item
    rule for a member skipped for not being on the voter roll frozen when the
    election opened (W50-55); it remains the wording for a caller that has a
    count but no per-member reasons to report.
    """
    parts = [f"Ballot emails sent to {recipients_count} recipient(s)"]
    if failed_count > 0:
        parts.append(f"{failed_count} failed")
    if skipped_count > 0:
        parts.append(
            ElectionService.summarize_skipped(skipped_details)
            if skipped_details
            else f"{skipped_count} skipped (did not meet ballot item "
            f"requirements — see skipped details for per-member reasons)"
        )
    if summary_requested:
        parts.append(
            "Eligibility summary emailed to you"
            if summary_sent
            else "The eligibility summary email could not be sent"
        )
    return ". ".join(parts)


def ensure_election_open(election: Election) -> None:
    """Refuse a live ballot send for an election that cannot take a vote.

    Only an OPEN election can take a vote, so a live ballot sent in any other
    status mails members a "Vote Now" link that answers "Election is draft" /
    "Election is closed" — and a draft is still editable, so the ballot they
    were mailed may not even be the one that opens. A closed or cancelled one
    also mints dead tokens. The gate sits with the live sends rather than in
    the service because /send-test-ballot (is_test=True, sender only) uses the
    same service and is exactly how a draft is previewed before opening.
    """
    if election.status != ElectionStatus.OPEN:
        raise ValueError(
            f"Ballot emails cannot be sent for a {election.status.value} election"
        )


async def perform_ballot_send(
    service: ElectionService,
    election: Election,
    organization_id: str,
    *,
    recipient_user_ids: Optional[List[UUID]],
    subject: Optional[str],
    message: Optional[str],
    base_ballot_url: Optional[str],
    send_eligibility_summary: bool,
) -> EmailBallotResponse:
    """Send the ballots, the optional eligibility summary, and report both.

    Raises whatever ``send_ballot_emails`` raises; the caller decides how a
    failure reaches the secretary (an HTTP status, or a failed job row).
    """
    recipients_count, failed_count, skipped_count, skipped_details, _sent_ids = (
        await service.send_ballot_emails(
            election_id=UUID(str(election.id)),
            organization_id=organization_id,
            recipient_user_ids=recipient_user_ids,
            subject=subject,
            message=message,
            base_ballot_url=base_ballot_url,
        )
    )

    total_attempted = recipients_count + failed_count + skipped_count
    if total_attempted == 0:
        # Build a diagnostic message explaining why nobody was found
        if recipient_user_ids:
            hint = (
                "None of the specified recipients were found in this "
                "organization. Verify the selected members are active."
            )
        elif election.eligible_voters:
            hint = (
                "The election has an eligible voters list configured, but "
                "none of those members were found. Verify the listed members "
                "are still active in the organization."
            )
        else:
            hint = (
                "No active members were found in the organization. Ensure "
                "members exist and are marked as active."
            )
        return EmailBallotResponse(
            success=False,
            recipients_count=0,
            failed_count=0,
            skipped_count=0,
            skipped_details=[
                SkippedVoterDetail.model_validate(d) for d in skipped_details
            ],
            message=f"No eligible recipients found. {hint}",
        )

    summary_sent = False
    if send_eligibility_summary:
        try:
            summary_sent, _ = await service.send_eligibility_summary_email(
                election_id=UUID(str(election.id)),
                organization_id=organization_id,
                sent_count=recipients_count,
                skipped_count=skipped_count,
                skipped_details=skipped_details,
            )
        except Exception as e:
            logger.warning(f"Failed to send eligibility summary email: {e}")

    return EmailBallotResponse(
        success=recipients_count > 0 and failed_count == 0,
        recipients_count=recipients_count,
        failed_count=failed_count,
        skipped_count=skipped_count,
        skipped_details=[SkippedVoterDetail.model_validate(d) for d in skipped_details],
        message=ballot_send_message(
            recipients_count,
            failed_count,
            skipped_count,
            summary_requested=send_eligibility_summary,
            summary_sent=summary_sent,
            skipped_details=skipped_details,
        ),
    )


def reminder_send_message(
    reminded: int,
    failed: int,
    skipped: int,
    skipped_details: List[dict],
) -> str:
    """The secretary's account of a non-voter reminder."""
    if reminded == 0 and failed == 0 and skipped == 0:
        return "Everyone eligible has already voted — no reminders needed"
    parts = [f"Reminder sent to {reminded} non-voter(s)"]
    if failed > 0:
        parts.append(f"{failed} failed")
    if skipped > 0:
        parts.append(ElectionService.summarize_skipped(skipped_details))
    return ". ".join(parts)


async def perform_reminder_send(
    service: ElectionService,
    election_id: UUID,
    organization_id: str,
    *,
    requested_by: Optional[str],
    subject: Optional[str],
    message: Optional[str],
    base_ballot_url: str,
) -> EmailBallotResponse:
    """Remind the members who have not voted, and report it.

    Raises whatever ``remind_non_voters`` raises, including its cooldown and
    open-election refusals.
    """
    reminded, failed, skipped, skipped_details = await service.remind_non_voters(
        election_id=election_id,
        organization_id=organization_id,
        user_id=requested_by,
        subject=subject,
        message=message,
        base_ballot_url=base_ballot_url,
    )
    return EmailBallotResponse(
        success=failed == 0,
        recipients_count=reminded,
        failed_count=failed,
        skipped_count=skipped,
        skipped_details=[SkippedVoterDetail.model_validate(d) for d in skipped_details],
        message=reminder_send_message(reminded, failed, skipped, skipped_details),
    )


@dataclass(frozen=True)
class BallotSend:
    """A queued send of the ballot itself."""

    recipient_user_ids: Optional[List[UUID]]
    subject: Optional[str]
    message: Optional[str]
    base_ballot_url: Optional[str]
    send_eligibility_summary: bool

    kind = BallotSendJobKind.BALLOTS

    async def __call__(
        self, service: ElectionService, election: Election, organization_id: str
    ) -> EmailBallotResponse:
        # Re-checked here, not only when the job was queued: the election can
        # be closed in the moment between the request and the send.
        ensure_election_open(election)
        return await perform_ballot_send(
            service,
            election,
            organization_id,
            recipient_user_ids=self.recipient_user_ids,
            subject=self.subject,
            message=self.message,
            base_ballot_url=self.base_ballot_url,
            send_eligibility_summary=self.send_eligibility_summary,
        )


@dataclass(frozen=True)
class ReminderSend:
    """A queued reminder to the members who have not voted."""

    requested_by: Optional[str]
    subject: Optional[str]
    message: Optional[str]
    base_ballot_url: str

    kind = BallotSendJobKind.REMINDER

    async def __call__(
        self, service: ElectionService, election: Election, organization_id: str
    ) -> EmailBallotResponse:
        return await perform_reminder_send(
            service,
            UUID(str(election.id)),
            organization_id,
            requested_by=self.requested_by,
            subject=self.subject,
            message=self.message,
            base_ballot_url=self.base_ballot_url,
        )


QueuedSend = Union[BallotSend, ReminderSend]


def _as_utc(value: datetime) -> datetime:
    # MySQL DATETIME comes back naive; every stored time is UTC.
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


async def find_active_job(
    db: AsyncSession, election_id: str, organization_id: str
) -> Optional[BallotSendJob]:
    """The send still in progress for this election, if any.

    A queued or running row older than ``STALE_JOB_AFTER`` belonged to a
    process that died mid-send; it is marked failed here, in the caller's
    transaction, so it stops blocking the next send and its poller learns
    what happened.
    """
    result = await db.execute(
        select(BallotSendJob)
        .where(BallotSendJob.election_id == str(election_id))
        .where(BallotSendJob.organization_id == str(organization_id))
        .where(BallotSendJob.status.in_(_ACTIVE_STATUSES))
        .order_by(BallotSendJob.created_at.desc())
    )
    now = datetime.now(timezone.utc)
    active: Optional[BallotSendJob] = None
    for job in result.scalars().all():
        if now - _as_utc(job.created_at) > STALE_JOB_AFTER:
            _mark_interrupted(job, now)
        elif active is None:
            active = job
    return active


def _mark_interrupted(job: BallotSendJob, now: datetime) -> None:
    logger.warning(
        f"Ballot send job abandoned | job={job.id} election={job.election_id} "
        f"status={job.status} created_at={job.created_at}"
    )
    job.status = BallotSendJobStatus.FAILED.value
    job.error = INTERRUPTED_JOB_ERROR
    job.finished_at = now


async def get_job(
    db: AsyncSession, job_id: str, election_id: str, organization_id: str
) -> Optional[BallotSendJob]:
    """A job by id, scoped to its election and the caller's organization.

    An abandoned job is reported as failed rather than left reading
    "running" forever, so a page polling it after a restart stops waiting.
    """
    result = await db.execute(
        select(BallotSendJob)
        .where(BallotSendJob.id == str(job_id))
        .where(BallotSendJob.election_id == str(election_id))
        .where(BallotSendJob.organization_id == str(organization_id))
    )
    job = result.scalar_one_or_none()
    if job is None:
        return None
    now = datetime.now(timezone.utc)
    if (
        job.status in _ACTIVE_STATUSES
        and now - _as_utc(job.created_at) > STALE_JOB_AFTER
    ):
        _mark_interrupted(job, now)
        await db.commit()
    return job


def job_response(job: BallotSendJob) -> BallotSendJobResponse:
    result: Optional[EmailBallotResponse] = None
    if job.status == BallotSendJobStatus.COMPLETED.value:
        result = EmailBallotResponse(
            success=bool(job.success),
            recipients_count=job.recipients_count,
            failed_count=job.failed_count,
            skipped_count=job.skipped_count,
            skipped_details=[
                SkippedVoterDetail.model_validate(d)
                for d in (job.skipped_details or [])
            ],
            message=job.message or "",
        )
    return BallotSendJobResponse(
        id=job.id,
        election_id=job.election_id,
        kind=job.kind,
        status=job.status,
        created_at=job.created_at,
        started_at=job.started_at,
        finished_at=job.finished_at,
        result=result,
        error=job.error,
    )


async def run_ballot_send_job(
    job_id: str,
    organization_id: str,
    send: QueuedSend,
    *,
    session_factory: SessionFactory = async_session_factory,
) -> None:
    """Run one queued send and record its outcome on the job row.

    Opens its own session: the request's session is closed by the time this
    runs. Never raises — nothing awaits a background task, so an escaped
    exception would only surface as "Task exception was never retrieved".
    """
    try:
        async with session_factory() as db:
            await _run_job(db, job_id, organization_id, send)
    except Exception as e:
        logger.exception(f"Ballot send job crashed | job={job_id} error={e}")


async def _run_job(
    db: AsyncSession,
    job_id: str,
    organization_id: str,
    send: QueuedSend,
) -> None:
    job = await _load_job(db, job_id, organization_id)
    if job is None or job.status != BallotSendJobStatus.QUEUED.value:
        logger.warning(
            f"Ballot send job not runnable | job={job_id} "
            f"status={job.status if job else 'missing'}"
        )
        return
    job.status = BallotSendJobStatus.RUNNING.value
    job.started_at = datetime.now(timezone.utc)
    election_id = job.election_id
    await db.commit()

    try:
        election_result = await db.execute(
            select(Election)
            .where(Election.id == election_id)
            .where(Election.organization_id == str(organization_id))
        )
        election = election_result.scalar_one_or_none()
        if election is None:
            raise ValueError("Election not found")
        outcome = await send(ElectionService(db), election, str(organization_id))
    except Exception as e:
        await db.rollback()
        failed = await _load_job(db, job_id, organization_id)
        if failed is not None:
            failed.status = BallotSendJobStatus.FAILED.value
            failed.error = safe_error_detail(e)
            failed.finished_at = datetime.now(timezone.utc)
            await db.commit()
        logger.error(
            f"Ballot send job failed | job={job_id} kind={send.kind.value} "
            f"election={election_id} error={e}"
        )
        return

    done = await _load_job(db, job_id, organization_id)
    if done is None:
        return
    done.status = BallotSendJobStatus.COMPLETED.value
    done.success = outcome.success
    done.recipients_count = outcome.recipients_count
    done.failed_count = outcome.failed_count
    done.skipped_count = outcome.skipped_count
    done.skipped_details = [d.model_dump() for d in outcome.skipped_details]
    done.message = outcome.message
    done.finished_at = datetime.now(timezone.utc)
    await db.commit()
    logger.info(
        f"Ballot send job completed | job={job_id} kind={send.kind.value} "
        f"election={election_id} sent={outcome.recipients_count} "
        f"failed={outcome.failed_count} skipped={outcome.skipped_count}"
    )


async def _load_job(
    db: AsyncSession, job_id: str, organization_id: str
) -> Optional[BallotSendJob]:
    result = await db.execute(
        select(BallotSendJob)
        .where(BallotSendJob.id == str(job_id))
        .where(BallotSendJob.organization_id == str(organization_id))
    )
    return result.scalar_one_or_none()


def start_ballot_send_job(
    job_id: str, organization_id: str, send: QueuedSend
) -> "asyncio.Task[None]":
    """Schedule :func:`run_ballot_send_job` on the running loop.

    The send lives in this process: a restart while it runs abandons it, and
    the row is reported as interrupted once ``STALE_JOB_AFTER`` passes.
    """
    task = asyncio.create_task(run_ballot_send_job(job_id, organization_id, send))
    _running_tasks.add(task)
    task.add_done_callback(_running_tasks.discard)
    return task
