"""Four data sources added on 2026-11-21: knowledge tests passed, hours for
other agencies, equipment checks completed, and property overdue at the end
of the period. Each is measured over the member's coverage."""

from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

import pytest

from app.models.external_shift_hours import ExternalShiftHours, ExternalShiftHoursStatus
from app.models.inventory import CheckOutRecord, InventoryItem
from app.models.knowledge_test import (
    KnowledgeAttemptStatus,
    KnowledgeTest,
    KnowledgeTestAttempt,
)
from app.models.training import ShiftEquipmentCheck
from app.services.evaluation_data_service import (
    EvaluationDataService,
    compute_coverage,
)
from tests.test_shift_evaluations import _member, _org

pytestmark = [pytest.mark.integration]

PERIOD_END = date(2026, 12, 31)


def _at(on: date, hour: int = 12) -> datetime:
    return datetime(on.year, on.month, on.day, hour, tzinfo=timezone.utc)


async def _figure(db, org_id, member, key):
    coverage = compute_coverage(
        date(2026, 1, 1), PERIOD_END, [(date(2020, 1, 1), None)], []
    )
    assert coverage is not None
    figures = await EvaluationDataService(db).compute(
        org_id, member, coverage, [key], ZoneInfo("UTC")
    )
    return figures[key]


class TestKnowledgeTestsPassed:
    KEY = "training.knowledge_tests_passed"

    async def _attempt(self, db, org_id, test, member, on, *, score, passed, **kw):
        db.add(
            KnowledgeTestAttempt(
                organization_id=org_id,
                test_id=test.id,
                user_id=member.id,
                status=kw.get("status", KnowledgeAttemptStatus.SUBMITTED.value),
                started_at=_at(on, 10),
                submitted_at=_at(on, 11),
                questions_snapshot=[],
                score=score,
                passed=passed,
                passing_score=70,
            )
        )
        await db.flush()

    async def _test(self, db, org_id, name):
        test = KnowledgeTest(organization_id=org_id, name=name)
        db.add(test)
        await db.flush()
        return test

    async def test_each_test_passed_counts_once_at_its_best_score(self, db_session):
        org_id = await _org(db_session)
        member = await _member(db_session, org_id, "Kim")
        hazmat = await self._test(db_session, org_id, "Hazmat awareness")
        ladders = await self._test(db_session, org_id, "Ladder operations")
        pumps = await self._test(db_session, org_id, "Pump operations")
        old = await self._test(db_session, org_id, "Old test")
        await self._attempt(
            db_session, org_id, hazmat, member, date(2026, 2, 1), score=75, passed=True
        )
        await self._attempt(
            db_session, org_id, hazmat, member, date(2026, 3, 1), score=92, passed=True
        )
        await self._attempt(
            db_session, org_id, ladders, member, date(2026, 4, 1), score=80, passed=True
        )
        # Not counted: a fail, a pass before the period.
        await self._attempt(
            db_session, org_id, pumps, member, date(2026, 5, 1), score=40, passed=False
        )
        await self._attempt(
            db_session, org_id, old, member, date(2025, 6, 1), score=99, passed=True
        )

        figure = await _figure(db_session, org_id, member, self.KEY)

        assert figure["value"] == 2
        assert figure["breakdown"] == "Hazmat awareness (92%); Ladder operations (80%)"

    async def test_none_passed_is_zero(self, db_session):
        org_id = await _org(db_session)
        member = await _member(db_session, org_id, "Kim")

        figure = await _figure(db_session, org_id, member, self.KEY)

        assert figure["value"] == 0
        assert figure["breakdown"] == ""


class TestHoursForOtherAgencies:
    KEY = "shifts.external_hours"

    async def _hours(self, db, org_id, member, on, minutes, status):
        db.add(
            ExternalShiftHours(
                organization_id=org_id,
                user_id=member.id,
                shift_date=on,
                duration_minutes=minutes,
                agency_name="County Rescue",
                apparatus_name="Rescue 4",
                status=status.value,
            )
        )
        await db.flush()

    async def test_only_counted_hours_in_the_period_count(self, db_session):
        org_id = await _org(db_session)
        member = await _member(db_session, org_id, "Lee")
        counted = ExternalShiftHoursStatus.COUNTED
        await self._hours(db_session, org_id, member, date(2026, 3, 4), 720, counted)
        await self._hours(db_session, org_id, member, date(2026, 7, 9), 360, counted)
        # Not counted: pending or rejected, or outside the period.
        await self._hours(
            db_session,
            org_id,
            member,
            date(2026, 8, 1),
            600,
            ExternalShiftHoursStatus.PENDING,
        )
        await self._hours(
            db_session,
            org_id,
            member,
            date(2026, 8, 2),
            600,
            ExternalShiftHoursStatus.REJECTED,
        )
        await self._hours(db_session, org_id, member, date(2025, 11, 2), 600, counted)

        figure = await _figure(db_session, org_id, member, self.KEY)
        shift_hours = await _figure(db_session, org_id, member, "shifts.hours")

        assert figure["value"] == 18
        assert figure["breakdown"] == "2 shifts"
        # The same figure Shift hours reports as left out of its own.
        assert shift_hours["external_hours"] == figure["value"]


class TestEquipmentChecks:
    KEY = "apparatus.equipment_checks"

    async def _check(self, db, org_id, by, on, failed=0):
        db.add(
            ShiftEquipmentCheck(
                organization_id=org_id,
                checked_by=by.id,
                checked_at=_at(on),
                check_timing="start_of_shift",
                check_context="standalone",
                overall_status="fail" if failed else "pass",
                total_items=10,
                completed_items=10,
                failed_items=failed,
            )
        )
        await db.flush()

    async def test_checks_signed_off_in_the_period_with_failures_noted(
        self, db_session
    ):
        org_id = await _org(db_session)
        member = await _member(db_session, org_id, "Ash")
        other = await _member(db_session, org_id, "Bo")
        await self._check(db_session, org_id, member, date(2026, 1, 5))
        await self._check(db_session, org_id, member, date(2026, 6, 5), failed=2)
        await self._check(db_session, org_id, member, date(2026, 9, 5))
        # Not counted: another member's check, and one before the period.
        await self._check(db_session, org_id, other, date(2026, 6, 5))
        await self._check(db_session, org_id, member, date(2025, 12, 30))

        figure = await _figure(db_session, org_id, member, self.KEY)

        assert figure["value"] == 3
        assert figure["breakdown"] == "1 found a failed item"

    async def test_none_completed_is_zero_with_no_detail(self, db_session):
        org_id = await _org(db_session)
        member = await _member(db_session, org_id, "Ash")

        figure = await _figure(db_session, org_id, member, self.KEY)

        assert figure["value"] == 0
        assert figure["breakdown"] is None


class TestPropertyOverdueAtPeriodEnd:
    KEY = "inventory.overdue_at_period_end"

    async def _loan(self, db, org_id, member, name, out, due, back=None):
        item = InventoryItem(organization_id=org_id, name=name)
        db.add(item)
        await db.flush()
        db.add(
            CheckOutRecord(
                organization_id=org_id,
                item_id=item.id,
                user_id=member.id,
                checked_out_at=_at(out),
                expected_return_at=_at(due) if due else None,
                checked_in_at=_at(back) if back else None,
                is_returned=back is not None,
            )
        )
        await db.flush()

    async def test_loans_past_due_and_out_on_the_last_day_are_listed(self, db_session):
        org_id = await _org(db_session)
        member = await _member(db_session, org_id, "Dee")
        # Overdue at the period end: never returned, or returned afterwards.
        await self._loan(
            db_session,
            org_id,
            member,
            "Thermal camera",
            date(2026, 10, 1),
            date(2026, 11, 3),
        )
        await self._loan(
            db_session,
            org_id,
            member,
            "Radio 12",
            date(2026, 9, 1),
            date(2026, 9, 15),
            back=date(2027, 1, 10),
        )
        # Not overdue then: returned in time, returned late but before the
        # end, due after the end, or no due date on file.
        await self._loan(
            db_session,
            org_id,
            member,
            "Hose roller",
            date(2026, 3, 1),
            date(2026, 3, 10),
            back=date(2026, 3, 9),
        )
        await self._loan(
            db_session,
            org_id,
            member,
            "Gas meter",
            date(2026, 5, 1),
            date(2026, 5, 10),
            back=date(2026, 6, 1),
        )
        await self._loan(
            db_session,
            org_id,
            member,
            "SCBA mask",
            date(2026, 12, 20),
            date(2027, 1, 5),
        )
        await self._loan(
            db_session, org_id, member, "Flashlight", date(2026, 2, 1), None
        )

        figure = await _figure(db_session, org_id, member, self.KEY)

        assert figure["value"] == 2
        assert figure["breakdown"] == (
            "Radio 12, due Sep 15, 2026; Thermal camera, due Nov 3, 2026"
        )
