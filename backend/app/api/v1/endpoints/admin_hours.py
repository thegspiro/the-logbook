"""
Admin Hours API Endpoints

Handles admin hours categories, QR clock-in/clock-out, manual entry,
and approval workflows.
"""

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user, require_permission
from app.core.database import get_db
from app.core.utils import safe_error_detail
from app.models.user import User
from app.schemas.admin_hours import (
    AdminHoursActiveSession,
    AdminHoursApprovalAction,
    AdminHoursBulkApproveRequest,
    AdminHoursBulkApproveResponse,
    AdminHoursCategoryCreate,
    AdminHoursCategoryResponse,
    AdminHoursCategoryUpdate,
    AdminHoursClockInResponse,
    AdminHoursClockOutResponse,
    AdminHoursEntryCreate,
    AdminHoursEntryResponse,
    AdminHoursPaginatedEntries,
    AdminHoursQRData,
    AdminHoursSummary,
)
from app.services.admin_hours_service import AdminHoursService

router = APIRouter()


# =============================================================================
# Categories
# =============================================================================


@router.get("/categories", response_model=List[AdminHoursCategoryResponse])
async def list_categories(
    include_inactive: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List admin hours categories for the organization."""
    service = AdminHoursService(db)
    categories = await service.list_categories(
        str(current_user.organization_id),
        include_inactive=include_inactive,
    )
    return categories


@router.post(
    "/categories",
    response_model=AdminHoursCategoryResponse,
    status_code=201,
)
async def create_category(
    data: AdminHoursCategoryCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("admin_hours.manage")),
):
    """Create a new admin hours category."""
    service = AdminHoursService(db)
    try:
        category = await service.create_category(
            organization_id=str(current_user.organization_id),
            created_by=str(current_user.id),
            **data.model_dump(),
        )
        return category
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.patch(
    "/categories/{category_id}",
    response_model=AdminHoursCategoryResponse,
)
async def update_category(
    category_id: str,
    data: AdminHoursCategoryUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("admin_hours.manage")),
):
    """Update an admin hours category."""
    service = AdminHoursService(db)
    try:
        category = await service.update_category(
            category_id=category_id,
            organization_id=str(current_user.organization_id),
            updated_by=str(current_user.id),
            **data.model_dump(exclude_unset=True),
        )
        return category
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.delete("/categories/{category_id}", status_code=204)
async def delete_category(
    category_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("admin_hours.manage")),
):
    """Deactivate an admin hours category."""
    service = AdminHoursService(db)
    try:
        await service.delete_category(
            category_id=category_id,
            organization_id=str(current_user.organization_id),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


# =============================================================================
# QR Code Data
# =============================================================================


@router.get(
    "/categories/{category_id}/qr-data",
    response_model=AdminHoursQRData,
)
async def get_qr_data(
    category_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get data for the QR code display page."""
    service = AdminHoursService(db)
    try:
        data = await service.get_qr_data(
            category_id=category_id,
            organization_id=str(current_user.organization_id),
        )
        return data
    except ValueError as e:
        raise HTTPException(status_code=404, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


# =============================================================================
# Clock In / Clock Out
# =============================================================================


@router.post(
    "/clock-in/{category_id}",
    response_model=AdminHoursClockInResponse,
)
async def clock_in(
    category_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Clock in to an admin hours category (QR scan endpoint)."""
    service = AdminHoursService(db)
    try:
        entry = await service.clock_in(
            category_id=category_id,
            user_id=str(current_user.id),
            organization_id=str(current_user.organization_id),
        )
        # Get category name for response
        category = await service.get_category(
            category_id, str(current_user.organization_id)
        )
        return {
            "id": entry.id,
            "category_id": entry.category_id,
            "category_name": category.name if category else "Unknown",
            "clock_in_at": entry.clock_in_at,
            "status": entry.status.value,
            "message": f"Clocked in to {category.name if category else 'admin hours'}",
        }
    except ValueError as e:
        error_msg = str(e)
        if error_msg == "ALREADY_CLOCKED_IN":
            raise HTTPException(
                status_code=409,
                detail="ALREADY_CLOCKED_IN",
            )
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.post(
    "/clock-out/{entry_id}",
    response_model=AdminHoursClockOutResponse,
)
async def clock_out(
    entry_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Clock out from an active admin hours session."""
    service = AdminHoursService(db)
    try:
        entry = await service.clock_out(
            entry_id=entry_id,
            user_id=str(current_user.id),
        )
        category = await service.get_category(
            entry.category_id, str(current_user.organization_id)
        )
        return {
            "id": entry.id,
            "category_id": entry.category_id,
            "category_name": category.name if category else "Unknown",
            "clock_in_at": entry.clock_in_at,
            "clock_out_at": entry.clock_out_at,
            "duration_minutes": entry.duration_minutes,
            "status": entry.status.value,
            "message": f"Clocked out of {category.name if category else 'admin hours'} ({entry.duration_minutes} minutes)",
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.post(
    "/clock-out-by-category/{category_id}",
    response_model=AdminHoursClockOutResponse,
)
async def clock_out_by_category(
    category_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Clock out by category ID (used when scanning same QR code again)."""
    service = AdminHoursService(db)
    try:
        entry = await service.clock_out_by_category(
            category_id=category_id,
            user_id=str(current_user.id),
        )
        category = await service.get_category(
            category_id, str(current_user.organization_id)
        )
        return {
            "id": entry.id,
            "category_id": entry.category_id,
            "category_name": category.name if category else "Unknown",
            "clock_in_at": entry.clock_in_at,
            "clock_out_at": entry.clock_out_at,
            "duration_minutes": entry.duration_minutes,
            "status": entry.status.value,
            "message": f"Clocked out of {category.name if category else 'admin hours'} ({entry.duration_minutes} minutes)",
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


# =============================================================================
# Active Session
# =============================================================================


@router.get("/active", response_model=Optional[AdminHoursActiveSession])
async def get_active_session(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get the user's currently active admin hours session."""
    service = AdminHoursService(db)
    session = await service.get_active_session(str(current_user.id))
    return session


# =============================================================================
# Manual Entry
# =============================================================================


@router.post(
    "/entries",
    response_model=AdminHoursEntryResponse,
    status_code=201,
)
async def create_manual_entry(
    data: AdminHoursEntryCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a manual admin hours entry."""
    service = AdminHoursService(db)
    try:
        entry = await service.create_manual_entry(
            organization_id=str(current_user.organization_id),
            user_id=str(current_user.id),
            category_id=data.category_id,
            clock_in_at=data.clock_in_at,
            clock_out_at=data.clock_out_at,
            description=data.description,
        )
        category = await service.get_category(
            entry.category_id, str(current_user.organization_id)
        )
        return {
            "id": entry.id,
            "organization_id": entry.organization_id,
            "user_id": entry.user_id,
            "category_id": entry.category_id,
            "clock_in_at": entry.clock_in_at,
            "clock_out_at": entry.clock_out_at,
            "duration_minutes": entry.duration_minutes,
            "description": entry.description,
            "entry_method": entry.entry_method.value,
            "status": entry.status.value,
            "approved_by": entry.approved_by,
            "approved_at": entry.approved_at,
            "rejection_reason": entry.rejection_reason,
            "created_at": entry.created_at,
            "updated_at": entry.updated_at,
            "category_name": category.name if category else None,
            "category_color": category.color if category else None,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


# =============================================================================
# Entry Listings
# =============================================================================


@router.get("/entries/my", response_model=AdminHoursPaginatedEntries)
async def list_my_entries(
    status: Optional[str] = Query(None),
    category_id: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List the current user's admin hours entries with pagination."""
    parsed_start = datetime.fromisoformat(start_date) if start_date else None
    parsed_end = datetime.fromisoformat(end_date) if end_date else None

    service = AdminHoursService(db)
    entries, total = await service.list_my_entries(
        user_id=str(current_user.id),
        organization_id=str(current_user.organization_id),
        status_filter=status,
        category_id=category_id,
        start_date=parsed_start,
        end_date=parsed_end,
        skip=skip,
        limit=limit,
    )
    return {"entries": entries, "total": total, "skip": skip, "limit": limit}


@router.get("/entries", response_model=AdminHoursPaginatedEntries)
async def list_all_entries(
    status: Optional[str] = Query(None),
    category_id: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("admin_hours.manage")),
):
    """List all admin hours entries for the organization (admin view)."""
    parsed_start = datetime.fromisoformat(start_date) if start_date else None
    parsed_end = datetime.fromisoformat(end_date) if end_date else None

    service = AdminHoursService(db)
    entries, total = await service.list_all_entries(
        organization_id=str(current_user.organization_id),
        status_filter=status,
        category_id=category_id,
        user_id=user_id,
        start_date=parsed_start,
        end_date=parsed_end,
        skip=skip,
        limit=limit,
    )
    return {"entries": entries, "total": total, "skip": skip, "limit": limit}


# =============================================================================
# Approval
# =============================================================================


@router.post(
    "/entries/{entry_id}/review",
    response_model=AdminHoursEntryResponse,
)
async def review_entry(
    entry_id: str,
    data: AdminHoursApprovalAction,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("admin_hours.manage")),
):
    """Approve or reject a pending admin hours entry."""
    service = AdminHoursService(db)
    try:
        entry = await service.approve_or_reject(
            entry_id=entry_id,
            organization_id=str(current_user.organization_id),
            approver_id=str(current_user.id),
            action=data.action,
            rejection_reason=data.rejection_reason,
        )
        category = await service.get_category(
            entry.category_id, str(current_user.organization_id)
        )
        approver_name = f"{current_user.first_name} {current_user.last_name}"
        return {
            "id": entry.id,
            "organization_id": entry.organization_id,
            "user_id": entry.user_id,
            "category_id": entry.category_id,
            "clock_in_at": entry.clock_in_at,
            "clock_out_at": entry.clock_out_at,
            "duration_minutes": entry.duration_minutes,
            "description": entry.description,
            "entry_method": entry.entry_method.value,
            "status": entry.status.value,
            "approved_by": entry.approved_by,
            "approved_at": entry.approved_at,
            "rejection_reason": entry.rejection_reason,
            "created_at": entry.created_at,
            "updated_at": entry.updated_at,
            "category_name": category.name if category else None,
            "category_color": category.color if category else None,
            "approver_name": approver_name,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


# =============================================================================
# Bulk Approval
# =============================================================================


@router.post(
    "/entries/bulk-approve",
    response_model=AdminHoursBulkApproveResponse,
)
async def bulk_approve_entries(
    data: AdminHoursBulkApproveRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("admin_hours.manage")),
):
    """Approve multiple pending entries at once."""
    service = AdminHoursService(db)
    try:
        count = await service.bulk_approve(
            entry_ids=data.entry_ids,
            organization_id=str(current_user.organization_id),
            approver_id=str(current_user.id),
        )
        return {"approved_count": count}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


# =============================================================================
# Pending Count
# =============================================================================


@router.get("/pending-count")
async def get_pending_count(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("admin_hours.manage")),
):
    """Get the count of entries pending review."""
    service = AdminHoursService(db)
    count = await service.get_pending_count(str(current_user.organization_id))
    return {"count": count}


# =============================================================================
# CSV Export
# =============================================================================


@router.get("/entries/export")
async def export_entries(
    status: Optional[str] = Query(None),
    category_id: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("admin_hours.manage")),
):
    """Export admin hours entries as CSV."""
    parsed_start = datetime.fromisoformat(start_date) if start_date else None
    parsed_end = datetime.fromisoformat(end_date) if end_date else None

    service = AdminHoursService(db)
    try:
        csv_content = await service.export_entries_csv(
            organization_id=str(current_user.organization_id),
            status_filter=status,
            category_id=category_id,
            user_id=user_id,
            start_date=parsed_start,
            end_date=parsed_end,
        )
        return StreamingResponse(
            iter([csv_content]),
            media_type="text/csv",
            headers={
                "Content-Disposition": "attachment; filename=admin_hours_export.csv"
            },
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


# =============================================================================
# Stale Sessions
# =============================================================================


@router.post("/close-stale-sessions")
async def close_stale_sessions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("admin_hours.manage")),
):
    """Manually trigger auto-close of stale sessions that exceeded max hours."""
    service = AdminHoursService(db)
    try:
        count = await service.auto_close_stale_sessions()
        return {"closed_count": count}
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


# =============================================================================
# Summary / Reporting
# =============================================================================


@router.get("/summary", response_model=AdminHoursSummary)
async def get_summary(
    user_id: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get admin hours summary for reporting."""
    service = AdminHoursService(db)

    parsed_start = None
    parsed_end = None
    if start_date:
        parsed_start = datetime.fromisoformat(start_date)
    if end_date:
        parsed_end = datetime.fromisoformat(end_date)

    # Non-admins can only see their own summary
    effective_user_id = user_id
    if not any(
        p in ("admin_hours.manage", "*")
        for role in current_user.positions
        for p in (role.permissions or [])
    ):
        effective_user_id = str(current_user.id)

    summary = await service.get_summary(
        organization_id=str(current_user.organization_id),
        user_id=effective_user_id,
        start_date=parsed_start,
        end_date=parsed_end,
    )
    return summary
