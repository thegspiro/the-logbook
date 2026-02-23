"""
Member Leave of Absence Service

Business logic for managing leave of absence periods.
These periods are set in the membership module and read by
the training and shift modules to exclude months from
rolling-period requirement calculations.
"""

from datetime import date, datetime, timedelta, timezone
from typing import List, Optional

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.utils import generate_uuid
from app.models.user import MemberLeaveOfAbsence, LeaveType
from app.models.training import TrainingWaiver, TrainingWaiverType


class MemberLeaveService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # Training waiver auto-link helpers
    # ------------------------------------------------------------------

    async def _create_linked_waiver(
        self,
        organization_id: str,
        user_id: str,
        leave_type: str,
        start_date: date,
        end_date: date,
        reason: Optional[str],
        granted_by: Optional[str],
    ) -> str:
        """Create a TrainingWaiver linked to a leave of absence. Returns waiver ID."""
        try:
            wt = TrainingWaiverType(leave_type)
        except ValueError:
            wt = TrainingWaiverType.OTHER

        waiver = TrainingWaiver(
            id=generate_uuid(),
            organization_id=organization_id,
            user_id=user_id,
            waiver_type=wt,
            reason=f"Auto-created from leave of absence: {reason}" if reason else "Auto-created from leave of absence",
            start_date=start_date,
            end_date=end_date,
            requirement_ids=None,  # Applies to all requirements
            granted_by=granted_by,
            granted_at=datetime.now(timezone.utc) if granted_by else None,
            active=True,
        )
        self.db.add(waiver)
        return str(waiver.id)

    async def _update_linked_waiver(
        self, waiver_id: str, **kwargs
    ) -> None:
        """Update an auto-linked training waiver."""
        result = await self.db.execute(
            select(TrainingWaiver).where(TrainingWaiver.id == waiver_id)
        )
        waiver = result.scalar_one_or_none()
        if not waiver:
            return
        for key, value in kwargs.items():
            if value is not None:
                setattr(waiver, key, value)
        waiver.updated_at = datetime.now(timezone.utc)

    async def _deactivate_linked_waiver(self, waiver_id: str) -> None:
        """Deactivate an auto-linked training waiver."""
        result = await self.db.execute(
            select(TrainingWaiver).where(TrainingWaiver.id == waiver_id)
        )
        waiver = result.scalar_one_or_none()
        if waiver:
            waiver.active = False
            waiver.updated_at = datetime.now(timezone.utc)

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------

    async def create_leave(
        self,
        organization_id: str,
        user_id: str,
        start_date: date,
        end_date: date,
        leave_type: str = "leave_of_absence",
        reason: Optional[str] = None,
        granted_by: Optional[str] = None,
        exempt_from_training_waiver: bool = False,
    ) -> MemberLeaveOfAbsence:
        """Create a new leave of absence record for a member.

        Unless ``exempt_from_training_waiver`` is True, a matching
        TrainingWaiver is automatically created so the member's training
        requirements are adjusted for the leave period.
        """
        try:
            lt = LeaveType(leave_type)
        except ValueError:
            lt = LeaveType.OTHER

        leave = MemberLeaveOfAbsence(
            id=generate_uuid(),
            organization_id=organization_id,
            user_id=user_id,
            leave_type=lt,
            reason=reason,
            start_date=start_date,
            end_date=end_date,
            granted_by=granted_by,
            granted_at=datetime.now(timezone.utc) if granted_by else None,
            active=True,
            exempt_from_training_waiver=exempt_from_training_waiver,
        )

        # Auto-create linked training waiver unless exempt
        if not exempt_from_training_waiver:
            waiver_id = await self._create_linked_waiver(
                organization_id=organization_id,
                user_id=user_id,
                leave_type=leave_type,
                start_date=start_date,
                end_date=end_date,
                reason=reason,
                granted_by=granted_by,
            )
            leave.linked_training_waiver_id = waiver_id

        self.db.add(leave)
        await self.db.commit()
        await self.db.refresh(leave)
        return leave

    async def list_leaves(
        self,
        organization_id: str,
        user_id: Optional[str] = None,
        active_only: bool = True,
    ) -> List[MemberLeaveOfAbsence]:
        """List leave of absence records for an organization, optionally filtered by user."""
        query = select(MemberLeaveOfAbsence).where(
            MemberLeaveOfAbsence.organization_id == organization_id
        )
        if user_id:
            query = query.where(MemberLeaveOfAbsence.user_id == user_id)
        if active_only:
            query = query.where(MemberLeaveOfAbsence.active == True)  # noqa: E712
        query = query.order_by(MemberLeaveOfAbsence.start_date.desc())
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_leave(
        self, organization_id: str, leave_id: str
    ) -> Optional[MemberLeaveOfAbsence]:
        """Get a single leave of absence record."""
        result = await self.db.execute(
            select(MemberLeaveOfAbsence).where(
                MemberLeaveOfAbsence.id == leave_id,
                MemberLeaveOfAbsence.organization_id == organization_id,
            )
        )
        return result.scalar_one_or_none()

    async def update_leave(
        self,
        organization_id: str,
        leave_id: str,
        **kwargs,
    ) -> Optional[MemberLeaveOfAbsence]:
        """Update a leave of absence record.

        Syncs changes to the linked training waiver when dates or
        exempt_from_training_waiver are modified.
        """
        leave = await self.get_leave(organization_id, leave_id)
        if not leave:
            return None

        if "leave_type" in kwargs and kwargs["leave_type"] is not None:
            try:
                kwargs["leave_type"] = LeaveType(kwargs["leave_type"])
            except ValueError:
                kwargs["leave_type"] = LeaveType.OTHER

        for key, value in kwargs.items():
            if value is not None:
                setattr(leave, key, value)

        # Handle exempt_from_training_waiver toggle
        exempt_changed = "exempt_from_training_waiver" in kwargs and kwargs["exempt_from_training_waiver"] is not None
        if exempt_changed:
            if leave.exempt_from_training_waiver and leave.linked_training_waiver_id:
                # Was not exempt, now is → deactivate linked waiver
                await self._deactivate_linked_waiver(leave.linked_training_waiver_id)
                leave.linked_training_waiver_id = None
            elif not leave.exempt_from_training_waiver and not leave.linked_training_waiver_id:
                # Was exempt, now is not → create linked waiver
                lt_val = leave.leave_type.value if hasattr(leave.leave_type, 'value') else str(leave.leave_type)
                waiver_id = await self._create_linked_waiver(
                    organization_id=organization_id,
                    user_id=str(leave.user_id),
                    leave_type=lt_val,
                    start_date=leave.start_date,
                    end_date=leave.end_date,
                    reason=leave.reason,
                    granted_by=str(leave.granted_by) if leave.granted_by else None,
                )
                leave.linked_training_waiver_id = waiver_id

        # Sync date changes to linked waiver
        if leave.linked_training_waiver_id and not leave.exempt_from_training_waiver:
            waiver_updates = {}
            if "start_date" in kwargs and kwargs["start_date"] is not None:
                waiver_updates["start_date"] = leave.start_date
            if "end_date" in kwargs and kwargs["end_date"] is not None:
                waiver_updates["end_date"] = leave.end_date
            if waiver_updates:
                await self._update_linked_waiver(leave.linked_training_waiver_id, **waiver_updates)

        leave.updated_at = datetime.now(timezone.utc)
        await self.db.commit()
        await self.db.refresh(leave)
        return leave

    async def deactivate_leave(
        self, organization_id: str, leave_id: str
    ) -> bool:
        """Soft-delete a leave of absence record and its linked training waiver."""
        leave = await self.get_leave(organization_id, leave_id)
        if not leave:
            return False
        leave.active = False
        leave.updated_at = datetime.now(timezone.utc)

        # Deactivate linked training waiver
        if leave.linked_training_waiver_id:
            await self._deactivate_linked_waiver(leave.linked_training_waiver_id)

        await self.db.commit()
        return True

    # ------------------------------------------------------------------
    # Query helpers used by training / shift modules
    # ------------------------------------------------------------------

    async def get_active_leaves_for_user(
        self,
        organization_id: str,
        user_id: str,
        period_start: date,
        period_end: date,
    ) -> List[MemberLeaveOfAbsence]:
        """
        Return active leave records that overlap the given date range.

        Used by the training module to exclude months from rolling-period
        calculations and by the shift module to skip scheduling.
        """
        result = await self.db.execute(
            select(MemberLeaveOfAbsence).where(
                MemberLeaveOfAbsence.organization_id == organization_id,
                MemberLeaveOfAbsence.user_id == user_id,
                MemberLeaveOfAbsence.active == True,  # noqa: E712
                MemberLeaveOfAbsence.start_date <= period_end,
                MemberLeaveOfAbsence.end_date >= period_start,
            )
        )
        return list(result.scalars().all())

    @staticmethod
    def count_leave_months(
        leaves: List[MemberLeaveOfAbsence],
        period_start: date,
        period_end: date,
    ) -> int:
        """
        Count the number of full calendar months covered by leave
        records within a given period.

        A month is considered "on leave" if the leave covers the
        entire month (1st through last day).  Partial-month leaves
        are not excluded so that members still get credit for months
        where they were partially active.
        """
        if not leaves:
            return 0

        leave_months = set()
        for leave in leaves:
            # Clamp leave dates to the evaluation period
            effective_start = max(leave.start_date, period_start)
            effective_end = min(leave.end_date, period_end)

            # Walk month-by-month
            y, m = effective_start.year, effective_start.month
            while (y, m) <= (effective_end.year, effective_end.month):
                # Check if the entire month is covered
                month_first = date(y, m, 1)
                if m == 12:
                    next_month_first = date(y + 1, 1, 1)
                else:
                    next_month_first = date(y, m + 1, 1)
                month_last = next_month_first - timedelta(days=1)

                if leave.start_date <= month_first and leave.end_date >= month_last:
                    leave_months.add((y, m))

                # Advance
                m += 1
                if m > 12:
                    m = 1
                    y += 1

        return len(leave_months)
