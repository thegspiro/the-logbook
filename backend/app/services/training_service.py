"""
Training Service

Business logic for training management including courses, records, requirements, and reporting.
"""

from typing import List, Optional, Dict, Tuple
from datetime import datetime, date, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_
from sqlalchemy.orm import selectinload
from uuid import UUID

from app.models.training import (
    TrainingCourse,
    TrainingRecord,
    TrainingRequirement,
    TrainingStatus,
    TrainingType,
)
from app.models.user import User
from app.schemas.training import (
    UserTrainingStats,
    TrainingHoursSummary,
    TrainingReport,
    RequirementProgress,
)


class TrainingService:
    """Service for training management"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_user_training_stats(
        self, user_id: UUID, organization_id: UUID
    ) -> UserTrainingStats:
        """
        Get comprehensive training statistics for a user
        """
        current_year = datetime.now().year

        # Get all completed training records
        result = await self.db.execute(
            select(TrainingRecord)
            .where(TrainingRecord.user_id == user_id)
            .where(TrainingRecord.organization_id == organization_id)
            .where(TrainingRecord.status == TrainingStatus.COMPLETED)
        )
        records = result.scalars().all()

        # Calculate total hours
        total_hours = sum(r.hours_completed for r in records)

        # Calculate this year's hours
        hours_this_year = sum(
            r.hours_completed
            for r in records
            if r.completion_date and r.completion_date.year == current_year
        )

        # Count certifications
        certifications = [r for r in records if r.certification_number]
        total_certifications = len(certifications)

        # Count active, expiring soon, and expired
        today = date.today()
        ninety_days = today + timedelta(days=90)

        active_certifications = sum(
            1
            for r in certifications
            if r.expiration_date and r.expiration_date > today
        )

        expiring_soon = sum(
            1
            for r in certifications
            if r.expiration_date
            and today < r.expiration_date <= ninety_days
        )

        expired = sum(
            1
            for r in certifications
            if r.expiration_date and r.expiration_date <= today
        )

        return UserTrainingStats(
            user_id=user_id,
            total_hours=total_hours,
            hours_this_year=hours_this_year,
            total_certifications=total_certifications,
            active_certifications=active_certifications,
            expiring_soon=expiring_soon,
            expired=expired,
            completed_courses=len(records),
        )

    async def get_training_hours_by_type(
        self,
        organization_id: UUID,
        user_id: Optional[UUID] = None,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> List[TrainingHoursSummary]:
        """
        Get training hours broken down by type
        """
        query = (
            select(
                TrainingRecord.training_type,
                func.sum(TrainingRecord.hours_completed).label("total_hours"),
                func.count(TrainingRecord.id).label("record_count"),
            )
            .where(TrainingRecord.organization_id == organization_id)
            .where(TrainingRecord.status == TrainingStatus.COMPLETED)
            .group_by(TrainingRecord.training_type)
        )

        if user_id:
            query = query.where(TrainingRecord.user_id == user_id)

        if start_date:
            query = query.where(TrainingRecord.completion_date >= start_date)

        if end_date:
            query = query.where(TrainingRecord.completion_date <= end_date)

        result = await self.db.execute(query)
        rows = result.all()

        return [
            TrainingHoursSummary(
                training_type=row.training_type,
                total_hours=float(row.total_hours or 0),
                record_count=row.record_count,
            )
            for row in rows
        ]

    async def generate_training_report(
        self,
        organization_id: UUID,
        start_date: date,
        end_date: date,
        user_id: Optional[UUID] = None,
    ) -> TrainingReport:
        """
        Generate a comprehensive training report
        """
        # Build query
        query = (
            select(TrainingRecord)
            .where(TrainingRecord.organization_id == organization_id)
            .where(TrainingRecord.status == TrainingStatus.COMPLETED)
            .where(TrainingRecord.completion_date >= start_date)
            .where(TrainingRecord.completion_date <= end_date)
        )

        if user_id:
            query = query.where(TrainingRecord.user_id == user_id)

        result = await self.db.execute(query)
        records = result.scalars().all()

        # Calculate total hours
        total_hours = sum(r.hours_completed for r in records)

        # Get hours by type
        hours_by_type = await self.get_training_hours_by_type(
            organization_id=organization_id,
            user_id=user_id,
            start_date=start_date,
            end_date=end_date,
        )

        # Check requirement compliance
        requirements_met = []
        requirements_pending = []

        if user_id:
            # Get all active requirements
            req_result = await self.db.execute(
                select(TrainingRequirement)
                .where(TrainingRequirement.organization_id == organization_id)
                .where(TrainingRequirement.active == True)
            )
            requirements = req_result.scalars().all()

            for req in requirements:
                progress = await self.check_requirement_progress(
                    user_id, req.id, organization_id
                )
                if progress.is_complete:
                    requirements_met.append(req.id)
                else:
                    requirements_pending.append(req.id)

        return TrainingReport(
            user_id=user_id,
            start_date=start_date,
            end_date=end_date,
            total_hours=total_hours,
            hours_by_type=hours_by_type,
            records=records,
            requirements_met=requirements_met,
            requirements_pending=requirements_pending,
        )

    async def check_requirement_progress(
        self, user_id: UUID, requirement_id: UUID, organization_id: UUID
    ) -> RequirementProgress:
        """
        Check a user's progress towards a specific requirement
        """
        # Get the requirement
        result = await self.db.execute(
            select(TrainingRequirement)
            .where(TrainingRequirement.id == requirement_id)
            .where(TrainingRequirement.organization_id == organization_id)
        )
        requirement = result.scalar_one_or_none()

        if not requirement:
            raise ValueError("Requirement not found")

        # Determine date range based on frequency
        today = date.today()
        if requirement.frequency == "annual":
            start_date = date(requirement.year, 1, 1) if requirement.year else date(today.year, 1, 1)
            end_date = date(requirement.year, 12, 31) if requirement.year else date(today.year, 12, 31)
        else:
            # For other frequencies, use requirement dates or default to current year
            start_date = requirement.start_date or date(today.year, 1, 1)
            end_date = requirement.due_date or today

        # Get completed hours in the date range
        query = (
            select(func.sum(TrainingRecord.hours_completed))
            .where(TrainingRecord.user_id == user_id)
            .where(TrainingRecord.organization_id == organization_id)
            .where(TrainingRecord.status == TrainingStatus.COMPLETED)
            .where(TrainingRecord.completion_date >= start_date)
            .where(TrainingRecord.completion_date <= end_date)
        )

        # Filter by training type if specified
        if requirement.training_type:
            query = query.where(TrainingRecord.training_type == requirement.training_type)

        # Filter by required courses if specified
        if requirement.required_courses:
            query = query.where(TrainingRecord.course_id.in_(requirement.required_courses))

        result = await self.db.execute(query)
        completed_hours = float(result.scalar() or 0)

        # Calculate progress
        required_hours = requirement.required_hours or 0
        percentage = (completed_hours / required_hours * 100) if required_hours > 0 else 100
        is_complete = completed_hours >= required_hours

        return RequirementProgress(
            requirement_id=requirement.id,
            requirement_name=requirement.name,
            required_hours=requirement.required_hours,
            completed_hours=completed_hours,
            percentage_complete=round(percentage, 2),
            is_complete=is_complete,
            due_date=requirement.due_date,
        )

    async def get_all_requirements_progress(
        self, user_id: UUID, organization_id: UUID, year: Optional[int] = None
    ) -> List[RequirementProgress]:
        """
        Get progress for all requirements applicable to a user
        """
        current_year = year or datetime.now().year

        # Get user's roles
        user_result = await self.db.execute(
            select(User)
            .where(User.id == user_id)
            .options(selectinload(User.roles))
        )
        user = user_result.scalar_one_or_none()
        if not user:
            return []

        user_role_ids = [str(role.id) for role in user.roles]

        # Get all active requirements
        query = (
            select(TrainingRequirement)
            .where(TrainingRequirement.organization_id == organization_id)
            .where(TrainingRequirement.active == True)
        )

        if year:
            query = query.where(
                or_(
                    TrainingRequirement.year == year,
                    TrainingRequirement.year.is_(None),
                )
            )

        result = await self.db.execute(query)
        requirements = result.scalars().all()

        # Filter requirements applicable to this user
        applicable_requirements = []
        for req in requirements:
            if req.applies_to_all:
                applicable_requirements.append(req)
            elif req.required_roles:
                # Check if user has any of the required roles
                if any(role_id in user_role_ids for role_id in req.required_roles):
                    applicable_requirements.append(req)

        # Get progress for each requirement
        progress_list = []
        for req in applicable_requirements:
            progress = await self.check_requirement_progress(
                user_id, req.id, organization_id
            )
            progress_list.append(progress)

        return progress_list

    async def get_expiring_certifications(
        self, organization_id: UUID, days_ahead: int = 90
    ) -> List[TrainingRecord]:
        """
        Get certifications that are expiring within the specified number of days
        """
        today = date.today()
        future_date = today + timedelta(days=days_ahead)

        result = await self.db.execute(
            select(TrainingRecord)
            .where(TrainingRecord.organization_id == organization_id)
            .where(TrainingRecord.status == TrainingStatus.COMPLETED)
            .where(TrainingRecord.certification_number.isnot(None))
            .where(TrainingRecord.expiration_date.isnot(None))
            .where(TrainingRecord.expiration_date > today)
            .where(TrainingRecord.expiration_date <= future_date)
            .order_by(TrainingRecord.expiration_date)
        )

        return result.scalars().all()
