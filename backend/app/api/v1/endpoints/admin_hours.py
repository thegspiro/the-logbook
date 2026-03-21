"""
Admin Hours API Endpoints

Handles admin hours categories, QR clock-in/clock-out, manual entry,
and approval workflows.
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import PaginationParams, get_current_user, require_permission
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import safe_error_detail
from app.models.user import User
from app.schemas.admin_hours import (
    AdminHoursActiveSession,
    AdminHoursActiveSessionAdmin,
    AdminHoursApprovalAction,
    AdminHoursBulkApproveRequest,
    AdminHoursBulkApproveResponse,
    AdminHoursCategoryCreate,
    AdminHoursCategoryResponse,
    AdminHoursCategoryUpdate,
    AdminHoursClockInResponse,
    AdminHoursClockOutResponse,
    AdminHoursClosedStaleResponse,
    AdminHoursComplianceItem,
    AdminHoursEntryCreate,
    AdminHoursEntryEdit,
    AdminHoursEntryResponse,
    AdminHoursPaginatedEntries,
    AdminHoursQRData,
    AdminHoursSummary,
    EventHourMappingCreate,
    EventHourMappingResponse,
    EventHourMappingUpdate,
)
from app.services.admin_hours_service import AdminHoursService

router = APIRouter()


# =============================================================================
# Categories
# =============================================================================


@router.get("/categories", response_model=list[AdminHoursCategoryResponse])
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
        await log_audit_event(
            db=db,
            event_type="admin_hours.category_created",
            event_category="administration",
            severity="info",
            event_data={"category_name": data.name},
            user_id=str(current_user.id),
            username=current_user.username,
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
        await log_audit_event(
            db=db,
            event_type="admin_hours.category_updated",
            event_category="administration",
            severity="info",
            event_data={
                "category_id": category_id,
                "fields_changed": list(data.model_dump(exclude_unset=True).keys()),
            },
            user_id=str(current_user.id),
            username=current_user.username,
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
# Active Sessions (Admin)
# =============================================================================


@router.get(
    "/active-sessions",
    response_model=list[AdminHoursActiveSessionAdmin],
)
async def list_active_sessions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("admin_hours.manage")),
):
    """List all currently active sessions across the organization."""
    service = AdminHoursService(db)
    sessions = await service.list_active_sessions(
        str(current_user.organization_id),
    )
    return sessions


@router.post(
    "/entries/{entry_id}/force-clock-out",
    response_model=AdminHoursEntryResponse,
)
async def force_clock_out(
    entry_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("admin_hours.manage")),
):
    """Force-end an active session on behalf of a user who cannot clock out."""
    service = AdminHoursService(db)
    try:
        entry = await service.admin_force_clock_out(
            entry_id=entry_id,
            organization_id=str(current_user.organization_id),
            admin_id=str(current_user.id),
        )
        category = await service.get_category(
            entry.category_id, str(current_user.organization_id)
        )
        # Get user info for the response
        user_result = await db.execute(select(User).where(User.id == entry.user_id))
        user = user_result.scalar_one_or_none()
        user_name = f"{user.first_name} {user.last_name}" if user else "Unknown"

        await log_audit_event(
            db=db,
            event_type="admin_hours.force_clock_out",
            event_category="administration",
            severity="warning",
            event_data={
                "entry_id": entry_id,
                "user_id": entry.user_id,
                "user_name": user_name,
                "duration_minutes": entry.duration_minutes,
            },
            user_id=str(current_user.id),
            username=current_user.username,
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
            "user_name": user_name,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


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
    status: str | None = Query(None),
    category_id: str | None = Query(None),
    start_date: str | None = Query(None),
    end_date: str | None = Query(None),
    pagination: PaginationParams = Depends(),
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
        skip=pagination.skip,
        limit=pagination.limit,
    )
    return {"entries": entries, "total": total, "skip": pagination.skip, "limit": pagination.limit}


@router.get("/entries", response_model=AdminHoursPaginatedEntries)
async def list_all_entries(
    status: str | None = Query(None),
    category_id: str | None = Query(None),
    user_id: str | None = Query(None),
    start_date: str | None = Query(None),
    end_date: str | None = Query(None),
    pagination: PaginationParams = Depends(),
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
        skip=pagination.skip,
        limit=pagination.limit,
    )
    return {"entries": entries, "total": total, "skip": pagination.skip, "limit": pagination.limit}


# =============================================================================
# Edit Pending Entry
# =============================================================================


@router.patch(
    "/entries/{entry_id}",
    response_model=AdminHoursEntryResponse,
)
async def edit_entry(
    entry_id: str,
    data: AdminHoursEntryEdit,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("admin_hours.manage")),
):
    """Edit a pending admin hours entry (adjust times, description, or category)."""
    service = AdminHoursService(db)
    try:
        entry = await service.edit_pending_entry(
            entry_id=entry_id,
            organization_id=str(current_user.organization_id),
            admin_id=str(current_user.id),
            clock_in_at=data.clock_in_at,
            clock_out_at=data.clock_out_at,
            description=data.description,
            category_id=data.category_id,
        )
        category = await service.get_category(
            entry.category_id, str(current_user.organization_id)
        )

        # Get user name
        user_result = await db.execute(select(User).where(User.id == entry.user_id))
        user = user_result.scalar_one_or_none()
        user_name = f"{user.first_name} {user.last_name}" if user else "Unknown"

        await log_audit_event(
            db=db,
            event_type="admin_hours.entry_edited",
            event_category="administration",
            severity="info",
            event_data={
                "entry_id": entry_id,
                "user_id": entry.user_id,
                "user_name": user_name,
                "fields_changed": list(data.model_dump(exclude_unset=True).keys()),
            },
            user_id=str(current_user.id),
            username=current_user.username,
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
            "user_name": user_name,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


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
    status: str | None = Query(None),
    category_id: str | None = Query(None),
    user_id: str | None = Query(None),
    start_date: str | None = Query(None),
    end_date: str | None = Query(None),
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


@router.post(
    "/close-stale-sessions",
    response_model=AdminHoursClosedStaleResponse,
)
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
    user_id: str | None = Query(None),
    start_date: str | None = Query(None),
    end_date: str | None = Query(None),
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


# =============================================================================
# Event Hour Mappings
# =============================================================================


@router.get(
    "/event-mappings",
    response_model=list[EventHourMappingResponse],
)
async def list_event_hour_mappings(
    include_inactive: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all event-to-admin-hours mappings for the organization."""
    service = AdminHoursService(db)
    mappings = await service.list_event_hour_mappings(
        str(current_user.organization_id),
        include_inactive=include_inactive,
    )
    return mappings


@router.post(
    "/event-mappings",
    response_model=EventHourMappingResponse,
    status_code=201,
)
async def create_event_hour_mapping(
    data: EventHourMappingCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("admin_hours.manage")),
):
    """Create a mapping from an event type to an admin hours category."""
    service = AdminHoursService(db)
    try:
        mapping = await service.create_event_hour_mapping(
            organization_id=str(current_user.organization_id),
            created_by=str(current_user.id),
            event_type=data.event_type,
            custom_category=data.custom_category,
            admin_hours_category_id=data.admin_hours_category_id,
            percentage=data.percentage,
        )
        cat = await service.get_category(
            mapping.admin_hours_category_id,
            str(current_user.organization_id),
        )
        await log_audit_event(
            db=db,
            event_type="admin_hours.event_mapping_created",
            event_category="administration",
            severity="info",
            event_data={
                "event_type": data.event_type,
                "custom_category": data.custom_category,
                "category_name": cat.name if cat else None,
                "percentage": data.percentage,
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )
        return {
            "id": mapping.id,
            "organization_id": mapping.organization_id,
            "event_type": mapping.event_type,
            "custom_category": mapping.custom_category,
            "admin_hours_category_id": mapping.admin_hours_category_id,
            "admin_hours_category_name": cat.name if cat else None,
            "admin_hours_category_color": cat.color if cat else None,
            "percentage": mapping.percentage,
            "is_active": mapping.is_active,
            "created_at": mapping.created_at,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.patch(
    "/event-mappings/{mapping_id}",
    response_model=EventHourMappingResponse,
)
async def update_event_hour_mapping(
    mapping_id: str,
    data: EventHourMappingUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("admin_hours.manage")),
):
    """Update an event hour mapping's percentage or active status."""
    service = AdminHoursService(db)
    try:
        mapping = await service.update_event_hour_mapping(
            mapping_id=mapping_id,
            organization_id=str(current_user.organization_id),
            **data.model_dump(exclude_unset=True),
        )
        cat = await service.get_category(
            mapping.admin_hours_category_id,
            str(current_user.organization_id),
        )
        return {
            "id": mapping.id,
            "organization_id": mapping.organization_id,
            "event_type": mapping.event_type,
            "custom_category": mapping.custom_category,
            "admin_hours_category_id": mapping.admin_hours_category_id,
            "admin_hours_category_name": cat.name if cat else None,
            "admin_hours_category_color": cat.color if cat else None,
            "percentage": mapping.percentage,
            "is_active": mapping.is_active,
            "created_at": mapping.created_at,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.delete("/event-mappings/{mapping_id}", status_code=204)
async def delete_event_hour_mapping(
    mapping_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("admin_hours.manage")),
):
    """Delete an event hour mapping."""
    service = AdminHoursService(db)
    try:
        await service.delete_event_hour_mapping(
            mapping_id=mapping_id,
            organization_id=str(current_user.organization_id),
        )
        await log_audit_event(
            db=db,
            event_type="admin_hours.event_mapping_deleted",
            event_category="administration",
            severity="info",
            event_data={"mapping_id": mapping_id},
            user_id=str(current_user.id),
            username=current_user.username,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


# =============================================================================
# Admin Hours Compliance
# =============================================================================


@router.get(
    "/compliance/{user_id}",
    response_model=list[AdminHoursComplianceItem],
)
async def get_user_hours_compliance(
    user_id: str,
    year: int = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a user's admin hours compliance progress.

    Returns progress against admin hours requirements defined in
    compliance profiles. Non-admins can only view their own compliance.
    """
    from datetime import date

    # Non-admins can only see their own compliance
    effective_user_id = user_id
    if user_id != str(current_user.id):
        has_perm = any(
            p in ("admin_hours.manage", "compliance.view", "*")
            for role in current_user.positions
            for p in (role.permissions or [])
        )
        if not has_perm:
            effective_user_id = str(current_user.id)

    effective_year = year if year else date.today().year

    service = AdminHoursService(db)
    try:
        results = await service.get_user_hours_compliance(
            organization_id=str(current_user.organization_id),
            user_id=effective_user_id,
            year=effective_year,
        )
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))
