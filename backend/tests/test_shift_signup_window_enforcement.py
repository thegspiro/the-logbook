"""The signup window is enforced where every seating path converges.

``_signup_window_error`` is exercised as a pure function in
``test_shift_signup_window.py``. This file proves the rule actually reaches the
database: that a member is refused a seat on a shift that has begun, that the
three actors get the three different answers, and that the per-shift override
and the department's settings both change the outcome for real rows.
"""

import json
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.scheduling_service import SchedulingService, SignupActor

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]

OPEN_POSITIONS = ["officer", "driver", "firefighter", "ems"]


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def org_and_members(db_session: AsyncSession):
    """A department with its signup positions declared, and two members."""
    org_id, officer_id, member_id = _uid(), _uid(), _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone, settings) "
            "VALUES (:id, :name, 'fire_department', :slug, :tz, :settings)"
        ),
        {
            "id": org_id,
            "name": "Window FD",
            "slug": f"window-{org_id[:8]}",
            "tz": "America/New_York",
            "settings": json.dumps({"scheduling": {"open_positions": OPEN_POSITIONS}}),
        },
    )
    for uid, uname in ((officer_id, "officer1"), (member_id, "ff1")):
        await db_session.execute(
            text(
                "INSERT INTO users (id, organization_id, username, first_name, "
                "last_name, email, password_hash, status) VALUES "
                "(:id, :org, :un, 'Test', 'User', :em, 'hashed', 'active')"
            ),
            {"id": uid, "org": org_id, "un": uname, "em": f"{uname}-{uid[:6]}@t.com"},
        )
    await db_session.flush()
    return org_id, officer_id, member_id


async def _set_scheduling_settings(db_session: AsyncSession, org_id: str, **values):
    """Merge keys into org.settings['scheduling'] the way the API would."""
    row = await db_session.execute(
        text("SELECT settings FROM organizations WHERE id = :id"), {"id": org_id}
    )
    raw = row.scalar_one()
    settings = json.loads(raw) if isinstance(raw, str) else (raw or {})
    settings.setdefault("scheduling", {}).update(values)
    await db_session.execute(
        text("UPDATE organizations SET settings = :s WHERE id = :id"),
        {"s": json.dumps(settings), "id": org_id},
    )
    await db_session.flush()


async def _shift_starting(svc, org_id, creator_id, *, minutes_from_now: float):
    """A twelve-hour shift whose start is this many minutes from now."""
    start = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(
        minutes=minutes_from_now
    )
    shift, err = await svc.create_shift(
        uuid.UUID(org_id),
        {
            "shift_date": start.date(),
            "start_time": start,
            "end_time": start + timedelta(hours=12),
        },
        uuid.UUID(creator_id),
    )
    assert err is None, err
    return shift


async def _seat(svc, org_id, shift, user_id, actor_id, **kwargs):
    return await svc.create_assignment(
        uuid.UUID(org_id),
        uuid.UUID(shift.id),
        {"user_id": user_id, "position": "firefighter"},
        uuid.UUID(actor_id),
        **kwargs,
    )


class TestMemberSelfSignup:
    async def test_allowed_before_the_shift_starts(self, db_session, org_and_members):
        org_id, officer_id, member_id = org_and_members
        svc = SchedulingService(db_session)
        shift = await _shift_starting(svc, org_id, officer_id, minutes_from_now=120)

        assignment, err = await _seat(
            svc, org_id, shift, member_id, member_id, self_signup=True
        )
        assert err is None
        assert assignment is not None

    async def test_refused_once_the_shift_has_started(
        self, db_session, org_and_members
    ):
        org_id, officer_id, member_id = org_and_members
        svc = SchedulingService(db_session)
        # Ten hours in and still "today" — precisely the row the old
        # shift_date < date.today() check waved through.
        shift = await _shift_starting(svc, org_id, officer_id, minutes_from_now=-600)

        assignment, err = await _seat(
            svc, org_id, shift, member_id, member_id, self_signup=True
        )
        assert assignment is None
        assert err == "This shift has already started. Ask a duty officer to add you."

        seated = await svc.get_shift_assignments(uuid.UUID(shift.id), uuid.UUID(org_id))
        assert seated == []

    async def test_refused_by_a_configured_lead_time(self, db_session, org_and_members):
        org_id, officer_id, member_id = org_and_members
        await _set_scheduling_settings(
            db_session, org_id, signup_closes_minutes_before=60
        )
        svc = SchedulingService(db_session)
        shift = await _shift_starting(svc, org_id, officer_id, minutes_from_now=30)

        assignment, err = await _seat(
            svc, org_id, shift, member_id, member_id, self_signup=True
        )
        assert assignment is None
        assert err is not None
        assert "1 hour before" in err


class TestOfficerAssignment:
    async def test_assigner_allowed_inside_the_grace(self, db_session, org_and_members):
        org_id, officer_id, member_id = org_and_members
        svc = SchedulingService(db_session)
        shift = await _shift_starting(svc, org_id, officer_id, minutes_from_now=-30)

        assignment, err = await _seat(
            svc, org_id, shift, member_id, officer_id, actor=SignupActor.ASSIGNER
        )
        assert err is None
        assert assignment is not None

    async def test_assigner_refused_past_the_grace(self, db_session, org_and_members):
        org_id, officer_id, member_id = org_and_members
        svc = SchedulingService(db_session)
        shift = await _shift_starting(svc, org_id, officer_id, minutes_from_now=-300)

        assignment, err = await _seat(
            svc, org_id, shift, member_id, officer_id, actor=SignupActor.ASSIGNER
        )
        assert assignment is None
        assert err is not None
        assert "scheduling admin" in err

    async def test_manager_is_never_refused(self, db_session, org_and_members):
        org_id, officer_id, member_id = org_and_members
        await _set_scheduling_settings(db_session, org_id, late_signup_grace_minutes=0)
        svc = SchedulingService(db_session)
        shift = await _shift_starting(svc, org_id, officer_id, minutes_from_now=-5000)

        assignment, err = await _seat(
            svc, org_id, shift, member_id, officer_id, actor=SignupActor.MANAGER
        )
        assert err is None
        assert assignment is not None

    async def test_omitting_the_actor_keeps_todays_records_behaviour(
        self, db_session, org_and_members
    ):
        # Every caller that predates this change passes neither actor nor
        # self_signup, and must keep behaving exactly as it did.
        org_id, officer_id, member_id = org_and_members
        svc = SchedulingService(db_session)
        shift = await _shift_starting(svc, org_id, officer_id, minutes_from_now=-5000)

        assignment, err = await _seat(svc, org_id, shift, member_id, officer_id)
        assert err is None
        assert assignment is not None


class TestLateSignupOverride:
    async def test_reopens_self_signup_on_a_started_shift(
        self, db_session, org_and_members
    ):
        org_id, officer_id, member_id = org_and_members
        svc = SchedulingService(db_session)
        shift = await _shift_starting(svc, org_id, officer_id, minutes_from_now=-600)

        reopened, err = await svc.open_late_signup(
            uuid.UUID(shift.id), uuid.UUID(org_id), minutes=30
        )
        assert err is None
        assert reopened.late_signup_until is not None

        assignment, err = await _seat(
            svc, org_id, shift, member_id, member_id, self_signup=True
        )
        assert err is None
        assert assignment is not None

    async def test_only_ever_extends(self, db_session, org_and_members):
        org_id, officer_id, _ = org_and_members
        svc = SchedulingService(db_session)
        shift = await _shift_starting(svc, org_id, officer_id, minutes_from_now=-10)

        long_window, _ = await svc.open_late_signup(
            uuid.UUID(shift.id), uuid.UUID(org_id), minutes=60
        )
        first = long_window.late_signup_until
        # A second officer opening a shorter window must not cut the first
        # short — a member told they had until 19:45 must still have it.
        short_window, _ = await svc.open_late_signup(
            uuid.UUID(shift.id), uuid.UUID(org_id), minutes=5
        )
        assert short_window.late_signup_until == first

    async def test_closing_returns_the_shift_to_the_org_rule(
        self, db_session, org_and_members
    ):
        org_id, officer_id, member_id = org_and_members
        svc = SchedulingService(db_session)
        shift = await _shift_starting(svc, org_id, officer_id, minutes_from_now=-600)
        await svc.open_late_signup(uuid.UUID(shift.id), uuid.UUID(org_id), minutes=30)

        closed, err = await svc.close_late_signup(
            uuid.UUID(shift.id), uuid.UUID(org_id)
        )
        assert err is None
        assert closed.late_signup_until is None

        assignment, err = await _seat(
            svc, org_id, shift, member_id, member_id, self_signup=True
        )
        assert assignment is None
        assert err is not None

    async def test_refused_on_a_finalized_shift(self, db_session, org_and_members):
        org_id, officer_id, _ = org_and_members
        svc = SchedulingService(db_session)
        shift = await _shift_starting(svc, org_id, officer_id, minutes_from_now=-60)
        shift.is_finalized = True
        await db_session.flush()

        result, err = await svc.open_late_signup(
            uuid.UUID(shift.id), uuid.UUID(org_id), minutes=30
        )
        assert result is None
        assert "finalized" in (err or "").lower()

    async def test_scoped_to_the_callers_org(self, db_session, org_and_members):
        org_id, officer_id, _ = org_and_members
        svc = SchedulingService(db_session)
        shift = await _shift_starting(svc, org_id, officer_id, minutes_from_now=-10)

        result, err = await svc.open_late_signup(
            uuid.UUID(shift.id), uuid.uuid4(), minutes=30
        )
        assert result is None
        assert "not found" in (err or "").lower()


class TestReopeningIsBoundedByTheShiftsAge:
    """A reopening is for the crew that turned up short, not for last month.

    ``open_late_signup`` had no upper bound on how old a shift could be, and
    the panel offered "Reopen for 15 min" on every past shift an officer could
    see. Taking it was not cosmetic: ``create_assignment`` passes
    ``window_checked=True`` for a non-manager, which suppresses the
    day-granular ``reject_past`` fallback so a reopened overnight shift admits
    people — leaving the reopened window as the only rule, and letting a member
    self-signup onto a shift that ran three weeks ago and draw hours for it.
    """

    async def test_refused_on_a_shift_that_ended_weeks_ago(
        self, db_session, org_and_members
    ):
        org_id, officer_id, _ = org_and_members
        svc = SchedulingService(db_session)
        # Twelve hours long, and it ended twenty days ago.
        shift = await _shift_starting(
            svc, org_id, officer_id, minutes_from_now=-(20 * 24 * 60 + 720)
        )

        result, err = await svc.open_late_signup(
            uuid.UUID(shift.id), uuid.UUID(org_id), minutes=30
        )
        assert result is None
        assert err == (
            "This shift ended too long ago to reopen signup on. "
            "A scheduling administrator can still record who worked it."
        )
        assert shift.late_signup_until is None

    async def test_the_member_stays_refused_after_a_rejected_reopen(
        self, db_session, org_and_members
    ):
        # The reason the bound exists at all — the reopen was the one thing
        # standing between a dead shift and a self-service hours claim.
        org_id, officer_id, member_id = org_and_members
        svc = SchedulingService(db_session)
        shift = await _shift_starting(
            svc, org_id, officer_id, minutes_from_now=-(20 * 24 * 60 + 720)
        )
        await svc.open_late_signup(uuid.UUID(shift.id), uuid.UUID(org_id), minutes=30)

        assignment, err = await _seat(
            svc, org_id, shift, member_id, member_id, self_signup=True
        )
        assert assignment is None
        assert err is not None
        seated = await svc.get_shift_assignments(uuid.UUID(shift.id), uuid.UUID(org_id))
        assert seated == []

    async def test_allowed_while_the_crew_has_only_just_come_in(
        self, db_session, org_and_members
    ):
        # Signup closed for the officer hours ago — their own deadline counts
        # from the *start* — but the shift ended thirty minutes ago and the
        # roster is still being settled.
        org_id, officer_id, _ = org_and_members
        svc = SchedulingService(db_session)
        shift = await _shift_starting(
            svc, org_id, officer_id, minutes_from_now=-(12 * 60 + 30)
        )

        reopened, err = await svc.open_late_signup(
            uuid.UUID(shift.id), uuid.UUID(org_id), minutes=30
        )
        assert err is None
        assert reopened.late_signup_until is not None

    async def test_the_bound_follows_the_departments_grace_setting(
        self, db_session, org_and_members
    ):
        # Same shift, two departments: the bound is the org's own grace period
        # added to the end, not a constant this rule invented.
        org_id, officer_id, _ = org_and_members
        await _set_scheduling_settings(db_session, org_id, late_signup_grace_minutes=15)
        svc = SchedulingService(db_session)
        shift = await _shift_starting(
            svc, org_id, officer_id, minutes_from_now=-(12 * 60 + 45)
        )

        result, err = await svc.open_late_signup(
            uuid.UUID(shift.id), uuid.UUID(org_id), minutes=30
        )
        assert result is None
        assert "ended too long ago" in (err or "")

        await _set_scheduling_settings(
            db_session, org_id, late_signup_grace_minutes=120
        )
        reopened, err = await svc.open_late_signup(
            uuid.UUID(shift.id), uuid.UUID(org_id), minutes=30
        )
        assert err is None
        assert reopened.late_signup_until is not None


class TestSignupClosedReason:
    async def test_reports_the_state_the_endpoint_enforces(
        self, db_session, org_and_members
    ):
        org_id, officer_id, _ = org_and_members
        svc = SchedulingService(db_session)
        shift = await _shift_starting(svc, org_id, officer_id, minutes_from_now=-600)

        assert (
            await svc.signup_closed_reason(
                shift, uuid.UUID(org_id), SignupActor.MANAGER
            )
            is None
        )
        assert (
            await svc.signup_closed_reason(shift, uuid.UUID(org_id), SignupActor.MEMBER)
            is not None
        )


class TestDateGranularCheckSurvives:
    async def test_a_shift_from_last_week_is_still_refused(
        self, db_session, org_and_members
    ):
        # reject_past covers what the window cannot judge; both must hold.
        org_id, officer_id, member_id = org_and_members
        svc = SchedulingService(db_session)
        past = date.today() - timedelta(days=7)
        shift, err = await svc.create_shift(
            uuid.UUID(org_id),
            {
                "shift_date": past,
                "start_time": datetime(past.year, past.month, past.day, 7, 0),
            },
            uuid.UUID(officer_id),
        )
        assert err is None

        assignment, err = await _seat(
            svc, org_id, shift, member_id, member_id, self_signup=True
        )
        assert assignment is None
        assert err is not None


class TestSettingsRoundTrip:
    """The two window settings survive a partial save of an unrelated toggle."""

    async def test_defaults_when_the_org_never_set_them(
        self, db_session, org_and_members
    ):
        from app.services.shift_eligibility_service import ShiftEligibilityService

        org_id, _, _ = org_and_members
        svc = ShiftEligibilityService(db_session)
        org = await svc._get_org(org_id)
        window = svc.get_signup_window_settings(org)
        # Absence means today's behaviour on the member side, never a new
        # restriction (pitfall #19).
        assert window["signup_closes_minutes_before"] == 0
        assert window["late_signup_grace_minutes"] == 60

    async def test_a_partial_save_does_not_clobber_the_window(
        self, db_session, org_and_members
    ):
        from app.services.shift_eligibility_service import ShiftEligibilityService

        org_id, _, _ = org_and_members
        svc = ShiftEligibilityService(db_session)
        await svc.update_scheduling_settings(
            org_id, signup_closes_minutes_before=45, late_signup_grace_minutes=15
        )
        # A save from an unrelated toggle sends only its own key.
        await svc.update_scheduling_settings(org_id, platoons_enabled=True)

        org = await svc._get_org(org_id)
        window = svc.get_signup_window_settings(org)
        assert window["signup_closes_minutes_before"] == 45
        assert window["late_signup_grace_minutes"] == 15
        assert svc.get_platoons_enabled(org) is True

    async def test_zero_is_storable_and_read_back(self, db_session, org_and_members):
        from app.services.shift_eligibility_service import ShiftEligibilityService

        org_id, _, _ = org_and_members
        svc = ShiftEligibilityService(db_session)
        await svc.update_scheduling_settings(org_id, late_signup_grace_minutes=0)

        org = await svc._get_org(org_id)
        assert svc.get_signup_window_settings(org)["late_signup_grace_minutes"] == 0

    async def test_a_hand_edited_value_degrades_rather_than_raising(
        self, db_session, org_and_members
    ):
        from app.services.shift_eligibility_service import ShiftEligibilityService

        org_id, _, _ = org_and_members
        await _set_scheduling_settings(
            db_session, org_id, late_signup_grace_minutes="soon"
        )
        svc = ShiftEligibilityService(db_session)
        org = await svc._get_org(org_id)
        assert svc.get_signup_window_settings(org)["late_signup_grace_minutes"] == 60

    async def test_a_hand_edited_value_does_not_500_an_unrelated_save(
        self, db_session, org_and_members
    ):
        """The PUT response must degrade the same way the GET path does.

        Building it with a bare ``int()`` raised *outside* the endpoint's try,
        so one hand-edited value turned an unrelated toggle's save into a 500 —
        reported to the admin as a failure, with the write already committed.
        """
        from app.schemas.scheduling import SchedulingFeatureSettings
        from app.services.shift_eligibility_service import ShiftEligibilityService

        org_id, _, _ = org_and_members
        await _set_scheduling_settings(
            db_session,
            org_id,
            signup_closes_minutes_before="tomorrow",
            late_signup_grace_minutes="a while",
        )
        svc = ShiftEligibilityService(db_session)
        result = await svc.update_scheduling_settings(org_id, platoons_enabled=True)
        org = await svc._get_org(org_id)
        window = svc.get_signup_window_settings(org)

        # The values the endpoint projects come from the degrading reader, so
        # the response is constructible rather than raising.
        settings = SchedulingFeatureSettings(
            platoons_enabled=bool(result.get("platoons_enabled", False)),
            signup_closes_minutes_before=window["signup_closes_minutes_before"],
            late_signup_grace_minutes=window["late_signup_grace_minutes"],
        )
        assert settings.signup_closes_minutes_before == 0
        assert settings.late_signup_grace_minutes == 60

    async def test_a_stored_null_reads_back_as_the_default(
        self, db_session, org_and_members
    ):
        # `result.get(key, DEFAULT) or 0` turned a stored null into 0 —
        # "closes at the start" — rather than the built-in default.
        from app.services.shift_eligibility_service import ShiftEligibilityService

        org_id, _, _ = org_and_members
        await _set_scheduling_settings(
            db_session, org_id, late_signup_grace_minutes=None
        )
        svc = ShiftEligibilityService(db_session)
        org = await svc._get_org(org_id)

        assert svc.get_signup_window_settings(org)["late_signup_grace_minutes"] == 60


class TestOvernightShiftsAndTheLegacyDateGuard:
    """A night shift's `shift_date` rolls over while the shift is still running.

    The day-granular `reject_past` check has to stay a *fallback*: an
    18:00–06:00 shift is "yesterday" from midnight, so applying it after the
    instant-based window had already approved the signup meant a reopening
    made at 00:30 — exactly when a crew is short — admitted nobody.
    """

    async def _overnight_shift(self, svc, org_id, officer_id):
        yesterday = date.today() - timedelta(days=1)
        start = datetime.combine(yesterday, datetime.min.time()) + timedelta(hours=18)
        shift, err = await svc.create_shift(
            uuid.UUID(org_id),
            {
                "shift_date": yesterday,
                "start_time": start,
                "end_time": start + timedelta(hours=12),
            },
            uuid.UUID(officer_id),
        )
        assert err is None, err
        return shift

    async def test_a_live_reopening_admits_a_member_after_midnight(
        self, db_session, org_and_members
    ):
        org_id, officer_id, member_id = org_and_members
        svc = SchedulingService(db_session)
        shift = await self._overnight_shift(svc, org_id, officer_id)

        await svc.open_late_signup(uuid.UUID(shift.id), uuid.UUID(org_id), minutes=30)
        assignment, err = await _seat(
            svc, org_id, shift, member_id, member_id, self_signup=True
        )

        assert err is None
        assert assignment is not None

    async def test_without_a_reopening_the_window_still_refuses(
        self, db_session, org_and_members
    ):
        # The precise rule is what refuses it now, not the calendar day.
        org_id, officer_id, member_id = org_and_members
        svc = SchedulingService(db_session)
        shift = await self._overnight_shift(svc, org_id, officer_id)

        assignment, err = await _seat(
            svc, org_id, shift, member_id, member_id, self_signup=True
        )

        assert assignment is None
        assert err == "This shift has already started. Ask a duty officer to add you."

    async def test_the_day_guard_still_fires_when_the_start_cannot_be_read(
        self, db_session, org_and_members
    ):
        # The fallback's whole reason to exist: a row the instant-based window
        # passes through because it cannot judge it.
        from types import SimpleNamespace

        org_id, _, member_id = org_and_members
        svc = SchedulingService(db_session)
        unreadable = SimpleNamespace(
            id=str(uuid.uuid4()),
            shift_date=date.today() - timedelta(days=7),
            start_time=None,
            end_time=None,
            status="scheduled",
            is_finalized=False,
            min_staffing=None,
            positions=None,
            late_signup_until=None,
        )

        error = await svc._validate_assignment_candidate(
            organization_id=uuid.UUID(org_id),
            shift=unreadable,
            user_id=member_id,
            position="firefighter",
            require_mutable=True,
            reject_past=True,
            window_checked=True,
        )

        assert error == "Cannot sign up for a past shift"
