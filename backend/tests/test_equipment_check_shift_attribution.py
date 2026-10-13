"""Equipment checks read through their shift, on the database.

A department running onboarding's basic apparatus list stores every check with
``shift_equipment_checks.apparatus_id`` NULL — that column is an FK to the
Apparatus module's table — so anything keyed on it sees nothing. These tests
build such a department and read it back through the fleet board.

* W46-12 — a check filed before its shift's date reaches the fleet board now.
* W46-11 — the compliance report and failure log attribute a check to the
  unit its shift was on.
* EC-11 — the compliance report counts expected and missed checks by the
  fleet board's rule: one per shift per applicable checklist.
"""

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from app.models.apparatus import (
    CheckTemplateCompartment,
    CheckTemplateItem,
    EquipmentCheckTemplate,
)
from app.models.training import (
    BasicApparatus,
    Shift,
    ShiftEquipmentCheck,
    ShiftEquipmentCheckItem,
)
from app.services.equipment_check_service import EquipmentCheckService
from app.services.equipment_readiness_service import (
    READY_ATTENTION,
    STATUS_FAILED,
    EquipmentReadinessService,
)

pytestmark = [pytest.mark.integration]

TODAY = date(2026, 10, 11)


def _uid() -> str:
    return str(uuid.uuid4())


async def _department(db_session):
    """An org on basic apparatus: one engine, one type checklist, one member."""
    org_id = _uid()
    user_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Basic FD', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"basic-{org_id[:8]}"},
    )
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, last_name, "
            "email, password_hash, status) VALUES (:id, :org, :un, 'Ryan', 'Hill', "
            ":em, 'hashed', 'active')"
        ),
        {"id": user_id, "org": org_id, "un": f"m-{user_id[:8]}", "em": "rh@test.com"},
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
        # Long before every shift below: a checklist is only owed from its
        # creation (W46-19), and these tests are about what a shift owes.
        created_at=datetime(2025, 1, 1, tzinfo=timezone.utc),
    )
    db_session.add_all([engine, template])
    await db_session.flush()
    compartment = CheckTemplateCompartment(
        id=_uid(), template_id=template.id, name="Cab", sort_order=0
    )
    db_session.add(compartment)
    await db_session.flush()
    item = CheckTemplateItem(
        id=_uid(),
        compartment_id=compartment.id,
        name="SCBA bottle",
        sort_order=0,
        check_type="function",
        is_required=True,
    )
    db_session.add(item)
    await db_session.flush()
    return org_id, user_id, engine, template, item


async def _shift(db_session, org_id, engine, day):
    start = datetime(day.year, day.month, day.day, 7, tzinfo=timezone.utc)
    shift = Shift(
        id=_uid(),
        organization_id=org_id,
        shift_date=day,
        start_time=start,
        end_time=start + timedelta(hours=24),
        apparatus_id=engine.id,
    )
    db_session.add(shift)
    await db_session.flush()
    return shift


async def _check(db_session, org_id, user_id, shift, template, item, status):
    check = ShiftEquipmentCheck(
        id=_uid(),
        organization_id=org_id,
        shift_id=shift.id,
        template_id=template.id,
        # What the shift form stores for a basic-apparatus shift: nothing.
        apparatus_id=None,
        checked_by=user_id,
        checked_at=datetime.now(timezone.utc),
        check_timing="start_of_shift",
        overall_status="fail" if status == "fail" else "pass",
        total_items=1,
        completed_items=1,
        failed_items=1 if status == "fail" else 0,
    )
    db_session.add(check)
    await db_session.flush()
    db_session.add(
        ShiftEquipmentCheckItem(
            id=_uid(),
            check_id=check.id,
            template_item_id=item.id,
            compartment_name="Cab",
            item_name=item.name,
            check_type="function",
            status=status,
        )
    )
    await db_session.flush()
    return check


class TestEarlyCheckReachesTheFleet:
    """W46-12."""

    async def test_a_failed_check_filed_the_day_before_shows_now(self, db_session):
        org_id, user_id, engine, template, item = await _department(db_session)
        await _shift(db_session, org_id, engine, TODAY - timedelta(days=1))
        tomorrow = await _shift(db_session, org_id, engine, TODAY + timedelta(days=1))
        await _check(db_session, org_id, user_id, tomorrow, template, item, "fail")

        board = await EquipmentReadinessService(db_session).get_fleet_readiness(
            org_id, today=TODAY
        )

        (unit,) = board["apparatus"]
        assert unit["last_check_status"] == STATUS_FAILED
        assert unit["failed_item_count"] == 1
        assert unit["readiness"] == READY_ATTENTION
        assert unit["recent"][-1]["date"] == (TODAY + timedelta(days=1)).isoformat()

    async def test_an_upcoming_shift_with_no_check_stays_off_the_board(
        self, db_session
    ):
        org_id, _, engine, _, _ = await _department(db_session)
        await _shift(db_session, org_id, engine, TODAY - timedelta(days=1))
        await _shift(db_session, org_id, engine, TODAY + timedelta(days=1))

        log = await EquipmentReadinessService(db_session).get_check_log(
            org_id, today=TODAY
        )

        assert log["dates"] == [(TODAY - timedelta(days=1)).isoformat()]

    async def test_a_check_filed_beyond_the_lookahead_is_not_pulled_in(
        self, db_session
    ):
        org_id, user_id, engine, template, item = await _department(db_session)
        far = await _shift(db_session, org_id, engine, TODAY + timedelta(days=30))
        await _check(db_session, org_id, user_id, far, template, item, "fail")

        log = await EquipmentReadinessService(db_session).get_check_log(
            org_id, today=TODAY
        )

        assert log["entries"] == []

    async def test_the_early_check_is_a_log_entry(self, db_session):
        org_id, user_id, engine, template, item = await _department(db_session)
        tomorrow = await _shift(db_session, org_id, engine, TODAY + timedelta(days=1))
        check = await _check(
            db_session, org_id, user_id, tomorrow, template, item, "fail"
        )

        log = await EquipmentReadinessService(db_session).get_check_log(
            org_id, today=TODAY
        )

        assert [e["check_id"] for e in log["entries"]] == [check.id]
        assert log["entries"][0]["findings"] == ["SCBA bottle"]


class TestReportsResolveThroughTheShift:
    """W46-11."""

    async def test_the_compliance_report_lists_the_basic_unit_with_its_checks(
        self, db_session
    ):
        org_id, user_id, engine, template, item = await _department(db_session)
        shift = await _shift(db_session, org_id, engine, date.today())
        await _check(db_session, org_id, user_id, shift, template, item, "fail")

        report = await EquipmentCheckService(db_session).get_compliance_report(org_id)

        (row,) = report["apparatus"]
        assert row["apparatus_id"] == engine.id
        assert row["apparatus_name"] == "E-1"
        assert row["has_checklist"] is True
        assert (row["checks_completed"], row["fail_count"]) == (1, 1)
        assert row["last_status"] == "fail"

    async def test_the_failure_log_names_and_filters_by_the_basic_unit(
        self, db_session
    ):
        org_id, user_id, engine, template, item = await _department(db_session)
        shift = await _shift(db_session, org_id, engine, date.today())
        await _check(db_session, org_id, user_id, shift, template, item, "fail")
        service = EquipmentCheckService(db_session)

        log = await service.get_failure_log(org_id, apparatus_id=engine.id)
        other = await service.get_failure_log(org_id, apparatus_id=_uid())

        assert log["total"] == 1
        assert log["items"][0]["apparatus_id"] == engine.id
        assert log["items"][0]["apparatus_name"] == "E-1"
        assert other["total"] == 0


class TestComplianceReportCadence:
    """EC-11."""

    async def test_expected_and_missed_follow_shifts_times_checklists(self, db_session):
        org_id, user_id, engine, template, item = await _department(db_session)
        today = date.today()
        done = await _shift(db_session, org_id, engine, today - timedelta(days=3))
        await _shift(db_session, org_id, engine, today - timedelta(days=2))
        await _shift(db_session, org_id, engine, today - timedelta(days=1))
        # Today's is due, not yet owed; it is neither expected nor missed.
        await _shift(db_session, org_id, engine, today)
        await _check(db_session, org_id, user_id, done, template, item, "pass")

        report = await EquipmentCheckService(db_session).get_compliance_report(
            org_id, date_from=today - timedelta(days=7), date_to=today
        )

        (row,) = report["apparatus"]
        assert row["checks_expected"] == 3
        assert row["checks_missed"] == 2
        assert row["checks_completed"] == 1
        assert row["checks_expected_completed"] == 1
        assert report["overdue_count"] == 2

    async def test_expected_done_is_dated_by_the_shift_not_the_filing(self, db_session):
        """A check filed after the range ends, for a shift inside it, is one of
        the range's expected checks done, though no submission falls inside the
        range; "n of m expected" must count it so the pair reconciles."""
        org_id, user_id, engine, template, item = await _department(db_session)
        today = date.today()
        late = await _shift(db_session, org_id, engine, today - timedelta(days=3))
        await _shift(db_session, org_id, engine, today - timedelta(days=2))
        # Filed today, after the range below has closed.
        await _check(db_session, org_id, user_id, late, template, item, "pass")

        report = await EquipmentCheckService(db_session).get_compliance_report(
            org_id,
            date_from=today - timedelta(days=3),
            date_to=today - timedelta(days=2),
        )

        (row,) = report["apparatus"]
        assert row["checks_completed"] == 0
        assert (
            row["checks_expected"],
            row["checks_expected_completed"],
            row["checks_missed"],
        ) == (2, 1, 1)

    async def test_report_agrees_with_the_fleet_board(self, db_session):
        org_id, user_id, engine, template, item = await _department(db_session)
        today = date.today()
        for back in (1, 2):
            await _shift(db_session, org_id, engine, today - timedelta(days=back))

        report = await EquipmentCheckService(db_session).get_compliance_report(
            org_id, date_from=today - timedelta(days=7), date_to=today
        )
        log = await EquipmentReadinessService(db_session).get_check_log(
            org_id, today=today
        )

        assert report["apparatus"][0]["checks_expected"] == log["summary"]["expected"]
        assert report["overdue_count"] == log["summary"]["missed"]

    async def test_a_unit_no_checklist_reaches_expects_nothing(self, db_session):
        org_id, _, engine, template, _ = await _department(db_session)
        template.apparatus_type = "ladder"
        await db_session.flush()
        await _shift(db_session, org_id, engine, date.today() - timedelta(days=1))

        report = await EquipmentCheckService(db_session).get_compliance_report(org_id)

        (row,) = report["apparatus"]
        assert (row["checks_expected"], row["checks_missed"]) == (0, 0)
        assert row["has_checklist"] is False
        assert report["overdue_count"] == 0
