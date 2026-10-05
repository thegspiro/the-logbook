"""
NFPA apparatus compliance: a per-department switch, and a page the server
grades (owner decision, docket D10).

The apparatus screen showed a "Tracking Enabled" card and nothing else, though
the API already stored compliance items. A fire department wants the full
page; an EMS-only agency does not. The department now chooses, defaulting
from its organization type, and the server works out each test's standing
from the apparatus's own maintenance records.
"""

import uuid
from datetime import date, timedelta
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.models.apparatus import (
    Apparatus,
    ApparatusMaintenance,
    ApparatusMaintenanceType,
    ApparatusNFPACompliance,
    ApparatusStatus,
    ApparatusType,
)
from app.models.user import Organization
from app.services.apparatus_service import (
    ApparatusService,
    _nfpa_next_due,
    _nfpa_status,
)
from app.utils.apparatus_nfpa import (
    nfpa_enabled_in,
    nfpa_explicit_choice,
    require_apparatus_nfpa,
)

TODAY = date(2026, 6, 15)


@pytest.mark.unit
class TestTheSwitch:
    @pytest.mark.parametrize(
        ("org_type", "expected"),
        [
            ("fire_department", True),
            ("fire_ems_combined", True),
            ("ems_only", False),
            (None, False),
        ],
    )
    def test_an_unset_switch_follows_the_organization_type(self, org_type, expected):
        assert nfpa_enabled_in({}, org_type) is expected

    def test_a_departments_choice_overrides_its_type(self):
        on = {"apparatus": {"nfpa_compliance_enabled": True}}
        off = {"apparatus": {"nfpa_compliance_enabled": False}}
        assert nfpa_enabled_in(on, "ems_only") is True
        assert nfpa_enabled_in(off, "fire_department") is False

    def test_only_a_real_boolean_counts_as_a_choice(self):
        assert (
            nfpa_explicit_choice({"apparatus": {"nfpa_compliance_enabled": "false"}})
            is None
        )
        assert nfpa_explicit_choice({"apparatus": "on"}) is None
        assert nfpa_explicit_choice(None) is None


def _type(value=1, unit="years"):
    return SimpleNamespace(default_interval_value=value, default_interval_unit=unit)


def _record(**kw):
    defaults = dict(is_completed=True, next_due_date=None, due_date=None)
    defaults.update(kw)
    return SimpleNamespace(**defaults)


@pytest.mark.unit
class TestGrading:
    def test_the_recorded_next_due_date_wins(self):
        last = _record(next_due_date=date(2026, 9, 1))
        assert _nfpa_next_due(_type(), last, date(2025, 9, 1), [last]) == date(
            2026, 9, 1
        )

    def test_otherwise_the_interval_counts_from_the_last_test(self):
        last = _record()
        assert _nfpa_next_due(
            _type(1, "years"), last, date(2025, 9, 1), [last]
        ) == date(2026, 9, 1)

    def test_a_mileage_interval_gives_no_date(self):
        last = _record()
        assert (
            _nfpa_next_due(_type(5000, "miles"), last, date(2025, 9, 1), [last]) is None
        )

    def test_a_scheduled_test_is_due_on_its_booking(self):
        booked = _record(is_completed=False, due_date=date(2026, 7, 1))
        assert _nfpa_next_due(_type(), None, None, [booked]) == date(2026, 7, 1)

    @pytest.mark.parametrize(
        ("last", "next_due", "expected"),
        [
            (date(2025, 6, 1), date(2026, 6, 1), "overdue"),
            (date(2025, 7, 1), date(2026, 7, 1), "due_soon"),
            (date(2026, 1, 1), date(2027, 1, 1), "current"),
            (None, None, "never_performed"),
            (None, date(2026, 8, 1), "scheduled"),
            (None, date(2026, 6, 1), "overdue"),
        ],
    )
    def test_status(self, last, next_due, expected):
        assert _nfpa_status(last, next_due, TODAY) == expected


async def _seed(db_session, organization_type="fire_department"):
    org = Organization(
        id=str(uuid.uuid4()),
        name="NFPA Dept",
        slug=f"nfpa-{uuid.uuid4().hex[:8]}",
        organization_type=organization_type,
        timezone="UTC",
    )
    db_session.add(org)
    await db_session.flush()
    engine_type = ApparatusType(
        id=str(uuid.uuid4()), organization_id=org.id, name="Engine", code="ENG"
    )
    ladder_type = ApparatusType(
        id=str(uuid.uuid4()), organization_id=org.id, name="Ladder", code="LAD"
    )
    in_service = ApparatusStatus(
        id=str(uuid.uuid4()), organization_id=org.id, name="In Service", code="IS"
    )
    db_session.add_all([engine_type, ladder_type, in_service])
    await db_session.flush()
    engine = Apparatus(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        unit_number="Engine 1",
        apparatus_type_id=engine_type.id,
        status_id=in_service.id,
        nfpa_tracking_enabled=True,
    )
    db_session.add(engine)
    pump = ApparatusMaintenanceType(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="Department Pump Test",
        code=f"pump-{uuid.uuid4().hex[:6]}",
        is_nfpa_required=True,
        nfpa_reference="NFPA 1911",
        default_interval_value=1,
        default_interval_unit="years",
    )
    aerial = ApparatusMaintenanceType(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="Department Aerial Test",
        code=f"aerial-{uuid.uuid4().hex[:6]}",
        is_nfpa_required=True,
        applies_to_types=[ladder_type.id],
    )
    oil = ApparatusMaintenanceType(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="Department Oil Change",
        code=f"oil-{uuid.uuid4().hex[:6]}",
        is_nfpa_required=False,
    )
    db_session.add_all([pump, aerial, oil])
    await db_session.flush()
    return org, engine, pump, aerial, oil


@pytest.mark.integration
class TestSummary:
    async def test_grades_the_required_tests_that_apply(self, db_session):
        org, engine, pump, aerial, oil = await _seed(db_session)
        last_year = date.today() - timedelta(days=400)
        db_session.add(
            ApparatusMaintenance(
                id=str(uuid.uuid4()),
                organization_id=org.id,
                apparatus_id=engine.id,
                maintenance_type_id=pump.id,
                is_completed=True,
                completed_date=last_year,
            )
        )
        await db_session.flush()

        summary = await ApparatusService(db_session).get_nfpa_summary(engine.id, org.id)
        mine = {r["maintenance_type_id"]: r for r in summary["required_maintenance"]}

        assert pump.id in mine
        # Not NFPA, and an aerial test for ladders only: neither belongs here.
        assert oil.id not in mine
        assert aerial.id not in mine
        assert mine[pump.id]["last_completed_date"] == last_year
        # One year after a test 400 days ago is past.
        assert mine[pump.id]["status"] == "overdue"
        assert summary["overdue_count"] >= 1

    async def test_a_compliance_item_past_its_date_reads_overdue(self, db_session):
        org, engine, *_ = await _seed(db_session)
        db_session.add(
            ApparatusNFPACompliance(
                id=str(uuid.uuid4()),
                organization_id=org.id,
                apparatus_id=engine.id,
                standard_code="NFPA 1911",
                section_reference="6.1",
                requirement_description="Annual inspection",
                compliance_status="compliant",
                next_due_date=date.today() - timedelta(days=1),
            )
        )
        await db_session.flush()

        summary = await ApparatusService(db_session).get_nfpa_summary(engine.id, org.id)

        (item,) = summary["compliance_items"]
        assert item["status"] == "overdue"

    async def test_another_departments_apparatus_is_not_found(self, db_session):
        _, engine, *_ = await _seed(db_session)
        other, *_ = await _seed(db_session)

        assert (
            await ApparatusService(db_session).get_nfpa_summary(engine.id, other.id)
            is None
        )


@pytest.mark.integration
class TestGate:
    async def test_an_ems_agency_is_refused_until_it_opts_in(self, db_session):
        org, *_ = await _seed(db_session, organization_type="ems_only")

        with pytest.raises(HTTPException) as exc:
            await require_apparatus_nfpa(db_session, org.id)
        assert exc.value.status_code == 403

        org.settings = {"apparatus": {"nfpa_compliance_enabled": True}}
        await db_session.flush()
        await require_apparatus_nfpa(db_session, org.id)

    async def test_a_fire_department_can_switch_it_off(self, db_session):
        org, *_ = await _seed(db_session)
        await require_apparatus_nfpa(db_session, org.id)

        org.settings = {"apparatus": {"nfpa_compliance_enabled": False}}
        await db_session.flush()
        with pytest.raises(HTTPException):
            await require_apparatus_nfpa(db_session, org.id)
