"""
Attendance waiver requests that nobody decided close on their own.

Owner decision, 2026-11-13: a request still undecided "seven days from the
day of the event" expires. Undecided means PENDING, including while it waits
on a decider's question or on the member to confirm a rescheduled date. When
is ``expires_at_for`` in the engine, the one definition every response's
``expires_at`` also reads (pitfall #29).

An expired request is an absence: nothing grades or excuses it, because every
reader counts only APPROVED requests (``training_waiver_service`` for the
training graders; a meeting request reaches ``meeting_attendees`` only when it
is approved, ``grant_meeting_waiver``). The row, its log and its documents are
kept like any other closed request.

Driven daily by ``scheduled_tasks.run_attendance_waiver_expiry``, across every
department, both workflows.
"""

from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Sequence
from zoneinfo import ZoneInfo

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit_event
from app.core.utils import generate_uuid
from app.models.attendance_waiver import (
    AttendanceWaiverAction,
    AttendanceWaiverRequest,
    AttendanceWaiverStatus,
)
from app.models.event import Event
from app.models.notification import NotificationChannel, NotificationLog
from app.models.user import User
from app.services import attendance_waiver_service as engine
from app.services.attendance_waiver_service import (
    EXPIRY_DAYS,
    MEMBER_UPDATE_CATEGORY,
    PROMPT_METADATA_KEY,
    REVIEW_PROMPT_CATEGORY,
    SPECS,
    AttendanceWaiverService,
    expires_at_for,
    member_action_url,
)
from app.services.notifications_service import NotificationsService
from app.utils.org_timezone import local_date, resolve_scheduling_timezone


def expiry_notice(request: AttendanceWaiverRequest) -> tuple[str, str]:
    """The member's subject and sentence. Ids and the snapshot title only:
    never the reason, the category or a note (they may be medical)."""
    title = request.event_title_snapshot
    day = engine._day_label(request.session_date)
    return (
        f"Waiver request closed — {title}",
        f'Your request to be excused from "{title}" on {day} was not decided '
        f"within seven days of the session and has closed; the session counts "
        f"as missed.",
    )


class AttendanceWaiverExpiry:
    """The sweep that expires undecided requests."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def sweep(
        self,
        now: Optional[datetime] = None,
        organization_ids: Optional[Sequence[str]] = None,
    ) -> Dict[str, Any]:
        """Expire every due request in every department (or in
        ``organization_ids``, for a manual run of one).

        Idempotent (pitfall #36): each request is re-read under its lock with
        ``status = 'pending'`` in the query, so a second run, or a second
        worker, finds nothing to change and sends nothing.

        Stamp, commit, then send (at most once): the member's email goes only
        after the expiry is committed, so a crash between the two loses the
        email, never repeats it, and the in-app row (written in the same
        commit as the expiry) is still there. A notice saying "your request
        closed" twice is worse than once missed when the bell still has it.

        Each request is its own transaction, rather than one per department:
        it holds at most the member's ``users`` row and the request row, in
        the engine's lock order, so it cannot form a cycle with a decision
        (which takes the same two) or with a reschedule or cancellation
        (which hold the event and lock that event's requests, but never a
        ``users`` row). Holding a department's worth of request rows at once
        could. One failure is rolled back and the rest go on.
        """
        now = now or engine._now()
        results: Dict[str, Any] = {
            "orgs_processed": 0,
            "requests_expired": 0,
            "errors": [],
        }
        query = (
            select(AttendanceWaiverRequest.organization_id)
            .where(AttendanceWaiverRequest.status == AttendanceWaiverStatus.PENDING)
            .distinct()
        )
        if organization_ids is not None:
            query = query.where(
                AttendanceWaiverRequest.organization_id.in_(
                    [str(o) for o in organization_ids]
                )
            )
        # Plain values, read before the loop: a rollback expires ORM objects.
        org_ids = sorted(str(o) for o in (await self.db.execute(query)).scalars())
        for org_id in org_ids:
            try:
                tz = await resolve_scheduling_timezone(self.db, org_id)
                due = await self._due(org_id, tz, now)
                # End the read-only transaction before taking locks.
                await self.db.commit()
            except Exception as exc:
                logger.error("Waiver expiry failed for org {}: {}", org_id, exc)
                results["errors"].append({"org_id": org_id, "error": str(exc)})
                await self.db.rollback()
                continue
            for request_id in due:
                try:
                    request = await self._expire(org_id, request_id, tz, now)
                except Exception as exc:
                    logger.error(
                        "Waiver expiry failed for request {}: {}", request_id, exc
                    )
                    results["errors"].append(
                        {"org_id": org_id, "request_id": request_id, "error": str(exc)}
                    )
                    await self.db.rollback()
                    continue
                if request is not None:
                    results["requests_expired"] += 1
                    await self._email(org_id, request)
            results["orgs_processed"] += 1
        return results

    async def _due(self, org_id: str, tz: ZoneInfo, now: datetime) -> List[str]:
        """The ids of the department's pending requests that are due, oldest
        session first.

        The date bound is the calendar half of ``expires_at_for`` (due once
        the department's date is at least eight days after the session), so
        only those rows are read; the event half is then checked per row.
        """
        latest_session = local_date(now, tz) - timedelta(days=EXPIRY_DAYS + 1)
        rows = (
            await self.db.execute(
                select(
                    AttendanceWaiverRequest.id,
                    AttendanceWaiverRequest.event_id,
                    AttendanceWaiverRequest.session_date,
                )
                .where(
                    AttendanceWaiverRequest.organization_id == org_id,
                    AttendanceWaiverRequest.status == AttendanceWaiverStatus.PENDING,
                    AttendanceWaiverRequest.session_date <= latest_session,
                )
                .order_by(
                    AttendanceWaiverRequest.session_date, AttendanceWaiverRequest.id
                )
            )
        ).all()
        event_ids = sorted({str(r.event_id) for r in rows if r.event_id})
        events: Dict[str, Event] = {}
        if event_ids:
            found = await self.db.execute(
                select(Event).where(
                    Event.organization_id == org_id, Event.id.in_(event_ids)
                )
            )
            events = {str(e.id): e for e in found.scalars().all()}
        return [
            str(r.id)
            for r in rows
            if now
            >= expires_at_for(
                r.session_date, tz, events.get(str(r.event_id)) if r.event_id else None
            )
        ]

    async def _expire(
        self, org_id: str, request_id: str, tz: ZoneInfo, now: datetime
    ) -> Optional[AttendanceWaiverRequest]:
        """Expire one request and commit; None when it is no longer due."""
        peek = (
            await self.db.execute(
                select(AttendanceWaiverRequest.user_id).where(
                    AttendanceWaiverRequest.id == request_id,
                    AttendanceWaiverRequest.organization_id == org_id,
                )
            )
        ).scalar_one_or_none()
        if peek is None:
            await self.db.rollback()
            return None
        # The engine's lock order: the member's row, then the request.
        await self.db.execute(
            select(User.id)
            .where(User.id == str(peek), User.organization_id == org_id)
            .with_for_update()
        )
        request: Optional[AttendanceWaiverRequest] = (
            await self.db.execute(
                select(AttendanceWaiverRequest)
                .where(
                    AttendanceWaiverRequest.id == request_id,
                    AttendanceWaiverRequest.organization_id == org_id,
                    # The guard: decided, withdrawn, voided or already
                    # expired since the list was read means nothing to do.
                    AttendanceWaiverRequest.status == AttendanceWaiverStatus.PENDING,
                )
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if request is None:
            await self.db.rollback()
            return None
        # Read again under the lock: a reschedule may have moved the session.
        event = None
        if request.event_id:
            event = (
                await self.db.execute(
                    select(Event).where(
                        Event.id == str(request.event_id),
                        Event.organization_id == org_id,
                    )
                )
            ).scalar_one_or_none()
        if now < expires_at_for(request.session_date, tz, event):
            await self.db.rollback()
            return None

        spec = SPECS[request.workflow]
        request.status = AttendanceWaiverStatus.EXPIRED
        request.live_key = None
        request.info_requested_at = None
        request.reconfirm_requested_at = None
        self.db.add(
            AttendanceWaiverService._action(
                request, AttendanceWaiverAction.EXPIRED, None
            )
        )
        subject, sentence = expiry_notice(request)
        self.db.add(
            NotificationLog(
                id=generate_uuid(),
                organization_id=org_id,
                recipient_id=str(request.user_id),
                channel=NotificationChannel.IN_APP,
                category=MEMBER_UPDATE_CATEGORY,
                subject=subject,
                message=sentence,
                action_url=member_action_url(request),
                notification_metadata={PROMPT_METADATA_KEY: str(request.id)},
                delivered=True,
            )
        )
        await log_audit_event(
            db=self.db,
            event_type="attendance_waiver_request_expired",
            event_category=spec.audit_category,
            severity="info",
            event_data=AttendanceWaiverService._ids(request),
            organization_id=org_id,
        )
        await self.db.flush()
        # Nothing is left to decide: every decider's prompt goes, in this
        # transaction.
        await NotificationsService(self.db).archive_related_notifications(
            org_id,
            REVIEW_PROMPT_CATEGORY,
            PROMPT_METADATA_KEY,
            str(request.id),
            commit=False,
        )
        await self.db.commit()
        await self.db.refresh(request)
        return request

    async def _email(self, org_id: str, request: AttendanceWaiverRequest) -> None:
        """The member's email, after the commit; ``_email`` never raises."""
        member = (
            await self.db.execute(
                select(User).where(
                    User.id == str(request.user_id), User.organization_id == org_id
                )
            )
        ).scalar_one_or_none()
        if member is None:
            return
        subject, sentence = expiry_notice(request)
        await AttendanceWaiverService(self.db, request.workflow)._email(
            org_id,
            request,
            [member],
            SPECS[request.workflow].member_email_kind,
            subject,
            [sentence],
            member_action_url(request),
            "View Request",
        )
