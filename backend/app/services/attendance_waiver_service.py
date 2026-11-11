"""
Attendance waiver requests: the request engine, and the training workflow.

A member asks to be excused from one training session that counts against
them; an approver decides (owner decisions, 2026-11-10). The rules:

- **Off until a training officer saves a policy.** The policy lives in
  ``organizations.settings["training"]["session_waiver_policy"]`` and is read
  through ``policy_from_settings``, so a missing or malformed value is the
  disabled default (CLAUDE.md pitfall #19).
- **Only a session that counts against the member.** A TRAINING event, not
  cancelled, whose training session is linked to a SESSION_ATTENDANCE
  requirement that grades this member (``ComplianceGrading.for_member``). A
  member who checked in, or is exempt from compliance, has nothing to excuse.
- **One live request per member and session**, enforced by the unique
  ``live_key``. Withdrawing frees it; a denial does not.
- **A deadline the department chooses**, compared in UTC.
- **An optional cap**, per calendar year or any rolling 12 months, counting
  approved requests by session date. Pending requests do not count, so the cap
  is enforced when a request is approved, under a lock (pitfall #27). A
  Chief's override is not blocked by it, but counts toward it.
- **Routing**: the holders of the chosen positions; failing them, the Chief;
  failing the Chief, training managers. Never the requester. ``_route_ids`` is
  the one definition, read by both the recipients and ``may_decide``.
- **The first decision is final**, except that a Chief may override a denial,
  with a reason, and never on their own request.

**Lock order.** Every write locks the requester's ``users`` row before the
request row. Submitting has to take the member's row first (there is no request
row yet), so the decisions do the same; taking them in the other order would
let an approval and a submission by the same member deadlock.

**No gap lock another member's write needs.** The member's row serializes only
that member's writes, so any range a write locks must be that member's alone:
a gap shared with another member is held by both and blocks both inserts, and
InnoDB kills one with a 1213. Submitting therefore takes no locking read of the
requests at all (``_assess``), and the approval's cap count is pinned to the
member's own index range (``_approved_dates``).

Approved requests reach grading through the waiver loaders as
``SOURCE_SESSION_EXCUSAL`` (``training_waiver_service``); nothing here touches
a grader.
"""

import calendar
import copy
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from datetime import timezone as dt_timezone
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple

from loguru import logger
from sqlalchemy import false, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.dependencies import user_has_permission
from app.core.audit import log_audit_event
from app.core.constants import CHIEF_POSITION_SLUGS
from app.core.utils import generate_uuid
from app.models.attendance_waiver import (
    AttendanceWaiverAction,
    AttendanceWaiverAttachment,
    AttendanceWaiverRequest,
    AttendanceWaiverRequestAction,
    AttendanceWaiverStatus,
    AttendanceWaiverWorkflow,
    live_key_for,
)
from app.models.event import Event, EventRSVP, EventType
from app.models.notification import NotificationChannel, NotificationLog
from app.models.training import (
    TrainingRecord,
    TrainingRequirement,
    TrainingSession,
    TrainingSessionRequirement,
    TrainingStatus,
)
from app.models.user import Organization, Position, User, user_positions
from app.schemas.attendance_waiver import (
    MAX_ATTACHMENTS,
    POLICY_KEY,
    POLICY_SECTION,
    AttendanceWaiverPolicy,
    CapPeriod,
    policy_from_settings,
)
from app.services.file_storage_service import StoredFile
from app.services.notifications_service import NotificationsService
from app.services.requirement_override_service import holds_chief_position
from app.services.training_compliance import (
    ComplianceGrading,
    _load_compliance_config,
    is_session_attendance,
)
from app.utils.org_scoping import assert_all_in_org
from app.utils.org_timezone import local_date, resolve_scheduling_timezone

TRAINING_WORKFLOW = AttendanceWaiverWorkflow.TRAINING_SESSION
# The (organization, member, date) index; the cap's locking read is pinned to
# it (see _approved_dates).
MEMBER_INDEX = "ix_attendance_waiver_requests_org_user_date"
# The last step of the training routing chain.
TRAINING_MANAGE = "training.manage"

# In-app categories. Metadata carries waiver_request_id so every decider's
# prompt can be archived once any one of them decides.
REVIEW_PROMPT_CATEGORY = "attendance_waiver_request"
MEMBER_UPDATE_CATEGORY = "attendance_waiver_update"
PROMPT_METADATA_KEY = "waiver_request_id"

_DEADLINE_OFFSETS = {
    "24h_after_end": timedelta(hours=24),
    "7d_after_end": timedelta(days=7),
}


# Where each action falls in a request's life, to order a log whose times tie.
_ACTION_ORDER = {
    AttendanceWaiverAction.SUBMITTED: 0,
    AttendanceWaiverAction.WITHDRAWN: 1,
    AttendanceWaiverAction.APPROVED: 1,
    AttendanceWaiverAction.DENIED: 1,
    AttendanceWaiverAction.CHIEF_OVERRIDE: 2,
    AttendanceWaiverAction.VOIDED: 3,
}


class AttendanceWaiverNotFound(LookupError):
    """The event or request does not exist for this caller in their organization."""


def _now() -> datetime:
    """The current time; a seam the deadline tests patch."""
    return datetime.now(dt_timezone.utc)


def _utc(value: datetime) -> datetime:
    """A stored time read as UTC; MySQL hands DATETIME back naive."""
    return value.replace(tzinfo=dt_timezone.utc) if value.tzinfo is None else value


def _clean(text: Optional[str]) -> Optional[str]:
    """Trimmed free text; empty becomes None."""
    return (text or "").strip() or None


# ---------------------------------------------------------------------------
# The cap, as pure functions
# ---------------------------------------------------------------------------


def add_months(day: date, months: int) -> date:
    """``day`` moved by whole months, clamped to the end of a shorter month."""
    index = day.month - 1 + months
    year, month = day.year + index // 12, index % 12 + 1
    return date(year, month, min(day.day, calendar.monthrange(year, month)[1]))


def rolling_window_end(start: date) -> date:
    """The last day of the 12-month span that begins on ``start``."""
    return add_months(start, 12) - timedelta(days=1)


def calendar_year_used(dates: Iterable[date], day: date) -> int:
    """Approved waivers in ``day``'s calendar year.

    ``dates`` are session dates, which are already the department's local
    dates, so this is the department's calendar year.
    """
    return sum(1 for d in dates if d.year == day.year)


def rolling_used(dates: Iterable[date], day: date) -> int:
    """The most approved waivers in any 12-month span that contains ``day``.

    The rolling rule is that no 12-month span may hold more approved waivers
    than the cap, so approving one dated ``day`` is safe exactly when every
    span containing ``day`` has room. Only spans starting on ``day`` or on one
    of the ``dates`` need checking: sliding any other span's start forward to
    the next of those loses nothing from its front and can only gain at its
    end. Future dates count: a request may be approved before its session.
    """
    ordered = sorted(dates)
    starts = {day} | {d for d in ordered if d <= day <= rolling_window_end(d)}
    best = 0
    for start in starts:
        end = rolling_window_end(start)
        best = max(best, sum(1 for d in ordered if start <= d <= end))
    return best


def cap_used(period: CapPeriod, dates: Iterable[date], day: date) -> int:
    """What ``day``'s session would be counted against under ``period``."""
    if period == "rolling_12_months":
        return rolling_used(dates, day)
    return calendar_year_used(dates, day)


def remaining(cap: Optional[int], used: Optional[int]) -> Optional[int]:
    """Waivers left; None when there is no cap."""
    if cap is None:
        return None
    return max(cap - (used or 0), 0)


def deadline_for(preset: str, event: Event) -> datetime:
    """The last moment a request for ``event`` is accepted, in UTC.

    A request must arrive strictly before it.
    """
    if preset in _DEADLINE_OFFSETS:
        return _utc(event.end_datetime) + _DEADLINE_OFFSETS[preset]
    return _utc(event.start_datetime)


def _cap_period_label(period: CapPeriod, day: date) -> str:
    """Where the cap is counted for a session on ``day``, for a sentence."""
    if period == "rolling_12_months":
        return "in a 12-month span that includes this session"
    return f"in {day.year}"


# ---------------------------------------------------------------------------
# Results
# ---------------------------------------------------------------------------


@dataclass
class Eligibility:
    """Whether a member may ask, and the terms the request form needs."""

    event_id: str
    allowed: bool
    policy: AttendanceWaiverPolicy
    refusal_code: Optional[str] = None
    refusal: Optional[str] = None
    deadline: Optional[datetime] = None
    session_date: Optional[date] = None
    cap_used: Optional[int] = None
    cap_remaining: Optional[int] = None
    existing: Optional[AttendanceWaiverRequest] = None

    def as_response(self) -> dict:
        return {
            "event_id": self.event_id,
            "allowed": self.allowed,
            "refusal_code": self.refusal_code,
            "refusal": self.refusal,
            "deadline": self.deadline,
            "deadline_preset": self.policy.deadline,
            "session_date": self.session_date,
            "cap": self.policy.cap,
            "cap_period": self.policy.cap_period,
            "cap_used": self.cap_used,
            "cap_remaining": self.cap_remaining,
            "categories": list(self.policy.categories),
            "category_required": self.policy.category_required,
            "reason_text": self.policy.reason_text,
            "attachment": self.policy.attachment,
            "existing_request_id": str(self.existing.id) if self.existing else None,
            "existing_request_status": (
                self.existing.status.value if self.existing else None
            ),
        }


@dataclass
class _DeciderPool:
    """Who the routing chain can reach in one organization, by member id.

    ``configured`` and ``chiefs`` are current active holders; ``managers``
    (holders of training.manage) is loaded only when the chain falls through
    to it.
    """

    configured: Set[str]
    chiefs: Set[str]
    managers: Optional[Set[str]] = None
    # The routed set per requester, so a page of requests routes each
    # requester once.
    routed: Dict[str, Set[str]] = field(default_factory=dict)


class AttendanceWaiverService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # Policy
    # ------------------------------------------------------------------

    async def get_policy(self, organization_id: str) -> AttendanceWaiverPolicy:
        settings = (
            await self.db.execute(
                select(Organization.settings).where(
                    Organization.id == str(organization_id)
                )
            )
        ).scalar_one_or_none()
        section = settings.get(POLICY_SECTION) if isinstance(settings, dict) else None
        raw = section.get(POLICY_KEY) if isinstance(section, dict) else None
        return policy_from_settings(raw)

    async def save_policy(
        self, organization_id: str, policy: AttendanceWaiverPolicy, actor: User
    ) -> AttendanceWaiverPolicy:
        org_id = str(organization_id)
        await assert_all_in_org(
            self.db, Position, policy.approver_position_ids, org_id, label="position"
        )
        # Locked so a concurrent settings save cannot write back a copy taken
        # before this one.
        organization = (
            await self.db.execute(
                select(Organization)
                .where(Organization.id == org_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if organization is None:
            raise AttendanceWaiverNotFound("Organization not found")
        # Deep copy: a shallow one shares the nested section with the
        # committed state, and the reassignment would be skipped (#12).
        settings = copy.deepcopy(organization.settings or {})
        section = settings.get(POLICY_SECTION)
        if not isinstance(section, dict):
            section = {}
        section[POLICY_KEY] = policy.model_dump(mode="json")
        settings[POLICY_SECTION] = section
        organization.settings = settings
        await self._audit(
            "attendance_waiver_policy_updated",
            actor,
            {
                "workflow": TRAINING_WORKFLOW.value,
                "enabled": policy.enabled,
                "deadline": policy.deadline,
                "cap": policy.cap,
                "cap_period": policy.cap_period,
                "category_count": len(policy.categories),
                "category_required": policy.category_required,
                "reason_text": policy.reason_text,
                "attachment": policy.attachment,
                "attachment_retention_days": policy.attachment_retention_days,
                "approver_position_ids": list(policy.approver_position_ids),
            },
        )
        await self.db.commit()
        return policy

    # ------------------------------------------------------------------
    # Eligibility
    # ------------------------------------------------------------------

    async def eligibility(
        self, organization_id: str, member: User, event_id: str
    ) -> Eligibility:
        org_id = str(organization_id)
        policy = await self.get_policy(org_id)
        event = await self._event(org_id, event_id)
        loaded = await self._member(org_id, member.id)
        return await self._assess(org_id, loaded, event, policy)

    async def _assess(
        self,
        org_id: str,
        member: User,
        event: Event,
        policy: AttendanceWaiverPolicy,
    ) -> Eligibility:
        """Everything that decides whether ``member`` may ask about ``event``.

        Every read here is a plain read, on a submission too. A locking read
        of a ``live_key`` that does not exist yet, or of a range of the
        member's requests, takes a gap lock, and gap locks span other
        members' keys: two members submitting at once each held the gap the
        other's insert needed, and one got a 1213 deadlock and a 500. Neither
        read needs a lock to be right. A stale miss on ``live_key`` reaches
        the insert and is refused there by the unique key (``submit``), and
        the cap is enforced at approval; here it is the member's early answer.
        """
        tz = await resolve_scheduling_timezone(self.db, org_id)
        session_day = local_date(event.start_datetime, tz)
        deadline = deadline_for(policy.deadline, event)
        existing = await self._live_request(org_id, member.id, event.id)
        used: Optional[int] = None
        if policy.cap is not None:
            used = cap_used(
                policy.cap_period,
                await self._approved_dates(org_id, member.id, lock=False),
                session_day,
            )
        result = Eligibility(
            event_id=str(event.id),
            allowed=False,
            policy=policy,
            deadline=deadline,
            session_date=session_day,
            cap_used=used,
            cap_remaining=remaining(policy.cap, used),
            existing=existing,
        )

        def refuse(code: str, message: str) -> Eligibility:
            result.refusal_code = code
            result.refusal = message
            return result

        if not policy.enabled:
            return refuse(
                "disabled",
                "This department does not take requests to be excused from "
                "training sessions.",
            )
        if event.event_type != EventType.TRAINING:
            return refuse("not_training", "Only a training session can be excused.")
        if event.is_cancelled:
            return refuse("cancelled", "This session was cancelled.")
        if member.compliance_exempt:
            return refuse(
                "exempt",
                "You are exempt from training requirements, so this session "
                "does not count against you.",
            )
        if not await self._counting_requirements(org_id, member, event):
            return refuse(
                "not_counted",
                "This session does not count toward an attendance requirement "
                "that applies to you.",
            )
        if existing is not None:
            return refuse(
                "already_requested",
                "You have already asked to be excused from this session.",
            )
        if await self._checked_in(org_id, member.id, event.id):
            return refuse(
                "checked_in",
                "You checked in to this session, so it already counts as attended.",
            )
        if _now() >= deadline:
            return refuse(
                "deadline_passed", "The deadline to ask about this session has passed."
            )
        if result.cap_remaining == 0:
            return refuse(
                "no_waivers_left",
                f"You have used all {policy.cap} of your waivers "
                f"{_cap_period_label(policy.cap_period, session_day)}.",
            )
        result.allowed = True
        return result

    async def _counting_requirements(
        self, org_id: str, member: User, event: Event
    ) -> List[TrainingRequirement]:
        """The member's attendance requirements this session is linked to.

        ``member.positions`` must be loaded: compliance profiles match on them.
        """
        linked = set(
            (
                await self.db.execute(
                    select(TrainingSessionRequirement.requirement_id)
                    .join(
                        TrainingSession,
                        TrainingSession.id == TrainingSessionRequirement.session_id,
                    )
                    .where(
                        TrainingSession.organization_id == org_id,
                        TrainingSession.event_id == str(event.id),
                        TrainingSessionRequirement.organization_id == org_id,
                    )
                )
            )
            .scalars()
            .all()
        )
        if not linked:
            return []
        requirements = list(
            (
                await self.db.execute(
                    select(TrainingRequirement).where(
                        TrainingRequirement.organization_id == org_id,
                        TrainingRequirement.active.is_(True),
                    )
                )
            )
            .scalars()
            .all()
        )
        grading = ComplianceGrading.from_config(
            await _load_compliance_config(self.db, org_id)
        )
        return [
            req
            for req in grading.for_member(member, requirements).requirements
            if is_session_attendance(req) and str(req.id) in linked
        ]

    async def _checked_in(self, org_id: str, user_id: str, event_id: str) -> bool:
        """A check-in, an officer's attendance override, or a credited record."""
        rsvp = (
            await self.db.execute(
                select(EventRSVP.id)
                .where(
                    EventRSVP.organization_id == org_id,
                    EventRSVP.event_id == str(event_id),
                    EventRSVP.user_id == str(user_id),
                    or_(
                        EventRSVP.checked_in.is_(True),
                        EventRSVP.override_check_in_at.is_not(None),
                    ),
                )
                .limit(1)
            )
        ).scalar_one_or_none()
        if rsvp is not None:
            return True
        record = (
            await self.db.execute(
                select(TrainingRecord.id)
                .where(
                    TrainingRecord.organization_id == org_id,
                    TrainingRecord.user_id == str(user_id),
                    TrainingRecord.source_event_id == str(event_id),
                    TrainingRecord.status == TrainingStatus.COMPLETED,
                )
                .limit(1)
            )
        ).scalar_one_or_none()
        return record is not None

    async def _live_request(
        self, org_id: str, user_id: str, event_id: str
    ) -> Optional[AttendanceWaiverRequest]:
        """The member's live request for the session, by a plain read.

        Never a locking read: see ``_assess``.
        """
        live: Optional[AttendanceWaiverRequest] = (
            await self.db.execute(
                select(AttendanceWaiverRequest).where(
                    AttendanceWaiverRequest.organization_id == org_id,
                    AttendanceWaiverRequest.live_key
                    == live_key_for(
                        TRAINING_WORKFLOW.value, str(event_id), str(user_id)
                    ),
                )
            )
        ).scalar_one_or_none()
        return live

    async def _approved_dates(
        self,
        org_id: str,
        user_id: str,
        *,
        exclude_id: Optional[str] = None,
        lock: bool,
    ) -> List[date]:
        """Session dates of the member's approved requests, the cap's count.

        Approved includes a denial the Chief overrode: it counts toward the
        cap even though the cap could not block it.

        ``lock`` is for the approval, which holds the member's ``users`` row:
        under REPEATABLE READ a plain read behind that lock can still answer
        from a snapshot taken before it (pitfall #27), so the count must be a
        locking read. It must also lock only this member's range. Filtering
        on ``status`` in SQL let the optimizer walk (or rowid-filter through)
        the organization-wide status index, whose gap the approval's own
        status UPDATE then inserts into: two deciders approving two members'
        requests at once each held the gap the other needed, a 1213 deadlock.
        So the read is pinned to the (organization, member, date) index, which
        no approval writes, and the rest is filtered here. A member has a
        handful of requests, so reading all of them costs nothing.
        """
        query = select(
            AttendanceWaiverRequest.id,
            AttendanceWaiverRequest.workflow,
            AttendanceWaiverRequest.status,
            AttendanceWaiverRequest.session_date,
        ).where(
            AttendanceWaiverRequest.organization_id == org_id,
            AttendanceWaiverRequest.user_id == str(user_id),
        )
        if lock:
            query = query.with_hint(
                AttendanceWaiverRequest, f"FORCE INDEX ({MEMBER_INDEX})", "mysql"
            ).with_for_update()
        return [
            row.session_date
            for row in (await self.db.execute(query)).all()
            if row.workflow == TRAINING_WORKFLOW
            and row.status == AttendanceWaiverStatus.APPROVED
            and str(row.id) != str(exclude_id)
        ]

    # ------------------------------------------------------------------
    # Member actions
    # ------------------------------------------------------------------

    async def submit(
        self,
        organization_id: str,
        member: User,
        event_id: str,
        category: Optional[str],
        reason: Optional[str],
        *,
        request_id: Optional[str] = None,
        stored: Sequence[StoredFile] = (),
    ) -> AttendanceWaiverRequest:
        """File the member's request, with any documents already stored.

        ``stored`` are files ``AttendanceWaiverAttachmentService`` has checked
        and written under ``request_id``; their rows are inserted with the
        request, so a request the policy requires a document for is never
        committed without one. The caller removes the files if this raises.
        """
        org_id = str(organization_id)
        policy = await self.get_policy(org_id)
        event = await self._event(org_id, event_id)
        # Two submissions by one member queue here. The second's plain reads
        # may still miss the first's request (a snapshot from before the
        # lock); the unique live_key then refuses its insert below.
        locked = await self._lock_member(org_id, member.id)
        assessment = await self._assess(org_id, locked, event, policy)
        if not assessment.allowed:
            raise ValueError(assessment.refusal)
        category, reason = self._answers(policy, category, reason)
        self.check_attachments(policy, len(stored), submitting=True)

        request = AttendanceWaiverRequest(
            id=request_id or generate_uuid(),
            organization_id=org_id,
            workflow=TRAINING_WORKFLOW,
            user_id=str(member.id),
            event_id=str(event.id),
            event_title_snapshot=(event.title or "Training session")[:255],
            event_start_snapshot=_utc(event.start_datetime),
            session_date=assessment.session_date,
            status=AttendanceWaiverStatus.PENDING,
            live_key=live_key_for(TRAINING_WORKFLOW.value, str(event.id), member.id),
            category=category,
            reason=reason,
            submitted_at=_now(),
        )
        try:
            # The durable guard for one live request per member and session.
            # A savepoint, so a lost race on live_key rolls back only this
            # insert and leaves the caller's session usable.
            async with self.db.begin_nested():
                self.db.add(request)
                self.db.add(
                    self._action(request, AttendanceWaiverAction.SUBMITTED, member)
                )
                # The request first: the attachments' key points at it.
                await self.db.flush()
                for ordinal, file in enumerate(stored, start=1):
                    self.db.add(attachment_row(request, ordinal, file, str(member.id)))
                await self.db.flush()
        except IntegrityError:
            raise ValueError("You have already asked to be excused from this session.")
        await self._audit(
            "attendance_waiver_request_submitted",
            member,
            {**self._ids(request), "attachment_count": len(stored)},
        )
        await self.db.commit()
        await self.db.refresh(request)
        await self._prompt_deciders(org_id, request, member, policy)
        return request

    @staticmethod
    def check_attachments(
        policy: AttendanceWaiverPolicy,
        adding: int,
        *,
        existing: int = 0,
        submitting: bool = False,
    ) -> None:
        """Refuse documents the policy does not take, or too many of them.

        A submission with none is refused only when the policy requires one;
        a later upload is checked against what the request already holds.
        """
        if adding and policy.attachment == "off":
            raise ValueError("This department does not take documents with a request.")
        if existing + adding > MAX_ATTACHMENTS:
            raise ValueError(
                f"At most {MAX_ATTACHMENTS} documents can be filed with a request."
            )
        if submitting and policy.attachment == "required" and not adding:
            raise ValueError("Attach a document to this request.")

    @staticmethod
    def _answers(
        policy: AttendanceWaiverPolicy, category: Optional[str], reason: Optional[str]
    ) -> Tuple[Optional[str], Optional[str]]:
        """The category and reason, checked against what the policy asks for."""
        category, reason = _clean(category), _clean(reason)
        if category is not None:
            if not policy.categories:
                raise ValueError("This department does not use categories.")
            matches = [
                c for c in policy.categories if c.casefold() == category.casefold()
            ]
            if not matches:
                raise ValueError("Choose one of the department's categories.")
            category = matches[0]
        elif policy.category_required:
            raise ValueError("Choose a category.")
        if policy.reason_text == "off" and reason is not None:
            raise ValueError("This department does not take a written reason.")
        if policy.reason_text == "required" and reason is None:
            raise ValueError("Give a reason.")
        return category, reason

    async def withdraw(
        self, organization_id: str, member: User, request_id: str
    ) -> AttendanceWaiverRequest:
        """Take back the member's own pending request.

        The row stays, marked withdrawn, and frees the session: the member may
        ask again before the deadline, as a new request.
        """
        org_id = str(organization_id)
        request = await self._locked_request(org_id, request_id)
        if str(request.user_id) != str(member.id):
            if await self._may_view(org_id, member, request):
                raise PermissionError("Only the member who asked can withdraw it.")
            raise AttendanceWaiverNotFound("Request not found")
        if request.status != AttendanceWaiverStatus.PENDING:
            raise ValueError(self._settled_message(request))
        request.status = AttendanceWaiverStatus.WITHDRAWN
        request.live_key = None
        self.db.add(self._action(request, AttendanceWaiverAction.WITHDRAWN, member))
        await self._audit(
            "attendance_waiver_request_withdrawn", member, self._ids(request)
        )
        await self.db.commit()
        await self.db.refresh(request)
        await self._archive_prompts(org_id, request)
        return request

    # ------------------------------------------------------------------
    # Decisions
    # ------------------------------------------------------------------

    async def approve(
        self,
        organization_id: str,
        actor: User,
        request_id: str,
        note: Optional[str] = None,
    ) -> AttendanceWaiverRequest:
        org_id = str(organization_id)
        policy = await self.get_policy(org_id)
        request = await self._locked_request(org_id, request_id)
        await self._require_decider(org_id, actor, request, policy)
        if request.status != AttendanceWaiverStatus.PENDING:
            raise ValueError(self._settled_message(request))
        if policy.cap is not None:
            # The member's row is already locked (_locked_request), and this
            # is a locking read of that member's range only, so a second
            # approval for the same member waits and then counts this one,
            # while one for another member does not contend at all (#27).
            others = await self._approved_dates(
                org_id, request.user_id, exclude_id=request.id, lock=True
            )
            used = cap_used(policy.cap_period, others, request.session_date)
            if used >= policy.cap:
                where = _cap_period_label(policy.cap_period, request.session_date)
                raise ValueError(
                    f"Approving this would exceed the department's cap: the "
                    f"member has already had {used} of {policy.cap} waivers "
                    f"approved {where}."
                )
        return await self._decide(
            org_id, actor, request, AttendanceWaiverStatus.APPROVED, note
        )

    async def deny(
        self,
        organization_id: str,
        actor: User,
        request_id: str,
        note: Optional[str] = None,
    ) -> AttendanceWaiverRequest:
        """Deny a pending request. It stays live, so the member cannot ask again."""
        org_id = str(organization_id)
        policy = await self.get_policy(org_id)
        request = await self._locked_request(org_id, request_id)
        await self._require_decider(org_id, actor, request, policy)
        if request.status != AttendanceWaiverStatus.PENDING:
            raise ValueError(self._settled_message(request))
        return await self._decide(
            org_id, actor, request, AttendanceWaiverStatus.DENIED, note
        )

    async def chief_override(
        self, organization_id: str, actor: User, request_id: str, note: Optional[str]
    ) -> AttendanceWaiverRequest:
        """Approve a denied request on the Chief's authority.

        Not blocked by the cap ("the Chief can always override"), but it counts
        toward it from then on. The denial stays in the log beside it.
        """
        org_id = str(organization_id)
        request = await self._locked_request(org_id, request_id)
        if not await self._may_view(org_id, actor, request):
            raise AttendanceWaiverNotFound("Request not found")
        if not holds_chief_position(actor):
            raise PermissionError("Only the Chief can override a denied request.")
        if str(request.user_id) == str(actor.id):
            raise PermissionError("You cannot override a decision on your own request.")
        if request.status != AttendanceWaiverStatus.DENIED:
            raise ValueError("Only a denied request can be overridden.")
        if _clean(note) is None:
            raise ValueError("Give a reason for the override.")
        request.chief_override = True
        return await self._decide(
            org_id,
            actor,
            request,
            AttendanceWaiverStatus.APPROVED,
            note,
            action=AttendanceWaiverAction.CHIEF_OVERRIDE,
        )

    async def _decide(
        self,
        org_id: str,
        actor: User,
        request: AttendanceWaiverRequest,
        status: AttendanceWaiverStatus,
        note: Optional[str],
        *,
        action: Optional[AttendanceWaiverAction] = None,
    ) -> AttendanceWaiverRequest:
        request.status = status
        request.decided_at = _now()
        request.decided_by = str(actor.id)
        chosen = action or (
            AttendanceWaiverAction.APPROVED
            if status == AttendanceWaiverStatus.APPROVED
            else AttendanceWaiverAction.DENIED
        )
        self.db.add(self._action(request, chosen, actor, note))
        await self._audit(
            f"attendance_waiver_request_{chosen.value}",
            actor,
            self._ids(request),
            severity=(
                "warning" if chosen == AttendanceWaiverAction.CHIEF_OVERRIDE else "info"
            ),
        )
        await self.db.commit()
        await self.db.refresh(request)
        await self._archive_prompts(org_id, request)
        await self._notify_member(org_id, request, chosen)
        return request

    async def _require_decider(
        self,
        org_id: str,
        actor: User,
        request: AttendanceWaiverRequest,
        policy: AttendanceWaiverPolicy,
    ) -> None:
        if str(request.user_id) == str(actor.id):
            raise PermissionError("You cannot decide your own request.")
        if not await self.may_decide(actor, request, policy):
            if await self._may_view(org_id, actor, request):
                raise PermissionError("You can no longer decide this request.")
            raise AttendanceWaiverNotFound("Request not found")

    @staticmethod
    def _settled_message(request: AttendanceWaiverRequest) -> str:
        if request.status == AttendanceWaiverStatus.WITHDRAWN:
            return "This request was withdrawn."
        if request.status == AttendanceWaiverStatus.VOIDED:
            return "This request was voided."
        return f"This request has already been {request.status.value}."

    # ------------------------------------------------------------------
    # Routing: who may decide, and who is asked
    # ------------------------------------------------------------------

    async def _pool(self, org_id: str, policy: AttendanceWaiverPolicy) -> _DeciderPool:
        configured: Set[str] = set()
        if policy.approver_position_ids:
            configured = await self._holder_ids(
                org_id, Position.id.in_(list(policy.approver_position_ids))
            )
        chiefs = await self._holder_ids(org_id, Position.slug.in_(CHIEF_POSITION_SLUGS))
        return _DeciderPool(configured=configured, chiefs=chiefs)

    async def _holder_ids(self, org_id: str, position_filter) -> Set[str]:
        """Current active members holding a position matching ``position_filter``."""
        rows = await self.db.execute(
            select(user_positions.c.user_id)
            .join(Position, Position.id == user_positions.c.position_id)
            .join(User, User.id == user_positions.c.user_id)
            .where(
                Position.organization_id == org_id,
                position_filter,
                User.organization_id == org_id,
                User.is_active,
            )
        )
        return {str(r[0]) for r in rows.all()}

    async def _managers(self, org_id: str, pool: _DeciderPool) -> Set[str]:
        if pool.managers is None:
            members = (
                await self.db.execute(
                    select(User)
                    .options(selectinload(User.positions))
                    .where(User.organization_id == org_id, User.is_active)
                )
            ).scalars()
            pool.managers = {
                str(u.id) for u in members if user_has_permission(u, TRAINING_MANAGE)
            }
        return pool.managers

    async def _route_ids(
        self, org_id: str, pool: _DeciderPool, requester_id: str
    ) -> Set[str]:
        """Who a request from ``requester_id`` is routed to: the one definition.

        The chosen positions' holders; when that leaves nobody (vacant, no
        positions chosen, or only the requester), the Chief's; then every
        holder of training.manage. The requester is never routed their own
        request, and a request always reaches someone while anyone else holds
        one of those. ``recipients`` and ``may_decide`` both read this, so who
        is asked and who may answer cannot drift apart.
        """
        requester = str(requester_id)
        if requester not in pool.routed:
            routed: Set[str] = set()
            for step in (pool.configured, pool.chiefs):
                routed = step - {requester}
                if routed:
                    break
            if not routed:
                routed = await self._managers(org_id, pool) - {requester}
            pool.routed[requester] = routed
        return pool.routed[requester]

    async def _may_decide_in(
        self, org_id: str, pool: _DeciderPool, user: User, requester_id: str
    ) -> bool:
        uid = str(user.id)
        if uid == str(requester_id):
            return False
        if uid in pool.configured or uid in pool.chiefs:
            return True
        return uid in await self._route_ids(org_id, pool, requester_id)

    async def may_decide(
        self,
        user: User,
        request: AttendanceWaiverRequest,
        policy: AttendanceWaiverPolicy,
    ) -> bool:
        """Whether ``user`` may approve or deny ``request``.

        Never its requester. Otherwise a current holder of a chosen position,
        a Chief, or anyone the routing chain reached because the chosen
        positions left nobody (see ``_route_ids``).
        """
        org_id = str(request.organization_id)
        pool = await self._pool(org_id, policy)
        return await self._may_decide_in(org_id, pool, user, request.user_id)

    async def recipients(
        self,
        organization_id: str,
        request: AttendanceWaiverRequest,
        policy: AttendanceWaiverPolicy,
    ) -> List[User]:
        org_id = str(organization_id)
        pool = await self._pool(org_id, policy)
        ids = await self._route_ids(org_id, pool, request.user_id)
        if not ids:
            return []
        return list(
            (
                await self.db.execute(
                    select(User)
                    .where(User.id.in_(list(ids)), User.organization_id == org_id)
                    .order_by(User.last_name, User.first_name)
                )
            )
            .scalars()
            .all()
        )

    async def _decidable_requesters(
        self, org_id: str, pool: _DeciderPool, actor: User
    ) -> Optional[Set[str]]:
        """Whose requests ``actor`` may decide: None for everyone but themselves.

        The set form of ``_may_decide_in`` over every requester, so the queue
        can be filtered and paged in SQL. A configured holder or a Chief
        decides everyone's; anyone else only where the chain falls through to
        training managers, which happens for every requester when the chosen
        positions and the Chief's are all vacant, and for the one member who
        holds all of them when that member is the requester.
        """
        uid = str(actor.id)
        if uid in pool.configured or uid in pool.chiefs:
            return None
        if uid not in await self._managers(org_id, pool):
            return set()
        upstream = pool.configured | pool.chiefs
        if not upstream:
            return None
        if len(upstream) == 1:
            return set(upstream)
        return set()

    # ------------------------------------------------------------------
    # Reads
    # ------------------------------------------------------------------

    async def get(
        self, organization_id: str, actor: User, request_id: str
    ) -> AttendanceWaiverRequest:
        """One request, for its member or someone who may decide it."""
        org_id = str(organization_id)
        request = await self._find(org_id, request_id)
        if request is None or not await self._may_view(org_id, actor, request):
            raise AttendanceWaiverNotFound("Request not found")
        return request

    async def list_mine(
        self, organization_id: str, member: User
    ) -> List[AttendanceWaiverRequest]:
        result = await self.db.execute(
            select(AttendanceWaiverRequest)
            .where(
                AttendanceWaiverRequest.organization_id == str(organization_id),
                AttendanceWaiverRequest.user_id == str(member.id),
                AttendanceWaiverRequest.workflow == TRAINING_WORKFLOW,
            )
            .order_by(
                AttendanceWaiverRequest.submitted_at.desc(),
                AttendanceWaiverRequest.id.desc(),
            )
        )
        return list(result.scalars().all())

    async def list_for_decider(
        self,
        organization_id: str,
        actor: User,
        status: Optional[AttendanceWaiverStatus] = None,
        skip: int = 0,
        limit: int = 50,
    ) -> Tuple[List[AttendanceWaiverRequest], int]:
        """The requests ``actor`` may decide or has decided, newest first."""
        org_id = str(organization_id)
        policy = await self.get_policy(org_id)
        pool = await self._pool(org_id, policy)
        requesters = await self._decidable_requesters(org_id, pool, actor)
        if requesters is None:
            decidable = AttendanceWaiverRequest.user_id != str(actor.id)
        elif requesters:
            decidable = AttendanceWaiverRequest.user_id.in_(list(requesters))
        else:
            decidable = false()
        conditions = [
            AttendanceWaiverRequest.organization_id == org_id,
            AttendanceWaiverRequest.workflow == TRAINING_WORKFLOW,
            or_(decidable, AttendanceWaiverRequest.decided_by == str(actor.id)),
        ]
        if status is not None:
            conditions.append(AttendanceWaiverRequest.status == status)
        total = (
            await self.db.execute(
                select(func.count(AttendanceWaiverRequest.id)).where(*conditions)
            )
        ).scalar_one()
        rows = await self.db.execute(
            select(AttendanceWaiverRequest)
            .where(*conditions)
            .order_by(
                AttendanceWaiverRequest.submitted_at.desc(),
                AttendanceWaiverRequest.id.desc(),
            )
            .offset(skip)
            .limit(limit)
        )
        return list(rows.scalars().all()), int(total or 0)

    async def _may_view(
        self, org_id: str, actor: User, request: AttendanceWaiverRequest
    ) -> bool:
        if str(actor.id) in (str(request.user_id), str(request.decided_by or "")):
            return True
        policy = await self.get_policy(org_id)
        return await self.may_decide(actor, request, policy)

    async def describe(
        self,
        organization_id: str,
        viewer: User,
        requests: Sequence[AttendanceWaiverRequest],
        *,
        with_actions: bool = False,
    ) -> List[dict]:
        """Response bodies for ``requests``, as ``viewer`` may act on them."""
        org_id = str(organization_id)
        if not requests:
            return []
        policy = await self.get_policy(org_id)
        pool = await self._pool(org_id, policy)
        is_chief = holds_chief_position(viewer)
        actions: Dict[str, List[AttendanceWaiverRequestAction]] = {}
        if with_actions:
            rows = await self.db.execute(
                select(AttendanceWaiverRequestAction)
                .where(
                    AttendanceWaiverRequestAction.organization_id == org_id,
                    AttendanceWaiverRequestAction.request_id.in_(
                        [str(r.id) for r in requests]
                    ),
                )
                .order_by(AttendanceWaiverRequestAction.created_at)
            )
            for row in rows.scalars().all():
                actions.setdefault(str(row.request_id), []).append(row)
            # DATETIME keeps whole seconds, so a submission and a decision in
            # the same second tie; the lifecycle's own order breaks it.
            for log in actions.values():
                log.sort(key=lambda a: (_utc(a.created_at), _ACTION_ORDER[a.action]))
        files: Dict[str, List[AttendanceWaiverAttachment]] = {}
        file_rows = await self.db.execute(
            select(AttendanceWaiverAttachment)
            .where(
                AttendanceWaiverAttachment.organization_id == org_id,
                AttendanceWaiverAttachment.request_id.in_(
                    [str(r.id) for r in requests]
                ),
            )
            .order_by(AttendanceWaiverAttachment.ordinal)
        )
        for file in file_rows.scalars().all():
            files.setdefault(str(file.request_id), []).append(file)
        names = await self._names(
            org_id,
            [r.user_id for r in requests]
            + [r.decided_by for r in requests if r.decided_by]
            + [a.actor_id for rows_ in actions.values() for a in rows_ if a.actor_id],
        )
        bodies = []
        for r in requests:
            own = str(r.user_id) == str(viewer.id)
            decider = await self._may_decide_in(org_id, pool, viewer, r.user_id)
            bodies.append(
                {
                    "id": str(r.id),
                    "workflow": r.workflow.value,
                    "user_id": str(r.user_id),
                    "member_name": names.get(str(r.user_id)),
                    "event_id": str(r.event_id) if r.event_id else None,
                    "event_title": r.event_title_snapshot,
                    "event_start": r.event_start_snapshot,
                    "session_date": r.session_date,
                    "status": r.status.value,
                    "category": r.category,
                    "reason": r.reason,
                    "submitted_at": r.submitted_at,
                    "decided_at": r.decided_at,
                    "decided_by": str(r.decided_by) if r.decided_by else None,
                    "decided_by_name": (
                        names.get(str(r.decided_by)) if r.decided_by else None
                    ),
                    "chief_override": bool(r.chief_override),
                    "can_withdraw": own and r.status == AttendanceWaiverStatus.PENDING,
                    "can_decide": decider
                    and r.status == AttendanceWaiverStatus.PENDING,
                    "can_override": is_chief
                    and not own
                    and r.status == AttendanceWaiverStatus.DENIED,
                    "can_attach": own
                    and r.status == AttendanceWaiverStatus.PENDING
                    and policy.attachment != "off"
                    and len(files.get(str(r.id), [])) < MAX_ATTACHMENTS,
                    "attachments": [
                        {
                            "id": str(f.id),
                            "ordinal": f.ordinal,
                            "filename": f.download_name,
                            "mime_type": f.mime_type,
                            "file_size": f.file_size,
                            "uploaded_at": f.uploaded_at,
                        }
                        for f in files.get(str(r.id), [])
                    ],
                    "actions": [
                        {
                            "id": str(a.id),
                            "action": a.action.value,
                            "actor_id": str(a.actor_id) if a.actor_id else None,
                            "actor_name": (
                                names.get(str(a.actor_id)) if a.actor_id else None
                            ),
                            "note": a.note,
                            "created_at": a.created_at,
                        }
                        for a in actions.get(str(r.id), [])
                    ],
                }
            )
        return bodies

    async def _names(self, org_id: str, user_ids: Iterable[str]) -> Dict[str, str]:
        ids = list({str(u) for u in user_ids if u})
        if not ids:
            return {}
        rows = await self.db.execute(
            select(User).where(User.id.in_(ids), User.organization_id == org_id)
        )
        return {str(u.id): u.display_name for u in rows.scalars().all()}

    # ------------------------------------------------------------------
    # Loading and locking
    # ------------------------------------------------------------------

    async def _event(self, org_id: str, event_id: str) -> Event:
        event: Optional[Event] = (
            await self.db.execute(
                select(Event).where(
                    Event.id == str(event_id), Event.organization_id == org_id
                )
            )
        ).scalar_one_or_none()
        # A draft is not shown to members, so it is not there to ask about.
        if event is None or event.is_draft:
            raise AttendanceWaiverNotFound("Session not found")
        return event

    async def _member(self, org_id: str, user_id: str) -> User:
        member: Optional[User] = (
            await self.db.execute(
                select(User)
                .options(selectinload(User.positions))
                .where(User.id == str(user_id), User.organization_id == org_id)
            )
        ).scalar_one_or_none()
        if member is None:
            raise AttendanceWaiverNotFound("Member not found")
        return member

    async def _lock_member(self, org_id: str, user_id: str) -> User:
        """Lock the member's ``users`` row: the parent every write contends for."""
        member: Optional[User] = (
            await self.db.execute(
                select(User)
                .options(selectinload(User.positions))
                .where(User.id == str(user_id), User.organization_id == org_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if member is None:
            raise AttendanceWaiverNotFound("Member not found")
        return member

    async def _find(
        self, org_id: str, request_id: str
    ) -> Optional[AttendanceWaiverRequest]:
        found: Optional[AttendanceWaiverRequest] = (
            await self.db.execute(
                select(AttendanceWaiverRequest).where(
                    AttendanceWaiverRequest.id == str(request_id),
                    AttendanceWaiverRequest.organization_id == org_id,
                )
            )
        ).scalar_one_or_none()
        return found

    async def _locked_request(
        self, org_id: str, request_id: str
    ) -> AttendanceWaiverRequest:
        """The request, locked, after its requester's row (see the lock order)."""
        peek = await self._find(org_id, request_id)
        if peek is None:
            raise AttendanceWaiverNotFound("Request not found")
        await self._lock_member(org_id, peek.user_id)
        locked: Optional[AttendanceWaiverRequest] = (
            await self.db.execute(
                select(AttendanceWaiverRequest)
                .where(
                    AttendanceWaiverRequest.id == str(request_id),
                    AttendanceWaiverRequest.organization_id == org_id,
                )
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if locked is None:
            raise AttendanceWaiverNotFound("Request not found")
        return locked

    # ------------------------------------------------------------------
    # Log, audit and notices
    # ------------------------------------------------------------------

    @staticmethod
    def _action(
        request: AttendanceWaiverRequest,
        action: AttendanceWaiverAction,
        actor: User,
        note: Optional[str] = None,
    ) -> AttendanceWaiverRequestAction:
        return AttendanceWaiverRequestAction(
            id=generate_uuid(),
            organization_id=str(request.organization_id),
            request_id=str(request.id),
            action=action,
            actor_id=str(actor.id),
            note=_clean(note),
            created_at=_now(),
        )

    @staticmethod
    def _ids(request: AttendanceWaiverRequest) -> dict:
        # Ids and the date only: the reason and notes may be medical, and the
        # category can say as much (#33).
        return {
            "request_id": str(request.id),
            "workflow": request.workflow.value,
            "member_id": str(request.user_id),
            "event_id": str(request.event_id) if request.event_id else None,
            "session_date": request.session_date.isoformat(),
        }

    async def _audit(
        self, event_type: str, actor: User, data: dict, severity: str = "info"
    ) -> None:
        await log_audit_event(
            db=self.db,
            event_type=event_type,
            event_category="training",
            severity=severity,
            event_data=data,
            user_id=str(actor.id),
            username=actor.username,
        )

    async def _prompt_deciders(
        self,
        org_id: str,
        request: AttendanceWaiverRequest,
        member: User,
        policy: AttendanceWaiverPolicy,
    ) -> None:
        """In-app prompts for everyone the request is routed to.

        After the commit, and never allowed to fail the request: the member's
        request stands whether or not the bell could be rung.
        """
        try:
            recipients = await self.recipients(org_id, request, policy)
            if not recipients:
                return
            name = (await self._names(org_id, [member.id])).get(
                str(member.id), "A member"
            )
            title = request.event_title_snapshot
            day = _day_label(request.session_date)
            for recipient in recipients:
                self.db.add(
                    NotificationLog(
                        id=generate_uuid(),
                        organization_id=org_id,
                        recipient_id=str(recipient.id),
                        channel=NotificationChannel.IN_APP,
                        category=REVIEW_PROMPT_CATEGORY,
                        subject=f"Waiver request — {name}, {title}",
                        # No reason or category: they may be medical, and a
                        # notification is stored in plain text.
                        message=(
                            f'{name} asked to be excused from "{title}" on {day}. '
                            "Open the request to approve or deny it."
                        ),
                        action_url=decider_action_url(request),
                        notification_metadata={
                            PROMPT_METADATA_KEY: str(request.id),
                            "event_id": (
                                str(request.event_id) if request.event_id else None
                            ),
                        },
                        delivered=True,
                    )
                )
            await self.db.commit()
        except Exception:
            logger.exception(
                "Failed to prompt deciders for waiver request {}", request.id
            )
            await self._recover(request)

    async def _archive_prompts(
        self, org_id: str, request: AttendanceWaiverRequest
    ) -> None:
        # Nothing is left to decide, so every decider's prompt goes at once.
        await NotificationsService(self.db).archive_related_notifications(
            org_id, REVIEW_PROMPT_CATEGORY, PROMPT_METADATA_KEY, str(request.id)
        )

    async def _notify_member(
        self,
        org_id: str,
        request: AttendanceWaiverRequest,
        action: AttendanceWaiverAction,
    ) -> None:
        try:
            title = request.event_title_snapshot
            day = _day_label(request.session_date)
            if action == AttendanceWaiverAction.CHIEF_OVERRIDE:
                subject = f"Waiver request approved on review — {title}"
                outcome = "was approved by the Chief on review"
            elif action == AttendanceWaiverAction.APPROVED:
                subject = f"Waiver request approved — {title}"
                outcome = "was approved"
            else:
                subject = f"Waiver request not approved — {title}"
                outcome = "was not approved"
            self.db.add(
                NotificationLog(
                    id=generate_uuid(),
                    organization_id=org_id,
                    recipient_id=str(request.user_id),
                    channel=NotificationChannel.IN_APP,
                    category=MEMBER_UPDATE_CATEGORY,
                    subject=subject,
                    # The decider's note is left to the request page: it is
                    # stored encrypted there, and this row is plain text.
                    message=(
                        f'Your request to be excused from "{title}" on {day} '
                        f"{outcome}."
                    ),
                    action_url=member_action_url(request),
                    notification_metadata={PROMPT_METADATA_KEY: str(request.id)},
                    delivered=True,
                )
            )
            await self.db.commit()
        except Exception:
            logger.exception(
                "Failed to notify the member of waiver request {}", request.id
            )
            await self._recover(request)

    async def _recover(self, request: AttendanceWaiverRequest) -> None:
        """Reset the session after a failed notice, keeping ``request`` usable.

        A rollback expires every loaded instance, and the endpoint still has
        to serialize the request; reading an expired attribute in an async
        session raises rather than lazy-loading.
        """
        try:
            await self.db.rollback()
            await self.db.refresh(request)
        except Exception:
            logger.exception("Failed to reload waiver request {}", request.id)


def attachment_row(
    request: AttendanceWaiverRequest, ordinal: int, file: StoredFile, uploader_id: str
) -> AttendanceWaiverAttachment:
    """The row for a document stored under ``request``. The uploader's
    filename is deliberately not copied from ``file`` (see the model)."""
    return AttendanceWaiverAttachment(
        id=generate_uuid(),
        organization_id=str(request.organization_id),
        request_id=str(request.id),
        ordinal=ordinal,
        file_path=file.path,
        mime_type=file.mime_type,
        file_size=file.size,
        sha256=file.sha256,
        uploaded_by=uploader_id,
        uploaded_at=_now(),
    )


def decider_action_url(request: AttendanceWaiverRequest) -> str:
    """Where a decider's prompt leads: the request's own page."""
    return f"/attendance-waivers/{request.id}"


def member_action_url(request: AttendanceWaiverRequest) -> str:
    """Where the member's notice leads: the session, or their list once the
    event is gone."""
    if request.event_id:
        return f"/events/{request.event_id}"
    return "/training/my-training"


def _day_label(day: date) -> str:
    return f"{calendar.month_name[day.month]} {day.day}, {day.year}"
