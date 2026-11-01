"""The cross-facility maintenance and inspection lists page on the server (FAC2-5).

Both screens loaded the first 100 rows and then filtered and searched them in
the browser. A search for a vendor that appeared only on an older record found
nothing, an organization with more than 100 matching records saw a silently
short list, and the inspections "pending" tab could not be asked of the server
at all, because the list endpoint's ``passed=None`` already meant "no filter".

``GET /facilities/maintenance/page`` and ``/inspections/page`` return a page
plus the organization-wide total, with search and the tri-state ``result``
applied in SQL.
"""

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

from app.api.v1.endpoints import facilities as endpoints
from app.models.facilities import (
    Facility,
    FacilityComplianceChecklist,
    FacilityInspection,
    FacilityMaintenance,
    FacilityMaintenanceType,
    FacilityStatus,
    FacilityType,
)
from app.models.user import Organization
from app.services.facilities_service import FacilitiesService
from app.utils.org_timezone import resolve_org_today

pytestmark = pytest.mark.integration


async def _org(db, label):
    org = Organization(name=label, slug=f"{label.lower()}-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    return org


async def _facility(db, org):
    kind = FacilityType(id=str(uuid.uuid4()), organization_id=org.id, name="Station")
    status = FacilityStatus(
        id=str(uuid.uuid4()), organization_id=org.id, name="In service"
    )
    db.add_all([kind, status])
    await db.flush()
    fac = Facility(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="Station 1",
        facility_type_id=kind.id,
        status_id=status.id,
    )
    db.add(fac)
    await db.flush()
    return fac


async def _maintenance(db, org, fac, kind, count, **fields):
    base = datetime(2026, 1, 1, tzinfo=timezone.utc)
    rows = [
        FacilityMaintenance(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            facility_id=fac.id,
            maintenance_type_id=kind.id,
            description=f"Job {i}",
            created_at=base + timedelta(minutes=i),
            **fields,
        )
        for i in range(count)
    ]
    db.add_all(rows)
    await db.flush()
    return rows


@pytest.fixture
async def scene(db_session):
    org = await _org(db_session, "Pages")
    fac = await _facility(db_session, org)
    kind = FacilityMaintenanceType(
        id=str(uuid.uuid4()), organization_id=org.id, name="HVAC"
    )
    db_session.add(kind)
    await db_session.flush()
    return org, fac, kind


class TestMaintenancePage:
    async def test_total_counts_past_the_page(self, db_session, scene):
        org, fac, kind = scene
        await _maintenance(db_session, org, fac, kind, 7)

        items, total = await FacilitiesService(db_session).page_maintenance_records(
            org.id, skip=5, limit=5
        )

        assert total == 7
        # Newest first: the two oldest are what is left after skipping five.
        assert [r.description for r in items] == ["Job 1", "Job 0"]

    async def test_search_reaches_a_record_beyond_the_first_page(
        self, db_session, scene
    ):
        org, fac, kind = scene
        old = await _maintenance(db_session, org, fac, kind, 1, vendor="Acme HVAC")
        await _maintenance(db_session, org, fac, kind, 3)
        old[0].created_at = datetime(2020, 1, 1, tzinfo=timezone.utc)
        await db_session.flush()

        items, total = await FacilitiesService(db_session).page_maintenance_records(
            org.id, search="acme", limit=1
        )

        assert total == 1
        assert [r.id for r in items] == [old[0].id]

    async def test_a_percent_sign_is_searched_for_not_matched_as_a_wildcard(
        self, db_session, scene
    ):
        org, fac, kind = scene
        await _maintenance(db_session, org, fac, kind, 3)

        _, total = await FacilitiesService(db_session).page_maintenance_records(
            org.id, search="%"
        )

        assert total == 0

    async def test_filters_and_tenancy(self, db_session, scene):
        org, fac, kind = scene
        await _maintenance(db_session, org, fac, kind, 2, is_overdue=True)
        await _maintenance(db_session, org, fac, kind, 3, is_overdue=False)
        other = await _org(db_session, "Other")
        other_fac = await _facility(db_session, other)
        await _maintenance(db_session, other, other_fac, kind, 4, is_overdue=True)

        page = await endpoints.get_facility_maintenance_page(
            facility_id=None,
            maintenance_type_id=None,
            is_completed=None,
            is_overdue=True,
            is_historic=None,
            occurred_after=None,
            occurred_before=None,
            search=None,
            skip=0,
            limit=50,
            db=db_session,
            current_user=type("U", (), {"organization_id": org.id})(),
        )

        assert page["total"] == 2
        assert {r.organization_id for r in page["items"]} == {org.id}


class TestInspectionPage:
    async def _inspections(self, db, org, fac):
        today = date(2026, 6, 1)
        rows = []
        for i, passed in enumerate([True, False, None, None]):
            rows.append(
                FacilityInspection(
                    id=str(uuid.uuid4()),
                    organization_id=org.id,
                    facility_id=fac.id,
                    inspection_type="fire",
                    title=f"Inspection {i}",
                    inspection_date=today - timedelta(days=i),
                    inspector_name="Pat Marshal" if i == 3 else "Lee",
                    passed=passed,
                )
            )
        db.add_all(rows)
        await db.flush()
        return rows

    @pytest.mark.parametrize(
        ("result", "titles"),
        [
            ("passed", ["Inspection 0"]),
            ("failed", ["Inspection 1"]),
            ("pending", ["Inspection 2", "Inspection 3"]),
            (None, ["Inspection 0", "Inspection 1", "Inspection 2", "Inspection 3"]),
        ],
    )
    async def test_result_is_three_way(self, db_session, scene, result, titles):
        org, fac, _ = scene
        await self._inspections(db_session, org, fac)

        items, total = await FacilitiesService(db_session).page_inspections(
            org.id, result=result
        )

        assert [i.title for i in items] == titles
        assert total == len(titles)

    async def test_search_matches_the_inspector(self, db_session, scene):
        org, fac, _ = scene
        await self._inspections(db_session, org, fac)

        items, total = await FacilitiesService(db_session).page_inspections(
            org.id, search="marshal"
        )

        assert total == 1
        assert [i.title for i in items] == ["Inspection 3"]


class TestDashboardDueWindows:
    """The dashboard's "Upcoming inspections" and "Compliance deadlines" tiles
    link here with a 30-day window (DASH-37). Rows sit on both sides of every
    edge the tiles' queries in dashboard.py draw: before today, today, the
    thirtieth day, the day after, and a facility that has been archived."""

    async def _archived_facility(self, db, org, beside):
        fac = Facility(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            name="Old Station",
            facility_type_id=beside.facility_type_id,
            status_id=beside.status_id,
            is_archived=True,
        )
        db.add(fac)
        await db.flush()
        return fac

    async def test_inspections_due_within_the_window(self, db_session, scene):
        org, fac, _ = scene
        archived = await self._archived_facility(db_session, org, fac)
        today = await resolve_org_today(db_session, org.id)
        offsets = {"yesterday": -1, "today": 0, "day 30": 30, "day 31": 31}
        for title, days in offsets.items():
            db_session.add(
                FacilityInspection(
                    id=str(uuid.uuid4()),
                    organization_id=org.id,
                    facility_id=fac.id,
                    inspection_type="fire",
                    title=title,
                    inspection_date=today - timedelta(days=365),
                    next_inspection_date=today + timedelta(days=days),
                )
            )
        db_session.add(
            FacilityInspection(
                id=str(uuid.uuid4()),
                organization_id=org.id,
                facility_id=archived.id,
                inspection_type="fire",
                title="archived facility",
                inspection_date=today - timedelta(days=365),
                next_inspection_date=today + timedelta(days=5),
            )
        )
        await db_session.flush()

        items, total = await FacilitiesService(db_session).page_inspections(
            org.id, due_within_days=30
        )

        assert sorted(i.title for i in items) == ["day 30", "today"]
        assert total == 2

        _, unfiltered = await FacilitiesService(db_session).page_inspections(org.id)
        assert unfiltered == 5

    async def test_compliance_due_within_the_window(self, db_session, scene):
        org, fac, _ = scene
        archived = await self._archived_facility(db_session, org, fac)
        today = await resolve_org_today(db_session, org.id)

        def checklist(name, days, facility=fac, done=False):
            return FacilityComplianceChecklist(
                id=str(uuid.uuid4()),
                organization_id=org.id,
                facility_id=facility.id,
                checklist_name=name,
                compliance_type="fire_code",
                due_date=today + timedelta(days=days),
                is_completed=done,
            )

        db_session.add_all(
            [
                checklist("yesterday", -1),
                checklist("today", 0),
                checklist("day 30", 30),
                checklist("day 31", 31),
                checklist("completed", 5, done=True),
                checklist("archived facility", 5, facility=archived),
            ]
        )
        other = await _org(db_session, "Other")
        other_fac = await _facility(db_session, other)
        db_session.add(
            FacilityComplianceChecklist(
                id=str(uuid.uuid4()),
                organization_id=other.id,
                facility_id=other_fac.id,
                checklist_name="other org",
                compliance_type="fire_code",
                due_date=today + timedelta(days=5),
            )
        )
        await db_session.flush()

        rows = await endpoints.list_facility_compliance_checklists(
            facility_id=None,
            compliance_type=None,
            is_completed=False,
            due_within_days=30,
            skip=0,
            limit=500,
            db=db_session,
            current_user=type("U", (), {"organization_id": org.id})(),
        )

        assert sorted(r.checklist_name for r in rows) == ["day 30", "today"]


@pytest.mark.parametrize("prefix", ["/maintenance", "/inspections"])
def test_the_page_route_is_matched_before_the_by_id_route(prefix):
    """``/maintenance/page`` must not be captured as ``/maintenance/{record_id}``."""
    paths = [
        route.path
        for route in endpoints.router.routes
        if "GET" in getattr(route, "methods", set())
    ]
    page = paths.index(f"{endpoints.router.prefix}{prefix}/page")
    by_id = next(
        i
        for i, path in enumerate(paths)
        if path.startswith(f"{endpoints.router.prefix}{prefix}/{{")
    )
    assert page < by_id
