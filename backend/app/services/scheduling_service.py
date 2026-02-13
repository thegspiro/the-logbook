"""
Scheduling Service

Business logic for shift scheduling including shift management,
attendance tracking, and calendar views.
"""

from typing import List, Optional, Dict, Tuple, Any
from datetime import datetime, date, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from uuid import UUID

from app.models.training import Shift, ShiftAttendance, ShiftCall
from app.models.user import User


class SchedulingService:
    """Service for scheduling management"""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ============================================
    # Shift Management
    # ============================================

    async def create_shift(
        self, organization_id: UUID, shift_data: Dict[str, Any], created_by: UUID
    ) -> Tuple[Optional[Shift], Optional[str]]:
        """Create a new shift"""
        try:
            shift = Shift(
                organization_id=organization_id,
                created_by=created_by,
                **shift_data
            )
            self.db.add(shift)
            await self.db.commit()
            await self.db.refresh(shift)
            return shift, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    async def get_shifts(
        self,
        organization_id: UUID,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> Tuple[List[Shift], int]:
        """Get shifts with date filtering and pagination"""
        query = (
            select(Shift)
            .where(Shift.organization_id == organization_id)
        )

        if start_date:
            query = query.where(Shift.shift_date >= start_date)
        if end_date:
            query = query.where(Shift.shift_date <= end_date)

        # Count
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await self.db.execute(count_query)
        total = total_result.scalar()

        # Paginated results
        query = query.order_by(Shift.shift_date.asc(), Shift.start_time.asc()).offset(skip).limit(limit)
        result = await self.db.execute(query)
        shifts = result.scalars().all()

        return shifts, total

    async def get_shift_by_id(
        self, shift_id: UUID, organization_id: UUID
    ) -> Optional[Shift]:
        """Get a shift by ID"""
        result = await self.db.execute(
            select(Shift)
            .where(Shift.id == shift_id)
            .where(Shift.organization_id == organization_id)
        )
        return result.scalar_one_or_none()

    async def update_shift(
        self, shift_id: UUID, organization_id: UUID, update_data: Dict[str, Any]
    ) -> Tuple[Optional[Shift], Optional[str]]:
        """Update a shift"""
        try:
            shift = await self.get_shift_by_id(shift_id, organization_id)
            if not shift:
                return None, "Shift not found"

            for key, value in update_data.items():
                setattr(shift, key, value)

            await self.db.commit()
            await self.db.refresh(shift)
            return shift, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    async def delete_shift(
        self, shift_id: UUID, organization_id: UUID
    ) -> Tuple[bool, Optional[str]]:
        """Delete a shift"""
        try:
            shift = await self.get_shift_by_id(shift_id, organization_id)
            if not shift:
                return False, "Shift not found"

            await self.db.delete(shift)
            await self.db.commit()
            return True, None
        except Exception as e:
            await self.db.rollback()
            return False, str(e)

    # ============================================
    # Attendance Management
    # ============================================

    async def add_attendance(
        self, shift_id: UUID, organization_id: UUID, attendance_data: Dict[str, Any]
    ) -> Tuple[Optional[ShiftAttendance], Optional[str]]:
        """Add an attendance record to a shift"""
        try:
            shift = await self.get_shift_by_id(shift_id, organization_id)
            if not shift:
                return None, "Shift not found"

            attendance = ShiftAttendance(shift_id=shift_id, **attendance_data)
            self.db.add(attendance)
            await self.db.commit()
            await self.db.refresh(attendance)
            return attendance, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    async def get_shift_attendance(
        self, shift_id: UUID, organization_id: UUID
    ) -> List[ShiftAttendance]:
        """Get all attendance records for a shift"""
        # Verify shift belongs to org
        shift = await self.get_shift_by_id(shift_id, organization_id)
        if not shift:
            return []

        result = await self.db.execute(
            select(ShiftAttendance)
            .where(ShiftAttendance.shift_id == shift_id)
            .order_by(ShiftAttendance.created_at)
        )
        return result.scalars().all()

    async def update_attendance(
        self, attendance_id: UUID, update_data: Dict[str, Any]
    ) -> Tuple[Optional[ShiftAttendance], Optional[str]]:
        """Update an attendance record"""
        try:
            result = await self.db.execute(
                select(ShiftAttendance)
                .where(ShiftAttendance.id == attendance_id)
            )
            attendance = result.scalar_one_or_none()
            if not attendance:
                return None, "Attendance record not found"

            for key, value in update_data.items():
                setattr(attendance, key, value)

            # Calculate duration if both check-in and check-out are set
            if attendance.checked_in_at and attendance.checked_out_at:
                delta = attendance.checked_out_at - attendance.checked_in_at
                attendance.duration_minutes = int(delta.total_seconds() / 60)

            await self.db.commit()
            await self.db.refresh(attendance)
            return attendance, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    async def remove_attendance(
        self, attendance_id: UUID
    ) -> Tuple[bool, Optional[str]]:
        """Remove an attendance record"""
        try:
            result = await self.db.execute(
                select(ShiftAttendance)
                .where(ShiftAttendance.id == attendance_id)
            )
            attendance = result.scalar_one_or_none()
            if not attendance:
                return False, "Attendance record not found"

            await self.db.delete(attendance)
            await self.db.commit()
            return True, None
        except Exception as e:
            await self.db.rollback()
            return False, str(e)

    # ============================================
    # Calendar View Helpers
    # ============================================

    async def get_week_shifts(
        self, organization_id: UUID, week_start: date
    ) -> List[Shift]:
        """Get all shifts for a specific week"""
        week_end = week_start + timedelta(days=6)
        shifts, _ = await self.get_shifts(
            organization_id, start_date=week_start, end_date=week_end, limit=500
        )
        return shifts

    async def get_month_shifts(
        self, organization_id: UUID, year: int, month: int
    ) -> List[Shift]:
        """Get all shifts for a specific month"""
        start = date(year, month, 1)
        if month == 12:
            end = date(year + 1, 1, 1) - timedelta(days=1)
        else:
            end = date(year, month + 1, 1) - timedelta(days=1)

        shifts, _ = await self.get_shifts(
            organization_id, start_date=start, end_date=end, limit=500
        )
        return shifts

    # ============================================
    # Summary & Reporting
    # ============================================

    async def get_summary(self, organization_id: UUID) -> Dict[str, Any]:
        """Get scheduling summary statistics"""
        today = date.today()

        # Total shifts
        total_result = await self.db.execute(
            select(func.count(Shift.id))
            .where(Shift.organization_id == organization_id)
        )
        total_shifts = total_result.scalar() or 0

        # Shifts this week
        week_start = today - timedelta(days=today.weekday())
        week_end = week_start + timedelta(days=6)
        week_result = await self.db.execute(
            select(func.count(Shift.id))
            .where(Shift.organization_id == organization_id)
            .where(Shift.shift_date >= week_start)
            .where(Shift.shift_date <= week_end)
        )
        shifts_this_week = week_result.scalar() or 0

        # Shifts this month
        first_of_month = today.replace(day=1)
        month_result = await self.db.execute(
            select(func.count(Shift.id))
            .where(Shift.organization_id == organization_id)
            .where(Shift.shift_date >= first_of_month)
        )
        shifts_this_month = month_result.scalar() or 0

        # Total hours this month (from attendance)
        hours_result = await self.db.execute(
            select(func.coalesce(func.sum(ShiftAttendance.duration_minutes), 0))
            .join(Shift, ShiftAttendance.shift_id == Shift.id)
            .where(Shift.organization_id == organization_id)
            .where(Shift.shift_date >= first_of_month)
        )
        total_minutes = hours_result.scalar() or 0
        total_hours = round(total_minutes / 60.0, 1)

        return {
            "total_shifts": total_shifts,
            "shifts_this_week": shifts_this_week,
            "shifts_this_month": shifts_this_month,
            "total_hours_this_month": total_hours,
        }
