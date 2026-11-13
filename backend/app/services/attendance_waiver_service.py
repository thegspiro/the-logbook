"""
Attendance waiver requests: the request engine, and its two workflows.

A member asks to be excused from one session that counts against them; an
approver decides (owner decisions, 2026-11-10). There is one engine and two
policies: ``WorkflowSpec`` says what differs between the training workflow
and the business-meeting one (where the policy is stored, which events can be
asked about, who the routing falls back to), and everything else below is
written once for both (CLAUDE.md pitfall #29). The rules:

- **Off until an officer saves a policy.** The training policy lives in
  ``organizations.settings["training"]["session_waiver_policy"]`` and the
  meeting one in ``organizations.settings["meetings"]["waiver_policy"]``; both
  are read through ``policy_from_settings``, so a missing or malformed value
  is the disabled default (CLAUDE.md pitfall #19).
- **Only a session that counts against the member.** For training, a
  TRAINING event, not cancelled, whose training session is linked to a
  SESSION_ATTENDANCE requirement that grades this member
  (``ComplianceGrading.for_member``); a member exempt from compliance has
  nothing to excuse. For meetings, a BUSINESS_MEETING event, not cancelled,
  that no leave of absence already excuses and the Secretary has not already
  waived. Either way a member who checked in has nothing to excuse.
- **One live request per member and session**, enforced by the unique
  ``live_key``. Withdrawing frees it; a denial does not.
- **A deadline the department chooses**, compared in UTC.
- **An optional cap**, per calendar year or any rolling 12 months, counting
  approved requests by session date. Pending requests do not count, so the cap
  is enforced when a request is approved, under a lock (pitfall #27). A
  Chief's override is not blocked by it, but counts toward it.
- **Routing**: the holders of the chosen positions; failing them, the
  workflow's fallback office (the Chief for training, the Secretary for
  meetings); failing that, the holders of the workflow's manage permission.
  A Chief or a President may always decide. Never the requester.
  ``_route_ids`` is the one definition, read by both the recipients and
  ``may_decide``.
- **The Chief's and the President's own requests** (owner decision,
  2026-11-13) skip that chain: each is decided by the holders of the other
  office, and when that office is vacant by the member the policy names as
  ``chief_alternate_user_id``. With neither, the request cannot be submitted
  (``_officer_route``), because nobody could decide it.
- **The first decision is final**, except that a Chief may override a denial,
  with a reason, and never on their own request.
- **CC positions are informed, never asked.** After a final decision the
  holders of the policy's ``cc_position_ids`` get the outcome, without the
  reason, category or note (``_copy_decision``); they cannot open the request.

**Lock order.** Every write locks the requester's ``users`` row before the
request row. Submitting has to take the member's row first (there is no request
row yet), so the decisions do the same; taking them in the other order would
let an approval and a submission by the same member deadlock. Where a write
also needs the event, it takes it between the two, shared: submitting (so a
cancellation cannot slip between the check and the insert) and approving a
meeting request (so ``MeetingsService.create_from_event``, which holds the
event exclusively while it builds the minutes record, either sees the approval
or is seen by it). The writers that lock the event exclusively (cancelling,
deleting, building the minutes record) never take a ``users`` row, so the
order cannot cycle.

**No gap lock another member's write needs.** The member's row serializes only
that member's writes, so any range a write locks must be that member's alone:
a gap shared with another member is held by both and blocks both inserts, and
InnoDB kills one with a 1213. Submitting therefore takes no locking read of the
requests at all (``_assess``), and the approval's cap count is pinned to the
member's own index range (``_approved_dates``).

Approved training requests reach grading through the waiver loaders as
``SOURCE_SESSION_EXCUSAL`` (``training_waiver_service``); nothing here touches
a grader. An approved meeting request is written onto the minutes record as
the ``MeetingAttendee`` waiver the Secretary grants by hand
(``grant_meeting_waiver``), with a standard text rather than the member's
words, and carried onto a minutes record created later by
``MeetingsService.create_from_event``.
"""

import calendar
import copy
import html
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from datetime import timezone as dt_timezone
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple
from zoneinfo import ZoneInfo

from loguru import logger
from sqlalchemy import and_, false, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.dependencies import user_has_permission
from app.core.audit import log_audit_event
from app.core.config import settings as app_settings
from app.core.constants import (
    CHIEF_POSITION_SLUGS,
    PRESIDENT_POSITION_SLUGS,
    SECRETARY_POSITION_SLUGS,
)
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
from app.models.meeting import Meeting, MeetingAttendee
from app.models.notification import NotificationChannel, NotificationLog
from app.models.training import (
    TrainingRecord,
    TrainingRequirement,
    TrainingSession,
    TrainingSessionRequirement,
    TrainingStatus,
)
from app.models.user import (
    MemberLeaveOfAbsence,
    Organization,
    Position,
    User,
    user_positions,
)
from app.schemas.attendance_waiver import (
    MAX_ATTACHMENTS,
    MAX_TEXT_LENGTH,
    MEETING_POLICY_KEY,
    MEETING_POLICY_SECTION,
    POLICY_KEY,
    POLICY_SECTION,
    AttendanceWaiverPolicy,
    CapPeriod,
    policy_from_settings,
)
from app.services.email_policy import (
    EmailKind,
    department_required_kinds,
    member_receives_email,
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
from app.utils.org_timezone import (
    local_date,
    local_day_start_utc,
    resolve_scheduling_timezone,
    to_local,
)

TRAINING_WORKFLOW = AttendanceWaiverWorkflow.TRAINING_SESSION
MEETING_WORKFLOW = AttendanceWaiverWorkflow.BUSINESS_MEETING
# The (organization, member, date) index; the cap's locking read is pinned to
# it (see _approved_dates).
MEMBER_INDEX = "ix_attendance_waiver_requests_org_user_date"
# The last step of each routing chain.
TRAINING_MANAGE = "training.manage"
MEETINGS_MANAGE = "meetings.manage"

# What an approved meeting request writes into ``meeting_attendees``. Never
# the member's own words: that column is plain text and is shown on the
# voting and ballot screens, while the member's reason stays encrypted on the
# request.
MEETING_WAIVER_TEXT = "Excused: approved request"

# In-app categories. Metadata carries waiver_request_id so every decider's
# prompt can be archived once any one of them decides.
REVIEW_PROMPT_CATEGORY = "attendance_waiver_request"
MEMBER_UPDATE_CATEGORY = "attendance_waiver_update"
# A final decision copied to the holders of the policy's CC positions. Not
# archived with the prompts: it is a record of the outcome, not a task.
CC_NOTICE_CATEGORY = "attendance_waiver_cc"
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
    AttendanceWaiverAction.INFO_REQUESTED: 1,
    AttendanceWaiverAction.MEMBER_RESPONDED: 1,
    AttendanceWaiverAction.RESCHEDULED: 1,
    AttendanceWaiverAction.MEMBER_CONFIRMED: 1,
    AttendanceWaiverAction.EXPIRED: 3,
}


class AttendanceWaiverNotFound(LookupError):
    """The event or request does not exist for this caller in their organization."""


@dataclass(frozen=True)
class WorkflowSpec:
    """What differs between the two workflows; everything else is shared."""

    workflow: AttendanceWaiverWorkflow
    # Where the policy is stored: settings[policy_section][policy_key].
    policy_section: str
    policy_key: str
    # The only kind of event a request can be about.
    event_type: EventType
    # The routing chain's step after the chosen positions, and its last step.
    fallback_slugs: Tuple[str, ...]
    manage_permission: str
    audit_category: str
    # Words for the refusals and notices.
    session_noun: str
    default_title: str
    # Where a decider's prompt leads, before the request id.
    decider_path: str
    # Where the member's notice leads once the event is gone.
    member_fallback_url: str
    # The email-preference kinds a decider's and a member's notices are sent
    # under (CLAUDE.md pitfall #18: the email goes with the in-app row).
    decider_email_kind: EmailKind
    member_email_kind: EmailKind


TRAINING_SPEC = WorkflowSpec(
    workflow=TRAINING_WORKFLOW,
    policy_section=POLICY_SECTION,
    policy_key=POLICY_KEY,
    event_type=EventType.TRAINING,
    fallback_slugs=tuple(CHIEF_POSITION_SLUGS),
    manage_permission=TRAINING_MANAGE,
    audit_category="training",
    session_noun="training session",
    default_title="Training session",
    decider_path="/attendance-waivers",
    member_fallback_url="/training/my-training",
    decider_email_kind=EmailKind.TRAINING_DUTIES,
    member_email_kind=EmailKind.TRAINING_REMINDERS,
)

MEETING_SPEC = WorkflowSpec(
    workflow=MEETING_WORKFLOW,
    policy_section=MEETING_POLICY_SECTION,
    policy_key=MEETING_POLICY_KEY,
    event_type=EventType.BUSINESS_MEETING,
    fallback_slugs=tuple(SECRETARY_POSITION_SLUGS),
    manage_permission=MEETINGS_MANAGE,
    audit_category="meetings",
    session_noun="business meeting",
    default_title="Business meeting",
    decider_path="/meetings/waiver-requests",
    member_fallback_url="/events",
    decider_email_kind=EmailKind.EVENT_DUTIES,
    member_email_kind=EmailKind.EVENT_CHANGES,
)

SPECS: Dict[AttendanceWaiverWorkflow, WorkflowSpec] = {
    TRAINING_WORKFLOW: TRAINING_SPEC,
    MEETING_WORKFLOW: MEETING_SPEC,
}


def meeting_waiver_text(category: Optional[str]) -> str:
    """The waiver reason an approved meeting request writes: standard words
    and the department's own category label, never the member's reason."""
    return f"{MEETING_WAIVER_TEXT} ({category})" if category else MEETING_WAIVER_TEXT


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


# An undecided request closes on its own (owner decision, 2026-11-13): "seven
# days from the day of the event".
EXPIRY_DAYS = 7
# The latest deadline a department can choose; expiry never comes before it.
EXPIRY_DEADLINE_PRESET = "7d_after_end"


def expires_at_for(
    session_date: date, tz: ZoneInfo, event: Optional[Event]
) -> datetime:
    """The instant a still-pending request for this session expires, in UTC.

    The one definition, read by the expiry sweep and by every response
    (``expires_at``), so no screen works it out for itself (pitfall #29). It
    is the later of the end of the seventh day after the session on the
    department's calendar (the next local midnight, so a DST day is bounded by
    the calendar, not by arithmetic) and the moment a ``7d_after_end``
    deadline would close for the event, while the event exists: the second
    term means a request can never expire while it could still be submitted,
    which matters for a session that runs past its own start date.
    """
    day_end = local_day_start_utc(session_date + timedelta(days=EXPIRY_DAYS + 1), tz)
    if event is None:
        return day_end
    return max(day_end, deadline_for(EXPIRY_DEADLINE_PRESET, event))


def _cap_period_label(period: CapPeriod, day: date, noun: str = "session") -> str:
    """Where the cap is counted for a session on ``day``, for a sentence."""
    if period == "rolling_12_months":
        return f"in a 12-month span that includes this {noun}"
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

    ``configured``, ``fallback`` (the workflow's fallback office: the Chief
    for training, the Secretary for meetings) and ``chiefs`` are current
    active holders; ``managers`` (holders of the workflow's manage
    permission) is loaded only when the chain falls through to it.
    """

    configured: Set[str]
    fallback: Set[str]
    chiefs: Set[str]
    managers: Optional[Set[str]] = None
    # The routed set per requester, so a page of requests routes each
    # requester once.
    routed: Dict[str, Set[str]] = field(default_factory=dict)
    # Current active holders of the President's office.
    presidents: Set[str] = field(default_factory=set)
    # The policy's named alternate, only while they are a current member.
    alternate: Optional[str] = None


def _officer_route(pool: _DeciderPool, requester_id: str) -> Optional[Set[str]]:
    """Who decides a request from the Chief or the President; None for anyone else.

    Owner decision, 2026-11-13: the Chief's own request goes to the President,
    the President's to the Chief, and the department's chosen positions and
    fallbacks do not apply. A member holding both offices is decided by any
    other holder of either. When the other office has no holder but the
    requester, the policy's named alternate decides; an empty set means nobody
    can, and submitting is refused (``_no_decider_refusal``).
    """
    requester = str(requester_id)
    is_chief = requester in pool.chiefs
    is_president = requester in pool.presidents
    if not (is_chief or is_president):
        return None
    other: Set[str] = set()
    if is_chief:
        other |= pool.presidents
    if is_president:
        other |= pool.chiefs
    other.discard(requester)
    if other:
        return other
    if pool.alternate and pool.alternate != requester:
        return {pool.alternate}
    return set()


class AttendanceWaiverService:
    """The engine, bound to one workflow.

    Every read and write is confined to ``workflow``: a request of the other
    workflow is not found, and the cap counts only this workflow's approvals.
    """

    def __init__(
        self,
        db: AsyncSession,
        workflow: AttendanceWaiverWorkflow = TRAINING_WORKFLOW,
    ):
        self.db = db
        self.spec = SPECS[workflow]
        self.workflow = workflow

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
        section = (
            settings.get(self.spec.policy_section)
            if isinstance(settings, dict)
            else None
        )
        raw = section.get(self.spec.policy_key) if isinstance(section, dict) else None
        return policy_from_settings(raw)

    async def save_policy(
        self, organization_id: str, policy: AttendanceWaiverPolicy, actor: User
    ) -> AttendanceWaiverPolicy:
        org_id = str(organization_id)
        await assert_all_in_org(
            self.db, Position, policy.approver_position_ids, org_id, label="position"
        )
        await assert_all_in_org(
            self.db, Position, policy.cc_position_ids, org_id, label="copy-to position"
        )
        if policy.chief_alternate_user_id and (
            await self._current_member_id(org_id, policy.chief_alternate_user_id)
            is None
        ):
            raise ValueError(
                "The alternate who decides the Chief's or President's own "
                "request must be a current member of the department."
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
        section = settings.get(self.spec.policy_section)
        if not isinstance(section, dict):
            section = {}
        section[self.spec.policy_key] = policy.model_dump(mode="json")
        settings[self.spec.policy_section] = section
        organization.settings = settings
        await self._audit(
            "attendance_waiver_policy_updated",
            actor,
            {
                "workflow": self.workflow.value,
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
                "cc_position_ids": list(policy.cc_position_ids),
                "chief_alternate_user_id": policy.chief_alternate_user_id,
            },
        )
        await self.db.commit()
        return policy

    async def alternate_options(self, organization_id: str) -> dict:
        """The members the policy may name as the Chief's and President's
        alternate, and the stored alternate with whether they still qualify.

        The stored one is reported even once they are no longer current (and
        so absent from ``members``), so the screen can say who was named and
        warn that nobody stands in for a vacant office.
        """
        org_id = str(organization_id)
        members = (
            (
                await self.db.execute(
                    select(User)
                    .where(User.organization_id == org_id, User.is_active)
                    .order_by(User.last_name, User.first_name, User.id)
                )
            )
            .scalars()
            .all()
        )
        policy = await self.get_policy(org_id)
        stored = None
        if policy.chief_alternate_user_id:
            alternate_id = policy.chief_alternate_user_id
            name = (await self._names(org_id, [alternate_id])).get(alternate_id)
            stored = {
                "id": alternate_id,
                "name": name,
                "current": any(str(m.id) == alternate_id for m in members),
            }
        return {
            "members": [{"id": str(m.id), "name": m.display_name} for m in members],
            "alternate": stored,
        }

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

        noun = self.spec.session_noun
        if not policy.enabled:
            return refuse(
                "disabled",
                f"This department does not take requests to be excused from "
                f"{noun}s.",
            )
        if event.event_type != self.spec.event_type:
            code = (
                "not_training"
                if self.workflow == TRAINING_WORKFLOW
                else ("not_meeting")
            )
            return refuse(code, f"Only a {noun} can be excused.")
        if event.is_cancelled:
            return refuse("cancelled", f"This {noun} was cancelled.")
        if self.workflow == TRAINING_WORKFLOW:
            if member.compliance_exempt:
                return refuse(
                    "exempt",
                    "You are exempt from training requirements, so this session "
                    "does not count against you.",
                )
            if not await self._counting_requirements(org_id, member, event):
                return refuse(
                    "not_counted",
                    "This session does not count toward an attendance "
                    "requirement that applies to you.",
                )
        else:
            if await self._on_leave(org_id, member.id, session_day):
                return refuse(
                    "on_leave",
                    "You are on a leave of absence that covers this meeting, so "
                    "it does not count against you.",
                )
        if existing is not None:
            return refuse(
                "already_requested",
                f"You have already asked to be excused from this {noun}.",
            )
        if await self._checked_in(org_id, member.id, event.id):
            return refuse(
                "checked_in",
                f"You checked in to this {noun}, so it already counts as attended.",
            )
        if self.workflow == MEETING_WORKFLOW and await self._meeting_waived(
            org_id, member.id, event.id
        ):
            return refuse(
                "already_excused",
                "The Secretary has already excused you from this meeting.",
            )
        if _now() >= deadline:
            return refuse(
                "deadline_passed",
                f"The deadline to ask about this {noun} has passed.",
            )
        if result.cap_remaining == 0:
            return refuse(
                "no_waivers_left",
                f"You have used all {policy.cap} of your waivers "
                f"{_cap_period_label(policy.cap_period, session_day, noun)}.",
            )
        undecidable = await self._no_decider_refusal(org_id, member.id, policy)
        if undecidable is not None:
            return refuse("no_decider", undecidable)
        result.allowed = True
        return result

    async def _no_decider_refusal(
        self, org_id: str, member_id: str, policy: AttendanceWaiverPolicy
    ) -> Optional[str]:
        """Why nobody could decide the member's request, or None.

        Only the Chief's and the President's own requests can reach nobody
        (``_officer_route``); anyone else's falls through to the managers.
        """
        pool = await self._pool(org_id, policy)
        route = _officer_route(pool, member_id)
        if route is None or route:
            return None
        requester = str(member_id)
        if requester in pool.chiefs and requester in pool.presidents:
            vacant = "other Chief or President"
        elif requester in pool.chiefs:
            vacant = "President"
        else:
            vacant = "Chief"
        return (
            f"No one can decide this request: your department has no {vacant} "
            "and no alternate is named in the waiver settings. Ask an officer "
            "to name one."
        )

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
        """A check-in or an officer's attendance override; for training also a
        credited record, for a meeting also being marked present on its
        minutes record."""
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
        if self.workflow == MEETING_WORKFLOW:
            present = (
                await self.db.execute(
                    select(MeetingAttendee.id)
                    .join(Meeting, Meeting.id == MeetingAttendee.meeting_id)
                    .where(
                        Meeting.organization_id == org_id,
                        Meeting.event_id == str(event_id),
                        MeetingAttendee.organization_id == org_id,
                        MeetingAttendee.user_id == str(user_id),
                        MeetingAttendee.present.is_(True),
                    )
                    .limit(1)
                )
            ).scalar_one_or_none()
            return present is not None
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

    async def _on_leave(self, org_id: str, user_id: str, day: date) -> bool:
        """Whether an active leave of absence covers ``day``.

        The same rule ``tally_attendance`` excludes a meeting by: such a
        meeting already does not count against the member.
        """
        leave = (
            await self.db.execute(
                select(MemberLeaveOfAbsence.id)
                .where(
                    MemberLeaveOfAbsence.organization_id == org_id,
                    MemberLeaveOfAbsence.user_id == str(user_id),
                    MemberLeaveOfAbsence.active.is_(True),
                    MemberLeaveOfAbsence.start_date <= day,
                    or_(
                        MemberLeaveOfAbsence.end_date.is_(None),
                        MemberLeaveOfAbsence.end_date >= day,
                    ),
                )
                .limit(1)
            )
        ).scalar_one_or_none()
        return leave is not None

    async def _meeting_waived(self, org_id: str, user_id: str, event_id: str) -> bool:
        """Whether the meeting's minutes record already carries a waiver."""
        waived = (
            await self.db.execute(
                select(MeetingAttendee.id)
                .join(Meeting, Meeting.id == MeetingAttendee.meeting_id)
                .where(
                    Meeting.organization_id == org_id,
                    Meeting.event_id == str(event_id),
                    MeetingAttendee.organization_id == org_id,
                    MeetingAttendee.user_id == str(user_id),
                    MeetingAttendee.waiver_reason.is_not(None),
                )
                .limit(1)
            )
        ).scalar_one_or_none()
        return waived is not None

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
                    == live_key_for(self.workflow.value, str(event_id), str(user_id)),
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
            if row.workflow == self.workflow
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
        await self._event(org_id, event_id)
        # Two submissions by one member queue here. The second's plain reads
        # may still miss the first's request (a snapshot from before the
        # lock); the unique live_key then refuses its insert below.
        locked = await self._lock_member(org_id, member.id)
        # Shared, after the member's row (see the lock order): a cancellation
        # holds the event exclusively, so it either lands before this read,
        # which then refuses, or waits for this insert and voids it.
        event = await self._event(org_id, event_id, lock=True)
        assessment = await self._assess(org_id, locked, event, policy)
        if not assessment.allowed:
            raise ValueError(assessment.refusal)
        category, reason = self._answers(policy, category, reason)
        self.check_attachments(policy, len(stored), submitting=True)

        request = AttendanceWaiverRequest(
            id=request_id or generate_uuid(),
            organization_id=org_id,
            workflow=self.workflow,
            user_id=str(member.id),
            event_id=str(event.id),
            event_title_snapshot=(event.title or self.spec.default_title)[:255],
            event_start_snapshot=_utc(event.start_datetime),
            session_date=assessment.session_date,
            status=AttendanceWaiverStatus.PENDING,
            live_key=live_key_for(self.workflow.value, str(event.id), member.id),
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
            raise ValueError(
                f"You have already asked to be excused from this "
                f"{self.spec.session_noun}."
            )
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
        # Declining a moved session is withdrawing it.
        request.reconfirm_requested_at = None
        request.status = AttendanceWaiverStatus.WITHDRAWN
        request.live_key = None
        # Nothing is left to answer once the request is taken back.
        request.info_requested_at = None
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
        request = await self._locked_request(org_id, request_id, grant=True)
        await self._require_decider(org_id, actor, request, policy)
        if request.status != AttendanceWaiverStatus.PENDING:
            raise ValueError(self._settled_message(request))
        self._refuse_while_reconfirming(request)
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
        self._refuse_while_reconfirming(request)
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
        request = await self._locked_request(org_id, request_id, grant=True)
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
        # A decider may decide without waiting for the answer; the question
        # stays in the log, but nothing waits on the member any more.
        request.info_requested_at = None
        chosen = action or (
            AttendanceWaiverAction.APPROVED
            if status == AttendanceWaiverStatus.APPROVED
            else AttendanceWaiverAction.DENIED
        )
        self.db.add(self._action(request, chosen, actor, note))
        if (
            self.workflow == MEETING_WORKFLOW
            and status == AttendanceWaiverStatus.APPROVED
        ):
            await grant_meeting_waiver(self.db, org_id, request, actor_id=str(actor.id))
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
        await self._copy_decision(org_id, request, actor, chosen)
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
        if request.status == AttendanceWaiverStatus.EXPIRED:
            return "This request was not decided in time and has closed."
        return f"This request has already been {request.status.value}."

    # ------------------------------------------------------------------
    # Asking the member for more information
    # ------------------------------------------------------------------

    @staticmethod
    def may_ask(request: AttendanceWaiverRequest) -> bool:
        """Whether ``request`` is in a state a decider may put a question to.

        Pending, with no question already open and not waiting on the member
        to reconfirm a moved session: one question at a time, and the member
        has only one thing to answer at once. Who may ask is ``may_decide``.
        """
        return (
            request.status == AttendanceWaiverStatus.PENDING
            and request.info_requested_at is None
            and request.reconfirm_requested_at is None
        )

    async def request_info(
        self,
        organization_id: str,
        actor: User,
        request_id: str,
        question: Optional[str],
    ) -> AttendanceWaiverRequest:
        """A decider asks the member a question; the request stays pending.

        The question is the ``INFO_REQUESTED`` action's note, encrypted like
        every note. The deciders' prompts are archived, since the next move is
        the member's; answering prompts them again (``respond``).
        """
        org_id = str(organization_id)
        policy = await self.get_policy(org_id)
        request = await self._locked_request(org_id, request_id)
        await self._require_decider(org_id, actor, request, policy)
        if request.status != AttendanceWaiverStatus.PENDING:
            raise ValueError(self._settled_message(request))
        if request.reconfirm_requested_at is not None:
            raise ValueError(
                "This request is waiting for the member to confirm the new date."
            )
        if request.info_requested_at is not None:
            raise ValueError("A question is already waiting on the member's answer.")
        text = self._message(question, "Write the question to ask the member.")
        request.info_requested_at = _now()
        self.db.add(
            self._action(request, AttendanceWaiverAction.INFO_REQUESTED, actor, text)
        )
        await self._audit(
            "attendance_waiver_request_info_requested", actor, self._ids(request)
        )
        await self.db.commit()
        await self.db.refresh(request)
        await self._archive_prompts(org_id, request)
        await self._notify_member_asked(org_id, request, actor)
        return request

    async def respond(
        self,
        organization_id: str,
        member: User,
        request_id: str,
        answer: Optional[str],
    ) -> AttendanceWaiverRequest:
        """The member answers the open question, and the deciders are asked
        again."""
        org_id = str(organization_id)
        policy = await self.get_policy(org_id)
        request = await self._locked_request(org_id, request_id)
        if str(request.user_id) != str(member.id):
            if await self._may_view(org_id, member, request):
                raise PermissionError("Only the member who asked can answer.")
            raise AttendanceWaiverNotFound("Request not found")
        if request.status != AttendanceWaiverStatus.PENDING:
            raise ValueError(self._settled_message(request))
        if request.info_requested_at is None:
            raise ValueError("There is no question waiting on your answer.")
        text = self._message(answer, "Write your answer.")
        request.info_requested_at = None
        self.db.add(
            self._action(request, AttendanceWaiverAction.MEMBER_RESPONDED, member, text)
        )
        await self._audit(
            "attendance_waiver_request_member_responded", member, self._ids(request)
        )
        await self.db.commit()
        await self.db.refresh(request)
        await self._prompt_deciders(org_id, request, member, policy, answered=True)
        return request

    @staticmethod
    def _message(text: Optional[str], missing: str) -> str:
        """A required question or answer, trimmed and within the limit."""
        cleaned = _clean(text)
        if cleaned is None:
            raise ValueError(missing)
        if len(cleaned) > MAX_TEXT_LENGTH:
            raise ValueError(f"Keep it to {MAX_TEXT_LENGTH} characters.")
        return cleaned

    # ------------------------------------------------------------------
    # A rescheduled session: the member confirms it still needs a waiver
    # ------------------------------------------------------------------

    @staticmethod
    def _refuse_while_reconfirming(request: AttendanceWaiverRequest) -> None:
        """No decision while the member has not said the new date still
        needs one (owner decision, 2026-11-13): a decision now would answer a
        question about a date the member may no longer be asking about."""
        if request.reconfirm_requested_at is not None:
            raise ValueError(
                "This session moved. The member has not yet confirmed that "
                "the new date still needs a waiver, so it cannot be decided."
            )

    async def confirm(
        self, organization_id: str, member: User, request_id: str
    ) -> AttendanceWaiverRequest:
        """The member says a moved session still needs a waiver.

        Only the requester, and only while the request waits on them
        (``reconfirm_requested_at``). The request then goes back to its
        deciders for a fresh decision. What the new date may have changed is
        checked again, in the eligibility wording: a member now checked in,
        or (for a meeting) on leave or already excused by the Secretary, has
        nothing to excuse and is told to withdraw instead. The deadline and
        the cap are not: the member asked in time, and the cap is enforced
        when the request is approved.
        """
        org_id = str(organization_id)
        policy = await self.get_policy(org_id)
        request = await self._locked_request(org_id, request_id)
        if str(request.user_id) != str(member.id):
            if await self._may_view(org_id, member, request):
                raise PermissionError(
                    "Only the member who asked can confirm the new date."
                )
            raise AttendanceWaiverNotFound("Request not found")
        if request.status != AttendanceWaiverStatus.PENDING:
            raise ValueError(self._settled_message(request))
        if request.reconfirm_requested_at is None:
            raise ValueError("This request is not waiting for you to confirm a date.")
        refusal = await self._reconfirm_refusal(org_id, request)
        if refusal is not None:
            raise ValueError(f"{refusal} Withdraw this request instead.")
        request.reconfirm_requested_at = None
        self.db.add(
            self._action(request, AttendanceWaiverAction.MEMBER_CONFIRMED, member)
        )
        await self._audit(
            "attendance_waiver_request_member_confirmed", member, self._ids(request)
        )
        await self.db.commit()
        await self.db.refresh(request)
        name = (await self._names(org_id, [member.id])).get(str(member.id), "A member")
        title = request.event_title_snapshot
        day = _day_label(request.session_date)
        await self._prompt_deciders_with(
            org_id,
            request,
            policy,
            f"Waiver request — {name}, {title}",
            [
                f'"{title}" moved to {day}, and {name} confirmed they still '
                "need to be excused from it.",
                "Open the request to approve or deny it.",
            ],
        )
        return request

    async def _reconfirm_refusal(
        self, org_id: str, request: AttendanceWaiverRequest
    ) -> Optional[str]:
        """Why the moved session no longer needs a waiver, or None.

        The part of ``_assess`` a new date can change, in its wording.
        """
        noun = self.spec.session_noun
        event: Optional[Event] = None
        if request.event_id:
            event = (
                await self.db.execute(
                    select(Event).where(
                        Event.id == str(request.event_id),
                        Event.organization_id == org_id,
                    )
                )
            ).scalar_one_or_none()
        if event is None:
            return f"This {noun} no longer exists."
        if event.is_cancelled:
            return f"This {noun} was cancelled."
        if self.workflow == MEETING_WORKFLOW and await self._on_leave(
            org_id, request.user_id, request.session_date
        ):
            return (
                "You are on a leave of absence that covers this meeting, so "
                "it does not count against you."
            )
        if await self._checked_in(org_id, request.user_id, event.id):
            return f"You checked in to this {noun}, so it already counts as attended."
        if self.workflow == MEETING_WORKFLOW and await self._meeting_waived(
            org_id, request.user_id, event.id
        ):
            return "The Secretary has already excused you from this meeting."
        return None

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
        fallback = await self._holder_ids(
            org_id, Position.slug.in_(list(self.spec.fallback_slugs))
        )
        presidents = await self._holder_ids(
            org_id, Position.slug.in_(PRESIDENT_POSITION_SLUGS)
        )
        alternate = None
        if policy.chief_alternate_user_id:
            alternate = await self._current_member_id(
                org_id, policy.chief_alternate_user_id
            )
        return _DeciderPool(
            configured=configured,
            fallback=fallback,
            chiefs=chiefs,
            presidents=presidents,
            alternate=alternate,
        )

    async def _current_member_id(self, org_id: str, user_id: str) -> Optional[str]:
        """``user_id`` when it is a current member of the department, else None.

        Current is ``User.is_active``: an active or probationary account that
        is not deleted (CLAUDE.md pitfall #32).
        """
        found = (
            await self.db.execute(
                select(User.id).where(
                    User.id == str(user_id),
                    User.organization_id == org_id,
                    User.is_active,
                )
            )
        ).scalar_one_or_none()
        return str(found) if found else None

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
            permission = self.spec.manage_permission
            pool.managers = {
                str(u.id) for u in members if user_has_permission(u, permission)
            }
        return pool.managers

    async def _route_ids(
        self, org_id: str, pool: _DeciderPool, requester_id: str
    ) -> Set[str]:
        """Who a request from ``requester_id`` is routed to: the one definition.

        The chosen positions' holders; when that leaves nobody (vacant, no
        positions chosen, or only the requester), the fallback office's (the
        Chief for training, the Secretary for meetings); then every holder of
        the workflow's manage permission. The requester is never routed their own
        request, and a request always reaches someone while anyone else holds
        one of those. The Chief's and the President's own requests are routed
        by ``_officer_route`` instead, and may reach nobody. ``recipients`` and
        ``may_decide`` both read this, so who is asked and who may answer
        cannot drift apart.
        """
        requester = str(requester_id)
        officers = _officer_route(pool, requester)
        if officers is not None:
            return officers
        if requester not in pool.routed:
            routed: Set[str] = set()
            for step in (pool.configured, pool.fallback):
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
        officers = _officer_route(pool, requester_id)
        if officers is not None:
            # Exactly the route: neither the chosen positions nor the other
            # standing deciders decide the Chief's or President's own request.
            return uid in officers
        if uid in pool.configured or uid in pool.chiefs or uid in pool.presidents:
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
        a Chief or a President (in either workflow), or anyone the routing
        chain reached because the chosen positions left nobody (see
        ``_route_ids``). A request from the Chief or the President is decided
        only by whom ``_officer_route`` names.
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
        can be filtered and paged in SQL. A configured holder, a Chief or a
        President decides everyone's but the Chief's and President's own,
        which ``_decidable_officers`` answers for. A fallback holder decides where the chosen
        positions leave nobody: every requester when they are vacant, and
        their one holder's own request. A manager decides where the fallback
        leaves nobody too: every requester when both are vacant, and the one
        member who holds all of them when that member is the requester.
        """
        uid = str(actor.id)
        if uid in pool.configured or uid in pool.chiefs or uid in pool.presidents:
            return None
        requesters: Set[str] = set()
        if uid in pool.fallback:
            if not pool.configured:
                return None
            if len(pool.configured) == 1:
                requesters |= pool.configured
        if uid in await self._managers(org_id, pool):
            upstream = pool.configured | pool.fallback
            if not upstream:
                return None
            if len(upstream) == 1:
                requesters |= upstream
        return requesters - {uid}

    @staticmethod
    def _decidable_officers(
        pool: _DeciderPool, actor: User
    ) -> Tuple[Set[str], Set[str]]:
        """The Chief's and President's requests ``actor`` may decide, and all
        of the Chief's and President's ids.

        Their requests are routed by ``_officer_route`` alone, so the queue
        takes them out of ``_decidable_requesters``' answer and adds back the
        ones routed to ``actor``.
        """
        officers = pool.chiefs | pool.presidents
        uid = str(actor.id)
        mine = {o for o in officers if uid in (_officer_route(pool, o) or set())}
        return mine, officers

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
                AttendanceWaiverRequest.workflow == self.workflow,
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
        their_own, officers = self._decidable_officers(pool, actor)
        if requesters is None:
            decidable = AttendanceWaiverRequest.user_id != str(actor.id)
            if officers:
                decidable = and_(
                    decidable, AttendanceWaiverRequest.user_id.not_in(list(officers))
                )
        elif requesters - officers:
            decidable = AttendanceWaiverRequest.user_id.in_(list(requesters - officers))
        else:
            decidable = false()
        if their_own:
            decidable = or_(
                decidable, AttendanceWaiverRequest.user_id.in_(list(their_own))
            )
        conditions = [
            AttendanceWaiverRequest.organization_id == org_id,
            AttendanceWaiverRequest.workflow == self.workflow,
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
        expiries = await self._expiries(org_id, requests)
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
                    "expires_at": expiries.get(str(r.id)),
                    "info_requested_at": r.info_requested_at,
                    "can_withdraw": own and r.status == AttendanceWaiverStatus.PENDING,
                    "can_respond": own
                    and r.status == AttendanceWaiverStatus.PENDING
                    and r.info_requested_at is not None,
                    "can_request_info": decider and self.may_ask(r),
                    "reconfirm_requested_at": r.reconfirm_requested_at,
                    "can_confirm": own
                    and r.status == AttendanceWaiverStatus.PENDING
                    and r.reconfirm_requested_at is not None,
                    "can_decide": decider
                    and r.status == AttendanceWaiverStatus.PENDING
                    and r.reconfirm_requested_at is None,
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

    async def _expiries(
        self, org_id: str, requests: Sequence[AttendanceWaiverRequest]
    ) -> Dict[str, datetime]:
        """When each pending request in ``requests`` expires, by request id.

        Only pending requests expire, so only theirs is given; the events are
        loaded once for the page.
        """
        pending = [r for r in requests if r.status == AttendanceWaiverStatus.PENDING]
        if not pending:
            return {}
        tz = await resolve_scheduling_timezone(self.db, org_id)
        event_ids = sorted({str(r.event_id) for r in pending if r.event_id})
        events: Dict[str, Event] = {}
        if event_ids:
            rows = await self.db.execute(
                select(Event).where(
                    Event.organization_id == org_id, Event.id.in_(event_ids)
                )
            )
            events = {str(e.id): e for e in rows.scalars().all()}
        return {
            str(r.id): expires_at_for(
                r.session_date,
                tz,
                events.get(str(r.event_id)) if r.event_id else None,
            )
            for r in pending
        }

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

    async def _event(self, org_id: str, event_id: str, *, lock: bool = False) -> Event:
        query = select(Event).where(
            Event.id == str(event_id), Event.organization_id == org_id
        )
        if lock:
            query = query.with_for_update(read=True).execution_options(
                populate_existing=True
            )
        event: Optional[Event] = (await self.db.execute(query)).scalar_one_or_none()
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
                    AttendanceWaiverRequest.workflow == self.workflow,
                )
            )
        ).scalar_one_or_none()
        return found

    async def _locked_request(
        self, org_id: str, request_id: str, *, grant: bool = False
    ) -> AttendanceWaiverRequest:
        """The request, locked, after its requester's row (see the lock order).

        ``grant`` is for a decision that may approve: a meeting request's
        event is then locked, shared, between the two, so the approval and a
        minutes record being built from the event cannot miss each other.
        """
        peek = await self._find(org_id, request_id)
        if peek is None:
            raise AttendanceWaiverNotFound("Request not found")
        await self._lock_member(org_id, peek.user_id)
        if grant and self.workflow == MEETING_WORKFLOW and peek.event_id:
            await self.db.execute(
                select(Event.id)
                .where(Event.id == str(peek.event_id), Event.organization_id == org_id)
                .with_for_update(read=True)
            )
        locked: Optional[AttendanceWaiverRequest] = (
            await self.db.execute(
                select(AttendanceWaiverRequest)
                .where(
                    AttendanceWaiverRequest.id == str(request_id),
                    AttendanceWaiverRequest.organization_id == org_id,
                    AttendanceWaiverRequest.workflow == self.workflow,
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
        actor: Optional[User],
        note: Optional[str] = None,
    ) -> AttendanceWaiverRequestAction:
        return AttendanceWaiverRequestAction(
            id=generate_uuid(),
            organization_id=str(request.organization_id),
            request_id=str(request.id),
            action=action,
            actor_id=str(actor.id) if actor is not None else None,
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
            event_category=self.spec.audit_category,
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
        *,
        answered: bool = False,
    ) -> None:
        """In-app prompts for everyone the request is routed to.

        After the commit, and never allowed to fail the request: the member's
        request stands whether or not the bell could be rung. ``answered``
        words it as the member's answer to a decider's question (the answer
        itself stays on the request page).
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
            if answered:
                subject = f"Waiver request answered — {name}, {title}"
                opening = (
                    f"{name} answered your question about their request to be "
                    f'excused from "{title}" on {day}.'
                )
            else:
                subject = f"Waiver request — {name}, {title}"
                opening = f'{name} asked to be excused from "{title}" on {day}.'
            for recipient in recipients:
                self.db.add(
                    NotificationLog(
                        id=generate_uuid(),
                        organization_id=org_id,
                        recipient_id=str(recipient.id),
                        channel=NotificationChannel.IN_APP,
                        category=REVIEW_PROMPT_CATEGORY,
                        subject=subject,
                        # No reason or category: they may be medical, and a
                        # notification is stored in plain text.
                        message=f"{opening} Open the request to approve or deny it.",
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
            return
        await self._email(
            org_id,
            request,
            recipients,
            self.spec.decider_email_kind,
            subject,
            [opening, "Open the request to approve or deny it."],
            decider_action_url(request),
            "Review Request",
        )

    async def _prompt_deciders_with(
        self,
        org_id: str,
        request: AttendanceWaiverRequest,
        policy: AttendanceWaiverPolicy,
        subject: str,
        sentences: Sequence[str],
    ) -> None:
        """``_prompt_deciders`` in the caller's words: an in-app prompt for
        everyone the request is routed to, then the same words by email.

        After the commit, and never allowed to fail the action. ``sentences``
        carry no reason, note, question or answer: the row is plain text.
        """
        try:
            recipients = await self.recipients(org_id, request, policy)
            if not recipients:
                return
            for recipient in recipients:
                self.db.add(
                    NotificationLog(
                        id=generate_uuid(),
                        organization_id=org_id,
                        recipient_id=str(recipient.id),
                        channel=NotificationChannel.IN_APP,
                        category=REVIEW_PROMPT_CATEGORY,
                        subject=subject,
                        message=" ".join(sentences),
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
            return
        await self._email(
            org_id,
            request,
            recipients,
            self.spec.decider_email_kind,
            subject,
            sentences,
            decider_action_url(request),
            "Review Request",
        )

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
            return
        member = (
            await self.db.execute(
                select(User).where(
                    User.id == str(request.user_id), User.organization_id == org_id
                )
            )
        ).scalar_one_or_none()
        if member is not None:
            await self._email(
                org_id,
                request,
                [member],
                SPECS[request.workflow].member_email_kind,
                subject,
                [f'Your request to be excused from "{title}" on {day} {outcome}.'],
                member_action_url(request),
                "View Request",
            )

    async def _copy_decision(
        self,
        org_id: str,
        request: AttendanceWaiverRequest,
        actor: User,
        action: AttendanceWaiverAction,
    ) -> None:
        """Tell the holders of the policy's CC positions how a request ended.

        Only a final decision reaches here (approve, deny, the Chief's
        override); a withdrawal, a void or an expiry is not one and is not
        copied. The holders are informed only: they cannot open the request,
        so the notice carries who, which session, when and the outcome, and
        never the member's reason, category or the decider's note. It leads to
        the session while the event exists, and nowhere once it is gone.
        After the commit, and never allowed to fail the decision.
        """
        try:
            policy = await self.get_policy(org_id)
            if not policy.cc_position_ids:
                return
            # One notice per person, however many CC positions they hold; the
            # member and the decider already have their own notice or the
            # decision in hand.
            ids = await self._holder_ids(
                org_id, Position.id.in_(list(policy.cc_position_ids))
            ) - {str(request.user_id), str(actor.id)}
            if not ids:
                return
            recipients = list(
                (
                    await self.db.execute(
                        select(User).where(
                            User.id.in_(sorted(ids)), User.organization_id == org_id
                        )
                    )
                )
                .scalars()
                .all()
            )
            name = (await self._names(org_id, [request.user_id])).get(
                str(request.user_id), "A member"
            )
            title = request.event_title_snapshot
            day = _day_label(request.session_date)
            if action == AttendanceWaiverAction.CHIEF_OVERRIDE:
                word, outcome = "approved", "was approved by the Chief on review"
            elif action == AttendanceWaiverAction.APPROVED:
                word, outcome = "approved", "was approved"
            else:
                word, outcome = "not approved", "was not approved"
            subject = f"Waiver request {word} — {name}, {title}"
            sentence = (
                f'{name}\'s request to be excused from "{title}" on {day} '
                f"{outcome}."
            )
            path = f"/events/{request.event_id}" if request.event_id else None
            for recipient in recipients:
                self.db.add(
                    NotificationLog(
                        id=generate_uuid(),
                        organization_id=org_id,
                        recipient_id=str(recipient.id),
                        channel=NotificationChannel.IN_APP,
                        category=CC_NOTICE_CATEGORY,
                        subject=subject,
                        message=sentence,
                        action_url=path,
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
                "Failed to copy the decision on waiver request {}", request.id
            )
            await self._recover(request)
            return
        await self._email(
            org_id,
            request,
            recipients,
            self.spec.decider_email_kind,
            subject,
            [sentence, "You are copied on waiver decisions by your position."],
            path,
            "View Session",
        )

    async def _notify_member_asked(
        self, org_id: str, request: AttendanceWaiverRequest, actor: User
    ) -> None:
        """Tell the member a decider has a question, never what it is: the
        question stays on the request, encrypted, behind sign-in."""
        name = (await self._names(org_id, [actor.id])).get(str(actor.id), "An officer")
        title = request.event_title_snapshot
        day = _day_label(request.session_date)
        subject = f"Question about your waiver request — {title}"
        sentence = (
            f"{name} asked for more information about your request to be "
            f'excused from "{title}" on {day}. Open it to answer.'
        )
        url = member_answer_url(request)
        try:
            self.db.add(
                NotificationLog(
                    id=generate_uuid(),
                    organization_id=org_id,
                    recipient_id=str(request.user_id),
                    channel=NotificationChannel.IN_APP,
                    category=MEMBER_UPDATE_CATEGORY,
                    subject=subject,
                    message=sentence,
                    action_url=url,
                    notification_metadata={PROMPT_METADATA_KEY: str(request.id)},
                    delivered=True,
                )
            )
            await self.db.commit()
        except Exception:
            logger.exception(
                "Failed to tell the member of a question on waiver request {}",
                request.id,
            )
            await self._recover(request)
            return
        member = (
            await self.db.execute(
                select(User).where(
                    User.id == str(request.user_id), User.organization_id == org_id
                )
            )
        ).scalar_one_or_none()
        if member is not None:
            await self._email(
                org_id,
                request,
                [member],
                SPECS[request.workflow].member_email_kind,
                subject,
                [sentence],
                url,
                "Answer the Question",
            )

    async def _email(
        self,
        org_id: str,
        request: AttendanceWaiverRequest,
        recipients: Iterable[User],
        kind: EmailKind,
        subject: str,
        sentences: Sequence[str],
        path: Optional[str],
        button: str,
    ) -> None:
        """Email a notice that an in-app row also carries.

        The one way this workflow sends email, for every notice (CLAUDE.md
        pitfall #18). ``sentences`` are the same plain words as the in-app
        row: never the member's reason, a decider's note, or a question or
        answer, which may be medical and stay on the request page behind
        sign-in. Each recipient's email preferences decide, under ``kind``.
        ``path`` None sends no button, for a notice with nowhere to lead.
        Called after the commit and never allowed to fail the action: a
        failure is logged by request id and swallowed.
        """
        try:
            org = (
                await self.db.execute(
                    select(Organization).where(Organization.id == org_id)
                )
            ).scalar_one_or_none()
            required = department_required_kinds(org)
            to_emails = sorted(
                {
                    str(user.email)
                    for user in recipients
                    if user.email
                    and member_receives_email(
                        user.notification_preferences, kind, required
                    )
                }
            )
            if not to_emails:
                return
            from app.services.email_service import EmailService, wrap_email_body

            body = "".join(f"<p>{html.escape(line)}</p>" for line in sentences)
            text_body = "\n\n".join(sentences)
            if path is not None:
                url = f"{app_settings.FRONTEND_URL}{path}"
                body += (
                    '<p style="text-align: center;">'
                    f'<a href="{html.escape(url)}" class="button" role="link">'
                    f"{html.escape(button)}</a></p>"
                )
                text_body += f"\n\n{button}: {url}"
            html_body = wrap_email_body(org, "Waiver Request", body)
            await EmailService(organization=org).send_email(
                to_emails=to_emails,
                subject=subject,
                html_body=html_body,
                text_body=text_body,
            )
        except Exception:
            logger.exception("Failed to email about waiver request {}", request.id)

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
    return f"{SPECS[request.workflow].decider_path}/{request.id}"


def member_action_url(request: AttendanceWaiverRequest) -> str:
    """Where the member's notice leads: the session, or their list once the
    event is gone."""
    if request.event_id:
        return f"/events/{request.event_id}"
    return SPECS[request.workflow].member_fallback_url


def member_answer_url(request: AttendanceWaiverRequest) -> str:
    """Where the member answers a question: My Training's list of their
    requests holds the answer form. The meeting workflow has no screen of its
    own, so its member is sent where its other notices go."""
    if request.workflow == TRAINING_WORKFLOW:
        return TRAINING_SPEC.member_fallback_url
    return member_action_url(request)


def _day_label(day: date) -> str:
    return f"{calendar.month_name[day.month]} {day.day}, {day.year}"


# ---------------------------------------------------------------------------
# The meeting workflow's grant, and what the event's lifecycle does to requests
# ---------------------------------------------------------------------------


def _apply_meeting_waiver(
    attendee: MeetingAttendee, request: AttendanceWaiverRequest, granted_by
) -> bool:
    """Write ``request``'s waiver onto ``attendee``; False when it has one.

    A waiver already there (the Secretary granted one by hand) is left as it
    is: the member is excused either way, and the Secretary's words are not
    overwritten. ``present`` is never touched: if the member checked in,
    check-in wins (``tally_attendance``).
    """
    if attendee.waiver_reason:
        return False
    attendee.excused = True
    attendee.waiver_reason = meeting_waiver_text(request.category)
    attendee.waiver_granted_by = str(granted_by) if granted_by else None
    attendee.waiver_granted_at = request.decided_at or _now()
    attendee.waiver_request_id = str(request.id)
    return True


def _absent_waived_attendee(
    org_id: str, meeting_id: str, request: AttendanceWaiverRequest, granted_by
) -> MeetingAttendee:
    attendee = MeetingAttendee(
        id=generate_uuid(),
        organization_id=org_id,
        meeting_id=str(meeting_id),
        user_id=str(request.user_id),
        # Explicit: the column defaults to True, which would record a member
        # who asked to be excused as having attended.
        present=False,
        excused=False,
    )
    _apply_meeting_waiver(attendee, request, granted_by)
    return attendee


async def grant_meeting_waiver(
    db: AsyncSession,
    org_id: str,
    request: AttendanceWaiverRequest,
    *,
    actor_id: Optional[str],
) -> int:
    """Write an approved meeting request onto its event's minutes record.

    Does not commit. Nothing to write when no minutes record exists yet:
    ``MeetingsService.create_from_event`` carries the approval over when it
    builds one. The caller holds the event shared (``_locked_request``), and
    each minutes record is locked here before its attendee is read, the
    parent the Secretary's own grant locks too (pitfall #27), so the unique
    (meeting, member) row is found rather than inserted twice. Returns the
    number of minutes records written to.
    """
    if not request.event_id:
        return 0
    meetings = (
        (
            await db.execute(
                select(Meeting)
                .where(
                    Meeting.organization_id == org_id,
                    Meeting.event_id == str(request.event_id),
                )
                .with_for_update()
            )
        )
        .scalars()
        .all()
    )
    written = 0
    for meeting in meetings:
        attendee = (
            await db.execute(
                select(MeetingAttendee)
                .where(
                    MeetingAttendee.organization_id == org_id,
                    MeetingAttendee.meeting_id == str(meeting.id),
                    MeetingAttendee.user_id == str(request.user_id),
                )
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if attendee is None:
            db.add(_absent_waived_attendee(org_id, meeting.id, request, actor_id))
            written += 1
        elif _apply_meeting_waiver(attendee, request, actor_id):
            written += 1
    return written


async def carry_over_meeting_waivers(
    db: AsyncSession,
    org_id: str,
    event_id: str,
    meeting_id: str,
    attendees: Dict[str, MeetingAttendee],
) -> int:
    """Approved meeting requests for ``event_id``, onto a new minutes record.

    For ``MeetingsService.create_from_event``, inside its lock on the event
    and before its commit. ``attendees`` are the rows it is about to insert,
    by member; a member with no row gets one, absent. A locking read: the
    caller's snapshot may predate an approval that committed while it waited
    for the event (pitfall #27). Returns how many were carried over.
    """
    approved = (
        (
            await db.execute(
                select(AttendanceWaiverRequest)
                .where(
                    AttendanceWaiverRequest.organization_id == org_id,
                    AttendanceWaiverRequest.event_id == str(event_id),
                    AttendanceWaiverRequest.workflow == MEETING_WORKFLOW,
                    AttendanceWaiverRequest.status == AttendanceWaiverStatus.APPROVED,
                )
                .with_for_update(read=True)
            )
        )
        .scalars()
        .all()
    )
    carried = 0
    for request in approved:
        attendee = attendees.get(str(request.user_id))
        if attendee is None:
            attendee = _absent_waived_attendee(
                org_id, meeting_id, request, request.decided_by
            )
            attendees[str(request.user_id)] = attendee
            db.add(attendee)
            carried += 1
        elif _apply_meeting_waiver(attendee, request, request.decided_by):
            carried += 1
    return carried


@dataclass(frozen=True)
class RescheduleNotice:
    """The email owed to a member whose request a move sent back to them.

    ``reconfirm_for_rescheduled_events`` runs inside the caller's transaction,
    so it cannot send mail: an email about a move the caller then rolls back
    would tell the member of something that never happened. The caller sends
    these with ``send_reschedule_notices`` once it has committed.
    """

    request_id: str
    workflow: AttendanceWaiverWorkflow
    subject: str
    sentences: Tuple[str, ...]


def _same_instant(a: datetime, b: datetime) -> bool:
    """Whether two stored starts are the same moment.

    DATETIME keeps whole seconds and MySQL rounds a fraction, so a start read
    back can differ from the value written by under a second.
    """
    return abs(_utc(a) - _utc(b)) < timedelta(seconds=1)


def _when_label(value: datetime, tz) -> str:
    """A start as the department's wall clock, for a sentence."""
    local = to_local(value, tz)
    clock = local.strftime("%I:%M %p").lstrip("0")
    return f"{_day_label(local.date())} at {clock}"


async def _unapply_meeting_waiver(
    db: AsyncSession, org_id: str, request: AttendanceWaiverRequest
) -> int:
    """Take ``request``'s waiver off the minutes records: the reverse of
    ``_apply_meeting_waiver``.

    Only a row the request wrote (``waiver_request_id``): a waiver the
    Secretary granted, or rewrote in their own words, is theirs and stays.
    ``present`` is never touched. The minutes records are locked before their
    attendees, as ``grant_meeting_waiver`` does. Does not commit; returns how
    many rows were cleared.
    """
    if request.event_id:
        await db.execute(
            select(Meeting.id)
            .where(
                Meeting.organization_id == org_id,
                Meeting.event_id == str(request.event_id),
            )
            .with_for_update()
        )
    attendees = (
        (
            await db.execute(
                select(MeetingAttendee)
                .where(
                    MeetingAttendee.organization_id == org_id,
                    MeetingAttendee.waiver_request_id == str(request.id),
                )
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        )
        .scalars()
        .all()
    )
    for attendee in attendees:
        attendee.excused = False
        attendee.waiver_reason = None
        attendee.waiver_granted_by = None
        attendee.waiver_granted_at = None
        attendee.waiver_request_id = None
    return len(attendees)


async def reconfirm_for_rescheduled_events(
    db: AsyncSession, org_id: str, event_ids: Sequence[str]
) -> List[RescheduleNotice]:
    """Send every pending or approved request for a moved session back to its
    member (owner decision, 2026-11-13).

    For every path that changes an event's start, inside the caller's
    transaction (it commits) while it holds the events exclusively; like
    ``void_pending_for_events`` it never takes a ``users`` row, so the lock
    order cannot cycle. A request whose snapshot already has the event's
    start is left alone, so a change that leaves the start where it was (a
    title, a room, the end alone) does nothing, and running this twice for one
    move writes nothing the second time (CLAUDE.md pitfall #36).

    Each moved request takes the new title, start and local date, goes back to
    PENDING with its decision cleared (the log keeps it) and waits on the
    member (``reconfirm_requested_at``); an approved meeting request's waiver
    comes off the minutes record. A denied request is not touched: the first
    decision is final. The deciders' prompts are archived, and the member gets
    an in-app notice now and an email once the caller commits: the returned
    notices, for ``send_reschedule_notices``.

    A member who never answers is not chased: the expiry task closes a request
    still pending seven days after its (new) session.
    """
    ids = [str(e) for e in event_ids if e]
    if not ids:
        return []
    events = {
        str(e.id): e
        for e in (
            await db.execute(
                select(Event).where(Event.organization_id == org_id, Event.id.in_(ids))
            )
        ).scalars()
    }
    live = (
        (
            await db.execute(
                select(AttendanceWaiverRequest)
                .where(
                    AttendanceWaiverRequest.organization_id == org_id,
                    AttendanceWaiverRequest.event_id.in_(ids),
                    AttendanceWaiverRequest.status.in_(
                        [
                            AttendanceWaiverStatus.PENDING,
                            AttendanceWaiverStatus.APPROVED,
                        ]
                    ),
                )
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        )
        .scalars()
        .all()
    )
    moved = [
        r
        for r in live
        if str(r.event_id) in events
        and not _same_instant(
            r.event_start_snapshot, events[str(r.event_id)].start_datetime
        )
    ]
    if not moved:
        return []
    tz = await resolve_scheduling_timezone(db, org_id)
    now = _now()
    notices: List[RescheduleNotice] = []
    for request in moved:
        event = events[str(request.event_id)]
        spec = SPECS[request.workflow]
        noun = spec.session_noun
        was = request.status
        old_date = request.session_date
        old_when = _when_label(request.event_start_snapshot, tz)
        new_when = _when_label(event.start_datetime, tz)
        if was == AttendanceWaiverStatus.APPROVED and (
            request.workflow == MEETING_WORKFLOW
        ):
            await _unapply_meeting_waiver(db, org_id, request)
        request.event_title_snapshot = (event.title or spec.default_title)[:255]
        request.event_start_snapshot = _utc(event.start_datetime)
        request.session_date = local_date(event.start_datetime, tz)
        request.status = AttendanceWaiverStatus.PENDING
        request.decided_at = None
        request.decided_by = None
        # It described the decision being cleared; a fresh one sets its own.
        request.chief_override = False
        request.info_requested_at = None
        request.reconfirm_requested_at = now
        db.add(
            AttendanceWaiverService._action(
                request,
                AttendanceWaiverAction.RESCHEDULED,
                None,
                f"The {noun} moved from {old_when} to {new_when}.",
            )
        )
        title = request.event_title_snapshot
        sentences = [
            f'The {noun} "{title}" you asked to be excused from moved from '
            f"{old_when} to {new_when}."
        ]
        if was == AttendanceWaiverStatus.APPROVED:
            sentences.append(
                "Its approval was for the old date, so the request will be "
                "decided again."
            )
        sentences.append(
            "Open your request to confirm you still need to be excused, or "
            "withdraw it."
        )
        subject = f"Confirm your waiver request — {title}"
        db.add(
            NotificationLog(
                id=generate_uuid(),
                organization_id=org_id,
                recipient_id=str(request.user_id),
                channel=NotificationChannel.IN_APP,
                category=MEMBER_UPDATE_CATEGORY,
                subject=subject,
                message=" ".join(sentences),
                action_url=member_action_url(request),
                notification_metadata={PROMPT_METADATA_KEY: str(request.id)},
                delivered=True,
            )
        )
        await log_audit_event(
            db=db,
            event_type="attendance_waiver_request_rescheduled",
            event_category=spec.audit_category,
            severity="info",
            event_data={
                **AttendanceWaiverService._ids(request),
                "previous_session_date": old_date.isoformat(),
                "previous_status": was.value,
            },
        )
        notices.append(
            RescheduleNotice(
                request_id=str(request.id),
                workflow=request.workflow,
                subject=subject,
                sentences=tuple(sentences),
            )
        )
    await db.flush()
    archive = NotificationsService(db)
    for request in moved:
        await archive.archive_related_notifications(
            org_id,
            REVIEW_PROMPT_CATEGORY,
            PROMPT_METADATA_KEY,
            str(request.id),
            commit=False,
        )
    return notices


async def send_reschedule_notices(
    db: AsyncSession, org_id: str, notices: Sequence[RescheduleNotice]
) -> None:
    """Email the members ``reconfirm_for_rescheduled_events`` asked to confirm.

    After the caller's commit, and never allowed to fail it: the move stands
    whether or not a mail server answered.
    """
    for notice in notices:
        service = AttendanceWaiverService(db, notice.workflow)
        try:
            request = await service._find(str(org_id), notice.request_id)
            member = (
                None
                if request is None
                else (
                    await db.execute(
                        select(User).where(
                            User.id == str(request.user_id),
                            User.organization_id == str(org_id),
                        )
                    )
                ).scalar_one_or_none()
            )
        except Exception:
            logger.exception(
                "Failed to load waiver request {} to email its member",
                notice.request_id,
            )
            continue
        if request is None or member is None:
            continue
        await service._email(
            str(org_id),
            request,
            [member],
            service.spec.member_email_kind,
            notice.subject,
            notice.sentences,
            member_action_url(request),
            "View Request",
        )


async def void_pending_for_events(
    db: AsyncSession, org_id: str, event_ids: Sequence[str], cause: str
) -> int:
    """Void every pending request, of either workflow, for these events.

    For the event's cancellation or deletion, inside the caller's
    transaction (it commits) while it holds the events exclusively. A pending
    request is about a session that will not now be held, so there is nothing
    left to decide: it is voided, which frees its slot, its deciders' prompts
    are archived and the member is told. An approved or denied request is the
    member's record and is kept (the row outlives the event, see the model).
    ``cause`` is "cancelled" or "deleted", for the log and the notice.
    """
    ids = [str(e) for e in event_ids if e]
    if not ids:
        return 0
    pending = list(
        (
            await db.execute(
                select(AttendanceWaiverRequest)
                .where(
                    AttendanceWaiverRequest.organization_id == org_id,
                    AttendanceWaiverRequest.event_id.in_(ids),
                    AttendanceWaiverRequest.status == AttendanceWaiverStatus.PENDING,
                )
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        )
        .scalars()
        .all()
    )
    for request in pending:
        spec = SPECS[request.workflow]
        request.status = AttendanceWaiverStatus.VOIDED
        request.live_key = None
        request.info_requested_at = None
        db.add(
            AttendanceWaiverService._action(
                request,
                AttendanceWaiverAction.VOIDED,
                None,
                f"The {spec.session_noun} was {cause}.",
            )
        )
        db.add(
            NotificationLog(
                id=generate_uuid(),
                organization_id=org_id,
                recipient_id=str(request.user_id),
                channel=NotificationChannel.IN_APP,
                category=MEMBER_UPDATE_CATEGORY,
                subject=f"Waiver request closed — {request.event_title_snapshot}",
                message=(
                    f"Your request to be excused from "
                    f'"{request.event_title_snapshot}" on '
                    f"{_day_label(request.session_date)} was closed: the "
                    f"{spec.session_noun} was {cause}."
                ),
                # Not the event: it may be about to be deleted.
                action_url=spec.member_fallback_url,
                notification_metadata={PROMPT_METADATA_KEY: str(request.id)},
                delivered=True,
            )
        )
        await log_audit_event(
            db=db,
            event_type="attendance_waiver_request_voided",
            event_category=spec.audit_category,
            severity="info",
            event_data={
                **AttendanceWaiverService._ids(request),
                "cause": cause,
            },
        )
    if pending:
        await db.flush()
        notifications = NotificationsService(db)
        for request in pending:
            await notifications.archive_related_notifications(
                org_id,
                REVIEW_PROMPT_CATEGORY,
                PROMPT_METADATA_KEY,
                str(request.id),
                commit=False,
            )
    return len(pending)
