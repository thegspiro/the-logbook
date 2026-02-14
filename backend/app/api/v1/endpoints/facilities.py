"""
Facilities API Endpoints

Endpoints for facility/building management including CRUD operations,
maintenance tracking, building systems, inspections, photos, and documents.
"""

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import date, datetime

from app.core.database import get_db
from app.models.user import User
from app.schemas.facilities import (
    # Facility Type
    FacilityTypeCreate,
    FacilityTypeUpdate,
    FacilityTypeResponse,
    FacilityTypeListItem,
    # Facility Status
    FacilityStatusCreate,
    FacilityStatusUpdate,
    FacilityStatusResponse,
    FacilityStatusListItem,
    # Main Facility
    FacilityCreate,
    FacilityUpdate,
    FacilityResponse,
    FacilityListItem,
    # Photos
    FacilityPhotoCreate,
    FacilityPhotoResponse,
    # Documents
    FacilityDocumentCreate,
    FacilityDocumentResponse,
    # Maintenance Types
    FacilityMaintenanceTypeCreate,
    FacilityMaintenanceTypeUpdate,
    FacilityMaintenanceTypeResponse,
    # Maintenance Records
    FacilityMaintenanceCreate,
    FacilityMaintenanceUpdate,
    FacilityMaintenanceResponse,
    # Systems
    FacilitySystemCreate,
    FacilitySystemUpdate,
    FacilitySystemResponse,
    # Inspections
    FacilityInspectionCreate,
    FacilityInspectionUpdate,
    FacilityInspectionResponse,
    InspectionTypeEnum,
)
from app.services.facilities_service import FacilitiesService
from app.api.dependencies import require_permission

router = APIRouter()


# ============================================================================
# Facility Type Endpoints
# ============================================================================

@router.get("/types", response_model=List[FacilityTypeListItem], tags=["Facility Types"])
async def list_facility_types(
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    include_system: bool = Query(True, description="Include system-defined types"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.view", "facilities.manage")),
):
    """
    List all facility types

    **Authentication required**
    **Permissions required:** facilities.view or facilities.manage
    """
    service = FacilitiesService(db)
    types = await service.list_facility_types(
        organization_id=current_user.organization_id,
        is_active=is_active,
        include_system=include_system,
    )
    return types


@router.post("/types", response_model=FacilityTypeResponse, status_code=status.HTTP_201_CREATED, tags=["Facility Types"])
async def create_facility_type(
    type_data: FacilityTypeCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.manage")),
):
    """
    Create a new facility type

    **Authentication required**
    **Permissions required:** facilities.manage
    """
    service = FacilitiesService(db)

    try:
        facility_type = await service.create_facility_type(
            type_data=type_data,
            organization_id=current_user.organization_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return facility_type


@router.patch("/types/{type_id}", response_model=FacilityTypeResponse, tags=["Facility Types"])
async def update_facility_type(
    type_id: str,
    type_data: FacilityTypeUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.manage")),
):
    """
    Update a facility type

    **Authentication required**
    **Permissions required:** facilities.manage
    """
    service = FacilitiesService(db)

    try:
        facility_type = await service.update_facility_type(
            type_id=type_id,
            type_data=type_data,
            organization_id=current_user.organization_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if not facility_type:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Facility type not found"
        )

    return facility_type


@router.delete("/types/{type_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Facility Types"])
async def delete_facility_type(
    type_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.manage")),
):
    """
    Delete a facility type

    **Authentication required**
    **Permissions required:** facilities.manage

    **Note:** Cannot delete types that are in use by facilities.
    """
    service = FacilitiesService(db)

    try:
        deleted = await service.delete_facility_type(
            type_id=type_id,
            organization_id=current_user.organization_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Facility type not found"
        )


# ============================================================================
# Facility Status Endpoints
# ============================================================================

@router.get("/statuses", response_model=List[FacilityStatusListItem], tags=["Facility Statuses"])
async def list_facility_statuses(
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    include_system: bool = Query(True, description="Include system-defined statuses"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.view", "facilities.manage")),
):
    """
    List all facility statuses

    **Authentication required**
    **Permissions required:** facilities.view or facilities.manage
    """
    service = FacilitiesService(db)
    statuses = await service.list_facility_statuses(
        organization_id=current_user.organization_id,
        is_active=is_active,
        include_system=include_system,
    )
    return statuses


@router.post("/statuses", response_model=FacilityStatusResponse, status_code=status.HTTP_201_CREATED, tags=["Facility Statuses"])
async def create_facility_status(
    status_data: FacilityStatusCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.manage")),
):
    """
    Create a new facility status

    **Authentication required**
    **Permissions required:** facilities.manage
    """
    service = FacilitiesService(db)

    try:
        facility_status = await service.create_facility_status(
            status_data=status_data,
            organization_id=current_user.organization_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return facility_status


@router.patch("/statuses/{status_id}", response_model=FacilityStatusResponse, tags=["Facility Statuses"])
async def update_facility_status(
    status_id: str,
    status_data: FacilityStatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.manage")),
):
    """
    Update a facility status

    **Authentication required**
    **Permissions required:** facilities.manage
    """
    service = FacilitiesService(db)

    try:
        facility_status = await service.update_facility_status(
            status_id=status_id,
            status_data=status_data,
            organization_id=current_user.organization_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if not facility_status:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Facility status not found"
        )

    return facility_status


@router.delete("/statuses/{status_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Facility Statuses"])
async def delete_facility_status(
    status_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.manage")),
):
    """
    Delete a facility status

    **Authentication required**
    **Permissions required:** facilities.manage

    **Note:** Cannot delete statuses that are in use by facilities.
    """
    service = FacilitiesService(db)

    try:
        deleted = await service.delete_facility_status(
            status_id=status_id,
            organization_id=current_user.organization_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Facility status not found"
        )


# ============================================================================
# Main Facility Endpoints
# ============================================================================

@router.get("", response_model=List[FacilityListItem], tags=["Facilities"])
async def list_facilities(
    facility_type_id: Optional[str] = Query(None, description="Filter by facility type"),
    status_id: Optional[str] = Query(None, description="Filter by status"),
    is_archived: Optional[bool] = Query(False, description="Include archived facilities"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(100, ge=1, le=500, description="Maximum records to return"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.view", "facilities.manage")),
):
    """
    List facilities with filtering and pagination

    **Authentication required**
    **Permissions required:** facilities.view or facilities.manage
    """
    service = FacilitiesService(db)
    facilities = await service.list_facilities(
        organization_id=current_user.organization_id,
        facility_type_id=facility_type_id,
        status_id=status_id,
        is_archived=is_archived,
        skip=skip,
        limit=limit,
    )
    return facilities


@router.post("", response_model=FacilityResponse, status_code=status.HTTP_201_CREATED, tags=["Facilities"])
async def create_facility(
    facility_data: FacilityCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.create", "facilities.manage")),
):
    """
    Create a new facility

    **Authentication required**
    **Permissions required:** facilities.create or facilities.manage
    """
    service = FacilitiesService(db)

    try:
        facility = await service.create_facility(
            facility_data=facility_data,
            organization_id=current_user.organization_id,
            created_by=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    # Reload with relations
    facility = await service.get_facility(
        facility_id=facility.id,
        organization_id=current_user.organization_id,
    )

    return facility


@router.get("/{facility_id}", response_model=FacilityResponse, tags=["Facilities"])
async def get_facility(
    facility_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.view", "facilities.manage")),
):
    """
    Get a specific facility by ID

    **Authentication required**
    **Permissions required:** facilities.view or facilities.manage
    """
    service = FacilitiesService(db)
    facility = await service.get_facility(
        facility_id=facility_id,
        organization_id=current_user.organization_id,
    )

    if not facility:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Facility not found"
        )

    return facility


@router.patch("/{facility_id}", response_model=FacilityResponse, tags=["Facilities"])
async def update_facility(
    facility_id: str,
    facility_data: FacilityUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.edit", "facilities.manage")),
):
    """
    Update a facility

    **Authentication required**
    **Permissions required:** facilities.edit or facilities.manage
    """
    service = FacilitiesService(db)

    try:
        facility = await service.update_facility(
            facility_id=facility_id,
            facility_data=facility_data,
            organization_id=current_user.organization_id,
            updated_by=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if not facility:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Facility not found"
        )

    # Reload with relations
    facility = await service.get_facility(
        facility_id=facility.id,
        organization_id=current_user.organization_id,
    )

    return facility


@router.post("/{facility_id}/archive", response_model=FacilityResponse, tags=["Facilities"])
async def archive_facility(
    facility_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.manage")),
):
    """
    Archive a facility

    **Authentication required**
    **Permissions required:** facilities.manage
    """
    service = FacilitiesService(db)

    try:
        facility = await service.archive_facility(
            facility_id=facility_id,
            organization_id=current_user.organization_id,
            archived_by=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if not facility:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Facility not found"
        )

    return facility


@router.post("/{facility_id}/restore", response_model=FacilityResponse, tags=["Facilities"])
async def restore_facility(
    facility_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.manage")),
):
    """
    Restore an archived facility

    **Authentication required**
    **Permissions required:** facilities.manage
    """
    service = FacilitiesService(db)

    try:
        facility = await service.restore_facility(
            facility_id=facility_id,
            organization_id=current_user.organization_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if not facility:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Facility not found"
        )

    return facility


# ============================================================================
# Photo Endpoints
# ============================================================================

@router.get("/photos", response_model=List[FacilityPhotoResponse], tags=["Facility Photos"])
async def list_facility_photos(
    facility_id: Optional[str] = Query(None, description="Filter by facility"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(100, ge=1, le=500, description="Maximum records to return"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.view", "facilities.manage")),
):
    """
    List facility photos

    **Authentication required**
    **Permissions required:** facilities.view or facilities.manage
    """
    service = FacilitiesService(db)
    photos = await service.list_photos(
        organization_id=current_user.organization_id,
        facility_id=facility_id,
        skip=skip,
        limit=limit,
    )
    return photos


@router.post("/photos", response_model=FacilityPhotoResponse, status_code=status.HTTP_201_CREATED, tags=["Facility Photos"])
async def create_facility_photo(
    photo_data: FacilityPhotoCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.create", "facilities.edit", "facilities.manage")),
):
    """
    Add a photo to a facility

    **Authentication required**
    **Permissions required:** facilities.create, facilities.edit, or facilities.manage

    **Note:** This endpoint expects the file to already be uploaded to storage.
    Use the file upload endpoint first, then call this with the file path.
    """
    service = FacilitiesService(db)

    try:
        photo = await service.create_photo(
            photo_data=photo_data,
            organization_id=current_user.organization_id,
            uploaded_by=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return photo


@router.delete("/photos/{photo_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Facility Photos"])
async def delete_facility_photo(
    photo_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.manage")),
):
    """
    Delete a facility photo

    **Authentication required**
    **Permissions required:** facilities.manage
    """
    service = FacilitiesService(db)

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

@router.get("/documents", response_model=List[FacilityDocumentResponse], tags=["Facility Documents"])
async def list_facility_documents(
    facility_id: Optional[str] = Query(None, description="Filter by facility"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(100, ge=1, le=500, description="Maximum records to return"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.view", "facilities.manage")),
):
    """
    List facility documents

    **Authentication required**
    **Permissions required:** facilities.view or facilities.manage
    """
    service = FacilitiesService(db)
    documents = await service.list_documents(
        organization_id=current_user.organization_id,
        facility_id=facility_id,
        skip=skip,
        limit=limit,
    )
    return documents


@router.post("/documents", response_model=FacilityDocumentResponse, status_code=status.HTTP_201_CREATED, tags=["Facility Documents"])
async def create_facility_document(
    document_data: FacilityDocumentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.create", "facilities.edit", "facilities.manage")),
):
    """
    Add a document to a facility

    **Authentication required**
    **Permissions required:** facilities.create, facilities.edit, or facilities.manage

    **Note:** This endpoint expects the file to already be uploaded to storage.
    Use the file upload endpoint first, then call this with the file path.
    """
    service = FacilitiesService(db)

    try:
        document = await service.create_document(
            document_data=document_data,
            organization_id=current_user.organization_id,
            uploaded_by=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return document


@router.delete("/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Facility Documents"])
async def delete_facility_document(
    document_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.manage")),
):
    """
    Delete a facility document

    **Authentication required**
    **Permissions required:** facilities.manage
    """
    service = FacilitiesService(db)

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
# Maintenance Type Endpoints
# ============================================================================

@router.get("/maintenance-types", response_model=List[FacilityMaintenanceTypeResponse], tags=["Facility Maintenance Types"])
async def list_facility_maintenance_types(
    is_active: Optional[bool] = Query(True, description="Filter by active status"),
    include_system: bool = Query(True, description="Include system-defined types"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.view", "facilities.manage")),
):
    """
    List facility maintenance type definitions

    **Authentication required**
    **Permissions required:** facilities.view or facilities.manage
    """
    service = FacilitiesService(db)
    types = await service.list_maintenance_types(
        organization_id=current_user.organization_id,
        is_active=is_active,
        include_system=include_system,
    )
    return types


@router.post("/maintenance-types", response_model=FacilityMaintenanceTypeResponse, status_code=status.HTTP_201_CREATED, tags=["Facility Maintenance Types"])
async def create_facility_maintenance_type(
    type_data: FacilityMaintenanceTypeCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.manage")),
):
    """
    Create a facility maintenance type definition

    **Authentication required**
    **Permissions required:** facilities.manage
    """
    service = FacilitiesService(db)

    try:
        maint_type = await service.create_maintenance_type(
            type_data=type_data,
            organization_id=current_user.organization_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return maint_type


@router.patch("/maintenance-types/{type_id}", response_model=FacilityMaintenanceTypeResponse, tags=["Facility Maintenance Types"])
async def update_facility_maintenance_type(
    type_id: str,
    type_data: FacilityMaintenanceTypeUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.manage")),
):
    """
    Update a facility maintenance type definition

    **Authentication required**
    **Permissions required:** facilities.manage
    """
    service = FacilitiesService(db)

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


@router.delete("/maintenance-types/{type_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Facility Maintenance Types"])
async def delete_facility_maintenance_type(
    type_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.manage")),
):
    """
    Delete a facility maintenance type definition

    **Authentication required**
    **Permissions required:** facilities.manage
    """
    service = FacilitiesService(db)

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

@router.get("/maintenance", response_model=List[FacilityMaintenanceResponse], tags=["Facility Maintenance"])
async def list_facility_maintenance_records(
    facility_id: Optional[str] = Query(None, description="Filter by facility"),
    maintenance_type_id: Optional[str] = Query(None, description="Filter by maintenance type"),
    is_completed: Optional[bool] = Query(None, description="Filter by completion status"),
    is_overdue: Optional[bool] = Query(None, description="Filter by overdue status"),
    is_historic: Optional[bool] = Query(None, description="Filter by historic entries (True=only historic, False=only current)"),
    occurred_after: Optional[date] = Query(None, description="Filter records that occurred on or after this date"),
    occurred_before: Optional[date] = Query(None, description="Filter records that occurred on or before this date"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(100, ge=1, le=500, description="Maximum records to return"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.view", "facilities.manage")),
):
    """
    List facility maintenance records.

    Supports filtering by historic entries and date ranges on `occurred_date`
    to help locate back-dated maintenance history.

    **Authentication required**
    **Permissions required:** facilities.view or facilities.manage
    """
    service = FacilitiesService(db)
    records = await service.list_maintenance_records(
        organization_id=current_user.organization_id,
        facility_id=facility_id,
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


@router.post("/maintenance", response_model=FacilityMaintenanceResponse, status_code=status.HTTP_201_CREATED, tags=["Facility Maintenance"])
async def create_facility_maintenance_record(
    maintenance_data: FacilityMaintenanceCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.maintenance", "facilities.edit", "facilities.manage")),
):
    """
    Create a facility maintenance record

    **Authentication required**
    **Permissions required:** facilities.maintenance, facilities.edit, or facilities.manage
    """
    service = FacilitiesService(db)

    try:
        record = await service.create_maintenance_record(
            maintenance_data=maintenance_data,
            organization_id=current_user.organization_id,
            created_by=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return record


@router.get("/maintenance/{record_id}", response_model=FacilityMaintenanceResponse, tags=["Facility Maintenance"])
async def get_facility_maintenance_record(
    record_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.view", "facilities.manage")),
):
    """
    Get a specific facility maintenance record

    **Authentication required**
    **Permissions required:** facilities.view or facilities.manage
    """
    service = FacilitiesService(db)
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


@router.patch("/maintenance/{record_id}", response_model=FacilityMaintenanceResponse, tags=["Facility Maintenance"])
async def update_facility_maintenance_record(
    record_id: str,
    maintenance_data: FacilityMaintenanceUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.maintenance", "facilities.edit", "facilities.manage")),
):
    """
    Update a facility maintenance record

    **Authentication required**
    **Permissions required:** facilities.maintenance, facilities.edit, or facilities.manage
    """
    service = FacilitiesService(db)

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


@router.delete("/maintenance/{record_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Facility Maintenance"])
async def delete_facility_maintenance_record(
    record_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.manage")),
):
    """
    Delete a facility maintenance record

    **Authentication required**
    **Permissions required:** facilities.manage
    """
    service = FacilitiesService(db)

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
# System Endpoints
# ============================================================================

@router.get("/systems", response_model=List[FacilitySystemResponse], tags=["Facility Systems"])
async def list_facility_systems(
    facility_id: Optional[str] = Query(None, description="Filter by facility"),
    system_type: Optional[str] = Query(None, description="Filter by system type"),
    is_active: Optional[bool] = Query(True, description="Filter by active status"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(100, ge=1, le=500, description="Maximum records to return"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.view", "facilities.manage")),
):
    """
    List facility building systems

    **Authentication required**
    **Permissions required:** facilities.view or facilities.manage
    """
    service = FacilitiesService(db)
    systems = await service.list_systems(
        organization_id=current_user.organization_id,
        facility_id=facility_id,
        system_type=system_type,
        is_active=is_active,
        skip=skip,
        limit=limit,
    )
    return systems


@router.post("/systems", response_model=FacilitySystemResponse, status_code=status.HTTP_201_CREATED, tags=["Facility Systems"])
async def create_facility_system(
    system_data: FacilitySystemCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.create", "facilities.edit", "facilities.manage")),
):
    """
    Create a building system for a facility

    **Authentication required**
    **Permissions required:** facilities.create, facilities.edit, or facilities.manage
    """
    service = FacilitiesService(db)

    try:
        system = await service.create_system(
            system_data=system_data,
            organization_id=current_user.organization_id,
            created_by=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return system


@router.get("/systems/{system_id}", response_model=FacilitySystemResponse, tags=["Facility Systems"])
async def get_facility_system(
    system_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.view", "facilities.manage")),
):
    """
    Get a specific building system

    **Authentication required**
    **Permissions required:** facilities.view or facilities.manage
    """
    service = FacilitiesService(db)
    system = await service.get_system(
        system_id=system_id,
        organization_id=current_user.organization_id,
    )

    if not system:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="System not found"
        )

    return system


@router.patch("/systems/{system_id}", response_model=FacilitySystemResponse, tags=["Facility Systems"])
async def update_facility_system(
    system_id: str,
    system_data: FacilitySystemUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.edit", "facilities.manage")),
):
    """
    Update a building system

    **Authentication required**
    **Permissions required:** facilities.edit or facilities.manage
    """
    service = FacilitiesService(db)

    try:
        system = await service.update_system(
            system_id=system_id,
            system_data=system_data,
            organization_id=current_user.organization_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if not system:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="System not found"
        )

    return system


@router.delete("/systems/{system_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Facility Systems"])
async def delete_facility_system(
    system_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.manage")),
):
    """
    Archive a building system (soft-delete)

    **Authentication required**
    **Permissions required:** facilities.manage
    """
    service = FacilitiesService(db)

    if not await service.delete_system(
        system_id=system_id,
        organization_id=current_user.organization_id,
        archived_by=current_user.id,
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="System not found"
        )


# ============================================================================
# Inspection Endpoints
# ============================================================================

@router.get("/inspections", response_model=List[FacilityInspectionResponse], tags=["Facility Inspections"])
async def list_facility_inspections(
    facility_id: Optional[str] = Query(None, description="Filter by facility"),
    inspection_type: Optional[InspectionTypeEnum] = Query(None, description="Filter by inspection type"),
    passed: Optional[bool] = Query(None, description="Filter by pass/fail status"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(100, ge=1, le=500, description="Maximum records to return"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.view", "facilities.manage")),
):
    """
    List facility inspections

    **Authentication required**
    **Permissions required:** facilities.view or facilities.manage
    """
    service = FacilitiesService(db)
    inspections = await service.list_inspections(
        organization_id=current_user.organization_id,
        facility_id=facility_id,
        inspection_type=inspection_type,
        passed=passed,
        skip=skip,
        limit=limit,
    )
    return inspections


@router.post("/inspections", response_model=FacilityInspectionResponse, status_code=status.HTTP_201_CREATED, tags=["Facility Inspections"])
async def create_facility_inspection(
    inspection_data: FacilityInspectionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.create", "facilities.edit", "facilities.manage")),
):
    """
    Create a facility inspection record

    **Authentication required**
    **Permissions required:** facilities.create, facilities.edit, or facilities.manage
    """
    service = FacilitiesService(db)

    try:
        inspection = await service.create_inspection(
            inspection_data=inspection_data,
            organization_id=current_user.organization_id,
            created_by=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return inspection


@router.get("/inspections/{inspection_id}", response_model=FacilityInspectionResponse, tags=["Facility Inspections"])
async def get_facility_inspection(
    inspection_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.view", "facilities.manage")),
):
    """
    Get a specific facility inspection

    **Authentication required**
    **Permissions required:** facilities.view or facilities.manage
    """
    service = FacilitiesService(db)
    inspection = await service.get_inspection(
        inspection_id=inspection_id,
        organization_id=current_user.organization_id,
    )

    if not inspection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Inspection not found"
        )

    return inspection


@router.patch("/inspections/{inspection_id}", response_model=FacilityInspectionResponse, tags=["Facility Inspections"])
async def update_facility_inspection(
    inspection_id: str,
    inspection_data: FacilityInspectionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.edit", "facilities.manage")),
):
    """
    Update a facility inspection record

    **Authentication required**
    **Permissions required:** facilities.edit or facilities.manage
    """
    service = FacilitiesService(db)

    try:
        inspection = await service.update_inspection(
            inspection_id=inspection_id,
            inspection_data=inspection_data,
            organization_id=current_user.organization_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if not inspection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Inspection not found"
        )

    return inspection


@router.delete("/inspections/{inspection_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Facility Inspections"])
async def delete_facility_inspection(
    inspection_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.manage")),
):
    """
    Delete a facility inspection record

    **Authentication required**
    **Permissions required:** facilities.manage
    """
    service = FacilitiesService(db)

    deleted = await service.delete_inspection(
        inspection_id=inspection_id,
        organization_id=current_user.organization_id,
    )

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Inspection not found"
        )
