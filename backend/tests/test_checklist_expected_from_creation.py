"""A checklist is expected on a rig from its creation (W46-19).

The check log and fleet board built the expected side from today's active
checklists applied to every shift in the look-back window, so a checklist
saved at 9:54 PM made the day before a "missed" check and the board read
"Needs attention" minutes after it was written. The owner chose (2026-10-05)
to count a checklist from its creation: a shift already over when it was
written owes nothing; a shift still under way does.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import text

from app.models.apparatus import EquipmentCheckTemplate
from app.models.training import BasicApparatus, Shift
from app.services.equipment_readiness_service import (
    READY_ATTENTION,
    EquipmentReadinessService,
)

TODAY = date(2026, 10, 11)


def _uid() -> str:
    return str(uuid.uuid4())


async def _department(db_session, created_at, tz="UTC"):
    org_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'FD', 'fire_department', :slug, :tz)"
        ),
        {"id": org_id, "slug": f"fd-{org_id[:8]}", "tz": tz},
    )
    engine = BasicApparatus(
        id=_uid(),
        organization_id=org_id,
        unit_number="E-1",
        name="Engine 1",
        apparatus_type="engine",
        is_active=True,
    )
    template = EquipmentCheckTemplate(
        id=_uid(),
        organization_id=org_id,
        apparatus_type="engine",
        name="Engine Daily",
        check_timing="start_of_shift",
        is_active=True,
        created_at=created_at,
    )
    db_session.add_all([engine, template])
    await db_session.flush()
    return org_id, engine


async def _shift(db_session, org_id, engine, day, hours=24, *, ends=True):
    start = datetime(day.year, day.month, day.day, 7, tzinfo=timezone.utc)
    shift = Shift(
        id=_uid(),
        organization_id=org_id,
        shift_date=day,
        start_time=start,
        end_time=start + timedelta(hours=hours) if ends else None,
        apparatus_id=engine.id,
    )
    db_session.add(shift)
    await db_session.flush()
    return shift


@pytest.mark.integration
class TestExpectedFromCreation:
    # 9:54 PM UTC the evening before TODAY — the reported case.
    CREATED = datetime(2026, 10, 10, 21, 54, tzinfo=timezone.utc)

    async def test_a_shift_over_before_the_checklist_existed_owes_nothing(
        self, db_session
    ):
        org_id, engine = await _department(db_session, self.CREATED)
        # 10-09 07:00 to 10-10 07:00: finished hours before the checklist.
        await _shift(db_session, org_id, engine, TODAY - timedelta(days=2))
        # 10-10 07:00 to 19:00: a day shift also over by 9:54 PM.
        await _shift(db_session, org_id, engine, TODAY - timedelta(days=1), hours=12)

        log = await EquipmentReadinessService(db_session).get_check_log(
            org_id, today=TODAY
        )

        assert log["summary"]["expected"] == 0
        assert log["summary"]["missed"] == 0
        assert log["dates"] == []

    async def test_a_shift_under_way_at_creation_owes_it(self, db_session):
        org_id, engine = await _department(db_session, self.CREATED)
        await _shift(db_session, org_id, engine, TODAY - timedelta(days=2))
        # 10-10 07:00 to 10-11 07:00: on duty when the checklist was saved.
        await _shift(db_session, org_id, engine, TODAY - timedelta(days=1))

        log = await EquipmentReadinessService(db_session).get_check_log(
            org_id, today=TODAY
        )

        assert log["dates"] == [(TODAY - timedelta(days=1)).isoformat()]
        assert log["summary"]["missed"] == 1

    async def test_the_fleet_board_does_not_flag_the_rig(self, db_session):
        org_id, engine = await _department(db_session, self.CREATED)
        await _shift(db_session, org_id, engine, TODAY - timedelta(days=2))
        await _shift(db_session, org_id, engine, TODAY - timedelta(days=1), hours=12)

        board = await EquipmentReadinessService(db_session).get_fleet_readiness(
            org_id, today=TODAY
        )

        (unit,) = board["apparatus"]
        assert unit["overdue_count"] == 0
        assert unit["readiness"] != READY_ATTENTION

    async def test_shifts_after_creation_are_still_owed(self, db_session):
        org_id, engine = await _department(db_session, self.CREATED)
        await _shift(db_session, org_id, engine, TODAY - timedelta(days=2))
        await _shift(db_session, org_id, engine, TODAY)

        board = await EquipmentReadinessService(db_session).get_fleet_readiness(
            org_id, today=TODAY
        )

        (unit,) = board["apparatus"]
        assert unit["due_today_count"] == 1

    async def test_the_compliance_report_counts_the_same_way(self, db_session):
        org_id, engine = await _department(db_session, self.CREATED)
        await _shift(db_session, org_id, engine, TODAY - timedelta(days=3))
        await _shift(db_session, org_id, engine, TODAY - timedelta(days=2))
        await _shift(db_session, org_id, engine, TODAY - timedelta(days=1))

        counts = await EquipmentReadinessService(db_session).expected_checks_between(
            org_id, TODAY - timedelta(days=7), TODAY, today=TODAY
        )

        assert counts[engine.id] == {"expected": 1, "completed": 0, "missed": 1}

    async def test_a_shift_with_no_end_is_read_on_the_departments_calendar(
        self, db_session
    ):
        """01:54 UTC on 10-11 is 9:54 PM on 10-10 in New York. A shift with no
        recorded end on 10-10 owes the checklist (its creation day); one on
        10-09 does not. Reading the UTC date would have dropped 10-10 too."""
        created = datetime(2026, 10, 11, 1, 54, tzinfo=timezone.utc)
        org_id, engine = await _department(db_session, created, tz="America/New_York")
        await _shift(db_session, org_id, engine, TODAY - timedelta(days=2), ends=False)
        await _shift(db_session, org_id, engine, TODAY - timedelta(days=1), ends=False)

        log = await EquipmentReadinessService(db_session).get_check_log(
            org_id, today=TODAY
        )

        assert log["dates"] == [(TODAY - timedelta(days=1)).isoformat()]


@pytest.mark.unit
class TestChecklistExistedDuring:
    """The rule itself, without a database."""

    check = staticmethod(EquipmentReadinessService._checklist_existed_during)

    def test_no_recorded_creation_is_always_owed(self):
        shift = SimpleNamespace(shift_date=date(2020, 1, 1), end_time=None)
        assert self.check(shift, SimpleNamespace(created_at=None), None) is True

    def test_naive_timestamps_are_read_as_utc(self):
        created = datetime(2026, 10, 10, 21, 54)
        ended_before = SimpleNamespace(
            shift_date=date(2026, 10, 10), end_time=datetime(2026, 10, 10, 19, 0)
        )
        ended_after = SimpleNamespace(
            shift_date=date(2026, 10, 10), end_time=datetime(2026, 10, 10, 22, 0)
        )
        tmpl = SimpleNamespace(created_at=created)
        assert self.check(ended_before, tmpl, None) is False
        assert self.check(ended_after, tmpl, None) is True
