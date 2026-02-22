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
from app.core.utils import safe_error_detail
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
    FacilityPhotoUpdate,
    FacilityPhotoResponse,
    # Documents
    FacilityDocumentCreate,
    FacilityDocumentUpdate,
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
    # Utility Accounts
    UtilityTypeEnum,
    BillingCycleEnum,
    FacilityUtilityAccountCreate,
    FacilityUtilityAccountUpdate,
    FacilityUtilityAccountResponse,
    FacilityUtilityReadingCreate,
    FacilityUtilityReadingUpdate,
    FacilityUtilityReadingResponse,
    # Access Keys
    KeyTypeEnum,
    FacilityAccessKeyCreate,
    FacilityAccessKeyUpdate,
    FacilityAccessKeyResponse,
    # Rooms
    RoomTypeEnum,
    FacilityRoomCreate,
    FacilityRoomUpdate,
    FacilityRoomResponse,
    # Emergency Contacts
    EmergencyContactTypeEnum,
    FacilityEmergencyContactCreate,
    FacilityEmergencyContactUpdate,
    FacilityEmergencyContactResponse,
    # Shutoff Locations
    ShutoffTypeEnum,
    FacilityShutoffLocationCreate,
    FacilityShutoffLocationUpdate,
    FacilityShutoffLocationResponse,
    # Capital Projects
    CapitalProjectTypeEnum,
    CapitalProjectStatusEnum,
    FacilityCapitalProjectCreate,
    FacilityCapitalProjectUpdate,
    FacilityCapitalProjectResponse,
    # Insurance Policies
    InsurancePolicyTypeEnum,
    FacilityInsurancePolicyCreate,
    FacilityInsurancePolicyUpdate,
    FacilityInsurancePolicyResponse,
    # Occupants
    FacilityOccupantCreate,
    FacilityOccupantUpdate,
    FacilityOccupantResponse,
    # Compliance Checklists
    ComplianceTypeEnum,
    FacilityComplianceChecklistCreate,
    FacilityComplianceChecklistUpdate,
    FacilityComplianceChecklistResponse,
    FacilityComplianceItemCreate,
    FacilityComplianceItemUpdate,
    FacilityComplianceItemResponse,
)
from app.services.facilities_service import FacilitiesService
from app.services.documents_service import DocumentsService
from app.schemas.documents import FoldersListResponse
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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e))

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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e))

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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e))

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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e))

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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e))

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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e))

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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e))

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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e))

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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e))

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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e))

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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e))

    return photo


@router.patch("/photos/{photo_id}", response_model=FacilityPhotoResponse, tags=["Facility Photos"])
async def update_facility_photo(
    photo_id: str,
    photo_data: FacilityPhotoUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.edit", "facilities.manage")),
):
    """
    Update a facility photo

    **Authentication required**
    **Permissions required:** facilities.edit or facilities.manage
    """
    service = FacilitiesService(db)

    photo = await service.update_photo(
        photo_id=photo_id,
        photo_data=photo_data,
        organization_id=current_user.organization_id,
    )

    if not photo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Photo not found"
        )

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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e))

    return document


@router.patch("/documents/{document_id}", response_model=FacilityDocumentResponse, tags=["Facility Documents"])
async def update_facility_document(
    document_id: str,
    document_data: FacilityDocumentUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.edit", "facilities.manage")),
):
    """
    Update a facility document

    **Authentication required**
    **Permissions required:** facilities.edit or facilities.manage
    """
    service = FacilitiesService(db)

    document = await service.update_document(
        document_id=document_id,
        document_data=document_data,
        organization_id=current_user.organization_id,
    )

    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )

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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e))

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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e))

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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e))

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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e))

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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e))

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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e))

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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e))

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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e))

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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e))

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


# ============================================================================
# Utility Account Endpoints
# ============================================================================

@router.get("/utility-accounts", response_model=List[FacilityUtilityAccountResponse], tags=["Facility Utilities"])
async def list_facility_utility_accounts(
    facility_id: Optional[str] = Query(None, description="Filter by facility"),
    utility_type: Optional[UtilityTypeEnum] = Query(None, description="Filter by utility type"),
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(100, ge=1, le=500, description="Maximum records to return"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.view", "facilities.manage")),
):
    """
    List facility utility accounts

    **Authentication required**
    **Permissions required:** facilities.view or facilities.manage
    """
    service = FacilitiesService(db)
    accounts = await service.list_utility_accounts(
        organization_id=current_user.organization_id,
        facility_id=facility_id,
        utility_type=utility_type,
        is_active=is_active,
        skip=skip,
        limit=limit,
    )
    return accounts


@router.post("/utility-accounts", response_model=FacilityUtilityAccountResponse, status_code=status.HTTP_201_CREATED, tags=["Facility Utilities"])
async def create_facility_utility_account(
    account_data: FacilityUtilityAccountCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.create", "facilities.edit", "facilities.manage")),
):
    """
    Create a facility utility account

    **Authentication required**
    **Permissions required:** facilities.create, facilities.edit, or facilities.manage
    """
    service = FacilitiesService(db)

    try:
        account = await service.create_utility_account(
            account_data=account_data,
            organization_id=current_user.organization_id,
            created_by=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e))

    return account


@router.get("/utility-accounts/{account_id}", response_model=FacilityUtilityAccountResponse, tags=["Facility Utilities"])
async def get_facility_utility_account(
    account_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.view", "facilities.manage")),
):
    """
    Get a specific facility utility account

    **Authentication required**
    **Permissions required:** facilities.view or facilities.manage
    """
    service = FacilitiesService(db)
    account = await service.get_utility_account(
        account_id=account_id,
        organization_id=current_user.organization_id,
    )

    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Utility account not found"
        )

    return account


@router.patch("/utility-accounts/{account_id}", response_model=FacilityUtilityAccountResponse, tags=["Facility Utilities"])
async def update_facility_utility_account(
    account_id: str,
    account_data: FacilityUtilityAccountUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.edit", "facilities.manage")),
):
    """
    Update a facility utility account

    **Authentication required**
    **Permissions required:** facilities.edit or facilities.manage
    """
    service = FacilitiesService(db)

    try:
        account = await service.update_utility_account(
            account_id=account_id,
            account_data=account_data,
            organization_id=current_user.organization_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e))

    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Utility account not found"
        )

    return account


@router.delete("/utility-accounts/{account_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Facility Utilities"])
async def delete_facility_utility_account(
    account_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.manage")),
):
    """
    Delete a facility utility account

    **Authentication required**
    **Permissions required:** facilities.manage
    """
    service = FacilitiesService(db)

    deleted = await service.delete_utility_account(
        account_id=account_id,
        organization_id=current_user.organization_id,
    )

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Utility account not found"
        )


# ============================================================================
# Utility Reading Endpoints
# ============================================================================

@router.get("/utility-accounts/{account_id}/readings", response_model=List[FacilityUtilityReadingResponse], tags=["Facility Utilities"])
async def list_facility_utility_readings(
    account_id: str,
    reading_after: Optional[date] = Query(None, description="Filter readings on or after this date"),
    reading_before: Optional[date] = Query(None, description="Filter readings on or before this date"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(100, ge=1, le=500, description="Maximum records to return"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.view", "facilities.manage")),
):
    """
    List utility readings for a specific account

    **Authentication required**
    **Permissions required:** facilities.view or facilities.manage
    """
    service = FacilitiesService(db)
    readings = await service.list_utility_readings(
        utility_account_id=account_id,
        organization_id=current_user.organization_id,
        after_date=reading_after,
        before_date=reading_before,
        skip=skip,
        limit=limit,
    )
    return readings


@router.post("/utility-accounts/{account_id}/readings", response_model=FacilityUtilityReadingResponse, status_code=status.HTTP_201_CREATED, tags=["Facility Utilities"])
async def create_facility_utility_reading(
    account_id: str,
    reading_data: FacilityUtilityReadingCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.create", "facilities.edit", "facilities.manage")),
):
    """
    Create a utility reading for an account

    **Authentication required**
    **Permissions required:** facilities.create, facilities.edit, or facilities.manage
    """
    service = FacilitiesService(db)

    # Ensure reading is associated with the correct account from URL path
    reading_data.utility_account_id = account_id

    try:
        reading = await service.create_utility_reading(
            reading_data=reading_data,
            organization_id=current_user.organization_id,
            created_by=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e))

    return reading


@router.patch("/utility-readings/{reading_id}", response_model=FacilityUtilityReadingResponse, tags=["Facility Utilities"])
async def update_facility_utility_reading(
    reading_id: str,
    reading_data: FacilityUtilityReadingUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.edit", "facilities.manage")),
):
    """
    Update a utility reading

    **Authentication required**
    **Permissions required:** facilities.edit or facilities.manage
    """
    service = FacilitiesService(db)

    reading = await service.update_utility_reading(
        reading_id=reading_id,
        reading_data=reading_data,
        organization_id=current_user.organization_id,
    )

    if not reading:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Utility reading not found"
        )

    return reading


@router.delete("/utility-readings/{reading_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Facility Utilities"])
async def delete_facility_utility_reading(
    reading_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.manage")),
):
    """
    Delete a utility reading

    **Authentication required**
    **Permissions required:** facilities.manage
    """
    service = FacilitiesService(db)

    deleted = await service.delete_utility_reading(
        reading_id=reading_id,
        organization_id=current_user.organization_id,
    )

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Utility reading not found"
        )


# ============================================================================
# Access Key Endpoints
# ============================================================================

@router.get("/access-keys", response_model=List[FacilityAccessKeyResponse], tags=["Facility Access"])
async def list_facility_access_keys(
    facility_id: Optional[str] = Query(None, description="Filter by facility"),
    key_type: Optional[KeyTypeEnum] = Query(None, description="Filter by key type"),
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    assigned_to_user_id: Optional[str] = Query(None, description="Filter by assigned user"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(100, ge=1, le=500, description="Maximum records to return"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.view", "facilities.manage")),
):
    """
    List facility access keys

    **Authentication required**
    **Permissions required:** facilities.view or facilities.manage
    """
    service = FacilitiesService(db)
    keys = await service.list_access_keys(
        organization_id=current_user.organization_id,
        facility_id=facility_id,
        key_type=key_type,
        is_active=is_active,
        assigned_to_user_id=assigned_to_user_id,
        skip=skip,
        limit=limit,
    )
    return keys


@router.post("/access-keys", response_model=FacilityAccessKeyResponse, status_code=status.HTTP_201_CREATED, tags=["Facility Access"])
async def create_facility_access_key(
    key_data: FacilityAccessKeyCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.create", "facilities.edit", "facilities.manage")),
):
    """
    Create a facility access key

    **Authentication required**
    **Permissions required:** facilities.create, facilities.edit, or facilities.manage
    """
    service = FacilitiesService(db)

    try:
        key = await service.create_access_key(
            key_data=key_data,
            organization_id=current_user.organization_id,
            created_by=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e))

    return key


@router.get("/access-keys/{key_id}", response_model=FacilityAccessKeyResponse, tags=["Facility Access"])
async def get_facility_access_key(
    key_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.view", "facilities.manage")),
):
    """
    Get a specific facility access key

    **Authentication required**
    **Permissions required:** facilities.view or facilities.manage
    """
    service = FacilitiesService(db)
    key = await service.get_access_key(
        key_id=key_id,
        organization_id=current_user.organization_id,
    )

    if not key:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Access key not found"
        )

    return key


@router.patch("/access-keys/{key_id}", response_model=FacilityAccessKeyResponse, tags=["Facility Access"])
async def update_facility_access_key(
    key_id: str,
    key_data: FacilityAccessKeyUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.edit", "facilities.manage")),
):
    """
    Update a facility access key

    **Authentication required**
    **Permissions required:** facilities.edit or facilities.manage
    """
    service = FacilitiesService(db)

    try:
        key = await service.update_access_key(
            key_id=key_id,
            key_data=key_data,
            organization_id=current_user.organization_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e))

    if not key:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Access key not found"
        )

    return key


@router.delete("/access-keys/{key_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Facility Access"])
async def delete_facility_access_key(
    key_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.manage")),
):
    """
    Delete a facility access key

    **Authentication required**
    **Permissions required:** facilities.manage
    """
    service = FacilitiesService(db)

    deleted = await service.delete_access_key(
        key_id=key_id,
        organization_id=current_user.organization_id,
    )

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Access key not found"
        )


# ============================================================================
# Room Endpoints
# ============================================================================

@router.get("/rooms", response_model=List[FacilityRoomResponse], tags=["Facility Rooms"])
async def list_facility_rooms(
    facility_id: Optional[str] = Query(None, description="Filter by facility"),
    room_type: Optional[RoomTypeEnum] = Query(None, description="Filter by room type"),
    floor: Optional[int] = Query(None, description="Filter by floor number"),
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(100, ge=1, le=500, description="Maximum records to return"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.view", "facilities.manage")),
):
    """
    List facility rooms

    **Authentication required**
    **Permissions required:** facilities.view or facilities.manage
    """
    service = FacilitiesService(db)
    rooms = await service.list_rooms(
        organization_id=current_user.organization_id,
        facility_id=facility_id,
        room_type=room_type,
        floor=floor,
        is_active=is_active,
        skip=skip,
        limit=limit,
    )
    return rooms


@router.post("/rooms", response_model=FacilityRoomResponse, status_code=status.HTTP_201_CREATED, tags=["Facility Rooms"])
async def create_facility_room(
    room_data: FacilityRoomCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.create", "facilities.edit", "facilities.manage")),
):
    """
    Create a facility room

    **Authentication required**
    **Permissions required:** facilities.create, facilities.edit, or facilities.manage
    """
    service = FacilitiesService(db)

    try:
        room = await service.create_room(
            room_data=room_data,
            organization_id=current_user.organization_id,
            created_by=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e))

    return room


@router.get("/rooms/{room_id}", response_model=FacilityRoomResponse, tags=["Facility Rooms"])
async def get_facility_room(
    room_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.view", "facilities.manage")),
):
    """
    Get a specific facility room

    **Authentication required**
    **Permissions required:** facilities.view or facilities.manage
    """
    service = FacilitiesService(db)
    room = await service.get_room(
        room_id=room_id,
        organization_id=current_user.organization_id,
    )

    if not room:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Room not found"
        )

    return room


@router.patch("/rooms/{room_id}", response_model=FacilityRoomResponse, tags=["Facility Rooms"])
async def update_facility_room(
    room_id: str,
    room_data: FacilityRoomUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.edit", "facilities.manage")),
):
    """
    Update a facility room

    **Authentication required**
    **Permissions required:** facilities.edit or facilities.manage
    """
    service = FacilitiesService(db)

    try:
        room = await service.update_room(
            room_id=room_id,
            room_data=room_data,
            organization_id=current_user.organization_id,
            updated_by=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e))

    if not room:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Room not found"
        )

    return room


@router.delete("/rooms/{room_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Facility Rooms"])
async def delete_facility_room(
    room_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.manage")),
):
    """
    Delete a facility room

    **Authentication required**
    **Permissions required:** facilities.manage
    """
    service = FacilitiesService(db)

    deleted = await service.delete_room(
        room_id=room_id,
        organization_id=current_user.organization_id,
    )

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Room not found"
        )


# ============================================================================
# Emergency Contact Endpoints
# ============================================================================

@router.get("/emergency-contacts", response_model=List[FacilityEmergencyContactResponse], tags=["Facility Emergency"])
async def list_facility_emergency_contacts(
    facility_id: Optional[str] = Query(None, description="Filter by facility"),
    contact_type: Optional[EmergencyContactTypeEnum] = Query(None, description="Filter by contact type"),
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(100, ge=1, le=500, description="Maximum records to return"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.view", "facilities.manage")),
):
    """
    List facility emergency contacts

    **Authentication required**
    **Permissions required:** facilities.view or facilities.manage
    """
    service = FacilitiesService(db)
    contacts = await service.list_emergency_contacts(
        organization_id=current_user.organization_id,
        facility_id=facility_id,
        contact_type=contact_type,
        is_active=is_active,
        skip=skip,
        limit=limit,
    )
    return contacts


@router.post("/emergency-contacts", response_model=FacilityEmergencyContactResponse, status_code=status.HTTP_201_CREATED, tags=["Facility Emergency"])
async def create_facility_emergency_contact(
    contact_data: FacilityEmergencyContactCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.create", "facilities.edit", "facilities.manage")),
):
    """
    Create a facility emergency contact

    **Authentication required**
    **Permissions required:** facilities.create, facilities.edit, or facilities.manage
    """
    service = FacilitiesService(db)

    try:
        contact = await service.create_emergency_contact(
            contact_data=contact_data,
            organization_id=current_user.organization_id,
            created_by=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e))

    return contact


@router.get("/emergency-contacts/{contact_id}", response_model=FacilityEmergencyContactResponse, tags=["Facility Emergency"])
async def get_facility_emergency_contact(
    contact_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.view", "facilities.manage")),
):
    """
    Get a specific facility emergency contact

    **Authentication required**
    **Permissions required:** facilities.view or facilities.manage
    """
    service = FacilitiesService(db)
    contact = await service.get_emergency_contact(
        contact_id=contact_id,
        organization_id=current_user.organization_id,
    )

    if not contact:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Emergency contact not found"
        )

    return contact


@router.patch("/emergency-contacts/{contact_id}", response_model=FacilityEmergencyContactResponse, tags=["Facility Emergency"])
async def update_facility_emergency_contact(
    contact_id: str,
    contact_data: FacilityEmergencyContactUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.edit", "facilities.manage")),
):
    """
    Update a facility emergency contact

    **Authentication required**
    **Permissions required:** facilities.edit or facilities.manage
    """
    service = FacilitiesService(db)

    try:
        contact = await service.update_emergency_contact(
            contact_id=contact_id,
            contact_data=contact_data,
            organization_id=current_user.organization_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e))

    if not contact:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Emergency contact not found"
        )

    return contact


@router.delete("/emergency-contacts/{contact_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Facility Emergency"])
async def delete_facility_emergency_contact(
    contact_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.manage")),
):
    """
    Delete a facility emergency contact

    **Authentication required**
    **Permissions required:** facilities.manage
    """
    service = FacilitiesService(db)

    deleted = await service.delete_emergency_contact(
        contact_id=contact_id,
        organization_id=current_user.organization_id,
    )

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Emergency contact not found"
        )


# ============================================================================
# Shutoff Location Endpoints
# ============================================================================

@router.get("/shutoff-locations", response_model=List[FacilityShutoffLocationResponse], tags=["Facility Emergency"])
async def list_facility_shutoff_locations(
    facility_id: Optional[str] = Query(None, description="Filter by facility"),
    shutoff_type: Optional[ShutoffTypeEnum] = Query(None, description="Filter by shutoff type"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(100, ge=1, le=500, description="Maximum records to return"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.view", "facilities.manage")),
):
    """
    List facility shutoff locations

    **Authentication required**
    **Permissions required:** facilities.view or facilities.manage
    """
    service = FacilitiesService(db)
    locations = await service.list_shutoff_locations(
        organization_id=current_user.organization_id,
        facility_id=facility_id,
        shutoff_type=shutoff_type,
        skip=skip,
        limit=limit,
    )
    return locations


@router.post("/shutoff-locations", response_model=FacilityShutoffLocationResponse, status_code=status.HTTP_201_CREATED, tags=["Facility Emergency"])
async def create_facility_shutoff_location(
    location_data: FacilityShutoffLocationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.create", "facilities.edit", "facilities.manage")),
):
    """
    Create a facility shutoff location

    **Authentication required**
    **Permissions required:** facilities.create, facilities.edit, or facilities.manage
    """
    service = FacilitiesService(db)

    try:
        location = await service.create_shutoff_location(
            location_data=location_data,
            organization_id=current_user.organization_id,
            created_by=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e))

    return location


@router.get("/shutoff-locations/{location_id}", response_model=FacilityShutoffLocationResponse, tags=["Facility Emergency"])
async def get_facility_shutoff_location(
    location_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.view", "facilities.manage")),
):
    """
    Get a specific facility shutoff location

    **Authentication required**
    **Permissions required:** facilities.view or facilities.manage
    """
    service = FacilitiesService(db)
    location = await service.get_shutoff_location(
        location_id=location_id,
        organization_id=current_user.organization_id,
    )

    if not location:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Shutoff location not found"
        )

    return location


@router.patch("/shutoff-locations/{location_id}", response_model=FacilityShutoffLocationResponse, tags=["Facility Emergency"])
async def update_facility_shutoff_location(
    location_id: str,
    location_data: FacilityShutoffLocationUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.edit", "facilities.manage")),
):
    """
    Update a facility shutoff location

    **Authentication required**
    **Permissions required:** facilities.edit or facilities.manage
    """
    service = FacilitiesService(db)

    try:
        location = await service.update_shutoff_location(
            location_id=location_id,
            location_data=location_data,
            organization_id=current_user.organization_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e))

    if not location:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Shutoff location not found"
        )

    return location


@router.delete("/shutoff-locations/{location_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Facility Emergency"])
async def delete_facility_shutoff_location(
    location_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.manage")),
):
    """
    Delete a facility shutoff location

    **Authentication required**
    **Permissions required:** facilities.manage
    """
    service = FacilitiesService(db)

    deleted = await service.delete_shutoff_location(
        location_id=location_id,
        organization_id=current_user.organization_id,
    )

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Shutoff location not found"
        )


# ============================================================================
# Capital Project Endpoints
# ============================================================================

@router.get("/capital-projects", response_model=List[FacilityCapitalProjectResponse], tags=["Facility Capital Projects"])
async def list_facility_capital_projects(
    facility_id: Optional[str] = Query(None, description="Filter by facility"),
    project_type: Optional[CapitalProjectTypeEnum] = Query(None, description="Filter by project type"),
    project_status: Optional[CapitalProjectStatusEnum] = Query(None, description="Filter by project status"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(100, ge=1, le=500, description="Maximum records to return"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.view", "facilities.manage")),
):
    """
    List facility capital projects

    **Authentication required**
    **Permissions required:** facilities.view or facilities.manage
    """
    service = FacilitiesService(db)
    projects = await service.list_capital_projects(
        organization_id=current_user.organization_id,
        facility_id=facility_id,
        project_type=project_type,
        project_status=project_status,
        skip=skip,
        limit=limit,
    )
    return projects


@router.post("/capital-projects", response_model=FacilityCapitalProjectResponse, status_code=status.HTTP_201_CREATED, tags=["Facility Capital Projects"])
async def create_facility_capital_project(
    project_data: FacilityCapitalProjectCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.create", "facilities.edit", "facilities.manage")),
):
    """
    Create a facility capital project

    **Authentication required**
    **Permissions required:** facilities.create, facilities.edit, or facilities.manage
    """
    service = FacilitiesService(db)

    try:
        project = await service.create_capital_project(
            project_data=project_data,
            organization_id=current_user.organization_id,
            created_by=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e))

    return project


@router.get("/capital-projects/{project_id}", response_model=FacilityCapitalProjectResponse, tags=["Facility Capital Projects"])
async def get_facility_capital_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.view", "facilities.manage")),
):
    """
    Get a specific facility capital project

    **Authentication required**
    **Permissions required:** facilities.view or facilities.manage
    """
    service = FacilitiesService(db)
    project = await service.get_capital_project(
        project_id=project_id,
        organization_id=current_user.organization_id,
    )

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Capital project not found"
        )

    return project


@router.patch("/capital-projects/{project_id}", response_model=FacilityCapitalProjectResponse, tags=["Facility Capital Projects"])
async def update_facility_capital_project(
    project_id: str,
    project_data: FacilityCapitalProjectUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.edit", "facilities.manage")),
):
    """
    Update a facility capital project

    **Authentication required**
    **Permissions required:** facilities.edit or facilities.manage
    """
    service = FacilitiesService(db)

    try:
        project = await service.update_capital_project(
            project_id=project_id,
            project_data=project_data,
            organization_id=current_user.organization_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e))

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Capital project not found"
        )

    return project


@router.delete("/capital-projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Facility Capital Projects"])
async def delete_facility_capital_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.manage")),
):
    """
    Delete a facility capital project

    **Authentication required**
    **Permissions required:** facilities.manage
    """
    service = FacilitiesService(db)

    deleted = await service.delete_capital_project(
        project_id=project_id,
        organization_id=current_user.organization_id,
    )

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Capital project not found"
        )


# ============================================================================
# Insurance Policy Endpoints
# ============================================================================

@router.get("/insurance-policies", response_model=List[FacilityInsurancePolicyResponse], tags=["Facility Insurance"])
async def list_facility_insurance_policies(
    facility_id: Optional[str] = Query(None, description="Filter by facility"),
    policy_type: Optional[InsurancePolicyTypeEnum] = Query(None, description="Filter by policy type"),
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(100, ge=1, le=500, description="Maximum records to return"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.view", "facilities.manage")),
):
    """
    List facility insurance policies

    **Authentication required**
    **Permissions required:** facilities.view or facilities.manage
    """
    service = FacilitiesService(db)
    policies = await service.list_insurance_policies(
        organization_id=current_user.organization_id,
        facility_id=facility_id,
        policy_type=policy_type,
        is_active=is_active,
        skip=skip,
        limit=limit,
    )
    return policies


@router.post("/insurance-policies", response_model=FacilityInsurancePolicyResponse, status_code=status.HTTP_201_CREATED, tags=["Facility Insurance"])
async def create_facility_insurance_policy(
    policy_data: FacilityInsurancePolicyCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.create", "facilities.edit", "facilities.manage")),
):
    """
    Create a facility insurance policy

    **Authentication required**
    **Permissions required:** facilities.create, facilities.edit, or facilities.manage
    """
    service = FacilitiesService(db)

    try:
        policy = await service.create_insurance_policy(
            policy_data=policy_data,
            organization_id=current_user.organization_id,
            created_by=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e))

    return policy


@router.get("/insurance-policies/{policy_id}", response_model=FacilityInsurancePolicyResponse, tags=["Facility Insurance"])
async def get_facility_insurance_policy(
    policy_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.view", "facilities.manage")),
):
    """
    Get a specific facility insurance policy

    **Authentication required**
    **Permissions required:** facilities.view or facilities.manage
    """
    service = FacilitiesService(db)
    policy = await service.get_insurance_policy(
        policy_id=policy_id,
        organization_id=current_user.organization_id,
    )

    if not policy:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Insurance policy not found"
        )

    return policy


@router.patch("/insurance-policies/{policy_id}", response_model=FacilityInsurancePolicyResponse, tags=["Facility Insurance"])
async def update_facility_insurance_policy(
    policy_id: str,
    policy_data: FacilityInsurancePolicyUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.edit", "facilities.manage")),
):
    """
    Update a facility insurance policy

    **Authentication required**
    **Permissions required:** facilities.edit or facilities.manage
    """
    service = FacilitiesService(db)

    try:
        policy = await service.update_insurance_policy(
            policy_id=policy_id,
            policy_data=policy_data,
            organization_id=current_user.organization_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e))

    if not policy:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Insurance policy not found"
        )

    return policy


@router.delete("/insurance-policies/{policy_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Facility Insurance"])
async def delete_facility_insurance_policy(
    policy_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.manage")),
):
    """
    Delete a facility insurance policy

    **Authentication required**
    **Permissions required:** facilities.manage
    """
    service = FacilitiesService(db)

    deleted = await service.delete_insurance_policy(
        policy_id=policy_id,
        organization_id=current_user.organization_id,
    )

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Insurance policy not found"
        )


# ============================================================================
# Occupant Endpoints
# ============================================================================

@router.get("/occupants", response_model=List[FacilityOccupantResponse], tags=["Facility Occupants"])
async def list_facility_occupants(
    facility_id: Optional[str] = Query(None, description="Filter by facility"),
    is_active: Optional[bool] = Query(None, description="Filter by active status"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(100, ge=1, le=500, description="Maximum records to return"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.view", "facilities.manage")),
):
    """
    List facility occupants

    **Authentication required**
    **Permissions required:** facilities.view or facilities.manage
    """
    service = FacilitiesService(db)
    occupants = await service.list_occupants(
        organization_id=current_user.organization_id,
        facility_id=facility_id,
        is_active=is_active,
        skip=skip,
        limit=limit,
    )
    return occupants


@router.post("/occupants", response_model=FacilityOccupantResponse, status_code=status.HTTP_201_CREATED, tags=["Facility Occupants"])
async def create_facility_occupant(
    occupant_data: FacilityOccupantCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.create", "facilities.edit", "facilities.manage")),
):
    """
    Create a facility occupant

    **Authentication required**
    **Permissions required:** facilities.create, facilities.edit, or facilities.manage
    """
    service = FacilitiesService(db)

    try:
        occupant = await service.create_occupant(
            occupant_data=occupant_data,
            organization_id=current_user.organization_id,
            created_by=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e))

    return occupant


@router.get("/occupants/{occupant_id}", response_model=FacilityOccupantResponse, tags=["Facility Occupants"])
async def get_facility_occupant(
    occupant_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.view", "facilities.manage")),
):
    """
    Get a specific facility occupant

    **Authentication required**
    **Permissions required:** facilities.view or facilities.manage
    """
    service = FacilitiesService(db)
    occupant = await service.get_occupant(
        occupant_id=occupant_id,
        organization_id=current_user.organization_id,
    )

    if not occupant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Occupant not found"
        )

    return occupant


@router.patch("/occupants/{occupant_id}", response_model=FacilityOccupantResponse, tags=["Facility Occupants"])
async def update_facility_occupant(
    occupant_id: str,
    occupant_data: FacilityOccupantUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.edit", "facilities.manage")),
):
    """
    Update a facility occupant

    **Authentication required**
    **Permissions required:** facilities.edit or facilities.manage
    """
    service = FacilitiesService(db)

    try:
        occupant = await service.update_occupant(
            occupant_id=occupant_id,
            occupant_data=occupant_data,
            organization_id=current_user.organization_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e))

    if not occupant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Occupant not found"
        )

    return occupant


@router.delete("/occupants/{occupant_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Facility Occupants"])
async def delete_facility_occupant(
    occupant_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.manage")),
):
    """
    Delete a facility occupant

    **Authentication required**
    **Permissions required:** facilities.manage
    """
    service = FacilitiesService(db)

    deleted = await service.delete_occupant(
        occupant_id=occupant_id,
        organization_id=current_user.organization_id,
    )

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Occupant not found"
        )


# ============================================================================
# Compliance Checklist Endpoints
# ============================================================================

@router.get("/compliance-checklists", response_model=List[FacilityComplianceChecklistResponse], tags=["Facility Compliance"])
async def list_facility_compliance_checklists(
    facility_id: Optional[str] = Query(None, description="Filter by facility"),
    compliance_type: Optional[ComplianceTypeEnum] = Query(None, description="Filter by compliance type"),
    is_completed: Optional[bool] = Query(None, description="Filter by completion status"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(100, ge=1, le=500, description="Maximum records to return"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.view", "facilities.manage")),
):
    """
    List facility compliance checklists

    **Authentication required**
    **Permissions required:** facilities.view or facilities.manage
    """
    service = FacilitiesService(db)
    checklists = await service.list_compliance_checklists(
        organization_id=current_user.organization_id,
        facility_id=facility_id,
        compliance_type=compliance_type,
        is_completed=is_completed,
        skip=skip,
        limit=limit,
    )
    return checklists


@router.post("/compliance-checklists", response_model=FacilityComplianceChecklistResponse, status_code=status.HTTP_201_CREATED, tags=["Facility Compliance"])
async def create_facility_compliance_checklist(
    checklist_data: FacilityComplianceChecklistCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.create", "facilities.edit", "facilities.manage")),
):
    """
    Create a facility compliance checklist

    **Authentication required**
    **Permissions required:** facilities.create, facilities.edit, or facilities.manage
    """
    service = FacilitiesService(db)

    try:
        checklist = await service.create_compliance_checklist(
            checklist_data=checklist_data,
            organization_id=current_user.organization_id,
            created_by=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e))

    return checklist


@router.get("/compliance-checklists/{checklist_id}", response_model=FacilityComplianceChecklistResponse, tags=["Facility Compliance"])
async def get_facility_compliance_checklist(
    checklist_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.view", "facilities.manage")),
):
    """
    Get a specific facility compliance checklist

    **Authentication required**
    **Permissions required:** facilities.view or facilities.manage
    """
    service = FacilitiesService(db)
    checklist = await service.get_compliance_checklist(
        checklist_id=checklist_id,
        organization_id=current_user.organization_id,
    )

    if not checklist:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Compliance checklist not found"
        )

    return checklist


@router.patch("/compliance-checklists/{checklist_id}", response_model=FacilityComplianceChecklistResponse, tags=["Facility Compliance"])
async def update_facility_compliance_checklist(
    checklist_id: str,
    checklist_data: FacilityComplianceChecklistUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.edit", "facilities.manage")),
):
    """
    Update a facility compliance checklist

    **Authentication required**
    **Permissions required:** facilities.edit or facilities.manage
    """
    service = FacilitiesService(db)

    try:
        checklist = await service.update_compliance_checklist(
            checklist_id=checklist_id,
            checklist_data=checklist_data,
            organization_id=current_user.organization_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e))

    if not checklist:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Compliance checklist not found"
        )

    return checklist


@router.delete("/compliance-checklists/{checklist_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Facility Compliance"])
async def delete_facility_compliance_checklist(
    checklist_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.manage")),
):
    """
    Delete a facility compliance checklist

    **Authentication required**
    **Permissions required:** facilities.manage
    """
    service = FacilitiesService(db)

    deleted = await service.delete_compliance_checklist(
        checklist_id=checklist_id,
        organization_id=current_user.organization_id,
    )

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Compliance checklist not found"
        )


# ============================================================================
# Compliance Item Endpoints
# ============================================================================

@router.get("/compliance-checklists/{checklist_id}/items", response_model=List[FacilityComplianceItemResponse], tags=["Facility Compliance"])
async def list_facility_compliance_items(
    checklist_id: str,
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(100, ge=1, le=500, description="Maximum records to return"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.view", "facilities.manage")),
):
    """
    List compliance items for a specific checklist

    **Authentication required**
    **Permissions required:** facilities.view or facilities.manage
    """
    service = FacilitiesService(db)
    items = await service.list_compliance_items(
        checklist_id=checklist_id,
        organization_id=current_user.organization_id,
        skip=skip,
        limit=limit,
    )
    return items


@router.post("/compliance-checklists/{checklist_id}/items", response_model=FacilityComplianceItemResponse, status_code=status.HTTP_201_CREATED, tags=["Facility Compliance"])
async def create_facility_compliance_item(
    checklist_id: str,
    item_data: FacilityComplianceItemCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.create", "facilities.edit", "facilities.manage")),
):
    """
    Create a compliance item for a checklist

    **Authentication required**
    **Permissions required:** facilities.create, facilities.edit, or facilities.manage
    """
    service = FacilitiesService(db)

    try:
        item = await service.create_compliance_item(
            checklist_id=checklist_id,
            item_data=item_data,
            organization_id=current_user.organization_id,
            created_by=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e))

    return item


@router.patch("/compliance-items/{item_id}", response_model=FacilityComplianceItemResponse, tags=["Facility Compliance"])
async def update_facility_compliance_item(
    item_id: str,
    item_data: FacilityComplianceItemUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.edit", "facilities.manage")),
):
    """
    Update a compliance item

    **Authentication required**
    **Permissions required:** facilities.edit or facilities.manage
    """
    service = FacilitiesService(db)

    try:
        item = await service.update_compliance_item(
            item_id=item_id,
            item_data=item_data,
            organization_id=current_user.organization_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=safe_error_detail(e))

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Compliance item not found"
        )

    return item


@router.delete("/compliance-items/{item_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["Facility Compliance"])
async def delete_facility_compliance_item(
    item_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.manage")),
):
    """
    Delete a compliance item

    **Authentication required**
    **Permissions required:** facilities.manage
    """
    service = FacilitiesService(db)

    deleted = await service.delete_compliance_item(
        item_id=item_id,
        organization_id=current_user.organization_id,
    )

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Compliance item not found"
        )


# ============================================================================
# Facility Folder Endpoints (Document Management Integration)
# ============================================================================

@router.get("/{facility_id}/folders", response_model=FoldersListResponse, tags=["Facility Folders"])
async def get_facility_folders(
    facility_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("facilities.view", "facilities.manage")),
):
    """
    Get the hierarchical folder structure for a facility.

    Auto-creates the folder tree on first access:
      Facility Files/
        └── <facility_name>/
            ├── Photos/
            ├── Blueprints & Permits/
            ├── Maintenance Records/
            ├── Inspection Reports/
            ├── Insurance & Leases/
            └── Capital Projects/

    **Permissions required:** facilities.view or facilities.manage
    """
    facilities_service = FacilitiesService(db)
    facility = await facilities_service.get_facility(
        facility_id=facility_id,
        organization_id=current_user.organization_id,
        include_relations=False,
    )
    if not facility:
        raise HTTPException(status_code=404, detail="Facility not found")

    docs_service = DocumentsService(db)
    await docs_service.ensure_facility_folder(
        organization_id=current_user.organization_id,
        facility_id=facility_id,
        facility_display_name=facility.display_name,
    )
    await db.commit()

    sub_folders = await docs_service.get_facility_sub_folders(
        organization_id=current_user.organization_id,
        facility_id=facility_id,
    )

    return {
        "folders": [
            {
                **{c.key: getattr(f, c.key) for c in f.__table__.columns},
                "document_count": getattr(f, "document_count", 0),
            }
            for f in sub_folders
        ],
        "total": len(sub_folders),
    }
