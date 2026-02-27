"""
Platform Analytics Endpoints

Provides aggregated platform-wide analytics for IT admins:
user adoption, module usage, operational activity, system health, and content metrics.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy import cast, func, select, Date
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_permission
from app.core.config import settings
from app.core.database import get_db
from app.models.document import Document
from app.models.election import Election
from app.models.error_log import ErrorLog
from app.models.event import Event, EventRSVP
from app.models.forms import FormSubmission
from app.models.inventory import InventoryItem
from app.models.meeting import Meeting
from app.models.training import Shift, TrainingRecord, TrainingStatus
from app.models.user import User, UserStatus
from app.schemas.platform_analytics import (
    DailyCount,
    ModuleUsage,
    PlatformAnalyticsResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter()


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
    seven_days_ago = now - timedelta(days=7)

    # ── User Adoption ──
    total_users = 0
    active_users = 0
    new_users_last_30 = 0
    login_trend: List[DailyCount] = []

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
                User.last_login_at >= thirty_days_ago,
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

        # Daily login trend (past 30 days)
        result = await db.execute(
            select(
                cast(User.last_login_at, Date).label("login_date"),
                func.count(User.id),
            )
            .where(
                User.organization_id == org_id,
                User.deleted_at.is_(None),
                User.last_login_at >= thirty_days_ago,
            )
            .group_by("login_date")
            .order_by("login_date")
        )
        login_map = {str(row[0]): row[1] for row in result.all()}

        # Fill in all 30 days including zeros
        for i in range(30):
            day = (thirty_days_ago + timedelta(days=i)).strftime("%Y-%m-%d")
            login_trend.append(DailyCount(date=day, count=login_map.get(day, 0)))

    except Exception as exc:
        logger.warning("platform-analytics: user adoption query failed: %s", exc)

    inactive_users = total_users - active_users
    adoption_rate = round((active_users / total_users) * 100, 1) if total_users > 0 else 0.0

    # ── Module Usage ──
    modules: List[ModuleUsage] = []
    module_configs = [
        ("Events", True, Event, Event.organization_id, Event.created_at),
        ("Training", settings.MODULE_TRAINING_ENABLED, TrainingRecord, TrainingRecord.organization_id, TrainingRecord.created_at),
        ("Scheduling", settings.MODULE_SCHEDULING_ENABLED, Shift, Shift.organization_id, Shift.created_at),
        ("Inventory", settings.MODULE_INVENTORY_ENABLED, InventoryItem, InventoryItem.organization_id, InventoryItem.created_at),
        ("Meetings", settings.MODULE_MEETINGS_ENABLED, Meeting, Meeting.organization_id, Meeting.created_at),
        ("Elections", settings.MODULE_ELECTIONS_ENABLED, Election, Election.organization_id, Election.created_at),
        ("Documents", True, Document, Document.organization_id, Document.created_at),
        ("Forms", True, FormSubmission, FormSubmission.organization_id, FormSubmission.created_at),
    ]

    for name, enabled, model, org_col, created_col in module_configs:
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
            logger.warning("platform-analytics: module %s query failed: %s", name, exc)
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
                Event.is_cancelled == False,  # noqa: E712
            )
        )
        total_events = result.scalar() or 0

        result = await db.execute(
            select(func.count(Event.id)).where(
                Event.organization_id == org_id,
                Event.is_cancelled == False,  # noqa: E712
                Event.created_at >= thirty_days_ago,
            )
        )
        events_last_30 = result.scalar() or 0
    except Exception as exc:
        logger.warning("platform-analytics: events query failed: %s", exc)

    try:
        result = await db.execute(
            select(func.count(EventRSVP.id)).where(
                EventRSVP.organization_id == org_id,
                EventRSVP.checked_in == True,  # noqa: E712
            )
        )
        total_check_ins = result.scalar() or 0
    except Exception as exc:
        logger.warning("platform-analytics: check-ins query failed: %s", exc)

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
        logger.warning("platform-analytics: training hours query failed: %s", exc)

    try:
        result = await db.execute(
            select(func.count(FormSubmission.id)).where(
                FormSubmission.organization_id == org_id,
                FormSubmission.created_at >= thirty_days_ago,
            )
        )
        forms_submitted_last_30 = result.scalar() or 0
    except Exception as exc:
        logger.warning("platform-analytics: forms query failed: %s", exc)

    # ── System Health ──
    errors_last_7 = 0
    error_trend: List[DailyCount] = []
    top_error_types: dict[str, int] = {}

    try:
        result = await db.execute(
            select(func.count(ErrorLog.id)).where(
                ErrorLog.organization_id == org_id,
                ErrorLog.created_at >= seven_days_ago,
            )
        )
        errors_last_7 = result.scalar() or 0

        # Daily error trend (past 7 days)
        result = await db.execute(
            select(
                cast(ErrorLog.created_at, Date).label("error_date"),
                func.count(ErrorLog.id),
            )
            .where(
                ErrorLog.organization_id == org_id,
                ErrorLog.created_at >= seven_days_ago,
            )
            .group_by("error_date")
            .order_by("error_date")
        )
        error_map = {str(row[0]): row[1] for row in result.all()}
        for i in range(7):
            day = (seven_days_ago + timedelta(days=i)).strftime("%Y-%m-%d")
            error_trend.append(DailyCount(date=day, count=error_map.get(day, 0)))

        # Top error types
        result = await db.execute(
            select(ErrorLog.error_type, func.count(ErrorLog.id))
            .where(
                ErrorLog.organization_id == org_id,
                ErrorLog.created_at >= seven_days_ago,
            )
            .group_by(ErrorLog.error_type)
            .order_by(func.count(ErrorLog.id).desc())
            .limit(10)
        )
        top_error_types = {row[0]: row[1] for row in result.all() if row[0]}
    except Exception as exc:
        logger.warning("platform-analytics: error logs query failed: %s", exc)

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
        logger.warning("platform-analytics: documents query failed: %s", exc)

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
