"""
Apparatus Service

Business logic for apparatus/vehicle management.
"""

from typing import List, Optional, Tuple, Dict, Any
from uuid import UUID
from datetime import datetime, date, timedelta
from decimal import Decimal
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func, desc
from sqlalchemy.orm import selectinload

from app.models.apparatus import (
    Apparatus,
    ApparatusType,
    ApparatusStatus,
    ApparatusCustomField,
    ApparatusPhoto,
    ApparatusDocument,
    ApparatusMaintenanceType,
    ApparatusMaintenance,
    ApparatusFuelLog,
    ApparatusOperator,
    ApparatusEquipment,
    ApparatusLocationHistory,
    ApparatusStatusHistory,
    ApparatusNFPACompliance,
    ApparatusReportConfig,
    DefaultApparatusType,
    DefaultApparatusStatus,
)
from app.schemas.apparatus import (
    ApparatusCreate,
    ApparatusUpdate,
    ApparatusStatusChange,
    ApparatusArchive,
    ApparatusTypeCreate,
    ApparatusTypeUpdate,
    ApparatusStatusCreate,
    ApparatusStatusUpdate,
    ApparatusCustomFieldCreate,
    ApparatusCustomFieldUpdate,
    ApparatusMaintenanceTypeCreate,
    ApparatusMaintenanceTypeUpdate,
    ApparatusMaintenanceCreate,
    ApparatusMaintenanceUpdate,
    ApparatusFuelLogCreate,
    ApparatusFuelLogUpdate,
    ApparatusOperatorCreate,
    ApparatusOperatorUpdate,
    ApparatusEquipmentCreate,
    ApparatusEquipmentUpdate,
    ApparatusPhotoCreate,
    ApparatusPhotoUpdate,
    ApparatusDocumentCreate,
    ApparatusDocumentUpdate,
    ApparatusListFilters,
)


class ApparatusService:
    """Service for apparatus management"""

    def __init__(self, db: AsyncSession):
        self.db = db

    # =========================================================================
    # Apparatus Type Methods
    # =========================================================================

    async def create_apparatus_type(
        self,
        type_data: ApparatusTypeCreate,
        organization_id: str,
    ) -> ApparatusType:
        """Create a new apparatus type"""
        # Check if code already exists for this org
        result = await self.db.execute(
            select(ApparatusType)
            .where(
                or_(
                    ApparatusType.organization_id == organization_id,
                    ApparatusType.organization_id.is_(None)  # System types
                )
            )
            .where(ApparatusType.code == type_data.code)
        )
        existing = result.scalar_one_or_none()
        if existing:
            raise ValueError(f"Apparatus type with code '{type_data.code}' already exists")

        apparatus_type = ApparatusType(
            organization_id=organization_id,
            is_system=False,
            **type_data.model_dump()
        )

        self.db.add(apparatus_type)
        await self.db.commit()
        await self.db.refresh(apparatus_type)

        return apparatus_type

    async def get_apparatus_type(
        self, type_id: str, organization_id: str
    ) -> Optional[ApparatusType]:
        """Get apparatus type by ID"""
        result = await self.db.execute(
            select(ApparatusType)
            .where(ApparatusType.id == type_id)
            .where(
                or_(
                    ApparatusType.organization_id == organization_id,
                    ApparatusType.organization_id.is_(None)  # System types
                )
            )
        )
        return result.scalar_one_or_none()

    async def list_apparatus_types(
        self,
        organization_id: str,
        is_active: Optional[bool] = None,
        include_system: bool = True,
    ) -> List[ApparatusType]:
        """List all apparatus types for an organization"""
        conditions = []

        if include_system:
            conditions.append(
                or_(
                    ApparatusType.organization_id == organization_id,
                    ApparatusType.organization_id.is_(None)
                )
            )
        else:
            conditions.append(ApparatusType.organization_id == organization_id)

        if is_active is not None:
            conditions.append(ApparatusType.is_active == is_active)

        query = (
            select(ApparatusType)
            .where(and_(*conditions))
            .order_by(ApparatusType.sort_order, ApparatusType.name)
        )

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def update_apparatus_type(
        self,
        type_id: str,
        type_data: ApparatusTypeUpdate,
        organization_id: str,
    ) -> Optional[ApparatusType]:
        """Update apparatus type"""
        apparatus_type = await self.get_apparatus_type(type_id, organization_id)
        if not apparatus_type:
            return None

        # Cannot modify system types
        if apparatus_type.is_system:
            raise ValueError("Cannot modify system apparatus types")

        # Check code uniqueness if changing
        if type_data.code and type_data.code != apparatus_type.code:
            result = await self.db.execute(
                select(ApparatusType)
                .where(
                    or_(
                        ApparatusType.organization_id == organization_id,
                        ApparatusType.organization_id.is_(None)
                    )
                )
                .where(ApparatusType.code == type_data.code)
                .where(ApparatusType.id != type_id)
            )
            if result.scalar_one_or_none():
                raise ValueError(f"Apparatus type with code '{type_data.code}' already exists")

        update_data = type_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(apparatus_type, field, value)

        await self.db.commit()
        await self.db.refresh(apparatus_type)

        return apparatus_type

    async def delete_apparatus_type(
        self, type_id: str, organization_id: str
    ) -> bool:
        """Delete apparatus type"""
        apparatus_type = await self.get_apparatus_type(type_id, organization_id)
        if not apparatus_type:
            return False

        if apparatus_type.is_system:
            raise ValueError("Cannot delete system apparatus types")

        # Check if any apparatus uses this type
        result = await self.db.execute(
            select(func.count(Apparatus.id))
            .where(Apparatus.apparatus_type_id == type_id)
        )
        count = result.scalar()
        if count > 0:
            raise ValueError(f"Cannot delete type. {count} apparatus use this type.")

        await self.db.delete(apparatus_type)
        await self.db.commit()

        return True

    # =========================================================================
    # Apparatus Status Methods
    # =========================================================================

    async def create_apparatus_status(
        self,
        status_data: ApparatusStatusCreate,
        organization_id: str,
    ) -> ApparatusStatus:
        """Create a new apparatus status"""
        result = await self.db.execute(
            select(ApparatusStatus)
            .where(
                or_(
                    ApparatusStatus.organization_id == organization_id,
                    ApparatusStatus.organization_id.is_(None)
                )
            )
            .where(ApparatusStatus.code == status_data.code)
        )
        existing = result.scalar_one_or_none()
        if existing:
            raise ValueError(f"Apparatus status with code '{status_data.code}' already exists")

        apparatus_status = ApparatusStatus(
            organization_id=organization_id,
            is_system=False,
            **status_data.model_dump()
        )

        self.db.add(apparatus_status)
        await self.db.commit()
        await self.db.refresh(apparatus_status)

        return apparatus_status

    async def get_apparatus_status(
        self, status_id: str, organization_id: str
    ) -> Optional[ApparatusStatus]:
        """Get apparatus status by ID"""
        result = await self.db.execute(
            select(ApparatusStatus)
            .where(ApparatusStatus.id == status_id)
            .where(
                or_(
                    ApparatusStatus.organization_id == organization_id,
                    ApparatusStatus.organization_id.is_(None)
                )
            )
        )
        return result.scalar_one_or_none()

    async def list_apparatus_statuses(
        self,
        organization_id: str,
        is_active: Optional[bool] = None,
        include_system: bool = True,
    ) -> List[ApparatusStatus]:
        """List all apparatus statuses for an organization"""
        conditions = []

        if include_system:
            conditions.append(
                or_(
                    ApparatusStatus.organization_id == organization_id,
                    ApparatusStatus.organization_id.is_(None)
                )
            )
        else:
            conditions.append(ApparatusStatus.organization_id == organization_id)

        if is_active is not None:
            conditions.append(ApparatusStatus.is_active == is_active)

        query = (
            select(ApparatusStatus)
            .where(and_(*conditions))
            .order_by(ApparatusStatus.sort_order, ApparatusStatus.name)
        )

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def update_apparatus_status(
        self,
        status_id: str,
        status_data: ApparatusStatusUpdate,
        organization_id: str,
    ) -> Optional[ApparatusStatus]:
        """Update apparatus status"""
        apparatus_status = await self.get_apparatus_status(status_id, organization_id)
        if not apparatus_status:
            return None

        if apparatus_status.is_system:
            raise ValueError("Cannot modify system apparatus statuses")

        if status_data.code and status_data.code != apparatus_status.code:
            result = await self.db.execute(
                select(ApparatusStatus)
                .where(
                    or_(
                        ApparatusStatus.organization_id == organization_id,
                        ApparatusStatus.organization_id.is_(None)
                    )
                )
                .where(ApparatusStatus.code == status_data.code)
                .where(ApparatusStatus.id != status_id)
            )
            if result.scalar_one_or_none():
                raise ValueError(f"Apparatus status with code '{status_data.code}' already exists")

        update_data = status_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(apparatus_status, field, value)

        await self.db.commit()
        await self.db.refresh(apparatus_status)

        return apparatus_status

    async def delete_apparatus_status(
        self, status_id: str, organization_id: str
    ) -> bool:
        """Delete apparatus status"""
        apparatus_status = await self.get_apparatus_status(status_id, organization_id)
        if not apparatus_status:
            return False

        if apparatus_status.is_system:
            raise ValueError("Cannot delete system apparatus statuses")

        result = await self.db.execute(
            select(func.count(Apparatus.id))
            .where(Apparatus.status_id == status_id)
        )
        count = result.scalar()
        if count > 0:
            raise ValueError(f"Cannot delete status. {count} apparatus use this status.")

        await self.db.delete(apparatus_status)
        await self.db.commit()

        return True

    # =========================================================================
    # Main Apparatus Methods
    # =========================================================================

    async def create_apparatus(
        self,
        apparatus_data: ApparatusCreate,
        organization_id: str,
        created_by: str,
    ) -> Apparatus:
        """Create a new apparatus"""
        # Check unit number uniqueness
        result = await self.db.execute(
            select(Apparatus)
            .where(Apparatus.organization_id == organization_id)
            .where(Apparatus.unit_number == apparatus_data.unit_number)
        )
        if result.scalar_one_or_none():
            raise ValueError(f"Apparatus with unit number '{apparatus_data.unit_number}' already exists")

        # Verify type exists
        apparatus_type = await self.get_apparatus_type(apparatus_data.apparatus_type_id, organization_id)
        if not apparatus_type:
            raise ValueError("Invalid apparatus type")

        # Verify status exists
        status = await self.get_apparatus_status(apparatus_data.status_id, organization_id)
        if not status:
            raise ValueError("Invalid apparatus status")

        apparatus = Apparatus(
            organization_id=organization_id,
            created_by=created_by,
            status_changed_at=datetime.utcnow(),
            status_changed_by=created_by,
            **apparatus_data.model_dump()
        )

        self.db.add(apparatus)
        await self.db.commit()
        await self.db.refresh(apparatus)

        # Create initial status history entry
        status_history = ApparatusStatusHistory(
            organization_id=organization_id,
            apparatus_id=apparatus.id,
            status_id=apparatus_data.status_id,
            changed_at=datetime.utcnow(),
            changed_by=created_by,
            reason="Initial status on creation",
        )
        self.db.add(status_history)

        # Create initial location history if station assigned
        if apparatus_data.primary_station_id:
            location_history = ApparatusLocationHistory(
                organization_id=organization_id,
                apparatus_id=apparatus.id,
                location_id=apparatus_data.primary_station_id,
                assigned_date=datetime.utcnow(),
                assignment_reason="Initial station assignment",
                created_by=created_by,
            )
            self.db.add(location_history)

        await self.db.commit()

        return apparatus

    async def get_apparatus(
        self,
        apparatus_id: str,
        organization_id: str,
        include_relations: bool = True,
    ) -> Optional[Apparatus]:
        """Get apparatus by ID"""
        query = (
            select(Apparatus)
            .where(Apparatus.id == apparatus_id)
            .where(Apparatus.organization_id == organization_id)
        )

        if include_relations:
            query = query.options(
                selectinload(Apparatus.apparatus_type),
                selectinload(Apparatus.status_record),
                selectinload(Apparatus.primary_station),
            )

        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def list_apparatus(
        self,
        organization_id: str,
        filters: Optional[ApparatusListFilters] = None,
        skip: int = 0,
        limit: int = 100,
        include_relations: bool = True,
    ) -> Tuple[List[Apparatus], int]:
        """List apparatus with filtering and pagination"""
        conditions = [Apparatus.organization_id == organization_id]

        if filters:
            if filters.apparatus_type_id:
                conditions.append(Apparatus.apparatus_type_id == filters.apparatus_type_id)
            if filters.status_id:
                conditions.append(Apparatus.status_id == filters.status_id)
            if filters.primary_station_id:
                conditions.append(Apparatus.primary_station_id == filters.primary_station_id)
            if filters.is_archived is not None:
                conditions.append(Apparatus.is_archived == filters.is_archived)
            if filters.year_min:
                conditions.append(Apparatus.year >= filters.year_min)
            if filters.year_max:
                conditions.append(Apparatus.year <= filters.year_max)
            if filters.make:
                conditions.append(Apparatus.make.ilike(f"%{filters.make}%"))
            if filters.search:
                search_term = f"%{filters.search}%"
                conditions.append(
                    or_(
                        Apparatus.unit_number.ilike(search_term),
                        Apparatus.name.ilike(search_term),
                        Apparatus.vin.ilike(search_term),
                    )
                )

        # Count query
        count_query = select(func.count(Apparatus.id)).where(and_(*conditions))
        count_result = await self.db.execute(count_query)
        total = count_result.scalar()

        # Main query
        query = (
            select(Apparatus)
            .where(and_(*conditions))
            .order_by(Apparatus.unit_number)
            .offset(skip)
            .limit(limit)
        )

        if include_relations:
            query = query.options(
                selectinload(Apparatus.apparatus_type),
                selectinload(Apparatus.status_record),
            )

        result = await self.db.execute(query)
        items = list(result.scalars().all())

        return items, total

    async def update_apparatus(
        self,
        apparatus_id: str,
        apparatus_data: ApparatusUpdate,
        organization_id: str,
        updated_by: str,
    ) -> Optional[Apparatus]:
        """Update apparatus"""
        apparatus = await self.get_apparatus(apparatus_id, organization_id, include_relations=False)
        if not apparatus:
            return None

        # Check unit number uniqueness if changing
        if apparatus_data.unit_number and apparatus_data.unit_number != apparatus.unit_number:
            result = await self.db.execute(
                select(Apparatus)
                .where(Apparatus.organization_id == organization_id)
                .where(Apparatus.unit_number == apparatus_data.unit_number)
                .where(Apparatus.id != apparatus_id)
            )
            if result.scalar_one_or_none():
                raise ValueError(f"Apparatus with unit number '{apparatus_data.unit_number}' already exists")

        # Track status change
        if apparatus_data.status_id and apparatus_data.status_id != apparatus.status_id:
            status_history = ApparatusStatusHistory(
                organization_id=organization_id,
                apparatus_id=apparatus_id,
                status_id=apparatus_data.status_id,
                changed_at=datetime.utcnow(),
                changed_by=updated_by,
                reason=apparatus_data.status_reason,
                mileage_at_change=apparatus.current_mileage,
                hours_at_change=apparatus.current_hours,
            )
            self.db.add(status_history)
            apparatus.status_changed_at = datetime.utcnow()
            apparatus.status_changed_by = updated_by

        # Track station change
        if apparatus_data.primary_station_id and apparatus_data.primary_station_id != apparatus.primary_station_id:
            # Close previous location history
            result = await self.db.execute(
                select(ApparatusLocationHistory)
                .where(ApparatusLocationHistory.apparatus_id == apparatus_id)
                .where(ApparatusLocationHistory.unassigned_date.is_(None))
            )
            current_location = result.scalar_one_or_none()
            if current_location:
                current_location.unassigned_date = datetime.utcnow()

            # Create new location history
            location_history = ApparatusLocationHistory(
                organization_id=organization_id,
                apparatus_id=apparatus_id,
                location_id=apparatus_data.primary_station_id,
                assigned_date=datetime.utcnow(),
                created_by=updated_by,
            )
            self.db.add(location_history)

        # Track mileage/hours updates
        if apparatus_data.current_mileage is not None:
            apparatus.mileage_updated_at = datetime.utcnow()
        if apparatus_data.current_hours is not None:
            apparatus.hours_updated_at = datetime.utcnow()
        if apparatus_data.current_value is not None:
            apparatus.value_updated_at = datetime.utcnow()

        update_data = apparatus_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(apparatus, field, value)

        await self.db.commit()
        await self.db.refresh(apparatus)

        return apparatus

    async def change_apparatus_status(
        self,
        apparatus_id: str,
        status_change: ApparatusStatusChange,
        organization_id: str,
        changed_by: str,
    ) -> Optional[Apparatus]:
        """Change apparatus status with tracking"""
        apparatus = await self.get_apparatus(apparatus_id, organization_id, include_relations=False)
        if not apparatus:
            return None

        # Verify new status
        status = await self.get_apparatus_status(status_change.status_id, organization_id)
        if not status:
            raise ValueError("Invalid status")

        # Check if reason required
        if status.requires_reason and not status_change.reason:
            raise ValueError(f"Reason required when setting status to '{status.name}'")

        # Create status history
        status_history = ApparatusStatusHistory(
            organization_id=organization_id,
            apparatus_id=apparatus_id,
            status_id=status_change.status_id,
            changed_at=datetime.utcnow(),
            changed_by=changed_by,
            reason=status_change.reason,
            mileage_at_change=status_change.current_mileage or apparatus.current_mileage,
            hours_at_change=status_change.current_hours or apparatus.current_hours,
        )
        self.db.add(status_history)

        # Update apparatus
        apparatus.status_id = status_change.status_id
        apparatus.status_reason = status_change.reason
        apparatus.status_changed_at = datetime.utcnow()
        apparatus.status_changed_by = changed_by

        if status_change.current_mileage is not None:
            apparatus.current_mileage = status_change.current_mileage
            apparatus.mileage_updated_at = datetime.utcnow()
        if status_change.current_hours is not None:
            apparatus.current_hours = status_change.current_hours
            apparatus.hours_updated_at = datetime.utcnow()

        await self.db.commit()
        await self.db.refresh(apparatus)

        return apparatus

    async def archive_apparatus(
        self,
        apparatus_id: str,
        archive_data: ApparatusArchive,
        organization_id: str,
        archived_by: str,
    ) -> Optional[Apparatus]:
        """Archive apparatus (sold/disposed)"""
        apparatus = await self.get_apparatus(apparatus_id, organization_id, include_relations=False)
        if not apparatus:
            return None

        if apparatus.is_archived:
            raise ValueError("Apparatus is already archived")

        # Find archived status (sold or disposed)
        result = await self.db.execute(
            select(ApparatusStatus)
            .where(
                or_(
                    ApparatusStatus.organization_id == organization_id,
                    ApparatusStatus.organization_id.is_(None)
                )
            )
            .where(ApparatusStatus.is_archived_status == True)
            .where(ApparatusStatus.is_active == True)
        )
        archived_status = result.scalars().first()

        if not archived_status:
            raise ValueError("No archived status found. Please create an archived status first.")

        # Update apparatus
        apparatus.is_archived = True
        apparatus.archived_at = datetime.utcnow()
        apparatus.archived_by = archived_by
        apparatus.status_id = archived_status.id
        apparatus.status_changed_at = datetime.utcnow()
        apparatus.status_changed_by = archived_by

        apparatus.disposal_method = archive_data.disposal_method
        apparatus.disposal_reason = archive_data.disposal_reason
        apparatus.disposal_date = archive_data.disposal_date or date.today()
        apparatus.disposal_notes = archive_data.disposal_notes

        if archive_data.sold_date:
            apparatus.sold_date = archive_data.sold_date
        if archive_data.sold_price:
            apparatus.sold_price = archive_data.sold_price
        if archive_data.sold_to:
            apparatus.sold_to = archive_data.sold_to
        if archive_data.sold_to_contact:
            apparatus.sold_to_contact = archive_data.sold_to_contact

        # Create status history
        status_history = ApparatusStatusHistory(
            organization_id=organization_id,
            apparatus_id=apparatus_id,
            status_id=archived_status.id,
            changed_at=datetime.utcnow(),
            changed_by=archived_by,
            reason=f"Archived: {archive_data.disposal_method} - {archive_data.disposal_reason or 'No reason provided'}",
            mileage_at_change=apparatus.current_mileage,
            hours_at_change=apparatus.current_hours,
        )
        self.db.add(status_history)

        # Close location history
        result = await self.db.execute(
            select(ApparatusLocationHistory)
            .where(ApparatusLocationHistory.apparatus_id == apparatus_id)
            .where(ApparatusLocationHistory.unassigned_date.is_(None))
        )
        current_location = result.scalar_one_or_none()
        if current_location:
            current_location.unassigned_date = datetime.utcnow()

        await self.db.commit()
        await self.db.refresh(apparatus)

        return apparatus

    async def delete_apparatus(
        self, apparatus_id: str, organization_id: str
    ) -> bool:
        """Delete apparatus (hard delete - use archive for soft delete)"""
        apparatus = await self.get_apparatus(apparatus_id, organization_id, include_relations=False)
        if not apparatus:
            return False

        await self.db.delete(apparatus)
        await self.db.commit()

        return True

    # =========================================================================
    # Custom Field Methods
    # =========================================================================

    async def create_custom_field(
        self,
        field_data: ApparatusCustomFieldCreate,
        organization_id: str,
        created_by: str,
    ) -> ApparatusCustomField:
        """Create a custom field definition"""
        result = await self.db.execute(
            select(ApparatusCustomField)
            .where(ApparatusCustomField.organization_id == organization_id)
            .where(ApparatusCustomField.field_key == field_data.field_key)
        )
        if result.scalar_one_or_none():
            raise ValueError(f"Custom field with key '{field_data.field_key}' already exists")

        custom_field = ApparatusCustomField(
            organization_id=organization_id,
            created_by=created_by,
            **field_data.model_dump()
        )

        self.db.add(custom_field)
        await self.db.commit()
        await self.db.refresh(custom_field)

        return custom_field

    async def get_custom_field(
        self, field_id: str, organization_id: str
    ) -> Optional[ApparatusCustomField]:
        """Get custom field by ID"""
        result = await self.db.execute(
            select(ApparatusCustomField)
            .where(ApparatusCustomField.id == field_id)
            .where(ApparatusCustomField.organization_id == organization_id)
        )
        return result.scalar_one_or_none()

    async def list_custom_fields(
        self,
        organization_id: str,
        is_active: Optional[bool] = True,
        apparatus_type_id: Optional[str] = None,
    ) -> List[ApparatusCustomField]:
        """List custom fields"""
        conditions = [ApparatusCustomField.organization_id == organization_id]

        if is_active is not None:
            conditions.append(ApparatusCustomField.is_active == is_active)

        query = (
            select(ApparatusCustomField)
            .where(and_(*conditions))
            .order_by(ApparatusCustomField.sort_order, ApparatusCustomField.name)
        )

        result = await self.db.execute(query)
        fields = list(result.scalars().all())

        # Filter by apparatus type if specified
        if apparatus_type_id:
            fields = [
                f for f in fields
                if f.applies_to_types is None or apparatus_type_id in f.applies_to_types
            ]

        return fields

    async def update_custom_field(
        self,
        field_id: str,
        field_data: ApparatusCustomFieldUpdate,
        organization_id: str,
    ) -> Optional[ApparatusCustomField]:
        """Update custom field"""
        custom_field = await self.get_custom_field(field_id, organization_id)
        if not custom_field:
            return None

        if field_data.field_key and field_data.field_key != custom_field.field_key:
            result = await self.db.execute(
                select(ApparatusCustomField)
                .where(ApparatusCustomField.organization_id == organization_id)
                .where(ApparatusCustomField.field_key == field_data.field_key)
                .where(ApparatusCustomField.id != field_id)
            )
            if result.scalar_one_or_none():
                raise ValueError(f"Custom field with key '{field_data.field_key}' already exists")

        update_data = field_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(custom_field, field, value)

        await self.db.commit()
        await self.db.refresh(custom_field)

        return custom_field

    async def delete_custom_field(
        self, field_id: str, organization_id: str
    ) -> bool:
        """Delete custom field"""
        custom_field = await self.get_custom_field(field_id, organization_id)
        if not custom_field:
            return False

        await self.db.delete(custom_field)
        await self.db.commit()

        return True

    # =========================================================================
    # Maintenance Type Methods
    # =========================================================================

    async def create_maintenance_type(
        self,
        type_data: ApparatusMaintenanceTypeCreate,
        organization_id: str,
    ) -> ApparatusMaintenanceType:
        """Create maintenance type"""
        result = await self.db.execute(
            select(ApparatusMaintenanceType)
            .where(
                or_(
                    ApparatusMaintenanceType.organization_id == organization_id,
                    ApparatusMaintenanceType.organization_id.is_(None)
                )
            )
            .where(ApparatusMaintenanceType.code == type_data.code)
        )
        if result.scalar_one_or_none():
            raise ValueError(f"Maintenance type with code '{type_data.code}' already exists")

        maintenance_type = ApparatusMaintenanceType(
            organization_id=organization_id,
            is_system=False,
            **type_data.model_dump()
        )

        self.db.add(maintenance_type)
        await self.db.commit()
        await self.db.refresh(maintenance_type)

        return maintenance_type

    async def get_maintenance_type(
        self, type_id: str, organization_id: str
    ) -> Optional[ApparatusMaintenanceType]:
        """Get maintenance type by ID"""
        result = await self.db.execute(
            select(ApparatusMaintenanceType)
            .where(ApparatusMaintenanceType.id == type_id)
            .where(
                or_(
                    ApparatusMaintenanceType.organization_id == organization_id,
                    ApparatusMaintenanceType.organization_id.is_(None)
                )
            )
        )
        return result.scalar_one_or_none()

    async def list_maintenance_types(
        self,
        organization_id: str,
        is_active: Optional[bool] = True,
        include_system: bool = True,
    ) -> List[ApparatusMaintenanceType]:
        """List maintenance types"""
        conditions = []

        if include_system:
            conditions.append(
                or_(
                    ApparatusMaintenanceType.organization_id == organization_id,
                    ApparatusMaintenanceType.organization_id.is_(None)
                )
            )
        else:
            conditions.append(ApparatusMaintenanceType.organization_id == organization_id)

        if is_active is not None:
            conditions.append(ApparatusMaintenanceType.is_active == is_active)

        query = (
            select(ApparatusMaintenanceType)
            .where(and_(*conditions))
            .order_by(ApparatusMaintenanceType.sort_order, ApparatusMaintenanceType.name)
        )

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def update_maintenance_type(
        self,
        type_id: str,
        type_data: ApparatusMaintenanceTypeUpdate,
        organization_id: str,
    ) -> Optional[ApparatusMaintenanceType]:
        """Update maintenance type"""
        maintenance_type = await self.get_maintenance_type(type_id, organization_id)
        if not maintenance_type:
            return None

        if maintenance_type.is_system:
            raise ValueError("Cannot modify system maintenance types")

        if type_data.code and type_data.code != maintenance_type.code:
            result = await self.db.execute(
                select(ApparatusMaintenanceType)
                .where(
                    or_(
                        ApparatusMaintenanceType.organization_id == organization_id,
                        ApparatusMaintenanceType.organization_id.is_(None)
                    )
                )
                .where(ApparatusMaintenanceType.code == type_data.code)
                .where(ApparatusMaintenanceType.id != type_id)
            )
            if result.scalar_one_or_none():
                raise ValueError(f"Maintenance type with code '{type_data.code}' already exists")

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
            select(func.count(ApparatusMaintenance.id))
            .where(ApparatusMaintenance.maintenance_type_id == type_id)
        )
        count = result.scalar()
        if count > 0:
            raise ValueError(f"Cannot delete type. {count} maintenance records use this type.")

        await self.db.delete(maintenance_type)
        await self.db.commit()

        return True

    # =========================================================================
    # Maintenance Record Methods
    # =========================================================================

    async def create_maintenance_record(
        self,
        maintenance_data: ApparatusMaintenanceCreate,
        organization_id: str,
        created_by: str,
    ) -> ApparatusMaintenance:
        """Create maintenance record"""
        # Verify apparatus
        apparatus = await self.get_apparatus(maintenance_data.apparatus_id, organization_id, include_relations=False)
        if not apparatus:
            raise ValueError("Invalid apparatus")

        # Verify maintenance type
        maint_type = await self.get_maintenance_type(maintenance_data.maintenance_type_id, organization_id)
        if not maint_type:
            raise ValueError("Invalid maintenance type")

        maintenance = ApparatusMaintenance(
            organization_id=organization_id,
            created_by=created_by,
            **maintenance_data.model_dump()
        )

        # Check if overdue
        if maintenance.due_date and maintenance.due_date < date.today() and not maintenance.is_completed:
            maintenance.is_overdue = True

        self.db.add(maintenance)
        await self.db.commit()
        await self.db.refresh(maintenance)

        return maintenance

    async def get_maintenance_record(
        self, record_id: str, organization_id: str
    ) -> Optional[ApparatusMaintenance]:
        """Get maintenance record by ID"""
        result = await self.db.execute(
            select(ApparatusMaintenance)
            .where(ApparatusMaintenance.id == record_id)
            .where(ApparatusMaintenance.organization_id == organization_id)
            .options(selectinload(ApparatusMaintenance.maintenance_type))
        )
        return result.scalar_one_or_none()

    async def list_maintenance_records(
        self,
        organization_id: str,
        apparatus_id: Optional[str] = None,
        maintenance_type_id: Optional[str] = None,
        is_completed: Optional[bool] = None,
        is_overdue: Optional[bool] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> List[ApparatusMaintenance]:
        """List maintenance records"""
        conditions = [ApparatusMaintenance.organization_id == organization_id]

        if apparatus_id:
            conditions.append(ApparatusMaintenance.apparatus_id == apparatus_id)
        if maintenance_type_id:
            conditions.append(ApparatusMaintenance.maintenance_type_id == maintenance_type_id)
        if is_completed is not None:
            conditions.append(ApparatusMaintenance.is_completed == is_completed)
        if is_overdue is not None:
            conditions.append(ApparatusMaintenance.is_overdue == is_overdue)

        query = (
            select(ApparatusMaintenance)
            .where(and_(*conditions))
            .options(selectinload(ApparatusMaintenance.maintenance_type))
            .order_by(desc(ApparatusMaintenance.created_at))
            .offset(skip)
            .limit(limit)
        )

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def update_maintenance_record(
        self,
        record_id: str,
        maintenance_data: ApparatusMaintenanceUpdate,
        organization_id: str,
        updated_by: str,
    ) -> Optional[ApparatusMaintenance]:
        """Update maintenance record"""
        maintenance = await self.get_maintenance_record(record_id, organization_id)
        if not maintenance:
            return None

        update_data = maintenance_data.model_dump(exclude_unset=True)

        # Handle completion
        if "is_completed" in update_data and update_data["is_completed"] and not maintenance.is_completed:
            maintenance.completed_by = updated_by
            if not maintenance.completed_date:
                maintenance.completed_date = date.today()
            maintenance.is_overdue = False

        for field, value in update_data.items():
            setattr(maintenance, field, value)

        # Recheck overdue status
        if maintenance.due_date and maintenance.due_date < date.today() and not maintenance.is_completed:
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

    async def get_maintenance_due(
        self,
        organization_id: str,
        days_ahead: int = 30,
        include_overdue: bool = True,
    ) -> List[Dict[str, Any]]:
        """Get maintenance due within specified days"""
        due_date_threshold = date.today() + timedelta(days=days_ahead)

        conditions = [
            ApparatusMaintenance.organization_id == organization_id,
            ApparatusMaintenance.is_completed == False,
        ]

        if include_overdue:
            conditions.append(
                or_(
                    ApparatusMaintenance.due_date <= due_date_threshold,
                    ApparatusMaintenance.is_overdue == True,
                )
            )
        else:
            conditions.append(ApparatusMaintenance.due_date <= due_date_threshold)
            conditions.append(ApparatusMaintenance.due_date >= date.today())

        query = (
            select(ApparatusMaintenance)
            .where(and_(*conditions))
            .options(
                selectinload(ApparatusMaintenance.maintenance_type),
                selectinload(ApparatusMaintenance.apparatus),
            )
            .order_by(ApparatusMaintenance.due_date)
        )

        result = await self.db.execute(query)
        records = list(result.scalars().all())

        return [
            {
                "id": r.id,
                "apparatus_id": r.apparatus_id,
                "apparatus_unit_number": r.apparatus.unit_number if r.apparatus else None,
                "maintenance_type_name": r.maintenance_type.name if r.maintenance_type else None,
                "due_date": r.due_date,
                "is_overdue": r.is_overdue,
            }
            for r in records
        ]

    # =========================================================================
    # Fuel Log Methods
    # =========================================================================

    async def create_fuel_log(
        self,
        fuel_data: ApparatusFuelLogCreate,
        organization_id: str,
        recorded_by: str,
    ) -> ApparatusFuelLog:
        """Create fuel log entry"""
        apparatus = await self.get_apparatus(fuel_data.apparatus_id, organization_id, include_relations=False)
        if not apparatus:
            raise ValueError("Invalid apparatus")

        fuel_log = ApparatusFuelLog(
            organization_id=organization_id,
            recorded_by=recorded_by,
            **fuel_data.model_dump()
        )

        self.db.add(fuel_log)

        # Update apparatus mileage/hours if provided
        if fuel_data.mileage_at_fill:
            apparatus.current_mileage = fuel_data.mileage_at_fill
            apparatus.mileage_updated_at = datetime.utcnow()
        if fuel_data.hours_at_fill:
            apparatus.current_hours = fuel_data.hours_at_fill
            apparatus.hours_updated_at = datetime.utcnow()

        await self.db.commit()
        await self.db.refresh(fuel_log)

        return fuel_log

    async def list_fuel_logs(
        self,
        organization_id: str,
        apparatus_id: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> List[ApparatusFuelLog]:
        """List fuel log entries"""
        conditions = [ApparatusFuelLog.organization_id == organization_id]

        if apparatus_id:
            conditions.append(ApparatusFuelLog.apparatus_id == apparatus_id)
        if start_date:
            conditions.append(ApparatusFuelLog.fuel_date >= start_date)
        if end_date:
            conditions.append(ApparatusFuelLog.fuel_date <= end_date)

        query = (
            select(ApparatusFuelLog)
            .where(and_(*conditions))
            .order_by(desc(ApparatusFuelLog.fuel_date))
            .offset(skip)
            .limit(limit)
        )

        result = await self.db.execute(query)
        return list(result.scalars().all())

    # =========================================================================
    # Operator Methods
    # =========================================================================

    async def create_operator(
        self,
        operator_data: ApparatusOperatorCreate,
        organization_id: str,
        created_by: str,
    ) -> ApparatusOperator:
        """Create operator certification"""
        # Check if already exists
        result = await self.db.execute(
            select(ApparatusOperator)
            .where(ApparatusOperator.apparatus_id == operator_data.apparatus_id)
            .where(ApparatusOperator.user_id == operator_data.user_id)
        )
        if result.scalar_one_or_none():
            raise ValueError("Operator already assigned to this apparatus")

        operator = ApparatusOperator(
            organization_id=organization_id,
            created_by=created_by,
            **operator_data.model_dump()
        )

        self.db.add(operator)
        await self.db.commit()
        await self.db.refresh(operator)

        return operator

    async def list_operators(
        self,
        organization_id: str,
        apparatus_id: Optional[str] = None,
        user_id: Optional[str] = None,
        is_active: Optional[bool] = True,
    ) -> List[ApparatusOperator]:
        """List operators"""
        conditions = [ApparatusOperator.organization_id == organization_id]

        if apparatus_id:
            conditions.append(ApparatusOperator.apparatus_id == apparatus_id)
        if user_id:
            conditions.append(ApparatusOperator.user_id == user_id)
        if is_active is not None:
            conditions.append(ApparatusOperator.is_active == is_active)

        query = (
            select(ApparatusOperator)
            .where(and_(*conditions))
            .options(selectinload(ApparatusOperator.user))
        )

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def update_operator(
        self,
        operator_id: str,
        operator_data: ApparatusOperatorUpdate,
        organization_id: str,
    ) -> Optional[ApparatusOperator]:
        """Update operator"""
        result = await self.db.execute(
            select(ApparatusOperator)
            .where(ApparatusOperator.id == operator_id)
            .where(ApparatusOperator.organization_id == organization_id)
        )
        operator = result.scalar_one_or_none()
        if not operator:
            return None

        update_data = operator_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(operator, field, value)

        await self.db.commit()
        await self.db.refresh(operator)

        return operator

    async def delete_operator(
        self, operator_id: str, organization_id: str
    ) -> bool:
        """Delete operator"""
        result = await self.db.execute(
            select(ApparatusOperator)
            .where(ApparatusOperator.id == operator_id)
            .where(ApparatusOperator.organization_id == organization_id)
        )
        operator = result.scalar_one_or_none()
        if not operator:
            return False

        await self.db.delete(operator)
        await self.db.commit()

        return True

    # =========================================================================
    # Equipment Methods
    # =========================================================================

    async def create_equipment(
        self,
        equipment_data: ApparatusEquipmentCreate,
        organization_id: str,
        assigned_by: str,
    ) -> ApparatusEquipment:
        """Create equipment assignment"""
        equipment = ApparatusEquipment(
            organization_id=organization_id,
            assigned_by=assigned_by,
            **equipment_data.model_dump()
        )

        self.db.add(equipment)
        await self.db.commit()
        await self.db.refresh(equipment)

        return equipment

    async def list_equipment(
        self,
        organization_id: str,
        apparatus_id: Optional[str] = None,
        is_present: Optional[bool] = None,
    ) -> List[ApparatusEquipment]:
        """List equipment"""
        conditions = [ApparatusEquipment.organization_id == organization_id]

        if apparatus_id:
            conditions.append(ApparatusEquipment.apparatus_id == apparatus_id)
        if is_present is not None:
            conditions.append(ApparatusEquipment.is_present == is_present)

        query = (
            select(ApparatusEquipment)
            .where(and_(*conditions))
            .order_by(ApparatusEquipment.name)
        )

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def update_equipment(
        self,
        equipment_id: str,
        equipment_data: ApparatusEquipmentUpdate,
        organization_id: str,
    ) -> Optional[ApparatusEquipment]:
        """Update equipment"""
        result = await self.db.execute(
            select(ApparatusEquipment)
            .where(ApparatusEquipment.id == equipment_id)
            .where(ApparatusEquipment.organization_id == organization_id)
        )
        equipment = result.scalar_one_or_none()
        if not equipment:
            return None

        update_data = equipment_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(equipment, field, value)

        await self.db.commit()
        await self.db.refresh(equipment)

        return equipment

    async def delete_equipment(
        self, equipment_id: str, organization_id: str
    ) -> bool:
        """Delete equipment"""
        result = await self.db.execute(
            select(ApparatusEquipment)
            .where(ApparatusEquipment.id == equipment_id)
            .where(ApparatusEquipment.organization_id == organization_id)
        )
        equipment = result.scalar_one_or_none()
        if not equipment:
            return False

        await self.db.delete(equipment)
        await self.db.commit()

        return True

    # =========================================================================
    # Photo/Document Methods
    # =========================================================================

    async def create_photo(
        self,
        photo_data: ApparatusPhotoCreate,
        organization_id: str,
        uploaded_by: str,
    ) -> ApparatusPhoto:
        """Create photo"""
        # If setting as primary, unset other primary photos
        if photo_data.is_primary:
            await self.db.execute(
                select(ApparatusPhoto)
                .where(ApparatusPhoto.apparatus_id == photo_data.apparatus_id)
                .where(ApparatusPhoto.is_primary == True)
            )
            result = await self.db.execute(
                select(ApparatusPhoto)
                .where(ApparatusPhoto.apparatus_id == photo_data.apparatus_id)
                .where(ApparatusPhoto.is_primary == True)
            )
            for photo in result.scalars().all():
                photo.is_primary = False

        photo = ApparatusPhoto(
            organization_id=organization_id,
            uploaded_by=uploaded_by,
            **photo_data.model_dump()
        )

        self.db.add(photo)
        await self.db.commit()
        await self.db.refresh(photo)

        return photo

    async def list_photos(
        self, organization_id: str, apparatus_id: str
    ) -> List[ApparatusPhoto]:
        """List photos for apparatus"""
        query = (
            select(ApparatusPhoto)
            .where(ApparatusPhoto.apparatus_id == apparatus_id)
            .where(ApparatusPhoto.organization_id == organization_id)
            .order_by(desc(ApparatusPhoto.is_primary), desc(ApparatusPhoto.uploaded_at))
        )

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def delete_photo(
        self, photo_id: str, organization_id: str
    ) -> bool:
        """Delete photo"""
        result = await self.db.execute(
            select(ApparatusPhoto)
            .where(ApparatusPhoto.id == photo_id)
            .where(ApparatusPhoto.organization_id == organization_id)
        )
        photo = result.scalar_one_or_none()
        if not photo:
            return False

        await self.db.delete(photo)
        await self.db.commit()

        return True

    async def create_document(
        self,
        document_data: ApparatusDocumentCreate,
        organization_id: str,
        uploaded_by: str,
    ) -> ApparatusDocument:
        """Create document"""
        document = ApparatusDocument(
            organization_id=organization_id,
            uploaded_by=uploaded_by,
            **document_data.model_dump()
        )

        self.db.add(document)
        await self.db.commit()
        await self.db.refresh(document)

        return document

    async def list_documents(
        self, organization_id: str, apparatus_id: str
    ) -> List[ApparatusDocument]:
        """List documents for apparatus"""
        query = (
            select(ApparatusDocument)
            .where(ApparatusDocument.apparatus_id == apparatus_id)
            .where(ApparatusDocument.organization_id == organization_id)
            .order_by(ApparatusDocument.document_type, desc(ApparatusDocument.uploaded_at))
        )

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def delete_document(
        self, document_id: str, organization_id: str
    ) -> bool:
        """Delete document"""
        result = await self.db.execute(
            select(ApparatusDocument)
            .where(ApparatusDocument.id == document_id)
            .where(ApparatusDocument.organization_id == organization_id)
        )
        document = result.scalar_one_or_none()
        if not document:
            return False

        await self.db.delete(document)
        await self.db.commit()

        return True

    # =========================================================================
    # Fleet Summary/Dashboard Methods
    # =========================================================================

    async def get_fleet_summary(
        self, organization_id: str
    ) -> Dict[str, Any]:
        """Get fleet summary for dashboard"""
        # Total counts by status
        status_counts_query = (
            select(
                ApparatusStatus.name,
                ApparatusStatus.code,
                func.count(Apparatus.id).label("count")
            )
            .join(Apparatus, Apparatus.status_id == ApparatusStatus.id)
            .where(Apparatus.organization_id == organization_id)
            .group_by(ApparatusStatus.id)
        )
        status_result = await self.db.execute(status_counts_query)
        status_counts = {row[1]: row[2] for row in status_result.all()}

        # Total counts by type
        type_counts_query = (
            select(
                ApparatusType.name,
                func.count(Apparatus.id).label("count")
            )
            .join(Apparatus, Apparatus.apparatus_type_id == ApparatusType.id)
            .where(Apparatus.organization_id == organization_id)
            .where(Apparatus.is_archived == False)
            .group_by(ApparatusType.id)
        )
        type_result = await self.db.execute(type_counts_query)
        type_counts = {row[0]: row[1] for row in type_result.all()}

        # Total apparatus
        total_query = select(func.count(Apparatus.id)).where(
            Apparatus.organization_id == organization_id
        )
        total_result = await self.db.execute(total_query)
        total = total_result.scalar()

        # Archived count
        archived_query = select(func.count(Apparatus.id)).where(
            Apparatus.organization_id == organization_id,
            Apparatus.is_archived == True
        )
        archived_result = await self.db.execute(archived_query)
        archived = archived_result.scalar()

        # Maintenance due soon (30 days)
        maintenance_due = await self.get_maintenance_due(organization_id, days_ahead=30)
        maintenance_overdue = [m for m in maintenance_due if m["is_overdue"]]

        # Expiring items (30 days)
        expiration_date = date.today() + timedelta(days=30)

        reg_expiring_query = select(func.count(Apparatus.id)).where(
            Apparatus.organization_id == organization_id,
            Apparatus.is_archived == False,
            Apparatus.registration_expiration <= expiration_date,
            Apparatus.registration_expiration >= date.today()
        )
        reg_result = await self.db.execute(reg_expiring_query)
        reg_expiring = reg_result.scalar()

        insp_expiring_query = select(func.count(Apparatus.id)).where(
            Apparatus.organization_id == organization_id,
            Apparatus.is_archived == False,
            Apparatus.inspection_expiration <= expiration_date,
            Apparatus.inspection_expiration >= date.today()
        )
        insp_result = await self.db.execute(insp_expiring_query)
        insp_expiring = insp_result.scalar()

        ins_expiring_query = select(func.count(Apparatus.id)).where(
            Apparatus.organization_id == organization_id,
            Apparatus.is_archived == False,
            Apparatus.insurance_expiration <= expiration_date,
            Apparatus.insurance_expiration >= date.today()
        )
        ins_result = await self.db.execute(ins_expiring_query)
        ins_expiring = ins_result.scalar()

        return {
            "total_apparatus": total,
            "in_service_count": status_counts.get("in_service", 0),
            "out_of_service_count": status_counts.get("out_of_service", 0),
            "in_maintenance_count": status_counts.get("in_maintenance", 0),
            "reserve_count": status_counts.get("reserve", 0),
            "archived_count": archived,
            "by_type": type_counts,
            "maintenance_due_soon": len(maintenance_due),
            "maintenance_overdue": len(maintenance_overdue),
            "registrations_expiring_soon": reg_expiring,
            "inspections_expiring_soon": insp_expiring,
            "insurance_expiring_soon": ins_expiring,
        }

    # ========================================================================
    # NFPA Compliance
    # ========================================================================

    async def list_nfpa_compliance(
        self,
        organization_id: UUID,
        apparatus_id: Optional[str] = None,
        compliance_status: Optional[str] = None,
    ) -> List[ApparatusNFPACompliance]:
        """List NFPA compliance records"""
        query = select(ApparatusNFPACompliance).where(
            ApparatusNFPACompliance.organization_id == organization_id
        )
        if apparatus_id:
            query = query.where(ApparatusNFPACompliance.apparatus_id == apparatus_id)
        if compliance_status:
            query = query.where(ApparatusNFPACompliance.compliance_status == compliance_status)

        query = query.order_by(ApparatusNFPACompliance.next_due_date.asc().nullslast())
        result = await self.db.execute(query)
        return result.scalars().all()

    async def get_nfpa_compliance(
        self, compliance_id: str, organization_id: UUID
    ) -> Optional[ApparatusNFPACompliance]:
        """Get a specific NFPA compliance record"""
        result = await self.db.execute(
            select(ApparatusNFPACompliance)
            .where(ApparatusNFPACompliance.id == compliance_id)
            .where(ApparatusNFPACompliance.organization_id == organization_id)
        )
        return result.scalar_one_or_none()

    async def create_nfpa_compliance(
        self, compliance_data, organization_id: UUID, checked_by: UUID = None,
    ) -> ApparatusNFPACompliance:
        """Create an NFPA compliance record"""
        # Verify apparatus exists and belongs to org
        apparatus = await self.get_apparatus(
            apparatus_id=compliance_data.apparatus_id,
            organization_id=organization_id,
        )
        if not apparatus:
            raise ValueError("Apparatus not found")

        record = ApparatusNFPACompliance(
            organization_id=organization_id,
            last_checked_by=checked_by,
            **compliance_data.model_dump(),
        )
        self.db.add(record)
        await self.db.commit()
        await self.db.refresh(record)
        return record

    async def update_nfpa_compliance(
        self, compliance_id: str, compliance_data, organization_id: UUID, checked_by: UUID = None,
    ) -> Optional[ApparatusNFPACompliance]:
        """Update an NFPA compliance record"""
        record = await self.get_nfpa_compliance(compliance_id, organization_id)
        if not record:
            return None

        update_data = compliance_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(record, field, value)

        if checked_by:
            record.last_checked_by = checked_by

        await self.db.commit()
        await self.db.refresh(record)
        return record

    async def delete_nfpa_compliance(
        self, compliance_id: str, organization_id: UUID
    ) -> bool:
        """Delete an NFPA compliance record"""
        record = await self.get_nfpa_compliance(compliance_id, organization_id)
        if not record:
            return False

        await self.db.delete(record)
        await self.db.commit()
        return True

    # ========================================================================
    # Report Configs
    # ========================================================================

    async def list_report_configs(
        self,
        organization_id: UUID,
        is_active: Optional[bool] = None,
        report_type: Optional[str] = None,
    ) -> List[ApparatusReportConfig]:
        """List report configurations"""
        query = select(ApparatusReportConfig).where(
            ApparatusReportConfig.organization_id == organization_id
        )
        if is_active is not None:
            query = query.where(ApparatusReportConfig.is_active == is_active)
        if report_type:
            query = query.where(ApparatusReportConfig.report_type == report_type)

        query = query.order_by(ApparatusReportConfig.name)
        result = await self.db.execute(query)
        return result.scalars().all()

    async def get_report_config(
        self, config_id: str, organization_id: UUID
    ) -> Optional[ApparatusReportConfig]:
        """Get a specific report config"""
        result = await self.db.execute(
            select(ApparatusReportConfig)
            .where(ApparatusReportConfig.id == config_id)
            .where(ApparatusReportConfig.organization_id == organization_id)
        )
        return result.scalar_one_or_none()

    async def create_report_config(
        self, config_data, organization_id: UUID, created_by: UUID = None,
    ) -> ApparatusReportConfig:
        """Create a report config"""
        config = ApparatusReportConfig(
            organization_id=organization_id,
            created_by=created_by,
            **config_data.model_dump(),
        )
        self.db.add(config)
        await self.db.commit()
        await self.db.refresh(config)
        return config

    async def update_report_config(
        self, config_id: str, config_data, organization_id: UUID,
    ) -> Optional[ApparatusReportConfig]:
        """Update a report config"""
        config = await self.get_report_config(config_id, organization_id)
        if not config:
            return None

        update_data = config_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(config, field, value)

        await self.db.commit()
        await self.db.refresh(config)
        return config

    async def delete_report_config(
        self, config_id: str, organization_id: UUID
    ) -> bool:
        """Delete a report config"""
        config = await self.get_report_config(config_id, organization_id)
        if not config:
            return False

        await self.db.delete(config)
        await self.db.commit()
        return True
