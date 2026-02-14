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
)
from app.schemas.facilities import (
    FacilityCreate,
    FacilityUpdate,
    FacilityTypeCreate,
    FacilityTypeUpdate,
    FacilityStatusCreate,
    FacilityStatusUpdate,
    FacilityPhotoCreate,
    FacilityDocumentCreate,
    FacilityMaintenanceTypeCreate,
    FacilityMaintenanceTypeUpdate,
    FacilityMaintenanceCreate,
    FacilityMaintenanceUpdate,
    FacilitySystemCreate,
    FacilitySystemUpdate,
    FacilityInspectionCreate,
    FacilityInspectionUpdate,
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
            conditions.append(FacilityType.organization_id == organization_id)

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
            .where(Facility.organization_id == organization_id)
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
            conditions.append(FacilityStatus.organization_id == organization_id)

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
            .where(Facility.organization_id == organization_id)
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
            search_term = f"%{search}%"
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
            .where(Facility.id == facility_id)
            .where(Facility.organization_id == organization_id)
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
                .where(Facility.organization_id == organization_id)
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
                .where(Facility.organization_id == organization_id)
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
        self, organization_id: str, facility_id: str
    ) -> List[FacilityPhoto]:
        """List photos for a facility"""
        query = (
            select(FacilityPhoto)
            .where(FacilityPhoto.facility_id == facility_id)
            .where(FacilityPhoto.organization_id == organization_id)
            .order_by(desc(FacilityPhoto.is_primary), desc(FacilityPhoto.uploaded_at))
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
                .where(FacilityPhoto.organization_id == organization_id)
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

    async def delete_photo(
        self, photo_id: str, organization_id: str
    ) -> bool:
        """Delete a facility photo"""
        result = await self.db.execute(
            select(FacilityPhoto)
            .where(FacilityPhoto.id == photo_id)
            .where(FacilityPhoto.organization_id == organization_id)
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
        self, organization_id: str, facility_id: str
    ) -> List[FacilityDocument]:
        """List documents for a facility"""
        query = (
            select(FacilityDocument)
            .where(FacilityDocument.facility_id == facility_id)
            .where(FacilityDocument.organization_id == organization_id)
            .order_by(FacilityDocument.document_type, desc(FacilityDocument.uploaded_at))
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

    async def delete_document(
        self, document_id: str, organization_id: str
    ) -> bool:
        """Delete a facility document"""
        result = await self.db.execute(
            select(FacilityDocument)
            .where(FacilityDocument.id == document_id)
            .where(FacilityDocument.organization_id == organization_id)
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
            .where(FacilityMaintenance.organization_id == organization_id)
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
            conditions.append(FacilityMaintenance.facility_id == facility_id)
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
            .where(FacilityMaintenance.organization_id == organization_id)
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
            conditions.append(FacilitySystem.facility_id == facility_id)
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
            .where(FacilitySystem.organization_id == organization_id)
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
            conditions.append(FacilityInspection.facility_id == facility_id)
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
            .where(FacilityInspection.organization_id == organization_id)
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
