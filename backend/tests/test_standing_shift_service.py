"""
Tests for standing shift claims — a member's recurring claim on a seat.

The date arithmetic is pure and is tested directly. The orchestration
(preview / create / the shift-creation reader) is tested with the SQL helpers
stubbed out, so what is under test is the decision — which dates are
claimable, which are skipped, which claims a new shift matches — rather than
the query that fetches the rows.
"""

from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest

from app.models.training import (
    ShiftStatus,
    StandingShiftPattern,
    StandingShiftPeriod,
)
from app.services.standing_shift_service import (
    MAX_SERIES_DAYS,
    StandingShiftService,
    _weekday_sunday_first,
    series_dates,
)

ORG = uuid4()
USER = uuid4()

# August 2026 starts on a Saturday, so its Tuesdays are 4, 11, 18 and 25.
AUG_START = date(2026, 8, 1)
AUG_END = date(2026, 8, 31)
TUESDAY = 2


def _shift(
    shift_id,
    shift_date,
    hour_utc,
    *,
    apparatus_id=None,
    status=ShiftStatus.SCHEDULED,
    is_finalized=False,
):
    return SimpleNamespace(
        id=shift_id,
        shift_date=shift_date,
        start_time=datetime(
            shift_date.year,
            shift_date.month,
            shift_date.day,
            hour_utc,
            tzinfo=timezone.utc,
        ),
        apparatus_id=apparatus_id,
        status=status,
        is_finalized=is_finalized,
    )


class TestWeekdayConvention:
    """0 = Sunday, matching the S M T W T F S picker the member taps."""

    def test_sunday_is_zero(self):
        assert _weekday_sunday_first(date(2026, 8, 2)) == 0

    def test_saturday_is_six(self):
        assert _weekday_sunday_first(date(2026, 8, 1)) == 6

    def test_tuesday_is_two(self):
        assert _weekday_sunday_first(date(2026, 8, 4)) == TUESDAY


class TestSeriesDates:
    def test_weekly_hits_every_matching_weekday(self):
        assert series_dates(
            StandingShiftPattern.WEEKLY, TUESDAY, AUG_START, AUG_END
        ) == [date(2026, 8, 4), date(2026, 8, 11), date(2026, 8, 18), date(2026, 8, 25)]

    def test_biweekly_anchors_on_the_first_match(self):
        # Not on an absolute week number: a member setting this up mid-month
        # means "this Tuesday and every other one", not "even ISO weeks".
        assert series_dates(
            StandingShiftPattern.BIWEEKLY, TUESDAY, date(2026, 8, 11), AUG_END
        ) == [date(2026, 8, 11), date(2026, 8, 25)]

    def test_monthly_keeps_the_ordinal_weekday(self):
        # Anchored on the fourth Tuesday, every month is its fourth Tuesday —
        # that is how duty rotations are written.
        assert series_dates(
            StandingShiftPattern.MONTHLY, TUESDAY, date(2026, 8, 22), date(2026, 12, 31)
        ) == [
            date(2026, 8, 25),
            date(2026, 9, 22),
            date(2026, 10, 27),
            date(2026, 11, 24),
            date(2026, 12, 22),
        ]

    def test_monthly_skips_a_month_without_that_ordinal(self):
        # Anchored on the fifth Friday of Jan 2027 (Jan 1, 8, 15, 22, 29).
        # February 2027 has only four Fridays, so it contributes no date.
        dates = series_dates(
            StandingShiftPattern.MONTHLY, 5, date(2027, 1, 29), date(2027, 4, 30)
        )
        assert date(2027, 1, 29) in dates
        assert not any(d.month == 2 for d in dates)

    def test_range_with_no_matching_weekday_is_empty(self):
        assert (
            series_dates(
                StandingShiftPattern.WEEKLY,
                TUESDAY,
                date(2026, 8, 26),
                date(2026, 8, 30),
            )
            == []
        )

    def test_end_before_start_is_empty(self):
        assert (
            series_dates(StandingShiftPattern.WEEKLY, TUESDAY, AUG_END, AUG_START) == []
        )

    def test_single_day_range_on_the_weekday(self):
        assert series_dates(
            StandingShiftPattern.WEEKLY, TUESDAY, date(2026, 8, 4), date(2026, 8, 4)
        ) == [date(2026, 8, 4)]


class TestShiftPeriod:
    """Day/night is decided in the org's timezone, never off the raw column."""

    def test_night_shift_stored_as_next_day_utc(self):
        # 1800 local in UTC-5 is 23:00 UTC — still a night shift.
        tz = ZoneInfo("America/New_York")
        shift = _shift("s1", date(2026, 8, 4), 23)
        assert StandingShiftService.shift_period(shift, tz) == StandingShiftPeriod.NIGHT

    def test_the_same_utc_hour_reads_as_day_in_utc(self):
        # The identical row, read in UTC, is 23:00 — which is why the timezone
        # has to come from the organization rather than the column.
        shift = _shift("s1", date(2026, 8, 4), 11)
        assert (
            StandingShiftService.shift_period(shift, ZoneInfo("UTC"))
            == StandingShiftPeriod.DAY
        )

    def test_naive_datetime_is_treated_as_utc(self):
        shift = SimpleNamespace(
            start_time=datetime(2026, 8, 4, 6), shift_date=date(2026, 8, 4)
        )
        assert (
            StandingShiftService.shift_period(shift, ZoneInfo("UTC"))
            == StandingShiftPeriod.DAY
        )

    def test_missing_start_time_does_not_raise(self):
        shift = SimpleNamespace(start_time=None, shift_date=date(2026, 8, 4))
        assert (
            StandingShiftService.shift_period(shift, ZoneInfo("UTC"))
            == StandingShiftPeriod.DAY
        )


def _service(shifts_by_date, held=frozenset()):
    """A service whose SQL helpers are replaced with canned answers."""
    service = StandingShiftService(db=None)
    service._org_tz = AsyncMock(return_value=ZoneInfo("UTC"))
    service._shifts_on_dates = AsyncMock(return_value=shifts_by_date)
    service._held_shift_ids = AsyncMock(return_value=set(held))
    return service


class TestPreview:
    async def test_reports_every_date_including_unclaimable_ones(self):
        # Only two of August's four Tuesdays have a night shift on record.
        shifts = {
            date(2026, 8, 4): [_shift("n1", date(2026, 8, 4), 18)],
            date(2026, 8, 18): [_shift("n3", date(2026, 8, 18), 18)],
        }
        result = await _service(shifts).preview(
            ORG,
            USER,
            StandingShiftPattern.WEEKLY,
            TUESDAY,
            StandingShiftPeriod.NIGHT,
            AUG_START,
            AUG_END,
        )
        assert len(result["dates"]) == 4
        assert result["claimable_count"] == 2
        assert result["missing_count"] == 2

    async def test_day_shift_does_not_satisfy_a_night_claim(self):
        shifts = {date(2026, 8, 4): [_shift("d1", date(2026, 8, 4), 6)]}
        result = await _service(shifts).preview(
            ORG,
            USER,
            StandingShiftPattern.WEEKLY,
            TUESDAY,
            StandingShiftPeriod.NIGHT,
            date(2026, 8, 1),
            date(2026, 8, 7),
        )
        assert result["dates"][0]["status"] == "no_shift"

    async def test_a_shift_you_already_hold_is_not_counted_as_claimable(self):
        night = _shift("n1", date(2026, 8, 4), 18)
        result = await _service({date(2026, 8, 4): [night]}, held={"n1"}).preview(
            ORG,
            USER,
            StandingShiftPattern.WEEKLY,
            TUESDAY,
            StandingShiftPeriod.NIGHT,
            date(2026, 8, 1),
            date(2026, 8, 7),
        )
        assert result["dates"][0]["status"] == "already_yours"
        assert result["claimable_count"] == 0

    async def test_another_shift_the_same_day_is_a_conflict(self):
        day = _shift("d1", date(2026, 8, 4), 6)
        night = _shift("n1", date(2026, 8, 4), 18)
        result = await _service({date(2026, 8, 4): [day, night]}, held={"d1"}).preview(
            ORG,
            USER,
            StandingShiftPattern.WEEKLY,
            TUESDAY,
            StandingShiftPeriod.NIGHT,
            date(2026, 8, 1),
            date(2026, 8, 7),
        )
        assert result["dates"][0]["status"] == "conflict"
        assert result["conflict_count"] == 1

    async def test_cancelled_shift_is_not_matched(self):
        cancelled = _shift("n1", date(2026, 8, 4), 18, status=ShiftStatus.CANCELLED)
        result = await _service({date(2026, 8, 4): [cancelled]}).preview(
            ORG,
            USER,
            StandingShiftPattern.WEEKLY,
            TUESDAY,
            StandingShiftPeriod.NIGHT,
            date(2026, 8, 1),
            date(2026, 8, 7),
        )
        assert result["dates"][0]["status"] == "no_shift"

    async def test_apparatus_narrowing_excludes_other_units(self):
        other_unit = _shift("n1", date(2026, 8, 4), 18, apparatus_id="engine-2")
        result = await _service({date(2026, 8, 4): [other_unit]}).preview(
            ORG,
            USER,
            StandingShiftPattern.WEEKLY,
            TUESDAY,
            StandingShiftPeriod.NIGHT,
            date(2026, 8, 1),
            date(2026, 8, 7),
            apparatus_id="engine-1",
        )
        assert result["dates"][0]["status"] == "no_shift"


class TestCreate:
    def _service_for_create(self, shifts_by_date, held=frozenset()):
        service = _service(shifts_by_date, held)
        service.db = SimpleNamespace(
            add=lambda _obj: None,
            flush=AsyncMock(),
            commit=AsyncMock(),
            refresh=AsyncMock(),
        )
        return service

    async def test_seats_the_member_on_every_available_date(self):
        shifts = {
            d: [_shift(f"n{d.day}", d, 18)]
            for d in (date(2026, 8, 4), date(2026, 8, 11))
        }
        service = self._service_for_create(shifts)
        assign = AsyncMock(return_value=(SimpleNamespace(id="a1"), None))

        claim, summary, error = await service.create(
            ORG,
            USER,
            pattern=StandingShiftPattern.WEEKLY,
            weekday=TUESDAY,
            period=StandingShiftPeriod.NIGHT,
            position="firefighter",
            start_date=date(2026, 8, 1),
            end_date=date(2026, 8, 14),
            assign=assign,
        )
        assert error is None
        assert claim is not None
        assert summary == {"claimed": 2, "skipped": 0, "no_shift": 0}
        assert assign.await_count == 2

    async def test_a_refused_date_is_skipped_not_fatal(self):
        # One full shift in November must not cost the member the other
        # eleven months of the series.
        shifts = {
            d: [_shift(f"n{d.day}", d, 18)]
            for d in (date(2026, 8, 4), date(2026, 8, 11))
        }
        service = self._service_for_create(shifts)
        assign = AsyncMock(
            side_effect=[(None, "Shift is full"), (SimpleNamespace(id="a1"), None)]
        )

        _claim, summary, error = await service.create(
            ORG,
            USER,
            pattern=StandingShiftPattern.WEEKLY,
            weekday=TUESDAY,
            period=StandingShiftPeriod.NIGHT,
            position="firefighter",
            start_date=date(2026, 8, 1),
            end_date=date(2026, 8, 14),
            assign=assign,
        )
        assert error is None
        assert summary["claimed"] == 1
        assert summary["skipped"] == 1

    async def test_backwards_range_is_rejected(self):
        service = self._service_for_create({})
        claim, _summary, error = await service.create(
            ORG,
            USER,
            pattern=StandingShiftPattern.WEEKLY,
            weekday=TUESDAY,
            period=StandingShiftPeriod.DAY,
            position="firefighter",
            start_date=date(2026, 8, 31),
            end_date=date(2026, 8, 1),
        )
        assert claim is None
        assert error is not None

    async def test_horizon_is_bounded(self):
        service = self._service_for_create({})
        claim, _summary, error = await service.create(
            ORG,
            USER,
            pattern=StandingShiftPattern.WEEKLY,
            weekday=TUESDAY,
            period=StandingShiftPeriod.DAY,
            position="firefighter",
            start_date=date(2026, 1, 1),
            end_date=date(2026, 1, 1).replace(year=2030),
        )
        assert claim is None
        assert str(MAX_SERIES_DAYS) in (error or "")

    async def test_weekday_out_of_range_is_rejected(self):
        service = self._service_for_create({})
        claim, _summary, error = await service.create(
            ORG,
            USER,
            pattern=StandingShiftPattern.WEEKLY,
            weekday=7,
            period=StandingShiftPeriod.DAY,
            position="firefighter",
            start_date=AUG_START,
            end_date=AUG_END,
        )
        assert claim is None
        assert error is not None


class TestApplyToShift:
    """The reader that keeps a series alive once next month is generated."""

    def _claim(self, **overrides):
        base = dict(
            id="c1",
            organization_id=str(ORG),
            user_id=str(USER),
            pattern=StandingShiftPattern.WEEKLY,
            weekday=TUESDAY,
            period=StandingShiftPeriod.NIGHT,
            position="firefighter",
            apparatus_id=None,
            start_date=AUG_START,
            end_date=date(2026, 12, 31),
        )
        base.update(overrides)
        return SimpleNamespace(**base)

    def _service_with_claims(self, claims):
        service = StandingShiftService(db=None)
        service._org_tz = AsyncMock(return_value=ZoneInfo("UTC"))
        result = SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: claims))
        service.db = SimpleNamespace(execute=AsyncMock(return_value=result))
        return service

    async def test_seats_a_matching_claim(self):
        service = self._service_with_claims([self._claim()])
        assign = AsyncMock(return_value=(SimpleNamespace(id="a1"), None))
        seated = await service.apply_to_shift(
            ORG, _shift("n1", date(2026, 9, 1), 18), assign
        )
        assert seated == 1

    async def test_does_not_seat_a_day_shift_for_a_night_claim(self):
        service = self._service_with_claims([self._claim()])
        assign = AsyncMock(return_value=(SimpleNamespace(id="a1"), None))
        seated = await service.apply_to_shift(
            ORG, _shift("d1", date(2026, 9, 1), 6), assign
        )
        assert seated == 0
        assign.assert_not_awaited()

    async def test_biweekly_claim_skips_the_off_week(self):
        service = self._service_with_claims(
            [self._claim(pattern=StandingShiftPattern.BIWEEKLY)]
        )
        assign = AsyncMock(return_value=(SimpleNamespace(id="a1"), None))
        # Aug 4 is the anchor; Aug 11 is the off week.
        assert (
            await service.apply_to_shift(
                ORG, _shift("n2", date(2026, 8, 11), 18), assign
            )
            == 0
        )
        assert (
            await service.apply_to_shift(
                ORG, _shift("n3", date(2026, 8, 18), 18), assign
            )
            == 1
        )

    async def test_a_refusal_is_logged_not_raised(self):
        # A claim that cannot be honoured leaves an open seat on a roster an
        # officer can see; it must never fail the generation run.
        service = self._service_with_claims([self._claim()])
        assign = AsyncMock(return_value=(None, "Not eligible for this position"))
        seated = await service.apply_to_shift(
            ORG, _shift("n1", date(2026, 9, 1), 18), assign
        )
        assert seated == 0

    async def test_an_exception_does_not_escape(self):
        service = self._service_with_claims([self._claim()])
        assign = AsyncMock(side_effect=RuntimeError("boom"))
        assert (
            await service.apply_to_shift(
                ORG, _shift("n1", date(2026, 9, 1), 18), assign
            )
            == 0
        )


class TestEndClaim:
    async def test_ending_a_series_leaves_booked_dates_alone_by_default(self):
        # Silently emptying seats a duty officer has already counted on is how
        # a shift goes short with nobody notified.
        service = StandingShiftService(db=SimpleNamespace(commit=AsyncMock()))
        claim = SimpleNamespace(
            is_active=True,
            ended_at=None,
            organization_id=str(ORG),
            user_id=str(USER),
            pattern=StandingShiftPattern.WEEKLY,
            weekday=TUESDAY,
            start_date=AUG_START,
            end_date=AUG_END,
            period=StandingShiftPeriod.NIGHT,
            apparatus_id=None,
        )
        withdraw = AsyncMock(return_value=(True, None))

        result = await service.end_claim(claim, withdraw=withdraw)

        assert claim.is_active is False
        assert result["released"] == 0
        withdraw.assert_not_awaited()

    async def test_release_future_only_touches_dates_still_ahead(self):
        night_past = _shift("n-past", date(2026, 8, 4), 18)
        night_future = _shift("n-future", date(2026, 8, 25), 18)
        service = StandingShiftService(db=SimpleNamespace(commit=AsyncMock()))
        service._org_tz = AsyncMock(return_value=ZoneInfo("UTC"))
        service._shifts_on_dates = AsyncMock(
            return_value={date(2026, 8, 25): [night_future]}
        )
        service._held_shift_ids = AsyncMock(return_value={"n-past", "n-future"})
        claim = SimpleNamespace(
            is_active=True,
            ended_at=None,
            organization_id=str(ORG),
            user_id=str(USER),
            pattern=StandingShiftPattern.WEEKLY,
            weekday=TUESDAY,
            start_date=AUG_START,
            end_date=AUG_END,
            period=StandingShiftPeriod.NIGHT,
            apparatus_id=None,
        )
        withdraw = AsyncMock(return_value=(True, None))

        result = await service.end_claim(
            claim,
            release_future=True,
            withdraw=withdraw,
            today=date(2026, 8, 20),
        )

        assert result["released"] == 1
        assert withdraw.await_count == 1
        assert str(night_past.id) not in str(withdraw.await_args)


@pytest.mark.parametrize(
    "pattern",
    [
        StandingShiftPattern.WEEKLY,
        StandingShiftPattern.BIWEEKLY,
        StandingShiftPattern.MONTHLY,
    ],
)
def test_every_generated_date_lands_on_the_requested_weekday(pattern):
    for day in series_dates(pattern, TUESDAY, AUG_START, date(2027, 8, 31)):
        assert _weekday_sunday_first(day) == TUESDAY


class TestApparatusNarrowingIsValidated:
    """A client-supplied apparatus id is checked before it is stored (XC-1)."""

    def _service(self):
        service = _service_with_no_shifts()
        service.db = SimpleNamespace(
            add=lambda _obj: None,
            flush=AsyncMock(),
            commit=AsyncMock(),
            refresh=AsyncMock(),
        )
        return service

    async def _create(self, service, apparatus_id):
        return await service.create(
            ORG,
            USER,
            pattern=StandingShiftPattern.WEEKLY,
            weekday=TUESDAY,
            period=StandingShiftPeriod.NIGHT,
            position="firefighter",
            start_date=AUG_START,
            end_date=AUG_END,
            apparatus_id=apparatus_id,
        )

    async def test_an_out_of_org_apparatus_is_refused(self):
        # Storing it leaks nothing — it just pins the series to a unit that can
        # never match, so the member's standing shift claims nothing, silently,
        # for as long as it runs.
        service = self._service()
        with patch(
            "app.services.standing_shift_service.apparatus_ref_exists",
            AsyncMock(return_value=False),
        ):
            claim, _summary, error = await self._create(service, "someone-elses-engine")
        assert claim is None
        assert error == "Apparatus not found."

    async def test_an_in_org_apparatus_is_accepted(self):
        service = self._service()
        with patch(
            "app.services.standing_shift_service.apparatus_ref_exists",
            AsyncMock(return_value=True),
        ):
            claim, _summary, error = await self._create(service, "engine-1")
        assert error is None
        assert claim is not None

    async def test_no_apparatus_skips_the_lookup(self):
        # The common case: a single-apparatus department claims "whichever
        # shift runs that night" and never names a unit.
        service = self._service()
        checked = AsyncMock(return_value=False)
        with patch("app.services.standing_shift_service.apparatus_ref_exists", checked):
            claim, _summary, error = await self._create(service, None)
        assert error is None
        assert claim is not None
        checked.assert_not_awaited()


def _service_with_no_shifts():
    service = StandingShiftService(db=None)
    service._org_tz = AsyncMock(return_value=ZoneInfo("UTC"))
    service._shifts_on_dates = AsyncMock(return_value={})
    service._held_shift_ids = AsyncMock(return_value=set())
    return service


class TestOrgTimezoneIsShared:
    """The standing series and shift generation must agree on the timezone."""

    async def test_resolves_through_the_shared_helper(self):
        service = StandingShiftService(db=SimpleNamespace())
        with patch(
            "app.services.standing_shift_service.resolve_scheduling_timezone",
            AsyncMock(return_value=ZoneInfo("America/Chicago")),
        ) as resolver:
            tz = await service._org_tz(ORG)
        assert tz == ZoneInfo("America/Chicago")
        resolver.assert_awaited_once()
