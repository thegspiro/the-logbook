"""
Scheduling Service

Business logic for shift scheduling including shift management,
attendance tracking, and calendar views.
"""

import calendar
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from sqlalchemy import and_, func, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.training import (
    AssignmentStatus,
    BasicApparatus,
    DueDateType,
    PatternType,
    RequirementFrequency,
    RequirementType,
    Shift,
    ShiftAssignment,
    ShiftAttendance,
    ShiftCall,
    ShiftPattern,
    ShiftPosition,
    ShiftSwapRequest,
    ShiftTemplate,
    ShiftTimeOff,
    SwapRequestStatus,
    TimeOffStatus,
    TrainingRequirement,
)
from zoneinfo import ZoneInfo

from app.models.user import MemberLeaveOfAbsence, Organization, Position, User, user_positions
from app.services.member_leave_service import MemberLeaveService


class SchedulingService:
    """Service for scheduling management"""

    PROTECTED_FIELDS = frozenset(
        {
            "id",
            "organization_id",
            "created_at",
            "updated_at",
            "created_by",
        }
    )

    INACTIVE_ASSIGNMENT_STATUSES = [
        AssignmentStatus.DECLINED,
        AssignmentStatus.CANCELLED,
    ]

    def __init__(self, db: AsyncSession):
        self.db = db

    # ============================================
    # Position Helpers
    # ============================================

    @staticmethod
    def normalize_positions(
        positions: Any,
    ) -> List[Dict[str, Any]]:
        """Convert any legacy position format to structured PositionSlot dicts.

        Supported inputs:
        - ``None`` → ``[]``
        - ``["officer", "emt"]`` → ``[{"position": "officer", "required": True}, ...]``
        - ``[{"position": "officer", "required": True}, ...]`` → pass-through
        - Event metadata dicts (flat_positions / resources) → expanded
        """
        if not positions:
            return []
        # Already structured list
        if isinstance(positions, list):
            out: List[Dict[str, Any]] = []
            for p in positions:
                if isinstance(p, str):
                    out.append({"position": p, "required": True})
                elif isinstance(p, dict) and "position" in p:
                    out.append(
                        {
                            "position": p["position"],
                            "required": p.get("required", True),
                        }
                    )
                # Skip unrecognised entries silently
            return out
        # Event metadata dict
        if isinstance(positions, dict):
            flat = positions.get("flat_positions")
            if isinstance(flat, list) and flat:
                return [{"position": p, "required": True} for p in flat]
            resources = positions.get("resources")
            if isinstance(resources, list):
                result: List[Dict[str, Any]] = []
                for r in resources:
                    qty = r.get("quantity", 1) if isinstance(r, dict) else 1
                    pos_list = r.get("positions", []) if isinstance(r, dict) else []
                    for _ in range(qty):
                        for name in pos_list:
                            result.append({"position": name, "required": True})
                return result
        return []

    @staticmethod
    def _resolve_template_positions(positions: Any) -> Optional[List[str]]:
        """Extract a flat list of position strings (legacy helper).

        Delegates to ``normalize_positions`` and strips structure.
        """
        slots = SchedulingService.normalize_positions(positions)
        if not slots:
            return None
        return [s["position"] for s in slots]

    # ============================================
    # Enrichment Helpers
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

    async def _get_user_name_map(self, user_ids: List[str]) -> Dict[str, str]:
        """Load user display names for a set of user IDs, returning {id: full_name}."""
        if not user_ids:
            return {}
        result = await self.db.execute(
            select(User.id, User.first_name, User.last_name).where(
                User.id.in_(user_ids)
            )
        )
        name_map: Dict[str, str] = {}
        for row in result.all():
            first = row.first_name or ""
            last = row.last_name or ""
            name_map[str(row.id)] = f"{first} {last}".strip() or "Unknown"
        return name_map

    def _enrich_shift_dict(
        self,
        shift_dict: Dict[str, Any],
        apparatus_map: Dict[str, Any],
        user_name_map: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        """Add apparatus details, min_staffing, and shift officer
        name to a shift dict."""
        aid = shift_dict.get("apparatus_id")
        # Normalize positions to structured format
        shift_slots = self.normalize_positions(shift_dict.get("positions"))
        shift_dict["positions"] = shift_slots or None
        if aid and aid in apparatus_map:
            a = apparatus_map[aid]
            shift_dict["apparatus_name"] = a.name
            shift_dict["apparatus_unit_number"] = a.unit_number
            app_slots = self.normalize_positions(a.positions)
            shift_dict["apparatus_positions"] = app_slots or shift_slots or None
            if shift_dict.get("min_staffing") is None:
                shift_dict["min_staffing"] = a.min_staffing
        else:
            shift_dict["apparatus_name"] = None
            shift_dict["apparatus_unit_number"] = None
            shift_dict["apparatus_positions"] = shift_slots or None
            if shift_dict.get("min_staffing") is None:
                shift_dict["min_staffing"] = None

        # Resolve shift officer name
        officer_id = shift_dict.get("shift_officer_id")
        if officer_id and user_name_map:
            shift_dict["shift_officer_name"] = user_name_map.get(str(officer_id))
        elif "shift_officer_name" not in shift_dict:
            shift_dict["shift_officer_name"] = None

        return shift_dict

    async def enrich_assignments(
        self, assignments: List[ShiftAssignment]
    ) -> List[Dict[str, Any]]:
        """Convert assignment ORM objects to dicts with user_name populated."""
        if not assignments:
            return []
        user_ids = list({a.user_id for a in assignments if a.user_id})
        name_map = await self._get_user_name_map(user_ids)
        result = []
        for a in assignments:
            d = {c.key: getattr(a, c.key) for c in a.__table__.columns}
            d["user_name"] = name_map.get(str(a.user_id))
            result.append(d)
        return result

    async def enrich_assignments_with_shifts(
        self, assignments: List[ShiftAssignment], organization_id: UUID
    ) -> List[Dict[str, Any]]:
        """Convert assignment ORM objects to dicts with user_name
        and shift data populated."""
        if not assignments:
            return []
        user_ids = list({a.user_id for a in assignments if a.user_id})
        name_map = await self._get_user_name_map(user_ids)

        # Batch-load shifts for all assignments
        shift_ids = list({a.shift_id for a in assignments if a.shift_id})
        shift_map: Dict[str, Any] = {}
        if shift_ids:
            shift_result = await self.db.execute(
                select(Shift).where(Shift.id.in_(shift_ids))
            )
            for s in shift_result.scalars().all():
                shift_map[str(s.id)] = {
                    "id": s.id,
                    "shift_date": s.shift_date.isoformat() if s.shift_date else None,
                    "start_time": s.start_time.isoformat() if s.start_time else None,
                    "end_time": s.end_time.isoformat() if s.end_time else None,
                    "notes": s.notes,
                    "apparatus_id": s.apparatus_id,
                    "shift_officer_id": s.shift_officer_id,
                    "color": s.color,
                }

        result = []
        for a in assignments:
            d = {c.key: getattr(a, c.key) for c in a.__table__.columns}
            d["user_name"] = name_map.get(str(a.user_id))
            d["shift"] = shift_map.get(str(a.shift_id))
            result.append(d)
        return result

    async def enrich_swap_requests(
        self, swap_requests: List[ShiftSwapRequest]
    ) -> List[Dict[str, Any]]:
        """Convert swap request ORM objects to dicts with user names and shift dates."""
        if not swap_requests:
            return []
        # Collect all user IDs and shift IDs
        user_ids: set = set()
        shift_ids: set = set()
        for sr in swap_requests:
            if sr.requesting_user_id:
                user_ids.add(sr.requesting_user_id)
            if sr.target_user_id:
                user_ids.add(sr.target_user_id)
            if sr.offering_shift_id:
                shift_ids.add(sr.offering_shift_id)
            if sr.requesting_shift_id:
                shift_ids.add(sr.requesting_shift_id)

        name_map = await self._get_user_name_map(list(user_ids))

        # Get shift dates and start times in a single query
        shift_info_map: Dict[str, Dict[str, Any]] = {}
        if shift_ids:
            shift_result = await self.db.execute(
                select(Shift.id, Shift.shift_date, Shift.start_time).where(
                    Shift.id.in_(list(shift_ids))
                )
            )
            for row in shift_result.all():
                shift_info_map[str(row[0])] = {
                    "date": row[1],
                    "start_time": str(row[2]) if row[2] else None,
                }

        result = []
        for sr in swap_requests:
            d = {c.key: getattr(sr, c.key) for c in sr.__table__.columns}
            d["requesting_user_name"] = (
                name_map.get(str(sr.requesting_user_id))
                if sr.requesting_user_id
                else None
            )
            d["target_user_name"] = (
                name_map.get(str(sr.target_user_id)) if sr.target_user_id else None
            )
            offering_info = (
                shift_info_map.get(str(sr.offering_shift_id))
                if sr.offering_shift_id
                else None
            )
            d["offering_shift_date"] = offering_info["date"] if offering_info else None
            d["offering_shift_start_time"] = (
                offering_info["start_time"] if offering_info else None
            )
            requesting_info = (
                shift_info_map.get(str(sr.requesting_shift_id))
                if sr.requesting_shift_id
                else None
            )
            d["requesting_shift_date"] = (
                requesting_info["date"] if requesting_info else None
            )
            d["requesting_shift_start_time"] = (
                requesting_info["start_time"] if requesting_info else None
            )
            result.append(d)
        return result

    async def enrich_time_off_requests(
        self, time_off_requests: List[ShiftTimeOff]
    ) -> List[Dict[str, Any]]:
        """Convert time-off ORM objects to dicts with user_name populated."""
        if not time_off_requests:
            return []
        user_ids = list({t.user_id for t in time_off_requests if t.user_id})
        name_map = await self._get_user_name_map(user_ids)
        result = []
        for t in time_off_requests:
            d = {c.key: getattr(t, c.key) for c in t.__table__.columns}
            d["user_name"] = name_map.get(str(t.user_id))
            result.append(d)
        return result

    async def enrich_attendance_records(
        self,
        attendance_records: List[ShiftAttendance],
        member_call_counts: Optional[Dict[str, int]] = None,
    ) -> List[Dict[str, Any]]:
        """Convert attendance ORM objects to dicts with user_name and
        live call_count populated.

        If ``member_call_counts`` is provided it will be used to fill in
        ``call_count`` for each member.  When omitted the stored value
        on the ORM object (snapshotted at finalization) is used as-is.
        """
        if not attendance_records:
            return []
        user_ids = list({a.user_id for a in attendance_records if a.user_id})
        name_map = await self._get_user_name_map(user_ids)
        result = []
        for a in attendance_records:
            d = {c.key: getattr(a, c.key) for c in a.__table__.columns}
            d["user_name"] = name_map.get(str(a.user_id))
            if member_call_counts is not None:
                d["call_count"] = member_call_counts.get(
                    str(a.user_id), 0
                )
            result.append(d)
        return result

    async def compute_member_call_counts(
        self, shift_id: UUID
    ) -> Dict[str, int]:
        """Count calls per member from ShiftCall.responding_members JSON."""
        call_result = await self.db.execute(
            select(ShiftCall.responding_members).where(
                ShiftCall.shift_id == str(shift_id)
            )
        )
        counts: Dict[str, int] = {}
        for (members,) in call_result.all():
            if not members:
                continue
            for uid in members:
                uid_str = str(uid)
                counts[uid_str] = counts.get(uid_str, 0) + 1
        return counts

    # ============================================
    # Shift Management
    # ============================================

    async def create_shift(
        self, organization_id: UUID, shift_data: Dict[str, Any], created_by: UUID
    ) -> Tuple[Optional[Shift], Optional[str]]:
        """Create a new shift"""
        try:
            shift = Shift(
                organization_id=organization_id, created_by=created_by, **shift_data
            )
            self.db.add(shift)
            await self.db.flush()

            # Auto-assign shift officer to apparatus "officer" position
            if shift.shift_officer_id:
                await self._sync_officer_assignment(
                    shift, shift.shift_officer_id, organization_id
                )

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
        query = select(Shift).where(Shift.organization_id == str(organization_id))

        if start_date:
            query = query.where(Shift.shift_date >= start_date)
        if end_date:
            query = query.where(Shift.shift_date <= end_date)

        # Count
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await self.db.execute(count_query)
        total = total_result.scalar()

        # Paginated results
        query = (
            query.order_by(Shift.shift_date.asc(), Shift.start_time.asc())
            .offset(skip)
            .limit(limit)
        )
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

    async def _sync_officer_assignment(
        self, shift: "Shift", officer_id: str, organization_id: UUID
    ) -> None:
        """Ensure the shift officer is assigned to the 'officer'
        position on the apparatus.

        When a shift officer is designated and the apparatus has an 'officer'
        position, this creates or updates assignments so the officer fills that
        seat on the crew board.
        """
        # Load apparatus to check if it has an "officer" position
        apparatus_id = shift.apparatus_id
        if not apparatus_id:
            return

        apparatus_map = await self._get_apparatus_map(organization_id, [apparatus_id])
        apparatus = apparatus_map.get(apparatus_id)
        if not apparatus or not apparatus.positions:
            return

        # Check if the apparatus has an "officer" position
        has_officer_position = any(p.lower() == "officer" for p in apparatus.positions)
        if not has_officer_position:
            return

        # Check if the officer already has an assignment on this shift
        existing_result = await self.db.execute(
            select(ShiftAssignment)
            .where(ShiftAssignment.shift_id == str(shift.id))
            .where(ShiftAssignment.user_id == str(officer_id))
            .where(ShiftAssignment.assignment_status != AssignmentStatus.DECLINED)
        )
        existing_assignment = existing_result.scalar_one_or_none()

        if existing_assignment:
            # Officer already assigned — update their position to "officer"
            if existing_assignment.position != ShiftPosition.OFFICER:
                existing_assignment.position = ShiftPosition.OFFICER
        else:
            # Create a new assignment for the officer
            new_assignment = ShiftAssignment(
                organization_id=str(organization_id),
                shift_id=str(shift.id),
                user_id=str(officer_id),
                position=ShiftPosition.OFFICER,
                assignment_status=AssignmentStatus.ASSIGNED,
                assigned_by=str(officer_id),
            )
            self.db.add(new_assignment)

        # If a different member had the "officer" position, move them to "firefighter"
        displaced_result = await self.db.execute(
            select(ShiftAssignment)
            .where(ShiftAssignment.shift_id == str(shift.id))
            .where(ShiftAssignment.user_id != str(officer_id))
            .where(ShiftAssignment.position == ShiftPosition.OFFICER)
            .where(ShiftAssignment.assignment_status != AssignmentStatus.DECLINED)
        )
        for displaced in displaced_result.scalars().all():
            displaced.position = ShiftPosition.FIREFIGHTER

    async def update_shift(
        self, shift_id: UUID, organization_id: UUID, update_data: Dict[str, Any]
    ) -> Tuple[Optional[Shift], Optional[str]]:
        """Update a shift"""
        try:
            shift = await self.get_shift_by_id(shift_id, organization_id)
            if not shift:
                return None, "Shift not found"

            old_officer_id = shift.shift_officer_id

            for key, value in update_data.items():
                if key not in self.PROTECTED_FIELDS:
                    setattr(shift, key, value)

            # Auto-assign new shift officer to apparatus "officer" position
            new_officer_id = shift.shift_officer_id
            if new_officer_id and new_officer_id != old_officer_id:
                await self._sync_officer_assignment(
                    shift, new_officer_id, organization_id
                )

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

            if attendance.checked_in_at and attendance.checked_out_at:
                delta = attendance.checked_out_at - attendance.checked_in_at
                attendance.duration_minutes = int(delta.total_seconds() / 60)

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
            select(func.count(Shift.id)).where(
                Shift.organization_id == str(organization_id)
            )
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
        if first_of_month.month == 12:
            next_month_first = first_of_month.replace(
                year=first_of_month.year + 1, month=1
            )
        else:
            next_month_first = first_of_month.replace(month=first_of_month.month + 1)
        month_result = await self.db.execute(
            select(func.count(Shift.id))
            .where(Shift.organization_id == str(organization_id))
            .where(Shift.shift_date >= first_of_month)
            .where(Shift.shift_date < next_month_first)
        )
        shifts_this_month = month_result.scalar() or 0

        # Total hours this month (from attendance)
        hours_result = await self.db.execute(
            select(func.coalesce(func.sum(ShiftAttendance.duration_minutes), 0))
            .join(Shift, ShiftAttendance.shift_id == Shift.id)
            .where(Shift.organization_id == str(organization_id))
            .where(Shift.shift_date >= first_of_month)
            .where(Shift.shift_date < next_month_first)
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
                shift_id=shift_id, organization_id=organization_id, **call_data
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
                organization_id=organization_id, created_by=created_by, **template_data
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
        query = select(ShiftTemplate).where(
            ShiftTemplate.organization_id == str(organization_id)
        )
        if active_only:
            query = query.where(ShiftTemplate.is_active == True)  # noqa: E712

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
                organization_id=organization_id, created_by=created_by, **pattern_data
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
        query = select(ShiftPattern).where(
            ShiftPattern.organization_id == str(organization_id)
        )
        if active_only:
            query = query.where(ShiftPattern.is_active == True)  # noqa: E712

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

            # Load the associated template (required for shift times)
            if not pattern.template_id:
                return (
                    [],
                    "A shift template must be linked to the "
                    "pattern before generating shifts",
                )
            template = await self.get_template_by_id(
                pattern.template_id, organization_id
            )
            if not template:
                return (
                    [],
                    "Linked shift template was not found — it may have been deleted",
                )

            # Parse template times safely
            try:
                start_hour, start_minute = map(
                    int, template.start_time_of_day.split(":")
                )
                end_hour, end_minute = map(int, template.end_time_of_day.split(":"))
            except (ValueError, AttributeError):
                return [], "Invalid time format in template. Expected HH:MM."

            # Fetch the organization timezone so template local times
            # are stored as proper UTC datetimes.
            org_result = await self.db.execute(
                select(Organization).where(Organization.id == str(organization_id))
            )
            org = org_result.scalar_one_or_none()
            org_tz = (
                ZoneInfo(org.timezone)
                if org and org.timezone
                else ZoneInfo("America/New_York")
            )

            config = pattern.schedule_config or {}

            # -----------------------------------------------------------
            # Resolve day/night templates for cycle_pattern support.
            # When a platoon pattern uses cycle_pattern with "day"/"night"
            # entries, optional day_template_id / night_template_id in
            # schedule_config point to separate ShiftTemplate records so
            # day and night shifts can have different start/end times and
            # colors.  Falls back to the main template when unset.
            # -----------------------------------------------------------
            cycle_pattern_cfg = (
                config.get("cycle_pattern") if isinstance(config, dict) else None
            )
            if cycle_pattern_cfg and not isinstance(cycle_pattern_cfg, list):
                cycle_pattern_cfg = None

            day_tmpl_times = (start_hour, start_minute, end_hour, end_minute)
            night_tmpl_times = (start_hour, start_minute, end_hour, end_minute)
            day_tmpl_color = template.color
            night_tmpl_color = template.color

            if cycle_pattern_cfg and any(
                e in ("day", "night") for e in cycle_pattern_cfg
            ):
                raw_day_id = config.get("day_template_id")
                raw_night_id = config.get("night_template_id")
                if raw_day_id:
                    dt = await self.get_template_by_id(
                        UUID(str(raw_day_id)), organization_id
                    )
                    if dt:
                        dh, dm = map(int, dt.start_time_of_day.split(":"))
                        deh, dem = map(int, dt.end_time_of_day.split(":"))
                        day_tmpl_times = (dh, dm, deh, dem)
                        day_tmpl_color = dt.color
                if raw_night_id:
                    nt = await self.get_template_by_id(
                        UUID(str(raw_night_id)), organization_id
                    )
                    if nt:
                        nh, nm = map(int, nt.start_time_of_day.split(":"))
                        neh, nem = map(int, nt.end_time_of_day.split(":"))
                        night_tmpl_times = (nh, nm, neh, nem)
                        night_tmpl_color = nt.color

            # Determine which dates get a shift and what type they are.
            # shift_type_map tracks the cycle entry ("on"/"day"/"night")
            # for each date so we can pick the right template later.
            shift_dates: list[date] = []
            shift_type_map: dict[date, str] = {}
            current = start_date
            while current <= end_date:
                should_create = False
                entry_type = "on"

                if pattern.pattern_type == PatternType.DAILY:
                    should_create = True

                elif pattern.pattern_type == PatternType.WEEKLY:
                    weekdays = config.get("weekdays", [])
                    # Frontend stores weekdays in JS convention
                    # (0=Sun, 1=Mon, …, 6=Sat).
                    # Python's date.weekday() returns 0=Mon, …, 6=Sun.
                    # Convert Python weekday → JS weekday before comparing.
                    js_weekday = (current.weekday() + 1) % 7
                    if js_weekday in weekdays:
                        should_create = True

                elif pattern.pattern_type == PatternType.PLATOON:
                    if cycle_pattern_cfg and len(cycle_pattern_cfg) > 0:
                        # Advanced cycle: array of "on"/"off"/"day"/"night"
                        cycle_length = len(cycle_pattern_cfg)
                        days_since_start = (current - pattern.start_date).days
                        position_in_cycle = days_since_start % cycle_length
                        entry = cycle_pattern_cfg[position_in_cycle]
                        if isinstance(entry, str) and entry != "off":
                            should_create = True
                            entry_type = entry
                    else:
                        # Simple on/off cycle
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
                    shift_type_map[current] = entry_type

                current += timedelta(days=1)

            # Helper: resolve template times and color for a given shift type
            def _resolve_times(stype: str) -> tuple:
                """Return (s_hour, s_min, e_hour, e_min, color) for a shift type."""
                if stype == "night":
                    return (*night_tmpl_times, night_tmpl_color)
                if stype == "day":
                    return (*day_tmpl_times, day_tmpl_color)
                return (start_hour, start_minute, end_hour, end_minute, template.color)

            # Duplicate guard: skip dates that already have a shift starting
            # at the same time (allows multiple shifts per day, e.g. day + night)
            if shift_dates:
                existing_result = await self.db.execute(
                    select(Shift.shift_date, Shift.start_time)
                    .where(Shift.organization_id == str(organization_id))
                    .where(Shift.shift_date.in_(shift_dates))
                )
                existing_shifts = {
                    (row[0], row[1].hour, row[1].minute)
                    for row in existing_result.all()
                }
                filtered_dates: list[date] = []
                for d in shift_dates:
                    sh, sm, _eh, _em, _c = _resolve_times(shift_type_map.get(d, "on"))
                    # Convert local template time to UTC for comparison
                    # with existing DB records (stored as UTC).
                    local_dt = datetime(d.year, d.month, d.day, sh, sm, tzinfo=org_tz)
                    utc_dt = local_dt.astimezone(timezone.utc)
                    if (d, utc_dt.hour, utc_dt.minute) not in existing_shifts:
                        filtered_dates.append(d)
                shift_dates = filtered_dates

            # Create shifts for each date
            created_shifts = []
            for shift_date_val in shift_dates:
                s_hour, s_minute, e_hour, e_minute, shift_color = _resolve_times(
                    shift_type_map.get(shift_date_val, "on")
                )
                # Build datetimes in the org's local timezone, then
                # convert to UTC for storage so the frontend's
                # timezone-aware formatting produces the correct local time.
                shift_start_local = datetime(
                    shift_date_val.year,
                    shift_date_val.month,
                    shift_date_val.day,
                    s_hour,
                    s_minute,
                    tzinfo=org_tz,
                )
                shift_start = shift_start_local.astimezone(timezone.utc)
                shift_end_local = datetime(
                    shift_date_val.year,
                    shift_date_val.month,
                    shift_date_val.day,
                    e_hour,
                    e_minute,
                    tzinfo=org_tz,
                )
                shift_end = shift_end_local.astimezone(timezone.utc)
                # If end time is before start time, the shift ends the next day
                if shift_end <= shift_start:
                    shift_end += timedelta(days=1)

                shift = Shift(
                    organization_id=organization_id,
                    shift_date=shift_date_val,
                    start_time=shift_start,
                    end_time=shift_end,
                    apparatus_id=getattr(template, "apparatus_id", None),
                    color=shift_color,
                    positions=self._resolve_template_positions(
                        getattr(template, "positions", None)
                    ),
                    min_staffing=getattr(template, "min_staffing", None),
                    created_by=created_by,
                )
                self.db.add(shift)
                await self.db.flush()  # Get the shift ID without committing

                # Auto-create assignments for assigned members (skip duplicates)
                assigned_members = pattern.assigned_members or []
                seen_users: set[str] = set()
                for member in assigned_members:
                    member_user_id = member.get("user_id")
                    if not member_user_id or member_user_id in seen_users:
                        continue
                    seen_users.add(member_user_id)
                    assignment = ShiftAssignment(
                        organization_id=organization_id,
                        shift_id=shift.id,
                        user_id=member_user_id,
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

            user_id = assignment_data.get("user_id")

            # Prevent duplicate assignment to the same shift
            if user_id:
                dup_result = await self.db.execute(
                    select(ShiftAssignment.id)
                    .where(ShiftAssignment.shift_id == str(shift_id))
                    .where(ShiftAssignment.user_id == str(user_id))
                    .where(
                        ShiftAssignment.assignment_status.notin_(
                            self.INACTIVE_ASSIGNMENT_STATUSES
                        )
                    )
                )
                if dup_result.scalar_one_or_none():
                    return None, "Member is already assigned to this shift"

            # Check for overlapping shift assignments
            if user_id and shift.start_time:
                # Scope to nearby dates (±1 day) to avoid scanning the whole table
                # and to avoid false positives from ancient unclosed shifts
                date_lo = shift.shift_date - timedelta(days=1)
                date_hi = shift.shift_date + timedelta(days=1)
                overlap_query = (
                    select(Shift.shift_date, Shift.start_time)
                    .join(ShiftAssignment, ShiftAssignment.shift_id == Shift.id)
                    .where(ShiftAssignment.user_id == str(user_id))
                    .where(
                        ShiftAssignment.assignment_status.notin_(
                            self.INACTIVE_ASSIGNMENT_STATUSES
                        )
                    )
                    .where(Shift.id != str(shift_id))
                    .where(Shift.organization_id == str(organization_id))
                    .where(Shift.shift_date.between(date_lo, date_hi))
                )
                # Check time overlap: other shift starts before this one ends
                # AND other shift ends after this one starts.
                # When the other shift has no end_time, restrict the match to
                # the same shift_date so open-ended shifts are not treated as
                # infinitely long (which caused false positives across UTC
                # date boundaries).
                if shift.end_time:
                    overlap_query = overlap_query.where(
                        Shift.start_time < shift.end_time,
                        or_(
                            and_(
                                Shift.end_time.is_(None),
                                Shift.shift_date == shift.shift_date,
                            ),
                            Shift.end_time > shift.start_time,
                        ),
                    )
                else:
                    # No end time on this shift — check same-day overlap
                    overlap_query = overlap_query.where(
                        Shift.shift_date == shift.shift_date,
                    )
                overlap_result = await self.db.execute(overlap_query)
                conflicting_rows = overlap_result.all()
                if conflicting_rows:
                    conflict_dates = sorted({str(row[0]) for row in conflicting_rows})
                    if len(conflict_dates) == 1:
                        return (
                            None,
                            f"Member has a conflicting shift on {conflict_dates[0]}",
                        )
                    return (
                        None,
                        f"Member has conflicting shifts on {', '.join(conflict_dates)}",
                    )

            # Check if the member is on leave of absence for the shift date
            if user_id and shift.shift_date:
                leave_svc = MemberLeaveService(self.db)
                leaves = await leave_svc.get_active_leaves_for_user(
                    str(organization_id),
                    str(user_id),
                    shift.shift_date,
                    shift.shift_date,
                )
                if leaves:
                    return None, "Member is on leave of absence for this date"

            assignment = ShiftAssignment(
                organization_id=organization_id,
                shift_id=shift_id,
                assigned_by=assigned_by,
                **assignment_data,
            )
            self.db.add(assignment)

            # Auto-set shift officer when an officer-position member
            # is assigned/signs up
            # and no shift officer has been designated yet
            officer_positions = {
                ShiftPosition.OFFICER.value,
                ShiftPosition.CAPTAIN.value,
                ShiftPosition.LIEUTENANT.value,
            }
            assigned_position = assignment_data.get("position", "")
            if isinstance(assigned_position, ShiftPosition):
                assigned_position = assigned_position.value
            if (
                not shift.shift_officer_id
                and assigned_position in officer_positions
                and user_id
            ):
                shift.shift_officer_id = str(user_id)

            await self.db.commit()
            await self.db.refresh(assignment)

            if user_id:
                await self._notify_shift_assignment(
                    shift_id=str(shift_id),
                    user_id=str(user_id),
                    position=assigned_position or "",
                    organization_id=organization_id,
                )
                await self.db.commit()

            return assignment, None
        except IntegrityError:
            await self.db.rollback()
            return None, "Member is already assigned to this shift"
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

            old_status = assignment.assignment_status
            position = assignment.position

            for key, value in update_data.items():
                if key not in self.PROTECTED_FIELDS:
                    setattr(assignment, key, value)

            await self.db.commit()
            await self.db.refresh(assignment)

            # Fire decline notification if status changed to declined
            new_status = assignment.assignment_status
            if (
                old_status != AssignmentStatus.DECLINED
                and new_status == AssignmentStatus.DECLINED
            ):
                await self._notify_shift_decline(
                    shift_id=assignment.shift_id,
                    user_id=assignment.user_id,
                    position=str(position or ""),
                    organization_id=organization_id,
                    action="declined",
                )

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

            # Capture info before deletion for notification
            shift_id = assignment.shift_id
            user_id = assignment.user_id
            position = str(assignment.position or "")

            await self.db.delete(assignment)
            await self.db.commit()

            # Fire removal notification
            await self._notify_shift_decline(
                shift_id=shift_id,
                user_id=user_id,
                position=position,
                organization_id=organization_id,
                action="removed",
            )

            return True, None
        except Exception as e:
            await self.db.rollback()
            return False, str(e)

    async def confirm_assignment(
        self, assignment_id: UUID, user_id: UUID, organization_id: Optional[UUID] = None
    ) -> Tuple[Optional[ShiftAssignment], Optional[str]]:
        """Confirm a shift assignment (by the assigned user)"""
        try:
            query = (
                select(ShiftAssignment)
                .where(ShiftAssignment.id == str(assignment_id))
                .where(ShiftAssignment.user_id == str(user_id))
            )
            if organization_id:
                query = query.where(
                    ShiftAssignment.organization_id == str(organization_id)
                )
            result = await self.db.execute(query)
            assignment = result.scalar_one_or_none()
            if not assignment:
                return None, "Shift assignment not found or not assigned to you"

            assignment.assignment_status = AssignmentStatus.CONFIRMED
            assignment.confirmed_at = datetime.now(timezone.utc)

            await self.db.commit()
            await self.db.refresh(assignment)

            org_id = organization_id or assignment.organization_id
            if org_id:
                await self._notify_shift_confirmed(
                    assignment=assignment,
                    organization_id=org_id,
                )
                await self.db.commit()

            return assignment, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    # ============================================
    # Shift Decline / Drop Notifications
    # ============================================

    async def _notify_shift_decline(
        self,
        shift_id: str,
        user_id: str,
        position: str,
        organization_id: UUID,
        action: str = "declined",
    ) -> None:
        """Send in-app (and optionally email) notifications when a
        member declines or is removed from a shift.

        Reads ``org.settings["scheduling"]`` to decide who to notify
        and whether to send email.  Failures are logged but never
        propagated — the caller should not fail because of a
        notification error.
        """
        from loguru import logger

        try:
            # Load org + settings
            org_result = await self.db.execute(
                select(Organization).where(Organization.id == str(organization_id))
            )
            org = org_result.scalar_one_or_none()
            if not org:
                return

            sched_cfg = (org.settings or {}).get("scheduling", {})
            if not sched_cfg.get("notify_on_decline", True):
                return

            # Load shift
            shift_result = await self.db.execute(
                select(Shift).where(Shift.id == str(shift_id))
            )
            shift = shift_result.scalar_one_or_none()
            if not shift:
                return

            # Load user who declined
            user_result = await self.db.execute(
                select(User).where(User.id == str(user_id))
            )
            declined_user = user_result.scalar_one_or_none()
            user_name = "Unknown"
            if declined_user:
                first = declined_user.first_name or ""
                last = declined_user.last_name or ""
                user_name = f"{first} {last}".strip() or "Unknown"

            # Collect recipient user IDs
            recipient_ids: set[str] = set()

            # Shift officer
            if sched_cfg.get("notify_shift_officer", True):
                if shift.shift_officer_id:
                    recipient_ids.add(str(shift.shift_officer_id))

            # Users with matching roles
            notify_roles = sched_cfg.get("notify_roles", [])
            if notify_roles:
                from app.models.user import Role, user_positions

                role_result = await self.db.execute(
                    select(user_positions.c.user_id)
                    .join(
                        Role,
                        Role.id == user_positions.c.position_id,
                    )
                    .where(
                        Role.organization_id == str(organization_id),
                        Role.slug.in_(notify_roles),
                    )
                )
                for row in role_result.all():
                    recipient_ids.add(str(row[0]))

            # Don't notify the user who declined
            recipient_ids.discard(str(user_id))
            if not recipient_ids:
                return

            from app.core.utils import generate_uuid
            from app.models.notification import NotificationLog

            shift_date_str = (
                shift.shift_date.isoformat() if shift.shift_date else "unknown date"
            )
            message = (
                f"{user_name} {action} the {position} position "
                f"on the {shift_date_str} shift. "
                f"This position is now open."
            )

            for rid in recipient_ids:
                notif = NotificationLog(
                    id=generate_uuid(),
                    organization_id=str(organization_id),
                    recipient_id=rid,
                    channel="in_app",
                    category="shift_decline",
                    subject="Shift Coverage Needed",
                    message=message,
                    action_url=f"/scheduling?shift={shift_id}",
                    delivered=True,
                )
                self.db.add(notif)
            await self.db.flush()

            # Optional email
            if sched_cfg.get("send_email", False):
                try:
                    from app.services.email_service import EmailService

                    recipient_result = await self.db.execute(
                        select(User.email).where(
                            User.id.in_(list(recipient_ids)),
                            User.email.isnot(None),
                        )
                    )
                    to_emails = [r[0] for r in recipient_result.all() if r[0]]
                    cc_emails = sched_cfg.get("cc_emails", [])
                    if to_emails:
                        email_svc = EmailService(organization=org)
                        subject = (
                            f"Shift Coverage Needed \u2014 "
                            f"{position} on {shift_date_str}"
                        )
                        html_body = (
                            f"<p>{message}</p>"
                            f"<p>Please log in to the scheduling "
                            f"module to assign a replacement.</p>"
                        )
                        await email_svc.send_email(
                            to_emails=to_emails,
                            subject=subject,
                            html_body=html_body,
                            cc_emails=cc_emails or None,
                            db=self.db,
                            template_type="shift_decline",
                        )
                except Exception as email_err:
                    logger.warning(f"Shift decline email failed: {email_err}")

        except Exception as e:
            logger.warning(f"Shift decline notification failed: {e}")

    async def _notify_shift_assignment(
        self,
        shift_id: str,
        user_id: str,
        position: str,
        organization_id: UUID,
    ) -> None:
        """Send in-app (and optionally email) notification when a
        member is assigned to a shift.

        Reads ``org.settings["scheduling_assignment"]`` to decide
        whether to notify and whether to send email.  Failures are
        logged but never propagated.
        """
        from loguru import logger

        try:
            org_result = await self.db.execute(
                select(Organization).where(Organization.id == str(organization_id))
            )
            org = org_result.scalar_one_or_none()
            if not org:
                return

            assign_cfg = (org.settings or {}).get("scheduling_assignment", {})
            if not assign_cfg.get("notify_on_assignment", True):
                return

            shift_result = await self.db.execute(
                select(Shift).where(Shift.id == str(shift_id))
            )
            shift = shift_result.scalar_one_or_none()
            if not shift:
                return

            shift_date_str = (
                shift.shift_date.isoformat() if shift.shift_date else "unknown date"
            )
            position_label = position or "unspecified"

            from app.core.utils import generate_uuid
            from app.models.apparatus import EquipmentCheckTemplate
            from app.models.notification import NotificationLog

            org_tz = ZoneInfo(
                org.timezone if org.timezone else "America/New_York"
            )

            message = (
                f"You have been assigned to the {position_label} position "
                f"on the {shift_date_str} shift."
            )
            if shift.start_time:
                local_start = shift.start_time.astimezone(org_tz)
                message = (
                    f"You have been assigned to the {position_label} position "
                    f"on the {shift_date_str} shift "
                    f"(starts {local_start.strftime('%H:%M')})."
                )

            checklist_names: list[str] = []
            if shift.apparatus_id:
                tmpl_result = await self.db.execute(
                    select(EquipmentCheckTemplate)
                    .where(
                        EquipmentCheckTemplate.organization_id
                        == str(organization_id)
                    )
                    .where(
                        EquipmentCheckTemplate.apparatus_id
                        == str(shift.apparatus_id)
                    )
                    .where(
                        EquipmentCheckTemplate.check_timing
                        == "start_of_shift"
                    )
                    .where(EquipmentCheckTemplate.is_active == True)  # noqa: E712
                    .order_by(EquipmentCheckTemplate.sort_order)
                )
                templates = list(tmpl_result.scalars().all())
                checklist_names = [t.name for t in templates]

                if not checklist_names:
                    type_result = await self.db.execute(
                        select(EquipmentCheckTemplate)
                        .where(
                            EquipmentCheckTemplate.organization_id
                            == str(organization_id)
                        )
                        .where(
                            EquipmentCheckTemplate.apparatus_id.is_(None)
                        )
                        .where(
                            EquipmentCheckTemplate.check_timing
                            == "start_of_shift"
                        )
                        .where(EquipmentCheckTemplate.is_active == True)  # noqa: E712
                        .order_by(EquipmentCheckTemplate.sort_order)
                    )
                    type_templates = list(type_result.scalars().all())
                    checklist_names = [t.name for t in type_templates]

            if checklist_names:
                checklist_list = ", ".join(checklist_names)
                message += (
                    f" Equipment checklists to complete: "
                    f"{checklist_list}."
                )

            notif_metadata = {"shift_id": str(shift_id)}
            if shift.start_time:
                notif_metadata["shift_start_time"] = (
                    shift.start_time.isoformat()
                )

            notif = NotificationLog(
                id=generate_uuid(),
                organization_id=str(organization_id),
                recipient_id=str(user_id),
                channel="in_app",
                category="shift_assignment",
                subject="New Shift Assignment",
                message=message,
                action_url=f"/scheduling?shift={shift_id}",
                metadata=notif_metadata,
                delivered=True,
            )
            self.db.add(notif)
            await self.db.flush()

            if assign_cfg.get("send_email", False):
                try:
                    from app.services.email_service import EmailService

                    user_result = await self.db.execute(
                        select(User.email).where(
                            User.id == str(user_id),
                            User.email.isnot(None),
                        )
                    )
                    row = user_result.one_or_none()
                    to_email = row[0] if row else None
                    cc_emails = assign_cfg.get("cc_emails", [])
                    if to_email:
                        email_svc = EmailService(organization=org)
                        subject = (
                            f"Shift Assignment \u2014 "
                            f"{position_label} on {shift_date_str}"
                        )
                        html_body = (
                            f"<p>{message}</p>"
                            f"<p>Please log in to the scheduling "
                            f"module to confirm or decline this assignment.</p>"
                        )
                        await email_svc.send_email(
                            to_emails=[to_email],
                            subject=subject,
                            html_body=html_body,
                            cc_emails=cc_emails or None,
                            db=self.db,
                            template_type="shift_assignment",
                        )
                except Exception as email_err:
                    logger.warning(f"Shift assignment email failed: {email_err}")

        except Exception as e:
            logger.warning(f"Shift assignment notification failed: {e}")

    async def _notify_swap_request(
        self,
        swap_request: ShiftSwapRequest,
        organization_id: UUID,
    ) -> None:
        """Notify the target user (or shift officer) about a new swap request."""
        from loguru import logger

        try:
            from app.core.utils import generate_uuid
            from app.models.notification import NotificationLog

            org_result = await self.db.execute(
                select(Organization).where(
                    Organization.id == str(organization_id)
                )
            )
            org = org_result.scalar_one_or_none()
            if not org:
                return

            # Load requesting user name
            req_result = await self.db.execute(
                select(User).where(
                    User.id == str(swap_request.requesting_user_id)
                )
            )
            req_user = req_result.scalar_one_or_none()
            req_name = "A member"
            if req_user:
                first = req_user.first_name or ""
                last = req_user.last_name or ""
                req_name = f"{first} {last}".strip() or "A member"

            # Load offering shift date
            shift_result = await self.db.execute(
                select(Shift).where(
                    Shift.id == str(swap_request.offering_shift_id)
                )
            )
            offering_shift = shift_result.scalar_one_or_none()
            shift_date_str = (
                offering_shift.shift_date.isoformat()
                if offering_shift and offering_shift.shift_date
                else "unknown date"
            )

            recipient_ids: set[str] = set()

            # Notify target user if specified
            if swap_request.target_user_id:
                recipient_ids.add(str(swap_request.target_user_id))
            elif offering_shift and offering_shift.shift_officer_id:
                # Open request — notify the shift officer
                recipient_ids.add(str(offering_shift.shift_officer_id))

            recipient_ids.discard(str(swap_request.requesting_user_id))
            if not recipient_ids:
                return

            message = (
                f"{req_name} has requested a shift swap "
                f"for the {shift_date_str} shift. "
                f"Please review and respond."
            )

            for rid in recipient_ids:
                notif = NotificationLog(
                    id=generate_uuid(),
                    organization_id=str(organization_id),
                    recipient_id=rid,
                    channel="in_app",
                    category="shift_swap",
                    subject="Shift Swap Request",
                    message=message,
                    action_url=f"/scheduling?shift={swap_request.offering_shift_id}",
                    delivered=True,
                )
                self.db.add(notif)
            await self.db.flush()

        except Exception as e:
            logger.warning(f"Swap request notification failed: {e}")

    async def _notify_swap_reviewed(
        self,
        swap_request: ShiftSwapRequest,
        organization_id: UUID,
        status: SwapRequestStatus,
    ) -> None:
        """Notify the requesting user about swap approval/denial."""
        from loguru import logger

        try:
            from app.core.utils import generate_uuid
            from app.models.notification import NotificationLog

            status_label = (
                "approved" if status == SwapRequestStatus.APPROVED
                else "denied"
            )

            shift_result = await self.db.execute(
                select(Shift).where(
                    Shift.id == str(swap_request.offering_shift_id)
                )
            )
            offering_shift = shift_result.scalar_one_or_none()
            shift_date_str = (
                offering_shift.shift_date.isoformat()
                if offering_shift and offering_shift.shift_date
                else "unknown date"
            )

            message = (
                f"Your shift swap request for the {shift_date_str} "
                f"shift has been {status_label}."
            )

            notif = NotificationLog(
                id=generate_uuid(),
                organization_id=str(organization_id),
                recipient_id=str(swap_request.requesting_user_id),
                channel="in_app",
                category="shift_swap",
                subject=f"Swap Request {status_label.title()}",
                message=message,
                action_url=f"/scheduling?shift={swap_request.offering_shift_id}",
                delivered=True,
            )
            self.db.add(notif)
            await self.db.flush()

        except Exception as e:
            logger.warning(f"Swap review notification failed: {e}")

    async def _notify_shift_confirmed(
        self,
        assignment: ShiftAssignment,
        organization_id: UUID,
    ) -> None:
        """Notify the shift officer when a member confirms their assignment."""
        from loguru import logger

        try:
            from app.core.utils import generate_uuid
            from app.models.notification import NotificationLog

            shift_result = await self.db.execute(
                select(Shift).where(
                    Shift.id == str(assignment.shift_id)
                )
            )
            shift = shift_result.scalar_one_or_none()
            if not shift or not shift.shift_officer_id:
                return

            # Don't notify the officer about their own confirmation
            if str(shift.shift_officer_id) == str(assignment.user_id):
                return

            user_result = await self.db.execute(
                select(User).where(User.id == str(assignment.user_id))
            )
            user = user_result.scalar_one_or_none()
            user_name = "A member"
            if user:
                first = user.first_name or ""
                last = user.last_name or ""
                user_name = f"{first} {last}".strip() or "A member"

            shift_date_str = (
                shift.shift_date.isoformat()
                if shift.shift_date
                else "unknown date"
            )
            position_label = str(assignment.position or "")

            message = (
                f"{user_name} has confirmed the "
                f"{position_label} position "
                f"on the {shift_date_str} shift."
            )

            notif = NotificationLog(
                id=generate_uuid(),
                organization_id=str(organization_id),
                recipient_id=str(shift.shift_officer_id),
                channel="in_app",
                category="shift_confirmation",
                subject="Shift Assignment Confirmed",
                message=message,
                action_url=f"/scheduling?shift={assignment.shift_id}",
                delivered=True,
            )
            self.db.add(notif)
            await self.db.flush()

        except Exception as e:
            logger.warning(f"Shift confirmation notification failed: {e}")

    async def _notify_time_off_reviewed(
        self,
        time_off: ShiftTimeOff,
        organization_id: UUID,
        status: TimeOffStatus,
    ) -> None:
        """Notify the member about their time-off request decision."""
        from loguru import logger

        try:
            from app.core.utils import generate_uuid
            from app.models.notification import NotificationLog

            if not time_off.user_id:
                return

            status_label = (
                "approved" if status == TimeOffStatus.APPROVED
                else "denied"
            )

            start_str = (
                time_off.start_date.isoformat()
                if time_off.start_date
                else "unknown"
            )
            end_str = (
                time_off.end_date.isoformat()
                if time_off.end_date
                else "unknown"
            )

            message = (
                f"Your time-off request for "
                f"{start_str} to {end_str} "
                f"has been {status_label}."
            )

            notif = NotificationLog(
                id=generate_uuid(),
                organization_id=str(organization_id),
                recipient_id=str(time_off.user_id),
                channel="in_app",
                category="time_off",
                subject=f"Time-Off Request {status_label.title()}",
                message=message,
                action_url="/scheduling",
                delivered=True,
            )
            self.db.add(notif)
            await self.db.flush()

        except Exception as e:
            logger.warning(f"Time-off review notification failed: {e}")

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
                **swap_data,
            )
            self.db.add(swap_request)
            await self.db.commit()
            await self.db.refresh(swap_request)

            await self._notify_swap_request(
                swap_request=swap_request,
                organization_id=organization_id,
            )
            await self.db.commit()

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
        query = select(ShiftSwapRequest).where(
            ShiftSwapRequest.organization_id == str(organization_id)
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
        query = (
            query.order_by(ShiftSwapRequest.created_at.desc()).offset(skip).limit(limit)
        )
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
            swap_request = await self.get_swap_request_by_id(
                request_id, organization_id
            )
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
                        .where(
                            ShiftAssignment.shift_id == swap_request.requesting_shift_id
                        )
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

            await self._notify_swap_reviewed(
                swap_request=swap_request,
                organization_id=organization_id,
                status=status,
            )
            await self.db.commit()

            return swap_request, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    async def cancel_swap_request(
        self, request_id: UUID, organization_id: UUID, user_id: UUID
    ) -> Tuple[Optional[ShiftSwapRequest], Optional[str]]:
        """Cancel a swap request (only by the requesting user)"""
        try:
            swap_request = await self.get_swap_request_by_id(
                request_id, organization_id
            )
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
                organization_id=organization_id, user_id=user_id, **time_off_data
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
        query = select(ShiftTimeOff).where(
            ShiftTimeOff.organization_id == str(organization_id)
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
        """Review (approve/deny) a time-off request.

        When approved, automatically cancels any conflicting shift assignments
        for the member within the time-off date range.
        """
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

            # When approving, cancel conflicting shift assignments
            if status == TimeOffStatus.APPROVED and time_off.user_id:
                cancelled_count = await self._cancel_conflicting_assignments(
                    organization_id=organization_id,
                    user_id=time_off.user_id,
                    start_date=time_off.start_date,
                    end_date=time_off.end_date,
                )
                if cancelled_count > 0:
                    conflict_note = (
                        f" ({cancelled_count} conflicting assignment"
                        f"{'s' if cancelled_count != 1 else ''} auto-cancelled)"
                    )
                    time_off.reviewer_notes = (
                        time_off.reviewer_notes or ""
                    ) + conflict_note

            await self.db.commit()
            await self.db.refresh(time_off)

            await self._notify_time_off_reviewed(
                time_off=time_off,
                organization_id=organization_id,
                status=status,
            )
            await self.db.commit()

            return time_off, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)

    async def _cancel_conflicting_assignments(
        self,
        organization_id: UUID,
        user_id: str,
        start_date,
        end_date,
    ) -> int:
        """Cancel shift assignments that overlap with an approved time-off range.

        Returns the number of assignments cancelled.
        """
        result = await self.db.execute(
            select(ShiftAssignment)
            .join(Shift, ShiftAssignment.shift_id == Shift.id)
            .where(ShiftAssignment.user_id == str(user_id))
            .where(Shift.organization_id == str(organization_id))
            .where(Shift.shift_date >= start_date)
            .where(Shift.shift_date <= end_date)
            .where(
                ShiftAssignment.assignment_status.notin_(
                    self.INACTIVE_ASSIGNMENT_STATUSES
                )
            )
        )
        conflicting = result.scalars().all()
        for assignment in conflicting:
            assignment.assignment_status = AssignmentStatus.CANCELLED
        return len(conflicting)

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
            unavailable.append(
                {
                    "user_id": record.user_id,
                    "start_date": record.start_date.isoformat(),
                    "end_date": record.end_date.isoformat(),
                    "reason": record.reason,
                }
            )

        return unavailable

    async def get_availability_summary(
        self,
        organization_id: UUID,
        start_date: date,
        end_date: date,
    ) -> List[Dict]:
        """Build per-member availability summaries for a date range.

        For each active member, computes:
        - total_shifts_assigned: how many shifts they're assigned to
        - time_off_days: approved time-off days in the range
        - unavailable_dates: specific dates with time-off
        - available_dates: dates in range without time-off
        """
        total_days = (end_date - start_date).days + 1
        all_dates = {
            (start_date + timedelta(days=i)).isoformat()
            for i in range(total_days)
        }

        # Active org members
        user_result = await self.db.execute(
            select(User.id, User.first_name, User.last_name, User.email).where(
                User.organization_id == str(organization_id),
                User.status == "active",
            )
        )
        users = user_result.all()

        if not users:
            return []

        user_ids = [str(u.id) for u in users]

        # Shift assignments per user
        assign_result = await self.db.execute(
            select(
                ShiftAssignment.user_id,
                func.count(ShiftAssignment.id).label("cnt"),
            )
            .join(Shift, ShiftAssignment.shift_id == Shift.id)
            .where(
                Shift.organization_id == str(organization_id),
                Shift.shift_date >= start_date,
                Shift.shift_date <= end_date,
                ShiftAssignment.user_id.in_(user_ids),
                ShiftAssignment.assignment_status.in_([
                    AssignmentStatus.ASSIGNED,
                    AssignmentStatus.CONFIRMED,
                ]),
            )
            .group_by(ShiftAssignment.user_id)
        )
        assignment_counts: Dict[str, int] = {
            str(row.user_id): row.cnt for row in assign_result.all()
        }

        # Approved time-off per user
        timeoff_result = await self.db.execute(
            select(ShiftTimeOff).where(
                ShiftTimeOff.organization_id == str(organization_id),
                ShiftTimeOff.status == TimeOffStatus.APPROVED,
                ShiftTimeOff.start_date <= end_date,
                ShiftTimeOff.end_date >= start_date,
                ShiftTimeOff.user_id.in_(user_ids),
            )
        )
        timeoff_records = timeoff_result.scalars().all()

        # Build per-user unavailable date sets
        user_unavailable: Dict[str, set] = {}
        for rec in timeoff_records:
            uid = str(rec.user_id)
            if uid not in user_unavailable:
                user_unavailable[uid] = set()
            d = max(rec.start_date, start_date)
            end_d = min(rec.end_date, end_date)
            while d <= end_d:
                user_unavailable[uid].add(d.isoformat())
                d += timedelta(days=1)

        # Also include leave-of-absence dates
        leave_result = await self.db.execute(
            select(MemberLeaveOfAbsence).where(
                MemberLeaveOfAbsence.organization_id == str(organization_id),
                MemberLeaveOfAbsence.active == True,  # noqa: E712
                MemberLeaveOfAbsence.start_date <= end_date,
                or_(
                    MemberLeaveOfAbsence.end_date >= start_date,
                    MemberLeaveOfAbsence.end_date.is_(None),
                ),
                MemberLeaveOfAbsence.user_id.in_(user_ids),
            )
        )
        for leave in leave_result.scalars().all():
            uid = str(leave.user_id)
            if uid not in user_unavailable:
                user_unavailable[uid] = set()
            d = max(leave.start_date, start_date)
            end_d = min(leave.end_date, end_date) if leave.end_date else end_date
            while d <= end_d:
                user_unavailable[uid].add(d.isoformat())
                d += timedelta(days=1)

        summaries = []
        for u in users:
            uid = str(u.id)
            name = f"{u.first_name or ''} {u.last_name or ''}".strip()
            unavail = user_unavailable.get(uid, set())
            avail = all_dates - unavail
            summaries.append({
                "user_id": uid,
                "user_name": name or u.email or uid,
                "email": u.email,
                "total_shifts_assigned": assignment_counts.get(uid, 0),
                "time_off_days": len(unavail),
                "available_dates": sorted(avail),
                "unavailable_dates": sorted(unavail),
            })

        summaries.sort(key=lambda x: x["user_name"])
        return summaries

    async def get_unavailable_user_ids(
        self,
        organization_id: UUID,
        shift_id: UUID,
    ) -> List[str]:
        """Return user IDs that cannot be assigned to the given shift.

        A member is unavailable if they:
        - are already actively assigned to this shift, or
        - have an active leave of absence covering the shift date, or
        - have approved time-off covering the shift date.
        """
        shift = await self.get_shift_by_id(shift_id, organization_id)
        if not shift:
            return []

        unavailable: set[str] = set()

        # 1. Already assigned (non-cancelled, non-declined)
        result = await self.db.execute(
            select(ShiftAssignment.user_id).where(
                ShiftAssignment.shift_id == str(shift_id),
                ShiftAssignment.user_id.isnot(None),
                ShiftAssignment.assignment_status.in_([
                    AssignmentStatus.ASSIGNED,
                    AssignmentStatus.CONFIRMED,
                ]),
            )
        )
        for row in result.scalars().all():
            if row:
                unavailable.add(str(row))

        if shift.shift_date:
            # 2. On leave of absence
            leave_result = await self.db.execute(
                select(MemberLeaveOfAbsence.user_id).where(
                    MemberLeaveOfAbsence.organization_id == str(organization_id),
                    MemberLeaveOfAbsence.active == True,  # noqa: E712
                    MemberLeaveOfAbsence.start_date <= shift.shift_date,
                    or_(
                        MemberLeaveOfAbsence.end_date >= shift.shift_date,
                        MemberLeaveOfAbsence.end_date.is_(None),
                    ),
                )
            )
            for uid in leave_result.scalars().all():
                if uid:
                    unavailable.add(str(uid))

            # 3. Approved time-off
            timeoff_result = await self.db.execute(
                select(ShiftTimeOff.user_id).where(
                    ShiftTimeOff.organization_id == str(organization_id),
                    ShiftTimeOff.status == TimeOffStatus.APPROVED,
                    ShiftTimeOff.start_date <= shift.shift_date,
                    ShiftTimeOff.end_date >= shift.shift_date,
                )
            )
            for uid in timeoff_result.scalars().all():
                if uid:
                    unavailable.add(str(uid))

        return sorted(unavailable)

    # ============================================
    # Reporting
    # ============================================

    async def get_member_hours_report(
        self, organization_id: UUID, start_date: date, end_date: date
    ) -> List[Dict]:
        """Get total scheduled hours per member from shift assignments in a date range"""
        duration_minutes = func.timestampdiff(
            text("MINUTE"), Shift.start_time, Shift.end_time
        )

        result = await self.db.execute(
            select(
                ShiftAssignment.user_id,
                User.email,
                User.first_name,
                User.last_name,
                func.count(ShiftAssignment.id).label("shift_count"),
                func.coalesce(func.sum(duration_minutes), 0).label(
                    "total_minutes"
                ),
            )
            .join(Shift, ShiftAssignment.shift_id == Shift.id)
            .join(User, ShiftAssignment.user_id == User.id)
            .where(ShiftAssignment.organization_id == str(organization_id))
            .where(Shift.shift_date >= start_date)
            .where(Shift.shift_date <= end_date)
            .group_by(
                ShiftAssignment.user_id,
                User.email,
                User.first_name,
                User.last_name,
            )
            .order_by(func.sum(duration_minutes).desc())
        )
        rows = result.all()

        return [
            {
                "user_id": row.user_id,
                "email": row.email,
                "first_name": row.first_name or "",
                "last_name": row.last_name or "",
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
        # Fetch all shifts in the range in one query
        shift_result = await self.db.execute(
            select(Shift)
            .where(Shift.organization_id == str(organization_id))
            .where(Shift.shift_date >= start_date)
            .where(Shift.shift_date <= end_date)
            .order_by(Shift.shift_date.asc())
        )
        all_shifts = shift_result.scalars().all()

        # Collect all shift IDs for a single assignment query
        shift_ids = [s.id for s in all_shifts]

        # Fetch all assignments for these shifts in one query
        assignments_by_shift: Dict[str, list] = {}
        if shift_ids:
            assign_result = await self.db.execute(
                select(ShiftAssignment)
                .where(ShiftAssignment.shift_id.in_(shift_ids))
                .where(ShiftAssignment.organization_id == str(organization_id))
            )
            for a in assign_result.scalars().all():
                assignments_by_shift.setdefault(a.shift_id, []).append(a)

        # Build apparatus min_staffing lookup for shifts that have an apparatus_id
        apparatus_ids = list({s.apparatus_id for s in all_shifts if s.apparatus_id})
        apparatus_min_staffing: Dict[str, int] = {}
        if apparatus_ids:
            app_result = await self.db.execute(
                select(BasicApparatus.id, BasicApparatus.min_staffing)
                .where(BasicApparatus.id.in_(apparatus_ids))
                .where(BasicApparatus.organization_id == str(organization_id))
            )
            for row in app_result.all():
                if row[1] is not None:
                    apparatus_min_staffing[row[0]] = row[1]

        # Group shifts by date
        shifts_by_date: Dict[date, list] = {}
        for s in all_shifts:
            shifts_by_date.setdefault(s.shift_date, []).append(s)

        report = []
        current = start_date
        while current <= end_date:
            day_shifts = shifts_by_date.get(current, [])

            total_assigned = 0
            total_confirmed = 0
            understaffed_shifts = 0

            for shift in day_shifts:
                all_assignments = assignments_by_shift.get(shift.id, [])
                # Only count active assignments (assigned/confirmed)
                active = [
                    a
                    for a in all_assignments
                    if a.assignment_status
                    in (
                        AssignmentStatus.ASSIGNED,
                        AssignmentStatus.CONFIRMED,
                    )
                ]
                assigned_count = len(active)
                confirmed_count = sum(
                    1
                    for a in active
                    if a.assignment_status == AssignmentStatus.CONFIRMED
                )
                total_assigned += assigned_count
                total_confirmed += confirmed_count

                # Check staffing: use required positions when available,
                # otherwise fall back to min_staffing headcount.
                slots = self.normalize_positions(shift.positions)
                required_slots = [s for s in slots if s.get("required", True)]
                if required_slots:
                    # Count how many required positions are filled
                    active_pos = [
                        (
                            a.position.value
                            if hasattr(a.position, "value")
                            else str(a.position)
                        )
                        for a in active
                    ]
                    unfilled = 0
                    pos_pool = list(active_pos)
                    for slot in required_slots:
                        slot_name = slot["position"].lower()
                        matched = False
                        for idx, ap in enumerate(pos_pool):
                            if ap.lower() == slot_name:
                                pos_pool.pop(idx)
                                matched = True
                                break
                        if not matched:
                            unfilled += 1
                    is_understaffed = unfilled > 0
                else:
                    min_staff = (
                        apparatus_min_staffing.get(shift.apparatus_id, 1)
                        if shift.apparatus_id
                        else 1
                    )
                    is_understaffed = assigned_count < min_staff
                if is_understaffed:
                    understaffed_shifts += 1

            report.append(
                {
                    "date": current.isoformat(),
                    "total_shifts": len(day_shifts),
                    "total_assigned": total_assigned,
                    "total_confirmed": total_confirmed,
                    "understaffed_shifts": understaffed_shifts,
                }
            )

            current += timedelta(days=1)

        return report

    async def get_call_volume_report(
        self,
        organization_id: UUID,
        start_date: date,
        end_date: date,
        group_by: str = "day",
    ) -> List[Dict]:
        """Get call volume grouped by period with type breakdown
        and avg response time."""
        # Get all calls with their shift dates in a single joined query
        result = await self.db.execute(
            select(ShiftCall, Shift.shift_date)
            .join(Shift, ShiftCall.shift_id == Shift.id)
            .where(ShiftCall.organization_id == str(organization_id))
            .where(Shift.shift_date >= start_date)
            .where(Shift.shift_date <= end_date)
            .order_by(Shift.shift_date.asc())
        )

        call_data = [(row[1], row[0]) for row in result.all()]

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

            report.append(
                {
                    "period": period,
                    "total_calls": len(period_calls),
                    "by_type": type_counts,
                    "avg_response_seconds": avg_response_seconds,
                }
            )

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
        # Build subquery for shifts with active assignments or attendance for
        # this user.  Exclude declined, cancelled, and no-show assignments so
        # the dashboard "My Upcoming Shifts" only shows shifts the user is
        # actively on.
        active_statuses = [
            AssignmentStatus.ASSIGNED,
            AssignmentStatus.CONFIRMED,
            AssignmentStatus.PENDING,
        ]
        assignment_shift_ids = (
            select(ShiftAssignment.shift_id)
            .where(ShiftAssignment.user_id == str(user_id))
            .where(ShiftAssignment.organization_id == str(organization_id))
            .where(ShiftAssignment.assignment_status.in_(active_statuses))
        )
        attendance_shift_ids = select(ShiftAttendance.shift_id).where(
            ShiftAttendance.user_id == str(user_id)
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
        query = (
            query.order_by(Shift.shift_date.asc(), Shift.start_time.asc())
            .offset(skip)
            .limit(limit)
        )
        result = await self.db.execute(query)
        shifts = result.scalars().all()

        # Batch-load user-specific assignments and attendance for all shifts
        shift_id_list = [s.id for s in shifts]
        user_assignments: Dict[str, Any] = {}
        user_attendances: Dict[str, Any] = {}
        if shift_id_list:
            assign_result = await self.db.execute(
                select(ShiftAssignment)
                .where(ShiftAssignment.shift_id.in_(shift_id_list))
                .where(ShiftAssignment.user_id == str(user_id))
            )
            for a in assign_result.scalars().all():
                user_assignments[a.shift_id] = a

            att_result = await self.db.execute(
                select(ShiftAttendance)
                .where(ShiftAttendance.shift_id.in_(shift_id_list))
                .where(ShiftAttendance.user_id == str(user_id))
            )
            for a in att_result.scalars().all():
                user_attendances[a.shift_id] = a

        # Batch-load apparatus and officer enrichment data
        apparatus_ids = list({s.apparatus_id for s in shifts if s.apparatus_id})
        apparatus_map = await self._get_apparatus_map(organization_id, apparatus_ids)
        officer_ids = list({s.shift_officer_id for s in shifts if s.shift_officer_id})
        user_name_map = await self._get_user_name_map(officer_ids)

        # Enrich with user-specific data
        shift_list = []
        for shift in shifts:
            assignment = user_assignments.get(shift.id)
            attendance = user_attendances.get(shift.id)

            shift_dict = {
                "id": shift.id,
                "organization_id": shift.organization_id,
                "shift_date": (
                    shift.shift_date.isoformat() if shift.shift_date else None
                ),
                "start_time": (
                    shift.start_time.isoformat() if shift.start_time else None
                ),
                "end_time": (
                    shift.end_time.isoformat() if shift.end_time else None
                ),
                "notes": shift.notes,
                "apparatus_id": shift.apparatus_id,
                "shift_officer_id": shift.shift_officer_id,
                "positions": shift.positions,
                "color": shift.color,
                "created_at": (
                    shift.created_at.isoformat() if shift.created_at else None
                ),
                "updated_at": (
                    shift.updated_at.isoformat() if shift.updated_at else None
                ),
                "assignment": (
                    {
                        "id": assignment.id,
                        "position": (
                            assignment.position.value
                            if assignment.position
                            else None
                        ),
                        "status": (
                            assignment.assignment_status.value
                            if assignment.assignment_status
                            else None
                        ),
                        "confirmed_at": (
                            assignment.confirmed_at.isoformat()
                            if assignment.confirmed_at
                            else None
                        ),
                    }
                    if assignment
                    else None
                ),
                "attendance": (
                    {
                        "id": attendance.id,
                        "checked_in_at": (
                            attendance.checked_in_at.isoformat()
                            if attendance.checked_in_at
                            else None
                        ),
                        "checked_out_at": (
                            attendance.checked_out_at.isoformat()
                            if attendance.checked_out_at
                            else None
                        ),
                        "duration_minutes": attendance.duration_minutes,
                    }
                    if attendance
                    else None
                ),
            }
            self._enrich_shift_dict(shift_dict, apparatus_map, user_name_map)
            shift_list.append(shift_dict)

        return shift_list, total

    # ============================================
    # Shift Compliance
    # ============================================

    def _compute_period_bounds(
        self, requirement, reference_date: date
    ) -> Tuple[date, date]:
        """Compute the start/end of the compliance period for a requirement."""
        freq = requirement.frequency
        due_type = requirement.due_date_type

        if due_type == DueDateType.ROLLING and requirement.rolling_period_months:
            # Rolling: last N months from reference_date
            months = requirement.rolling_period_months
            period_end = reference_date
            # Subtract months
            year = period_end.year
            month = period_end.month - months
            while month < 1:
                month += 12
                year -= 1
            day = min(period_end.day, 28)  # safe day
            period_start = date(year, month, day)
            return period_start, period_end

        # Calendar-period based
        start_month = requirement.period_start_month or 1

        if freq == RequirementFrequency.MONTHLY:
            period_start = date(reference_date.year, reference_date.month, 1)
            # Last day of month
            next_month = reference_date.month + 1
            next_year = reference_date.year
            if next_month > 12:
                next_month = 1
                next_year += 1
            period_end = date(next_year, next_month, 1) - timedelta(days=1)

        elif freq == RequirementFrequency.QUARTERLY:
            # Determine current quarter relative to start_month
            # Quarters start at start_month, start_month+3, start_month+6, start_month+9
            relative_month = (reference_date.month - start_month) % 12
            quarter_offset = (relative_month // 3) * 3
            q_start_month = ((start_month - 1 + quarter_offset) % 12) + 1
            q_start_year = reference_date.year
            if q_start_month > reference_date.month:
                q_start_year -= 1
            period_start = date(q_start_year, q_start_month, 1)
            # Quarter end is 3 months later minus 1 day
            q_end_month = q_start_month + 3
            q_end_year = q_start_year
            if q_end_month > 12:
                q_end_month -= 12
                q_end_year += 1
            period_end = date(q_end_year, q_end_month, 1) - timedelta(days=1)

        elif freq == RequirementFrequency.BIANNUAL:
            # Two 6-month periods per year starting at start_month
            relative_month = (reference_date.month - start_month) % 12
            half_offset = (relative_month // 6) * 6
            h_start_month = ((start_month - 1 + half_offset) % 12) + 1
            h_start_year = reference_date.year
            if h_start_month > reference_date.month:
                h_start_year -= 1
            period_start = date(h_start_year, h_start_month, 1)
            h_end_month = h_start_month + 6
            h_end_year = h_start_year
            if h_end_month > 12:
                h_end_month -= 12
                h_end_year += 1
            period_end = date(h_end_year, h_end_month, 1) - timedelta(days=1)

        elif freq == RequirementFrequency.ANNUAL:
            # Check for custom period end (supports cross-year windows)
            end_month = requirement.period_end_month
            end_day = requirement.period_end_day
            if end_month:
                start_day = requirement.period_start_day or 1
                if not end_day:
                    end_day = calendar.monthrange(reference_date.year, end_month)[1]
                if start_month > end_month:
                    # Cross-year window (e.g. Nov -> Jan)
                    cycle_end_a = date(reference_date.year, end_month, end_day)
                    cycle_start_a = date(
                        reference_date.year - 1, start_month, start_day
                    )
                    cycle_start_b = date(reference_date.year, start_month, start_day)
                    cycle_end_b = date(reference_date.year + 1, end_month, end_day)
                    if cycle_start_a <= reference_date <= cycle_end_a:
                        period_start = cycle_start_a
                        period_end = cycle_end_a
                    elif cycle_start_b <= reference_date <= cycle_end_b:
                        period_start = cycle_start_b
                        period_end = cycle_end_b
                    else:
                        # Gap between cycles — extend to cover
                        # late completions for the current year
                        period_start = cycle_start_a
                        period_end = cycle_start_b - timedelta(days=1)
                else:
                    yr = reference_date.year
                    period_start = date(yr, start_month, start_day)
                    period_end = date(yr, end_month, end_day)
            else:
                # Default annual period from start_month
                if reference_date.month >= start_month:
                    period_start = date(reference_date.year, start_month, 1)
                    end_year = reference_date.year + 1
                else:
                    period_start = date(reference_date.year - 1, start_month, 1)
                    end_year = reference_date.year
                period_end = date(end_year, start_month, 1) - timedelta(days=1)

        else:
            # ONE_TIME or fallback: use requirement
            # start_date..due_date or last 12 months
            if requirement.start_date and requirement.due_date:
                period_start = requirement.start_date
                period_end = requirement.due_date
            else:
                period_end = reference_date
                period_start = date(
                    reference_date.year - 1, reference_date.month, reference_date.day
                )

        return period_start, period_end

    async def get_shift_compliance(
        self, organization_id: UUID, reference_date: Optional[date] = None
    ) -> List[Dict]:
        """
        Compute shift/hours compliance for all members against active
        TrainingRequirements of type SHIFTS or HOURS.

        Returns a list of requirement compliance summaries, each containing
        per-member progress data.
        """
        if reference_date is None:
            reference_date = date.today()

        # 1. Get active shift/hours requirements for this org
        req_result = await self.db.execute(
            select(TrainingRequirement)
            .where(TrainingRequirement.organization_id == str(organization_id))
            .where(TrainingRequirement.active == True)  # noqa: E712
            .where(
                TrainingRequirement.requirement_type.in_(
                    [
                        RequirementType.SHIFTS.value,
                        RequirementType.HOURS.value,
                    ]
                )
            )
            .order_by(TrainingRequirement.name)
        )
        requirements = req_result.scalars().all()

        if not requirements:
            return []

        # 2. Get all active users with their positions (for role filtering)
        user_result = await self.db.execute(
            select(User)
            .where(User.organization_id == str(organization_id))
            .where(User.status == "active")
            .order_by(User.last_name, User.first_name)
        )
        all_users = user_result.scalars().all()

        # Load position slugs for each user
        user_position_slugs: Dict[str, List[str]] = {}
        for user in all_users:
            pos_result = await self.db.execute(
                select(Position.slug)
                .join(user_positions, Position.id == user_positions.c.position_id)
                .where(user_positions.c.user_id == user.id)
            )
            user_position_slugs[user.id] = [row[0] for row in pos_result.all()]

        # 3. For each requirement, compute compliance
        compliance_data = []

        for req in requirements:
            period_start, period_end = self._compute_period_bounds(req, reference_date)

            # Determine required value
            if req.requirement_type == RequirementType.SHIFTS.value:
                required_value = req.required_shifts or 0
            else:
                required_value = req.required_hours or 0

            # Determine which users this requirement applies to
            applicable_users = []
            for user in all_users:
                if req.applies_to_all:
                    applicable_users.append(user)
                    continue

                # Check rank match
                if req.required_roles and user.rank:
                    if user.rank in req.required_roles:
                        applicable_users.append(user)
                        continue

                # Check position match
                if req.required_positions:
                    user_slugs = user_position_slugs.get(user.id, [])
                    if any(slug in req.required_positions for slug in user_slugs):
                        applicable_users.append(user)
                        continue

            if not applicable_users:
                compliance_data.append(
                    {
                        "requirement_id": req.id,
                        "requirement_name": req.name,
                        "requirement_type": req.requirement_type,
                        "required_value": required_value,
                        "frequency": req.frequency,
                        "period_start": period_start.isoformat(),
                        "period_end": period_end.isoformat(),
                        "members": [],
                        "total_members": 0,
                        "compliant_count": 0,
                        "non_compliant_count": 0,
                        "compliance_rate": 0,
                    }
                )
                continue

            # Batch-query attendance for all applicable users in the period
            user_ids = [u.id for u in applicable_users]
            att_result = await self.db.execute(
                select(
                    ShiftAttendance.user_id,
                    func.count(ShiftAttendance.id).label("shift_count"),
                    func.coalesce(func.sum(ShiftAttendance.duration_minutes), 0).label(
                        "total_minutes"
                    ),
                )
                .join(Shift, ShiftAttendance.shift_id == Shift.id)
                .where(Shift.organization_id == str(organization_id))
                .where(Shift.shift_date >= period_start)
                .where(Shift.shift_date <= period_end)
                .where(ShiftAttendance.user_id.in_(user_ids))
                .group_by(ShiftAttendance.user_id)
            )
            attendance_map: Dict[str, Dict] = {}
            for row in att_result.all():
                attendance_map[row.user_id] = {
                    "shift_count": row.shift_count,
                    "total_minutes": row.total_minutes,
                    "total_hours": round(row.total_minutes / 60.0, 1),
                }

            # Pre-load leave months for rolling requirements so we can
            # pro-rate each member's required value.
            is_rolling = (
                req.due_date_type == DueDateType.ROLLING and req.rolling_period_months
            )
            user_leave_months: Dict[str, int] = {}
            if is_rolling:
                leave_svc = MemberLeaveService(self.db)
                for uid in user_ids:
                    leaves = await leave_svc.get_active_leaves_for_user(
                        str(organization_id),
                        uid,
                        period_start,
                        period_end,
                    )
                    user_leave_months[uid] = MemberLeaveService.count_leave_months(
                        leaves,
                        period_start,
                        period_end,
                    )

            # Build member compliance list
            members = []
            compliant_count = 0

            for user in applicable_users:
                att = attendance_map.get(
                    user.id, {"shift_count": 0, "total_minutes": 0, "total_hours": 0.0}
                )

                if req.requirement_type == RequirementType.SHIFTS.value:
                    completed_value = att["shift_count"]
                else:
                    completed_value = att["total_hours"]

                # Adjust required value for rolling-period requirements
                # by excluding months the member was on leave.
                member_required = required_value
                leave_months = user_leave_months.get(user.id, 0)
                if is_rolling and leave_months > 0 and req.rolling_period_months:
                    active_months = max(req.rolling_period_months - leave_months, 1)
                    member_required = round(
                        required_value * active_months / req.rolling_period_months, 1
                    )

                percentage = round(
                    (
                        (completed_value / member_required * 100)
                        if member_required > 0
                        else 100
                    ),
                    1,
                )
                is_compliant = completed_value >= member_required

                if is_compliant:
                    compliant_count += 1

                members.append(
                    {
                        "user_id": user.id,
                        "first_name": user.first_name,
                        "last_name": user.last_name,
                        "full_name": user.full_name,
                        "rank": user.rank,
                        "completed_value": completed_value,
                        "required_value": member_required,
                        "leave_months": leave_months,
                        "percentage": min(percentage, 100),
                        "compliant": is_compliant,
                        "shift_count": att["shift_count"],
                        "total_hours": att["total_hours"],
                    }
                )

            total_members = len(members)
            non_compliant = total_members - compliant_count
            compliance_rate = round(
                (compliant_count / total_members * 100) if total_members > 0 else 0, 1
            )

            compliance_data.append(
                {
                    "requirement_id": req.id,
                    "requirement_name": req.name,
                    "requirement_type": req.requirement_type,
                    "required_value": required_value,
                    "frequency": req.frequency,
                    "period_start": period_start.isoformat(),
                    "period_end": period_end.isoformat(),
                    "members": members,
                    "total_members": total_members,
                    "compliant_count": compliant_count,
                    "non_compliant_count": non_compliant,
                    "compliance_rate": compliance_rate,
                }
            )

        return compliance_data

    # ============================================
    # Shift Finalization
    # ============================================

    async def finalize_shift(
        self,
        shift_id: UUID,
        organization_id: UUID,
        finalized_by_user_id: str,
    ) -> Tuple[Optional[Shift], Optional[str]]:
        """Mark a shift as finalized after officer review.

        Validates that the shift has ended before allowing finalization.
        Snapshots call_count and total_hours onto the shift record so
        the values are preserved even if attendance records change later.
        """
        try:
            shift = await self.get_shift_by_id(shift_id, organization_id)
            if not shift:
                return None, "Shift not found"

            if shift.is_finalized:
                return None, "Shift is already finalized"

            now = datetime.now(timezone.utc)
            if shift.end_time and shift.end_time > now:
                return None, "Cannot finalize a shift that has not ended"

            # Snapshot call count
            call_result = await self.db.execute(
                select(func.count(ShiftCall.id)).where(
                    ShiftCall.shift_id == str(shift_id)
                )
            )
            shift.call_count = call_result.scalar() or 0

            # Snapshot total hours from attendance duration
            hours_result = await self.db.execute(
                select(
                    func.coalesce(
                        func.sum(ShiftAttendance.duration_minutes), 0
                    )
                ).where(
                    ShiftAttendance.shift_id == str(shift_id)
                )
            )
            total_min = hours_result.scalar() or 0
            shift.total_hours = (
                round(total_min / 60.0, 1) if total_min > 0 else 0.0
            )

            # Snapshot per-member call counts onto attendance records
            member_call_counts = await self.compute_member_call_counts(
                shift_id
            )
            att_result = await self.db.execute(
                select(ShiftAttendance).where(
                    ShiftAttendance.shift_id == str(shift_id)
                )
            )
            for att in att_result.scalars().all():
                att.call_count = member_call_counts.get(
                    str(att.user_id), 0
                )

            shift.is_finalized = True
            shift.finalized_at = now
            shift.finalized_by = finalized_by_user_id

            await self.db.commit()
            await self.db.refresh(shift)
            return shift, None
        except Exception as e:
            await self.db.rollback()
            return None, str(e)
