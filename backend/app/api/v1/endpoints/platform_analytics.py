"""
Platform Analytics Endpoints

Provides aggregated platform-wide analytics for IT admins:
user adoption, module usage, operational activity, system health, and content metrics.
"""

from datetime import date, datetime, time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends
from loguru import logger
from sqlalchemy import extract, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_permission
from app.core.database import get_db
from app.models.document import Document
from app.models.election import Election
from app.models.error_log import ErrorLog
from app.models.event import Event, EventRSVP
from app.models.forms import FormSubmission
from app.models.inventory import InventoryItem
from app.models.meeting import Meeting
from app.models.training import Shift, TrainingRecord, TrainingStatus
from app.models.user import User
from app.schemas.platform_analytics import (
    DailyCount,
    ModuleUsage,
    PlatformAnalyticsResponse,
)
from app.services.organization_service import OrganizationService
from app.utils.org_timezone import resolve_reporting_timezone

router = APIRouter()


def _local_midnight_utc(day: date, tz: ZoneInfo) -> datetime:
    """The UTC instant at which ``day`` begins in the organization's zone."""
    return datetime.combine(day, time.min, tzinfo=tz).astimezone(timezone.utc)


async def _local_daily_counts(
    db: AsyncSession,
    column: Any,
    conditions: list[Any],
    tz: ZoneInfo,
    first_day: date,
    days: int,
) -> list[DailyCount]:
    """Count rows per organization-local day, ``first_day`` through today.

    The trends were bucketed by the UTC date of each row and laid out from
    ``now - N days``, so the last bar was the previous UTC day: everything
    that happened today was counted in the headline total and missing from
    the chart beneath it, and an evening in Chicago fell on the next day
    (W78-1). Rows are grouped by UTC date and hour in SQL and each bucket is
    moved to the local date here, which is exact for every whole-hour offset.
    """
    utc_day = func.date(column)
    utc_hour = extract("hour", column)
    result = await db.execute(
        select(utc_day, utc_hour, func.count())
        .where(*conditions)
        .group_by(utc_day, utc_hour)
    )
    counts: dict[date, int] = {}
    for day, hour, count in result.all():
        if day is None or hour is None:
            continue
        day_value = day if isinstance(day, date) else date.fromisoformat(str(day))
        local_day = (
            datetime.combine(day_value, time(int(hour)), tzinfo=timezone.utc)
            .astimezone(tz)
            .date()
        )
        counts[local_day] = counts.get(local_day, 0) + count
    return [
        DailyCount(
            date=(first_day + timedelta(days=i)).isoformat(),
            count=counts.get(first_day + timedelta(days=i), 0),
        )
        for i in range(days)
    ]


@router.get("", response_model=PlatformAnalyticsResponse)
async def get_platform_analytics(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("settings.manage")),
) -> PlatformAnalyticsResponse:
    """
    Aggregated platform analytics for IT admins.

    Each section is isolated so a failure in one area
    does not prevent the rest of the metrics from being returned.
    """
    org_id = current_user.organization_id
    now = datetime.now(timezone.utc)
    thirty_days_ago = now - timedelta(days=30)
    # The two charted windows are whole local days ending today, and the
    # totals shown above each chart count the same window, so a chart always
    # adds up to the number printed over it.
    tz = await resolve_reporting_timezone(db, org_id)
    today_local = now.astimezone(tz).date()
    login_first_day = today_local - timedelta(days=29)
    login_since = _local_midnight_utc(login_first_day, tz)
    error_first_day = today_local - timedelta(days=6)
    error_since = _local_midnight_utc(error_first_day, tz)

    # ── User Adoption ──
    total_users = 0
    active_users = 0
    new_users_last_30 = 0
    login_trend: list[DailyCount] = []

    try:
        result = await db.execute(
            select(func.count(User.id)).where(
                User.organization_id == org_id,
                User.deleted_at.is_(None),
            )
        )
        total_users = result.scalar() or 0

        result = await db.execute(
            select(func.count(User.id)).where(
                User.organization_id == org_id,
                User.deleted_at.is_(None),
                User.last_login_at >= login_since,
            )
        )
        active_users = result.scalar() or 0

        result = await db.execute(
            select(func.count(User.id)).where(
                User.organization_id == org_id,
                User.deleted_at.is_(None),
                User.created_at >= thirty_days_ago,
            )
        )
        new_users_last_30 = result.scalar() or 0

        # Each member is counted once, on the day of their most recent
        # sign-in: there is no per-sign-in history to chart.
        login_trend = await _local_daily_counts(
            db,
            User.last_login_at,
            [
                User.organization_id == org_id,
                User.deleted_at.is_(None),
                User.last_login_at >= login_since,
            ],
            tz,
            login_first_day,
            30,
        )

    except Exception as exc:
        logger.warning("platform-analytics: user adoption query failed: {}", exc)

    inactive_users = total_users - active_users
    adoption_rate = (
        round((active_users / total_users) * 100, 1) if total_users > 0 else 0.0
    )

    # ── Module Usage ──
    modules: list[ModuleUsage] = []
    # ``enabled`` is the department's own switch, read the way navigation
    # reads it. It was a literal True, so a module the department had turned
    # off was badged "Enabled" here (W78-2).
    try:
        enabled_ids = set(
            (await OrganizationService(db).get_enabled_modules(org_id)).enabled_modules
        )
    except Exception as exc:
        logger.warning("platform-analytics: enabled modules query failed: {}", exc)
        enabled_ids = set()
    module_configs = [
        ("Events", "events", Event, Event.organization_id, Event.created_at),
        (
            "Training",
            "training",
            TrainingRecord,
            TrainingRecord.organization_id,
            TrainingRecord.created_at,
        ),
        (
            "Scheduling",
            "scheduling",
            Shift,
            Shift.organization_id,
            Shift.created_at,
        ),
        (
            "Inventory",
            "inventory",
            InventoryItem,
            InventoryItem.organization_id,
            InventoryItem.created_at,
        ),
        (
            "Meetings",
            "minutes",
            Meeting,
            Meeting.organization_id,
            Meeting.created_at,
        ),
        (
            "Elections",
            "elections",
            Election,
            Election.organization_id,
            Election.created_at,
        ),
        (
            "Documents",
            "documents",
            Document,
            Document.organization_id,
            Document.created_at,
        ),
        (
            "Forms",
            "forms",
            FormSubmission,
            FormSubmission.organization_id,
            FormSubmission.created_at,
        ),
    ]

    for name, module_id, model, org_col, created_col in module_configs:
        enabled = module_id in enabled_ids
        try:
            count_result = await db.execute(
                select(func.count()).select_from(model).where(org_col == org_id)
            )
            record_count = count_result.scalar() or 0

            last_result = await db.execute(
                select(func.max(created_col)).where(org_col == org_id)
            )
            last_activity_dt = last_result.scalar()
            last_activity = last_activity_dt.isoformat() if last_activity_dt else None

            modules.append(
                ModuleUsage(
                    name=name,
                    enabled=enabled,
                    record_count=record_count,
                    last_activity=last_activity,
                )
            )
        except Exception as exc:
            logger.warning("platform-analytics: module {} query failed: {}", name, exc)
            modules.append(ModuleUsage(name=name, enabled=enabled, record_count=0))

    # ── Operational Activity ──
    total_events = 0
    events_last_30 = 0
    total_check_ins = 0
    training_hours_last_30 = 0.0
    forms_submitted_last_30 = 0

    try:
        result = await db.execute(
            select(func.count(Event.id)).where(
                Event.organization_id == org_id,
                Event.is_cancelled.is_(False),
            )
        )
        total_events = result.scalar() or 0

        result = await db.execute(
            select(func.count(Event.id)).where(
                Event.organization_id == org_id,
                Event.is_cancelled.is_(False),
                Event.created_at >= thirty_days_ago,
            )
        )
        events_last_30 = result.scalar() or 0
    except Exception as exc:
        logger.warning("platform-analytics: events query failed: {}", exc)

    try:
        result = await db.execute(
            select(func.count(EventRSVP.id)).where(
                EventRSVP.organization_id == org_id,
                EventRSVP.checked_in.is_(True),
            )
        )
        total_check_ins = result.scalar() or 0
    except Exception as exc:
        logger.warning("platform-analytics: check-ins query failed: {}", exc)

    try:
        result = await db.execute(
            select(func.coalesce(func.sum(TrainingRecord.hours_completed), 0)).where(
                TrainingRecord.organization_id == org_id,
                TrainingRecord.status == TrainingStatus.COMPLETED,
                TrainingRecord.completion_date >= thirty_days_ago.date(),
            )
        )
        training_hours_last_30 = float(result.scalar() or 0)
    except Exception as exc:
        logger.warning("platform-analytics: training hours query failed: {}", exc)

    try:
        result = await db.execute(
            select(func.count(FormSubmission.id)).where(
                FormSubmission.organization_id == org_id,
                FormSubmission.created_at >= thirty_days_ago,
            )
        )
        forms_submitted_last_30 = result.scalar() or 0
    except Exception as exc:
        logger.warning("platform-analytics: forms query failed: {}", exc)

    # ── System Health ──
    errors_last_7 = 0
    error_trend: list[DailyCount] = []
    top_error_types: dict[str, int] = {}

    try:
        result = await db.execute(
            select(func.count(ErrorLog.id)).where(
                ErrorLog.organization_id == org_id,
                ErrorLog.created_at >= error_since,
            )
        )
        errors_last_7 = result.scalar() or 0

        error_trend = await _local_daily_counts(
            db,
            ErrorLog.created_at,
            [
                ErrorLog.organization_id == org_id,
                ErrorLog.created_at >= error_since,
            ],
            tz,
            error_first_day,
            7,
        )

        # Top error types
        error_type_result = await db.execute(
            select(ErrorLog.error_type, func.count(ErrorLog.id))
            .where(
                ErrorLog.organization_id == org_id,
                ErrorLog.created_at >= error_since,
            )
            .group_by(ErrorLog.error_type)
            .order_by(func.count(ErrorLog.id).desc())
            .limit(10)
        )
        top_error_types = {row[0]: row[1] for row in error_type_result.all() if row[0]}
    except Exception as exc:
        logger.warning("platform-analytics: error logs query failed: {}", exc)

    # ── Content ──
    total_documents = 0
    documents_last_30 = 0

    try:
        result = await db.execute(
            select(func.count(Document.id)).where(Document.organization_id == org_id)
        )
        total_documents = result.scalar() or 0

        result = await db.execute(
            select(func.count(Document.id)).where(
                Document.organization_id == org_id,
                Document.created_at >= thirty_days_ago,
            )
        )
        documents_last_30 = result.scalar() or 0
    except Exception as exc:
        logger.warning("platform-analytics: documents query failed: {}", exc)

    return PlatformAnalyticsResponse(
        total_users=total_users,
        active_users=active_users,
        inactive_users=inactive_users,
        new_users_last_30_days=new_users_last_30,
        adoption_rate=adoption_rate,
        login_trend=login_trend,
        modules=modules,
        total_events=total_events,
        events_last_30_days=events_last_30,
        total_check_ins=total_check_ins,
        training_hours_last_30_days=round(training_hours_last_30, 1),
        forms_submitted_last_30_days=forms_submitted_last_30,
        errors_last_7_days=errors_last_7,
        error_trend=error_trend,
        top_error_types=top_error_types,
        total_documents=total_documents,
        documents_last_30_days=documents_last_30,
        generated_at=now,
    )
