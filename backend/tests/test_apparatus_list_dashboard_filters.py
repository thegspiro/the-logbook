"""The fleet list honours the dashboard's fleet-readiness links (DASH-37).

The dashboard's "Out of service", "Unresolved defects" and "Overdue checks"
tiles link to ``/apparatus?serviceStatus=unavailable``, ``?hasDeficiency=true``
and ``?inspection=overdue`` and say "View filtered results", but the list
endpoint had no such filters, so every one of them opened the whole fleet.
Each case here puts rows on both sides of the tile's boundary, so a filter that
selected too much or too little would fail.
"""

import uuid
from datetime import timedelta

import pytest
from pydantic import ValidationError

from app.models.apparatus import Apparatus, ApparatusStatus, ApparatusType
from app.models.user import Organization
from app.schemas.apparatus import ApparatusListFilters
from app.services.apparatus_service import ApparatusService
from app.utils.org_timezone import resolve_org_today

pytestmark = pytest.mark.integration


async def _org(db, label):
    org = Organization(
        id=str(uuid.uuid4()),
        name=label,
        slug=f"{label.lower()}-{uuid.uuid4().hex[:8]}",
    )
    db.add(org)
    await db.flush()
    return org


class _Fleet:
    def __init__(self, db, org):
        self.db = db
        self.org = org
        self.statuses = {}
        self.kind = None

    async def setup(self):
        self.kind = ApparatusType(
            id=str(uuid.uuid4()),
            organization_id=self.org.id,
            name="Engine",
            code=f"ENG{uuid.uuid4().hex[:4]}",
        )
        self.db.add(self.kind)
        for code in ("in_service", "out_of_service", "in_maintenance", "reserve"):
            status = ApparatusStatus(
                id=str(uuid.uuid4()),
                organization_id=self.org.id,
                name=code.replace("_", " ").title(),
                code=code,
            )
            self.statuses[code] = status
            self.db.add(status)
        await self.db.flush()
        return self

    async def add(self, unit, status="in_service", **fields):
        row = Apparatus(
            id=str(uuid.uuid4()),
            organization_id=self.org.id,
            unit_number=unit,
            apparatus_type_id=self.kind.id,
            status_id=self.statuses[status].id,
            **fields,
        )
        self.db.add(row)
        await self.db.flush()
        return row


async def _units(db, org, **filters):
    items, total = await ApparatusService(db).list_apparatus(
        org.id, filters=ApparatusListFilters(is_archived=False, **filters)
    )
    assert total == len(items)
    return sorted(a.unit_number for a in items)


class TestServiceStatusUnavailable:
    async def test_out_of_service_and_in_maintenance_only(self, db_session):
        org = await _org(db_session, "Fleet")
        fleet = await _Fleet(db_session, org).setup()
        await fleet.add("E-1", "in_service")
        await fleet.add("E-2", "out_of_service")
        await fleet.add("E-3", "in_maintenance")
        await fleet.add("E-4", "reserve")

        assert await _units(db_session, org, service_status="unavailable") == [
            "E-2",
            "E-3",
        ]

    async def test_matches_the_fleet_summary_the_tile_adds_up(self, db_session):
        org = await _org(db_session, "Fleet")
        fleet = await _Fleet(db_session, org).setup()
        await fleet.add("E-1", "out_of_service")
        await fleet.add("E-2", "in_maintenance")
        await fleet.add("E-3", "in_service")

        summary = await ApparatusService(db_session).get_fleet_summary(org.id)
        units = await _units(db_session, org, service_status="unavailable")

        assert (
            len(units)
            == summary["out_of_service_count"] + summary["in_maintenance_count"]
        )

    async def test_another_organization_is_not_listed(self, db_session):
        org = await _org(db_session, "Mine")
        other = await _org(db_session, "Theirs")
        await (await _Fleet(db_session, org).setup()).add("E-1", "out_of_service")
        await (await _Fleet(db_session, other).setup()).add("X-1", "out_of_service")

        assert await _units(db_session, org, service_status="unavailable") == ["E-1"]


class TestHasDeficiency:
    async def test_only_apparatus_with_a_deficiency(self, db_session):
        org = await _org(db_session, "Fleet")
        fleet = await _Fleet(db_session, org).setup()
        await fleet.add("E-1", has_deficiency=True)
        await fleet.add("E-2", has_deficiency=False)
        await fleet.add("E-3", has_deficiency=True, is_archived=True)

        assert await _units(db_session, org, has_deficiency=True) == ["E-1"]


class TestInspectionOverdue:
    async def test_expired_before_the_department_today(self, db_session):
        org = await _org(db_session, "Fleet")
        fleet = await _Fleet(db_session, org).setup()
        today = await resolve_org_today(db_session, org.id)
        await fleet.add("E-1", inspection_expiration=today - timedelta(days=1))
        # Expiring today is not yet overdue: the tile counts `< today`.
        await fleet.add("E-2", inspection_expiration=today)
        await fleet.add("E-3", inspection_expiration=None)
        await fleet.add(
            "E-4",
            inspection_expiration=today - timedelta(days=9),
            is_archived=True,
        )

        assert await _units(db_session, org, inspection="overdue") == ["E-1"]


async def test_no_filter_lists_the_whole_active_fleet(db_session):
    org = await _org(db_session, "Fleet")
    fleet = await _Fleet(db_session, org).setup()
    await fleet.add("E-1", "out_of_service", has_deficiency=True)
    await fleet.add("E-2")

    assert await _units(db_session, org) == ["E-1", "E-2"]


def test_an_unknown_service_status_is_rejected():
    with pytest.raises(ValidationError):
        ApparatusListFilters(service_status="broken")
