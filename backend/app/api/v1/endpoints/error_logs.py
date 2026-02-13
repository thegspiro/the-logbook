"""
Error Logs API Endpoints

Endpoints for logging and retrieving application errors.
"""

from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete

from app.core.database import get_db
from app.models.error_log import ErrorLog
from app.models.user import User
from app.api.dependencies import get_current_user, require_permission

router = APIRouter()


@router.post("/log")
async def log_error(
    data: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Log an application error"""
    error = ErrorLog(
        organization_id=current_user.organization_id,
        error_type=data.get("error_type", "UNKNOWN_ERROR"),
        error_message=data.get("error_message", ""),
        user_message=data.get("user_message"),
        troubleshooting_steps=data.get("troubleshooting_steps", []),
        context=data.get("context", {}),
        user_id=str(current_user.id),
        event_id=data.get("event_id"),
    )
    db.add(error)
    await db.commit()
    return {"status": "logged", "id": error.id}


@router.get("")
async def get_errors(
    error_type: Optional[str] = Query(None),
    event_id: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("audit.view")),
):
    """Get error logs with optional filtering"""
    filters = [ErrorLog.organization_id == current_user.organization_id]
    if error_type:
        filters.append(ErrorLog.error_type == error_type)
    if event_id:
        filters.append(ErrorLog.event_id == event_id)

    count_result = await db.execute(
        select(func.count()).select_from(ErrorLog).where(*filters)
    )
    total = count_result.scalar() or 0

    result = await db.execute(
        select(ErrorLog).where(*filters)
        .order_by(ErrorLog.created_at.desc())
        .offset(skip).limit(limit)
    )
    errors = result.scalars().all()

    return {
        "errors": [
            {
                "id": e.id,
                "error_type": e.error_type,
                "error_message": e.error_message,
                "user_message": e.user_message,
                "troubleshooting_steps": e.troubleshooting_steps or [],
                "context": e.context or {},
                "user_id": e.user_id,
                "event_id": e.event_id,
                "created_at": e.created_at.isoformat() if e.created_at else None,
            }
            for e in errors
        ],
        "total": total,
    }


@router.get("/stats")
async def get_error_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("audit.view")),
):
    """Get error statistics"""
    filters = [ErrorLog.organization_id == current_user.organization_id]

    total_result = await db.execute(
        select(func.count()).select_from(ErrorLog).where(*filters)
    )
    total = total_result.scalar() or 0

    type_result = await db.execute(
        select(ErrorLog.error_type, func.count()).where(*filters)
        .group_by(ErrorLog.error_type)
    )
    by_type = {error_type: count for error_type, count in type_result.all()}

    recent_result = await db.execute(
        select(ErrorLog).where(*filters)
        .order_by(ErrorLog.created_at.desc())
        .limit(5)
    )
    recent = recent_result.scalars().all()

    return {
        "total": total,
        "by_type": by_type,
        "recent_errors": [
            {
                "id": e.id,
                "error_type": e.error_type,
                "error_message": e.error_message,
                "user_message": e.user_message,
                "troubleshooting_steps": e.troubleshooting_steps or [],
                "context": e.context or {},
                "user_id": e.user_id,
                "event_id": e.event_id,
                "created_at": e.created_at.isoformat() if e.created_at else None,
            }
            for e in recent
        ],
    }


@router.delete("")
async def clear_errors(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("audit.export")),
):
    """Clear all error logs for the organization"""
    await db.execute(
        delete(ErrorLog).where(ErrorLog.organization_id == current_user.organization_id)
    )
    await db.commit()
    return {"status": "cleared"}


@router.get("/export")
async def export_errors(
    event_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("audit.view")),
):
    """Export error logs"""
    filters = [ErrorLog.organization_id == current_user.organization_id]
    if event_id:
        filters.append(ErrorLog.event_id == event_id)

    result = await db.execute(
        select(ErrorLog).where(*filters).order_by(ErrorLog.created_at.desc()).limit(1000)
    )
    errors = result.scalars().all()
    return [
        {
            "id": e.id,
            "error_type": e.error_type,
            "error_message": e.error_message,
            "user_message": e.user_message,
            "troubleshooting_steps": e.troubleshooting_steps or [],
            "context": e.context or {},
            "user_id": e.user_id,
            "event_id": e.event_id,
            "created_at": e.created_at.isoformat() if e.created_at else None,
        }
        for e in errors
    ]
