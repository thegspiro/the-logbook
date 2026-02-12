"""
Analytics API Endpoints

Endpoints for tracking and retrieving analytics data.
"""

from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, extract

from app.core.database import get_db
from app.models.analytics import AnalyticsEvent
from app.models.user import User
from app.api.dependencies import get_current_user, require_permission

router = APIRouter()


@router.post("/track")
async def track_event(
    data: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Track an analytics event"""
    event = AnalyticsEvent(
        organization_id=current_user.organization_id,
        event_type=data.get("event_type", "unknown"),
        event_id=data.get("event_id"),
        user_id=data.get("user_id") or str(current_user.id),
        device_type=data.get("metadata", {}).get("deviceType"),
        metadata=data.get("metadata", {}),
    )
    db.add(event)
    await db.commit()
    return {"status": "tracked"}


@router.get("/metrics")
async def get_metrics(
    event_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("analytics.view")),
):
    """Get analytics metrics, optionally filtered by event"""
    base_filter = [AnalyticsEvent.organization_id == current_user.organization_id]
    if event_id:
        base_filter.append(AnalyticsEvent.event_id == event_id)

    # Total scans
    scans_result = await db.execute(
        select(func.count()).select_from(AnalyticsEvent).where(
            *base_filter, AnalyticsEvent.event_type == "qr_scan"
        )
    )
    total_scans = scans_result.scalar() or 0

    # Successful check-ins
    success_result = await db.execute(
        select(func.count()).select_from(AnalyticsEvent).where(
            *base_filter, AnalyticsEvent.event_type == "check_in_success"
        )
    )
    successful = success_result.scalar() or 0

    # Failed check-ins
    fail_result = await db.execute(
        select(func.count()).select_from(AnalyticsEvent).where(
            *base_filter, AnalyticsEvent.event_type == "check_in_failure"
        )
    )
    failed = fail_result.scalar() or 0

    total = successful + failed
    success_rate = round((successful / total) * 100, 2) if total > 0 else 0

    # Device breakdown
    device_result = await db.execute(
        select(AnalyticsEvent.device_type, func.count()).where(*base_filter)
        .group_by(AnalyticsEvent.device_type)
    )
    device_breakdown = {}
    for device_type, count in device_result.all():
        device_breakdown[device_type or "unknown"] = count

    # Hourly activity
    hourly_result = await db.execute(
        select(extract("hour", AnalyticsEvent.created_at).label("hour"), func.count())
        .where(*base_filter)
        .group_by("hour")
        .order_by("hour")
    )
    hourly_map = {int(h): c for h, c in hourly_result.all()}
    hourly_activity = [{"hour": h, "count": hourly_map.get(h, 0)} for h in range(24)]

    return {
        "total_scans": total_scans,
        "successful_check_ins": successful,
        "failed_check_ins": failed,
        "success_rate": success_rate,
        "avg_time_to_check_in": 0,
        "device_breakdown": device_breakdown,
        "error_breakdown": {},
        "hourly_activity": hourly_activity,
    }


@router.get("/export")
async def export_analytics(
    event_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("analytics.view")),
):
    """Export analytics data"""
    base_filter = [AnalyticsEvent.organization_id == current_user.organization_id]
    if event_id:
        base_filter.append(AnalyticsEvent.event_id == event_id)

    result = await db.execute(
        select(AnalyticsEvent).where(*base_filter).order_by(AnalyticsEvent.created_at.desc()).limit(1000)
    )
    events = result.scalars().all()
    return {
        "events": [
            {
                "id": e.id,
                "event_type": e.event_type,
                "event_id": e.event_id,
                "user_id": e.user_id,
                "device_type": e.device_type,
                "metadata": e.metadata,
                "created_at": e.created_at.isoformat() if e.created_at else None,
            }
            for e in events
        ],
        "total": len(events),
    }
