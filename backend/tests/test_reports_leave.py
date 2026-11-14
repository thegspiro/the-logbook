"""Two reports put a member's leave beside their figures.

The Annual Training report: a member away for most of the year otherwise reads
as short of hours, with nothing on the report to say why. The months are
counted as a requirement counts them -- by the department's leave month rule,
through today.

Program Requirement Progress: its figures are training-program progress and
leave changes none of them (RPT5-29-1, owner decision 2026-11-14), but each
member's leave in the past year is listed, and whether they are on leave today.
"""

import uuid
from datetime import date
from unittest.mock import patch

import pytest
from sqlalchemy import text

from app.models.compliance_config import ComplianceConfig
from app.models.training import TrainingRecord, TrainingStatus, TrainingType
from app.models.user import LeaveType, MemberLeaveOfAbsence
from app.services.reports_service import ReportsService

pytestmark = pytest.mark.integration

# The owner's case: a leave from 2025-07-01 to 2026-09-01.
LEAVE_START = date(2025, 7, 1)
LEAVE_END = date(2026, 9, 1)


async def _member(db_session, org_id: str, first: str = "Pat") -> str:
    user_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO users "
            "(id, organization_id, username, first_name, last_name, "
            "email, password_hash, status) "
            "VALUES (:id, :org, :un, :first, 'Member', :em, 'x', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"member-{user_id[:8]}",
            "first": first,
            "em": f"{user_id[:8]}@example.com",
        },
    )
    return user_id


async def _org(db_session) -> str:
    org_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Other Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"other-{org_id[:8]}"},
    )
    return org_id


def _leave(org_id: str, user_id: str, *, exempt: bool = False):
    return MemberLeaveOfAbsence(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        user_id=user_id,
        leave_type=LeaveType.LEAVE_OF_ABSENCE,
        reason="Private reason that must not reach the report",
        start_date=LEAVE_START,
        end_date=LEAVE_END,
        active=True,
        exempt_from_training_waiver=exempt,
    )


async def _report(
    db_session,
    org_id: str,
    today: date,
    year: int = 2026,
    report_type: str = "annual_training",
):
    async def _today(*_a, **_kw):
        return today

    with patch("app.services.reports_service.resolve_org_today", _today):
        return await ReportsService(db_session).generate_report(
            org_id, report_type, filters={"year": year}
        )


def _entry(report, member_id: str):
    return next(e for e in report["entries"] if e["member_id"] == member_id)


class TestLeaveBesideHours:
    async def test_full_month_rule_counts_each_month_touched(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        member = await _member(db_session, org_id)
        db_session.add(_leave(org_id, member))
        db_session.add(
            TrainingRecord(
                organization_id=org_id,
                user_id=member,
                course_name="Drill",
                training_type=TrainingType.CONTINUING_EDUCATION,
                status=TrainingStatus.COMPLETED,
                completion_date=date(2026, 5, 9),
                hours_completed=4.0,
            )
        )
        await db_session.flush()

        entry = _entry(await _report(db_session, org_id, date(2026, 10, 21)), member)

        # Jan - Sep 2026; September has one day of leave, which under the
        # default rule excuses the whole month.
        assert entry["leave_months"] == 9
        assert entry["leave_periods"] == [
            {
                "start_date": "2025-07-01",
                "end_date": "2026-09-01",
                "excuses_training": True,
            }
        ]
        # Training done during the leave is still reported as done.
        assert entry["training_hours"] == 4.0
        assert "reason" not in entry["leave_periods"][0]

    async def test_proportional_rule_counts_the_share_of_a_partial_month(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        member = await _member(db_session, org_id)
        db_session.add(_leave(org_id, member))
        db_session.add(
            ComplianceConfig(organization_id=org_id, leave_month_rule="proportional")
        )
        await db_session.flush()

        entry = _entry(await _report(db_session, org_id, date(2026, 10, 21)), member)

        assert entry["leave_months"] == pytest.approx(8 + 1 / 30, abs=0.01)

    async def test_leave_later_in_the_year_is_listed_but_not_yet_counted(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        member = await _member(db_session, org_id)
        db_session.add(_leave(org_id, member))
        await db_session.flush()

        entry = _entry(await _report(db_session, org_id, date(2026, 3, 15)), member)

        assert entry["leave_months"] == 3
        assert len(entry["leave_periods"]) == 1

    async def test_an_exempt_leave_is_listed_and_excuses_nothing(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        member = await _member(db_session, org_id)
        db_session.add(_leave(org_id, member, exempt=True))
        await db_session.flush()

        entry = _entry(await _report(db_session, org_id, date(2026, 10, 21)), member)

        assert entry["leave_months"] == 0
        assert entry["leave_periods"][0]["excuses_training"] is False

    async def test_a_member_with_no_leave_reads_zero(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        member = await _member(db_session, org_id)
        await db_session.flush()

        entry = _entry(await _report(db_session, org_id, date(2026, 10, 21)), member)

        assert entry["leave_months"] == 0
        assert entry["leave_periods"] == []

    async def test_a_year_the_leave_does_not_touch_lists_nothing(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        member = await _member(db_session, org_id)
        db_session.add(_leave(org_id, member))
        await db_session.flush()

        entry = _entry(
            await _report(db_session, org_id, date(2026, 10, 21), year=2024), member
        )

        assert entry["leave_months"] == 0
        assert entry["leave_periods"] == []

    async def test_another_departments_leave_stays_out(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        member = await _member(db_session, org_id)
        other_org = await _org(db_session)
        stranger = await _member(db_session, other_org)
        db_session.add(_leave(other_org, stranger))
        await db_session.flush()

        report = await _report(db_session, org_id, date(2026, 10, 21))

        assert stranger not in {e["member_id"] for e in report["entries"]}
        assert _entry(report, member)["leave_periods"] == []


class TestLeaveBesideProgramProgress:
    async def test_a_member_on_leave_today_is_marked_and_dated(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        member = await _member(db_session, org_id)
        db_session.add(_leave(org_id, member))
        await db_session.flush()

        report = await _report(
            db_session, org_id, date(2026, 8, 1), report_type="compliance_status"
        )
        entry = _entry(report, member)

        assert entry["on_leave"] is True
        assert entry["leave_periods"] == [
            {
                "start_date": "2025-07-01",
                "end_date": "2026-09-01",
                "excuses_training": True,
            }
        ]

    async def test_a_leave_ended_within_the_year_is_listed_but_not_current(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        member = await _member(db_session, org_id)
        db_session.add(_leave(org_id, member))
        await db_session.flush()

        entry = _entry(
            await _report(
                db_session, org_id, date(2026, 10, 21), report_type="compliance_status"
            ),
            member,
        )

        assert entry["on_leave"] is False
        assert len(entry["leave_periods"]) == 1

    async def test_a_leave_over_a_year_ago_is_not_listed(
        self, db_session, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        member = await _member(db_session, org_id)
        db_session.add(_leave(org_id, member))
        await db_session.flush()

        entry = _entry(
            await _report(
                db_session, org_id, date(2027, 10, 21), report_type="compliance_status"
            ),
            member,
        )

        assert entry["on_leave"] is False
        assert entry["leave_periods"] == []

    async def test_leave_changes_no_figure(self, db_session, setup_org_and_admin):
        org_id, _ = setup_org_and_admin
        member = await _member(db_session, org_id)
        await db_session.flush()
        before = await _report(
            db_session, org_id, date(2026, 8, 1), report_type="compliance_status"
        )
        db_session.add(_leave(org_id, member))
        await db_session.flush()

        after = await _report(
            db_session, org_id, date(2026, 8, 1), report_type="compliance_status"
        )

        figures = (
            "total_members",
            "fully_compliant_count",
            "partially_compliant_count",
            "non_compliant_count",
            "not_applicable_count",
            "overall_compliance_rate",
        )
        assert {k: after[k] for k in figures} == {k: before[k] for k in figures}
        keep = ("compliance_percentage", "total_requirements", "overdue_items")
        assert {k: _entry(after, member)[k] for k in keep} == {
            k: _entry(before, member)[k] for k in keep
        }
