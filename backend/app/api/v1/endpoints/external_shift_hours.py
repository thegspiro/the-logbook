"""
External Shift Hours API

Members log shifts they worked outside the department's own schedule — a
neighbouring jurisdiction's apparatus under mutual aid or a staffing
agreement — and the hours count toward scheduling hours and shift/hours
compliance straight away. Officers can reject an entry, which removes it
from every total, or restore one they rejected.

Mounted at ``/api/v1/scheduling/external-hours`` behind the scheduling
module gate.
"""

from datetime import date
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user, require_permission
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import ensure_found, safe_error_detail
from app.models.external_shift_hours import (
    ExternalShiftHours,
    ExternalShiftHoursStatus,
)
from app.models.user import User
from app.schemas.external_shift_hours import (
    ExternalShiftHoursCreate,
    ExternalShiftHoursListResponse,
    ExternalShiftHoursReject,
    ExternalShiftHoursResponse,
    ExternalShiftHoursUpdate,
)
from app.services.external_shift_hours_service import ExternalShiftHoursService

router = APIRouter()

_ENTRY = "External shift entry"


async def _audit(
    db: AsyncSession,
    event_type: str,
    user: User,
    entry: ExternalShiftHours,
    *,
    severity: str = "INFO",
    extra: Optional[dict] = None,
) -> None:
    await log_audit_event(
        db=db,
        event_type=event_type,
        event_category="scheduling",
        severity=severity,
        event_data={
            "organization_id": str(user.organization_id),
            "entry_id": str(entry.id),
            "member_id": str(entry.user_id),
            "shift_date": entry.shift_date.isoformat(),
            "minutes": entry.duration_minutes,
            "agency_name": entry.agency_name,
            **(extra or {}),
        },
        user_id=str(user.id),
        username=user.username,
    )


async def _response(
    service: ExternalShiftHoursService, organization_id: str, entry_id: str
) -> dict:
    """The entry with its member and reviewer names resolved."""
    items, _ = await service.list_entries(organization_id, entry_id=entry_id, limit=1)
    return ensure_found(items[0] if items else None, _ENTRY)


# ---------------------------------------------------------------------------
# Member self-service
# ---------------------------------------------------------------------------


@router.post(
    "",
    response_model=ExternalShiftHoursResponse,
    status_code=status.HTTP_201_CREATED,
)
async def log_external_shift(
    payload: ExternalShiftHoursCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Log a shift the caller worked outside the department's schedule.

    Authentication only: a member logs their own time, and the entry is
    always stamped with the caller as its member.
    """
    service = ExternalShiftHoursService(db)
    try:
        entry = await service.create(
            str(current_user.organization_id),
            str(current_user.id),
            payload.model_dump(),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    await _audit(db, "external_shift_hours_logged", current_user, entry)
    return ExternalShiftHoursService.serialize(entry, member=current_user)


@router.get("/my", response_model=ExternalShiftHoursListResponse)
async def list_my_external_shifts(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The caller's own external shift entries, newest first."""
    service = ExternalShiftHoursService(db)
    items, total = await service.list_entries(
        str(current_user.organization_id),
        user_id=str(current_user.id),
        start_date=start_date,
        end_date=end_date,
        limit=limit,
        offset=offset,
    )
    return {"items": items, "total": total}


@router.patch("/{entry_id}", response_model=ExternalShiftHoursResponse)
async def update_my_external_shift(
    entry_id: UUID,
    payload: ExternalShiftHoursUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Correct one of the caller's own entries. Rejected entries are locked."""
    service = ExternalShiftHoursService(db)
    try:
        entry = await service.update_own(
            str(current_user.organization_id),
            str(current_user.id),
            str(entry_id),
            payload.model_dump(exclude_unset=True),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    entry = ensure_found(entry, _ENTRY)
    await _audit(db, "external_shift_hours_updated", current_user, entry)
    return ExternalShiftHoursService.serialize(entry, member=current_user)


@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_my_external_shift(
    entry_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Remove one of the caller's own entries. Rejected entries are kept."""
    service = ExternalShiftHoursService(db)
    try:
        entry = await service.delete_own(
            str(current_user.organization_id), str(current_user.id), str(entry_id)
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    entry = ensure_found(entry, _ENTRY)
    await _audit(db, "external_shift_hours_deleted", current_user, entry)


# ---------------------------------------------------------------------------
# Officer review
# ---------------------------------------------------------------------------


@router.get("", response_model=ExternalShiftHoursListResponse)
async def list_external_shifts(
    user_id: Optional[UUID] = Query(None),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    status_filter: Optional[ExternalShiftHoursStatus] = Query(None, alias="status"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("scheduling.manage", "scheduling.report")
    ),
):
    """Every member's external shift entries in the caller's organization.

    **Permissions required:** scheduling.manage or scheduling.report
    """
    service = ExternalShiftHoursService(db)
    items, total = await service.list_entries(
        str(current_user.organization_id),
        user_id=str(user_id) if user_id else None,
        start_date=start_date,
        end_date=end_date,
        status=status_filter.value if status_filter else None,
        limit=limit,
        offset=offset,
    )
    return {"items": items, "total": total}


@router.post("/{entry_id}/reject", response_model=ExternalShiftHoursResponse)
async def reject_external_shift(
    entry_id: UUID,
    payload: ExternalShiftHoursReject,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Stop an entry counting. The member sees the reason on their own list.

    **Permissions required:** scheduling.manage
    """
    service = ExternalShiftHoursService(db)
    entry = ensure_found(
        await service.reject(
            str(current_user.organization_id),
            str(entry_id),
            str(current_user.id),
            payload.reason,
        ),
        _ENTRY,
    )
    await _audit(
        db,
        "external_shift_hours_rejected",
        current_user,
        entry,
        severity="WARNING",
        extra={"reason": payload.reason},
    )
    return await _response(service, str(current_user.organization_id), entry.id)


@router.post("/{entry_id}/restore", response_model=ExternalShiftHoursResponse)
async def restore_external_shift(
    entry_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Undo a rejection so the entry counts again.

    **Permissions required:** scheduling.manage
    """
    service = ExternalShiftHoursService(db)
    entry = ensure_found(
        await service.restore(
            str(current_user.organization_id), str(entry_id), str(current_user.id)
        ),
        _ENTRY,
    )
    await _audit(db, "external_shift_hours_restored", current_user, entry)
    return await _response(service, str(current_user.organization_id), entry.id)
