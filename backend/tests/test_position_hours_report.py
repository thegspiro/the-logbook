"""Integration tests for the Hours by Position report (Reports page).

The report is the department's view of what each member's own My Hours
screen shows, so its figures must be the same ones (owner decisions,
2026-11-24): credited (finalized) shifts dated in the period, one row per
member per seat held, approved pre-shift work in the seat it was worked in,
and counted outside-agency time as one Other departments row.
"""

import uuid
from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.external_shift_hours import ExternalShiftHours, ExternalShiftHoursStatus
from app.models.training import (
    PreWorkStatus,
    Shift,
    ShiftAssignment,
    ShiftAttendance,
    ShiftPreWorkSession,
)
from app.services.report_tables import build_export_table
from app.services.reports_service import ReportsService
from app.services.scheduling_service import SchedulingService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


async def _add_org(db_session: AsyncSession) -> str:
    org_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone, settings) "
            "VALUES (:id, 'Seats FD', 'fire_department', :slug, "
            "'America/New_York', '{}')"
        ),
        {"id": org_id, "slug": f"seats-{org_id[:8]}"},
    )
    return org_id


async def _add_user(db_session: AsyncSession, org_id: str, first: str, last: str):
    user_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) VALUES "
            "(:id, :org, :un, :first, :last, :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"m-{user_id[:8]}",
            "first": first,
            "last": last,
            "em": f"{user_id[:8]}@test.com",
        },
    )
    return user_id


async def _shift(db_session: AsyncSession, org_id: str, day: date, *, finalized=True):
    shift_id = _uid()
    start = datetime(day.year, day.month, day.day, 8, 0)
    db_session.add(
        Shift(
            id=shift_id,
            organization_id=org_id,
            shift_date=day,
            start_time=start,
            end_time=start + timedelta(hours=12),
            is_finalized=finalized,
        )
    )
    await db_session.flush()
    return shift_id


async def _worked(
    db_session: AsyncSession,
    org_id: str,
    shift_id: str,
    user_id: str,
    minutes: int,
    seat: str | None,
    calls: int | None = None,
) -> None:
    start = datetime(2025, 1, 1, 8, 0)
    db_session.add(
        ShiftAttendance(
            id=_uid(),
            shift_id=shift_id,
            user_id=user_id,
            checked_in_at=start,
            checked_out_at=start + timedelta(minutes=minutes),
            duration_minutes=minutes,
            call_count=calls,
        )
    )
    if seat:
        db_session.add(
            ShiftAssignment(
                id=_uid(),
                organization_id=org_id,
                shift_id=shift_id,
                user_id=user_id,
                position=seat,
            )
        )
    await db_session.flush()


@pytest.fixture
async def department(db_session: AsyncSession):
    org_id = await _add_org(db_session)
    avery = await _add_user(db_session, org_id, "Avery", "Stone")
    blake = await _add_user(db_session, org_id, "Blake", "Adams")
    await db_session.flush()
    return org_id, avery, blake


class TestHoursByPositionReport:
    async def test_one_row_per_member_and_seat_for_the_period(
        self, db_session, department
    ):
        org_id, avery, blake = department
        # One shift crewed by both members in different seats: each is
        # credited in their own seat, not in the other's.
        crewed = await _shift(db_session, org_id, date(2025, 4, 7))
        await _worked(db_session, org_id, crewed, avery, 720, "driver", calls=3)
        await _worked(db_session, org_id, crewed, blake, 720, "officer", calls=3)
        second = await _shift(db_session, org_id, date(2025, 6, 2))
        await _worked(db_session, org_id, second, avery, 600, "driver", calls=1)
        unseated = await _shift(db_session, org_id, date(2025, 7, 1))
        await _worked(db_session, org_id, unseated, avery, 240, None)
        # Outside the period, and not yet finalized: neither counts.
        earlier = await _shift(db_session, org_id, date(2024, 12, 31))
        await _worked(db_session, org_id, earlier, avery, 480, "driver")
        pending = await _shift(db_session, org_id, date(2025, 8, 8), finalized=False)
        await _worked(db_session, org_id, pending, blake, 600, "driver")
        db_session.add(
            ExternalShiftHours(
                id=_uid(),
                organization_id=org_id,
                user_id=blake,
                shift_date=date(2025, 5, 3),
                duration_minutes=240,
                agency_name="County",
                apparatus_name="E116",
                call_count=2,
                status=ExternalShiftHoursStatus.COUNTED.value,
            )
        )
        await db_session.flush()

        report = await ReportsService(db_session).generate_report(
            org_id, "position_hours", date(2025, 1, 1), date(2025, 12, 31)
        )

        # Blake Adams before Avery Stone: by last name.
        assert report["entries"] == [
            {
                "member_name": "Blake Adams",
                "position": "Officer",
                "hours": 12.0,
                "shifts": 1,
                "calls": 3,
            },
            {
                "member_name": "Blake Adams",
                "position": "Other departments",
                "hours": 4.0,
                "shifts": 1,
                "calls": 2,
            },
            {
                "member_name": "Avery Stone",
                "position": "Driver/Operator",
                "hours": 22.0,
                "shifts": 2,
                "calls": 4,
            },
            {
                "member_name": "Avery Stone",
                "position": "No position recorded",
                "hours": 4.0,
                "shifts": 1,
                "calls": 0,
            },
        ]
        summary = report["summary"]
        assert summary["total_hours"] == 42.0
        assert summary["total_shifts"] == 5
        assert summary["total_calls"] == 9
        assert summary["members"] == 2
        assert [p["position"] for p in summary["by_position"]] == [
            "Driver/Operator",
            "Officer",
            "No position recorded",
            "Other departments",
        ]

    async def test_agrees_with_the_members_own_hours_screen(
        self, db_session, department
    ):
        org_id, avery, _ = department
        shift_id = await _shift(db_session, org_id, date(2025, 4, 7))
        await _worked(db_session, org_id, shift_id, avery, 600, "driver")
        db_session.add(
            ShiftPreWorkSession(
                id=_uid(),
                organization_id=org_id,
                shift_id=shift_id,
                user_id=avery,
                started_at=datetime(2025, 4, 7, 7, 0),
                ended_at=datetime(2025, 4, 7, 8, 0),
                duration_minutes=60,
                status=PreWorkStatus.APPROVED,
                approved_minutes=60,
            )
        )
        await db_session.flush()

        report = await ReportsService(db_session).generate_report(
            org_id, "position_hours", date(2025, 1, 1), date(2025, 12, 31)
        )
        own = await SchedulingService(db_session).get_my_hours_history(
            avery, org_id, 2025
        )

        assert own["positions"] == [
            {"position": "driver", "shifts": 1, "hours": 11.0, "calls": 0}
        ]
        assert [
            (e["position"], e["hours"], e["shifts"]) for e in report["entries"]
        ] == [("Driver/Operator", 11.0, 1)]

    async def test_another_departments_shifts_and_members_are_not_listed(
        self, db_session, department
    ):
        org_id, avery, _ = department
        other_org = await _add_org(db_session)
        stranger = await _add_user(db_session, other_org, "Casey", "Reed")
        theirs = await _shift(db_session, other_org, date(2025, 4, 7))
        await _worked(db_session, other_org, theirs, stranger, 600, "driver")
        # Our member's shift on the other department's roster is theirs too.
        await _worked(db_session, other_org, theirs, avery, 600, "officer")
        await db_session.flush()

        report = await ReportsService(db_session).generate_report(
            org_id, "position_hours", date(2025, 1, 1), date(2025, 12, 31)
        )

        assert report["entries"] == []
        assert report["summary"]["members"] == 0

    async def test_exports_the_rows_the_page_shows(self, db_session, department):
        org_id, avery, _ = department
        shift_id = await _shift(db_session, org_id, date(2025, 4, 7))
        await _worked(db_session, org_id, shift_id, avery, 720, "driver", calls=3)

        report = await ReportsService(db_session).generate_report(
            org_id, "position_hours", date(2025, 1, 1), date(2025, 12, 31)
        )
        table = build_export_table("position_hours", report)

        assert [c.header for c in table.columns] == [
            "Member",
            "Position",
            "Hours",
            "Shifts",
            "Calls",
        ]
        assert table.rows == report["entries"]
        assert table.kpis == [
            ("Total Hours", "12.0"),
            ("Shifts", "1"),
            ("Calls", "3"),
            ("Members", "1"),
        ]
        assert table.contains_member_data
