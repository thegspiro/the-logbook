"""
Apparatus API Endpoints

Endpoints for apparatus/vehicle management including CRUD operations,
maintenance tracking, equipment, operators, and fleet management.
"""

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import date, datetime

from app.core.database import get_db
from app.models.user import User
from app.schemas.apparatus import (
    # Apparatus Type
    ApparatusTypeCreate,
    ApparatusTypeUpdate,
    ApparatusTypeResponse,
    ApparatusTypeListItem,
    # Apparatus Status
    ApparatusStatusCreate,
    ApparatusStatusUpdate,
    ApparatusStatusResponse,
    ApparatusStatusListItem,
    # Main Apparatus
    ApparatusCreate,
    ApparatusUpdate,
    ApparatusResponse,
    ApparatusListItem,
    ApparatusStatusChange,
    ApparatusArchive,
    ApparatusListFilters,
    PaginatedApparatusList,
    ApparatusFleetSummary,
    # Custom Fields
    ApparatusCustomFieldCreate,
    ApparatusCustomFieldUpdate,
    ApparatusCustomFieldResponse,
    # Maintenance
    ApparatusMaintenanceTypeCreate,
    ApparatusMaintenanceTypeUpdate,
    ApparatusMaintenanceTypeResponse,
    ApparatusMaintenanceCreate,
    ApparatusMaintenanceUpdate,
    ApparatusMaintenanceResponse,
    ApparatusMaintenanceDue,
    # Fuel
    ApparatusFuelLogCreate,
    ApparatusFuelLogUpdate,
    ApparatusFuelLogResponse,
    # Operators
    ApparatusOperatorCreate,
    ApparatusOperatorUpdate,
    ApparatusOperatorResponse,
    # Equipment
    ApparatusEquipmentCreate,
    ApparatusEquipmentUpdate,
    ApparatusEquipmentResponse,
    # Photos & Documents
    ApparatusPhotoCreate,
    ApparatusPhotoUpdate,
    ApparatusPhotoResponse,
    ApparatusDocumentCreate,
    ApparatusDocumentUpdate,
    ApparatusDocumentResponse,
    # NFPA Compliance
    ApparatusNFPAComplianceCreate,
    ApparatusNFPAComplianceUpdate,
    ApparatusNFPAComplianceResponse,
    # Report Configs
    ApparatusReportConfigCreate,
    ApparatusReportConfigUpdate,
    ApparatusReportConfigResponse,
    # Service Providers
    ApparatusServiceProviderCreate,
    ApparatusServiceProviderUpdate,
    ApparatusServiceProviderResponse,
    # Components
    ApparatusComponentCreate,
    ApparatusComponentUpdate,
    ApparatusComponentResponse,
    # Component Notes
    ApparatusComponentNoteCreate,
    ApparatusComponentNoteUpdate,
    ApparatusComponentNoteResponse,
    # Service Report
    ApparatusServiceReport,
)
from app.services.apparatus_service import ApparatusService
from app.api.dependencies import require_permission

router = APIRouter()


# ============================================================================
# Apparatus Type Endpoints
# ============================================================================

@router.get("/types", response_model=List[ApparatusTypeListItem], tags=["Apparatus Types"])
async def list_apparatus_types(
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    include_system: bool = Query(True, description="Include system-defined types"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.view", "apparatus.manage")),
):
    """
    List all apparatus types

    **Authentication required**
    **Permissions required:** apparatus.view or apparatus.manage
    """
    service = ApparatusService(db)
    types = await service.list_apparatus_types(
        organization_id=current_user.organization_id,
        is_active=is_active,
        include_system=include_system,
    )
    return types


@router.post("/types", response_model=ApparatusTypeResponse, status_code=status.HTTP_201_CREATED, tags=["Apparatus Types"])
async def create_apparatus_type(
    type_data: ApparatusTypeCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.manage")),
):
    """
    Create a new apparatus type

    **Authentication required**
    **Permissions required:** apparatus.manage
    """
    service = ApparatusService(db)

    try:
        apparatus_type = await service.create_apparatus_type(
            type_data=type_data,
            organization_id=current_user.organization_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return apparatus_type


@router.get("/types/{type_id}", response_model=ApparatusTypeResponse, tags=["Apparatus Types"])
async def get_apparatus_type(
    type_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.view", "apparatus.manage")),
):
    """
    Get a specific apparatus type by ID

    **Authentication required**
    **Permissions required:** apparatus.view or apparatus.manage
    """
    service = ApparatusService(db)
    apparatus_type = await service.get_apparatus_type(
        type_id=type_id,
        organization_id=current_user.organization_id,
    )

    if not apparatus_type:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Apparatus type not found"
        )

    return apparatus_type


@router.patch("/types/{type_id}", response_model=ApparatusTypeResponse, tags=["Apparatus Types"])
async def update_apparatus_type(
    type_id: str,
    type_data: ApparatusTypeUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.manage")),
):
    """
    Update an apparatus type

    **Authentication required**
    **Permissions required:** apparatus.manage
    """
    service = ApparatusService(db)

    try:
        apparatus_type = await service.update_apparatus_type(
            type_id=type_id,
            type_data=type_data,
            organization_id=current_user.organization_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if not apparatus_type:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Apparatus type not found"
        )

    return apparatus_type


@router.delete("/types/{type_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Apparatus Types"])
async def delete_apparatus_type(
    type_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.manage")),
):
    """
    Delete an apparatus type

    **Authentication required**
    **Permissions required:** apparatus.manage

    **Note:** Cannot delete types that are in use by apparatus.
    """
    service = ApparatusService(db)

    try:
        deleted = await service.delete_apparatus_type(
            type_id=type_id,
            organization_id=current_user.organization_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Apparatus type not found"
        )


# ============================================================================
# Apparatus Status Endpoints
# ============================================================================

@router.get("/statuses", response_model=List[ApparatusStatusListItem], tags=["Apparatus Statuses"])
async def list_apparatus_statuses(
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    include_system: bool = Query(True, description="Include system-defined statuses"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.view", "apparatus.manage")),
):
    """
    List all apparatus statuses

    **Authentication required**
    **Permissions required:** apparatus.view or apparatus.manage
    """
    service = ApparatusService(db)
    statuses = await service.list_apparatus_statuses(
        organization_id=current_user.organization_id,
        is_active=is_active,
        include_system=include_system,
    )
    return statuses


@router.post("/statuses", response_model=ApparatusStatusResponse, status_code=status.HTTP_201_CREATED, tags=["Apparatus Statuses"])
async def create_apparatus_status(
    status_data: ApparatusStatusCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.manage")),
):
    """
    Create a new apparatus status

    **Authentication required**
    **Permissions required:** apparatus.manage
    """
    service = ApparatusService(db)

    try:
        apparatus_status = await service.create_apparatus_status(
            status_data=status_data,
            organization_id=current_user.organization_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return apparatus_status


@router.get("/statuses/{status_id}", response_model=ApparatusStatusResponse, tags=["Apparatus Statuses"])
async def get_apparatus_status(
    status_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.view", "apparatus.manage")),
):
    """
    Get a specific apparatus status by ID

    **Authentication required**
    **Permissions required:** apparatus.view or apparatus.manage
    """
    service = ApparatusService(db)
    apparatus_status = await service.get_apparatus_status(
        status_id=status_id,
        organization_id=current_user.organization_id,
    )

    if not apparatus_status:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Apparatus status not found"
        )

    return apparatus_status


@router.patch("/statuses/{status_id}", response_model=ApparatusStatusResponse, tags=["Apparatus Statuses"])
async def update_apparatus_status(
    status_id: str,
    status_data: ApparatusStatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.manage")),
):
    """
    Update an apparatus status

    **Authentication required**
    **Permissions required:** apparatus.manage
    """
    service = ApparatusService(db)

    try:
        apparatus_status = await service.update_apparatus_status(
            status_id=status_id,
            status_data=status_data,
            organization_id=current_user.organization_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if not apparatus_status:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Apparatus status not found"
        )

    return apparatus_status


@router.delete("/statuses/{status_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Apparatus Statuses"])
async def delete_apparatus_status(
    status_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.manage")),
):
    """
    Delete an apparatus status

    **Authentication required**
    **Permissions required:** apparatus.manage

    **Note:** Cannot delete statuses that are in use by apparatus.
    """
    service = ApparatusService(db)

    try:
        deleted = await service.delete_apparatus_status(
            status_id=status_id,
            organization_id=current_user.organization_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Apparatus status not found"
        )


# ============================================================================
# Main Apparatus Endpoints
# ============================================================================

@router.get("", response_model=PaginatedApparatusList, tags=["Apparatus"])
async def list_apparatus(
    apparatus_type_id: Optional[str] = Query(None, description="Filter by apparatus type"),
    status_id: Optional[str] = Query(None, description="Filter by status"),
    primary_station_id: Optional[str] = Query(None, description="Filter by primary station"),
    is_archived: Optional[bool] = Query(False, description="Include archived apparatus"),
    year_min: Optional[int] = Query(None, description="Minimum year"),
    year_max: Optional[int] = Query(None, description="Maximum year"),
    make: Optional[str] = Query(None, description="Filter by make"),
    search: Optional[str] = Query(None, description="Search in unit number, name, VIN"),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.view", "apparatus.manage")),
):
    """
    List apparatus with filtering and pagination

    **Authentication required**
    **Permissions required:** apparatus.view or apparatus.manage
    """
    service = ApparatusService(db)

    filters = ApparatusListFilters(
        apparatus_type_id=apparatus_type_id,
        status_id=status_id,
        primary_station_id=primary_station_id,
        is_archived=is_archived,
        year_min=year_min,
        year_max=year_max,
        make=make,
        search=search,
    )

    skip = (page - 1) * page_size
    items, total = await service.list_apparatus(
        organization_id=current_user.organization_id,
        filters=filters,
        skip=skip,
        limit=page_size,
    )

    total_pages = (total + page_size - 1) // page_size

    return PaginatedApparatusList(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.post("", response_model=ApparatusResponse, status_code=status.HTTP_201_CREATED, tags=["Apparatus"])
async def create_apparatus(
    apparatus_data: ApparatusCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.create", "apparatus.manage")),
):
    """
    Create a new apparatus

    **Authentication required**
    **Permissions required:** apparatus.create or apparatus.manage
    """
    service = ApparatusService(db)

    try:
        apparatus = await service.create_apparatus(
            apparatus_data=apparatus_data,
            organization_id=current_user.organization_id,
            created_by=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    # Reload with relations
    apparatus = await service.get_apparatus(
        apparatus_id=apparatus.id,
        organization_id=current_user.organization_id,
    )

    return apparatus


@router.get("/summary", response_model=ApparatusFleetSummary, tags=["Apparatus"])
async def get_fleet_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.view", "apparatus.manage")),
):
    """
    Get fleet summary for dashboard

    **Authentication required**
    **Permissions required:** apparatus.view or apparatus.manage
    """
    service = ApparatusService(db)
    summary = await service.get_fleet_summary(
        organization_id=current_user.organization_id,
    )
    return summary


@router.get("/archived", response_model=PaginatedApparatusList, tags=["Apparatus"])
async def list_archived_apparatus(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.view", "apparatus.manage")),
):
    """
    List archived (previously owned) apparatus

    **Authentication required**
    **Permissions required:** apparatus.view or apparatus.manage
    """
    service = ApparatusService(db)

    filters = ApparatusListFilters(is_archived=True)
    skip = (page - 1) * page_size

    items, total = await service.list_apparatus(
        organization_id=current_user.organization_id,
        filters=filters,
        skip=skip,
        limit=page_size,
    )

    total_pages = (total + page_size - 1) // page_size

    return PaginatedApparatusList(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.get("/{apparatus_id}", response_model=ApparatusResponse, tags=["Apparatus"])
async def get_apparatus(
    apparatus_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.view", "apparatus.manage")),
):
    """
    Get a specific apparatus by ID

    **Authentication required**
    **Permissions required:** apparatus.view or apparatus.manage
    """
    service = ApparatusService(db)
    apparatus = await service.get_apparatus(
        apparatus_id=apparatus_id,
        organization_id=current_user.organization_id,
    )

    if not apparatus:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Apparatus not found"
        )

    return apparatus


@router.patch("/{apparatus_id}", response_model=ApparatusResponse, tags=["Apparatus"])
async def update_apparatus(
    apparatus_id: str,
    apparatus_data: ApparatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.edit", "apparatus.manage")),
):
    """
    Update an apparatus

    **Authentication required**
    **Permissions required:** apparatus.edit or apparatus.manage
    """
    service = ApparatusService(db)

    try:
        apparatus = await service.update_apparatus(
            apparatus_id=apparatus_id,
            apparatus_data=apparatus_data,
            organization_id=current_user.organization_id,
            updated_by=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if not apparatus:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Apparatus not found"
        )

    # Reload with relations
    apparatus = await service.get_apparatus(
        apparatus_id=apparatus.id,
        organization_id=current_user.organization_id,
    )

    return apparatus


@router.post("/{apparatus_id}/status", response_model=ApparatusResponse, tags=["Apparatus"])
async def change_apparatus_status(
    apparatus_id: str,
    status_change: ApparatusStatusChange,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.edit", "apparatus.manage")),
):
    """
    Change apparatus status

    **Authentication required**
    **Permissions required:** apparatus.edit or apparatus.manage
    """
    service = ApparatusService(db)

    try:
        apparatus = await service.change_apparatus_status(
            apparatus_id=apparatus_id,
            status_change=status_change,
            organization_id=current_user.organization_id,
            changed_by=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if not apparatus:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Apparatus not found"
        )

    # Reload with relations
    apparatus = await service.get_apparatus(
        apparatus_id=apparatus.id,
        organization_id=current_user.organization_id,
    )

    return apparatus


@router.post("/{apparatus_id}/archive", response_model=ApparatusResponse, tags=["Apparatus"])
async def archive_apparatus(
    apparatus_id: str,
    archive_data: ApparatusArchive,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.manage")),
):
    """
    Archive apparatus (sold/disposed)

    **Authentication required**
    **Permissions required:** apparatus.manage
    """
    service = ApparatusService(db)

    try:
        apparatus = await service.archive_apparatus(
            apparatus_id=apparatus_id,
            archive_data=archive_data,
            organization_id=current_user.organization_id,
            archived_by=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if not apparatus:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Apparatus not found"
        )

    return apparatus


@router.delete("/{apparatus_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Apparatus"])
async def delete_apparatus(
    apparatus_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.manage")),
):
    """
    Delete apparatus permanently

    **Authentication required**
    **Permissions required:** apparatus.manage

    **Warning:** This permanently deletes the apparatus and all related records.
    Consider using archive instead for historical tracking.
    """
    service = ApparatusService(db)

    deleted = await service.delete_apparatus(
        apparatus_id=apparatus_id,
        organization_id=current_user.organization_id,
    )

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Apparatus not found"
        )


# ============================================================================
# Custom Field Endpoints
# ============================================================================

@router.get("/custom-fields", response_model=List[ApparatusCustomFieldResponse], tags=["Custom Fields"])
async def list_custom_fields(
    is_active: Optional[bool] = Query(True, description="Filter by active status"),
    apparatus_type_id: Optional[str] = Query(None, description="Filter by applicable apparatus type"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.view", "apparatus.manage")),
):
    """
    List custom field definitions

    **Authentication required**
    **Permissions required:** apparatus.view or apparatus.manage
    """
    service = ApparatusService(db)
    fields = await service.list_custom_fields(
        organization_id=current_user.organization_id,
        is_active=is_active,
        apparatus_type_id=apparatus_type_id,
    )
    return fields


@router.post("/custom-fields", response_model=ApparatusCustomFieldResponse, status_code=status.HTTP_201_CREATED, tags=["Custom Fields"])
async def create_custom_field(
    field_data: ApparatusCustomFieldCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.manage")),
):
    """
    Create a custom field definition

    **Authentication required**
    **Permissions required:** apparatus.manage
    """
    service = ApparatusService(db)

    try:
        field = await service.create_custom_field(
            field_data=field_data,
            organization_id=current_user.organization_id,
            created_by=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return field


@router.patch("/custom-fields/{field_id}", response_model=ApparatusCustomFieldResponse, tags=["Custom Fields"])
async def update_custom_field(
    field_id: str,
    field_data: ApparatusCustomFieldUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.manage")),
):
    """
    Update a custom field definition

    **Authentication required**
    **Permissions required:** apparatus.manage
    """
    service = ApparatusService(db)

    try:
        field = await service.update_custom_field(
            field_id=field_id,
            field_data=field_data,
            organization_id=current_user.organization_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if not field:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Custom field not found"
        )

    return field


@router.delete("/custom-fields/{field_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Custom Fields"])
async def delete_custom_field(
    field_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.manage")),
):
    """
    Delete a custom field definition

    **Authentication required**
    **Permissions required:** apparatus.manage
    """
    service = ApparatusService(db)

    deleted = await service.delete_custom_field(
        field_id=field_id,
        organization_id=current_user.organization_id,
    )

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Custom field not found"
        )


# ============================================================================
# Maintenance Type Endpoints
# ============================================================================

@router.get("/maintenance-types", response_model=List[ApparatusMaintenanceTypeResponse], tags=["Maintenance Types"])
async def list_maintenance_types(
    is_active: Optional[bool] = Query(True, description="Filter by active status"),
    include_system: bool = Query(True, description="Include system-defined types"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.view", "apparatus.manage")),
):
    """
    List maintenance type definitions

    **Authentication required**
    **Permissions required:** apparatus.view or apparatus.manage
    """
    service = ApparatusService(db)
    types = await service.list_maintenance_types(
        organization_id=current_user.organization_id,
        is_active=is_active,
        include_system=include_system,
    )
    return types


@router.post("/maintenance-types", response_model=ApparatusMaintenanceTypeResponse, status_code=status.HTTP_201_CREATED, tags=["Maintenance Types"])
async def create_maintenance_type(
    type_data: ApparatusMaintenanceTypeCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.manage")),
):
    """
    Create a maintenance type definition

    **Authentication required**
    **Permissions required:** apparatus.manage
    """
    service = ApparatusService(db)

    try:
        maint_type = await service.create_maintenance_type(
            type_data=type_data,
            organization_id=current_user.organization_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return maint_type


@router.patch("/maintenance-types/{type_id}", response_model=ApparatusMaintenanceTypeResponse, tags=["Maintenance Types"])
async def update_maintenance_type(
    type_id: str,
    type_data: ApparatusMaintenanceTypeUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.manage")),
):
    """
    Update a maintenance type definition

    **Authentication required**
    **Permissions required:** apparatus.manage
    """
    service = ApparatusService(db)

    try:
        maint_type = await service.update_maintenance_type(
            type_id=type_id,
            type_data=type_data,
            organization_id=current_user.organization_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if not maint_type:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Maintenance type not found"
        )

    return maint_type


@router.delete("/maintenance-types/{type_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Maintenance Types"])
async def delete_maintenance_type(
    type_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.manage")),
):
    """
    Delete a maintenance type definition

    **Authentication required**
    **Permissions required:** apparatus.manage
    """
    service = ApparatusService(db)

    try:
        deleted = await service.delete_maintenance_type(
            type_id=type_id,
            organization_id=current_user.organization_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Maintenance type not found"
        )


# ============================================================================
# Maintenance Record Endpoints
# ============================================================================

@router.get("/maintenance", response_model=List[ApparatusMaintenanceResponse], tags=["Maintenance"])
async def list_maintenance_records(
    apparatus_id: Optional[str] = Query(None, description="Filter by apparatus"),
    maintenance_type_id: Optional[str] = Query(None, description="Filter by maintenance type"),
    is_completed: Optional[bool] = Query(None, description="Filter by completion status"),
    is_overdue: Optional[bool] = Query(None, description="Filter by overdue status"),
    is_historic: Optional[bool] = Query(None, description="Filter by historic entries (True=only historic, False=only current)"),
    occurred_after: Optional[date] = Query(None, description="Filter records that occurred on or after this date"),
    occurred_before: Optional[date] = Query(None, description="Filter records that occurred on or before this date"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.view", "apparatus.manage")),
):
    """
    List maintenance records.

    Supports filtering by historic entries and date ranges on `occurred_date`
    to help locate back-dated repair history.

    **Authentication required**
    **Permissions required:** apparatus.view or apparatus.manage
    """
    service = ApparatusService(db)
    records = await service.list_maintenance_records(
        organization_id=current_user.organization_id,
        apparatus_id=apparatus_id,
        maintenance_type_id=maintenance_type_id,
        is_completed=is_completed,
        is_overdue=is_overdue,
        is_historic=is_historic,
        occurred_after=occurred_after,
        occurred_before=occurred_before,
        skip=skip,
        limit=limit,
    )
    return records


@router.get("/maintenance/due", response_model=List[ApparatusMaintenanceDue], tags=["Maintenance"])
async def get_maintenance_due(
    days_ahead: int = Query(30, ge=1, le=365, description="Days ahead to check"),
    include_overdue: bool = Query(True, description="Include overdue maintenance"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.view", "apparatus.manage")),
):
    """
    Get maintenance due within specified days

    **Authentication required**
    **Permissions required:** apparatus.view or apparatus.manage
    """
    service = ApparatusService(db)
    due = await service.get_maintenance_due(
        organization_id=current_user.organization_id,
        days_ahead=days_ahead,
        include_overdue=include_overdue,
    )
    return due


@router.post("/maintenance", response_model=ApparatusMaintenanceResponse, status_code=status.HTTP_201_CREATED, tags=["Maintenance"])
async def create_maintenance_record(
    maintenance_data: ApparatusMaintenanceCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.maintenance", "apparatus.edit", "apparatus.manage")),
):
    """
    Create a maintenance record

    **Authentication required**
    **Permissions required:** apparatus.maintenance, apparatus.edit, or apparatus.manage
    """
    service = ApparatusService(db)

    try:
        record = await service.create_maintenance_record(
            maintenance_data=maintenance_data,
            organization_id=current_user.organization_id,
            created_by=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return record


@router.get("/maintenance/{record_id}", response_model=ApparatusMaintenanceResponse, tags=["Maintenance"])
async def get_maintenance_record(
    record_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.view", "apparatus.manage")),
):
    """
    Get a specific maintenance record

    **Authentication required**
    **Permissions required:** apparatus.view or apparatus.manage
    """
    service = ApparatusService(db)
    record = await service.get_maintenance_record(
        record_id=record_id,
        organization_id=current_user.organization_id,
    )

    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Maintenance record not found"
        )

    return record


@router.patch("/maintenance/{record_id}", response_model=ApparatusMaintenanceResponse, tags=["Maintenance"])
async def update_maintenance_record(
    record_id: str,
    maintenance_data: ApparatusMaintenanceUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.maintenance", "apparatus.edit", "apparatus.manage")),
):
    """
    Update a maintenance record

    **Authentication required**
    **Permissions required:** apparatus.maintenance, apparatus.edit, or apparatus.manage
    """
    service = ApparatusService(db)

    try:
        record = await service.update_maintenance_record(
            record_id=record_id,
            maintenance_data=maintenance_data,
            organization_id=current_user.organization_id,
            updated_by=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Maintenance record not found"
        )

    return record


@router.delete("/maintenance/{record_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Maintenance"])
async def delete_maintenance_record(
    record_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.manage")),
):
    """
    Delete a maintenance record

    **Authentication required**
    **Permissions required:** apparatus.manage
    """
    service = ApparatusService(db)

    deleted = await service.delete_maintenance_record(
        record_id=record_id,
        organization_id=current_user.organization_id,
    )

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Maintenance record not found"
        )


# ============================================================================
# Fuel Log Endpoints
# ============================================================================

@router.get("/fuel-logs", response_model=List[ApparatusFuelLogResponse], tags=["Fuel Logs"])
async def list_fuel_logs(
    apparatus_id: Optional[str] = Query(None, description="Filter by apparatus"),
    start_date: Optional[datetime] = Query(None, description="Start date filter"),
    end_date: Optional[datetime] = Query(None, description="End date filter"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.view", "apparatus.manage")),
):
    """
    List fuel log entries

    **Authentication required**
    **Permissions required:** apparatus.view or apparatus.manage
    """
    service = ApparatusService(db)
    logs = await service.list_fuel_logs(
        organization_id=current_user.organization_id,
        apparatus_id=apparatus_id,
        start_date=start_date,
        end_date=end_date,
        skip=skip,
        limit=limit,
    )
    return logs


@router.post("/fuel-logs", response_model=ApparatusFuelLogResponse, status_code=status.HTTP_201_CREATED, tags=["Fuel Logs"])
async def create_fuel_log(
    fuel_data: ApparatusFuelLogCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.maintenance", "apparatus.edit", "apparatus.manage")),
):
    """
    Create a fuel log entry

    **Authentication required**
    **Permissions required:** apparatus.maintenance, apparatus.edit, or apparatus.manage
    """
    service = ApparatusService(db)

    try:
        log = await service.create_fuel_log(
            fuel_data=fuel_data,
            organization_id=current_user.organization_id,
            recorded_by=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return log


# ============================================================================
# Operator Endpoints
# ============================================================================

@router.get("/operators", response_model=List[ApparatusOperatorResponse], tags=["Operators"])
async def list_operators(
    apparatus_id: Optional[str] = Query(None, description="Filter by apparatus"),
    user_id: Optional[str] = Query(None, description="Filter by user"),
    is_active: Optional[bool] = Query(True, description="Filter by active status"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(100, ge=1, le=500, description="Maximum records to return"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.view", "apparatus.manage")),
):
    """
    List apparatus operators

    **Authentication required**
    **Permissions required:** apparatus.view or apparatus.manage
    """
    service = ApparatusService(db)
    operators = await service.list_operators(
        organization_id=current_user.organization_id,
        apparatus_id=apparatus_id,
        user_id=user_id,
        is_active=is_active,
        skip=skip,
        limit=limit,
    )
    return operators


@router.post("/operators", response_model=ApparatusOperatorResponse, status_code=status.HTTP_201_CREATED, tags=["Operators"])
async def create_operator(
    operator_data: ApparatusOperatorCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.manage")),
):
    """
    Add an operator to apparatus

    **Authentication required**
    **Permissions required:** apparatus.manage
    """
    service = ApparatusService(db)

    try:
        operator = await service.create_operator(
            operator_data=operator_data,
            organization_id=current_user.organization_id,
            created_by=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return operator


@router.patch("/operators/{operator_id}", response_model=ApparatusOperatorResponse, tags=["Operators"])
async def update_operator(
    operator_id: str,
    operator_data: ApparatusOperatorUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.manage")),
):
    """
    Update operator information

    **Authentication required**
    **Permissions required:** apparatus.manage
    """
    service = ApparatusService(db)

    try:
        operator = await service.update_operator(
            operator_id=operator_id,
            operator_data=operator_data,
            organization_id=current_user.organization_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if not operator:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Operator not found"
        )

    return operator


@router.delete("/operators/{operator_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Operators"])
async def delete_operator(
    operator_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.manage")),
):
    """
    Remove operator from apparatus

    **Authentication required**
    **Permissions required:** apparatus.manage
    """
    service = ApparatusService(db)

    deleted = await service.delete_operator(
        operator_id=operator_id,
        organization_id=current_user.organization_id,
    )

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Operator not found"
        )


# ============================================================================
# Equipment Endpoints
# ============================================================================

@router.get("/equipment", response_model=List[ApparatusEquipmentResponse], tags=["Equipment"])
async def list_equipment(
    apparatus_id: Optional[str] = Query(None, description="Filter by apparatus"),
    is_present: Optional[bool] = Query(None, description="Filter by presence on apparatus"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(100, ge=1, le=500, description="Maximum records to return"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.view", "apparatus.manage")),
):
    """
    List apparatus equipment

    **Authentication required**
    **Permissions required:** apparatus.view or apparatus.manage
    """
    service = ApparatusService(db)
    equipment = await service.list_equipment(
        organization_id=current_user.organization_id,
        apparatus_id=apparatus_id,
        is_present=is_present,
        skip=skip,
        limit=limit,
    )
    return equipment


@router.post("/equipment", response_model=ApparatusEquipmentResponse, status_code=status.HTTP_201_CREATED, tags=["Equipment"])
async def create_equipment(
    equipment_data: ApparatusEquipmentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.edit", "apparatus.manage")),
):
    """
    Add equipment to apparatus

    **Authentication required**
    **Permissions required:** apparatus.edit or apparatus.manage
    """
    service = ApparatusService(db)

    try:
        equipment = await service.create_equipment(
            equipment_data=equipment_data,
            organization_id=current_user.organization_id,
            assigned_by=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return equipment


@router.patch("/equipment/{equipment_id}", response_model=ApparatusEquipmentResponse, tags=["Equipment"])
async def update_equipment(
    equipment_id: str,
    equipment_data: ApparatusEquipmentUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.edit", "apparatus.manage")),
):
    """
    Update equipment information

    **Authentication required**
    **Permissions required:** apparatus.edit or apparatus.manage
    """
    service = ApparatusService(db)

    try:
        equipment = await service.update_equipment(
            equipment_id=equipment_id,
            equipment_data=equipment_data,
            organization_id=current_user.organization_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if not equipment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Equipment not found"
        )

    return equipment


@router.delete("/equipment/{equipment_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Equipment"])
async def delete_equipment(
    equipment_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.manage")),
):
    """
    Remove equipment from apparatus

    **Authentication required**
    **Permissions required:** apparatus.manage
    """
    service = ApparatusService(db)

    deleted = await service.delete_equipment(
        equipment_id=equipment_id,
        organization_id=current_user.organization_id,
    )

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Equipment not found"
        )


# ============================================================================
# Photo Endpoints
# ============================================================================

@router.get("/{apparatus_id}/photos", response_model=List[ApparatusPhotoResponse], tags=["Photos"])
async def list_apparatus_photos(
    apparatus_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.view", "apparatus.manage")),
):
    """
    List photos for an apparatus

    **Authentication required**
    **Permissions required:** apparatus.view or apparatus.manage
    """
    service = ApparatusService(db)
    photos = await service.list_photos(
        organization_id=current_user.organization_id,
        apparatus_id=apparatus_id,
    )
    return photos


@router.post("/{apparatus_id}/photos", response_model=ApparatusPhotoResponse, status_code=status.HTTP_201_CREATED, tags=["Photos"])
async def create_apparatus_photo(
    apparatus_id: str,
    photo_data: ApparatusPhotoCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.edit", "apparatus.manage")),
):
    """
    Add a photo to apparatus

    **Authentication required**
    **Permissions required:** apparatus.edit or apparatus.manage

    **Note:** This endpoint expects the file to already be uploaded to storage.
    Use the file upload endpoint first, then call this with the file path.
    """
    service = ApparatusService(db)

    # Ensure apparatus_id matches
    photo_data.apparatus_id = apparatus_id

    photo = await service.create_photo(
        photo_data=photo_data,
        organization_id=current_user.organization_id,
        uploaded_by=current_user.id,
    )

    return photo


@router.delete("/{apparatus_id}/photos/{photo_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Photos"])
async def delete_apparatus_photo(
    apparatus_id: str,
    photo_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.manage")),
):
    """
    Delete a photo from apparatus

    **Authentication required**
    **Permissions required:** apparatus.manage
    """
    service = ApparatusService(db)

    deleted = await service.delete_photo(
        photo_id=photo_id,
        organization_id=current_user.organization_id,
    )

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Photo not found"
        )


# ============================================================================
# Document Endpoints
# ============================================================================

@router.get("/{apparatus_id}/documents", response_model=List[ApparatusDocumentResponse], tags=["Documents"])
async def list_apparatus_documents(
    apparatus_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.view", "apparatus.manage")),
):
    """
    List documents for an apparatus

    **Authentication required**
    **Permissions required:** apparatus.view or apparatus.manage
    """
    service = ApparatusService(db)
    documents = await service.list_documents(
        organization_id=current_user.organization_id,
        apparatus_id=apparatus_id,
    )
    return documents


@router.post("/{apparatus_id}/documents", response_model=ApparatusDocumentResponse, status_code=status.HTTP_201_CREATED, tags=["Documents"])
async def create_apparatus_document(
    apparatus_id: str,
    document_data: ApparatusDocumentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.edit", "apparatus.manage")),
):
    """
    Add a document to apparatus

    **Authentication required**
    **Permissions required:** apparatus.edit or apparatus.manage

    **Note:** This endpoint expects the file to already be uploaded to storage.
    Use the file upload endpoint first, then call this with the file path.
    """
    service = ApparatusService(db)

    # Ensure apparatus_id matches
    document_data.apparatus_id = apparatus_id

    document = await service.create_document(
        document_data=document_data,
        organization_id=current_user.organization_id,
        uploaded_by=current_user.id,
    )

    return document


@router.delete("/{apparatus_id}/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Documents"])
async def delete_apparatus_document(
    apparatus_id: str,
    document_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.manage")),
):
    """
    Delete a document from apparatus

    **Authentication required**
    **Permissions required:** apparatus.manage
    """
    service = ApparatusService(db)

    deleted = await service.delete_document(
        document_id=document_id,
        organization_id=current_user.organization_id,
    )

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )


# ============================================================================
# NFPA Compliance Endpoints
# ============================================================================

@router.get("/nfpa-compliance", response_model=List[ApparatusNFPAComplianceResponse], tags=["NFPA Compliance"])
async def list_nfpa_compliance(
    apparatus_id: Optional[str] = Query(None, description="Filter by apparatus"),
    compliance_status: Optional[str] = Query(None, description="Filter by status (compliant, non_compliant, pending, exempt)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.view", "apparatus.manage")),
):
    """
    List NFPA compliance records

    **Authentication required**
    **Permissions required:** apparatus.view or apparatus.manage
    """
    service = ApparatusService(db)
    records = await service.list_nfpa_compliance(
        organization_id=current_user.organization_id,
        apparatus_id=apparatus_id,
        compliance_status=compliance_status,
    )
    return records


@router.get("/nfpa-compliance/{compliance_id}", response_model=ApparatusNFPAComplianceResponse, tags=["NFPA Compliance"])
async def get_nfpa_compliance(
    compliance_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.view", "apparatus.manage")),
):
    """
    Get a specific NFPA compliance record

    **Authentication required**
    **Permissions required:** apparatus.view or apparatus.manage
    """
    service = ApparatusService(db)
    record = await service.get_nfpa_compliance(
        compliance_id=compliance_id,
        organization_id=current_user.organization_id,
    )

    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="NFPA compliance record not found"
        )

    return record


@router.post("/nfpa-compliance", response_model=ApparatusNFPAComplianceResponse, status_code=status.HTTP_201_CREATED, tags=["NFPA Compliance"])
async def create_nfpa_compliance(
    compliance_data: ApparatusNFPAComplianceCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.edit", "apparatus.manage")),
):
    """
    Create an NFPA compliance record

    **Authentication required**
    **Permissions required:** apparatus.edit or apparatus.manage
    """
    service = ApparatusService(db)

    try:
        record = await service.create_nfpa_compliance(
            compliance_data=compliance_data,
            organization_id=current_user.organization_id,
            checked_by=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return record


@router.patch("/nfpa-compliance/{compliance_id}", response_model=ApparatusNFPAComplianceResponse, tags=["NFPA Compliance"])
async def update_nfpa_compliance(
    compliance_id: str,
    compliance_data: ApparatusNFPAComplianceUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.edit", "apparatus.manage")),
):
    """
    Update an NFPA compliance record

    **Authentication required**
    **Permissions required:** apparatus.edit or apparatus.manage
    """
    service = ApparatusService(db)

    try:
        record = await service.update_nfpa_compliance(
            compliance_id=compliance_id,
            compliance_data=compliance_data,
            organization_id=current_user.organization_id,
            checked_by=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="NFPA compliance record not found"
        )

    return record


@router.delete("/nfpa-compliance/{compliance_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["NFPA Compliance"])
async def delete_nfpa_compliance(
    compliance_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.manage")),
):
    """
    Delete an NFPA compliance record

    **Authentication required**
    **Permissions required:** apparatus.manage
    """
    service = ApparatusService(db)

    deleted = await service.delete_nfpa_compliance(
        compliance_id=compliance_id,
        organization_id=current_user.organization_id,
    )

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="NFPA compliance record not found"
        )


# ============================================================================
# Report Config Endpoints
# ============================================================================

@router.get("/report-configs", response_model=List[ApparatusReportConfigResponse], tags=["Report Configs"])
async def list_report_configs(
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    report_type: Optional[str] = Query(None, description="Filter by report type"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.view", "apparatus.manage")),
):
    """
    List report configurations

    **Authentication required**
    **Permissions required:** apparatus.view or apparatus.manage
    """
    service = ApparatusService(db)
    configs = await service.list_report_configs(
        organization_id=current_user.organization_id,
        is_active=is_active,
        report_type=report_type,
    )
    return configs


@router.get("/report-configs/{config_id}", response_model=ApparatusReportConfigResponse, tags=["Report Configs"])
async def get_report_config(
    config_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.view", "apparatus.manage")),
):
    """
    Get a specific report config

    **Authentication required**
    **Permissions required:** apparatus.view or apparatus.manage
    """
    service = ApparatusService(db)
    config = await service.get_report_config(
        config_id=config_id,
        organization_id=current_user.organization_id,
    )

    if not config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Report config not found"
        )

    return config


@router.post("/report-configs", response_model=ApparatusReportConfigResponse, status_code=status.HTTP_201_CREATED, tags=["Report Configs"])
async def create_report_config(
    config_data: ApparatusReportConfigCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.manage")),
):
    """
    Create a report configuration

    **Authentication required**
    **Permissions required:** apparatus.manage
    """
    service = ApparatusService(db)

    try:
        config = await service.create_report_config(
            config_data=config_data,
            organization_id=current_user.organization_id,
            created_by=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return config


@router.patch("/report-configs/{config_id}", response_model=ApparatusReportConfigResponse, tags=["Report Configs"])
async def update_report_config(
    config_id: str,
    config_data: ApparatusReportConfigUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.manage")),
):
    """
    Update a report configuration

    **Authentication required**
    **Permissions required:** apparatus.manage
    """
    service = ApparatusService(db)

    try:
        config = await service.update_report_config(
            config_id=config_id,
            config_data=config_data,
            organization_id=current_user.organization_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if not config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Report config not found"
        )

    return config


@router.delete("/report-configs/{config_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Report Configs"])
async def delete_report_config(
    config_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.manage")),
):
    """
    Delete a report configuration

    **Authentication required**
    **Permissions required:** apparatus.manage
    """
    service = ApparatusService(db)

    deleted = await service.delete_report_config(
        config_id=config_id,
        organization_id=current_user.organization_id,
    )

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Report config not found"
        )


# ============================================================================
# Service Provider Endpoints
# ============================================================================

@router.get("/service-providers", response_model=List[ApparatusServiceProviderResponse], tags=["Service Providers"])
async def list_service_providers(
    is_active: Optional[bool] = Query(True, description="Filter by active status. Set to false to see archived providers, or omit for all."),
    is_preferred: Optional[bool] = Query(None, description="Filter preferred providers"),
    specialty: Optional[str] = Query(None, description="Filter by component specialty"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(100, ge=1, le=500, description="Maximum records to return"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.view", "apparatus.manage")),
):
    """
    List service providers.

    Defaults to showing only active providers. Pass `is_active=false` to see
    archived providers (for compliance/audit lookups), or omit the parameter
    to see all providers regardless of status.

    **Permissions required:** apparatus.view or apparatus.manage
    """
    service = ApparatusService(db)
    return await service.list_service_providers(
        organization_id=current_user.organization_id,
        is_active=is_active,
        specialty=specialty,
        is_preferred=is_preferred,
        skip=skip,
        limit=limit,
    )


@router.get("/service-providers/{provider_id}", response_model=ApparatusServiceProviderResponse, tags=["Service Providers"])
async def get_service_provider(
    provider_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.view", "apparatus.manage")),
):
    """
    Get a specific service provider

    **Permissions required:** apparatus.view or apparatus.manage
    """
    service = ApparatusService(db)
    provider = await service.get_service_provider(provider_id, current_user.organization_id)
    if not provider:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service provider not found")
    return provider


@router.post("/service-providers", response_model=ApparatusServiceProviderResponse, status_code=status.HTTP_201_CREATED, tags=["Service Providers"])
async def create_service_provider(
    provider_data: ApparatusServiceProviderCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.edit", "apparatus.manage")),
):
    """
    Create a service provider

    **Permissions required:** apparatus.edit or apparatus.manage
    """
    service = ApparatusService(db)
    try:
        return await service.create_service_provider(
            provider_data=provider_data,
            organization_id=current_user.organization_id,
            created_by=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.patch("/service-providers/{provider_id}", response_model=ApparatusServiceProviderResponse, tags=["Service Providers"])
async def update_service_provider(
    provider_id: str,
    provider_data: ApparatusServiceProviderUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.edit", "apparatus.manage")),
):
    """
    Update a service provider

    **Permissions required:** apparatus.edit or apparatus.manage
    """
    service = ApparatusService(db)
    try:
        provider = await service.update_service_provider(provider_id, provider_data, current_user.organization_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    if not provider:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service provider not found")
    return provider


@router.post("/service-providers/{provider_id}/archive", response_model=ApparatusServiceProviderResponse, tags=["Service Providers"])
async def archive_service_provider(
    provider_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.manage")),
):
    """
    Archive a service provider (soft-delete).

    Service providers are never permanently deleted so their records remain
    available for historical compliance checks and audit trails.

    **Permissions required:** apparatus.manage
    """
    service = ApparatusService(db)
    provider = await service.archive_service_provider(
        provider_id, current_user.organization_id, current_user.id
    )
    if not provider:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service provider not found")
    return provider


@router.post("/service-providers/{provider_id}/restore", response_model=ApparatusServiceProviderResponse, tags=["Service Providers"])
async def restore_service_provider(
    provider_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.manage")),
):
    """
    Restore an archived service provider back to active status.

    **Permissions required:** apparatus.manage
    """
    service = ApparatusService(db)
    provider = await service.restore_service_provider(
        provider_id, current_user.organization_id
    )
    if not provider:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service provider not found")
    return provider


# ============================================================================
# Component Endpoints
# ============================================================================

@router.get("/components", response_model=List[ApparatusComponentResponse], tags=["Components"])
async def list_components(
    apparatus_id: Optional[str] = Query(None, description="Filter by apparatus"),
    component_type: Optional[str] = Query(None, description="Filter by component type"),
    is_active: Optional[bool] = Query(True, description="Filter by active status"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(100, ge=1, le=500, description="Maximum records to return"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.view", "apparatus.manage")),
):
    """
    List apparatus components

    **Permissions required:** apparatus.view or apparatus.manage
    """
    service = ApparatusService(db)
    return await service.list_components(
        organization_id=current_user.organization_id,
        apparatus_id=apparatus_id,
        component_type=component_type,
        is_active=is_active,
        skip=skip,
        limit=limit,
    )


@router.get("/components/{component_id}", response_model=ApparatusComponentResponse, tags=["Components"])
async def get_component(
    component_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.view", "apparatus.manage")),
):
    """
    Get a specific component

    **Permissions required:** apparatus.view or apparatus.manage
    """
    service = ApparatusService(db)
    component = await service.get_component(component_id, current_user.organization_id)
    if not component:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Component not found")
    return component


@router.post("/components", response_model=ApparatusComponentResponse, status_code=status.HTTP_201_CREATED, tags=["Components"])
async def create_component(
    component_data: ApparatusComponentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.edit", "apparatus.manage")),
):
    """
    Create a component on an apparatus

    **Permissions required:** apparatus.edit or apparatus.manage
    """
    service = ApparatusService(db)
    try:
        return await service.create_component(
            component_data=component_data,
            organization_id=current_user.organization_id,
            created_by=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.patch("/components/{component_id}", response_model=ApparatusComponentResponse, tags=["Components"])
async def update_component(
    component_id: str,
    component_data: ApparatusComponentUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.edit", "apparatus.manage")),
):
    """
    Update a component

    **Permissions required:** apparatus.edit or apparatus.manage
    """
    service = ApparatusService(db)
    try:
        component = await service.update_component(component_id, component_data, current_user.organization_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    if not component:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Component not found")
    return component


@router.delete("/components/{component_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Components"])
async def delete_component(
    component_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.manage")),
):
    """
    Archive a component (soft-delete)

    **Permissions required:** apparatus.manage
    """
    service = ApparatusService(db)
    if not await service.delete_component(
        component_id, current_user.organization_id, archived_by=current_user.id,
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Component not found")


# ============================================================================
# Component Note Endpoints
# ============================================================================

@router.get("/component-notes", response_model=List[ApparatusComponentNoteResponse], tags=["Component Notes"])
async def list_component_notes(
    apparatus_id: Optional[str] = Query(None, description="Filter by apparatus"),
    component_id: Optional[str] = Query(None, description="Filter by component"),
    note_status: Optional[str] = Query(None, description="Filter by status (open, in_progress, resolved, deferred)"),
    severity: Optional[str] = Query(None, description="Filter by severity"),
    note_type: Optional[str] = Query(None, description="Filter by note type"),
    service_provider_id: Optional[str] = Query(None, description="Filter by service provider"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(100, ge=1, le=500, description="Maximum records to return"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.view", "apparatus.manage")),
):
    """
    List component notes with filtering

    **Permissions required:** apparatus.view or apparatus.manage
    """
    service = ApparatusService(db)
    return await service.list_component_notes(
        organization_id=current_user.organization_id,
        apparatus_id=apparatus_id,
        component_id=component_id,
        note_status=note_status,
        severity=severity,
        note_type=note_type,
        service_provider_id=service_provider_id,
        skip=skip,
        limit=limit,
    )


@router.get("/component-notes/{note_id}", response_model=ApparatusComponentNoteResponse, tags=["Component Notes"])
async def get_component_note(
    note_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.view", "apparatus.manage")),
):
    """
    Get a specific component note

    **Permissions required:** apparatus.view or apparatus.manage
    """
    service = ApparatusService(db)
    note = await service.get_component_note(note_id, current_user.organization_id)
    if not note:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Component note not found")
    return note


@router.post("/component-notes", response_model=ApparatusComponentNoteResponse, status_code=status.HTTP_201_CREATED, tags=["Component Notes"])
async def create_component_note(
    note_data: ApparatusComponentNoteCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.maintenance", "apparatus.edit", "apparatus.manage")),
):
    """
    Create a component note (observation, issue, repair record, etc.)

    **Permissions required:** apparatus.maintenance, apparatus.edit, or apparatus.manage
    """
    service = ApparatusService(db)
    try:
        return await service.create_component_note(
            note_data=note_data,
            organization_id=current_user.organization_id,
            created_by=current_user.id,
            reported_by=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.patch("/component-notes/{note_id}", response_model=ApparatusComponentNoteResponse, tags=["Component Notes"])
async def update_component_note(
    note_id: str,
    note_data: ApparatusComponentNoteUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.maintenance", "apparatus.edit", "apparatus.manage")),
):
    """
    Update a component note

    **Permissions required:** apparatus.maintenance, apparatus.edit, or apparatus.manage
    """
    service = ApparatusService(db)
    try:
        note = await service.update_component_note(
            note_id=note_id,
            note_data=note_data,
            organization_id=current_user.organization_id,
            resolved_by=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    if not note:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Component note not found")
    return note


@router.delete("/component-notes/{note_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Component Notes"])
async def delete_component_note(
    note_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.manage")),
):
    """
    Delete a component note

    **Permissions required:** apparatus.manage
    """
    service = ApparatusService(db)
    if not await service.delete_component_note(note_id, current_user.organization_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Component note not found")


# ============================================================================
# Service Report Generation
# ============================================================================

@router.get("/{apparatus_id}/service-report", response_model=ApparatusServiceReport, tags=["Service Reports"])
async def generate_service_report(
    apparatus_id: str,
    component_ids: Optional[str] = Query(None, description="Comma-separated component IDs to scope the report"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("apparatus.view", "apparatus.manage")),
):
    """
    Generate a service report for an apparatus.

    Returns a compiled document with the apparatus details, component breakdown,
    open issues, recent maintenance history, and relevant service providers.

    Optionally scope to specific components (e.g., just the pump area)
    by passing comma-separated component IDs.

    **Permissions required:** apparatus.view or apparatus.manage
    """
    service = ApparatusService(db)

    parsed_ids = None
    if component_ids:
        parsed_ids = [cid.strip() for cid in component_ids.split(",") if cid.strip()]

    try:
        return await service.generate_service_report(
            apparatus_id=apparatus_id,
            organization_id=current_user.organization_id,
            component_ids=parsed_ids,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
