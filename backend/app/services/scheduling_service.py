"""
Scheduling Service

Business logic for shift scheduling including shift management,
attendance tracking, and calendar views.
"""

from typing import List, Optional, Dict, Tuple, Any
from datetime import datetime, date, timedelta, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_
from uuid import UUID

from app.models.training import (
    Shift, ShiftAttendance, ShiftCall,
    ShiftTemplate, ShiftPattern, ShiftAssignment,
    ShiftSwapRequest, ShiftTimeOff,
    AssignmentStatus, SwapRequestStatus, TimeOffStatus, PatternType,
    BasicApparatus,
)
from app.models.user import User


class SchedulingService:
    """Service for scheduling management"""

    PROTECTED_FIELDS = frozenset({
        "id", "organization_id", "created_at", "updated_at", "created_by",
    })

    def __init__(self, db: AsyncSession):
        self.db = db

    # ============================================
    # Apparatus Enrichment
    # ============================================

    async def _get_apparatus_map(
        self, organization_id: UUID, apparatus_ids: List[str]
    ) -> Dict[str, Any]:
        """Load BasicApparatus rows for a set of IDs, returning a dict keyed by id."""
        if not apparatus_ids:
            return {}
        result = await self.db.execute(
            select(BasicApparatus)
            .where(BasicApparatus.organization_id == str(organization_id))
            .where(BasicApparatus.id.in_(apparatus_ids))
        )
        return {str(a.id): a for a in result.scalars().all()}

    def _enrich_shift_dict(
        self, shift_dict: Dict[str, Any], apparatus_map: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Add apparatus_name, apparatus_unit_number, apparatus_positions to a shift dict."""
        aid = shift_dict.get("apparatus_id")
        if aid and aid in apparatus_map:
            a = apparatus_map[aid]
            shift_dict["apparatus_name"] = a.name
            shift_dict["apparatus_unit_number"] = a.unit_number
            shift_dict["apparatus_positions"] = a.positions or []
        else:
            shift_dict["apparatus_name"] = None
            shift_dict["apparatus_unit_number"] = None
            shift_dict["apparatus_positions"] = None
        return shift_dict

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
            .where(Shift.organization_id == str(organization_id))
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
            .where(Shift.id == str(shift_id))
            .where(Shift.organization_id == str(organization_id))
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
                if key not in self.PROTECTED_FIELDS:
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
            .where(ShiftAttendance.shift_id == str(shift_id))
            .order_by(ShiftAttendance.created_at)
        )
        return result.scalars().all()

    async def update_attendance(
        self, attendance_id: UUID, organization_id: UUID, update_data: Dict[str, Any]
    ) -> Tuple[Optional[ShiftAttendance], Optional[str]]:
        """Update an attendance record"""
        try:
            result = await self.db.execute(
                select(ShiftAttendance)
                .join(Shift, ShiftAttendance.shift_id == Shift.id)
                .where(ShiftAttendance.id == str(attendance_id))
                .where(Shift.organization_id == str(organization_id))
            )
            attendance = result.scalar_one_or_none()
            if not attendance:
                return None, "Attendance record not found"

            for key, value in update_data.items():
                if key not in self.PROTECTED_FIELDS:
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
        self, attendance_id: UUID, organization_id: UUID
    ) -> Tuple[bool, Optional[str]]:
        """Remove an attendance record"""
        try:
            result = await self.db.execute(
                select(ShiftAttendance)
                .join(Shift, ShiftAttendance.shift_id == Shift.id)
                .where(ShiftAttendance.id == str(attendance_id))
                .where(Shift.organization_id == str(organization_id))
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
            .where(Shift.organization_id == str(organization_id))
        )
        total_shifts = total_result.scalar() or 0

        # Shifts this week
        week_start = today - timedelta(days=today.weekday())
        week_end = week_start + timedelta(days=6)
        week_result = await self.db.execute(
            select(func.count(Shift.id))
            .where(Shift.organization_id == str(organization_id))
            .where(Shift.shift_date >= week_start)
            .where(Shift.shift_date <= week_end)
        )
        shifts_this_week = week_result.scalar() or 0

        # Shifts this month
        first_of_month = today.replace(day=1)
        month_result = await self.db.execute(
            select(func.count(Shift.id))
            .where(Shift.organization_id == str(organization_id))
            .where(Shift.shift_date >= first_of_month)
        )
        shifts_this_month = month_result.scalar() or 0

        # Total hours this month (from attendance)
        hours_result = await self.db.execute(
            select(func.coalesce(func.sum(ShiftAttendance.duration_minutes), 0))
            .join(Shift, ShiftAttendance.shift_id == Shift.id)
            .where(Shift.organization_id == str(organization_id))
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

    # ============================================
    # Shift Call Management
    # ============================================

    async def create_shift_call(
        self, organization_id: UUID, shift_id: UUID, call_data: Dict[str, Any]
    ) -> Tuple[Optional[ShiftCall], Optional[str]]:
        """Create a new call record for a shift"""
        try:
            # Verify shift belongs to org
            shift = await self.get_shift_by_id(shift_id, organization_id)
            if not shift:
                return None, "Shift not found"

            call = ShiftCall(
                shift_id=shift_id,
                organization_id=organization_id,
                **call_data
            )
            self.db.add(call)
            await self.db.commit()
            await self.db.refresh(call)
            return call, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    async def get_shift_calls(
        self, shift_id: UUID, organization_id: UUID
    ) -> List[ShiftCall]:
        """Get all calls for a shift"""
        # Verify shift belongs to org
        shift = await self.get_shift_by_id(shift_id, organization_id)
        if not shift:
            return []

        result = await self.db.execute(
            select(ShiftCall)
            .where(ShiftCall.shift_id == str(shift_id))
            .where(ShiftCall.organization_id == str(organization_id))
            .order_by(ShiftCall.dispatched_at.asc())
        )
        return result.scalars().all()

    async def get_shift_call_by_id(
        self, call_id: UUID, organization_id: UUID
    ) -> Optional[ShiftCall]:
        """Get a shift call by ID"""
        result = await self.db.execute(
            select(ShiftCall)
            .where(ShiftCall.id == str(call_id))
            .where(ShiftCall.organization_id == str(organization_id))
        )
        return result.scalar_one_or_none()

    async def update_shift_call(
        self, call_id: UUID, organization_id: UUID, update_data: Dict[str, Any]
    ) -> Tuple[Optional[ShiftCall], Optional[str]]:
        """Update a shift call record"""
        try:
            call = await self.get_shift_call_by_id(call_id, organization_id)
            if not call:
                return None, "Shift call not found"

            for key, value in update_data.items():
                if key not in self.PROTECTED_FIELDS:
                    setattr(call, key, value)

            await self.db.commit()
            await self.db.refresh(call)
            return call, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    async def delete_shift_call(
        self, call_id: UUID, organization_id: UUID
    ) -> Tuple[bool, Optional[str]]:
        """Delete a shift call record"""
        try:
            call = await self.get_shift_call_by_id(call_id, organization_id)
            if not call:
                return False, "Shift call not found"

            await self.db.delete(call)
            await self.db.commit()
            return True, None
        except Exception as e:
            await self.db.rollback()
            return False, str(e)

    # ============================================
    # Shift Template Management
    # ============================================

    async def create_template(
        self, organization_id: UUID, template_data: Dict[str, Any], created_by: UUID
    ) -> Tuple[Optional[ShiftTemplate], Optional[str]]:
        """Create a new shift template"""
        try:
            template = ShiftTemplate(
                organization_id=organization_id,
                created_by=created_by,
                **template_data
            )
            self.db.add(template)
            await self.db.commit()
            await self.db.refresh(template)
            return template, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    async def get_templates(
        self, organization_id: UUID, active_only: bool = True
    ) -> List[ShiftTemplate]:
        """Get all shift templates for an organization"""
        query = (
            select(ShiftTemplate)
            .where(ShiftTemplate.organization_id == str(organization_id))
        )
        if active_only:
            query = query.where(ShiftTemplate.is_active == True)

        query = query.order_by(ShiftTemplate.name.asc())
        result = await self.db.execute(query)
        return result.scalars().all()

    async def get_template_by_id(
        self, template_id: UUID, organization_id: UUID
    ) -> Optional[ShiftTemplate]:
        """Get a shift template by ID"""
        result = await self.db.execute(
            select(ShiftTemplate)
            .where(ShiftTemplate.id == str(template_id))
            .where(ShiftTemplate.organization_id == str(organization_id))
        )
        return result.scalar_one_or_none()

    async def update_template(
        self, template_id: UUID, organization_id: UUID, update_data: Dict[str, Any]
    ) -> Tuple[Optional[ShiftTemplate], Optional[str]]:
        """Update a shift template"""
        try:
            template = await self.get_template_by_id(template_id, organization_id)
            if not template:
                return None, "Shift template not found"

            for key, value in update_data.items():
                if key not in self.PROTECTED_FIELDS:
                    setattr(template, key, value)

            await self.db.commit()
            await self.db.refresh(template)
            return template, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    async def delete_template(
        self, template_id: UUID, organization_id: UUID
    ) -> Tuple[bool, Optional[str]]:
        """Delete a shift template"""
        try:
            template = await self.get_template_by_id(template_id, organization_id)
            if not template:
                return False, "Shift template not found"

            await self.db.delete(template)
            await self.db.commit()
            return True, None
        except Exception as e:
            await self.db.rollback()
            return False, str(e)

    # ============================================
    # Shift Pattern Management
    # ============================================

    async def create_pattern(
        self, organization_id: UUID, pattern_data: Dict[str, Any], created_by: UUID
    ) -> Tuple[Optional[ShiftPattern], Optional[str]]:
        """Create a new shift pattern"""
        try:
            pattern = ShiftPattern(
                organization_id=organization_id,
                created_by=created_by,
                **pattern_data
            )
            self.db.add(pattern)
            await self.db.commit()
            await self.db.refresh(pattern)
            return pattern, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    async def get_patterns(
        self, organization_id: UUID, active_only: bool = True
    ) -> List[ShiftPattern]:
        """Get all shift patterns for an organization"""
        query = (
            select(ShiftPattern)
            .where(ShiftPattern.organization_id == str(organization_id))
        )
        if active_only:
            query = query.where(ShiftPattern.is_active == True)

        query = query.order_by(ShiftPattern.name.asc())
        result = await self.db.execute(query)
        return result.scalars().all()

    async def get_pattern_by_id(
        self, pattern_id: UUID, organization_id: UUID
    ) -> Optional[ShiftPattern]:
        """Get a shift pattern by ID"""
        result = await self.db.execute(
            select(ShiftPattern)
            .where(ShiftPattern.id == str(pattern_id))
            .where(ShiftPattern.organization_id == str(organization_id))
        )
        return result.scalar_one_or_none()

    async def update_pattern(
        self, pattern_id: UUID, organization_id: UUID, update_data: Dict[str, Any]
    ) -> Tuple[Optional[ShiftPattern], Optional[str]]:
        """Update a shift pattern"""
        try:
            pattern = await self.get_pattern_by_id(pattern_id, organization_id)
            if not pattern:
                return None, "Shift pattern not found"

            for key, value in update_data.items():
                if key not in self.PROTECTED_FIELDS:
                    setattr(pattern, key, value)

            await self.db.commit()
            await self.db.refresh(pattern)
            return pattern, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    async def delete_pattern(
        self, pattern_id: UUID, organization_id: UUID
    ) -> Tuple[bool, Optional[str]]:
        """Delete a shift pattern"""
        try:
            pattern = await self.get_pattern_by_id(pattern_id, organization_id)
            if not pattern:
                return False, "Shift pattern not found"

            await self.db.delete(pattern)
            await self.db.commit()
            return True, None
        except Exception as e:
            await self.db.rollback()
            return False, str(e)

    async def generate_shifts_from_pattern(
        self,
        pattern_id: UUID,
        organization_id: UUID,
        start_date: date,
        end_date: date,
        created_by: UUID,
    ) -> Tuple[List[Shift], Optional[str]]:
        """Generate shifts from a pattern for a given date range"""
        try:
            pattern = await self.get_pattern_by_id(pattern_id, organization_id)
            if not pattern:
                return [], "Shift pattern not found"

            # Load the associated template
            template = None
            if pattern.template_id:
                template = await self.get_template_by_id(pattern.template_id, organization_id)
            if not template:
                return [], "Shift template not found for pattern"

            # Parse template times
            start_hour, start_minute = map(int, template.start_time_of_day.split(":"))
            end_hour, end_minute = map(int, template.end_time_of_day.split(":"))

            config = pattern.schedule_config or {}

            # Determine which dates get a shift
            shift_dates = []
            current = start_date
            while current <= end_date:
                should_create = False

                if pattern.pattern_type == PatternType.DAILY:
                    should_create = True

                elif pattern.pattern_type == PatternType.WEEKLY:
                    weekdays = config.get("weekdays", [])
                    if current.weekday() in weekdays:
                        should_create = True

                elif pattern.pattern_type == PatternType.PLATOON:
                    days_on = pattern.days_on or 1
                    days_off = pattern.days_off or 1
                    cycle_length = days_on + days_off
                    days_since_start = (current - pattern.start_date).days
                    position_in_cycle = days_since_start % cycle_length
                    if position_in_cycle < days_on:
                        should_create = True

                elif pattern.pattern_type == PatternType.CUSTOM:
                    custom_dates = config.get("dates", [])
                    if current.isoformat() in custom_dates:
                        should_create = True

                if should_create:
                    shift_dates.append(current)

                current += timedelta(days=1)

            # Create shifts for each date
            created_shifts = []
            for shift_date_val in shift_dates:
                shift_start = datetime(
                    shift_date_val.year, shift_date_val.month, shift_date_val.day,
                    start_hour, start_minute
                )
                shift_end = datetime(
                    shift_date_val.year, shift_date_val.month, shift_date_val.day,
                    end_hour, end_minute
                )
                # If end time is before start time, the shift ends the next day
                if shift_end <= shift_start:
                    shift_end += timedelta(days=1)

                shift = Shift(
                    organization_id=organization_id,
                    shift_date=shift_date_val,
                    start_time=shift_start,
                    end_time=shift_end,
                    created_by=created_by,
                )
                self.db.add(shift)
                await self.db.flush()  # Get the shift ID without committing

                # Auto-create assignments for assigned members
                assigned_members = pattern.assigned_members or []
                for member in assigned_members:
                    assignment = ShiftAssignment(
                        organization_id=organization_id,
                        shift_id=shift.id,
                        user_id=member.get("user_id"),
                        position=member.get("position", "firefighter"),
                        assignment_status=AssignmentStatus.ASSIGNED,
                        assigned_by=created_by,
                    )
                    self.db.add(assignment)

                created_shifts.append(shift)

            await self.db.commit()
            # Refresh all shifts to get generated defaults
            for shift in created_shifts:
                await self.db.refresh(shift)

            return created_shifts, None
        except Exception as e:
            await self.db.rollback()
            return [], str(e)

    # ============================================
    # Shift Assignment Management
    # ============================================

    async def create_assignment(
        self,
        organization_id: UUID,
        shift_id: UUID,
        assignment_data: Dict[str, Any],
        assigned_by: UUID,
    ) -> Tuple[Optional[ShiftAssignment], Optional[str]]:
        """Create a new shift assignment"""
        try:
            # Verify shift belongs to org
            shift = await self.get_shift_by_id(shift_id, organization_id)
            if not shift:
                return None, "Shift not found"

            assignment = ShiftAssignment(
                organization_id=organization_id,
                shift_id=shift_id,
                assigned_by=assigned_by,
                **assignment_data
            )
            self.db.add(assignment)
            await self.db.commit()
            await self.db.refresh(assignment)
            return assignment, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    async def get_shift_assignments(
        self, shift_id: UUID, organization_id: UUID
    ) -> List[ShiftAssignment]:
        """Get all assignments for a shift"""
        # Verify shift belongs to org
        shift = await self.get_shift_by_id(shift_id, organization_id)
        if not shift:
            return []

        result = await self.db.execute(
            select(ShiftAssignment)
            .where(ShiftAssignment.shift_id == str(shift_id))
            .where(ShiftAssignment.organization_id == str(organization_id))
            .order_by(ShiftAssignment.created_at.asc())
        )
        return result.scalars().all()

    async def get_user_assignments(
        self,
        user_id: UUID,
        organization_id: UUID,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> List[ShiftAssignment]:
        """Get all shift assignments for a user, optionally filtered by date range"""
        query = (
            select(ShiftAssignment)
            .join(Shift, ShiftAssignment.shift_id == Shift.id)
            .where(ShiftAssignment.user_id == str(user_id))
            .where(ShiftAssignment.organization_id == str(organization_id))
        )

        if start_date:
            query = query.where(Shift.shift_date >= start_date)
        if end_date:
            query = query.where(Shift.shift_date <= end_date)

        query = query.order_by(Shift.shift_date.asc(), Shift.start_time.asc())
        result = await self.db.execute(query)
        return result.scalars().all()

    async def update_assignment(
        self, assignment_id: UUID, organization_id: UUID, update_data: Dict[str, Any]
    ) -> Tuple[Optional[ShiftAssignment], Optional[str]]:
        """Update a shift assignment"""
        try:
            result = await self.db.execute(
                select(ShiftAssignment)
                .where(ShiftAssignment.id == str(assignment_id))
                .where(ShiftAssignment.organization_id == str(organization_id))
            )
            assignment = result.scalar_one_or_none()
            if not assignment:
                return None, "Shift assignment not found"

            for key, value in update_data.items():
                if key not in self.PROTECTED_FIELDS:
                    setattr(assignment, key, value)

            await self.db.commit()
            await self.db.refresh(assignment)
            return assignment, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    async def delete_assignment(
        self, assignment_id: UUID, organization_id: UUID
    ) -> Tuple[bool, Optional[str]]:
        """Delete a shift assignment"""
        try:
            result = await self.db.execute(
                select(ShiftAssignment)
                .where(ShiftAssignment.id == str(assignment_id))
                .where(ShiftAssignment.organization_id == str(organization_id))
            )
            assignment = result.scalar_one_or_none()
            if not assignment:
                return False, "Shift assignment not found"

            await self.db.delete(assignment)
            await self.db.commit()
            return True, None
        except Exception as e:
            await self.db.rollback()
            return False, str(e)

    async def confirm_assignment(
        self, assignment_id: UUID, user_id: UUID
    ) -> Tuple[Optional[ShiftAssignment], Optional[str]]:
        """Confirm a shift assignment (by the assigned user)"""
        try:
            result = await self.db.execute(
                select(ShiftAssignment)
                .where(ShiftAssignment.id == str(assignment_id))
                .where(ShiftAssignment.user_id == str(user_id))
            )
            assignment = result.scalar_one_or_none()
            if not assignment:
                return None, "Shift assignment not found or not assigned to you"

            assignment.assignment_status = AssignmentStatus.CONFIRMED
            assignment.confirmed_at = datetime.now(timezone.utc)

            await self.db.commit()
            await self.db.refresh(assignment)
            return assignment, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    # ============================================
    # Shift Swap Request Management
    # ============================================

    async def create_swap_request(
        self, organization_id: UUID, requesting_user_id: UUID, swap_data: Dict[str, Any]
    ) -> Tuple[Optional[ShiftSwapRequest], Optional[str]]:
        """Create a new shift swap request"""
        try:
            swap_request = ShiftSwapRequest(
                organization_id=organization_id,
                requesting_user_id=requesting_user_id,
                **swap_data
            )
            self.db.add(swap_request)
            await self.db.commit()
            await self.db.refresh(swap_request)
            return swap_request, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    async def get_swap_requests(
        self,
        organization_id: UUID,
        status: Optional[SwapRequestStatus] = None,
        user_id: Optional[UUID] = None,
        skip: int = 0,
        limit: int = 50,
    ) -> Tuple[List[ShiftSwapRequest], int]:
        """Get swap requests with optional filtering and pagination"""
        query = (
            select(ShiftSwapRequest)
            .where(ShiftSwapRequest.organization_id == str(organization_id))
        )

        if status:
            query = query.where(ShiftSwapRequest.status == status)
        if user_id:
            query = query.where(
                or_(
                    ShiftSwapRequest.requesting_user_id == user_id,
                    ShiftSwapRequest.target_user_id == user_id,
                )
            )

        # Count
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await self.db.execute(count_query)
        total = total_result.scalar()

        # Paginated results
        query = query.order_by(ShiftSwapRequest.created_at.desc()).offset(skip).limit(limit)
        result = await self.db.execute(query)
        swap_requests = result.scalars().all()

        return swap_requests, total

    async def get_swap_request_by_id(
        self, request_id: UUID, organization_id: UUID
    ) -> Optional[ShiftSwapRequest]:
        """Get a swap request by ID"""
        result = await self.db.execute(
            select(ShiftSwapRequest)
            .where(ShiftSwapRequest.id == str(request_id))
            .where(ShiftSwapRequest.organization_id == str(organization_id))
        )
        return result.scalar_one_or_none()

    async def review_swap_request(
        self,
        request_id: UUID,
        organization_id: UUID,
        reviewer_id: UUID,
        status: SwapRequestStatus,
        reviewer_notes: Optional[str] = None,
    ) -> Tuple[Optional[ShiftSwapRequest], Optional[str]]:
        """Review (approve/deny) a shift swap request"""
        try:
            swap_request = await self.get_swap_request_by_id(request_id, organization_id)
            if not swap_request:
                return None, "Swap request not found"

            if swap_request.status != SwapRequestStatus.PENDING:
                return None, "Swap request is no longer pending"

            swap_request.status = status
            swap_request.reviewed_by = reviewer_id
            swap_request.reviewed_at = datetime.now(timezone.utc)
            swap_request.reviewer_notes = reviewer_notes

            # If approved, perform the actual swap of assignments
            if status == SwapRequestStatus.APPROVED:
                # Find the requesting user's assignment on the offering shift
                req_assign_result = await self.db.execute(
                    select(ShiftAssignment)
                    .where(ShiftAssignment.shift_id == swap_request.offering_shift_id)
                    .where(ShiftAssignment.user_id == swap_request.requesting_user_id)
                    .where(ShiftAssignment.organization_id == str(organization_id))
                )
                req_assignment = req_assign_result.scalar_one_or_none()

                # Find the target user's assignment on the requesting shift
                target_assign = None
                if swap_request.requesting_shift_id and swap_request.target_user_id:
                    target_assign_result = await self.db.execute(
                        select(ShiftAssignment)
                        .where(ShiftAssignment.shift_id == swap_request.requesting_shift_id)
                        .where(ShiftAssignment.user_id == swap_request.target_user_id)
                        .where(ShiftAssignment.organization_id == str(organization_id))
                    )
                    target_assign = target_assign_result.scalar_one_or_none()

                # Swap user assignments between the two shifts
                if req_assignment and target_assign:
                    req_assignment.user_id = swap_request.target_user_id
                    target_assign.user_id = swap_request.requesting_user_id
                elif req_assignment and swap_request.requesting_shift_id:
                    # Move requesting user to the new shift
                    req_assignment.shift_id = swap_request.requesting_shift_id

            await self.db.commit()
            await self.db.refresh(swap_request)
            return swap_request, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    async def cancel_swap_request(
        self, request_id: UUID, organization_id: UUID, user_id: UUID
    ) -> Tuple[Optional[ShiftSwapRequest], Optional[str]]:
        """Cancel a swap request (only by the requesting user)"""
        try:
            swap_request = await self.get_swap_request_by_id(request_id, organization_id)
            if not swap_request:
                return None, "Swap request not found"

            if str(swap_request.requesting_user_id) != str(user_id):
                return None, "Only the requesting user can cancel this swap request"

            if swap_request.status != SwapRequestStatus.PENDING:
                return None, "Swap request is no longer pending"

            swap_request.status = SwapRequestStatus.CANCELLED

            await self.db.commit()
            await self.db.refresh(swap_request)
            return swap_request, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    # ============================================
    # Time-Off Management
    # ============================================

    async def create_time_off(
        self, organization_id: UUID, user_id: UUID, time_off_data: Dict[str, Any]
    ) -> Tuple[Optional[ShiftTimeOff], Optional[str]]:
        """Create a new time-off request"""
        try:
            time_off = ShiftTimeOff(
                organization_id=organization_id,
                user_id=user_id,
                **time_off_data
            )
            self.db.add(time_off)
            await self.db.commit()
            await self.db.refresh(time_off)
            return time_off, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    async def get_time_off_requests(
        self,
        organization_id: UUID,
        status: Optional[TimeOffStatus] = None,
        user_id: Optional[UUID] = None,
        skip: int = 0,
        limit: int = 50,
    ) -> Tuple[List[ShiftTimeOff], int]:
        """Get time-off requests with optional filtering and pagination"""
        query = (
            select(ShiftTimeOff)
            .where(ShiftTimeOff.organization_id == str(organization_id))
        )

        if status:
            query = query.where(ShiftTimeOff.status == status)
        if user_id:
            query = query.where(ShiftTimeOff.user_id == str(user_id))

        # Count
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await self.db.execute(count_query)
        total = total_result.scalar()

        # Paginated results
        query = query.order_by(ShiftTimeOff.start_date.asc()).offset(skip).limit(limit)
        result = await self.db.execute(query)
        time_off_requests = result.scalars().all()

        return time_off_requests, total

    async def get_time_off_by_id(
        self, time_off_id: UUID, organization_id: UUID
    ) -> Optional[ShiftTimeOff]:
        """Get a time-off request by ID"""
        result = await self.db.execute(
            select(ShiftTimeOff)
            .where(ShiftTimeOff.id == str(time_off_id))
            .where(ShiftTimeOff.organization_id == str(organization_id))
        )
        return result.scalar_one_or_none()

    async def review_time_off(
        self,
        time_off_id: UUID,
        organization_id: UUID,
        reviewer_id: UUID,
        status: TimeOffStatus,
        reviewer_notes: Optional[str] = None,
    ) -> Tuple[Optional[ShiftTimeOff], Optional[str]]:
        """Review (approve/deny) a time-off request"""
        try:
            time_off = await self.get_time_off_by_id(time_off_id, organization_id)
            if not time_off:
                return None, "Time-off request not found"

            if time_off.status != TimeOffStatus.PENDING:
                return None, "Time-off request is no longer pending"

            time_off.status = status
            time_off.approved_by = reviewer_id
            time_off.approved_at = datetime.now(timezone.utc)
            time_off.reviewer_notes = reviewer_notes

            await self.db.commit()
            await self.db.refresh(time_off)
            return time_off, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    async def cancel_time_off(
        self, time_off_id: UUID, organization_id: UUID, user_id: UUID
    ) -> Tuple[Optional[ShiftTimeOff], Optional[str]]:
        """Cancel a time-off request (only by the requesting user)"""
        try:
            time_off = await self.get_time_off_by_id(time_off_id, organization_id)
            if not time_off:
                return None, "Time-off request not found"

            if str(time_off.user_id) != str(user_id):
                return None, "Only the requesting user can cancel this time-off request"

            if time_off.status != TimeOffStatus.PENDING:
                return None, "Time-off request is no longer pending"

            time_off.status = TimeOffStatus.CANCELLED

            await self.db.commit()
            await self.db.refresh(time_off)
            return time_off, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    async def get_availability(
        self, organization_id: UUID, start_date: date, end_date: date
    ) -> List[Dict]:
        """Get users who have approved time-off in a date range"""
        result = await self.db.execute(
            select(ShiftTimeOff)
            .where(ShiftTimeOff.organization_id == str(organization_id))
            .where(ShiftTimeOff.status == TimeOffStatus.APPROVED)
            .where(ShiftTimeOff.start_date <= end_date)
            .where(ShiftTimeOff.end_date >= start_date)
            .order_by(ShiftTimeOff.start_date.asc())
        )
        time_off_records = result.scalars().all()

        unavailable = []
        for record in time_off_records:
            unavailable.append({
                "user_id": record.user_id,
                "start_date": record.start_date.isoformat(),
                "end_date": record.end_date.isoformat(),
                "reason": record.reason,
            })

        return unavailable

    # ============================================
    # Reporting
    # ============================================

    async def get_member_hours_report(
        self, organization_id: UUID, start_date: date, end_date: date
    ) -> List[Dict]:
        """Get total hours per member from attendance records in a date range"""
        result = await self.db.execute(
            select(
                ShiftAttendance.user_id,
                User.email,
                func.count(ShiftAttendance.id).label("shift_count"),
                func.coalesce(func.sum(ShiftAttendance.duration_minutes), 0).label("total_minutes"),
            )
            .join(Shift, ShiftAttendance.shift_id == Shift.id)
            .join(User, ShiftAttendance.user_id == User.id)
            .where(Shift.organization_id == str(organization_id))
            .where(Shift.shift_date >= start_date)
            .where(Shift.shift_date <= end_date)
            .group_by(ShiftAttendance.user_id, User.email)
            .order_by(func.sum(ShiftAttendance.duration_minutes).desc())
        )
        rows = result.all()

        return [
            {
                "user_id": row.user_id,
                "email": row.email,
                "shift_count": row.shift_count,
                "total_minutes": row.total_minutes,
                "total_hours": round(row.total_minutes / 60.0, 1),
            }
            for row in rows
        ]

    async def get_shift_coverage_report(
        self, organization_id: UUID, start_date: date, end_date: date
    ) -> List[Dict]:
        """Get shift coverage report for each date in range"""
        report = []
        current = start_date
        while current <= end_date:
            # Get shifts for this date
            shift_result = await self.db.execute(
                select(Shift)
                .where(Shift.organization_id == str(organization_id))
                .where(Shift.shift_date == current)
            )
            shifts = shift_result.scalars().all()

            total_assigned = 0
            total_confirmed = 0
            understaffed_shifts = 0

            for shift in shifts:
                assign_result = await self.db.execute(
                    select(ShiftAssignment)
                    .where(ShiftAssignment.shift_id == shift.id)
                    .where(ShiftAssignment.organization_id == str(organization_id))
                )
                assignments = assign_result.scalars().all()
                assigned_count = len(assignments)
                confirmed_count = sum(
                    1 for a in assignments
                    if a.assignment_status == AssignmentStatus.CONFIRMED
                )
                total_assigned += assigned_count
                total_confirmed += confirmed_count

                # Check against template min_staffing if available
                # Use a default min_staffing of 1 if not set
                if assigned_count < 1:
                    understaffed_shifts += 1

            report.append({
                "date": current.isoformat(),
                "total_shifts": len(shifts),
                "total_assigned": total_assigned,
                "total_confirmed": total_confirmed,
                "understaffed_shifts": understaffed_shifts,
            })

            current += timedelta(days=1)

        return report

    async def get_call_volume_report(
        self, organization_id: UUID, start_date: date, end_date: date, group_by: str = "day"
    ) -> List[Dict]:
        """Get call volume grouped by period with type breakdown and avg response time"""
        # Get all calls in range
        result = await self.db.execute(
            select(ShiftCall)
            .join(Shift, ShiftCall.shift_id == Shift.id)
            .where(ShiftCall.organization_id == str(organization_id))
            .where(Shift.shift_date >= start_date)
            .where(Shift.shift_date <= end_date)
            .order_by(Shift.shift_date.asc())
        )
        calls = result.scalars().all()

        # Load the shift dates for grouping
        call_data = []
        for call in calls:
            shift_result = await self.db.execute(
                select(Shift.shift_date).where(Shift.id == call.shift_id)
            )
            shift_date_val = shift_result.scalar_one_or_none()
            if shift_date_val:
                call_data.append((shift_date_val, call))

        # Group by period
        groups: Dict[str, list] = {}
        for shift_date_val, call in call_data:
            if group_by == "week":
                # Use ISO week start (Monday)
                week_start = shift_date_val - timedelta(days=shift_date_val.weekday())
                key = week_start.isoformat()
            elif group_by == "month":
                key = f"{shift_date_val.year}-{shift_date_val.month:02d}"
            else:  # day
                key = shift_date_val.isoformat()

            if key not in groups:
                groups[key] = []
            groups[key].append(call)

        report = []
        for period, period_calls in sorted(groups.items()):
            type_counts: Dict[str, int] = {}
            response_times = []

            for call in period_calls:
                call_type = call.incident_type or "unknown"
                type_counts[call_type] = type_counts.get(call_type, 0) + 1

                # Compute response time from dispatched_at to on_scene_at
                if call.dispatched_at and call.on_scene_at:
                    delta = (call.on_scene_at - call.dispatched_at).total_seconds()
                    if delta > 0:
                        response_times.append(delta)

            avg_response_seconds = (
                round(sum(response_times) / len(response_times), 1)
                if response_times
                else None
            )

            report.append({
                "period": period,
                "total_calls": len(period_calls),
                "by_type": type_counts,
                "avg_response_seconds": avg_response_seconds,
            })

        return report

    async def get_my_shifts(
        self,
        user_id: UUID,
        organization_id: UUID,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        skip: int = 0,
        limit: int = 50,
    ) -> Tuple[List[Dict], int]:
        """Get all shifts where a user has an assignment or attendance record"""
        # Build subquery for shifts with assignments or attendance for this user
        assignment_shift_ids = (
            select(ShiftAssignment.shift_id)
            .where(ShiftAssignment.user_id == str(user_id))
            .where(ShiftAssignment.organization_id == str(organization_id))
        )
        attendance_shift_ids = (
            select(ShiftAttendance.shift_id)
            .where(ShiftAttendance.user_id == str(user_id))
        )

        query = (
            select(Shift)
            .where(Shift.organization_id == str(organization_id))
            .where(
                or_(
                    Shift.id.in_(assignment_shift_ids),
                    Shift.id.in_(attendance_shift_ids),
                )
            )
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

        # Enrich with user-specific data
        shift_list = []
        for shift in shifts:
            # Get user's assignment for this shift
            assign_result = await self.db.execute(
                select(ShiftAssignment)
                .where(ShiftAssignment.shift_id == shift.id)
                .where(ShiftAssignment.user_id == str(user_id))
            )
            assignment = assign_result.scalar_one_or_none()

            # Get user's attendance for this shift
            att_result = await self.db.execute(
                select(ShiftAttendance)
                .where(ShiftAttendance.shift_id == shift.id)
                .where(ShiftAttendance.user_id == str(user_id))
            )
            attendance = att_result.scalar_one_or_none()

            shift_dict = {
                "id": shift.id,
                "shift_date": shift.shift_date.isoformat() if shift.shift_date else None,
                "start_time": shift.start_time.isoformat() if shift.start_time else None,
                "end_time": shift.end_time.isoformat() if shift.end_time else None,
                "notes": shift.notes,
                "assignment": {
                    "id": assignment.id,
                    "position": assignment.position.value if assignment.position else None,
                    "status": assignment.assignment_status.value if assignment.assignment_status else None,
                    "confirmed_at": assignment.confirmed_at.isoformat() if assignment.confirmed_at else None,
                } if assignment else None,
                "attendance": {
                    "id": attendance.id,
                    "checked_in_at": attendance.checked_in_at.isoformat() if attendance.checked_in_at else None,
                    "checked_out_at": attendance.checked_out_at.isoformat() if attendance.checked_out_at else None,
                    "duration_minutes": attendance.duration_minutes,
                } if attendance else None,
            }
            shift_list.append(shift_dict)

        return shift_list, total
