"""Signup is bounded by the shift's own start, not by its calendar day.

A member could put themselves on a 06:00 shift at 23:00 the same night — the
only temporal check was ``shift_date < date.today()`` — and every hours and
compliance report built on the assignment accepted it. Three actors, three
deadlines: a member commits ahead of the shift, an officer solves a short crew
on the night, and a scheduling administrator records what happened, which is
necessarily afterwards.

Pure function under test; no DB.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.models.training import ShiftStatus
from app.services.scheduling_service import SchedulingService, SignupActor

pytestmark = pytest.mark.unit

NOW = datetime(2026, 9, 4, 18, 0, tzinfo=timezone.utc)


def _shift(start_offset_minutes: float, **overrides):
    """A shift starting this many minutes from NOW (negative = already began)."""
    data = {
        "start_time": NOW + timedelta(minutes=start_offset_minutes),
        "end_time": NOW + timedelta(minutes=start_offset_minutes + 720),
        "late_signup_until": None,
        "status": ShiftStatus.SCHEDULED,
        "is_finalized": False,
    }
    data.update(overrides)
    return SimpleNamespace(**data)


def _settings(**scheduling):
    return {"scheduling": scheduling} if scheduling else {}


def _error(shift, settings, actor):
    return SchedulingService._signup_window_error(shift, settings, actor, now=NOW)


class TestMemberWindow:
    def test_open_before_the_start(self):
        assert _error(_shift(60), _settings(), SignupActor.MEMBER) is None

    def test_open_at_the_start_instant(self):
        assert _error(_shift(0), _settings(), SignupActor.MEMBER) is None

    def test_closed_one_minute_after_the_start(self):
        error = _error(_shift(-1), _settings(), SignupActor.MEMBER)
        assert error == "This shift has already started. Ask a duty officer to add you."

    def test_closed_the_same_day_the_old_rule_allowed(self):
        # The regression this whole change exists for: a shift that began ten
        # hours ago is still "today", so shift_date < date.today() was False.
        error = _error(_shift(-600), _settings(), SignupActor.MEMBER)
        assert error is not None

    def test_lead_time_closes_signup_early(self):
        settings = _settings(signup_closes_minutes_before=30)
        assert _error(_shift(31), settings, SignupActor.MEMBER) is None
        error = _error(_shift(29), settings, SignupActor.MEMBER)
        assert error is not None
        assert "30 minutes before" in error

    def test_lead_time_is_phrased_in_hours(self):
        error = _error(
            _shift(30), _settings(signup_closes_minutes_before=120), SignupActor.MEMBER
        )
        assert error is not None
        assert "2 hours before" in error

    def test_default_lead_is_zero_so_nothing_closes_early(self):
        # Absence must mean current behaviour, never a new restriction.
        assert _error(_shift(1), _settings(), SignupActor.MEMBER) is None


class TestAssignerWindow:
    def test_open_inside_the_default_grace(self):
        assert _error(_shift(-59), _settings(), SignupActor.ASSIGNER) is None

    def test_closed_past_the_default_grace(self):
        error = _error(_shift(-61), _settings(), SignupActor.ASSIGNER)
        assert error is not None
        assert "scheduling admin" in error

    def test_grace_is_configurable(self):
        settings = _settings(late_signup_grace_minutes=180)
        assert _error(_shift(-179), settings, SignupActor.ASSIGNER) is None
        assert _error(_shift(-181), settings, SignupActor.ASSIGNER) is not None

    def test_zero_grace_closes_at_the_start(self):
        settings = _settings(late_signup_grace_minutes=0)
        assert _error(_shift(0), settings, SignupActor.ASSIGNER) is None
        assert _error(_shift(-1), settings, SignupActor.ASSIGNER) is not None

    def test_the_member_lead_does_not_bind_an_assigner(self):
        # An officer seating somebody is not making the commitment the lead
        # time exists to freeze.
        settings = _settings(signup_closes_minutes_before=10080)
        assert _error(_shift(60), settings, SignupActor.ASSIGNER) is None


class TestManagerIsNeverBounded:
    @pytest.mark.parametrize("offset", [-1, -600, -60 * 24 * 365])
    def test_records_and_backfill_always_allowed(self, offset):
        assert _error(_shift(offset), _settings(), SignupActor.MANAGER) is None

    def test_allowed_even_with_the_tightest_settings(self):
        settings = _settings(
            signup_closes_minutes_before=10080, late_signup_grace_minutes=0
        )
        assert _error(_shift(-5000), settings, SignupActor.MANAGER) is None


class TestLateSignupOverride:
    def test_reopens_for_a_member(self):
        shift = _shift(-120, late_signup_until=NOW + timedelta(minutes=15))
        assert _error(shift, _settings(), SignupActor.MEMBER) is None

    def test_reopens_for_an_assigner_past_the_grace(self):
        shift = _shift(-300, late_signup_until=NOW + timedelta(minutes=15))
        assert _error(shift, _settings(), SignupActor.ASSIGNER) is None

    def test_an_expired_override_names_itself(self):
        shift = _shift(-120, late_signup_until=NOW - timedelta(minutes=5))
        error = _error(shift, _settings(), SignupActor.MEMBER)
        assert error is not None
        assert "Late signup for this shift has closed" in error

    def test_never_shortens_the_natural_deadline(self):
        # An override that already expired must not close a shift that has not
        # started: the officer widened the window, they did not narrow it.
        shift = _shift(60, late_signup_until=NOW - timedelta(hours=1))
        assert _error(shift, _settings(), SignupActor.MEMBER) is None

    def test_never_shortens_an_assigner_grace(self):
        shift = _shift(-30, late_signup_until=NOW - timedelta(hours=1))
        assert _error(shift, _settings(), SignupActor.ASSIGNER) is None


class TestPassThroughs:
    def test_naive_start_time_is_read_as_utc(self):
        # MySQL DATETIME carries no offset; comparing a naive value against an
        # aware now raises TypeError, which would 500 every signup.
        shift = _shift(-30)
        shift.start_time = shift.start_time.replace(tzinfo=None)
        assert _error(shift, _settings(), SignupActor.MEMBER) is not None

    def test_naive_override_is_read_as_utc(self):
        shift = _shift(-120)
        shift.late_signup_until = (NOW + timedelta(minutes=15)).replace(tzinfo=None)
        assert _error(shift, _settings(), SignupActor.MEMBER) is None

    def test_missing_start_time_is_allowed_through(self):
        # Refusing on data this rule cannot judge would block signup on legacy
        # rows; reject_past still covers them by calendar day.
        assert (
            _error(_shift(-600, start_time=None), _settings(), SignupActor.MEMBER)
            is None
        )

    def test_cancelled_shift_defers_to_the_mutability_check(self):
        shift = _shift(-600, status=ShiftStatus.CANCELLED)
        assert _error(shift, _settings(), SignupActor.MEMBER) is None

    def test_finalized_shift_defers_to_the_mutability_check(self):
        shift = _shift(-600, is_finalized=True)
        assert _error(shift, _settings(), SignupActor.MEMBER) is None


class TestMalformedSettingsDegrade:
    """Unvalidated JSON an admin can hand-edit must not take out signup."""

    def test_scheduling_key_is_not_a_dict(self):
        assert (
            _error(_shift(60), {"scheduling": "nonsense"}, SignupActor.MEMBER) is None
        )

    def test_non_numeric_lead_falls_back_to_the_default(self):
        settings = _settings(signup_closes_minutes_before="soon")
        assert _error(_shift(1), settings, SignupActor.MEMBER) is None

    def test_non_numeric_grace_falls_back_to_the_default(self):
        settings = _settings(late_signup_grace_minutes="a while")
        assert _error(_shift(-59), settings, SignupActor.ASSIGNER) is None
        assert _error(_shift(-61), settings, SignupActor.ASSIGNER) is not None

    def test_negative_values_are_clamped_to_zero(self):
        settings = _settings(
            signup_closes_minutes_before=-500, late_signup_grace_minutes=-500
        )
        assert _error(_shift(1), settings, SignupActor.MEMBER) is None
        assert _error(_shift(-1), settings, SignupActor.ASSIGNER) is not None

    def test_absurd_values_are_clamped_to_the_ceiling(self):
        settings = _settings(late_signup_grace_minutes=10**9)
        assert _error(_shift(-1440), settings, SignupActor.ASSIGNER) is None
        assert _error(_shift(-1441), settings, SignupActor.ASSIGNER) is not None


class TestMalformedChecklistSettingsDegrade:
    """`or {}` only survives a *falsy* wrong type.

    A legacy or hand-edited organization holding a truthy non-object at either
    level reached ``.get`` on a string or a list and raised AttributeError.
    That is not a degraded window but a 500, on an endpoint every member reads
    and on the roster deadline itself.
    """

    @pytest.mark.parametrize(
        "reports",
        [
            "legacy string",
            ["checklist_timing"],
            {"checklist_timing": "12"},
            {"checklist_timing": ["checkin_closes_hours_after"]},
            {"checklist_timing": {"checkin_closes_hours_after": "whenever"}},
        ],
    )
    def test_the_cushion_falls_back_to_the_floor(self, reports):
        from app.services.scheduling_service import (
            OPEN_ENDED_SHIFT_CUSHION_HOURS,
            open_ended_cushion_hours,
        )

        assert (
            open_ended_cushion_hours({"shift_reports": reports})
            == OPEN_ENDED_SHIFT_CUSHION_HOURS
        )

    def test_check_in_keeps_its_own_defaults(self):
        # The same blob, the same defect, so the same fix — this reader
        # predates the cushion and would have raised on the identical row.
        from types import SimpleNamespace

        from app.services.scheduling_service import SchedulingService

        shift = SimpleNamespace(
            start_time=datetime.now(timezone.utc) - timedelta(hours=1),
            end_time=datetime.now(timezone.utc) + timedelta(hours=11),
        )

        assert (
            SchedulingService._checkin_window_error(
                shift, {"shift_reports": "legacy string"}
            )
            is None
        )
