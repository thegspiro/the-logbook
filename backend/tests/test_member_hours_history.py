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
from unittest.mock import patch
from zoneinfo import ZoneInfo

import pytest
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = [pytest.mark.integration]

from app.api.v1.endpoints import scheduling as scheduling_endpoint
from app.models.external_shift_hours import ExternalShiftHours, ExternalShiftHoursStatus
from app.models.training import Shift, ShiftAttendance, ShiftDutyType
from app.models.user import User
from app.services.scheduling_service import SchedulingService


def _uid() -> str:
    return str(uuid.uuid4())


def _department_today() -> date:
    """The org's date (America/New_York, as _add_org makes it).

    The service reads "this month" and "last month" in the department's zone;
    the container's UTC date runs ahead of it every New York evening, which on
    the last day of a month puts the two in different months.
    """
    return datetime.now(ZoneInfo("America/New_York")).date()


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
    async def test_omitted_bounds_span_every_year(self, db_session, org_and_member):
        """No bounds is the member's whole career — what all-time reads."""
        org_id, user_id = org_and_member
        svc = SchedulingService(db_session)

        await _worked(
            db_session, org_id, user_id, date(2019, 3, 4), 600, finalized=True, calls=2
        )
        await _worked(
            db_session, org_id, user_id, date(2026, 8, 9), 240, finalized=True, calls=1
        )

        buckets = await svc.get_member_month_totals(user_id, org_id)

        assert set(buckets) == {(2019, 3), (2026, 8)}
        assert buckets[(2019, 3)]["hours"] == 10.0
        assert buckets[(2026, 8)]["hours"] == 4.0

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

        # The unbounded span drops the date filters, not the org filter.
        lifetime = await svc.get_member_month_totals(user_id, org_id)
        assert set(lifetime) == {(2025, 6)}
        assert lifetime[(2025, 6)]["calls"] == 1


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

        today = _department_today()
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

        today = _department_today()
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

        zero = {
            "shifts": 0,
            "hours": 0.0,
            "calls": 0,
            "pending_shifts": 0,
            "pending_hours": 0.0,
            "external_shifts": 0,
            "external_hours": 0.0,
            "external_calls": 0,
            "on_call_shifts": 0,
            "on_call_hours": 0.0,
        }

        assert history["earliest_year"] is None
        assert history["totals"] == zero
        assert history["all_time"] == zero
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
        assert result["all_time"]["hours"] == 8.0
        assert result["all_time"]["calls"] == 2


class TestAllTimeTotals:
    """The all-time card sits beside the year total and must agree with it."""

    @pytest.mark.asyncio
    async def test_spans_years_the_selected_year_excludes(
        self, db_session, org_and_member
    ):
        org_id, user_id = org_and_member
        svc = SchedulingService(db_session)

        await _worked(
            db_session, org_id, user_id, date(2024, 5, 6), 600, finalized=True, calls=3
        )
        await _worked(
            db_session, org_id, user_id, date(2026, 2, 3), 240, finalized=True, calls=1
        )

        history = await svc.get_my_hours_history(user_id, org_id, 2026)

        assert history["totals"]["hours"] == 4.0
        assert history["totals"]["shifts"] == 1
        assert history["totals"]["calls"] == 1

        assert history["all_time"]["hours"] == 14.0
        assert history["all_time"]["shifts"] == 2
        assert history["all_time"]["calls"] == 4

    @pytest.mark.asyncio
    async def test_selected_year_does_not_change_the_all_time_figure(
        self, db_session, org_and_member
    ):
        """The year picker moves the table; the career total is not a view."""
        org_id, user_id = org_and_member
        svc = SchedulingService(db_session)

        await _worked(
            db_session, org_id, user_id, date(2024, 5, 6), 600, finalized=True, calls=3
        )
        await _worked(
            db_session, org_id, user_id, date(2026, 2, 3), 240, finalized=True, calls=1
        )

        viewing_2024 = await svc.get_my_hours_history(user_id, org_id, 2024)
        viewing_2026 = await svc.get_my_hours_history(user_id, org_id, 2026)

        assert viewing_2024["totals"]["hours"] == 10.0
        assert viewing_2026["totals"]["hours"] == 4.0
        assert viewing_2024["all_time"] == viewing_2026["all_time"]

    @pytest.mark.asyncio
    async def test_hours_fold_on_the_quarter_across_years(
        self, db_session, org_and_member
    ):
        """Two 10-minute shifts read 0.25 each, so all time reads 0.5.

        Summing the raw minutes instead gives 20 minutes -> 0.25, and the
        all-time card would then be less than the year total printed beside
        it. Same invariant the year total is held to, one level up.
        """
        org_id, user_id = org_and_member
        svc = SchedulingService(db_session)

        await _worked(
            db_session, org_id, user_id, date(2025, 3, 4), 10, finalized=True, calls=0
        )
        await _worked(
            db_session, org_id, user_id, date(2026, 3, 4), 10, finalized=True, calls=0
        )

        history = await svc.get_my_hours_history(user_id, org_id, 2026)

        assert history["totals"]["hours"] == 0.25
        assert history["all_time"]["hours"] == 0.5

    @pytest.mark.asyncio
    async def test_pending_stays_out_of_the_credited_figure(
        self, db_session, org_and_member
    ):
        org_id, user_id = org_and_member
        svc = SchedulingService(db_session)

        await _worked(
            db_session, org_id, user_id, date(2024, 7, 1), 600, finalized=True, calls=2
        )
        await _worked(
            db_session, org_id, user_id, date(2026, 7, 1), 300, finalized=False
        )

        history = await svc.get_my_hours_history(user_id, org_id, 2026)

        assert history["all_time"]["hours"] == 10.0
        assert history["all_time"]["shifts"] == 1
        assert history["all_time"]["pending_hours"] == 5.0
        assert history["all_time"]["pending_shifts"] == 1

    @pytest.mark.asyncio
    async def test_other_orgs_are_not_counted(self, db_session, org_and_member):
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
            date(2019, 6, 4),
            600,
            finalized=True,
            calls=9,
        )

        history = await svc.get_my_hours_history(user_id, org_id, 2025)

        assert history["all_time"]["hours"] == 10.0
        assert history["all_time"]["calls"] == 1
        # The other org's earlier shift must not stretch the year picker
        # back to a year this department never saw the member work.
        assert history["earliest_year"] == 2025

    @pytest.mark.asyncio
    async def test_earliest_year_counts_a_pending_only_year(
        self, db_session, org_and_member
    ):
        """The picker offers a year whose shifts are all awaiting close-out.

        ``earliest_year`` now comes from the same buckets everything else
        does, and those buckets hold pending months too — which is the
        behaviour it had when it was its own ``MIN(shift_date)`` query.
        """
        org_id, user_id = org_and_member
        svc = SchedulingService(db_session)

        await _worked(
            db_session, org_id, user_id, date(2023, 9, 8), 300, finalized=False
        )
        await _worked(
            db_session, org_id, user_id, date(2026, 1, 9), 600, finalized=True, calls=1
        )

        history = await svc.get_my_hours_history(user_id, org_id, 2026)

        assert history["earliest_year"] == 2023
        assert history["all_time"]["hours"] == 10.0
        assert history["all_time"]["pending_hours"] == 5.0


class TestOnCallAndOutsideCalls:
    """Recall shifts are a part of the credited hours, never added to them."""

    @pytest.mark.asyncio
    async def test_on_call_hours_are_a_part_of_the_total(
        self, db_session, org_and_member
    ):
        org_id, user_id = org_and_member
        await _worked(
            db_session, org_id, user_id, date(2025, 4, 7), 720, finalized=True, calls=2
        )
        recall = await _worked(
            db_session, org_id, user_id, date(2025, 4, 9), 600, finalized=True, calls=0
        )
        shift = await db_session.get(Shift, recall)
        shift.duty_type = ShiftDutyType.ON_CALL.value
        await db_session.flush()

        buckets = await SchedulingService(db_session).get_member_month_totals(
            user_id, org_id
        )

        april = buckets[(2025, 4)]
        assert april["hours"] == 22.0
        assert april["shifts"] == 2
        assert april["on_call_hours"] == 10.0
        assert april["on_call_shifts"] == 1
        assert april["calls"] == 2

    @pytest.mark.asyncio
    async def test_an_unfinalized_recall_shift_is_pending_not_on_call(
        self, db_session, org_and_member
    ):
        org_id, user_id = org_and_member
        recall = await _worked(
            db_session, org_id, user_id, date(2025, 4, 9), 600, finalized=False
        )
        shift = await db_session.get(Shift, recall)
        shift.duty_type = ShiftDutyType.ON_CALL.value
        await db_session.flush()

        april = (
            await SchedulingService(db_session).get_member_month_totals(user_id, org_id)
        )[(2025, 4)]
        assert april["pending_hours"] == 10.0
        assert april["on_call_hours"] == 0.0

    @pytest.mark.asyncio
    async def test_outside_agency_calls_are_reported(self, db_session, org_and_member):
        org_id, user_id = org_and_member
        db_session.add(
            ExternalShiftHours(
                id=_uid(),
                organization_id=org_id,
                user_id=user_id,
                shift_date=date(2025, 5, 3),
                duration_minutes=240,
                agency_name="County",
                apparatus_name="E116",
                call_count=3,
                status=ExternalShiftHoursStatus.COUNTED.value,
            )
        )
        await db_session.flush()

        history = await SchedulingService(db_session).get_my_hours_history(
            user_id, org_id, 2025
        )
        assert history["totals"]["external_calls"] == 3
        assert history["totals"]["external_hours"] == 4.0
        # Outside time stays beside the department's own figure.
        assert history["totals"]["hours"] == 0.0


class TestMemberHoursEndpoint:
    """A member's history on their profile: theirs, or an officer's to read."""

    @pytest.mark.asyncio
    async def test_a_member_reads_their_own(self, db_session, org_and_member):
        org_id, user_id = org_and_member
        await _worked(
            db_session, org_id, user_id, date(2025, 4, 7), 480, finalized=True
        )
        me = await db_session.get(User, user_id)
        result = await scheduling_endpoint.get_member_hours_history(
            uuid.UUID(user_id), 2025, db_session, me
        )
        assert result["totals"]["hours"] == 8.0

    @pytest.mark.asyncio
    async def test_another_member_is_refused_without_the_report_permission(
        self, db_session, org_and_member
    ):
        org_id, user_id = org_and_member
        other_id = await _add_user(db_session, org_id)
        await db_session.flush()
        other = await db_session.get(User, other_id)
        with patch.object(
            scheduling_endpoint, "user_has_permission", return_value=False
        ):
            with pytest.raises(HTTPException) as refused:
                await scheduling_endpoint.get_member_hours_history(
                    uuid.UUID(user_id), 2025, db_session, other
                )
        assert refused.value.status_code == 403

    @pytest.mark.asyncio
    async def test_an_officer_reads_a_member_in_their_department(
        self, db_session, org_and_member
    ):
        org_id, user_id = org_and_member
        officer_id = await _add_user(db_session, org_id)
        await _worked(
            db_session, org_id, user_id, date(2025, 4, 7), 480, finalized=True
        )
        officer = await db_session.get(User, officer_id)
        with patch.object(
            scheduling_endpoint, "user_has_permission", return_value=True
        ) as check:
            result = await scheduling_endpoint.get_member_hours_history(
                uuid.UUID(user_id), 2025, db_session, officer
            )
        check.assert_called_once_with(officer, "scheduling.report")
        assert result["totals"]["hours"] == 8.0

    @pytest.mark.asyncio
    async def test_a_member_of_another_department_reads_as_not_found(
        self, db_session, org_and_member
    ):
        org_id, _ = org_and_member
        officer_id = await _add_user(db_session, org_id)
        other_org = await _add_org(db_session)
        stranger = await _add_user(db_session, other_org)
        await db_session.flush()
        officer = await db_session.get(User, officer_id)
        with patch.object(
            scheduling_endpoint, "user_has_permission", return_value=True
        ):
            with pytest.raises(HTTPException) as missing:
                await scheduling_endpoint.get_member_hours_history(
                    uuid.UUID(stranger), 2025, db_session, officer
                )
        assert missing.value.status_code == 404
