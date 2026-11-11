"""The pure rules behind session waiver requests: the cap, the deadline and
the policy's shape. No database.

The rolling cap is the subtle one. The owner's rule is that no 12-month span
may hold more approved waivers than the cap, so approving one dated D is safe
exactly when every span containing D has room, and "x of y left" for D is the
cap minus the fullest such span. ``rolling_used`` checks only the spans that
start on D or on an approved date; the brute-force comparison below is what
shows that loses nothing.
"""

import random
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.schemas.attendance_waiver import AttendanceWaiverPolicy, policy_from_settings
from app.services.attendance_waiver_service import (
    AttendanceWaiverService,
    add_months,
    calendar_year_used,
    cap_used,
    deadline_for,
    remaining,
    rolling_used,
    rolling_window_end,
)

pytestmark = pytest.mark.unit


def _brute_rolling(dates, day):
    """Every span that contains ``day``, one start date at a time."""
    best = 0
    start = add_months(day, -12)
    while start <= day:
        end = rolling_window_end(start)
        if start <= day <= end:
            best = max(best, sum(1 for d in dates if start <= d <= end))
        start += timedelta(days=1)
    return best


class TestCalendarYear:
    def test_counts_the_sessions_year_only(self):
        dates = [date(2025, 12, 31), date(2026, 1, 1), date(2026, 12, 31)]
        assert calendar_year_used(dates, date(2026, 6, 1)) == 2
        assert calendar_year_used(dates, date(2025, 1, 1)) == 1
        assert calendar_year_used(dates, date(2027, 1, 1)) == 0

    def test_the_dates_are_already_the_departments(self):
        """A session date is the local day, so 31 December stays in its year
        even when the session's UTC start was 1 January."""
        assert calendar_year_used([date(2026, 12, 31)], date(2026, 1, 1)) == 1


class TestRolling:
    def test_a_span_is_twelve_months_less_a_day(self):
        assert rolling_window_end(date(2026, 3, 1)) == date(2027, 2, 28)
        assert rolling_window_end(date(2026, 1, 15)) == date(2027, 1, 14)
        # 29 February clamps to the 28th a year on.
        assert rolling_window_end(date(2024, 2, 29)) == date(2025, 2, 27)

    def test_the_boundary_days(self):
        approved = [date(2026, 1, 15)]
        assert rolling_used(approved, date(2027, 1, 14)) == 1
        assert rolling_used(approved, date(2027, 1, 15)) == 0
        assert rolling_used(approved, date(2025, 1, 16)) == 1
        assert rolling_used(approved, date(2025, 1, 15)) == 0

    def test_the_fullest_span_containing_the_day(self):
        approved = [date(2026, 1, 15), date(2026, 6, 1), date(2026, 12, 20)]
        # 15 Jan 2026 to 14 Jan 2027 holds all three and 10 January.
        assert rolling_used(approved, date(2027, 1, 10)) == 3
        # From 16 January on, the January one has dropped out.
        assert rolling_used(approved, date(2027, 1, 16)) == 2

    def test_a_future_approval_counts(self):
        assert rolling_used([date(2026, 12, 1)], date(2026, 3, 1)) == 1
        assert rolling_used([date(2027, 3, 1)], date(2026, 3, 1)) == 0

    def test_spans_either_side_are_checked_separately(self):
        """Approvals six months before and six months after are never in one
        span with each other and the day at once."""
        approved = [date(2026, 1, 1), date(2027, 1, 1)]
        assert rolling_used(approved, date(2026, 7, 1)) == 1

    def test_agrees_with_every_span_by_brute_force(self):
        rng = random.Random(20261110)
        origin = date(2025, 1, 1)
        for _ in range(150):
            dates = [
                origin + timedelta(days=rng.randrange(0, 1100))
                for _ in range(rng.randrange(0, 8))
            ]
            day = origin + timedelta(days=rng.randrange(0, 1100))
            assert rolling_used(dates, day) == _brute_rolling(dates, day), (
                dates,
                day,
            )


class TestRemaining:
    def test_no_cap_is_none(self):
        assert remaining(None, 4) is None

    def test_never_below_zero(self):
        assert remaining(3, 1) == 2
        assert remaining(3, 3) == 0
        # A Chief's override can take a member past the cap.
        assert remaining(3, 5) == 0

    def test_cap_used_picks_the_period(self):
        dates = [date(2025, 12, 1)]
        assert cap_used("calendar_year", dates, date(2026, 2, 1)) == 0
        assert cap_used("rolling_12_months", dates, date(2026, 2, 1)) == 1


class TestDeadline:
    START = datetime(2026, 11, 20, 23, tzinfo=timezone.utc)
    END = datetime(2026, 11, 21, 1, tzinfo=timezone.utc)

    def _event(self, naive=False):
        start, end = self.START, self.END
        if naive:
            start, end = start.replace(tzinfo=None), end.replace(tzinfo=None)
        return SimpleNamespace(start_datetime=start, end_datetime=end)

    def test_before_start(self):
        assert deadline_for("before_start", self._event()) == self.START

    def test_after_the_end(self):
        assert deadline_for("24h_after_end", self._event()) == self.END + timedelta(
            hours=24
        )
        assert deadline_for("7d_after_end", self._event()) == self.END + timedelta(
            days=7
        )

    def test_a_naive_stored_time_is_utc(self):
        assert deadline_for("before_start", self._event(naive=True)) == self.START


class TestPolicySchema:
    def test_the_default_is_off(self):
        policy = AttendanceWaiverPolicy()
        assert policy.model_dump() == {
            "enabled": False,
            "deadline": "before_start",
            "cap": None,
            "cap_period": "calendar_year",
            "categories": [],
            "category_required": False,
            "reason_text": "optional",
            "attachment": "off",
            "attachment_retention_days": 365,
            "approver_position_ids": [],
        }

    @pytest.mark.parametrize("cap", [0, 366, -1])
    def test_the_cap_is_one_to_365(self, cap):
        with pytest.raises(ValidationError):
            AttendanceWaiverPolicy(cap=cap)

    @pytest.mark.parametrize("cap", [1, 365])
    def test_the_cap_bounds_are_inclusive(self, cap):
        assert AttendanceWaiverPolicy(cap=cap).cap == cap

    def test_categories_are_trimmed(self):
        policy = AttendanceWaiverPolicy(categories=["  Medical ", "Work"])
        assert policy.categories == ["Medical", "Work"]

    @pytest.mark.parametrize(
        "categories",
        [
            ["   "],
            ["x" * 101],
            ["Medical", "medical "],
            [f"C{n}" for n in range(21)],
        ],
    )
    def test_bad_categories_are_refused(self, categories):
        with pytest.raises(ValidationError):
            AttendanceWaiverPolicy(categories=categories)

    def test_a_required_category_needs_a_list(self):
        with pytest.raises(ValidationError, match="cannot be required"):
            AttendanceWaiverPolicy(category_required=True)
        assert AttendanceWaiverPolicy(
            categories=["Medical"], category_required=True
        ).category_required

    def test_no_attachment_setting_yet(self):
        """Nothing reads one until attachments ship (pitfall #19)."""
        with pytest.raises(ValidationError):
            AttendanceWaiverPolicy.model_validate({"attachments": "optional"})

    def test_unknown_presets_are_refused(self):
        with pytest.raises(ValidationError):
            AttendanceWaiverPolicy.model_validate({"deadline": "48h_after_end"})
        with pytest.raises(ValidationError):
            AttendanceWaiverPolicy.model_validate({"reason_text": "sometimes"})

    def test_approver_positions_are_deduplicated(self):
        policy = AttendanceWaiverPolicy(approver_position_ids=["a", "b", "a"])
        assert policy.approver_position_ids == ["a", "b"]


class TestReadingTheStoredPolicy:
    @pytest.mark.parametrize("raw", [None, "on", 3, [], {"cap": 0}, {"x": 1}])
    def test_missing_or_malformed_is_off(self, raw):
        assert policy_from_settings(raw) == AttendanceWaiverPolicy()

    def test_a_valid_policy_is_read_back(self):
        policy = policy_from_settings({"enabled": True, "cap": 2})
        assert (policy.enabled, policy.cap) == (True, 2)


class TestAnswers:
    """How the policy's reason settings judge what a member typed."""

    def _answers(self, category=None, reason=None, **policy):
        return AttendanceWaiverService._answers(
            AttendanceWaiverPolicy(**policy), category, reason
        )

    def test_a_category_is_matched_whatever_its_case(self):
        assert self._answers("  WORK ", categories=["Medical", "Work"]) == (
            "Work",
            None,
        )

    def test_free_text_is_trimmed_and_blank_is_none(self):
        assert self._answers(reason="  Sick  ") == (None, "Sick")
        assert self._answers(reason="   ") == (None, None)

    @pytest.mark.parametrize(
        ("kwargs", "message"),
        [
            ({"category": "Work"}, "does not use categories"),
            (
                {"categories": ["Medical"], "category_required": True},
                "Choose a category",
            ),
            ({"category": "Golf", "categories": ["Medical"]}, "categories"),
            ({"reason": "Sick", "reason_text": "off"}, "written reason"),
            ({"reason": " ", "reason_text": "required"}, "Give a reason"),
        ],
    )
    def test_refusals(self, kwargs, message):
        category = kwargs.pop("category", None)
        reason = kwargs.pop("reason", None)
        with pytest.raises(ValueError, match=message):
            self._answers(category, reason, **kwargs)
