"""Integration tests for a member's own hours-and-calls history.

The screen these back answers "how am I doing this year?", so the figures
have to mean the same thing the department's own report means. Two
invariants carry that:

* **Credited hours are hours on a finalized shift.** The department's
  member-hours report counts only finalized attendance, and a member whose
  own screen counted pending time too would read a larger number than their
  officer does and have no way to see why.
* **A month with nothing in it is still a month.** Twelve entries always,
  so a quiet month reads as a quiet month rather than as data that failed
  to load.
"""

import json
import uuid
from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = [pytest.mark.integration]

from app.api.v1.endpoints import scheduling as scheduling_endpoint
from app.models.training import Shift, ShiftAttendance
from app.models.user import User
from app.services.scheduling_service import SchedulingService


def _uid() -> str:
    return str(uuid.uuid4())


async def _add_org(db_session: AsyncSession, tz: str = "America/New_York") -> str:
    org_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone, settings) "
            "VALUES (:id, :name, :otype, :slug, :tz, :settings)"
        ),
        {
            "id": org_id,
            "name": "Hours FD",
            "otype": "fire_department",
            "slug": f"hours-{org_id[:8]}",
            "tz": tz,
            "settings": json.dumps({}),
        },
    )
    return org_id


async def _add_user(db_session: AsyncSession, org_id: str) -> str:
    user_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) VALUES "
            "(:id, :org, :un, 'Casey', 'Reed', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"member-{user_id[:8]}",
            "em": f"{user_id[:8]}@test.com",
        },
    )
    return user_id


@pytest.fixture
async def org_and_member(db_session: AsyncSession):
    org_id = await _add_org(db_session)
    user_id = await _add_user(db_session, org_id)
    await db_session.flush()
    return org_id, user_id


async def _worked(
    db_session: AsyncSession,
    org_id: str,
    user_id: str,
    shift_date: date,
    minutes: int,
    *,
    finalized: bool,
    calls: int | None = None,
) -> str:
    """Record one shift the member worked, finalized or not."""
    shift_id = _uid()
    start = datetime(shift_date.year, shift_date.month, shift_date.day, 8, 0)
    db_session.add(
        Shift(
            id=shift_id,
            organization_id=org_id,
            shift_date=shift_date,
            start_time=start,
            end_time=start + timedelta(minutes=minutes),
            is_finalized=finalized,
        )
    )
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
    await db_session.flush()
    return shift_id


class TestMemberMonthTotals:

    @pytest.mark.asyncio
    async def test_buckets_by_month_with_calls(self, db_session, org_and_member):
        org_id, user_id = org_and_member
        svc = SchedulingService(db_session)

        await _worked(
            db_session, org_id, user_id, date(2025, 3, 4), 720, finalized=True, calls=3
        )
        await _worked(
            db_session, org_id, user_id, date(2025, 3, 18), 480, finalized=True, calls=2
        )
        await _worked(
            db_session, org_id, user_id, date(2025, 7, 9), 360, finalized=True, calls=1
        )

        buckets = await svc.get_member_month_totals(
            user_id, org_id, date(2025, 1, 1), date(2025, 12, 31)
        )

        march = buckets[(2025, 3)]
        assert march["shifts"] == 2
        assert march["hours"] == 20.0
        assert march["calls"] == 5
        assert buckets[(2025, 7)]["hours"] == 6.0
        assert (2025, 4) not in buckets

    @pytest.mark.asyncio
    async def test_pending_is_reported_separately(self, db_session, org_and_member):
        """Time on an unfinalized shift is visible but not yet credited.

        The member can see the shift they just worked without the figure
        claiming credit the close-out has not granted.
        """
        org_id, user_id = org_and_member
        svc = SchedulingService(db_session)

        await _worked(
            db_session, org_id, user_id, date(2025, 5, 2), 600, finalized=True, calls=4
        )
        await _worked(
            db_session, org_id, user_id, date(2025, 5, 20), 300, finalized=False
        )

        may = (
            await svc.get_member_month_totals(
                user_id, org_id, date(2025, 5, 1), date(2025, 5, 31)
            )
        )[(2025, 5)]

        assert may["shifts"] == 1
        assert may["hours"] == 10.0
        assert may["calls"] == 4
        assert may["pending_shifts"] == 1
        assert may["pending_hours"] == 5.0

    @pytest.mark.asyncio
    async def test_year_boundary_keeps_months_distinct(
        self, db_session, org_and_member
    ):
        """December and the January after it are different buckets.

        The key is ``(year, month)`` precisely so a span crossing New Year
        does not fold last December into this one.
        """
        org_id, user_id = org_and_member
        svc = SchedulingService(db_session)

        await _worked(
            db_session,
            org_id,
            user_id,
            date(2024, 12, 30),
            600,
            finalized=True,
            calls=2,
        )
        await _worked(
            db_session, org_id, user_id, date(2025, 12, 2), 240, finalized=True, calls=1
        )

        buckets = await svc.get_member_month_totals(
            user_id, org_id, date(2024, 1, 1), date(2025, 12, 31)
        )

        assert buckets[(2024, 12)]["hours"] == 10.0
        assert buckets[(2025, 12)]["hours"] == 4.0

    @pytest.mark.asyncio
    async def test_other_orgs_shifts_are_not_counted(self, db_session, org_and_member):
        """``shift_attendance`` has no org column; the shift is what scopes it."""
        org_id, user_id = org_and_member
        other_org_id = await _add_org(db_session)
        await db_session.flush()
        svc = SchedulingService(db_session)

        await _worked(
            db_session, org_id, user_id, date(2025, 6, 3), 600, finalized=True, calls=1
        )
        await _worked(
            db_session,
            other_org_id,
            user_id,
            date(2025, 6, 4),
            600,
            finalized=True,
            calls=9,
        )

        june = (
            await svc.get_member_month_totals(
                user_id, org_id, date(2025, 6, 1), date(2025, 6, 30)
            )
        )[(2025, 6)]

        assert june["shifts"] == 1
        assert june["hours"] == 10.0
        assert june["calls"] == 1


class TestMyHoursHistory:

    @pytest.mark.asyncio
    async def test_year_always_has_twelve_months(self, db_session, org_and_member):
        org_id, user_id = org_and_member
        svc = SchedulingService(db_session)

        await _worked(
            db_session, org_id, user_id, date(2025, 2, 11), 480, finalized=True, calls=2
        )

        history = await svc.get_my_hours_history(user_id, org_id, 2025)

        assert history["year"] == 2025
        assert [m["month"] for m in history["months"]] == list(range(1, 13))
        assert history["months"][1]["hours"] == 8.0
        assert history["months"][0]["hours"] == 0.0
        assert history["totals"]["hours"] == 8.0
        assert history["totals"]["shifts"] == 1
        assert history["totals"]["calls"] == 2
        assert history["earliest_year"] == 2025
        assert history["timezone"] == "America/New_York"

    @pytest.mark.asyncio
    async def test_totals_sum_the_figures_shown_beside_them(
        self, db_session, org_and_member
    ):
        """Quarter-rounded parts, then a total — never a rounded raw sum.

        Two ten-minute shifts each round to 0.25; a total taken from raw
        minutes would print 0.25 above two rows reading 0.25.
        """
        org_id, user_id = org_and_member
        svc = SchedulingService(db_session)

        await _worked(
            db_session, org_id, user_id, date(2025, 8, 5), 10, finalized=True, calls=0
        )
        await _worked(
            db_session, org_id, user_id, date(2025, 9, 5), 10, finalized=True, calls=0
        )

        history = await svc.get_my_hours_history(user_id, org_id, 2025)

        assert history["months"][7]["hours"] == 0.25
        assert history["months"][8]["hours"] == 0.25
        assert history["totals"]["hours"] == 0.5

    @pytest.mark.asyncio
    async def test_recent_months_reported_while_viewing_an_earlier_year(
        self, db_session, org_and_member
    ):
        """ "Last month" is not confined to the year being viewed.

        A member reading 2019 still gets the month that just ended, which is
        the figure the card exists to show.
        """
        org_id, user_id = org_and_member
        svc = SchedulingService(db_session)

        today = date.today()
        await _worked(db_session, org_id, user_id, today, 480, finalized=True, calls=2)

        history = await svc.get_my_hours_history(user_id, org_id, today.year - 6)

        assert history["current_month"]["year"] == today.year
        assert history["current_month"]["month"] == today.month
        assert history["current_month"]["hours"] == 8.0
        assert history["totals"]["hours"] == 0.0

    @pytest.mark.asyncio
    async def test_previous_month_precedes_the_current_one(
        self, db_session, org_and_member
    ):
        org_id, user_id = org_and_member
        svc = SchedulingService(db_session)

        today = date.today()
        previous_end = today.replace(day=1) - timedelta(days=1)
        await _worked(
            db_session, org_id, user_id, previous_end, 600, finalized=True, calls=3
        )

        history = await svc.get_my_hours_history(user_id, org_id)

        assert history["previous_month"]["year"] == previous_end.year
        assert history["previous_month"]["month"] == previous_end.month
        assert history["previous_month"]["hours"] == 10.0
        assert history["previous_month"]["calls"] == 3

    @pytest.mark.asyncio
    async def test_member_with_no_attendance_reads_as_zero(
        self, db_session, org_and_member
    ):
        org_id, user_id = org_and_member
        svc = SchedulingService(db_session)

        history = await svc.get_my_hours_history(user_id, org_id, 2025)

        assert history["earliest_year"] is None
        assert history["totals"] == {
            "shifts": 0,
            "hours": 0.0,
            "calls": 0,
            "pending_shifts": 0,
            "pending_hours": 0.0,
        }
        assert history["previous_month"]["hours"] == 0.0

    @pytest.mark.asyncio
    async def test_endpoint_returns_the_callers_own_history(
        self, db_session, org_and_member
    ):
        """The endpoint reports the caller, not a user id from the request."""
        org_id, user_id = org_and_member
        other_id = await _add_user(db_session, org_id)
        await db_session.flush()

        await _worked(
            db_session, org_id, user_id, date(2025, 4, 7), 480, finalized=True, calls=2
        )
        await _worked(
            db_session, org_id, other_id, date(2025, 4, 8), 720, finalized=True, calls=9
        )

        current_user = await db_session.get(User, user_id)
        result = await scheduling_endpoint.get_my_hours_history(
            2025, db_session, current_user
        )

        assert result["totals"]["hours"] == 8.0
        assert result["totals"]["calls"] == 2
