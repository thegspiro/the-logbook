"""
Shift hours members worked outside the department's own schedule.

A member logs the shift themselves and it counts immediately; there is no
approval queue. An officer who finds an entry wrong rejects it, which takes
it out of every total while keeping the member's claim on record, and can
restore it the same way.

The aggregate helpers here are the one definition of "counted external
hours" that the hours report, the member's own history and the shift
compliance report all read, so the three cannot disagree about which rows
count.
"""

from datetime import date, datetime, timezone
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models.external_shift_hours import (
    ExternalShiftHours,
    ExternalShiftHoursStatus,
)
from app.models.user import User
from app.utils.model_updates import apply_updates
from app.utils.org_timezone import resolve_scheduling_timezone

_COUNTED = ExternalShiftHoursStatus.COUNTED.value
_REJECTED = ExternalShiftHoursStatus.REJECTED.value


def minutes_from_hours(hours: float) -> int:
    return int(round(float(hours) * 60))


class ExternalShiftHoursService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # Member self-service
    # ------------------------------------------------------------------

    async def _assert_not_future(self, organization_id: str, shift_date: date) -> None:
        # Judged against the department's local date: a member logging a
        # night shift just after midnight UTC must not be refused for a date
        # that is still today where they worked.
        tz = await resolve_scheduling_timezone(self.db, organization_id)
        if shift_date > datetime.now(tz).date():
            raise ValueError("Shift date cannot be in the future")

    async def create(
        self, organization_id: str, user_id: str, payload: Mapping[str, Any]
    ) -> ExternalShiftHours:
        await self._assert_not_future(organization_id, payload["shift_date"])
        entry = ExternalShiftHours(
            organization_id=str(organization_id),
            user_id=str(user_id),
            shift_date=payload["shift_date"],
            duration_minutes=minutes_from_hours(payload["hours"]),
            agency_name=payload["agency_name"],
            apparatus=payload.get("apparatus"),
            role=payload.get("role"),
            notes=payload.get("notes"),
            status=_COUNTED,
        )
        self.db.add(entry)
        await self.db.commit()
        await self.db.refresh(entry)
        return entry

    async def get(
        self, organization_id: str, entry_id: str, *, user_id: Optional[str] = None
    ) -> Optional[ExternalShiftHours]:
        query = select(ExternalShiftHours).where(
            ExternalShiftHours.id == str(entry_id),
            ExternalShiftHours.organization_id == str(organization_id),
        )
        if user_id is not None:
            query = query.where(ExternalShiftHours.user_id == str(user_id))
        return (await self.db.execute(query)).scalar_one_or_none()

    async def update_own(
        self,
        organization_id: str,
        user_id: str,
        entry_id: str,
        updates: Mapping[str, Any],
    ) -> Optional[ExternalShiftHours]:
        entry = await self.get(organization_id, entry_id, user_id=user_id)
        if entry is None:
            return None
        if entry.status == _REJECTED:
            # Editing a rejected entry would let a member quietly change the
            # claim an officer ruled on while it stays rejected, so the
            # record of what was reviewed and what it said drifts apart.
            raise ValueError("A rejected entry cannot be edited")

        changes = dict(updates)
        if "hours" in changes:
            hours = changes.pop("hours")
            if hours is None:
                raise ValueError("Hours are required")
            changes["duration_minutes"] = minutes_from_hours(hours)
        if changes.get("shift_date") is not None:
            await self._assert_not_future(organization_id, changes["shift_date"])

        apply_updates(
            entry,
            changes,
            skip={
                "id",
                "organization_id",
                "user_id",
                "status",
                "reviewed_by",
                "reviewed_at",
                "rejection_reason",
            },
        )
        await self.db.commit()
        await self.db.refresh(entry)
        return entry

    async def delete_own(
        self, organization_id: str, user_id: str, entry_id: str
    ) -> Optional[ExternalShiftHours]:
        entry = await self.get(organization_id, entry_id, user_id=user_id)
        if entry is None:
            return None
        if entry.status == _REJECTED:
            # The rejection is the officer's record; a member removing it
            # would erase the review along with the claim.
            raise ValueError("A rejected entry cannot be deleted")
        await self.db.delete(entry)
        await self.db.commit()
        return entry

    # ------------------------------------------------------------------
    # Listing
    # ------------------------------------------------------------------

    async def list_entries(
        self,
        organization_id: str,
        *,
        entry_id: Optional[str] = None,
        user_id: Optional[str] = None,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        status: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> Tuple[List[Dict[str, Any]], int]:
        member = aliased(User)
        reviewer = aliased(User)

        filters = [ExternalShiftHours.organization_id == str(organization_id)]
        if entry_id is not None:
            filters.append(ExternalShiftHours.id == str(entry_id))
        if user_id is not None:
            filters.append(ExternalShiftHours.user_id == str(user_id))
        if start_date is not None:
            filters.append(ExternalShiftHours.shift_date >= start_date)
        if end_date is not None:
            filters.append(ExternalShiftHours.shift_date <= end_date)
        if status is not None:
            filters.append(ExternalShiftHours.status == status)

        total = (
            await self.db.execute(
                select(func.count(ExternalShiftHours.id)).where(*filters)
            )
        ).scalar_one()

        # The member join is constrained to the org as well: the row's
        # user_id is org-stamped at write, but the name shown beside it
        # must never be resolved from another tenant.
        rows = (
            await self.db.execute(
                select(ExternalShiftHours, member, reviewer)
                .outerjoin(
                    member,
                    (member.id == ExternalShiftHours.user_id)
                    & (member.organization_id == str(organization_id)),
                )
                .outerjoin(
                    reviewer,
                    (reviewer.id == ExternalShiftHours.reviewed_by)
                    & (reviewer.organization_id == str(organization_id)),
                )
                .where(*filters)
                .order_by(
                    ExternalShiftHours.shift_date.desc(),
                    ExternalShiftHours.created_at.desc(),
                )
                .limit(limit)
                .offset(offset)
            )
        ).all()

        return [
            self.serialize(entry, member=m, reviewer=r) for entry, m, r in rows
        ], int(total)

    @staticmethod
    def serialize(
        entry: ExternalShiftHours,
        *,
        member: Optional[User] = None,
        reviewer: Optional[User] = None,
    ) -> Dict[str, Any]:
        return {
            "id": entry.id,
            "user_id": entry.user_id,
            "member_name": member.full_name if member is not None else None,
            "shift_date": entry.shift_date,
            "hours": round((entry.duration_minutes or 0) / 60, 2),
            "agency_name": entry.agency_name,
            "apparatus": entry.apparatus,
            "role": entry.role,
            "notes": entry.notes,
            "status": entry.status,
            "reviewed_by": entry.reviewed_by,
            "reviewer_name": reviewer.full_name if reviewer is not None else None,
            "reviewed_at": entry.reviewed_at,
            "rejection_reason": entry.rejection_reason,
            "created_at": entry.created_at,
            "updated_at": entry.updated_at,
        }

    # ------------------------------------------------------------------
    # Officer review
    # ------------------------------------------------------------------

    async def reject(
        self, organization_id: str, entry_id: str, reviewer_id: str, reason: str
    ) -> Optional[ExternalShiftHours]:
        entry = await self.get(organization_id, entry_id)
        if entry is None:
            return None
        entry.status = _REJECTED
        entry.reviewed_by = str(reviewer_id)
        entry.reviewed_at = datetime.now(timezone.utc)
        entry.rejection_reason = reason
        await self.db.commit()
        await self.db.refresh(entry)
        return entry

    async def restore(
        self, organization_id: str, entry_id: str, reviewer_id: str
    ) -> Optional[ExternalShiftHours]:
        entry = await self.get(organization_id, entry_id)
        if entry is None:
            return None
        entry.status = _COUNTED
        entry.reviewed_by = str(reviewer_id)
        entry.reviewed_at = datetime.now(timezone.utc)
        entry.rejection_reason = None
        await self.db.commit()
        await self.db.refresh(entry)
        return entry

    # ------------------------------------------------------------------
    # Aggregates read by the scheduling reports
    # ------------------------------------------------------------------

    async def counted_totals_by_user(
        self,
        organization_id: str,
        start_date: date,
        end_date: date,
        user_ids: Optional[Sequence[str]] = None,
    ) -> Dict[str, Dict[str, int]]:
        """``{user_id: {"shift_count", "minutes"}}`` of counted entries."""
        query = (
            select(
                ExternalShiftHours.user_id,
                func.count(ExternalShiftHours.id).label("shift_count"),
                func.coalesce(func.sum(ExternalShiftHours.duration_minutes), 0).label(
                    "minutes"
                ),
            )
            .where(ExternalShiftHours.organization_id == str(organization_id))
            .where(ExternalShiftHours.status == _COUNTED)
            .where(ExternalShiftHours.shift_date >= start_date)
            .where(ExternalShiftHours.shift_date <= end_date)
            .group_by(ExternalShiftHours.user_id)
        )
        if user_ids is not None:
            if not user_ids:
                return {}
            query = query.where(ExternalShiftHours.user_id.in_(list(user_ids)))
        result = await self.db.execute(query)
        return {
            row.user_id: {
                "shift_count": int(row.shift_count or 0),
                "minutes": int(row.minutes or 0),
            }
            for row in result.all()
        }

    async def counted_totals_by_month(
        self,
        organization_id: str,
        user_id: str,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> Dict[Tuple[int, int], Dict[str, int]]:
        """``{(year, month): {"shift_count", "minutes"}}`` for one member."""
        year_col = func.year(ExternalShiftHours.shift_date)
        month_col = func.month(ExternalShiftHours.shift_date)
        query = (
            select(
                year_col.label("year"),
                month_col.label("month"),
                func.count(ExternalShiftHours.id).label("shift_count"),
                func.coalesce(func.sum(ExternalShiftHours.duration_minutes), 0).label(
                    "minutes"
                ),
            )
            .where(ExternalShiftHours.organization_id == str(organization_id))
            .where(ExternalShiftHours.user_id == str(user_id))
            .where(ExternalShiftHours.status == _COUNTED)
        )
        if start_date is not None:
            query = query.where(ExternalShiftHours.shift_date >= start_date)
        if end_date is not None:
            query = query.where(ExternalShiftHours.shift_date <= end_date)
        result = await self.db.execute(query.group_by(year_col, month_col))
        return {
            (int(row.year), int(row.month)): {
                "shift_count": int(row.shift_count or 0),
                "minutes": int(row.minutes or 0),
            }
            for row in result.all()
        }
