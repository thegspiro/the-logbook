"""
Inventory Shelf Audit Schedule

Which storage areas are due a shelf audit. An area is on a schedule when it has
an ``audit_frequency``; its next audit is due one period after its latest saved
audit (``inventory_nfc_audits``), and immediately if it has never been audited.

Due dates are computed on every read rather than stored. The latest audit is
the fact; a stored due date would be a second copy of it that an audit saved
through any path could leave stale.

Periods are calendar periods (``relativedelta``), not fixed day counts, so a
monthly shelf audited on the 31st is next due on the last day of the following
month rather than drifting a day or two each month.
"""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from dateutil.relativedelta import relativedelta
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.inventory import (
    InventoryAuditFrequency,
    InventoryNfcAudit,
    StorageArea,
)
from app.models.location import Location

AUDIT_PERIODS: Dict[InventoryAuditFrequency, relativedelta] = {
    InventoryAuditFrequency.WEEKLY: relativedelta(weeks=1),
    InventoryAuditFrequency.MONTHLY: relativedelta(months=1),
    InventoryAuditFrequency.QUARTERLY: relativedelta(months=3),
    InventoryAuditFrequency.YEARLY: relativedelta(years=1),
}


def _as_utc(value: Optional[datetime]) -> Optional[datetime]:
    """MySQL DATETIME comes back naive; every stored time is UTC."""
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


class InventoryAuditScheduleService:
    """Reads and sets shelf audit schedules."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def set_frequency(
        self,
        storage_area_id: str,
        organization_id: str,
        frequency: Optional[InventoryAuditFrequency],
    ) -> Dict[str, Any]:
        """Put an area on a schedule, change it, or take it off (``None``).

        Raises ``LookupError`` for an area outside the organization and
        ``ValueError`` for an inactive one: an inactive area is never listed as
        due, so a schedule on it would be one nobody could see.
        """
        org_id = str(organization_id)
        area = (
            await self.db.execute(
                select(StorageArea).where(
                    StorageArea.id == str(storage_area_id),
                    StorageArea.organization_id == org_id,
                )
            )
        ).scalar_one_or_none()
        if area is None:
            raise LookupError("Storage area not found")
        if frequency is not None and not area.is_active:
            raise ValueError("This storage area is no longer active.")

        area.audit_frequency = frequency
        await self.db.flush()
        rows = await self._rows(org_id, [area])
        return rows[0]

    async def list_schedule(
        self,
        organization_id: str,
        *,
        due_only: bool = False,
        now: Optional[datetime] = None,
    ) -> List[Dict[str, Any]]:
        """Active areas that are on a schedule, overdue first.

        Order: never audited, then the longest overdue, then the soonest due.
        Name then id keeps the order stable between refreshes.
        """
        org_id = str(organization_id)
        result = await self.db.execute(
            select(StorageArea).where(
                StorageArea.organization_id == org_id,
                StorageArea.is_active.is_(True),
                StorageArea.audit_frequency.is_not(None),
            )
        )
        rows = await self._rows(org_id, list(result.scalars().all()), now=now)
        if due_only:
            rows = [r for r in rows if r["overdue"]]
        rows.sort(
            key=lambda r: (
                r["last_audited_at"] is not None,
                r["next_due_at"] or datetime.min.replace(tzinfo=timezone.utc),
                r["storage_area_name"].lower(),
                r["storage_area_id"],
            )
        )
        return rows

    async def _rows(
        self,
        organization_id: str,
        areas: List[StorageArea],
        now: Optional[datetime] = None,
    ) -> List[Dict[str, Any]]:
        now = now or datetime.now(timezone.utc)
        if not areas:
            return []
        area_ids = [a.id for a in areas]

        last = await self.db.execute(
            select(
                InventoryNfcAudit.storage_area_id,
                func.max(InventoryNfcAudit.audited_at),
            )
            .where(
                InventoryNfcAudit.organization_id == organization_id,
                InventoryNfcAudit.storage_area_id.in_(area_ids),
            )
            .group_by(InventoryNfcAudit.storage_area_id)
        )
        last_audit = {area_id: _as_utc(at) for area_id, at in last.all()}

        location_ids = {a.location_id for a in areas if a.location_id}
        locations: Dict[str, str] = {}
        if location_ids:
            loc = await self.db.execute(
                select(Location.id, Location.name).where(
                    Location.id.in_(location_ids),
                    Location.organization_id == organization_id,
                )
            )
            locations = {row.id: row.name for row in loc}

        rows = []
        for area in areas:
            frequency = area.audit_frequency
            last_at = last_audit.get(area.id)
            next_due = (
                last_at + AUDIT_PERIODS[frequency]
                if frequency is not None and last_at is not None
                else None
            )
            on_schedule = frequency is not None
            overdue = on_schedule and (next_due is None or next_due <= now)
            rows.append(
                {
                    "storage_area_id": area.id,
                    "storage_area_name": area.name,
                    "location_name": locations.get(area.location_id),
                    "audit_frequency": frequency,
                    "last_audited_at": last_at,
                    # Null while never audited: due now, with no date to show.
                    "next_due_at": next_due,
                    "overdue": overdue,
                    "days_overdue": (
                        (now - next_due).days
                        if overdue and next_due is not None
                        else None
                    ),
                }
            )
        return rows
