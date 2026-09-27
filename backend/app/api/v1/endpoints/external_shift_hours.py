"""
External Shift Hours API

Members log shifts they worked outside the department's own schedule — a
neighbouring jurisdiction's apparatus under mutual aid or a staffing
agreement — and the hours count toward scheduling hours and shift/hours
compliance straight away. Officers can reject an entry, which removes it
from every total, or restore one they rejected.

The agency and apparatus are picked from a list scheduling officers
maintain here too, so the apparatus summary counts one unit as one unit.

Mounted at ``/api/v1/scheduling/external-hours`` behind the scheduling
module gate.
"""

from datetime import date
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user, require_permission
from app.api.v1.endpoints.scheduling import _parse_and_validate_report_dates
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import ensure_found, safe_error_detail
from app.models.external_shift_hours import (
    ExternalShiftHours,
    ExternalShiftHoursStatus,
)
from app.models.user import User
from app.schemas.external_shift_hours import (
    ExternalAgencyCreate,
    ExternalAgencyListResponse,
    ExternalAgencyResponse,
    ExternalAgencyUpdate,
    ExternalApparatusCreate,
    ExternalApparatusResponse,
    ExternalApparatusSummaryResponse,
    ExternalApparatusUpdate,
    ExternalShiftHoursCreate,
    ExternalShiftHoursListResponse,
    ExternalShiftHoursReject,
    ExternalShiftHoursResponse,
    ExternalShiftHoursUpdate,
)
from app.services.external_apparatus_service import (
    ExternalApparatusInUseError,
    ExternalApparatusService,
)
from app.services.external_shift_hours_service import ExternalShiftHoursService

router = APIRouter()

_ENTRY = "External shift entry"
_AGENCY = "Outside agency"
_APPARATUS = "Outside apparatus"


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
            "apparatus_name": entry.apparatus_name,
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


async def _audit_list_change(
    db: AsyncSession, event_type: str, user: User, data: dict
) -> None:
    await log_audit_event(
        db=db,
        event_type=event_type,
        event_category="scheduling",
        severity="INFO",
        event_data={"organization_id": str(user.organization_id), **data},
        user_id=str(user.id),
        username=user.username,
    )


# ---------------------------------------------------------------------------
# The outside apparatus list
#
# Declared ahead of the ``/{entry_id}`` routes so a fixed path is never
# offered to them as an entry id.
# ---------------------------------------------------------------------------


@router.get("/apparatus-options", response_model=ExternalAgencyListResponse)
async def list_apparatus_options(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Active agencies and their active apparatus, for the member's picker.

    Authentication only: every member who can log an outside shift needs
    the list to pick from.
    """
    agencies = await ExternalApparatusService(db).list_agencies(
        str(current_user.organization_id), active_only=True
    )
    return {"agencies": agencies}


@router.get("/agencies", response_model=ExternalAgencyListResponse)
async def list_agencies(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Every agency and apparatus, inactive ones included.

    **Permissions required:** scheduling.manage
    """
    agencies = await ExternalApparatusService(db).list_agencies(
        str(current_user.organization_id)
    )
    return {"agencies": agencies}


@router.post(
    "/agencies",
    response_model=ExternalAgencyResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_agency(
    payload: ExternalAgencyCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Add an agency members may log outside shifts for.

    **Permissions required:** scheduling.manage
    """
    try:
        agency = await ExternalApparatusService(db).create_agency(
            str(current_user.organization_id), payload.model_dump()
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    await _audit_list_change(
        db,
        "external_agency_created",
        current_user,
        {"agency_id": agency.id, "name": agency.name},
    )
    return {**ExternalApparatusService.serialize_agency(agency), "apparatus": []}


@router.patch("/agencies/{agency_id}", response_model=ExternalAgencyResponse)
async def update_agency(
    agency_id: UUID,
    payload: ExternalAgencyUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Rename an agency, or deactivate it to hide it from the picker.

    **Permissions required:** scheduling.manage
    """
    service = ExternalApparatusService(db)
    try:
        agency = await service.update_agency(
            str(current_user.organization_id),
            str(agency_id),
            payload.model_dump(exclude_unset=True),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    agency = ensure_found(agency, _AGENCY)
    await _audit_list_change(
        db,
        "external_agency_updated",
        current_user,
        {"agency_id": agency.id, "name": agency.name, "is_active": agency.is_active},
    )
    listed = await service.list_agencies(str(current_user.organization_id))
    return next(a for a in listed if a["id"] == agency.id)


@router.delete("/agencies/{agency_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_agency(
    agency_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Remove an agency nobody has logged a shift for. Otherwise 409.

    **Permissions required:** scheduling.manage
    """
    try:
        agency = await ExternalApparatusService(db).delete_agency(
            str(current_user.organization_id), str(agency_id)
        )
    except ExternalApparatusInUseError as e:
        raise HTTPException(status_code=409, detail=str(e))
    agency = ensure_found(agency, _AGENCY)
    await _audit_list_change(
        db,
        "external_agency_deleted",
        current_user,
        {"agency_id": agency.id, "name": agency.name},
    )


@router.post(
    "/agencies/{agency_id}/apparatus",
    response_model=ExternalApparatusResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_apparatus(
    agency_id: UUID,
    payload: ExternalApparatusCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Add a unit under an agency.

    **Permissions required:** scheduling.manage
    """
    try:
        unit = await ExternalApparatusService(db).create_apparatus(
            str(current_user.organization_id), str(agency_id), payload.model_dump()
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    unit = ensure_found(unit, _AGENCY)
    await _audit_list_change(
        db,
        "external_apparatus_created",
        current_user,
        {"apparatus_id": unit.id, "agency_id": unit.agency_id, "name": unit.name},
    )
    return ExternalApparatusService.serialize_apparatus(unit)


@router.patch("/apparatus/{apparatus_id}", response_model=ExternalApparatusResponse)
async def update_apparatus(
    apparatus_id: UUID,
    payload: ExternalApparatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Rename a unit, change its type, or deactivate it.

    **Permissions required:** scheduling.manage
    """
    try:
        unit = await ExternalApparatusService(db).update_apparatus(
            str(current_user.organization_id),
            str(apparatus_id),
            payload.model_dump(exclude_unset=True),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    unit = ensure_found(unit, _APPARATUS)
    await _audit_list_change(
        db,
        "external_apparatus_updated",
        current_user,
        {"apparatus_id": unit.id, "name": unit.name, "is_active": unit.is_active},
    )
    return ExternalApparatusService.serialize_apparatus(unit)


@router.delete("/apparatus/{apparatus_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_apparatus(
    apparatus_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Remove a unit nobody has logged a shift on. Otherwise 409.

    **Permissions required:** scheduling.manage
    """
    try:
        unit = await ExternalApparatusService(db).delete_apparatus(
            str(current_user.organization_id), str(apparatus_id)
        )
    except ExternalApparatusInUseError as e:
        raise HTTPException(status_code=409, detail=str(e))
    unit = ensure_found(unit, _APPARATUS)
    await _audit_list_change(
        db,
        "external_apparatus_deleted",
        current_user,
        {"apparatus_id": unit.id, "name": unit.name},
    )


@router.get("/summary", response_model=ExternalApparatusSummaryResponse)
async def get_apparatus_summary(
    start_date: str = Query(...),
    end_date: str = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("scheduling.manage", "scheduling.report")
    ),
):
    """Counted outside shifts, hours and members per agency and apparatus.

    **Permissions required:** scheduling.manage or scheduling.report
    """
    start, end = _parse_and_validate_report_dates(start_date, end_date)
    rows = await ExternalShiftHoursService(db).apparatus_summary(
        str(current_user.organization_id), start, end
    )
    return {
        "rows": rows,
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
    }


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
