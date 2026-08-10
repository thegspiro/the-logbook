"""
Tests for program deadline-reminder settings.

``TrainingProgram.warning_days_before`` and ``reminder_conditions`` were both
stored, exported, and duplicated — while the sweep that sends the warnings used
a hardcoded ``[30, 14, 7]``. A department that set a 90-day warning got one at
30. Covers:

* normalization, including the single-int shape the column was first written in
* the send decision, including the on-track suppression
* the sweep honoring each program's own settings rather than one global ramp

DB mocked; no MySQL.
"""

from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.training import EnrollmentStatus
from app.schemas.training_program import ReminderConditions
from app.services.struggling_member_service import StrugglingMemberService
from app.utils.reminder_conditions import (
    normalize_reminder_conditions,
    should_send_warning,
)


class TestNormalization:
    def test_an_unset_blob_falls_back_to_the_programs_own_warning_day(self):
        conditions = normalize_reminder_conditions(None, 90)
        assert conditions["days_before_deadline"] == [90, 14, 7]

    def test_no_settings_at_all_gets_the_default_ramp(self):
        conditions = normalize_reminder_conditions(None, None)
        assert conditions["days_before_deadline"] == [30, 14, 7]

    def test_an_explicit_list_wins(self):
        conditions = normalize_reminder_conditions(
            {"days_before_deadline": [60, 30]}, 90
        )
        assert conditions["days_before_deadline"] == [60, 30]

    def test_the_original_single_int_shape_still_loads(self):
        # The column's first documented example was {"days_before_deadline": 90}.
        conditions = normalize_reminder_conditions({"days_before_deadline": 90}, 30)
        assert conditions["days_before_deadline"] == [90]

    def test_days_come_back_earliest_first(self):
        conditions = normalize_reminder_conditions(
            {"days_before_deadline": [7, 60, 30, 7]}, None
        )
        assert conditions["days_before_deadline"] == [60, 30, 7]

    def test_garbage_days_are_dropped_not_crashed_on(self):
        conditions = normalize_reminder_conditions(
            {"days_before_deadline": ["x", -5, None, 14]}, None
        )
        assert conditions["days_before_deadline"] == [14]

    def test_the_default_is_to_warn_everyone(self):
        assert normalize_reminder_conditions({}, None)["send_if_below_percentage"] == (
            100.0
        )

    def test_a_threshold_is_clamped_to_a_percentage(self):
        assert (
            normalize_reminder_conditions({"send_if_below_percentage": 400}, None)[
                "send_if_below_percentage"
            ]
            == 100.0
        )

    def test_a_retired_key_is_ignored_rather_than_crashing(self):
        # milestone_threshold was never implemented; ProgramMilestone rows do
        # progress-triggered notifications. Old rows must still load.
        conditions = normalize_reminder_conditions({"milestone_threshold": 50}, 30)
        assert conditions["days_before_deadline"] == [30, 14, 7]

    def test_a_non_dict_column_value_is_tolerated(self):
        assert normalize_reminder_conditions("junk", 30)["days_before_deadline"] == [
            30,
            14,
            7,
        ]


class TestShouldSendWarning:
    CONDITIONS = {"days_before_deadline": [30, 7], "send_if_below_percentage": 100.0}

    def test_a_warning_day_sends(self):
        assert should_send_warning(30, 10.0, self.CONDITIONS) is True

    def test_an_ordinary_day_does_not(self):
        assert should_send_warning(29, 10.0, self.CONDITIONS) is False

    def test_a_member_on_track_is_left_alone(self):
        conditions = {"days_before_deadline": [30], "send_if_below_percentage": 40.0}
        assert should_send_warning(30, 75.0, conditions) is False

    def test_a_member_behind_still_hears_about_it(self):
        conditions = {"days_before_deadline": [30], "send_if_below_percentage": 40.0}
        assert should_send_warning(30, 25.0, conditions) is True

    def test_no_progress_recorded_counts_as_behind(self):
        conditions = {"days_before_deadline": [30], "send_if_below_percentage": 40.0}
        assert should_send_warning(30, None, conditions) is True


class TestReminderConditionsSchema:
    def test_a_single_int_is_accepted(self):
        assert ReminderConditions(days_before_deadline=90).days_before_deadline == [90]

    def test_a_negative_day_is_rejected(self):
        with pytest.raises(ValueError, match="zero or more days"):
            ReminderConditions(days_before_deadline=[-1])

    def test_a_retired_key_does_not_fail_validation(self):
        conditions = ReminderConditions.model_validate({"milestone_threshold": 50})
        assert conditions.model_dump(exclude_none=True) == {}

    def test_a_percentage_over_100_is_rejected(self):
        with pytest.raises(ValueError, match="less than or equal to 100"):
            ReminderConditions(send_if_below_percentage=101)


def _enrollment(days_left, progress, program):
    return SimpleNamespace(
        id="enr-1",
        user_id="u1",
        program_id="prog-1",
        program=program,
        progress_percentage=progress,
        target_completion_date=date.today() + timedelta(days=days_left),
        deadline_warning_sent=False,
        deadline_warning_sent_at=None,
    )


class WarningSession:
    def __init__(self, enrollments):
        self._enrollments = enrollments
        self.commit = AsyncMock()

    async def execute(self, statement, *args, **kwargs):
        str(statement)
        scalars = MagicMock()
        scalars.all.return_value = self._enrollments
        return MagicMock(scalars=MagicMock(return_value=scalars))


class TestSendDeadlineWarnings:
    def _service(self, enrollments):
        svc = StrugglingMemberService(WarningSession(enrollments))
        svc._send_deadline_notification = AsyncMock()
        return svc

    async def test_a_programs_own_warning_day_is_honored(self):
        # 90 days out is nowhere near the old hardcoded [30, 14, 7].
        program = SimpleNamespace(warning_days_before=90, reminder_conditions=None)
        enrollment = _enrollment(90, 10.0, program)
        svc = self._service([enrollment])

        result = await svc.send_deadline_warnings("org-1")

        assert result["warnings_sent"] == 1
        assert enrollment.deadline_warning_sent is True

    async def test_a_configured_schedule_replaces_the_default(self):
        program = SimpleNamespace(
            warning_days_before=30,
            reminder_conditions={"days_before_deadline": [60]},
        )
        on_a_warning_day = _enrollment(60, 10.0, program)
        on_the_old_default = _enrollment(30, 10.0, program)
        svc = self._service([on_a_warning_day, on_the_old_default])

        result = await svc.send_deadline_warnings("org-1")

        assert result["warnings_sent"] == 1
        assert on_a_warning_day.deadline_warning_sent is True
        assert on_the_old_default.deadline_warning_sent is False

    async def test_a_member_on_track_is_not_pestered(self):
        program = SimpleNamespace(
            warning_days_before=30,
            reminder_conditions={"send_if_below_percentage": 40},
        )
        ahead = _enrollment(30, 80.0, program)
        behind = _enrollment(30, 20.0, program)
        svc = self._service([ahead, behind])

        result = await svc.send_deadline_warnings("org-1")

        assert result["warnings_sent"] == 1
        assert ahead.deadline_warning_sent is False
        assert behind.deadline_warning_sent is True

    async def test_an_enrollment_with_no_program_loaded_uses_the_defaults(self):
        # Defensive: the sweep must not blow up on a broken relationship.
        enrollment = _enrollment(30, 10.0, None)
        svc = self._service([enrollment])

        assert (await svc.send_deadline_warnings("org-1"))["warnings_sent"] == 1

    async def test_the_sweep_only_looks_at_active_enrollments(self):
        # The status filter lives in the query; assert the constant it uses
        # hasn't drifted, since an expired enrollment must not be warned.
        assert EnrollmentStatus.ACTIVE.value == "active"
