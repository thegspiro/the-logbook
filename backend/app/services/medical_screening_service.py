"""
Medical Screening Service

Business logic for managing medical screening requirements,
records, and compliance tracking.
"""

from datetime import date, timedelta
from typing import List, Optional

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.utils import generate_uuid
from app.models.medical_screening import (
    ScreeningRecord,
    ScreeningRequirement,
    ScreeningStatus,
)
from app.schemas.medical_screening import (
    ComplianceItem,
    ComplianceSummary,
    ExpiringScreening,
    ScreeningRecordCreate,
    ScreeningRecordUpdate,
    ScreeningRequirementCreate,
    ScreeningRequirementUpdate,
)


class MedicalScreeningService:
    """Service for medical screening operations."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # --- Screening Requirements ---

    async def list_requirements(
        self,
        organization_id: str,
        is_active: Optional[bool] = None,
        screening_type: Optional[str] = None,
    ) -> List[ScreeningRequirement]:
        """List screening requirements for an organization."""
        query = select(ScreeningRequirement).where(
            ScreeningRequirement.organization_id == organization_id
        )
        if is_active is not None:
            query = query.where(ScreeningRequirement.is_active == is_active)
        if screening_type:
            query = query.where(ScreeningRequirement.screening_type == screening_type)
        query = query.order_by(ScreeningRequirement.name)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_requirement(
        self, requirement_id: str, organization_id: str
    ) -> Optional[ScreeningRequirement]:
        """Get a single screening requirement."""
        result = await self.db.execute(
            select(ScreeningRequirement).where(
                and_(
                    ScreeningRequirement.id == requirement_id,
                    ScreeningRequirement.organization_id == organization_id,
                )
            )
        )
        return result.scalar_one_or_none()

    async def create_requirement(
        self,
        organization_id: str,
        data: ScreeningRequirementCreate,
    ) -> ScreeningRequirement:
        """Create a new screening requirement."""
        requirement = ScreeningRequirement(
            id=generate_uuid(),
            organization_id=organization_id,
            name=data.name,
            screening_type=data.screening_type,
            description=data.description,
            frequency_months=data.frequency_months,
            applies_to_roles=data.applies_to_roles,
            is_active=data.is_active,
            grace_period_days=data.grace_period_days,
        )
        self.db.add(requirement)
        await self.db.flush()
        return requirement

    async def update_requirement(
        self,
        requirement_id: str,
        organization_id: str,
        data: ScreeningRequirementUpdate,
    ) -> Optional[ScreeningRequirement]:
        """Update a screening requirement."""
        requirement = await self.get_requirement(requirement_id, organization_id)
        if not requirement:
            return None
        update_data = data.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(requirement, key, value)
        await self.db.flush()
        return requirement

    async def delete_requirement(
        self, requirement_id: str, organization_id: str
    ) -> bool:
        """Delete a screening requirement."""
        requirement = await self.get_requirement(requirement_id, organization_id)
        if not requirement:
            return False
        await self.db.delete(requirement)
        await self.db.flush()
        return True

    # --- Screening Records ---

    async def list_records(
        self,
        organization_id: str,
        user_id: Optional[str] = None,
        prospect_id: Optional[str] = None,
        screening_type: Optional[str] = None,
        status: Optional[str] = None,
    ) -> List[ScreeningRecord]:
        """List screening records with optional filters."""
        query = select(ScreeningRecord).where(
            ScreeningRecord.organization_id == organization_id
        )
        if user_id:
            query = query.where(ScreeningRecord.user_id == user_id)
        if prospect_id:
            query = query.where(ScreeningRecord.prospect_id == prospect_id)
        if screening_type:
            query = query.where(ScreeningRecord.screening_type == screening_type)
        if status:
            query = query.where(ScreeningRecord.status == status)
        query = query.order_by(ScreeningRecord.created_at.desc())
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_record(
        self, record_id: str, organization_id: str
    ) -> Optional[ScreeningRecord]:
        """Get a single screening record."""
        result = await self.db.execute(
            select(ScreeningRecord).where(
                and_(
                    ScreeningRecord.id == record_id,
                    ScreeningRecord.organization_id == organization_id,
                )
            )
        )
        return result.scalar_one_or_none()

    async def create_record(
        self,
        organization_id: str,
        data: ScreeningRecordCreate,
    ) -> ScreeningRecord:
        """Create a new screening record."""
        record = ScreeningRecord(
            id=generate_uuid(),
            organization_id=organization_id,
            requirement_id=data.requirement_id,
            user_id=data.user_id,
            prospect_id=data.prospect_id,
            screening_type=data.screening_type,
            status=data.status,
            scheduled_date=data.scheduled_date,
            completed_date=data.completed_date,
            expiration_date=data.expiration_date,
            provider_name=data.provider_name,
            result_summary=data.result_summary,
            result_data=data.result_data,
            notes=data.notes,
        )
        self.db.add(record)
        await self.db.flush()
        return record

    async def update_record(
        self,
        record_id: str,
        organization_id: str,
        data: ScreeningRecordUpdate,
        reviewed_by: Optional[str] = None,
    ) -> Optional[ScreeningRecord]:
        """Update a screening record."""
        record = await self.get_record(record_id, organization_id)
        if not record:
            return None
        update_data = data.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(record, key, value)
        if reviewed_by and data.status in ("passed", "failed", "waived"):
            from datetime import datetime, timezone

            record.reviewed_by = reviewed_by
            record.reviewed_at = datetime.now(timezone.utc)
        await self.db.flush()
        return record

    async def delete_record(self, record_id: str, organization_id: str) -> bool:
        """Delete a screening record."""
        record = await self.get_record(record_id, organization_id)
        if not record:
            return False
        await self.db.delete(record)
        await self.db.flush()
        return True

    # --- Compliance ---

    async def get_compliance_status(
        self,
        organization_id: str,
        user_id: Optional[str] = None,
        prospect_id: Optional[str] = None,
    ) -> ComplianceSummary:
        """
        Check compliance status for a user or prospect against all
        active screening requirements.
        """
        # Get active requirements
        requirements = await self.list_requirements(organization_id, is_active=True)

        # Get records for this subject
        records = await self.list_records(
            organization_id,
            user_id=user_id,
            prospect_id=prospect_id,
        )

        today = date.today()
        items: List[ComplianceItem] = []
        compliant_count = 0
        expiring_soon_count = 0

        for req in requirements:
            # Find the most recent passing/completed record for this requirement type
            matching_records = [
                r
                for r in records
                if r.screening_type == req.screening_type
                and r.status
                in (
                    ScreeningStatus.PASSED.value,
                    ScreeningStatus.COMPLETED.value,
                    ScreeningStatus.WAIVED.value,
                )
            ]
            matching_records.sort(
                key=lambda r: r.completed_date or date.min, reverse=True
            )

            latest = matching_records[0] if matching_records else None
            is_compliant = False
            days_until_exp = None

            if latest:
                if latest.expiration_date:
                    is_compliant = latest.expiration_date >= today
                    days_until_exp = (latest.expiration_date - today).days
                    if 0 < days_until_exp <= 30:
                        expiring_soon_count += 1
                else:
                    # No expiration = compliant indefinitely
                    is_compliant = True

            if is_compliant:
                compliant_count += 1

            items.append(
                ComplianceItem(
                    requirement_id=req.id,
                    requirement_name=req.name,
                    screening_type=req.screening_type,
                    is_compliant=is_compliant,
                    last_screening_date=(latest.completed_date if latest else None),
                    expiration_date=(latest.expiration_date if latest else None),
                    days_until_expiration=days_until_exp,
                    status=latest.status if latest else None,
                )
            )

        subject_name = ""
        subject_type = "user" if user_id else "prospect"
        subject_id = user_id or prospect_id or ""

        return ComplianceSummary(
            subject_id=subject_id,
            subject_name=subject_name,
            subject_type=subject_type,
            total_requirements=len(requirements),
            compliant_count=compliant_count,
            non_compliant_count=len(requirements) - compliant_count,
            expiring_soon_count=expiring_soon_count,
            is_fully_compliant=compliant_count == len(requirements),
            items=items,
        )

    async def get_expiring_soon(
        self,
        organization_id: str,
        days: int = 30,
    ) -> List[ExpiringScreening]:
        """Find screening records expiring within the given number of days."""
        today = date.today()
        cutoff = today + timedelta(days=days)

        query = (
            select(ScreeningRecord)
            .where(
                and_(
                    ScreeningRecord.organization_id == organization_id,
                    ScreeningRecord.expiration_date.isnot(None),
                    ScreeningRecord.expiration_date >= today,
                    ScreeningRecord.expiration_date <= cutoff,
                    ScreeningRecord.status.in_(
                        [
                            ScreeningStatus.PASSED.value,
                            ScreeningStatus.COMPLETED.value,
                        ]
                    ),
                )
            )
            .order_by(ScreeningRecord.expiration_date.asc())
        )
        result = await self.db.execute(query)
        records = list(result.scalars().all())

        expiring: List[ExpiringScreening] = []
        for record in records:
            days_left = (
                (record.expiration_date - today).days if record.expiration_date else 0
            )
            expiring.append(
                ExpiringScreening(
                    record_id=record.id,
                    screening_type=record.screening_type,
                    requirement_name=None,
                    user_id=record.user_id,
                    user_name=None,
                    prospect_id=record.prospect_id,
                    prospect_name=None,
                    expiration_date=record.expiration_date,
                    days_until_expiration=days_left,
                )
            )

        return expiring
