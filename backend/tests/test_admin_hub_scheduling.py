"""Scheduling's administration metrics and attention queue.

`test_admin_hub_db.py` parametrizes over `MODULE_REGISTRY` and proves each
resolver *runs*; this file is about what the numbers mean. Three distinctions
the scheduling model draws, and these tests hold it to:

  * ``end_time`` is optional. A shift that never recorded an end is precisely
    the one nobody closed out, so a bare ``end_time < now`` skips the rows that
    matter most;
  * ``min_staffing`` is how big a crew is *said* to be. A shift naming neither
    positions nor a minimum has never said, and the board renders that as "crew
    size not set" rather than as a staffing level — so it is not short-staffed;
  * a declined assignment is not a seat. Counting one reports a shift as
    covered by the person who told the department they are not coming.
"""

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

from app.models.training import (
    AssignmentStatus,
    Shift,
    ShiftAssignment,
    ShiftAttendance,
    ShiftPosition,
    ShiftStatus,
    ShiftSwapRequest,
    ShiftTimeOff,
    SwapRequestStatus,
    TimeOffStatus,
)
from app.models.user import Organization, Position, User, UserStatus
from app.services.admin_hub_service import MODULE_REGISTRY, AdminHubService

pytestmark = pytest.mark.integration

NOW = datetime.now(timezone.utc)
#: Every department here is on UTC, so the resolvers' "today" is this one.
TODAY = NOW.date()


async def _org(db_session) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name="Scheduling Test Department",
        slug=f"sched-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
        settings={"modules": {"scheduling": True, "_user_configured": True}},
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _admin(db_session, org) -> User:
    """A scheduling officer, with the grant carried by a position.

    `user.positions` is assigned explicitly even though nothing here reads the
    grant: on a freshly flushed User the collection is unloaded, so any
    permission check becomes deferred IO and raises MissingGreenlet under
    asyncio rather than answering "no permissions".
    """
    handle = uuid.uuid4().hex[:10]
    position = Position(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name=f"Scheduling Officer {handle}",
        slug=f"scheduling-officer-{handle}",
        permissions=["scheduling.manage"],
    )
    db_session.add(position)
    await db_session.flush()

    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"sched-admin-{handle}",
        email=f"{handle}@sched.test",
        first_name="Dana",
        last_name="Reyes",
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    user.positions = [position]
    db_session.add(user)
    await db_session.flush()
    return user


async def _member(db_session, org) -> User:
    handle = uuid.uuid4().hex[:10]
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"sched-member-{handle}",
        email=f"{handle}@sched.test",
        first_name="Alex",
        last_name="Kim",
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    user.positions = []
    db_session.add(user)
    await db_session.flush()
    return user


async def _shift(
    db_session,
    org,
    *,
    start: datetime,
    end: datetime | None,
    min_staffing: int | None = None,
    positions: list[dict] | None = None,
    finalized: bool = False,
    status: ShiftStatus = ShiftStatus.SCHEDULED,
    shift_date: date | None = None,
) -> Shift:
    shift = Shift(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        shift_date=shift_date or start.date(),
        start_time=start,
        end_time=end,
        min_staffing=min_staffing,
        positions=positions,
        is_finalized=finalized,
        status=status,
    )
    db_session.add(shift)
    await db_session.flush()
    return shift


async def _seat(
    db_session,
    org,
    shift,
    user,
    *,
    position: ShiftPosition = ShiftPosition.FIREFIGHTER,
    assignment_status: AssignmentStatus = AssignmentStatus.CONFIRMED,
) -> ShiftAssignment:
    assignment = ShiftAssignment(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        shift_id=shift.id,
        user_id=user.id,
        position=position,
        assignment_status=assignment_status,
    )
    db_session.add(assignment)
    await db_session.flush()
    return assignment


async def _metric(db_session, org, user, key: str) -> tuple[str, str]:
    ctx = await AdminHubService(db_session)._context(user)
    metric = next(m for m in MODULE_REGISTRY["scheduling"].metrics if m.key == key)
    return await metric.resolve(ctx)


async def _queue(db_session, user) -> dict:
    """Run the scheduling attention resolver, keyed by item key.

    Called through the resolver rather than ``get_summary``, which catches every
    exception so one broken query cannot blank the page — exactly the behaviour
    that would turn a failing test green.
    """
    ctx = await AdminHubService(db_session)._context(user)
    items = await MODULE_REGISTRY["scheduling"].attention(ctx)
    return {item.key: item for item in items}


# ── Registry ────────────────────────────────────────────────────────────────


class TestTheModuleIsRegistered:
    def test_scheduling_is_gated_on_its_own_grant_and_module(self):
        spec = MODULE_REGISTRY["scheduling"]

        assert spec.permission == "scheduling.manage"
        assert spec.requires_module == "scheduling"

    def test_every_default_slot_names_a_metric_the_module_offers(self):
        spec = MODULE_REGISTRY["scheduling"]
        offered = {metric.key for metric in spec.metrics}

        assert set(spec.default_metrics) <= offered


# ── Shifts still to close out ───────────────────────────────────────────────


class TestCloseoutBacklog:
    async def test_counts_a_shift_that_ended_and_was_never_finalized(self, db_session):
        org = await _org(db_session)
        admin = await _admin(db_session, org)
        await _shift(
            db_session,
            org,
            start=NOW - timedelta(days=2, hours=12),
            end=NOW - timedelta(days=2),
        )

        value, context = await _metric(
            db_session, org, admin, "shifts_needing_closeout"
        )

        assert value == "1"
        assert "waiting 2 days" in context

    # The bug this metric would otherwise have: `end_time` is nullable, and an
    # open-ended shift is by definition one nobody recorded an end for. Filtering
    # on `end_time < now` alone drops exactly the rows the number is about.
    async def test_counts_a_shift_that_never_recorded_an_end_time(self, db_session):
        org = await _org(db_session)
        admin = await _admin(db_session, org)
        await _shift(db_session, org, start=NOW - timedelta(days=3), end=None)

        value, _ = await _metric(db_session, org, admin, "shifts_needing_closeout")

        assert value == "1"

    # The opposite error to the one above, and the one the review caught: an
    # open-ended shift is not over the moment it starts. A crew still out would
    # otherwise sit in the backlog with nothing able to clear it.
    async def test_leaves_an_open_ended_shift_alone_inside_the_cushion(
        self, db_session
    ):
        org = await _org(db_session)
        admin = await _admin(db_session, org)
        await _shift(db_session, org, start=NOW - timedelta(hours=2), end=None)

        value, _ = await _metric(db_session, org, admin, "shifts_needing_closeout")

        assert value == "0"

    # The cushion follows the department's own check-in window rather than a
    # fixed twelve hours, so the roster lock and this metric cannot say
    # different things about one shift.
    async def test_the_cushion_follows_the_departments_checkin_window(self, db_session):
        org = await _org(db_session)
        org.settings = {
            **(org.settings or {}),
            "shift_reports": {"checklist_timing": {"checkin_closes_hours_after": 48}},
        }
        await db_session.flush()
        admin = await _admin(db_session, org)
        # Past the built-in twelve-hour floor, inside the department's forty-eight.
        await _shift(db_session, org, start=NOW - timedelta(hours=20), end=None)

        value, _ = await _metric(db_session, org, admin, "shifts_needing_closeout")

        assert value == "0"

    # The age has to be measured from the instant that made the shift eligible,
    # not from its start. With a seventy-two hour cushion, dating an open-ended
    # shift from its start announced it as three days overdue the moment it
    # first appeared in the backlog.
    async def test_dates_an_open_ended_shift_from_the_end_of_its_cushion(
        self, db_session
    ):
        org = await _org(db_session)
        org.settings = {
            **(org.settings or {}),
            "shift_reports": {"checklist_timing": {"checkin_closes_hours_after": 72}},
        }
        await db_session.flush()
        admin = await _admin(db_session, org)
        # Started four days ago, so it cleared the seventy-two hour cushion a
        # day ago: one day overdue, not four.
        await _shift(db_session, org, start=NOW - timedelta(days=4), end=None)

        value, context = await _metric(
            db_session, org, admin, "shifts_needing_closeout"
        )

        assert value == "1"
        assert "waiting 1 day" in context

    async def test_ignores_a_finalized_shift(self, db_session):
        org = await _org(db_session)
        admin = await _admin(db_session, org)
        await _shift(
            db_session,
            org,
            start=NOW - timedelta(days=2, hours=12),
            end=NOW - timedelta(days=2),
            finalized=True,
        )

        value, context = await _metric(
            db_session, org, admin, "shifts_needing_closeout"
        )

        assert value == "0"
        assert context == "every shift closed out"

    async def test_ignores_a_cancelled_shift(self, db_session):
        org = await _org(db_session)
        admin = await _admin(db_session, org)
        await _shift(
            db_session,
            org,
            start=NOW - timedelta(days=2, hours=12),
            end=NOW - timedelta(days=2),
            status=ShiftStatus.CANCELLED,
        )

        value, _ = await _metric(db_session, org, admin, "shifts_needing_closeout")

        assert value == "0"

    async def test_ignores_a_shift_that_has_not_ended_yet(self, db_session):
        org = await _org(db_session)
        admin = await _admin(db_session, org)
        await _shift(
            db_session,
            org,
            start=NOW + timedelta(hours=1),
            end=NOW + timedelta(hours=13),
        )

        value, _ = await _metric(db_session, org, admin, "shifts_needing_closeout")

        assert value == "0"

    async def test_ignores_another_departments_shift(self, db_session):
        org = await _org(db_session)
        admin = await _admin(db_session, org)
        other = await _org(db_session)
        await _shift(
            db_session,
            other,
            start=NOW - timedelta(days=2, hours=12),
            end=NOW - timedelta(days=2),
        )

        value, _ = await _metric(db_session, org, admin, "shifts_needing_closeout")

        assert value == "0"


# ── Short-staffed shifts ────────────────────────────────────────────────────


class TestShortStaffed:
    async def test_counts_a_shift_below_its_stated_minimum(self, db_session):
        org = await _org(db_session)
        admin = await _admin(db_session, org)
        shift = await _shift(
            db_session,
            org,
            start=NOW + timedelta(days=1),
            end=NOW + timedelta(days=1, hours=12),
            min_staffing=3,
        )
        await _seat(db_session, org, shift, await _member(db_session, org))

        value, context = await _metric(db_session, org, admin, "understaffed_shifts")

        assert value == "1"
        assert context == "in the next 7 days"

    async def test_ignores_a_shift_that_has_its_minimum(self, db_session):
        org = await _org(db_session)
        admin = await _admin(db_session, org)
        shift = await _shift(
            db_session,
            org,
            start=NOW + timedelta(days=1),
            end=NOW + timedelta(days=1, hours=12),
            min_staffing=2,
        )
        await _seat(db_session, org, shift, await _member(db_session, org))
        await _seat(db_session, org, shift, await _member(db_session, org))

        value, _ = await _metric(db_session, org, admin, "understaffed_shifts")

        assert value == "0"

    # A shift that states neither seats nor a minimum still needs somebody on
    # it. `filter_shifts_with_open_positions` falls back to one, which is the
    # answer the open-shifts list and the staffing report already give — so an
    # empty shift counts, and stops counting the moment anyone is on it.
    async def test_an_empty_shift_that_stated_nothing_still_needs_somebody(
        self, db_session
    ):
        org = await _org(db_session)
        admin = await _admin(db_session, org)
        shift = await _shift(
            db_session,
            org,
            start=NOW + timedelta(days=1),
            end=NOW + timedelta(days=1, hours=12),
            min_staffing=None,
            positions=None,
        )

        value, _ = await _metric(db_session, org, admin, "understaffed_shifts")
        assert value == "1"

        await _seat(db_session, org, shift, await _member(db_session, org))

        value, _ = await _metric(db_session, org, admin, "understaffed_shifts")
        assert value == "0"

    async def test_a_declined_assignment_does_not_hold_a_seat(self, db_session):
        org = await _org(db_session)
        admin = await _admin(db_session, org)
        shift = await _shift(
            db_session,
            org,
            start=NOW + timedelta(days=1),
            end=NOW + timedelta(days=1, hours=12),
            min_staffing=1,
        )
        await _seat(
            db_session,
            org,
            shift,
            await _member(db_session, org),
            assignment_status=AssignmentStatus.DECLINED,
        )

        value, _ = await _metric(db_session, org, admin, "understaffed_shifts")

        assert value == "1"

    # The seat-list half of the rule, and the half the metric used to miss. A
    # three-seat brush truck states its crew in `positions` and may carry no
    # `min_staffing` at all; counting only the latter reported it as fully
    # staffed with two of its three seats empty.
    async def test_counts_a_shift_short_against_its_own_seat_list(self, db_session):
        org = await _org(db_session)
        admin = await _admin(db_session, org)
        shift = await _shift(
            db_session,
            org,
            start=NOW + timedelta(days=1),
            end=NOW + timedelta(days=1, hours=12),
            min_staffing=None,
            positions=[
                {"position": "officer", "required": True},
                {"position": "driver", "required": True},
                {"position": "firefighter", "required": True},
            ],
        )
        await _seat(db_session, org, shift, await _member(db_session, org))

        value, _ = await _metric(db_session, org, admin, "understaffed_shifts")

        assert value == "1"

    # The seat list wins over min_staffing where both exist, so a shift that
    # names two seats is not judged against a department-wide default of six —
    # but only once the people on it hold *those* seats.
    async def test_the_seat_list_outranks_the_department_minimum(self, db_session):
        org = await _org(db_session)
        admin = await _admin(db_session, org)
        shift = await _shift(
            db_session,
            org,
            start=NOW + timedelta(days=1),
            end=NOW + timedelta(days=1, hours=12),
            min_staffing=6,
            positions=[
                {"position": "officer", "required": True},
                {"position": "driver", "required": True},
            ],
        )
        await _seat(
            db_session,
            org,
            shift,
            await _member(db_session, org),
            position=ShiftPosition.OFFICER,
        )
        await _seat(
            db_session,
            org,
            shift,
            await _member(db_session, org),
            position=ShiftPosition.DRIVER,
        )

        value, _ = await _metric(db_session, org, admin, "understaffed_shifts")

        assert value == "0"

    # A headcount says this shift is covered; it is not. Two firefighters on an
    # Officer/Driver shift leave both named seats empty, and the seat that
    # matters is always the empty one. Counting bodies hid that, which is why
    # this reads through the same matcher the open-shifts list uses.
    async def test_the_right_number_of_people_in_the_wrong_seats_is_short(
        self, db_session
    ):
        org = await _org(db_session)
        admin = await _admin(db_session, org)
        shift = await _shift(
            db_session,
            org,
            start=NOW + timedelta(days=1),
            end=NOW + timedelta(days=1, hours=12),
            positions=[
                {"position": "officer", "required": True},
                {"position": "driver", "required": True},
            ],
        )
        await _seat(db_session, org, shift, await _member(db_session, org))
        await _seat(db_session, org, shift, await _member(db_session, org))

        value, _ = await _metric(db_session, org, admin, "understaffed_shifts")

        assert value == "1"

    # A slot the department marked optional is not a shortage.
    async def test_an_optional_seat_is_not_a_shortage(self, db_session):
        org = await _org(db_session)
        admin = await _admin(db_session, org)
        shift = await _shift(
            db_session,
            org,
            start=NOW + timedelta(days=1),
            end=NOW + timedelta(days=1, hours=12),
            positions=[
                {"position": "officer", "required": True},
                {"position": "driver", "required": False},
            ],
        )
        await _seat(
            db_session,
            org,
            shift,
            await _member(db_session, org),
            position=ShiftPosition.OFFICER,
        )

        value, _ = await _metric(db_session, org, admin, "understaffed_shifts")

        assert value == "0"

    # An empty list is not a crew of nobody — it is a shift that named no seats,
    # which falls through to the minimum exactly as a null does.
    #
    async def test_an_empty_seat_list_falls_through_to_the_minimum(self, db_session):
        org = await _org(db_session)
        admin = await _admin(db_session, org)
        await _shift(
            db_session,
            org,
            start=NOW + timedelta(days=1),
            end=NOW + timedelta(days=1, hours=12),
            min_staffing=2,
            positions=[],
        )

        value, _ = await _metric(db_session, org, admin, "understaffed_shifts")

        assert value == "1"

    # PENDING appears only in "My Upcoming Shifts", which answers "what am I
    # on", not "is this shift covered". Counting it here would report a shift as
    # staffed while the coverage report beside it still shows the seat open.
    async def test_a_pending_assignment_does_not_hold_a_seat(self, db_session):
        org = await _org(db_session)
        admin = await _admin(db_session, org)
        shift = await _shift(
            db_session,
            org,
            start=NOW + timedelta(days=1),
            end=NOW + timedelta(days=1, hours=12),
            min_staffing=1,
        )
        await _seat(
            db_session,
            org,
            shift,
            await _member(db_session, org),
            assignment_status=AssignmentStatus.PENDING,
        )

        value, _ = await _metric(db_session, org, admin, "understaffed_shifts")

        assert value == "1"

    async def test_ignores_a_short_shift_beyond_the_horizon(self, db_session):
        org = await _org(db_session)
        admin = await _admin(db_session, org)
        await _shift(
            db_session,
            org,
            start=NOW + timedelta(days=30),
            end=NOW + timedelta(days=30, hours=12),
            min_staffing=4,
        )

        value, _ = await _metric(db_session, org, admin, "understaffed_shifts")

        assert value == "0"


# ── Hours this month ────────────────────────────────────────────────────────


class TestHoursThisMonth:
    async def test_sums_recorded_attendance_since_the_month_began(self, db_session):
        org = await _org(db_session)
        admin = await _admin(db_session, org)
        shift = await _shift(
            db_session,
            org,
            start=NOW,
            end=NOW + timedelta(hours=12),
            shift_date=TODAY,
        )
        member = await _member(db_session, org)
        db_session.add(
            ShiftAttendance(
                id=str(uuid.uuid4()),
                shift_id=shift.id,
                user_id=member.id,
                duration_minutes=90,
            )
        )
        await db_session.flush()

        value, context = await _metric(db_session, org, admin, "hours_this_month")

        assert value == "1.5"
        assert context == f"since {TODAY.replace(day=1).strftime('%B')} 1"

    # Only a lower bound meant attendance recorded against a shift dated next
    # month counted towards "hours this month" — a figure that goes up when
    # somebody plans ahead.
    async def test_ignores_attendance_on_a_shift_dated_next_month(self, db_session):
        org = await _org(db_session)
        admin = await _admin(db_session, org)
        next_month = (
            TODAY.replace(year=TODAY.year + 1, month=1, day=1)
            if TODAY.month == 12
            else TODAY.replace(month=TODAY.month + 1, day=1)
        )
        shift = await _shift(
            db_session,
            org,
            start=NOW + timedelta(days=40),
            end=NOW + timedelta(days=40, hours=12),
            shift_date=next_month,
        )
        member = await _member(db_session, org)
        db_session.add(
            ShiftAttendance(
                id=str(uuid.uuid4()),
                shift_id=shift.id,
                user_id=member.id,
                duration_minutes=600,
            )
        )
        await db_session.flush()

        value, _ = await _metric(db_session, org, admin, "hours_this_month")

        assert value == "0.0"

    # ShiftAttendance carries no organization_id, so the scope comes from the
    # join to Shift. Without it every department's hours land on every page.
    async def test_ignores_another_departments_attendance(self, db_session):
        org = await _org(db_session)
        admin = await _admin(db_session, org)
        other = await _org(db_session)
        shift = await _shift(
            db_session,
            other,
            start=NOW,
            end=NOW + timedelta(hours=12),
            shift_date=TODAY,
        )
        member = await _member(db_session, other)
        db_session.add(
            ShiftAttendance(
                id=str(uuid.uuid4()),
                shift_id=shift.id,
                user_id=member.id,
                duration_minutes=600,
            )
        )
        await db_session.flush()

        value, _ = await _metric(db_session, org, admin, "hours_this_month")

        assert value == "0.0"


# ── The attention queue ─────────────────────────────────────────────────────


class TestAttentionQueue:
    async def test_raises_a_short_shift_starting_soon(self, db_session):
        org = await _org(db_session)
        admin = await _admin(db_session, org)
        await _shift(
            db_session,
            org,
            start=NOW + timedelta(hours=6),
            end=NOW + timedelta(hours=18),
            min_staffing=4,
        )

        queue = await _queue(db_session, admin)

        assert "scheduling_understaffed" in queue
        item = queue["scheduling_understaffed"]
        assert item.severity == "critical"
        assert item.count == 1
        assert "short of minimum staffing" in item.title
        assert item.href == "/scheduling"

    async def test_leaves_a_short_shift_further_out_alone(self, db_session):
        org = await _org(db_session)
        admin = await _admin(db_session, org)
        await _shift(
            db_session,
            org,
            start=NOW + timedelta(days=5),
            end=NOW + timedelta(days=5, hours=12),
            min_staffing=4,
        )

        queue = await _queue(db_session, admin)

        assert "scheduling_understaffed" not in queue

    async def test_raises_a_swap_request_awaiting_review(self, db_session):
        org = await _org(db_session)
        admin = await _admin(db_session, org)
        member = await _member(db_session, org)
        shift = await _shift(
            db_session,
            org,
            start=NOW + timedelta(days=1),
            end=NOW + timedelta(days=1, hours=12),
        )
        db_session.add(
            ShiftSwapRequest(
                id=str(uuid.uuid4()),
                organization_id=org.id,
                requesting_user_id=member.id,
                offering_shift_id=shift.id,
                status=SwapRequestStatus.PENDING,
                created_at=NOW - timedelta(days=3),
            )
        )
        await db_session.flush()

        queue = await _queue(db_session, admin)

        item = queue["scheduling_pending_swaps"]
        assert item.severity == "warning"
        assert item.count == 1
        assert item.oldest_age_days == 3
        assert item.href == "/scheduling?tab=requests&requestView=swaps"

    async def test_raises_a_time_off_request_awaiting_review(self, db_session):
        org = await _org(db_session)
        admin = await _admin(db_session, org)
        member = await _member(db_session, org)
        db_session.add(
            ShiftTimeOff(
                id=str(uuid.uuid4()),
                organization_id=org.id,
                user_id=member.id,
                start_date=TODAY + timedelta(days=10),
                end_date=TODAY + timedelta(days=12),
                status=TimeOffStatus.PENDING,
                created_at=NOW - timedelta(days=1),
            )
        )
        await db_session.flush()

        queue = await _queue(db_session, admin)

        item = queue["scheduling_pending_time_off"]
        assert item.count == 1
        assert item.oldest_age_days == 1
        # Names the view, not just the tab: RequestsTab opens on swaps, so this
        # landed an officer on "No swap requests" after clicking a time-off
        # warning. `requestView`, because SchedulingPage owns `view` for the
        # calendar mode and rewrites it out from under this one.
        assert item.href == "/scheduling?tab=requests&requestView=timeoff"

    async def test_ignores_a_decided_request(self, db_session):
        org = await _org(db_session)
        admin = await _admin(db_session, org)
        member = await _member(db_session, org)
        db_session.add(
            ShiftTimeOff(
                id=str(uuid.uuid4()),
                organization_id=org.id,
                user_id=member.id,
                start_date=TODAY + timedelta(days=10),
                end_date=TODAY + timedelta(days=12),
                status=TimeOffStatus.APPROVED,
            )
        )
        await db_session.flush()

        queue = await _queue(db_session, admin)

        assert "scheduling_pending_time_off" not in queue

    async def test_says_nothing_when_the_schedule_is_running_cleanly(self, db_session):
        org = await _org(db_session)
        admin = await _admin(db_session, org)

        assert await _queue(db_session, admin) == {}

    async def test_does_not_report_another_departments_schedule(self, db_session):
        org = await _org(db_session)
        admin = await _admin(db_session, org)
        other = await _org(db_session)
        await _shift(
            db_session,
            other,
            start=NOW + timedelta(hours=6),
            end=NOW + timedelta(hours=18),
            min_staffing=4,
        )

        assert await _queue(db_session, admin) == {}
