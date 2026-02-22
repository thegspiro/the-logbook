"""
Facilities Service

Business logic for facility/building management.
"""

from typing import List, Optional, Tuple
from datetime import date, datetime, timedelta, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func, desc
from sqlalchemy.orm import selectinload

from app.models.facilities import (
    Facility,
    FacilityType,
    FacilityStatus,
    FacilityPhoto,
    FacilityDocument,
    FacilityMaintenanceType,
    FacilityMaintenance,
    FacilitySystem,
    FacilityInspection,
    FacilityUtilityAccount,
    FacilityUtilityReading,
    FacilityAccessKey,
    FacilityRoom,
    FacilityEmergencyContact,
    FacilityShutoffLocation,
    FacilityCapitalProject,
    FacilityInsurancePolicy,
    FacilityOccupant,
    FacilityComplianceChecklist,
    FacilityComplianceItem,
)
from app.schemas.facilities import (
    FacilityCreate,
    FacilityUpdate,
    FacilityTypeCreate,
    FacilityTypeUpdate,
    FacilityStatusCreate,
    FacilityStatusUpdate,
    FacilityPhotoCreate,
    FacilityPhotoUpdate,
    FacilityDocumentCreate,
    FacilityDocumentUpdate,
    FacilityMaintenanceTypeCreate,
    FacilityMaintenanceTypeUpdate,
    FacilityMaintenanceCreate,
    FacilityMaintenanceUpdate,
    FacilitySystemCreate,
    FacilitySystemUpdate,
    FacilityInspectionCreate,
    FacilityInspectionUpdate,
    FacilityUtilityAccountCreate,
    FacilityUtilityAccountUpdate,
    FacilityUtilityReadingCreate,
    FacilityUtilityReadingUpdate,
    FacilityAccessKeyCreate,
    FacilityAccessKeyUpdate,
    FacilityRoomCreate,
    FacilityRoomUpdate,
    FacilityEmergencyContactCreate,
    FacilityEmergencyContactUpdate,
    FacilityShutoffLocationCreate,
    FacilityShutoffLocationUpdate,
    FacilityCapitalProjectCreate,
    FacilityCapitalProjectUpdate,
    FacilityInsurancePolicyCreate,
    FacilityInsurancePolicyUpdate,
    FacilityOccupantCreate,
    FacilityOccupantUpdate,
    FacilityComplianceChecklistCreate,
    FacilityComplianceChecklistUpdate,
    FacilityComplianceItemCreate,
    FacilityComplianceItemUpdate,
)


class FacilitiesService:
    """Service for facility management"""

    def __init__(self, db: AsyncSession):
        self.db = db

    # =========================================================================
    # Facility Type Methods
    # =========================================================================

    async def list_facility_types(
        self,
        organization_id: str,
        is_active: Optional[bool] = None,
        include_system: bool = True,
    ) -> List[FacilityType]:
        """List all facility types for an organization"""
        conditions = []

        if include_system:
            conditions.append(
                or_(
                    FacilityType.organization_id == organization_id,
                    FacilityType.organization_id.is_(None),
                )
            )
        else:
            conditions.append(FacilityType.organization_id == str(organization_id))

        if is_active is not None:
            conditions.append(FacilityType.is_active == is_active)

        query = (
            select(FacilityType)
            .where(and_(*conditions))
            .order_by(FacilityType.name)
        )

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_facility_type(
        self, type_id: str, organization_id: str
    ) -> Optional[FacilityType]:
        """Get facility type by ID"""
        result = await self.db.execute(
            select(FacilityType)
            .where(FacilityType.id == type_id)
            .where(
                or_(
                    FacilityType.organization_id == organization_id,
                    FacilityType.organization_id.is_(None),
                )
            )
        )
        return result.scalar_one_or_none()

    async def create_facility_type(
        self,
        type_data: FacilityTypeCreate,
        organization_id: str,
    ) -> FacilityType:
        """Create a new facility type"""
        # Check if name already exists for this org
        result = await self.db.execute(
            select(FacilityType)
            .where(
                or_(
                    FacilityType.organization_id == organization_id,
                    FacilityType.organization_id.is_(None),
                )
            )
            .where(FacilityType.name == type_data.name)
        )
        existing = result.scalar_one_or_none()
        if existing:
            raise ValueError(f"Facility type with name '{type_data.name}' already exists")

        facility_type = FacilityType(
            organization_id=organization_id,
            is_system=False,
            **type_data.model_dump(),
        )

        self.db.add(facility_type)
        await self.db.commit()
        await self.db.refresh(facility_type)

        return facility_type

    async def update_facility_type(
        self,
        type_id: str,
        type_data: FacilityTypeUpdate,
        organization_id: str,
    ) -> Optional[FacilityType]:
        """Update facility type"""
        facility_type = await self.get_facility_type(type_id, organization_id)
        if not facility_type:
            return None

        # Cannot modify system types
        if facility_type.is_system:
            raise ValueError("Cannot modify system facility types")

        # Check name uniqueness if changing
        if type_data.name and type_data.name != facility_type.name:
            result = await self.db.execute(
                select(FacilityType)
                .where(
                    or_(
                        FacilityType.organization_id == organization_id,
                        FacilityType.organization_id.is_(None),
                    )
                )
                .where(FacilityType.name == type_data.name)
                .where(FacilityType.id != type_id)
            )
            if result.scalar_one_or_none():
                raise ValueError(f"Facility type with name '{type_data.name}' already exists")

        update_data = type_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(facility_type, field, value)

        await self.db.commit()
        await self.db.refresh(facility_type)

        return facility_type

    async def delete_facility_type(
        self, type_id: str, organization_id: str
    ) -> bool:
        """Delete facility type"""
        facility_type = await self.get_facility_type(type_id, organization_id)
        if not facility_type:
            return False

        if facility_type.is_system:
            raise ValueError("Cannot delete system facility types")

        # Check if any facilities in this organization use this type
        result = await self.db.execute(
            select(func.count(Facility.id))
            .where(Facility.facility_type_id == type_id)
            .where(Facility.organization_id == str(organization_id))
        )
        count = result.scalar()
        if count > 0:
            raise ValueError(f"Cannot delete type. {count} facilities use this type.")

        await self.db.delete(facility_type)
        await self.db.commit()

        return True

    # =========================================================================
    # Facility Status Methods
    # =========================================================================

    async def list_facility_statuses(
        self,
        organization_id: str,
        is_active: Optional[bool] = None,
        include_system: bool = True,
    ) -> List[FacilityStatus]:
        """List all facility statuses for an organization"""
        conditions = []

        if include_system:
            conditions.append(
                or_(
                    FacilityStatus.organization_id == organization_id,
                    FacilityStatus.organization_id.is_(None),
                )
            )
        else:
            conditions.append(FacilityStatus.organization_id == str(organization_id))

        if is_active is not None:
            conditions.append(FacilityStatus.is_active == is_active)

        query = (
            select(FacilityStatus)
            .where(and_(*conditions))
            .order_by(FacilityStatus.name)
        )

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_facility_status(
        self, status_id: str, organization_id: str
    ) -> Optional[FacilityStatus]:
        """Get facility status by ID"""
        result = await self.db.execute(
            select(FacilityStatus)
            .where(FacilityStatus.id == status_id)
            .where(
                or_(
                    FacilityStatus.organization_id == organization_id,
                    FacilityStatus.organization_id.is_(None),
                )
            )
        )
        return result.scalar_one_or_none()

    async def create_facility_status(
        self,
        status_data: FacilityStatusCreate,
        organization_id: str,
    ) -> FacilityStatus:
        """Create a new facility status"""
        result = await self.db.execute(
            select(FacilityStatus)
            .where(
                or_(
                    FacilityStatus.organization_id == organization_id,
                    FacilityStatus.organization_id.is_(None),
                )
            )
            .where(FacilityStatus.name == status_data.name)
        )
        existing = result.scalar_one_or_none()
        if existing:
            raise ValueError(f"Facility status with name '{status_data.name}' already exists")

        facility_status = FacilityStatus(
            organization_id=organization_id,
            is_system=False,
            **status_data.model_dump(),
        )

        self.db.add(facility_status)
        await self.db.commit()
        await self.db.refresh(facility_status)

        return facility_status

    async def update_facility_status(
        self,
        status_id: str,
        status_data: FacilityStatusUpdate,
        organization_id: str,
    ) -> Optional[FacilityStatus]:
        """Update facility status"""
        facility_status = await self.get_facility_status(status_id, organization_id)
        if not facility_status:
            return None

        if facility_status.is_system:
            raise ValueError("Cannot modify system facility statuses")

        if status_data.name and status_data.name != facility_status.name:
            result = await self.db.execute(
                select(FacilityStatus)
                .where(
                    or_(
                        FacilityStatus.organization_id == organization_id,
                        FacilityStatus.organization_id.is_(None),
                    )
                )
                .where(FacilityStatus.name == status_data.name)
                .where(FacilityStatus.id != status_id)
            )
            if result.scalar_one_or_none():
                raise ValueError(f"Facility status with name '{status_data.name}' already exists")

        update_data = status_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(facility_status, field, value)

        await self.db.commit()
        await self.db.refresh(facility_status)

        return facility_status

    async def delete_facility_status(
        self, status_id: str, organization_id: str
    ) -> bool:
        """Delete facility status"""
        facility_status = await self.get_facility_status(status_id, organization_id)
        if not facility_status:
            return False

        if facility_status.is_system:
            raise ValueError("Cannot delete system facility statuses")

        # Check if any facilities in this organization use this status
        result = await self.db.execute(
            select(func.count(Facility.id))
            .where(Facility.status_id == status_id)
            .where(Facility.organization_id == str(organization_id))
        )
        count = result.scalar()
        if count > 0:
            raise ValueError(f"Cannot delete status. {count} facilities use this status.")

        await self.db.delete(facility_status)
        await self.db.commit()

        return True

    # =========================================================================
    # Main Facility Methods
    # =========================================================================

    async def list_facilities(
        self,
        organization_id: str,
        facility_type_id: Optional[str] = None,
        status_id: Optional[str] = None,
        is_archived: Optional[bool] = None,
        search: Optional[str] = None,
        skip: int = 0,
        limit: int = 100,
        include_relations: bool = True,
    ) -> Tuple[List[Facility], int]:
        """List facilities with filtering and pagination"""
        conditions = [Facility.organization_id == organization_id]

        if facility_type_id:
            conditions.append(Facility.facility_type_id == facility_type_id)
        if status_id:
            conditions.append(Facility.status_id == status_id)
        if is_archived is not None:
            conditions.append(Facility.is_archived == is_archived)
        if search:
            safe_search = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            search_term = f"%{safe_search}%"
            conditions.append(
                or_(
                    Facility.name.ilike(search_term),
                    Facility.facility_number.ilike(search_term),
                    Facility.city.ilike(search_term),
                )
            )

        # Count query
        count_query = select(func.count(Facility.id)).where(and_(*conditions))
        count_result = await self.db.execute(count_query)
        total = count_result.scalar()

        # Main query
        query = (
            select(Facility)
            .where(and_(*conditions))
            .order_by(Facility.name)
            .offset(skip)
            .limit(limit)
        )

        if include_relations:
            query = query.options(
                selectinload(Facility.facility_type),
                selectinload(Facility.status_record),
            )

        result = await self.db.execute(query)
        items = list(result.scalars().all())

        return items, total

    async def get_facility(
        self,
        facility_id: str,
        organization_id: str,
        include_relations: bool = True,
    ) -> Optional[Facility]:
        """Get facility by ID"""
        query = (
            select(Facility)
            .where(Facility.id == str(facility_id))
            .where(Facility.organization_id == str(organization_id))
        )

        if include_relations:
            query = query.options(
                selectinload(Facility.facility_type),
                selectinload(Facility.status_record),
            )

        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def create_facility(
        self,
        facility_data: FacilityCreate,
        organization_id: str,
        created_by: str,
    ) -> Facility:
        """Create a new facility"""
        # Check facility_number uniqueness if provided
        if facility_data.facility_number:
            result = await self.db.execute(
                select(Facility)
                .where(Facility.organization_id == str(organization_id))
                .where(Facility.facility_number == facility_data.facility_number)
            )
            if result.scalar_one_or_none():
                raise ValueError(
                    f"Facility with number '{facility_data.facility_number}' already exists"
                )

        # Verify type exists
        facility_type = await self.get_facility_type(
            facility_data.facility_type_id, organization_id
        )
        if not facility_type:
            raise ValueError("Invalid facility type")

        # Verify status exists
        status = await self.get_facility_status(
            facility_data.status_id, organization_id
        )
        if not status:
            raise ValueError("Invalid facility status")

        facility = Facility(
            organization_id=organization_id,
            created_by=created_by,
            status_changed_at=datetime.now(tz=timezone.utc),
            status_changed_by=created_by,
            **facility_data.model_dump(),
        )

        self.db.add(facility)
        await self.db.commit()
        await self.db.refresh(facility)

        return facility

    async def update_facility(
        self,
        facility_id: str,
        facility_data: FacilityUpdate,
        organization_id: str,
        updated_by: str,
    ) -> Optional[Facility]:
        """Update facility"""
        facility = await self.get_facility(
            facility_id, organization_id, include_relations=False
        )
        if not facility:
            return None

        # Check facility_number uniqueness if changing
        if (
            facility_data.facility_number
            and facility_data.facility_number != facility.facility_number
        ):
            result = await self.db.execute(
                select(Facility)
                .where(Facility.organization_id == str(organization_id))
                .where(Facility.facility_number == facility_data.facility_number)
                .where(Facility.id != facility_id)
            )
            if result.scalar_one_or_none():
                raise ValueError(
                    f"Facility with number '{facility_data.facility_number}' already exists"
                )

        # Track status change
        if facility_data.status_id and facility_data.status_id != facility.status_id:
            facility.status_changed_at = datetime.now(tz=timezone.utc)
            facility.status_changed_by = updated_by

        update_data = facility_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(facility, field, value)

        await self.db.commit()
        await self.db.refresh(facility)

        return facility

    async def archive_facility(
        self,
        facility_id: str,
        organization_id: str,
        archived_by: str,
    ) -> Optional[Facility]:
        """Archive a facility (soft-delete)"""
        facility = await self.get_facility(
            facility_id, organization_id, include_relations=False
        )
        if not facility:
            return None

        if facility.is_archived:
            raise ValueError("Facility is already archived")

        facility.is_archived = True
        facility.archived_at = datetime.now(tz=timezone.utc)
        facility.archived_by = archived_by

        await self.db.commit()
        await self.db.refresh(facility)

        return facility

    async def restore_facility(
        self,
        facility_id: str,
        organization_id: str,
    ) -> Optional[Facility]:
        """Restore an archived facility"""
        facility = await self.get_facility(
            facility_id, organization_id, include_relations=False
        )
        if not facility:
            return None

        if not facility.is_archived:
            raise ValueError("Facility is not archived")

        facility.is_archived = False
        facility.archived_at = None
        facility.archived_by = None

        await self.db.commit()
        await self.db.refresh(facility)

        return facility

    # =========================================================================
    # Photo Methods
    # =========================================================================

    async def list_photos(
        self,
        organization_id: str,
        facility_id: Optional[str] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> List[FacilityPhoto]:
        """List photos for a facility"""
        conditions = [FacilityPhoto.organization_id == str(organization_id)]

        if facility_id:
            conditions.append(FacilityPhoto.facility_id == str(facility_id))

        query = (
            select(FacilityPhoto)
            .where(and_(*conditions))
            .order_by(desc(FacilityPhoto.is_primary), desc(FacilityPhoto.uploaded_at))
            .offset(skip)
            .limit(limit)
        )

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def create_photo(
        self,
        photo_data: FacilityPhotoCreate,
        organization_id: str,
        uploaded_by: str,
    ) -> FacilityPhoto:
        """Create a facility photo"""
        # If setting as primary, unset other primary photos for this facility
        if photo_data.is_primary:
            result = await self.db.execute(
                select(FacilityPhoto)
                .where(FacilityPhoto.facility_id == photo_data.facility_id)
                .where(FacilityPhoto.organization_id == str(organization_id))
                .where(FacilityPhoto.is_primary == True)
            )
            for photo in result.scalars().all():
                photo.is_primary = False

        photo = FacilityPhoto(
            organization_id=organization_id,
            uploaded_by=uploaded_by,
            **photo_data.model_dump(),
        )

        self.db.add(photo)
        await self.db.commit()
        await self.db.refresh(photo)

        return photo

    async def update_photo(
        self,
        photo_id: str,
        photo_data: FacilityPhotoUpdate,
        organization_id: str,
    ) -> Optional[FacilityPhoto]:
        """Update a facility photo"""
        result = await self.db.execute(
            select(FacilityPhoto)
            .where(FacilityPhoto.id == photo_id)
            .where(FacilityPhoto.organization_id == str(organization_id))
        )
        photo = result.scalar_one_or_none()
        if not photo:
            return None

        update_data = photo_data.model_dump(exclude_unset=True)

        # If setting as primary, unset other primary photos for this facility
        if update_data.get("is_primary"):
            existing = await self.db.execute(
                select(FacilityPhoto)
                .where(FacilityPhoto.facility_id == photo.facility_id)
                .where(FacilityPhoto.organization_id == str(organization_id))
                .where(FacilityPhoto.is_primary == True)
                .where(FacilityPhoto.id != photo_id)
            )
            for other_photo in existing.scalars().all():
                other_photo.is_primary = False

        for field, value in update_data.items():
            setattr(photo, field, value)

        await self.db.commit()
        await self.db.refresh(photo)

        return photo

    async def delete_photo(
        self, photo_id: str, organization_id: str
    ) -> bool:
        """Delete a facility photo"""
        result = await self.db.execute(
            select(FacilityPhoto)
            .where(FacilityPhoto.id == photo_id)
            .where(FacilityPhoto.organization_id == str(organization_id))
        )
        photo = result.scalar_one_or_none()
        if not photo:
            return False

        await self.db.delete(photo)
        await self.db.commit()

        return True

    # =========================================================================
    # Document Methods
    # =========================================================================

    async def list_documents(
        self,
        organization_id: str,
        facility_id: Optional[str] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> List[FacilityDocument]:
        """List documents for a facility"""
        conditions = [FacilityDocument.organization_id == str(organization_id)]

        if facility_id:
            conditions.append(FacilityDocument.facility_id == str(facility_id))

        query = (
            select(FacilityDocument)
            .where(and_(*conditions))
            .order_by(FacilityDocument.document_type, desc(FacilityDocument.uploaded_at))
            .offset(skip)
            .limit(limit)
        )

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def create_document(
        self,
        document_data: FacilityDocumentCreate,
        organization_id: str,
        uploaded_by: str,
    ) -> FacilityDocument:
        """Create a facility document"""
        document = FacilityDocument(
            organization_id=organization_id,
            uploaded_by=uploaded_by,
            **document_data.model_dump(),
        )

        self.db.add(document)
        await self.db.commit()
        await self.db.refresh(document)

        return document

    async def update_document(
        self,
        document_id: str,
        document_data: FacilityDocumentUpdate,
        organization_id: str,
    ) -> Optional[FacilityDocument]:
        """Update a facility document"""
        result = await self.db.execute(
            select(FacilityDocument)
            .where(FacilityDocument.id == document_id)
            .where(FacilityDocument.organization_id == str(organization_id))
        )
        document = result.scalar_one_or_none()
        if not document:
            return None

        update_data = document_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(document, field, value)

        await self.db.commit()
        await self.db.refresh(document)

        return document

    async def delete_document(
        self, document_id: str, organization_id: str
    ) -> bool:
        """Delete a facility document"""
        result = await self.db.execute(
            select(FacilityDocument)
            .where(FacilityDocument.id == document_id)
            .where(FacilityDocument.organization_id == str(organization_id))
        )
        document = result.scalar_one_or_none()
        if not document:
            return False

        await self.db.delete(document)
        await self.db.commit()

        return True

    # =========================================================================
    # Maintenance Type Methods
    # =========================================================================

    async def list_maintenance_types(
        self,
        organization_id: str,
        is_active: Optional[bool] = True,
        include_system: bool = True,
    ) -> List[FacilityMaintenanceType]:
        """List maintenance types"""
        conditions = []

        if include_system:
            conditions.append(
                or_(
                    FacilityMaintenanceType.organization_id == organization_id,
                    FacilityMaintenanceType.organization_id.is_(None),
                )
            )
        else:
            conditions.append(
                FacilityMaintenanceType.organization_id == organization_id
            )

        if is_active is not None:
            conditions.append(FacilityMaintenanceType.is_active == is_active)

        query = (
            select(FacilityMaintenanceType)
            .where(and_(*conditions))
            .order_by(FacilityMaintenanceType.name)
        )

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_maintenance_type(
        self, type_id: str, organization_id: str
    ) -> Optional[FacilityMaintenanceType]:
        """Get maintenance type by ID"""
        result = await self.db.execute(
            select(FacilityMaintenanceType)
            .where(FacilityMaintenanceType.id == type_id)
            .where(
                or_(
                    FacilityMaintenanceType.organization_id == organization_id,
                    FacilityMaintenanceType.organization_id.is_(None),
                )
            )
        )
        return result.scalar_one_or_none()

    async def create_maintenance_type(
        self,
        type_data: FacilityMaintenanceTypeCreate,
        organization_id: str,
    ) -> FacilityMaintenanceType:
        """Create maintenance type"""
        result = await self.db.execute(
            select(FacilityMaintenanceType)
            .where(
                or_(
                    FacilityMaintenanceType.organization_id == organization_id,
                    FacilityMaintenanceType.organization_id.is_(None),
                )
            )
            .where(FacilityMaintenanceType.name == type_data.name)
        )
        if result.scalar_one_or_none():
            raise ValueError(
                f"Maintenance type with name '{type_data.name}' already exists"
            )

        maintenance_type = FacilityMaintenanceType(
            organization_id=organization_id,
            is_system=False,
            **type_data.model_dump(),
        )

        self.db.add(maintenance_type)
        await self.db.commit()
        await self.db.refresh(maintenance_type)

        return maintenance_type

    async def update_maintenance_type(
        self,
        type_id: str,
        type_data: FacilityMaintenanceTypeUpdate,
        organization_id: str,
    ) -> Optional[FacilityMaintenanceType]:
        """Update maintenance type"""
        maintenance_type = await self.get_maintenance_type(type_id, organization_id)
        if not maintenance_type:
            return None

        if maintenance_type.is_system:
            raise ValueError("Cannot modify system maintenance types")

        if type_data.name and type_data.name != maintenance_type.name:
            result = await self.db.execute(
                select(FacilityMaintenanceType)
                .where(
                    or_(
                        FacilityMaintenanceType.organization_id == organization_id,
                        FacilityMaintenanceType.organization_id.is_(None),
                    )
                )
                .where(FacilityMaintenanceType.name == type_data.name)
                .where(FacilityMaintenanceType.id != type_id)
            )
            if result.scalar_one_or_none():
                raise ValueError(
                    f"Maintenance type with name '{type_data.name}' already exists"
                )

        update_data = type_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(maintenance_type, field, value)

        await self.db.commit()
        await self.db.refresh(maintenance_type)

        return maintenance_type

    async def delete_maintenance_type(
        self, type_id: str, organization_id: str
    ) -> bool:
        """Delete maintenance type"""
        maintenance_type = await self.get_maintenance_type(type_id, organization_id)
        if not maintenance_type:
            return False

        if maintenance_type.is_system:
            raise ValueError("Cannot delete system maintenance types")

        result = await self.db.execute(
            select(func.count(FacilityMaintenance.id))
            .where(FacilityMaintenance.maintenance_type_id == type_id)
            .where(FacilityMaintenance.organization_id == str(organization_id))
        )
        count = result.scalar()
        if count > 0:
            raise ValueError(
                f"Cannot delete type. {count} maintenance records use this type."
            )

        await self.db.delete(maintenance_type)
        await self.db.commit()

        return True

    # =========================================================================
    # Maintenance Record Methods
    # =========================================================================

    async def list_maintenance_records(
        self,
        organization_id: str,
        facility_id: Optional[str] = None,
        maintenance_type_id: Optional[str] = None,
        system_id: Optional[str] = None,
        is_completed: Optional[bool] = None,
        is_overdue: Optional[bool] = None,
        is_historic: Optional[bool] = None,
        occurred_after: Optional[date] = None,
        occurred_before: Optional[date] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> List[FacilityMaintenance]:
        """List maintenance records"""
        conditions = [FacilityMaintenance.organization_id == organization_id]

        if facility_id:
            conditions.append(FacilityMaintenance.facility_id == str(facility_id))
        if maintenance_type_id:
            conditions.append(
                FacilityMaintenance.maintenance_type_id == maintenance_type_id
            )
        if system_id:
            conditions.append(FacilityMaintenance.system_id == system_id)
        if is_completed is not None:
            conditions.append(FacilityMaintenance.is_completed == is_completed)
        if is_overdue is not None:
            conditions.append(FacilityMaintenance.is_overdue == is_overdue)
        if is_historic is not None:
            conditions.append(FacilityMaintenance.is_historic == is_historic)
        if occurred_after:
            conditions.append(FacilityMaintenance.occurred_date >= occurred_after)
        if occurred_before:
            conditions.append(FacilityMaintenance.occurred_date <= occurred_before)

        query = (
            select(FacilityMaintenance)
            .where(and_(*conditions))
            .options(selectinload(FacilityMaintenance.maintenance_type))
            .order_by(desc(FacilityMaintenance.created_at))
            .offset(skip)
            .limit(limit)
        )

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_maintenance_record(
        self, record_id: str, organization_id: str
    ) -> Optional[FacilityMaintenance]:
        """Get maintenance record by ID"""
        result = await self.db.execute(
            select(FacilityMaintenance)
            .where(FacilityMaintenance.id == record_id)
            .where(FacilityMaintenance.organization_id == str(organization_id))
            .options(selectinload(FacilityMaintenance.maintenance_type))
        )
        return result.scalar_one_or_none()

    async def create_maintenance_record(
        self,
        maintenance_data: FacilityMaintenanceCreate,
        organization_id: str,
        created_by: str,
    ) -> FacilityMaintenance:
        """Create maintenance record (current or historic)"""
        # Verify facility
        facility = await self.get_facility(
            maintenance_data.facility_id, organization_id, include_relations=False
        )
        if not facility:
            raise ValueError("Invalid facility")

        # Verify maintenance type
        maint_type = await self.get_maintenance_type(
            maintenance_data.maintenance_type_id, organization_id
        )
        if not maint_type:
            raise ValueError("Invalid maintenance type")

        # Validate historic entries
        if maintenance_data.is_historic and not maintenance_data.occurred_date:
            raise ValueError("occurred_date is required for historic entries")

        dump = maintenance_data.model_dump()
        # Convert attachment models to dicts for JSON storage
        if dump.get("attachments"):
            dump["attachments"] = [
                a if isinstance(a, dict) else a for a in dump["attachments"]
            ]

        maintenance = FacilityMaintenance(
            organization_id=organization_id,
            created_by=created_by,
            **dump,
        )

        # For historic records that are already completed, don't flag as overdue
        if maintenance.is_historic and maintenance.is_completed:
            maintenance.is_overdue = False
        elif (
            maintenance.due_date
            and maintenance.due_date < date.today()
            and not maintenance.is_completed
        ):
            maintenance.is_overdue = True

        self.db.add(maintenance)
        await self.db.commit()
        await self.db.refresh(maintenance)

        return maintenance

    async def update_maintenance_record(
        self,
        record_id: str,
        maintenance_data: FacilityMaintenanceUpdate,
        organization_id: str,
        updated_by: str,
    ) -> Optional[FacilityMaintenance]:
        """Update maintenance record"""
        maintenance = await self.get_maintenance_record(record_id, organization_id)
        if not maintenance:
            return None

        update_data = maintenance_data.model_dump(exclude_unset=True)

        # Convert attachment models to dicts for JSON storage
        if "attachments" in update_data and update_data["attachments"]:
            update_data["attachments"] = [
                a if isinstance(a, dict) else a for a in update_data["attachments"]
            ]

        # Handle completion
        if (
            "is_completed" in update_data
            and update_data["is_completed"]
            and not maintenance.is_completed
        ):
            maintenance.completed_by = updated_by
            if not maintenance.completed_date:
                maintenance.completed_date = date.today()
            maintenance.is_overdue = False

        for field, value in update_data.items():
            setattr(maintenance, field, value)

        # Recheck overdue status
        if (
            maintenance.due_date
            and maintenance.due_date < date.today()
            and not maintenance.is_completed
        ):
            maintenance.is_overdue = True
        else:
            maintenance.is_overdue = False

        await self.db.commit()
        await self.db.refresh(maintenance)

        return maintenance

    async def delete_maintenance_record(
        self, record_id: str, organization_id: str
    ) -> bool:
        """Delete maintenance record"""
        maintenance = await self.get_maintenance_record(record_id, organization_id)
        if not maintenance:
            return False

        await self.db.delete(maintenance)
        await self.db.commit()

        return True

    # =========================================================================
    # System Methods
    # =========================================================================

    async def list_systems(
        self,
        organization_id: str,
        facility_id: Optional[str] = None,
        system_type: Optional[str] = None,
        condition: Optional[str] = None,
        is_active: Optional[bool] = True,
        skip: int = 0,
        limit: int = 100,
    ) -> List[FacilitySystem]:
        """List facility systems"""
        conditions = [FacilitySystem.organization_id == organization_id]

        if facility_id:
            conditions.append(FacilitySystem.facility_id == str(facility_id))
        if system_type:
            conditions.append(FacilitySystem.system_type == system_type)
        if condition:
            conditions.append(FacilitySystem.condition == condition)
        if is_active is not None:
            conditions.append(FacilitySystem.is_active == is_active)

        query = (
            select(FacilitySystem)
            .where(and_(*conditions))
            .order_by(FacilitySystem.sort_order, FacilitySystem.name)
            .offset(skip)
            .limit(limit)
        )

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_system(
        self, system_id: str, organization_id: str
    ) -> Optional[FacilitySystem]:
        """Get facility system by ID"""
        result = await self.db.execute(
            select(FacilitySystem)
            .where(FacilitySystem.id == system_id)
            .where(FacilitySystem.organization_id == str(organization_id))
        )
        return result.scalar_one_or_none()

    async def create_system(
        self,
        system_data: FacilitySystemCreate,
        organization_id: str,
        created_by: str,
    ) -> FacilitySystem:
        """Create a facility system"""
        # Verify facility exists
        facility = await self.get_facility(
            system_data.facility_id, organization_id, include_relations=False
        )
        if not facility:
            raise ValueError("Invalid facility")

        system = FacilitySystem(
            organization_id=organization_id,
            created_by=created_by,
            **system_data.model_dump(),
        )

        self.db.add(system)
        await self.db.commit()
        await self.db.refresh(system)

        return system

    async def update_system(
        self,
        system_id: str,
        system_data: FacilitySystemUpdate,
        organization_id: str,
    ) -> Optional[FacilitySystem]:
        """Update facility system"""
        system = await self.get_system(system_id, organization_id)
        if not system:
            return None

        update_data = system_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(system, field, value)

        await self.db.commit()
        await self.db.refresh(system)

        return system

    async def delete_system(
        self,
        system_id: str,
        organization_id: str,
        archived_by: str,
    ) -> bool:
        """Soft-delete (archive) a facility system"""
        system = await self.get_system(system_id, organization_id)
        if not system:
            return False

        system.is_active = False
        system.archived_at = datetime.now(tz=timezone.utc)
        system.archived_by = archived_by

        await self.db.commit()

        return True

    # =========================================================================
    # Inspection Methods
    # =========================================================================

    async def list_inspections(
        self,
        organization_id: str,
        facility_id: Optional[str] = None,
        inspection_type: Optional[str] = None,
        passed: Optional[bool] = None,
        after_date: Optional[date] = None,
        before_date: Optional[date] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> List[FacilityInspection]:
        """List facility inspections"""
        conditions = [FacilityInspection.organization_id == organization_id]

        if facility_id:
            conditions.append(FacilityInspection.facility_id == str(facility_id))
        if inspection_type:
            conditions.append(FacilityInspection.inspection_type == inspection_type)
        if passed is not None:
            conditions.append(FacilityInspection.passed == passed)
        if after_date:
            conditions.append(FacilityInspection.inspection_date >= after_date)
        if before_date:
            conditions.append(FacilityInspection.inspection_date <= before_date)

        query = (
            select(FacilityInspection)
            .where(and_(*conditions))
            .order_by(desc(FacilityInspection.inspection_date))
            .offset(skip)
            .limit(limit)
        )

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_inspection(
        self, inspection_id: str, organization_id: str
    ) -> Optional[FacilityInspection]:
        """Get facility inspection by ID"""
        result = await self.db.execute(
            select(FacilityInspection)
            .where(FacilityInspection.id == inspection_id)
            .where(FacilityInspection.organization_id == str(organization_id))
        )
        return result.scalar_one_or_none()

    async def create_inspection(
        self,
        inspection_data: FacilityInspectionCreate,
        organization_id: str,
        created_by: str,
    ) -> FacilityInspection:
        """Create a facility inspection"""
        # Verify facility exists
        facility = await self.get_facility(
            inspection_data.facility_id, organization_id, include_relations=False
        )
        if not facility:
            raise ValueError("Invalid facility")

        dump = inspection_data.model_dump()
        # Convert attachment models to dicts for JSON storage
        if dump.get("attachments"):
            dump["attachments"] = [
                a if isinstance(a, dict) else a for a in dump["attachments"]
            ]

        inspection = FacilityInspection(
            organization_id=organization_id,
            created_by=created_by,
            **dump,
        )

        self.db.add(inspection)
        await self.db.commit()
        await self.db.refresh(inspection)

        return inspection

    async def update_inspection(
        self,
        inspection_id: str,
        inspection_data: FacilityInspectionUpdate,
        organization_id: str,
    ) -> Optional[FacilityInspection]:
        """Update facility inspection"""
        inspection = await self.get_inspection(inspection_id, organization_id)
        if not inspection:
            return None

        update_data = inspection_data.model_dump(exclude_unset=True)

        # Convert attachment models to dicts for JSON storage
        if "attachments" in update_data and update_data["attachments"]:
            update_data["attachments"] = [
                a if isinstance(a, dict) else a for a in update_data["attachments"]
            ]

        for field, value in update_data.items():
            setattr(inspection, field, value)

        await self.db.commit()
        await self.db.refresh(inspection)

        return inspection

    async def delete_inspection(
        self, inspection_id: str, organization_id: str
    ) -> bool:
        """Delete facility inspection"""
        inspection = await self.get_inspection(inspection_id, organization_id)
        if not inspection:
            return False

        await self.db.delete(inspection)
        await self.db.commit()

        return True

    # =========================================================================
    # Utility Account Methods
    # =========================================================================

    async def list_utility_accounts(
        self,
        organization_id: str,
        facility_id: Optional[str] = None,
        utility_type: Optional[str] = None,
        is_active: Optional[bool] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> List[FacilityUtilityAccount]:
        """List utility accounts"""
        conditions = [FacilityUtilityAccount.organization_id == organization_id]

        if facility_id:
            conditions.append(FacilityUtilityAccount.facility_id == facility_id)
        if utility_type:
            conditions.append(FacilityUtilityAccount.utility_type == utility_type)
        if is_active is not None:
            conditions.append(FacilityUtilityAccount.is_active == is_active)

        query = (
            select(FacilityUtilityAccount)
            .where(and_(*conditions))
            .order_by(desc(FacilityUtilityAccount.created_at))
            .offset(skip)
            .limit(limit)
        )

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_utility_account(
        self, account_id: str, organization_id: str
    ) -> Optional[FacilityUtilityAccount]:
        """Get utility account by ID"""
        result = await self.db.execute(
            select(FacilityUtilityAccount)
            .where(FacilityUtilityAccount.id == account_id)
            .where(FacilityUtilityAccount.organization_id == organization_id)
        )
        return result.scalar_one_or_none()

    async def create_utility_account(
        self,
        account_data: FacilityUtilityAccountCreate,
        organization_id: str,
        created_by: str,
    ) -> FacilityUtilityAccount:
        """Create a utility account"""
        # Verify facility exists
        facility = await self.get_facility(
            account_data.facility_id, organization_id, include_relations=False
        )
        if not facility:
            raise ValueError("Invalid facility")

        account = FacilityUtilityAccount(
            organization_id=organization_id,
            created_by=created_by,
            **account_data.model_dump(),
        )

        self.db.add(account)
        await self.db.commit()
        await self.db.refresh(account)

        return account

    async def update_utility_account(
        self,
        account_id: str,
        account_data: FacilityUtilityAccountUpdate,
        organization_id: str,
    ) -> Optional[FacilityUtilityAccount]:
        """Update utility account"""
        account = await self.get_utility_account(account_id, organization_id)
        if not account:
            return None

        update_data = account_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(account, field, value)

        await self.db.commit()
        await self.db.refresh(account)

        return account

    async def delete_utility_account(
        self, account_id: str, organization_id: str
    ) -> bool:
        """Delete utility account"""
        account = await self.get_utility_account(account_id, organization_id)
        if not account:
            return False

        await self.db.delete(account)
        await self.db.commit()

        return True

    # =========================================================================
    # Utility Reading Methods
    # =========================================================================

    async def list_utility_readings(
        self,
        organization_id: str,
        utility_account_id: Optional[str] = None,
        after_date: Optional[date] = None,
        before_date: Optional[date] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> List[FacilityUtilityReading]:
        """List utility readings"""
        conditions = [FacilityUtilityReading.organization_id == organization_id]

        if utility_account_id:
            conditions.append(
                FacilityUtilityReading.utility_account_id == utility_account_id
            )
        if after_date:
            conditions.append(FacilityUtilityReading.reading_date >= after_date)
        if before_date:
            conditions.append(FacilityUtilityReading.reading_date <= before_date)

        query = (
            select(FacilityUtilityReading)
            .where(and_(*conditions))
            .order_by(desc(FacilityUtilityReading.reading_date))
            .offset(skip)
            .limit(limit)
        )

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_utility_reading(
        self, reading_id: str, organization_id: str
    ) -> Optional[FacilityUtilityReading]:
        """Get utility reading by ID"""
        result = await self.db.execute(
            select(FacilityUtilityReading)
            .where(FacilityUtilityReading.id == reading_id)
            .where(FacilityUtilityReading.organization_id == organization_id)
        )
        return result.scalar_one_or_none()

    async def create_utility_reading(
        self,
        reading_data: FacilityUtilityReadingCreate,
        organization_id: str,
        created_by: str,
    ) -> FacilityUtilityReading:
        """Create a utility reading"""
        # Verify utility account exists and belongs to org
        account = await self.get_utility_account(
            reading_data.utility_account_id, organization_id
        )
        if not account:
            raise ValueError("Invalid utility account")

        reading = FacilityUtilityReading(
            organization_id=organization_id,
            created_by=created_by,
            **reading_data.model_dump(),
        )

        self.db.add(reading)
        await self.db.commit()
        await self.db.refresh(reading)

        return reading

    async def update_utility_reading(
        self,
        reading_id: str,
        reading_data: FacilityUtilityReadingUpdate,
        organization_id: str,
    ) -> Optional[FacilityUtilityReading]:
        """Update a utility reading"""
        reading = await self.get_utility_reading(reading_id, organization_id)
        if not reading:
            return None

        update_data = reading_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(reading, field, value)

        await self.db.commit()
        await self.db.refresh(reading)

        return reading

    async def delete_utility_reading(
        self, reading_id: str, organization_id: str
    ) -> bool:
        """Delete utility reading"""
        reading = await self.get_utility_reading(reading_id, organization_id)
        if not reading:
            return False

        await self.db.delete(reading)
        await self.db.commit()

        return True

    # =========================================================================
    # Access Key Methods
    # =========================================================================

    async def list_access_keys(
        self,
        organization_id: str,
        facility_id: Optional[str] = None,
        key_type: Optional[str] = None,
        is_active: Optional[bool] = None,
        assigned_to_user_id: Optional[str] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> List[FacilityAccessKey]:
        """List facility access keys"""
        conditions = [FacilityAccessKey.organization_id == organization_id]

        if facility_id:
            conditions.append(FacilityAccessKey.facility_id == facility_id)
        if key_type:
            conditions.append(FacilityAccessKey.key_type == key_type)
        if is_active is not None:
            conditions.append(FacilityAccessKey.is_active == is_active)
        if assigned_to_user_id:
            conditions.append(
                FacilityAccessKey.assigned_to_user_id == assigned_to_user_id
            )

        query = (
            select(FacilityAccessKey)
            .where(and_(*conditions))
            .order_by(desc(FacilityAccessKey.created_at))
            .offset(skip)
            .limit(limit)
        )

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_access_key(
        self, key_id: str, organization_id: str
    ) -> Optional[FacilityAccessKey]:
        """Get access key by ID"""
        result = await self.db.execute(
            select(FacilityAccessKey)
            .where(FacilityAccessKey.id == key_id)
            .where(FacilityAccessKey.organization_id == organization_id)
        )
        return result.scalar_one_or_none()

    async def create_access_key(
        self,
        key_data: FacilityAccessKeyCreate,
        organization_id: str,
        created_by: str,
    ) -> FacilityAccessKey:
        """Create an access key"""
        # Verify facility exists
        facility = await self.get_facility(
            key_data.facility_id, organization_id, include_relations=False
        )
        if not facility:
            raise ValueError("Invalid facility")

        key = FacilityAccessKey(
            organization_id=organization_id,
            created_by=created_by,
            **key_data.model_dump(),
        )

        self.db.add(key)
        await self.db.commit()
        await self.db.refresh(key)

        return key

    async def update_access_key(
        self,
        key_id: str,
        key_data: FacilityAccessKeyUpdate,
        organization_id: str,
    ) -> Optional[FacilityAccessKey]:
        """Update access key"""
        key = await self.get_access_key(key_id, organization_id)
        if not key:
            return None

        update_data = key_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(key, field, value)

        await self.db.commit()
        await self.db.refresh(key)

        return key

    async def delete_access_key(
        self, key_id: str, organization_id: str
    ) -> bool:
        """Delete access key"""
        key = await self.get_access_key(key_id, organization_id)
        if not key:
            return False

        await self.db.delete(key)
        await self.db.commit()

        return True

    # =========================================================================
    # Room Methods
    # =========================================================================

    async def list_rooms(
        self,
        organization_id: str,
        facility_id: Optional[str] = None,
        room_type: Optional[str] = None,
        floor: Optional[str] = None,
        is_active: Optional[bool] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> List[FacilityRoom]:
        """List facility rooms"""
        conditions = [FacilityRoom.organization_id == organization_id]

        if facility_id:
            conditions.append(FacilityRoom.facility_id == facility_id)
        if room_type:
            conditions.append(FacilityRoom.room_type == room_type)
        if floor:
            conditions.append(FacilityRoom.floor == floor)
        if is_active is not None:
            conditions.append(FacilityRoom.is_active == is_active)

        query = (
            select(FacilityRoom)
            .where(and_(*conditions))
            .order_by(desc(FacilityRoom.created_at))
            .offset(skip)
            .limit(limit)
        )

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_room(
        self, room_id: str, organization_id: str
    ) -> Optional[FacilityRoom]:
        """Get room by ID"""
        result = await self.db.execute(
            select(FacilityRoom)
            .where(FacilityRoom.id == room_id)
            .where(FacilityRoom.organization_id == organization_id)
        )
        return result.scalar_one_or_none()

    async def create_room(
        self,
        room_data: FacilityRoomCreate,
        organization_id: str,
        created_by: str,
    ) -> FacilityRoom:
        """Create a facility room"""
        # Verify facility exists
        facility = await self.get_facility(
            room_data.facility_id, organization_id, include_relations=False
        )
        if not facility:
            raise ValueError("Invalid facility")

        room = FacilityRoom(
            organization_id=organization_id,
            created_by=created_by,
            **room_data.model_dump(),
        )

        self.db.add(room)
        await self.db.commit()
        await self.db.refresh(room)

        return room

    async def update_room(
        self,
        room_id: str,
        room_data: FacilityRoomUpdate,
        organization_id: str,
        updated_by: Optional[str] = None,
    ) -> Optional[FacilityRoom]:
        """Update room"""
        room = await self.get_room(room_id, organization_id)
        if not room:
            return None

        update_data = room_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(room, field, value)

        if updated_by:
            room.updated_by = updated_by

        await self.db.commit()
        await self.db.refresh(room)

        return room

    async def delete_room(
        self, room_id: str, organization_id: str
    ) -> bool:
        """Delete room"""
        room = await self.get_room(room_id, organization_id)
        if not room:
            return False

        await self.db.delete(room)
        await self.db.commit()

        return True

    # =========================================================================
    # Emergency Contact Methods
    # =========================================================================

    async def list_emergency_contacts(
        self,
        organization_id: str,
        facility_id: Optional[str] = None,
        contact_type: Optional[str] = None,
        is_active: Optional[bool] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> List[FacilityEmergencyContact]:
        """List facility emergency contacts"""
        conditions = [FacilityEmergencyContact.organization_id == organization_id]

        if facility_id:
            conditions.append(FacilityEmergencyContact.facility_id == facility_id)
        if contact_type:
            conditions.append(
                FacilityEmergencyContact.contact_type == contact_type
            )
        if is_active is not None:
            conditions.append(FacilityEmergencyContact.is_active == is_active)

        query = (
            select(FacilityEmergencyContact)
            .where(and_(*conditions))
            .order_by(desc(FacilityEmergencyContact.created_at))
            .offset(skip)
            .limit(limit)
        )

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_emergency_contact(
        self, contact_id: str, organization_id: str
    ) -> Optional[FacilityEmergencyContact]:
        """Get emergency contact by ID"""
        result = await self.db.execute(
            select(FacilityEmergencyContact)
            .where(FacilityEmergencyContact.id == contact_id)
            .where(FacilityEmergencyContact.organization_id == organization_id)
        )
        return result.scalar_one_or_none()

    async def create_emergency_contact(
        self,
        contact_data: FacilityEmergencyContactCreate,
        organization_id: str,
        created_by: str,
    ) -> FacilityEmergencyContact:
        """Create an emergency contact"""
        # Verify facility exists
        facility = await self.get_facility(
            contact_data.facility_id, organization_id, include_relations=False
        )
        if not facility:
            raise ValueError("Invalid facility")

        contact = FacilityEmergencyContact(
            organization_id=organization_id,
            created_by=created_by,
            **contact_data.model_dump(),
        )

        self.db.add(contact)
        await self.db.commit()
        await self.db.refresh(contact)

        return contact

    async def update_emergency_contact(
        self,
        contact_id: str,
        contact_data: FacilityEmergencyContactUpdate,
        organization_id: str,
    ) -> Optional[FacilityEmergencyContact]:
        """Update emergency contact"""
        contact = await self.get_emergency_contact(contact_id, organization_id)
        if not contact:
            return None

        update_data = contact_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(contact, field, value)

        await self.db.commit()
        await self.db.refresh(contact)

        return contact

    async def delete_emergency_contact(
        self, contact_id: str, organization_id: str
    ) -> bool:
        """Delete emergency contact"""
        contact = await self.get_emergency_contact(contact_id, organization_id)
        if not contact:
            return False

        await self.db.delete(contact)
        await self.db.commit()

        return True

    # =========================================================================
    # Shutoff Location Methods
    # =========================================================================

    async def list_shutoff_locations(
        self,
        organization_id: str,
        facility_id: Optional[str] = None,
        shutoff_type: Optional[str] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> List[FacilityShutoffLocation]:
        """List facility shutoff locations"""
        conditions = [FacilityShutoffLocation.organization_id == organization_id]

        if facility_id:
            conditions.append(FacilityShutoffLocation.facility_id == facility_id)
        if shutoff_type:
            conditions.append(
                FacilityShutoffLocation.shutoff_type == shutoff_type
            )

        query = (
            select(FacilityShutoffLocation)
            .where(and_(*conditions))
            .order_by(desc(FacilityShutoffLocation.created_at))
            .offset(skip)
            .limit(limit)
        )

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_shutoff_location(
        self, location_id: str, organization_id: str
    ) -> Optional[FacilityShutoffLocation]:
        """Get shutoff location by ID"""
        result = await self.db.execute(
            select(FacilityShutoffLocation)
            .where(FacilityShutoffLocation.id == location_id)
            .where(FacilityShutoffLocation.organization_id == organization_id)
        )
        return result.scalar_one_or_none()

    async def create_shutoff_location(
        self,
        location_data: FacilityShutoffLocationCreate,
        organization_id: str,
        created_by: str,
    ) -> FacilityShutoffLocation:
        """Create a shutoff location"""
        # Verify facility exists
        facility = await self.get_facility(
            location_data.facility_id, organization_id, include_relations=False
        )
        if not facility:
            raise ValueError("Invalid facility")

        location = FacilityShutoffLocation(
            organization_id=organization_id,
            created_by=created_by,
            **location_data.model_dump(),
        )

        self.db.add(location)
        await self.db.commit()
        await self.db.refresh(location)

        return location

    async def update_shutoff_location(
        self,
        location_id: str,
        location_data: FacilityShutoffLocationUpdate,
        organization_id: str,
    ) -> Optional[FacilityShutoffLocation]:
        """Update shutoff location"""
        location = await self.get_shutoff_location(location_id, organization_id)
        if not location:
            return None

        update_data = location_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(location, field, value)

        await self.db.commit()
        await self.db.refresh(location)

        return location

    async def delete_shutoff_location(
        self, location_id: str, organization_id: str
    ) -> bool:
        """Delete shutoff location"""
        location = await self.get_shutoff_location(location_id, organization_id)
        if not location:
            return False

        await self.db.delete(location)
        await self.db.commit()

        return True

    # =========================================================================
    # Capital Project Methods
    # =========================================================================

    async def list_capital_projects(
        self,
        organization_id: str,
        facility_id: Optional[str] = None,
        project_type: Optional[str] = None,
        project_status: Optional[str] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> List[FacilityCapitalProject]:
        """List capital projects"""
        conditions = [FacilityCapitalProject.organization_id == organization_id]

        if facility_id:
            conditions.append(FacilityCapitalProject.facility_id == facility_id)
        if project_type:
            conditions.append(
                FacilityCapitalProject.project_type == project_type
            )
        if project_status:
            conditions.append(
                FacilityCapitalProject.project_status == project_status
            )

        query = (
            select(FacilityCapitalProject)
            .where(and_(*conditions))
            .order_by(desc(FacilityCapitalProject.created_at))
            .offset(skip)
            .limit(limit)
        )

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_capital_project(
        self, project_id: str, organization_id: str
    ) -> Optional[FacilityCapitalProject]:
        """Get capital project by ID"""
        result = await self.db.execute(
            select(FacilityCapitalProject)
            .where(FacilityCapitalProject.id == project_id)
            .where(FacilityCapitalProject.organization_id == organization_id)
        )
        return result.scalar_one_or_none()

    async def create_capital_project(
        self,
        project_data: FacilityCapitalProjectCreate,
        organization_id: str,
        created_by: str,
    ) -> FacilityCapitalProject:
        """Create a capital project"""
        # Verify facility exists
        facility = await self.get_facility(
            project_data.facility_id, organization_id, include_relations=False
        )
        if not facility:
            raise ValueError("Invalid facility")

        dump = project_data.model_dump()
        # Convert attachment models to dicts for JSON storage
        if dump.get("attachments"):
            dump["attachments"] = [
                a if isinstance(a, dict) else a for a in dump["attachments"]
            ]

        project = FacilityCapitalProject(
            organization_id=organization_id,
            created_by=created_by,
            **dump,
        )

        self.db.add(project)
        await self.db.commit()
        await self.db.refresh(project)

        return project

    async def update_capital_project(
        self,
        project_id: str,
        project_data: FacilityCapitalProjectUpdate,
        organization_id: str,
    ) -> Optional[FacilityCapitalProject]:
        """Update capital project"""
        project = await self.get_capital_project(project_id, organization_id)
        if not project:
            return None

        update_data = project_data.model_dump(exclude_unset=True)

        # Convert attachment models to dicts for JSON storage
        if "attachments" in update_data and update_data["attachments"]:
            update_data["attachments"] = [
                a if isinstance(a, dict) else a for a in update_data["attachments"]
            ]

        for field, value in update_data.items():
            setattr(project, field, value)

        await self.db.commit()
        await self.db.refresh(project)

        return project

    async def delete_capital_project(
        self, project_id: str, organization_id: str
    ) -> bool:
        """Delete capital project"""
        project = await self.get_capital_project(project_id, organization_id)
        if not project:
            return False

        await self.db.delete(project)
        await self.db.commit()

        return True

    # =========================================================================
    # Insurance Policy Methods
    # =========================================================================

    async def list_insurance_policies(
        self,
        organization_id: str,
        facility_id: Optional[str] = None,
        policy_type: Optional[str] = None,
        is_active: Optional[bool] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> List[FacilityInsurancePolicy]:
        """List insurance policies"""
        conditions = [FacilityInsurancePolicy.organization_id == organization_id]

        if facility_id:
            conditions.append(FacilityInsurancePolicy.facility_id == facility_id)
        if policy_type:
            conditions.append(
                FacilityInsurancePolicy.policy_type == policy_type
            )
        if is_active is not None:
            conditions.append(FacilityInsurancePolicy.is_active == is_active)

        query = (
            select(FacilityInsurancePolicy)
            .where(and_(*conditions))
            .order_by(desc(FacilityInsurancePolicy.created_at))
            .offset(skip)
            .limit(limit)
        )

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_insurance_policy(
        self, policy_id: str, organization_id: str
    ) -> Optional[FacilityInsurancePolicy]:
        """Get insurance policy by ID"""
        result = await self.db.execute(
            select(FacilityInsurancePolicy)
            .where(FacilityInsurancePolicy.id == policy_id)
            .where(FacilityInsurancePolicy.organization_id == organization_id)
        )
        return result.scalar_one_or_none()

    async def create_insurance_policy(
        self,
        policy_data: FacilityInsurancePolicyCreate,
        organization_id: str,
        created_by: str,
    ) -> FacilityInsurancePolicy:
        """Create an insurance policy"""
        # Verify facility exists
        facility = await self.get_facility(
            policy_data.facility_id, organization_id, include_relations=False
        )
        if not facility:
            raise ValueError("Invalid facility")

        dump = policy_data.model_dump()
        # Convert attachment models to dicts for JSON storage
        if dump.get("attachments"):
            dump["attachments"] = [
                a if isinstance(a, dict) else a for a in dump["attachments"]
            ]

        policy = FacilityInsurancePolicy(
            organization_id=organization_id,
            created_by=created_by,
            **dump,
        )

        self.db.add(policy)
        await self.db.commit()
        await self.db.refresh(policy)

        return policy

    async def update_insurance_policy(
        self,
        policy_id: str,
        policy_data: FacilityInsurancePolicyUpdate,
        organization_id: str,
    ) -> Optional[FacilityInsurancePolicy]:
        """Update insurance policy"""
        policy = await self.get_insurance_policy(policy_id, organization_id)
        if not policy:
            return None

        update_data = policy_data.model_dump(exclude_unset=True)

        # Convert attachment models to dicts for JSON storage
        if "attachments" in update_data and update_data["attachments"]:
            update_data["attachments"] = [
                a if isinstance(a, dict) else a for a in update_data["attachments"]
            ]

        for field, value in update_data.items():
            setattr(policy, field, value)

        await self.db.commit()
        await self.db.refresh(policy)

        return policy

    async def delete_insurance_policy(
        self, policy_id: str, organization_id: str
    ) -> bool:
        """Delete insurance policy"""
        policy = await self.get_insurance_policy(policy_id, organization_id)
        if not policy:
            return False

        await self.db.delete(policy)
        await self.db.commit()

        return True

    # =========================================================================
    # Occupant Methods
    # =========================================================================

    async def list_occupants(
        self,
        organization_id: str,
        facility_id: Optional[str] = None,
        is_active: Optional[bool] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> List[FacilityOccupant]:
        """List facility occupants"""
        conditions = [FacilityOccupant.organization_id == organization_id]

        if facility_id:
            conditions.append(FacilityOccupant.facility_id == facility_id)
        if is_active is not None:
            conditions.append(FacilityOccupant.is_active == is_active)

        query = (
            select(FacilityOccupant)
            .where(and_(*conditions))
            .order_by(desc(FacilityOccupant.created_at))
            .offset(skip)
            .limit(limit)
        )

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_occupant(
        self, occupant_id: str, organization_id: str
    ) -> Optional[FacilityOccupant]:
        """Get occupant by ID"""
        result = await self.db.execute(
            select(FacilityOccupant)
            .where(FacilityOccupant.id == occupant_id)
            .where(FacilityOccupant.organization_id == organization_id)
        )
        return result.scalar_one_or_none()

    async def create_occupant(
        self,
        occupant_data: FacilityOccupantCreate,
        organization_id: str,
        created_by: str,
    ) -> FacilityOccupant:
        """Create an occupant"""
        # Verify facility exists
        facility = await self.get_facility(
            occupant_data.facility_id, organization_id, include_relations=False
        )
        if not facility:
            raise ValueError("Invalid facility")

        occupant = FacilityOccupant(
            organization_id=organization_id,
            created_by=created_by,
            **occupant_data.model_dump(),
        )

        self.db.add(occupant)
        await self.db.commit()
        await self.db.refresh(occupant)

        return occupant

    async def update_occupant(
        self,
        occupant_id: str,
        occupant_data: FacilityOccupantUpdate,
        organization_id: str,
    ) -> Optional[FacilityOccupant]:
        """Update occupant"""
        occupant = await self.get_occupant(occupant_id, organization_id)
        if not occupant:
            return None

        update_data = occupant_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(occupant, field, value)

        await self.db.commit()
        await self.db.refresh(occupant)

        return occupant

    async def delete_occupant(
        self, occupant_id: str, organization_id: str
    ) -> bool:
        """Delete occupant"""
        occupant = await self.get_occupant(occupant_id, organization_id)
        if not occupant:
            return False

        await self.db.delete(occupant)
        await self.db.commit()

        return True

    # =========================================================================
    # Compliance Checklist Methods
    # =========================================================================

    async def list_compliance_checklists(
        self,
        organization_id: str,
        facility_id: Optional[str] = None,
        compliance_type: Optional[str] = None,
        is_completed: Optional[bool] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> List[FacilityComplianceChecklist]:
        """List compliance checklists"""
        conditions = [
            FacilityComplianceChecklist.organization_id == organization_id
        ]

        if facility_id:
            conditions.append(
                FacilityComplianceChecklist.facility_id == facility_id
            )
        if compliance_type:
            conditions.append(
                FacilityComplianceChecklist.compliance_type == compliance_type
            )
        if is_completed is not None:
            conditions.append(
                FacilityComplianceChecklist.is_completed == is_completed
            )

        query = (
            select(FacilityComplianceChecklist)
            .where(and_(*conditions))
            .order_by(desc(FacilityComplianceChecklist.created_at))
            .offset(skip)
            .limit(limit)
        )

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_compliance_checklist(
        self, checklist_id: str, organization_id: str
    ) -> Optional[FacilityComplianceChecklist]:
        """Get compliance checklist by ID with items"""
        result = await self.db.execute(
            select(FacilityComplianceChecklist)
            .where(FacilityComplianceChecklist.id == checklist_id)
            .where(
                FacilityComplianceChecklist.organization_id == organization_id
            )
            .options(selectinload(FacilityComplianceChecklist.items))
        )
        return result.scalar_one_or_none()

    async def create_compliance_checklist(
        self,
        checklist_data: FacilityComplianceChecklistCreate,
        organization_id: str,
        created_by: str,
    ) -> FacilityComplianceChecklist:
        """Create a compliance checklist"""
        # Verify facility exists
        facility = await self.get_facility(
            checklist_data.facility_id, organization_id, include_relations=False
        )
        if not facility:
            raise ValueError("Invalid facility")

        checklist = FacilityComplianceChecklist(
            organization_id=organization_id,
            created_by=created_by,
            **checklist_data.model_dump(),
        )

        self.db.add(checklist)
        await self.db.commit()
        await self.db.refresh(checklist)

        return checklist

    async def update_compliance_checklist(
        self,
        checklist_id: str,
        checklist_data: FacilityComplianceChecklistUpdate,
        organization_id: str,
    ) -> Optional[FacilityComplianceChecklist]:
        """Update compliance checklist"""
        checklist = await self.get_compliance_checklist(
            checklist_id, organization_id
        )
        if not checklist:
            return None

        update_data = checklist_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(checklist, field, value)

        await self.db.commit()
        await self.db.refresh(checklist)

        return checklist

    async def delete_compliance_checklist(
        self, checklist_id: str, organization_id: str
    ) -> bool:
        """Delete compliance checklist"""
        checklist = await self.get_compliance_checklist(
            checklist_id, organization_id
        )
        if not checklist:
            return False

        await self.db.delete(checklist)
        await self.db.commit()

        return True

    # =========================================================================
    # Compliance Item Methods
    # =========================================================================

    async def list_compliance_items(
        self,
        organization_id: str,
        checklist_id: Optional[str] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> List[FacilityComplianceItem]:
        """List compliance items"""
        conditions = [FacilityComplianceItem.organization_id == organization_id]

        if checklist_id:
            conditions.append(
                FacilityComplianceItem.checklist_id == checklist_id
            )

        query = (
            select(FacilityComplianceItem)
            .where(and_(*conditions))
            .order_by(desc(FacilityComplianceItem.created_at))
            .offset(skip)
            .limit(limit)
        )

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_compliance_item(
        self, item_id: str, organization_id: str
    ) -> Optional[FacilityComplianceItem]:
        """Get compliance item by ID"""
        result = await self.db.execute(
            select(FacilityComplianceItem)
            .where(FacilityComplianceItem.id == item_id)
            .where(FacilityComplianceItem.organization_id == organization_id)
        )
        return result.scalar_one_or_none()

    async def create_compliance_item(
        self,
        item_data: FacilityComplianceItemCreate,
        organization_id: str,
        created_by: str,
    ) -> FacilityComplianceItem:
        """Create a compliance item"""
        # Verify checklist exists and belongs to org
        checklist = await self.get_compliance_checklist(
            item_data.checklist_id, organization_id
        )
        if not checklist:
            raise ValueError("Invalid compliance checklist")

        item = FacilityComplianceItem(
            organization_id=organization_id,
            created_by=created_by,
            **item_data.model_dump(),
        )

        self.db.add(item)
        await self.db.commit()
        await self.db.refresh(item)

        return item

    async def update_compliance_item(
        self,
        item_id: str,
        item_data: FacilityComplianceItemUpdate,
        organization_id: str,
    ) -> Optional[FacilityComplianceItem]:
        """Update compliance item"""
        item = await self.get_compliance_item(item_id, organization_id)
        if not item:
            return None

        update_data = item_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(item, field, value)

        await self.db.commit()
        await self.db.refresh(item)

        return item

    async def delete_compliance_item(
        self, item_id: str, organization_id: str
    ) -> bool:
        """Delete compliance item"""
        item = await self.get_compliance_item(item_id, organization_id)
        if not item:
            return False

        await self.db.delete(item)
        await self.db.commit()

        return True
