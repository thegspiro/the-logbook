"""
Administration-page frame: headline metrics and the "Needs attention" queue.

Every admin page presents the same frame, so an officer who works across
Members, Training and Inventory learns the page once. What changes module to
module is the *content* of the queue — each module declares its own exceptions
here, and that is the only part of the page a user has to read carefully.

Adding a module means adding one ``ModuleSpec`` to ``MODULE_REGISTRY``: the
frame, the settings screen and the API all read from it.

Writing an exception, per the pattern: it names a subject, carries an age or a
deadline, and offers one action that ends it. Anything that cannot be acted on
today belongs in a metric, not the queue.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Awaitable, Callable, Optional, Sequence
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from loguru import logger
from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.api.dependencies import user_has_permission
from app.models.admin_hub import DEPARTMENT_SCOPE, AdminHubMetricPreference
from app.models.event import Event, EventRSVP, EventType, RSVPStatus
from app.models.event_request import EventRequest, EventRequestStatus
from app.models.inventory import (
    EquipmentRequest,
    InventoryItem,
    ItemIssuance,
    ItemStatus,
    NFPAItemCompliance,
    RequestStatus,
    TrackingType,
)
from app.models.medical_screening import ScreeningRecord, ScreeningStatus
from app.models.membership_pipeline import ProspectiveMember, ProspectStatus
from app.models.skills_testing import (
    SkillTemplate,
    SkillTest,
    SkillTestResult,
    SkillTestStatus,
)
from app.models.storefront import (
    StoreOrder,
    StoreOrderStatus,
    StoreOrderWindow,
    StorePaymentEvent,
    StorePaymentEventStatus,
    StorePaymentStatus,
    StoreProduct,
    StoreProductStatus,
    StoreWindowStatus,
)
from app.models.training import (
    EnrollmentStatus,
    ProgramEnrollment,
    SubmissionStatus,
    TrainingProgram,
    TrainingRecord,
    TrainingStatus,
    TrainingSubmission,
    TrainingType,
)
from app.models.user import Organization, User, UserStatus
from app.schemas.admin_hub import (
    AdminAttentionItem,
    AdminHubSummary,
    AdminMetric,
    AdminMetricOption,
    AdminMetricSettings,
    AdminMetricSettingsUpdate,
)
from app.services.organization_service import OrganizationService
from app.services.training_compliance import compute_org_compliance_pct

#: The always-on fourth slot. Reported by every module, chosen by none.
ATTENTION_METRIC_KEY = "needs_attention"

#: Open slots an admin may choose. The fourth is fixed, so three.
OPEN_SLOTS = 3

#: How long a prospective application may sit before it is an exception.
PROSPECT_SLA_DAYS = 14

#: Window the queue treats as "expiring soon" for certifications and tests.
EXPIRY_HORIZON_DAYS = 60

#: How far ahead the queue looks for events that nobody has answered.
EVENT_HORIZON_DAYS = 14

#: A value that could not be computed. Rendered as-is, so a failed query reads
#: as "we don't know" rather than as a confident zero.
UNKNOWN_VALUE = "—"


# ── Context ─────────────────────────────────────────────────────────────────


@dataclass
class MetricContext:
    """Everything a resolver needs, computed once per request."""

    db: AsyncSession
    organization_id: str
    user: User
    today: date
    timezone_name: str
    #: Start of the organization's local today, in UTC — the boundary any
    #: timestamp comparison must use, because "this week" is a local question.
    local_midnight: datetime
    enabled_modules: set[str]


MetricResolver = Callable[[MetricContext], Awaitable[tuple[str, str]]]
AvailabilityCheck = Callable[[MetricContext], Awaitable[Optional[str]]]
AttentionResolver = Callable[[MetricContext], Awaitable[list[AdminAttentionItem]]]


@dataclass
class MetricSpec:
    """One metric a module can put in a slot."""

    key: str
    label: str
    description: str
    resolve: MetricResolver
    #: Module that must be enabled for this metric to be selectable.
    requires_module: Optional[str] = None
    #: Shown in the settings list when ``requires_module`` is off.
    module_off_reason: Optional[str] = None
    #: Extra data-driven gate — returns a reason string when unavailable.
    availability: Optional[AvailabilityCheck] = None
    #: Additional permission required because this metric reads protected data.
    permission: Optional[str] = None


@dataclass
class ModuleSpec:
    """One administration page."""

    key: str
    permission: str
    metrics: Sequence[MetricSpec]
    attention: AttentionResolver
    #: The three open slots a module starts with.
    default_metrics: tuple[str, str, str] = field(default=("", "", ""))
    #: Module that must be enabled for the page's data to exist at all.
    requires_module: Optional[str] = None
    #: Additional permission required to resolve this module's attention queue.
    attention_permission: Optional[str] = None


# ── Small helpers ───────────────────────────────────────────────────────────


def _age_days(value: date | datetime | None, today: date) -> Optional[int]:
    if value is None:
        return None
    resolved = value.date() if isinstance(value, datetime) else value
    return max(0, (today - resolved).days)


def _fmt_int(value: int | float | None) -> str:
    return f"{int(value or 0):,}"


def _fmt_hours(value: float | None) -> str:
    """Hours read better without a trailing .0 once they run to thousands."""
    total = float(value or 0)
    return f"{total:,.0f}" if total >= 100 else f"{total:,.1f}"


def _fmt_money(value: Decimal | float | None) -> str:
    """Whole dollars. A metric card is a glance, and cents do not survive one."""
    return f"${Decimal(value or 0):,.0f}"


def _plural(count: int, singular: str, plural: Optional[str] = None) -> str:
    return singular if count == 1 else (plural or f"{singular}s")


def _waiting_phrase(oldest_age: Optional[int]) -> str:
    if oldest_age is None:
        return ""
    if oldest_age == 0:
        return "all opened today"
    return f"oldest waiting {oldest_age} {_plural(oldest_age, 'day')}"


async def _scalar(db: AsyncSession, statement) -> int:
    return int((await db.execute(statement)).scalar() or 0)


async def _count_and_oldest(db: AsyncSession, model, *criteria, date_column):
    """Count matching rows and return the earliest value of ``date_column``."""
    row = (
        await db.execute(
            select(func.count(model.id), func.min(date_column)).where(*criteria)
        )
    ).one()
    return int(row[0] or 0), row[1]


def _module_off_reason(metric: MetricSpec) -> str:
    """Why a metric cannot be chosen, in words an officer can act on.

    Shared by the settings list and the save guard: the two used to phrase the
    same fact differently, and the save error was the one that leaked the
    internal module key ("needs the prospective_members module").
    """
    return metric.module_off_reason or f"Needs the {metric.requires_module} module"


def _quarter_start(today: date) -> date:
    return date(today.year, ((today.month - 1) // 3) * 3 + 1, 1)


def _attention_context(attention: list[AdminAttentionItem]) -> str:
    """The context line under the attention count.

    The oldest thing waiting is the honest summary of a queue: a count says how
    much there is, an age says how long somebody has been let down by it.
    """
    if not attention:
        return "nothing waiting"
    ages = [item.oldest_age_days for item in attention if item.oldest_age_days]
    if ages:
        oldest = max(ages)
        return f"oldest waiting {oldest} {_plural(oldest, 'day')}"
    return f"{len(attention)} {_plural(len(attention), 'exception')}"


# ── Members ─────────────────────────────────────────────────────────────────


#: Outer-query alias for the expired-screening lookup, so its correlated
#: "is there still cover?" subquery can name the same table twice.
_EXPIRED_ALIAS = aliased(ScreeningRecord)

#: Outer-query alias for the missed-appointment lookup, for the same reason.
_OVERDUE_ALIAS = aliased(ScreeningRecord)

#: Statuses that mean the member turned up. A failed screening and one still
#: under review are both *completed* appointments — they are somebody else's
#: problem (compliance, the reviewer), not a booking nobody kept.
_ATTENDED_STATUSES = (
    ScreeningStatus.PASSED,
    ScreeningStatus.COMPLETED,
    ScreeningStatus.FAILED,
    ScreeningStatus.PENDING_REVIEW,
)


def _active_member_criteria():
    return (User.status == UserStatus.ACTIVE, User.deleted_at.is_(None))


async def _members_active(ctx: MetricContext) -> tuple[str, str]:
    active = await _scalar(
        ctx.db,
        select(func.count(User.id)).where(
            User.organization_id == ctx.organization_id, *_active_member_criteria()
        ),
    )
    tiers = await _scalar(
        ctx.db,
        select(func.count(func.distinct(User.membership_type))).where(
            User.organization_id == ctx.organization_id, *_active_member_criteria()
        ),
    )
    return _fmt_int(active), f"across {tiers} {_plural(tiers, 'membership type')}"


async def _members_probationary(ctx: MetricContext) -> tuple[str, str]:
    count = await _scalar(
        ctx.db,
        select(func.count(User.id)).where(
            User.organization_id == ctx.organization_id,
            User.status == UserStatus.PROBATIONARY,
            User.deleted_at.is_(None),
        ),
    )
    return _fmt_int(count), "still on probation"


async def _members_inactive(ctx: MetricContext) -> tuple[str, str]:
    count = await _scalar(
        ctx.db,
        select(func.count(User.id)).where(
            User.organization_id == ctx.organization_id,
            User.status == UserStatus.INACTIVE,
            User.deleted_at.is_(None),
        ),
    )
    return _fmt_int(count), "on the roster, not active"


async def _members_on_leave(ctx: MetricContext) -> tuple[str, str]:
    count = await _scalar(
        ctx.db,
        select(func.count(User.id)).where(
            User.organization_id == ctx.organization_id,
            User.status == UserStatus.LEAVE,
            User.deleted_at.is_(None),
        ),
    )
    return _fmt_int(count), "leave of absence"


async def _members_prospective(ctx: MetricContext) -> tuple[str, str]:
    count = await _scalar(
        ctx.db,
        select(func.count(ProspectiveMember.id)).where(
            ProspectiveMember.organization_id == ctx.organization_id,
            ProspectiveMember.status == ProspectStatus.ACTIVE,
        ),
    )
    return _fmt_int(count), "in the pipeline"


async def _members_screening_current(ctx: MetricContext) -> tuple[str, str]:
    active = await _scalar(
        ctx.db,
        select(func.count(User.id)).where(
            User.organization_id == ctx.organization_id, *_active_member_criteria()
        ),
    )
    if active == 0:
        return "—", "no active members"
    current = await _scalar(
        ctx.db,
        select(func.count(func.distinct(ScreeningRecord.user_id)))
        .join(User, ScreeningRecord.user_id == User.id)
        .where(
            ScreeningRecord.organization_id == ctx.organization_id,
            ScreeningRecord.status.in_(
                [ScreeningStatus.PASSED, ScreeningStatus.COMPLETED]
            ),
            or_(
                ScreeningRecord.expiration_date.is_(None),
                ScreeningRecord.expiration_date >= ctx.today,
            ),
            User.organization_id == ctx.organization_id,
            *_active_member_criteria(),
        ),
    )
    return f"{round(current * 100 / active)}%", f"{current} of {active} cleared"


async def _members_attention(ctx: MetricContext) -> list[AdminAttentionItem]:
    items: list[AdminAttentionItem] = []

    # Screening work is only work if the department runs the module. The
    # medical_screening flag was added after this resolver; before it,
    # medical_screening.view alone put lapsed-physical counts on the members
    # admin page for departments that track physicals somewhere else.
    if "medical_screening" in ctx.enabled_modules:
        # One row per member and screening type, not per historical record.
        # A screening is renewed by adding a record, never by editing the old one,
        # so counting expired rows outright reports a member who renewed last week
        # as lapsed — while the Screenings-current metric, which asks whether any
        # valid record exists, calls the same member covered. Two numbers on one
        # page disagreeing about one person is worse than either being absent.
        #
        # "Expired" therefore means: this member has no unexpired record of this
        # type. A record with no expiry never lapses, and a waiver excuses the
        # requirement, so both count as cover.
        current_cover = (
            select(ScreeningRecord.id)
            .where(
                ScreeningRecord.organization_id == ctx.organization_id,
                ScreeningRecord.user_id == _EXPIRED_ALIAS.user_id,
                ScreeningRecord.screening_type == _EXPIRED_ALIAS.screening_type,
                ScreeningRecord.status.in_(
                    [
                        ScreeningStatus.PASSED,
                        ScreeningStatus.COMPLETED,
                        ScreeningStatus.WAIVED,
                    ]
                ),
                or_(
                    ScreeningRecord.expiration_date.is_(None),
                    ScreeningRecord.expiration_date >= ctx.today,
                ),
            )
            .exists()
        )
        lapsed = (
            select(
                _EXPIRED_ALIAS.user_id,
                _EXPIRED_ALIAS.screening_type,
                func.min(_EXPIRED_ALIAS.expiration_date).label("lapsed_on"),
            )
            .join(User, _EXPIRED_ALIAS.user_id == User.id)
            .where(
                _EXPIRED_ALIAS.organization_id == ctx.organization_id,
                _EXPIRED_ALIAS.expiration_date.isnot(None),
                _EXPIRED_ALIAS.expiration_date < ctx.today,
                _EXPIRED_ALIAS.status != ScreeningStatus.WAIVED,
                # A lapsed screening for someone off the roster is history, not work.
                User.organization_id == ctx.organization_id,
                *_active_member_criteria(),
                ~current_cover,
            )
            .group_by(_EXPIRED_ALIAS.user_id, _EXPIRED_ALIAS.screening_type)
            .subquery()
        )
        expired_row = (
            await ctx.db.execute(
                select(func.count(), func.min(lapsed.c.lapsed_on)).select_from(lapsed)
            )
        ).one()
        expired_count, oldest_expiry = int(expired_row[0] or 0), expired_row[1]
        if expired_count:
            age = _age_days(oldest_expiry, ctx.today)
            items.append(
                AdminAttentionItem(
                    key="expired_screenings",
                    title=(
                        f"{expired_count} medical "
                        f"{_plural(expired_count, 'screening')} expired"
                    ),
                    detail=" · ".join(
                        part
                        for part in (
                            (
                                f"oldest lapsed {age} {_plural(age or 0, 'day')} ago"
                                if age is not None
                                else ""
                            ),
                            "blocks duty assignment",
                        )
                        if part
                    ),
                    action_label="Open records",
                    href="/medical-screening",
                    severity="critical",
                    count=expired_count,
                    oldest_age_days=age,
                )
            )

        # Same shape as the expired lookup above, and for the same reason: a missed
        # appointment is never edited, it is answered by a *new* record. Counting
        # stale SCHEDULED rows outright therefore reports the member who rebooked
        # and passed as one who "never completed" it, and keeps reporting them
        # forever — the row that says they missed a Tuesday in March is permanent.
        #
        # An appointment is answered by any of three things: the member attended
        # (a settled record dated on or after the one they missed), the
        # requirement was waived, or they hold a later booking that has not come
        # round yet. A settled record with no completed_date is not evidence of
        # *when* they attended, so it answers nothing — over-reporting a
        # "reschedule this" is the safer direction than hiding a member who never
        # had their physical.
        answered = (
            select(ScreeningRecord.id)
            .where(
                ScreeningRecord.organization_id == ctx.organization_id,
                ScreeningRecord.user_id == _OVERDUE_ALIAS.user_id,
                ScreeningRecord.screening_type == _OVERDUE_ALIAS.screening_type,
                ScreeningRecord.id != _OVERDUE_ALIAS.id,
                or_(
                    ScreeningRecord.status == ScreeningStatus.WAIVED,
                    and_(
                        ScreeningRecord.status.in_(_ATTENDED_STATUSES),
                        ScreeningRecord.completed_date.isnot(None),
                        ScreeningRecord.completed_date >= _OVERDUE_ALIAS.scheduled_date,
                    ),
                    and_(
                        ScreeningRecord.status == ScreeningStatus.SCHEDULED,
                        ScreeningRecord.scheduled_date.isnot(None),
                        ScreeningRecord.scheduled_date >= ctx.today,
                    ),
                ),
            )
            .exists()
        )
        missed = (
            select(
                _OVERDUE_ALIAS.user_id,
                _OVERDUE_ALIAS.screening_type,
                func.min(_OVERDUE_ALIAS.scheduled_date).label("missed_on"),
            )
            .join(User, _OVERDUE_ALIAS.user_id == User.id)
            .where(
                _OVERDUE_ALIAS.organization_id == ctx.organization_id,
                _OVERDUE_ALIAS.status == ScreeningStatus.SCHEDULED,
                _OVERDUE_ALIAS.scheduled_date.isnot(None),
                _OVERDUE_ALIAS.scheduled_date < ctx.today,
                # An appointment somebody off the roster missed is history, not work.
                User.organization_id == ctx.organization_id,
                *_active_member_criteria(),
                ~answered,
            )
            .group_by(_OVERDUE_ALIAS.user_id, _OVERDUE_ALIAS.screening_type)
            .subquery()
        )
        overdue_row = (
            await ctx.db.execute(
                select(func.count(), func.min(missed.c.missed_on)).select_from(missed)
            )
        ).one()
        overdue_count, oldest_due = int(overdue_row[0] or 0), overdue_row[1]
        if overdue_count:
            age = _age_days(oldest_due, ctx.today)
            items.append(
                AdminAttentionItem(
                    key="overdue_screenings",
                    title=(
                        f"{overdue_count} medical "
                        f"{_plural(overdue_count, 'screening')} never completed"
                    ),
                    detail=_waiting_phrase(age) or "scheduled date has passed",
                    action_label="Reschedule",
                    href="/medical-screening",
                    count=overdue_count,
                    oldest_age_days=age,
                )
            )

    if "prospective_members" in ctx.enabled_modules:
        cutoff = ctx.local_midnight - timedelta(days=PROSPECT_SLA_DAYS)
        stalled_count, oldest_applied = await _count_and_oldest(
            ctx.db,
            ProspectiveMember,
            ProspectiveMember.organization_id == ctx.organization_id,
            ProspectiveMember.status == ProspectStatus.ACTIVE,
            ProspectiveMember.created_at < cutoff,
            date_column=ProspectiveMember.created_at,
        )
        if stalled_count:
            age = _age_days(oldest_applied, ctx.today)
            items.append(
                AdminAttentionItem(
                    key="stalled_prospects",
                    title=(
                        f"{stalled_count} "
                        f"{_plural(stalled_count, 'application')} waiting over "
                        f"{PROSPECT_SLA_DAYS} days"
                    ),
                    detail=_waiting_phrase(age),
                    action_label="Open pipeline",
                    href="/prospective-members",
                    count=stalled_count,
                    oldest_age_days=age,
                )
            )

    return items


# ── Training ────────────────────────────────────────────────────────────────


async def _training_compliance(ctx: MetricContext) -> tuple[str, str]:
    pct = await compute_org_compliance_pct(ctx.db, ctx.organization_id)
    active = await _scalar(
        ctx.db,
        select(func.count(User.id)).where(
            User.organization_id == ctx.organization_id, *_active_member_criteria()
        ),
    )
    compliant = round(active * pct / 100) if active else 0
    return f"{round(pct)}%", f"{compliant} of {active} members current"


async def _training_hours_quarter(ctx: MetricContext) -> tuple[str, str]:
    start = _quarter_start(ctx.today)
    total = (
        await ctx.db.execute(
            select(func.coalesce(func.sum(TrainingRecord.hours_completed), 0)).where(
                TrainingRecord.organization_id == ctx.organization_id,
                TrainingRecord.status == TrainingStatus.COMPLETED,
                TrainingRecord.completion_date >= start,
            )
        )
    ).scalar()
    quarter = (start.month - 1) // 3 + 1
    return _fmt_hours(total), f"Q{quarter} {start.year} to date"


async def _training_active_programs(ctx: MetricContext) -> tuple[str, str]:
    programs = await _scalar(
        ctx.db,
        select(func.count(TrainingProgram.id)).where(
            TrainingProgram.organization_id == ctx.organization_id,
            TrainingProgram.active.is_(True),
        ),
    )
    enrolled = await _scalar(
        ctx.db,
        select(func.count(ProgramEnrollment.id)).where(
            ProgramEnrollment.organization_id == ctx.organization_id,
            ProgramEnrollment.status == EnrollmentStatus.ACTIVE,
        ),
    )
    return _fmt_int(programs), f"{enrolled} {_plural(enrolled, 'member')} enrolled"


async def _training_avg_hours(ctx: MetricContext) -> tuple[str, str]:
    active = await _scalar(
        ctx.db,
        select(func.count(User.id)).where(
            User.organization_id == ctx.organization_id, *_active_member_criteria()
        ),
    )
    if active == 0:
        return UNKNOWN_VALUE, "no active members"
    total = (
        await ctx.db.execute(
            select(func.coalesce(func.sum(TrainingRecord.hours_completed), 0)).where(
                TrainingRecord.organization_id == ctx.organization_id,
                TrainingRecord.status == TrainingStatus.COMPLETED,
                TrainingRecord.completion_date >= ctx.today - timedelta(days=365),
            )
        )
    ).scalar()
    return f"{float(total or 0) / active:.1f}", "per member, rolling 12 months"


async def _training_certs_this_year(ctx: MetricContext) -> tuple[str, str]:
    count = await _scalar(
        ctx.db,
        select(func.count(TrainingRecord.id)).where(
            TrainingRecord.organization_id == ctx.organization_id,
            TrainingRecord.training_type == TrainingType.CERTIFICATION,
            TrainingRecord.status == TrainingStatus.COMPLETED,
            TrainingRecord.completion_date >= date(ctx.today.year, 1, 1),
        ),
    )
    return _fmt_int(count), f"recorded since Jan 1, {ctx.today.year}"


async def _training_skills_passed(ctx: MetricContext) -> tuple[str, str]:
    count = await _scalar(
        ctx.db,
        select(func.count(SkillTest.id)).where(
            SkillTest.organization_id == ctx.organization_id,
            # skill_tests.status/result are plain VARCHARs, so compare the
            # enum's value rather than the member.
            SkillTest.status == SkillTestStatus.COMPLETED.value,
            SkillTest.result == SkillTestResult.PASS.value,
        ),
    )
    return _fmt_int(count), "passed to date"


async def _skills_testing_available(ctx: MetricContext) -> Optional[str]:
    templates = await _scalar(
        ctx.db,
        select(func.count(SkillTemplate.id)).where(
            SkillTemplate.organization_id == ctx.organization_id
        ),
    )
    if templates == 0:
        return "Needs at least one skills-test template"
    return None


async def _training_cost_per_hour(ctx: MetricContext) -> tuple[str, str]:
    # Unreachable while ``_course_costs_available`` always reports unavailable;
    # kept so the metric works the day course costs are recorded.
    return UNKNOWN_VALUE, "course costs are not recorded"


async def _course_costs_available(ctx: MetricContext) -> Optional[str]:
    return "Needs course costs entered in the Course Library"


async def _training_attention(ctx: MetricContext) -> list[AdminAttentionItem]:
    items: list[AdminAttentionItem] = []

    pending_count, oldest_submitted = await _count_and_oldest(
        ctx.db,
        TrainingSubmission,
        TrainingSubmission.organization_id == ctx.organization_id,
        TrainingSubmission.status == SubmissionStatus.PENDING_REVIEW,
        date_column=TrainingSubmission.submitted_at,
    )
    if pending_count:
        hours = (
            await ctx.db.execute(
                select(
                    func.coalesce(func.sum(TrainingSubmission.hours_completed), 0)
                ).where(
                    TrainingSubmission.organization_id == ctx.organization_id,
                    TrainingSubmission.status == SubmissionStatus.PENDING_REVIEW,
                )
            )
        ).scalar()
        age = _age_days(oldest_submitted, ctx.today)
        items.append(
            AdminAttentionItem(
                key="pending_submissions",
                title=(
                    f"{pending_count} training "
                    f"{_plural(pending_count, 'submission')} awaiting approval"
                ),
                detail=" · ".join(
                    part
                    for part in (
                        _waiting_phrase(age),
                        f"{_fmt_hours(hours)} hours total",
                    )
                    if part
                ),
                action_label="Review queue",
                href="/training/admin?page=records&tab=submissions",
                severity="critical",
                count=pending_count,
                oldest_age_days=age,
            )
        )

    horizon = ctx.today + timedelta(days=EXPIRY_HORIZON_DAYS)
    expiring_count, soonest = await _count_and_oldest(
        ctx.db,
        TrainingRecord,
        TrainingRecord.organization_id == ctx.organization_id,
        TrainingRecord.training_type == TrainingType.CERTIFICATION,
        TrainingRecord.status == TrainingStatus.COMPLETED,
        TrainingRecord.expiration_date.isnot(None),
        TrainingRecord.expiration_date >= ctx.today,
        TrainingRecord.expiration_date <= horizon,
        date_column=TrainingRecord.expiration_date,
    )
    if expiring_count:
        days_out = (soonest - ctx.today).days if soonest else None
        items.append(
            AdminAttentionItem(
                key="expiring_certifications",
                title=(
                    f"{expiring_count} "
                    f"{_plural(expiring_count, 'certification')} expire within "
                    f"{EXPIRY_HORIZON_DAYS} days"
                ),
                detail=(
                    f"soonest in {days_out} {_plural(days_out, 'day')}"
                    if days_out is not None
                    else ""
                ),
                action_label="Notify members",
                href="/training/admin?page=dashboard&tab=expiring-certs",
                count=expiring_count,
                oldest_age_days=None,
            )
        )

    expired_count, oldest_expired = await _count_and_oldest(
        ctx.db,
        TrainingRecord,
        TrainingRecord.organization_id == ctx.organization_id,
        TrainingRecord.training_type == TrainingType.CERTIFICATION,
        TrainingRecord.status == TrainingStatus.COMPLETED,
        TrainingRecord.expiration_date.isnot(None),
        TrainingRecord.expiration_date < ctx.today,
        date_column=TrainingRecord.expiration_date,
    )
    if expired_count:
        age = _age_days(oldest_expired, ctx.today)
        items.append(
            AdminAttentionItem(
                key="expired_certifications",
                title=(
                    f"{expired_count} "
                    f"{_plural(expired_count, 'certification')} already expired"
                ),
                detail=(
                    f"oldest lapsed {age} {_plural(age, 'day')} ago"
                    if age is not None
                    else ""
                ),
                action_label="Open certifications",
                href="/training/admin?page=dashboard&tab=expiring-certs",
                severity="critical",
                count=expired_count,
                oldest_age_days=age,
            )
        )

    return items


# ── Inventory ───────────────────────────────────────────────────────────────


def _in_service_criteria():
    return (InventoryItem.status != ItemStatus.RETIRED,)


def _below_par_criteria(ctx: MetricContext):
    return (
        InventoryItem.organization_id == ctx.organization_id,
        InventoryItem.tracking_type == TrackingType.POOL,
        InventoryItem.reorder_point.isnot(None),
        InventoryItem.quantity <= InventoryItem.reorder_point,
        *_in_service_criteria(),
    )


async def _inventory_items_tracked(ctx: MetricContext) -> tuple[str, str]:
    count = await _scalar(
        ctx.db,
        select(func.count(InventoryItem.id)).where(
            InventoryItem.organization_id == ctx.organization_id,
            *_in_service_criteria(),
        ),
    )
    return _fmt_int(count), "in service"


async def _inventory_issued(ctx: MetricContext) -> tuple[str, str]:
    count = await _scalar(
        ctx.db,
        select(func.count(ItemIssuance.id)).where(
            ItemIssuance.organization_id == ctx.organization_id,
            ItemIssuance.is_returned.is_(False),
        ),
    )
    members = await _scalar(
        ctx.db,
        select(func.count(func.distinct(ItemIssuance.user_id))).where(
            ItemIssuance.organization_id == ctx.organization_id,
            ItemIssuance.is_returned.is_(False),
        ),
    )
    return _fmt_int(count), f"held by {members} {_plural(members, 'member')}"


async def _inventory_out_for_repair(ctx: MetricContext) -> tuple[str, str]:
    count = await _scalar(
        ctx.db,
        select(func.count(InventoryItem.id)).where(
            InventoryItem.organization_id == ctx.organization_id,
            InventoryItem.status == ItemStatus.IN_MAINTENANCE,
        ),
    )
    return _fmt_int(count), "in maintenance"


async def _inventory_below_par(ctx: MetricContext) -> tuple[str, str]:
    count = await _scalar(
        ctx.db, select(func.count(InventoryItem.id)).where(*_below_par_criteria(ctx))
    )
    return _fmt_int(count), "pool items at or under par"


async def _inventory_open_requests(ctx: MetricContext) -> tuple[str, str]:
    count = await _scalar(
        ctx.db,
        select(func.count(EquipmentRequest.id)).where(
            EquipmentRequest.organization_id == ctx.organization_id,
            EquipmentRequest.status == RequestStatus.PENDING,
        ),
    )
    return _fmt_int(count), "awaiting a decision"


async def _inventory_assigned(ctx: MetricContext) -> tuple[str, str]:
    count = await _scalar(
        ctx.db,
        select(func.count(InventoryItem.id)).where(
            InventoryItem.organization_id == ctx.organization_id,
            InventoryItem.status == ItemStatus.ASSIGNED,
        ),
    )
    return _fmt_int(count), "permanently assigned"


async def _inventory_attention(ctx: MetricContext) -> list[AdminAttentionItem]:
    items: list[AdminAttentionItem] = []

    # An item past its NFPA retirement date that is still issued is the
    # exception; one already retired is simply history.
    past_life_count, oldest_retirement = await _count_and_oldest(
        ctx.db,
        NFPAItemCompliance,
        NFPAItemCompliance.organization_id == ctx.organization_id,
        NFPAItemCompliance.expected_retirement_date.isnot(None),
        NFPAItemCompliance.expected_retirement_date < ctx.today,
        NFPAItemCompliance.item_id.in_(
            select(InventoryItem.id).where(
                InventoryItem.organization_id == ctx.organization_id,
                *_in_service_criteria(),
            )
        ),
        date_column=NFPAItemCompliance.expected_retirement_date,
    )
    if past_life_count:
        age = _age_days(oldest_retirement, ctx.today)
        items.append(
            AdminAttentionItem(
                key="past_service_life",
                title=(
                    f"{past_life_count} PPE {_plural(past_life_count, 'item')} "
                    "past service life"
                ),
                detail=" · ".join(
                    part
                    for part in (
                        "NFPA 1851",
                        (
                            f"oldest {age} {_plural(age, 'day')} over"
                            if age is not None
                            else ""
                        ),
                        "still in service",
                    )
                    if part
                ),
                action_label="Start replacement",
                href="/inventory/admin/maintenance",
                severity="critical",
                count=past_life_count,
                oldest_age_days=age,
            )
        )

    below_par = await _scalar(
        ctx.db, select(func.count(InventoryItem.id)).where(*_below_par_criteria(ctx))
    )
    if below_par:
        out_of_stock = await _scalar(
            ctx.db,
            select(func.count(InventoryItem.id)).where(
                *_below_par_criteria(ctx), InventoryItem.quantity <= 0
            ),
        )
        items.append(
            AdminAttentionItem(
                key="below_par",
                title=f"{below_par} {_plural(below_par, 'item')} below par level",
                detail=(
                    f"{out_of_stock} out of stock entirely"
                    if out_of_stock
                    else "reorder before the next issue"
                ),
                action_label="Build order",
                href="/inventory/admin/reorder",
                severity="critical" if out_of_stock else "warning",
                count=below_par,
                oldest_age_days=None,
            )
        )

    horizon = ctx.today + timedelta(days=EXPIRY_HORIZON_DAYS)
    hydro_count, soonest = await _count_and_oldest(
        ctx.db,
        NFPAItemCompliance,
        NFPAItemCompliance.organization_id == ctx.organization_id,
        NFPAItemCompliance.hydrostatic_test_due.isnot(None),
        NFPAItemCompliance.hydrostatic_test_due <= horizon,
        NFPAItemCompliance.item_id.in_(
            select(InventoryItem.id).where(
                InventoryItem.organization_id == ctx.organization_id,
                *_in_service_criteria(),
            )
        ),
        date_column=NFPAItemCompliance.hydrostatic_test_due,
    )
    if hydro_count:
        overdue = soonest is not None and soonest < ctx.today
        days_out = (soonest - ctx.today).days if soonest else None
        items.append(
            AdminAttentionItem(
                key="hydro_test_due",
                title=(
                    f"SCBA hydro test due — {hydro_count} "
                    f"{_plural(hydro_count, 'cylinder')}"
                ),
                detail=(
                    "already overdue"
                    if overdue
                    else (
                        f"soonest in {days_out} {_plural(days_out, 'day')} · "
                        "vendor scheduling takes weeks"
                        if days_out is not None
                        else ""
                    )
                ),
                action_label="Book vendor",
                href="/inventory/admin/maintenance",
                severity="critical" if overdue else "warning",
                count=hydro_count,
                oldest_age_days=_age_days(soonest, ctx.today) if overdue else None,
            )
        )

    request_count, oldest_request = await _count_and_oldest(
        ctx.db,
        EquipmentRequest,
        EquipmentRequest.organization_id == ctx.organization_id,
        EquipmentRequest.status == RequestStatus.PENDING,
        date_column=EquipmentRequest.created_at,
    )
    if request_count:
        age = _age_days(oldest_request, ctx.today)
        items.append(
            AdminAttentionItem(
                key="pending_equipment_requests",
                title=(
                    f"{request_count} equipment "
                    f"{_plural(request_count, 'request')} awaiting a decision"
                ),
                detail=_waiting_phrase(age),
                action_label="Open requests",
                href="/inventory/admin/requests",
                count=request_count,
                oldest_age_days=age,
            )
        )

    return items


# ── Events ──────────────────────────────────────────────────────────────────


async def _events_upcoming(ctx: MetricContext) -> tuple[str, str]:
    now = datetime.now(timezone.utc)
    count = await _scalar(
        ctx.db,
        select(func.count(Event.id)).where(
            Event.organization_id == ctx.organization_id,
            Event.start_datetime >= now,
            Event.start_datetime < now + timedelta(days=30),
            Event.is_cancelled.is_(False),
        ),
    )
    return _fmt_int(count), "in the next 30 days"


async def _events_rsvps_this_week(ctx: MetricContext) -> tuple[str, str]:
    since = ctx.local_midnight - timedelta(days=7)
    total = await _scalar(
        ctx.db,
        select(func.count(EventRSVP.id)).where(
            EventRSVP.organization_id == ctx.organization_id,
            EventRSVP.responded_at >= since,
        ),
    )
    going = await _scalar(
        ctx.db,
        select(func.count(EventRSVP.id)).where(
            EventRSVP.organization_id == ctx.organization_id,
            EventRSVP.responded_at >= since,
            EventRSVP.status == RSVPStatus.GOING,
        ),
    )
    return _fmt_int(total), f"{going} going"


async def _events_check_ins(ctx: MetricContext) -> tuple[str, str]:
    since = ctx.local_midnight - timedelta(days=30)
    count = await _scalar(
        ctx.db,
        select(func.count(EventRSVP.id)).where(
            EventRSVP.organization_id == ctx.organization_id,
            EventRSVP.checked_in.is_(True),
            EventRSVP.checked_in_at >= since,
        ),
    )
    return _fmt_int(count), "logged in the last 30 days"


async def _events_attendance_rate(ctx: MetricContext) -> tuple[str, str]:
    since = ctx.local_midnight - timedelta(days=90)
    now = datetime.now(timezone.utc)
    # Event is filtered on organization_id independently of the RSVP filter
    # above it, rather than relying on the invariant that a joined RSVP's org
    # always matches its parent Event's org (defense in depth, LOC2-32-1).
    going = await _scalar(
        ctx.db,
        select(func.count(EventRSVP.id))
        .join(Event, EventRSVP.event_id == Event.id)
        .where(
            EventRSVP.organization_id == ctx.organization_id,
            EventRSVP.status == RSVPStatus.GOING,
            Event.organization_id == ctx.organization_id,
            Event.start_datetime >= since,
            Event.end_datetime < now,
        ),
    )
    if going == 0:
        return UNKNOWN_VALUE, "no completed events with RSVPs"
    attended = await _scalar(
        ctx.db,
        select(func.count(EventRSVP.id))
        .join(Event, EventRSVP.event_id == Event.id)
        .where(
            EventRSVP.organization_id == ctx.organization_id,
            EventRSVP.status == RSVPStatus.GOING,
            EventRSVP.checked_in.is_(True),
            Event.organization_id == ctx.organization_id,
            Event.start_datetime >= since,
            Event.end_datetime < now,
        ),
    )
    return f"{round(attended * 100 / going)}%", f"{attended} of {going}, last 90 days"


async def _events_training_events(ctx: MetricContext) -> tuple[str, str]:
    now = datetime.now(timezone.utc)
    count = await _scalar(
        ctx.db,
        select(func.count(Event.id)).where(
            Event.organization_id == ctx.organization_id,
            Event.event_type == EventType.TRAINING,
            Event.start_datetime >= now,
            Event.is_cancelled.is_(False),
        ),
    )
    return _fmt_int(count), "drills scheduled ahead"


async def _events_open_requests(ctx: MetricContext) -> tuple[str, str]:
    count = await _scalar(
        ctx.db,
        select(func.count(EventRequest.id)).where(
            EventRequest.organization_id == ctx.organization_id,
            EventRequest.status.in_(
                [EventRequestStatus.SUBMITTED, EventRequestStatus.IN_PROGRESS]
            ),
        ),
    )
    return _fmt_int(count), "public requests in flight"


async def _events_attention(ctx: MetricContext) -> list[AdminAttentionItem]:
    items: list[AdminAttentionItem] = []
    now = datetime.now(timezone.utc)

    request_count, oldest_request = await _count_and_oldest(
        ctx.db,
        EventRequest,
        EventRequest.organization_id == ctx.organization_id,
        EventRequest.status == EventRequestStatus.SUBMITTED,
        date_column=EventRequest.created_at,
    )
    if request_count:
        age = _age_days(oldest_request, ctx.today)
        items.append(
            AdminAttentionItem(
                key="pending_event_requests",
                title=(
                    f"{request_count} public event "
                    f"{_plural(request_count, 'request')} awaiting a reply"
                ),
                detail=_waiting_phrase(age),
                action_label="Open requests",
                href="/events/admin?tab=requests",
                severity="critical",
                count=request_count,
                oldest_age_days=age,
            )
        )

    # An event that wants RSVPs and has none is the one staffing signal the
    # data can carry: events record a cap, never a crew requirement, so
    # "3 members short" is not something this schema can honestly compute.
    going_per_event = (
        select(EventRSVP.event_id)
        .where(
            EventRSVP.organization_id == ctx.organization_id,
            EventRSVP.status == RSVPStatus.GOING,
        )
        .distinct()
    )
    unanswered_count, soonest = await _count_and_oldest(
        ctx.db,
        Event,
        Event.organization_id == ctx.organization_id,
        Event.requires_rsvp.is_(True),
        Event.is_cancelled.is_(False),
        Event.start_datetime >= now,
        Event.start_datetime < now + timedelta(days=EVENT_HORIZON_DAYS),
        Event.id.notin_(going_per_event),
        date_column=Event.start_datetime,
    )
    if unanswered_count:
        days_out = (
            (soonest.date() - ctx.today).days if isinstance(soonest, datetime) else None
        )
        items.append(
            AdminAttentionItem(
                key="events_without_rsvps",
                title=(
                    f"{unanswered_count} upcoming "
                    f"{_plural(unanswered_count, 'event')} with nobody signed up"
                ),
                detail=(
                    "soonest starts today"
                    if days_out == 0
                    else (
                        f"soonest starts in {days_out} " f"{_plural(days_out, 'day')}"
                        if days_out is not None
                        else "RSVPs are open"
                    )
                ),
                action_label="Send call-out",
                href="/events",
                severity="critical",
                count=unanswered_count,
                oldest_age_days=None,
            )
        )

    # Attendance that was never recorded stops counting toward tier
    # requirements, and the longer it sits the less anyone remembers.
    attended_events = (
        select(EventRSVP.event_id)
        .where(
            EventRSVP.organization_id == ctx.organization_id,
            EventRSVP.checked_in.is_(True),
        )
        .distinct()
    )
    unrecorded_count, oldest_unrecorded = await _count_and_oldest(
        ctx.db,
        Event,
        Event.organization_id == ctx.organization_id,
        Event.is_cancelled.is_(False),
        Event.end_datetime < now,
        Event.end_datetime >= now - timedelta(days=30),
        Event.id.in_(going_per_event),
        Event.id.notin_(attended_events),
        date_column=Event.end_datetime,
    )
    if unrecorded_count:
        age = _age_days(oldest_unrecorded, ctx.today)
        items.append(
            AdminAttentionItem(
                key="unrecorded_attendance",
                title=(
                    f"{unrecorded_count} finished "
                    f"{_plural(unrecorded_count, 'event')} with no attendance "
                    "recorded"
                ),
                detail=" · ".join(
                    part
                    for part in (
                        _waiting_phrase(age),
                        "does not count toward tier requirements",
                    )
                    if part
                ),
                action_label="Record attendance",
                href="/events/admin?tab=past_events",
                count=unrecorded_count,
                oldest_age_days=age,
            )
        )

    return items


# ── Department store ────────────────────────────────────────────────────────
#
# The store sells the uniforms the inventory module tracks, and its admin page
# now lives inside Inventory Administration — so it renders the same frame as
# every other admin page, and the frame needs a module spec to fill.
#
# The money and the fulfillment are counted separately on purpose: an order can
# be paid and undelivered, or delivered and unpaid, and the store's model
# tracks `payment_status` apart from `status` for exactly that reason.

#: Orders still needing somebody to do something. Fulfilled and cancelled ones
#: are history; everything between is work.
_OPEN_ORDER_STATUSES = (
    StoreOrderStatus.SUBMITTED,
    StoreOrderStatus.AWAITING_PAYMENT,
    StoreOrderStatus.PAID,
    StoreOrderStatus.ORDERED,
    StoreOrderStatus.READY_FOR_PICKUP,
)

#: Reported payments the automatic matcher could not settle. `MATCHED` is here
#: too: it found an order and stopped short of applying the money, so a person
#: still has to agree before the balance moves.
_UNSETTLED_PAYMENT_EVENTS = (
    StorePaymentEventStatus.UNMATCHED,
    StorePaymentEventStatus.AMBIGUOUS,
    StorePaymentEventStatus.MATCHED,
)


def _store_pending_verification_criteria(organization_id: str):
    """Orders whose reported payment nobody has checked yet.

    Cancelled orders are excluded, and that exclusion is load-bearing rather
    than tidy: `cancel_order` leaves `payment_status` untouched, so an order
    cancelled while awaiting verification keeps the flag for ever — and
    recording a payment against a cancelled order is refused, so the work this
    would advertise cannot be done. Without it this is a queue row that never
    clears and never can.
    """
    return (
        StoreOrder.organization_id == organization_id,
        StoreOrder.status != StoreOrderStatus.CANCELLED,
        StoreOrder.payment_status == StorePaymentStatus.PENDING_VERIFICATION,
    )


def _store_open_orders_criteria(organization_id: str):
    return (
        StoreOrder.organization_id == organization_id,
        StoreOrder.status.in_(_OPEN_ORDER_STATUSES),
    )


async def _store_open_orders(ctx: MetricContext) -> tuple[str, str]:
    count = await _scalar(
        ctx.db,
        select(func.count(StoreOrder.id)).where(
            *_store_open_orders_criteria(ctx.organization_id)
        ),
    )
    ready = await _scalar(
        ctx.db,
        select(func.count(StoreOrder.id)).where(
            StoreOrder.organization_id == ctx.organization_id,
            StoreOrder.status == StoreOrderStatus.READY_FOR_PICKUP,
        ),
    )
    return _fmt_int(count), f"{ready} ready for pickup"


async def _store_awaiting_payment(ctx: MetricContext) -> tuple[str, str]:
    count = await _scalar(
        ctx.db,
        select(func.count(StoreOrder.id)).where(
            StoreOrder.organization_id == ctx.organization_id,
            StoreOrder.status != StoreOrderStatus.CANCELLED,
            StoreOrder.payment_status.in_(
                (StorePaymentStatus.UNPAID, StorePaymentStatus.PARTIAL)
            ),
        ),
    )
    return _fmt_int(count), "unpaid or part-paid"


async def _store_outstanding_balance(ctx: MetricContext) -> tuple[str, str]:
    """What members still owe: the total less what has actually landed.

    Cancelled orders are excluded — nobody owes for an order that was called
    off — and the sum is floored at zero per row, so an overpayment sitting on
    one order cannot quietly cancel out a genuine debt on another.
    """
    total = (
        await ctx.db.execute(
            select(
                func.coalesce(
                    func.sum(
                        func.greatest(StoreOrder.total - StoreOrder.amount_paid, 0)
                    ),
                    0,
                )
            ).where(
                StoreOrder.organization_id == ctx.organization_id,
                StoreOrder.status != StoreOrderStatus.CANCELLED,
                StoreOrder.payment_status.notin_(
                    (StorePaymentStatus.PAID, StorePaymentStatus.WAIVED)
                ),
            )
        )
    ).scalar()
    orders = await _scalar(
        ctx.db,
        select(func.count(StoreOrder.id)).where(
            StoreOrder.organization_id == ctx.organization_id,
            StoreOrder.status != StoreOrderStatus.CANCELLED,
            StoreOrder.payment_status.notin_(
                (StorePaymentStatus.PAID, StorePaymentStatus.WAIVED)
            ),
        ),
    )
    return _fmt_money(total), f"across {orders} {_plural(orders, 'order')}"


async def _store_pending_verification(ctx: MetricContext) -> tuple[str, str]:
    count = await _scalar(
        ctx.db,
        select(func.count(StoreOrder.id)).where(
            *_store_pending_verification_criteria(ctx.organization_id)
        ),
    )
    return _fmt_int(count), "member says they paid"


async def _store_ready_for_pickup(ctx: MetricContext) -> tuple[str, str]:
    count = await _scalar(
        ctx.db,
        select(func.count(StoreOrder.id)).where(
            StoreOrder.organization_id == ctx.organization_id,
            StoreOrder.status == StoreOrderStatus.READY_FOR_PICKUP,
        ),
    )
    return _fmt_int(count), "waiting to be collected"


async def _store_active_products(ctx: MetricContext) -> tuple[str, str]:
    count = await _scalar(
        ctx.db,
        select(func.count(StoreProduct.id)).where(
            StoreProduct.organization_id == ctx.organization_id,
            StoreProduct.status == StoreProductStatus.ACTIVE,
        ),
    )
    drafts = await _scalar(
        ctx.db,
        select(func.count(StoreProduct.id)).where(
            StoreProduct.organization_id == ctx.organization_id,
            StoreProduct.status == StoreProductStatus.DRAFT,
        ),
    )
    return _fmt_int(count), f"{drafts} still in draft"


async def _storefront_attention(ctx: MetricContext) -> list[AdminAttentionItem]:
    items: list[AdminAttentionItem] = []

    # A member has said they paid and nobody has agreed yet. Their order does
    # not move until somebody looks, so this is the queue that stalls people.
    verify_count, oldest_reported = await _count_and_oldest(
        ctx.db,
        StoreOrder,
        *_store_pending_verification_criteria(ctx.organization_id),
        date_column=StoreOrder.payment_reported_at,
    )
    if verify_count:
        age = _age_days(oldest_reported, ctx.today)
        items.append(
            AdminAttentionItem(
                key="store_pending_verification",
                title=(
                    f"{verify_count} {_plural(verify_count, 'payment')} "
                    "awaiting verification"
                ),
                detail=" · ".join(
                    part
                    for part in (
                        _waiting_phrase(age),
                        "the order does not move until it is checked",
                    )
                    if part
                ),
                action_label="Verify payments",
                # Filtered, not just the tab: this queue counts the reported
                # payments nobody has checked, and an unfiltered order list
                # leaves that work to be found by eye.
                href="/inventory/admin/store?tab=orders&payment=pending_verification",
                severity="warning",
                count=verify_count,
                oldest_age_days=age,
            )
        )

    # Money the provider reported that the matcher could not settle. Left
    # alone it is a member who has paid and is still being chased.
    unsettled_count, oldest_event = await _count_and_oldest(
        ctx.db,
        StorePaymentEvent,
        StorePaymentEvent.organization_id == ctx.organization_id,
        StorePaymentEvent.status.in_(_UNSETTLED_PAYMENT_EVENTS),
        date_column=StorePaymentEvent.created_at,
    )
    if unsettled_count:
        age = _age_days(oldest_event, ctx.today)
        items.append(
            AdminAttentionItem(
                key="store_unmatched_payments",
                title=(
                    f"{unsettled_count} reported "
                    f"{_plural(unsettled_count, 'payment')} unreconciled"
                ),
                detail=" · ".join(
                    part
                    for part in (
                        _waiting_phrase(age),
                        "matched to no order, or matched and not applied",
                    )
                    if part
                ),
                action_label="Reconcile",
                href="/inventory/admin/store?tab=payments",
                severity="warning",
                count=unsettled_count,
                oldest_age_days=age,
            )
        )

    # A window that closed and was never fulfilled is an order period nobody
    # finished handing out — the members have paid and are waiting.
    #
    # Measured from `closed_at`, the moment it actually closed, not `closes_at`,
    # the moment it was scheduled to. `close_window` stamps `closed_at` and is
    # the only writer of the CLOSED status, so the two differ whenever a window
    # is closed late — and a window scheduled two months ago but closed today
    # would otherwise arrive already 60 days stale. It also picks up the case
    # `closes_at` missed entirely: a window managed by hand, with no schedule
    # on it at all, was never reported however long it sat.
    now = datetime.now(timezone.utc)
    stale_count, oldest_close = await _count_and_oldest(
        ctx.db,
        StoreOrderWindow,
        StoreOrderWindow.organization_id == ctx.organization_id,
        StoreOrderWindow.status == StoreWindowStatus.CLOSED,
        StoreOrderWindow.closed_at.isnot(None),
        StoreOrderWindow.closed_at < now - timedelta(days=30),
        date_column=StoreOrderWindow.closed_at,
    )
    if stale_count:
        age = _age_days(oldest_close, ctx.today)
        items.append(
            AdminAttentionItem(
                key="store_unfulfilled_windows",
                title=(
                    f"{stale_count} order {_plural(stale_count, 'window')} "
                    "closed but not fulfilled"
                ),
                detail=" · ".join(
                    part
                    for part in (
                        _waiting_phrase(age),
                        "members have ordered and are waiting on delivery",
                    )
                    if part
                ),
                action_label="Open windows",
                href="/inventory/admin/store?tab=windows",
                severity="warning",
                count=stale_count,
                oldest_age_days=age,
            )
        )

    return items


# ── Registry ────────────────────────────────────────────────────────────────

MODULE_REGISTRY: dict[str, ModuleSpec] = {
    "members": ModuleSpec(
        key="members",
        permission="members.manage",
        default_metrics=("active_members", "probationary_members", "inactive_members"),
        attention=_members_attention,
        attention_permission="medical_screening.view",
        metrics=(
            MetricSpec(
                key="active_members",
                label="Active",
                description="Members on the roster with an active status",
                resolve=_members_active,
            ),
            MetricSpec(
                key="probationary_members",
                label="Probationary",
                description="Members still serving their probationary period",
                resolve=_members_probationary,
            ),
            MetricSpec(
                key="inactive_members",
                label="Inactive",
                description="Members on the roster who are not currently active",
                resolve=_members_inactive,
            ),
            MetricSpec(
                key="members_on_leave",
                label="On leave",
                description="Members on a recorded leave of absence",
                resolve=_members_on_leave,
            ),
            MetricSpec(
                key="screening_current",
                label="Screenings current",
                description=(
                    "Share of active members with an unexpired medical screening"
                ),
                resolve=_members_screening_current,
                permission="medical_screening.view",
                requires_module="medical_screening",
                module_off_reason="Needs the Medical Screening module",
            ),
            MetricSpec(
                key="prospective_members",
                label="Prospects",
                description="Applicants moving through the membership pipeline",
                resolve=_members_prospective,
                requires_module="prospective_members",
                module_off_reason="Needs the Prospective Members module",
            ),
        ),
    ),
    "training": ModuleSpec(
        key="training",
        permission="training.manage",
        requires_module="training",
        default_metrics=("compliance_rate", "hours_this_quarter", "active_programs"),
        attention=_training_attention,
        metrics=(
            MetricSpec(
                key="compliance_rate",
                label="Compliance",
                description=(
                    "Share of active members current on the department's required "
                    "certifications"
                ),
                resolve=_training_compliance,
            ),
            MetricSpec(
                key="hours_this_quarter",
                label="Hours this quarter",
                description="Approved training hours completed since the quarter began",
                resolve=_training_hours_quarter,
            ),
            MetricSpec(
                key="active_programs",
                label="Active programs",
                description="Training programs currently open for enrollment",
                resolve=_training_active_programs,
            ),
            MetricSpec(
                key="avg_hours_per_member",
                label="Avg hours / member",
                description="Rolling twelve months of approved hours per active member",
                resolve=_training_avg_hours,
            ),
            MetricSpec(
                key="certs_this_year",
                label="Certifications this year",
                description="New certifications recorded since January 1",
                resolve=_training_certs_this_year,
            ),
            MetricSpec(
                key="skills_tests_passed",
                label="Skills tests passed",
                description="Completed skill evaluations with a passing result",
                resolve=_training_skills_passed,
                availability=_skills_testing_available,
            ),
            MetricSpec(
                key="cost_per_training_hour",
                label="Cost per training hour",
                description="Course spend divided by approved hours delivered",
                resolve=_training_cost_per_hour,
                availability=_course_costs_available,
            ),
        ),
    ),
    "inventory": ModuleSpec(
        key="inventory",
        permission="inventory.manage",
        requires_module="inventory",
        default_metrics=("items_tracked", "issued_to_members", "out_for_repair"),
        attention=_inventory_attention,
        metrics=(
            MetricSpec(
                key="items_tracked",
                label="Items tracked",
                description="Every item on the books that has not been retired",
                resolve=_inventory_items_tracked,
            ),
            MetricSpec(
                key="issued_to_members",
                label="Issued to members",
                description="Open issuances — gear a member still holds",
                resolve=_inventory_issued,
            ),
            MetricSpec(
                key="out_for_repair",
                label="Out for repair",
                description="Items sitting in maintenance rather than in service",
                resolve=_inventory_out_for_repair,
            ),
            MetricSpec(
                key="below_par_items",
                label="Below par",
                description="Pool items at or under their reorder point",
                resolve=_inventory_below_par,
            ),
            MetricSpec(
                key="assigned_items",
                label="Permanently assigned",
                description="Serial-numbered items assigned to one member",
                resolve=_inventory_assigned,
            ),
            MetricSpec(
                key="open_equipment_requests",
                label="Open requests",
                description="Member equipment requests awaiting a decision",
                resolve=_inventory_open_requests,
            ),
        ),
    ),
    "events": ModuleSpec(
        key="events",
        permission="events.manage",
        default_metrics=("upcoming_events", "rsvps_this_week", "check_ins_logged"),
        attention=_events_attention,
        metrics=(
            MetricSpec(
                key="upcoming_events",
                label="Upcoming",
                description="Events starting in the next 30 days",
                resolve=_events_upcoming,
            ),
            MetricSpec(
                key="rsvps_this_week",
                label="RSVPs this week",
                description="Responses recorded in the last seven days",
                resolve=_events_rsvps_this_week,
            ),
            MetricSpec(
                key="check_ins_logged",
                label="Check-ins logged",
                description="Attendance captured in the last 30 days",
                resolve=_events_check_ins,
            ),
            MetricSpec(
                key="attendance_rate",
                label="Attendance rate",
                description=(
                    "Check-ins against members who said they were going, "
                    "last 90 days"
                ),
                resolve=_events_attendance_rate,
            ),
            MetricSpec(
                key="training_events",
                label="Drills scheduled",
                description="Upcoming events filed as training",
                resolve=_events_training_events,
            ),
            MetricSpec(
                key="open_event_requests",
                label="Public requests",
                description="Community event requests not yet completed or declined",
                resolve=_events_open_requests,
            ),
        ),
    ),
    "storefront": ModuleSpec(
        key="storefront",
        permission="storefront.manage",
        requires_module="storefront",
        default_metrics=("open_orders", "awaiting_payment", "outstanding_balance"),
        attention=_storefront_attention,
        metrics=(
            MetricSpec(
                key="open_orders",
                label="Open orders",
                description="Member orders that are neither fulfilled nor cancelled",
                resolve=_store_open_orders,
            ),
            MetricSpec(
                key="awaiting_payment",
                label="Awaiting payment",
                description="Orders with money still owed on them",
                resolve=_store_awaiting_payment,
            ),
            MetricSpec(
                key="outstanding_balance",
                label="Outstanding",
                description="What members still owe across unsettled orders",
                resolve=_store_outstanding_balance,
            ),
            MetricSpec(
                key="pending_verification",
                label="To verify",
                description="Payments a member has reported and nobody has checked",
                resolve=_store_pending_verification,
            ),
            MetricSpec(
                key="ready_for_pickup",
                label="Ready for pickup",
                description="Orders sitting on the shelf waiting to be collected",
                resolve=_store_ready_for_pickup,
            ),
            MetricSpec(
                key="active_products",
                label="Active items",
                description="Catalog products members can currently order",
                resolve=_store_active_products,
            ),
        ),
    ),
}


# ── Service ─────────────────────────────────────────────────────────────────


class AdminHubService:
    """Reads the frame's data for one administration page."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # -- context ------------------------------------------------------------

    async def _context(self, user: User) -> MetricContext:
        org_id = user.organization_id
        org = (
            await self.db.execute(select(Organization).where(Organization.id == org_id))
        ).scalar_one_or_none()
        timezone_name = (org.timezone if org else None) or "UTC"
        try:
            org_tz: ZoneInfo | timezone = ZoneInfo(timezone_name)
        except ZoneInfoNotFoundError:
            timezone_name, org_tz = "UTC", timezone.utc
        local_today = datetime.now(timezone.utc).astimezone(org_tz).date()
        local_midnight = datetime.combine(local_today, time.min, org_tz).astimezone(
            timezone.utc
        )
        enabled = set(
            (
                await OrganizationService(self.db).get_enabled_modules(org_id)
            ).enabled_modules
        )
        return MetricContext(
            db=self.db,
            organization_id=org_id,
            user=user,
            today=local_today,
            timezone_name=timezone_name,
            local_midnight=local_midnight,
            enabled_modules=enabled,
        )

    @staticmethod
    def get_module(module_key: str) -> ModuleSpec:
        spec = MODULE_REGISTRY.get(module_key)
        if spec is None:
            raise ValueError(f"Unknown administration module: {module_key}")
        return spec

    # -- summary ------------------------------------------------------------

    async def get_summary(self, module_key: str, user: User) -> AdminHubSummary:
        spec = self.get_module(module_key)
        ctx = await self._context(user)

        try:
            attention = (
                await spec.attention(ctx)
                if spec.attention_permission is None
                or user_has_permission(user, spec.attention_permission)
                else []
            )
        except Exception as exc:
            # A broken exception query must not take the page down with it —
            # the tab body below is still the admin's work.
            logger.warning("admin-hub {}: attention queue failed: {}", module_key, exc)
            attention = []
        attention.sort(key=lambda item: (item.severity != "critical", -item.count))

        selected = await self._resolve_selection(spec, ctx)
        metrics = [await self._render_metric(spec, key, ctx) for key in selected]
        metrics.append(
            AdminMetric(
                key=ATTENTION_METRIC_KEY,
                label="Needs attention",
                value=_fmt_int(len(attention)),
                context=_attention_context(attention),
                fixed=True,
            )
        )

        return AdminHubSummary(
            module_key=module_key,
            generated_at=datetime.now(timezone.utc),
            timezone=ctx.timezone_name,
            metrics=metrics,
            attention=attention,
        )

    async def _render_metric(
        self, spec: ModuleSpec, key: str, ctx: MetricContext
    ) -> AdminMetric:
        metric = next((m for m in spec.metrics if m.key == key), None)
        if metric is None:
            return AdminMetric(key=key, label=key, value=UNKNOWN_VALUE, context="")
        if metric.permission and not user_has_permission(ctx.user, metric.permission):
            return AdminMetric(
                key=key, label=metric.label, value=UNKNOWN_VALUE, context=""
            )
        try:
            value, context = await metric.resolve(ctx)
        except Exception as exc:
            # One metric that cannot be computed leaves a dash in its card;
            # it does not cost the admin the other three or the queue.
            logger.warning("admin-hub {}: metric {} failed: {}", spec.key, key, exc)
            value, context = UNKNOWN_VALUE, "could not be calculated"
        return AdminMetric(
            key=metric.key, label=metric.label, value=value, context=context
        )

    # -- selection ----------------------------------------------------------

    async def _load_preferences(
        self, module_key: str, ctx: MetricContext
    ) -> tuple[Optional[AdminHubMetricPreference], Optional[AdminHubMetricPreference]]:
        """Return ``(department_row, personal_row)`` for this module."""
        rows = (
            (
                await self.db.execute(
                    select(AdminHubMetricPreference).where(
                        AdminHubMetricPreference.organization_id == ctx.organization_id,
                        AdminHubMetricPreference.module_key == module_key,
                        AdminHubMetricPreference.scope_key.in_(
                            [DEPARTMENT_SCOPE, ctx.user.id]
                        ),
                    )
                )
            )
            .scalars()
            .all()
        )
        department = next((r for r in rows if r.scope_key == DEPARTMENT_SCOPE), None)
        personal = next((r for r in rows if r.scope_key == ctx.user.id), None)
        return department, personal

    def _sanitize(
        self, spec: ModuleSpec, keys: Sequence[str], ctx: MetricContext
    ) -> list[str]:
        """Drop unknown, duplicate, over-count and now-unavailable keys.

        A stored selection outlives the module that fed it: a department that
        turns off Prospective Members must not be left with a card that can
        never render. The slot falls back to the module default rather than
        going blank.
        """

        def _permitted(metric: MetricSpec) -> bool:
            if metric.permission and not user_has_permission(
                ctx.user, metric.permission
            ):
                return False
            if (
                metric.requires_module
                and metric.requires_module not in ctx.enabled_modules
            ):
                return False
            return True

        by_key = {m.key: m for m in spec.metrics}
        resolved: list[str] = []
        for key in keys:
            metric = by_key.get(key)
            if metric is None or key in resolved or not _permitted(metric):
                continue
            resolved.append(key)
            if len(resolved) == OPEN_SLOTS:
                break
        # The padding loop must apply the same permission/module gate as the
        # primary loop above — otherwise a permission-gated metric's label
        # (still shown by _render_metric's redacted-value branch) can be
        # padded straight into a stored selection for an admin who lacks that
        # specific permission (LOC2-32-2).
        for key in spec.default_metrics:
            if len(resolved) >= OPEN_SLOTS:
                break
            if not key or key in resolved:
                continue
            metric = by_key.get(key)
            if metric is None or not _permitted(metric):
                continue
            resolved.append(key)
        return resolved[:OPEN_SLOTS]

    async def _resolve_selection(
        self, spec: ModuleSpec, ctx: MetricContext
    ) -> list[str]:
        department, personal = await self._load_preferences(spec.key, ctx)
        applies_to_everyone = (
            bool(department.applies_to_everyone) if department else True
        )
        if not applies_to_everyone and personal is not None:
            chosen = personal.metric_keys
        elif department is not None:
            chosen = department.metric_keys
        else:
            chosen = list(spec.default_metrics)
        return self._sanitize(spec, list(chosen or []), ctx)

    # -- settings screen ----------------------------------------------------

    async def get_settings(self, module_key: str, user: User) -> AdminMetricSettings:
        spec = self.get_module(module_key)
        ctx = await self._context(user)
        department, personal = await self._load_preferences(module_key, ctx)
        applies_to_everyone = (
            bool(department.applies_to_everyone) if department else True
        )
        selected = await self._resolve_selection(spec, ctx)

        options: list[AdminMetricOption] = []
        for metric in spec.metrics:
            # Do not advertise or preview protected data to an administrator
            # who cannot read the underlying records.
            if metric.permission and not user_has_permission(user, metric.permission):
                continue
            reason: Optional[str] = None
            if (
                metric.requires_module
                and metric.requires_module not in ctx.enabled_modules
            ):
                reason = _module_off_reason(metric)
            elif metric.availability is not None:
                try:
                    reason = await metric.availability(ctx)
                except Exception as exc:
                    logger.warning(
                        "admin-hub {}: availability for {} failed: {}",
                        module_key,
                        metric.key,
                        exc,
                    )
                    reason = "Availability could not be checked"

            value: Optional[str] = None
            if reason is None:
                try:
                    value = (await metric.resolve(ctx))[0]
                except Exception as exc:
                    logger.warning(
                        "admin-hub {}: preview for {} failed: {}",
                        module_key,
                        metric.key,
                        exc,
                    )
                    value = UNKNOWN_VALUE
            options.append(
                AdminMetricOption(
                    key=metric.key,
                    label=metric.label,
                    description=metric.description,
                    value=value,
                    unavailable_reason=reason,
                )
            )

        options.append(
            AdminMetricOption(
                key=ATTENTION_METRIC_KEY,
                label="Needs attention",
                description=(
                    "The count that feeds the queue below. Always slot four — "
                    "it is what the page is for."
                ),
                fixed=True,
            )
        )

        return AdminMetricSettings(
            module_key=module_key,
            options=options,
            selected=selected,
            applies_to_everyone=applies_to_everyone,
            is_personal=not applies_to_everyone and personal is not None,
            department_default=self._sanitize(
                spec,
                list((department.metric_keys if department else None) or []),
                ctx,
            ),
            built_in_default=list(spec.default_metrics),
        )

    async def save_settings(
        self, module_key: str, user: User, payload: AdminMetricSettingsUpdate
    ) -> AdminMetricSettings:
        spec = self.get_module(module_key)
        ctx = await self._context(user)

        by_key = {m.key: m for m in spec.metrics}
        for key in payload.metric_keys:
            if key == ATTENTION_METRIC_KEY:
                raise ValueError(
                    "The attention count is slot four and cannot be moved or removed"
                )
            metric = by_key.get(key)
            if metric is None:
                raise ValueError(f"{module_key} has no metric named '{key}'")
            if metric.permission and not user_has_permission(user, metric.permission):
                raise ValueError(f"'{metric.label}' is not available")
            if (
                metric.requires_module
                and metric.requires_module not in ctx.enabled_modules
            ):
                reason = _module_off_reason(metric)
                raise ValueError(f"'{metric.label}' cannot be shown — {reason}")
            if metric.availability is not None and await metric.availability(ctx):
                raise ValueError(f"'{metric.label}' is not available yet")
        if len(set(payload.metric_keys)) != len(payload.metric_keys):
            raise ValueError("A metric can only occupy one slot")

        # Two concurrent first-time saves for the same (org, module, scope)
        # can both observe department/personal as None and both insert; the
        # unique constraint then rejects the second commit. Retry once as an
        # update against the row the other request just created, instead of
        # surfacing a 500 that silently drops this save (LOC2-32-3).
        for attempt in range(2):
            department, personal = await self._load_preferences(module_key, ctx)

            # The department row always carries the toggle, so turning
            # personal choice back off has somewhere to be recorded even when
            # the admin never edited the department's own four.
            if department is None:
                department = AdminHubMetricPreference(
                    organization_id=ctx.organization_id,
                    module_key=module_key,
                    user_id=None,
                    scope_key=DEPARTMENT_SCOPE,
                    metric_keys=list(spec.default_metrics),
                    applies_to_everyone=payload.applies_to_everyone,
                )
                self.db.add(department)
            department.applies_to_everyone = payload.applies_to_everyone

            if payload.applies_to_everyone:
                department.metric_keys = list(payload.metric_keys)
            else:
                if personal is None:
                    personal = AdminHubMetricPreference(
                        organization_id=ctx.organization_id,
                        module_key=module_key,
                        user_id=ctx.user.id,
                        scope_key=ctx.user.id,
                        metric_keys=list(payload.metric_keys),
                    )
                    self.db.add(personal)
                else:
                    personal.metric_keys = list(payload.metric_keys)

            try:
                await self.db.commit()
                break
            except IntegrityError:
                await self.db.rollback()
                # rollback() expires every persistent object in the session,
                # including ctx.user — the same object this method's caller
                # (and the endpoint, for its audit-log call) keeps using
                # afterward — not just the row(s) this attempt tried to
                # insert. Refresh it explicitly so the retry's permission
                # check (user_has_permission reads user.positions) or a
                # later attribute read doesn't attempt an implicit async
                # reload outside the greenlet bridge and raise
                # MissingGreenlet (Codex, PR #1916).
                await self.db.refresh(ctx.user)
                await self.db.refresh(ctx.user, attribute_names=["positions"])
                if attempt == 1:
                    raise

        return await self.get_settings(module_key, user)

    # -- access -------------------------------------------------------------

    @staticmethod
    def modules_for(user: User) -> list[str]:
        """Module keys this caller may see an administration frame for."""
        return [
            key
            for key, spec in MODULE_REGISTRY.items()
            if user_has_permission(user, spec.permission)
        ]


__all__ = [
    "ATTENTION_METRIC_KEY",
    "MODULE_REGISTRY",
    "OPEN_SLOTS",
    "AdminHubService",
    "MetricContext",
    "MetricSpec",
    "ModuleSpec",
]
