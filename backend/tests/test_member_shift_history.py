"""Integration tests for a member's shift-by-shift history.

The member's Hours screen lists the department's own shifts and the shifts
they logged with other departments in one list, under the same headings as
the chart above it. Three things keep that list honest:

* **A row is the shift the totals already count.** Its hours are the
  member's attendance plus approved pre-shift work on that shift — the same
  minutes :meth:`SchedulingService.get_member_month_totals` adds up — so the
  list never shows a shift the totals leave out, or the reverse.
* **A shift awaiting close-out is shown as such.** ``credited`` is false and
  ``calls`` is None, because neither hours nor calls count until an officer
  finalizes the shift.
* **The year headings come from the same aggregate as the chart**, so a
  heading cannot disagree with the year it names.
"""

import uuid
from datetime import date, datetime, timedelta
from unittest.mock import patch
from zoneinfo import ZoneInfo

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints import scheduling as scheduling_endpoint
from app.models.external_shift_hours import ExternalShiftHours, ExternalShiftHoursStatus
from app.models.training import (
    PreWorkStatus,
    Shift,
    ShiftAssignment,
    ShiftAttendance,
    ShiftDutyType,
    ShiftPreWorkSession,
    ShiftTemplate,
)
from app.models.user import User
from app.schemas.organization import OrganizationProfileUpdate
from app.services.scheduling_service import SchedulingService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


async def _add_org(
    db_session: AsyncSession, *, name: str = "Falls Church VFD", short_name=None
) -> str:
    org_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, short_name, organization_type, slug, timezone, settings) "
            "VALUES (:id, :name, :short, 'fire_department', :slug, "
            "'America/New_York', '{}')"
        ),
        {
            "id": org_id,
            "name": name,
            "short": short_name,
            "slug": f"history-{org_id[:8]}",
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
    org_id = await _add_org(db_session, short_name="FCVFD")
    user_id = await _add_user(db_session, org_id)
    await db_session.flush()
    return org_id, user_id


async def _shift(
    db_session: AsyncSession,
    org_id: str,
    shift_date: date,
    minutes: int = 720,
    *,
    finalized: bool = True,
    on_call: bool = False,
    template_id: str | None = None,
) -> Shift:
    start = datetime(shift_date.year, shift_date.month, shift_date.day, 7, 0)
    shift = Shift(
        id=_uid(),
        organization_id=org_id,
        shift_date=shift_date,
        start_time=start,
        end_time=start + timedelta(minutes=minutes),
        is_finalized=finalized,
        template_id=template_id,
        duty_type=(
            ShiftDutyType.ON_CALL.value if on_call else ShiftDutyType.IN_STATION.value
        ),
    )
    db_session.add(shift)
    await db_session.flush()
    return shift


async def _attend(
    db_session: AsyncSession,
    shift: Shift,
    user_id: str,
    minutes: int,
    calls: int | None = None,
) -> None:
    db_session.add(
        ShiftAttendance(
            id=_uid(),
            shift_id=shift.id,
            user_id=user_id,
            checked_in_at=shift.start_time,
            checked_out_at=shift.start_time + timedelta(minutes=minutes),
            duration_minutes=minutes,
            call_count=calls,
        )
    )
    await db_session.flush()


async def _prep(
    db_session: AsyncSession, shift: Shift, user_id: str, minutes: int, status
) -> None:
    started = shift.start_time - timedelta(hours=2)
    db_session.add(
        ShiftPreWorkSession(
            organization_id=shift.organization_id,
            shift_id=shift.id,
            user_id=user_id,
            started_at=started,
            ended_at=started + timedelta(minutes=minutes),
            duration_minutes=minutes,
            status=status,
            approved_minutes=minutes if status == PreWorkStatus.APPROVED else None,
        )
    )
    await db_session.flush()


def _external(org_id: str, user_id: str, shift_date: date, minutes: int, status):
    return ExternalShiftHours(
        id=_uid(),
        organization_id=org_id,
        user_id=user_id,
        shift_date=shift_date,
        duration_minutes=minutes,
        agency_name="Arlington County Fire Department",
        apparatus_name="A106",
        status=status,
    )


class TestDepartmentShifts:
    @pytest.mark.asyncio
    async def test_a_credited_shift_carries_its_hours_calls_and_labels(
        self, db_session, org_and_member
    ):
        org_id, user_id = org_and_member
        template = ShiftTemplate(
            id=_uid(),
            organization_id=org_id,
            name="Night shift",
            start_time_of_day="18:00",
            end_time_of_day="07:00",
            duration_hours=13,
        )
        db_session.add(template)
        await db_session.flush()
        shift = await _shift(
            db_session, org_id, date(2025, 9, 13), template_id=template.id
        )
        await _attend(db_session, shift, user_id, 780, calls=4)
        db_session.add(
            ShiftAssignment(
                organization_id=org_id,
                shift_id=shift.id,
                user_id=user_id,
                position="emt",
            )
        )
        await db_session.flush()

        history = await SchedulingService(db_session).get_member_shift_history(
            user_id, org_id, 2025
        )

        assert len(history["department_shifts"]) == 1
        row = history["department_shifts"][0]
        assert row["shift_id"] == shift.id
        assert row["hours"] == 13.0
        assert row["calls"] == 4
        assert row["credited"] is True
        assert row["on_call"] is False
        assert row["template_name"] == "Night shift"
        assert row["position"] == "emt"

    @pytest.mark.asyncio
    async def test_a_shift_awaiting_close_out_is_not_credited_and_has_no_calls(
        self, db_session, org_and_member
    ):
        org_id, user_id = org_and_member
        shift = await _shift(db_session, org_id, date(2025, 11, 2), finalized=False)
        await _attend(db_session, shift, user_id, 600, calls=3)

        history = await SchedulingService(db_session).get_member_shift_history(
            user_id, org_id, 2025
        )

        row = history["department_shifts"][0]
        assert row["credited"] is False
        assert row["calls"] is None
        assert row["hours"] == 10.0

    @pytest.mark.asyncio
    async def test_approved_pre_shift_work_is_part_of_the_shifts_hours(
        self, db_session, org_and_member
    ):
        """A row's hours are what the month total counts for that shift."""
        org_id, user_id = org_and_member
        worked = await _shift(db_session, org_id, date(2025, 4, 5))
        await _attend(db_session, worked, user_id, 720)
        await _prep(db_session, worked, user_id, 30, PreWorkStatus.APPROVED)
        await _prep(db_session, worked, user_id, 45, PreWorkStatus.REJECTED)
        # Prepped for, then never recorded as attended: the month total
        # counts it, so the list must show it.
        prep_only = await _shift(db_session, org_id, date(2025, 4, 19))
        await _prep(db_session, prep_only, user_id, 60, PreWorkStatus.APPROVED)

        svc = SchedulingService(db_session)
        history = await svc.get_member_shift_history(user_id, org_id, 2025)
        hours = {r["shift_id"]: r["hours"] for r in history["department_shifts"]}
        assert hours == {worked.id: 12.5, prep_only.id: 1.0}

        april = (await svc.get_member_month_totals(user_id, org_id))[(2025, 4)]
        assert april["hours"] == sum(hours.values())

    @pytest.mark.asyncio
    async def test_newest_first_and_only_the_requested_year(
        self, db_session, org_and_member
    ):
        org_id, user_id = org_and_member
        older = await _shift(db_session, org_id, date(2025, 3, 1))
        newer = await _shift(db_session, org_id, date(2025, 10, 1))
        last_year = await _shift(db_session, org_id, date(2024, 12, 31))
        for s in (older, newer, last_year):
            await _attend(db_session, s, user_id, 60)

        history = await SchedulingService(db_session).get_member_shift_history(
            user_id, org_id, 2025
        )
        assert [r["shift_id"] for r in history["department_shifts"]] == [
            newer.id,
            older.id,
        ]

    @pytest.mark.asyncio
    async def test_another_member_and_another_department_are_left_out(
        self, db_session, org_and_member
    ):
        org_id, user_id = org_and_member
        colleague = await _add_user(db_session, org_id)
        other_org = await _add_org(db_session, name="Elsewhere FD")
        await db_session.flush()

        theirs = await _shift(db_session, org_id, date(2025, 6, 1))
        await _attend(db_session, theirs, colleague, 600)
        # The member's own attendance on a shift that belongs to another org
        # (a bad row) is not this department's record.
        foreign = await _shift(db_session, other_org, date(2025, 6, 2))
        await _attend(db_session, foreign, user_id, 600)
        db_session.add(
            _external(
                other_org,
                user_id,
                date(2025, 6, 3),
                600,
                ExternalShiftHoursStatus.COUNTED.value,
            )
        )
        db_session.add(
            _external(
                org_id,
                colleague,
                date(2025, 6, 4),
                600,
                ExternalShiftHoursStatus.COUNTED.value,
            )
        )
        await db_session.flush()

        history = await SchedulingService(db_session).get_member_shift_history(
            user_id, org_id, 2025
        )
        assert history["department_shifts"] == []
        assert history["external_shifts"] == []
        assert history["external_total"] == 0


class TestExternalShifts:
    @pytest.mark.asyncio
    async def test_every_status_is_listed_for_the_year(
        self, db_session, org_and_member
    ):
        """The member manages their entries from this list, so a pending or a
        rejected one is shown, not only those that count."""
        org_id, user_id = org_and_member
        for day, status in (
            (date(2025, 5, 17), ExternalShiftHoursStatus.COUNTED.value),
            (date(2025, 6, 1), ExternalShiftHoursStatus.PENDING.value),
            (date(2025, 7, 26), ExternalShiftHoursStatus.REJECTED.value),
            (date(2024, 11, 10), ExternalShiftHoursStatus.COUNTED.value),
        ):
            db_session.add(_external(org_id, user_id, day, 1440, status))
        await db_session.flush()

        history = await SchedulingService(db_session).get_member_shift_history(
            user_id, org_id, 2025
        )
        assert [e["status"] for e in history["external_shifts"]] == [
            "rejected",
            "pending",
            "counted",
        ]
        assert history["external_total"] == 3
        assert history["external_shifts"][0]["agency_name"] == (
            "Arlington County Fire Department"
        )

    @pytest.mark.asyncio
    async def test_external_total_reports_entries_beyond_the_limit(
        self, db_session, org_and_member
    ):
        org_id, user_id = org_and_member
        for day in (1, 2, 3):
            db_session.add(
                _external(
                    org_id,
                    user_id,
                    date(2025, 8, day),
                    60,
                    ExternalShiftHoursStatus.COUNTED.value,
                )
            )
        await db_session.flush()

        history = await SchedulingService(db_session).get_member_shift_history(
            user_id, org_id, 2025, external_limit=2
        )
        assert len(history["external_shifts"]) == 2
        assert history["external_total"] == 3


class TestYearHeadingsAndLabel:
    @pytest.mark.asyncio
    async def test_every_year_on_record_newest_first_with_its_totals(
        self, db_session, org_and_member
    ):
        org_id, user_id = org_and_member
        s2025 = await _shift(db_session, org_id, date(2025, 4, 5))
        await _attend(db_session, s2025, user_id, 780, calls=2)
        s2022 = await _shift(db_session, org_id, date(2022, 1, 2))
        await _attend(db_session, s2022, user_id, 600)
        db_session.add(
            _external(
                org_id,
                user_id,
                date(2025, 7, 26),
                1485,
                ExternalShiftHoursStatus.COUNTED.value,
            )
        )
        await db_session.flush()

        history = await SchedulingService(db_session).get_my_hours_history(
            user_id, org_id, 2025
        )

        assert [y["year"] for y in history["years"]] == [2025, 2022]
        y2025 = history["years"][0]
        assert len(y2025["months"]) == 12
        assert y2025["totals"]["hours"] == 13.0
        assert y2025["totals"]["external_hours"] == 24.75
        assert y2025["months"][6]["external_hours"] == 24.75
        # The selected year's heading is the same figure as its own totals.
        assert y2025["totals"] == history["totals"]
        assert history["years"][1]["totals"]["hours"] == 10.0

    @pytest.mark.asyncio
    async def test_a_year_holding_only_uncounted_outside_entries_has_a_heading(
        self, db_session, org_and_member
    ):
        """A pending or rejected entry is in no total, but the member manages it
        from the list, so its year still needs a heading to open."""
        org_id, user_id = org_and_member
        db_session.add(
            _external(
                org_id,
                user_id,
                date(2024, 3, 9),
                600,
                ExternalShiftHoursStatus.PENDING.value,
            )
        )
        await db_session.flush()

        history = await SchedulingService(db_session).get_my_hours_history(
            user_id, org_id, 2025
        )
        assert [y["year"] for y in history["years"]] == [2024]
        assert history["years"][0]["totals"]["external_hours"] == 0.0

    @pytest.mark.asyncio
    async def test_department_label_is_the_short_name(self, db_session, org_and_member):
        org_id, user_id = org_and_member
        history = await SchedulingService(db_session).get_my_hours_history(
            user_id, org_id, 2025
        )
        assert history["department_label"] == "FCVFD"

    @pytest.mark.asyncio
    async def test_department_label_falls_back_to_the_full_name(self, db_session):
        org_id = await _add_org(db_session, name="Falls Church VFD", short_name=None)
        user_id = await _add_user(db_session, org_id)
        await db_session.flush()
        history = await SchedulingService(db_session).get_my_hours_history(
            user_id, org_id, 2025
        )
        assert history["department_label"] == "Falls Church VFD"


class TestEndpoints:
    @pytest.mark.asyncio
    async def test_my_history_is_the_callers_own(self, db_session, org_and_member):
        org_id, user_id = org_and_member
        other = await _add_user(db_session, org_id)
        await db_session.flush()
        mine = await _shift(db_session, org_id, date(2025, 4, 5))
        await _attend(db_session, mine, user_id, 60)
        theirs = await _shift(db_session, org_id, date(2025, 4, 6))
        await _attend(db_session, theirs, other, 60)

        me = await db_session.get(User, user_id)
        result = await scheduling_endpoint.get_my_shift_history(2025, db_session, me)
        assert [r["shift_id"] for r in result["department_shifts"]] == [mine.id]

    @pytest.mark.asyncio
    async def test_year_defaults_to_the_departments_current_year(
        self, db_session, org_and_member
    ):
        org_id, user_id = org_and_member
        me = await db_session.get(User, user_id)
        result = await scheduling_endpoint.get_my_shift_history(None, db_session, me)
        assert result["year"] == datetime.now(ZoneInfo("America/New_York")).year

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
                await scheduling_endpoint.get_member_shift_history(
                    uuid.UUID(user_id), 2025, db_session, other
                )
        assert refused.value.status_code == 403

    @pytest.mark.asyncio
    async def test_an_officer_reads_a_member_in_their_department(
        self, db_session, org_and_member
    ):
        org_id, user_id = org_and_member
        officer_id = await _add_user(db_session, org_id)
        shift = await _shift(db_session, org_id, date(2025, 4, 5))
        await _attend(db_session, shift, user_id, 60)
        officer = await db_session.get(User, officer_id)
        with patch.object(
            scheduling_endpoint, "user_has_permission", return_value=True
        ) as check:
            result = await scheduling_endpoint.get_member_shift_history(
                uuid.UUID(user_id), 2025, db_session, officer
            )
        check.assert_called_once_with(officer, "scheduling.report")
        assert [r["shift_id"] for r in result["department_shifts"]] == [shift.id]

    @pytest.mark.asyncio
    async def test_a_member_of_another_department_reads_as_not_found(
        self, db_session, org_and_member
    ):
        org_id, _ = org_and_member
        officer_id = await _add_user(db_session, org_id)
        other_org = await _add_org(db_session, name="Elsewhere FD")
        stranger = await _add_user(db_session, other_org)
        await db_session.flush()
        officer = await db_session.get(User, officer_id)
        with patch.object(
            scheduling_endpoint, "user_has_permission", return_value=True
        ):
            with pytest.raises(HTTPException) as missing:
                await scheduling_endpoint.get_member_shift_history(
                    uuid.UUID(stranger), 2025, db_session, officer
                )
        assert missing.value.status_code == 404


@pytest.mark.unit
class TestShortNameValidation:
    def test_a_blank_short_name_clears_it(self):
        update = OrganizationProfileUpdate(short_name="   ")
        assert update.short_name is None
        assert "short_name" in update.model_fields_set

    def test_a_short_name_is_trimmed(self):
        assert OrganizationProfileUpdate(short_name=" FCVFD ").short_name == "FCVFD"

    def test_a_short_name_longer_than_the_column_is_refused(self):
        with pytest.raises(ValidationError, match="at most 20 characters"):
            OrganizationProfileUpdate(short_name="X" * 21)
