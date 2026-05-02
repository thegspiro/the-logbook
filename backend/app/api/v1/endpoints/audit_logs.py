"""
Audit Logs API Endpoints

Read-only access to the tamper-proof audit log for org admins
(`audit.view`). Audit log rows are global (no organization_id column on
`audit_logs`), so org-scoping is enforced by joining through `users` —
admins only see entries authored by users in their own organization.
System-level entries (no user_id, e.g., scheduled jobs) are excluded
from the org-scoped view to prevent cross-org leakage.
"""

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_permission
from app.core.database import get_db
from app.models.audit import AuditLog
from app.models.user import User

router = APIRouter()


def _serialize(entry: AuditLog) -> dict[str, Any]:
    return {
        "id": entry.id,
        "timestamp": entry.timestamp.isoformat() if entry.timestamp else None,
        "event_type": entry.event_type,
        "event_category": entry.event_category,
        "severity": entry.severity.value if entry.severity else None,
        "user_id": entry.user_id,
        "username": entry.username,
        "ip_address": entry.ip_address,
        "event_data": entry.event_data or {},
    }


@router.get("")
async def list_audit_logs(
    event_type: str | None = Query(None, max_length=100),
    event_category: str | None = Query(None, max_length=50),
    severity: str | None = Query(None, pattern="^(info|warning|critical)$"),
    user_id: str | None = Query(None, max_length=36),
    search: str | None = Query(None, max_length=200, description="Username or event-type substring"),
    start_date: datetime | None = Query(None),
    end_date: datetime | None = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("audit.view")),
) -> dict[str, Any]:
    """List audit log entries scoped to the caller's organization.

    Filters: event_type, event_category, severity, user_id, search,
    start_date, end_date. Pagination via skip/limit.
    """
    org_user_ids = (
        select(User.id).where(User.organization_id == str(current_user.organization_id)).scalar_subquery()
    )

    filters: list[Any] = [AuditLog.user_id.in_(org_user_ids)]
    if event_type:
        filters.append(AuditLog.event_type == event_type)
    if event_category:
        filters.append(AuditLog.event_category == event_category)
    if severity:
        filters.append(AuditLog.severity == severity)
    if user_id:
        filters.append(AuditLog.user_id == user_id)
    if start_date:
        filters.append(AuditLog.timestamp >= start_date)
    if end_date:
        filters.append(AuditLog.timestamp <= end_date)
    if search:
        like = f"%{search}%"
        filters.append(or_(AuditLog.username.ilike(like), AuditLog.event_type.ilike(like)))

    where_clause = and_(*filters)

    count_result = await db.execute(select(func.count()).select_from(AuditLog).where(where_clause))
    total = count_result.scalar() or 0

    result = await db.execute(
        select(AuditLog).where(where_clause).order_by(AuditLog.timestamp.desc()).offset(skip).limit(limit)
    )
    entries = result.scalars().all()

    return {
        "logs": [_serialize(e) for e in entries],
        "total": total,
        "skip": skip,
        "limit": limit,
    }


@router.get("/stats")
async def audit_log_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("audit.view")),
) -> dict[str, Any]:
    """High-level counts for an admin overview card."""
    org_user_ids = (
        select(User.id).where(User.organization_id == str(current_user.organization_id)).scalar_subquery()
    )
    base_filter = AuditLog.user_id.in_(org_user_ids)

    total_result = await db.execute(select(func.count()).select_from(AuditLog).where(base_filter))
    total = total_result.scalar() or 0

    severity_result = await db.execute(
        select(AuditLog.severity, func.count())
        .where(base_filter)
        .group_by(AuditLog.severity)
    )
    by_severity: dict[str, int] = {}
    for sev, count in severity_result.all():
        key = sev.value if hasattr(sev, "value") else str(sev)
        by_severity[key] = count

    category_result = await db.execute(
        select(AuditLog.event_category, func.count())
        .where(base_filter)
        .group_by(AuditLog.event_category)
        .order_by(func.count().desc())
        .limit(10)
    )
    by_category = {category: count for category, count in category_result.all()}

    return {
        "total": total,
        "by_severity": by_severity,
        "by_category": by_category,
    }


@router.get("/{log_id}")
async def get_audit_log_entry(
    log_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("audit.view")),
) -> dict[str, Any]:
    """Fetch a single audit log entry. Org-scoped."""
    org_user_ids = (
        select(User.id).where(User.organization_id == str(current_user.organization_id)).scalar_subquery()
    )
    result = await db.execute(
        select(AuditLog).where(and_(AuditLog.id == log_id, AuditLog.user_id.in_(org_user_ids)))
    )
    entry = result.scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=404, detail="Audit log entry not found")
    return _serialize(entry)
