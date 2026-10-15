"""When an open action item is owed a reminder, and how the settings read.

Pure rules, no database: the schedule the department chose and the day the
assignee was last reminded decide whether today is a reminder day.
"""

from datetime import date, timedelta

import pytest
from pydantic import ValidationError

from app.schemas.organization import OrganizationSettingsUpdate
from app.services.minutes_reminder_service import (
    DUE_SOON,
    MAX_OVERDUE_DAYS_REMINDED,
    OVERDUE,
    classify,
)
from app.utils.minutes_settings import (
    MinutesReminderSettings,
    minutes_reminder_settings_in,
)

pytestmark = [pytest.mark.unit]

TODAY = date(2026, 10, 15)


def _settings(days_before=3, repeat=7) -> MinutesReminderSettings:
    return MinutesReminderSettings(
        reminders_enabled=True,
        days_before_due=days_before,
        overdue_repeat_days=repeat,
        digest_enabled=True,
    )


class TestDueSoon:
    def test_a_reminder_goes_out_when_the_window_opens(self):
        due = TODAY + timedelta(days=3)
        assert classify(due, TODAY, None, _settings(3)) == DUE_SOON

    def test_nothing_before_the_window_opens(self):
        due = TODAY + timedelta(days=4)
        assert classify(due, TODAY, None, _settings(3)) is None

    def test_one_reminder_per_window(self):
        due = TODAY + timedelta(days=2)
        reminded_when_window_opened = TODAY - timedelta(days=1)
        assert classify(due, TODAY, reminded_when_window_opened, _settings(3)) is None

    def test_a_reminder_from_before_the_window_does_not_count(self):
        due = TODAY + timedelta(days=2)
        earlier = TODAY - timedelta(days=10)
        assert classify(due, TODAY, earlier, _settings(3)) == DUE_SOON

    def test_zero_days_ahead_reminds_on_the_due_date_only(self):
        assert classify(TODAY, TODAY, None, _settings(0)) == DUE_SOON
        assert classify(TODAY + timedelta(days=1), TODAY, None, _settings(0)) is None


class TestOverdue:
    def test_the_first_overdue_reminder_goes_the_day_after(self):
        assert classify(TODAY - timedelta(days=1), TODAY, None, _settings()) == OVERDUE

    def test_a_reminder_sent_before_it_fell_due_does_not_silence_the_overdue_one(self):
        due = TODAY - timedelta(days=1)
        reminded_on_the_due_date = due
        assert classify(due, TODAY, reminded_on_the_due_date, _settings()) == OVERDUE

    def test_repeats_wait_the_configured_gap(self):
        due = TODAY - timedelta(days=20)
        assert (
            classify(due, TODAY, TODAY - timedelta(days=6), _settings(repeat=7)) is None
        )
        assert (
            classify(due, TODAY, TODAY - timedelta(days=7), _settings(repeat=7))
            == OVERDUE
        )

    def test_zero_repeat_sends_the_first_overdue_reminder_only(self):
        due = TODAY - timedelta(days=20)
        assert classify(due, TODAY, None, _settings(repeat=0)) == OVERDUE
        told_overdue = TODAY - timedelta(days=10)
        assert classify(due, TODAY, told_overdue, _settings(repeat=0)) is None

    def test_items_far_past_due_are_left_to_the_weekly_list(self):
        due = TODAY - timedelta(days=MAX_OVERDUE_DAYS_REMINDED + 1)
        assert classify(due, TODAY, None, _settings()) is None
        edge = TODAY - timedelta(days=MAX_OVERDUE_DAYS_REMINDED)
        assert classify(edge, TODAY, None, _settings()) == OVERDUE


class TestSettingsReading:
    def test_absent_settings_read_as_the_defaults(self):
        resolved = minutes_reminder_settings_in({})
        assert resolved == MinutesReminderSettings(True, 3, 7, True)

    def test_a_missing_organization_row_reads_as_the_defaults(self):
        assert minutes_reminder_settings_in(None).reminders_enabled is True

    def test_only_a_literal_false_turns_a_switch_off(self):
        off = minutes_reminder_settings_in(
            {"minutes": {"action_item_reminders": False, "open_items_digest": False}}
        )
        assert (off.reminders_enabled, off.digest_enabled) == (False, False)
        stray = minutes_reminder_settings_in(
            {"minutes": {"action_item_reminders": "false", "open_items_digest": 0}}
        )
        assert (stray.reminders_enabled, stray.digest_enabled) == (True, True)

    def test_chosen_numbers_are_used(self):
        resolved = minutes_reminder_settings_in(
            {"minutes": {"reminder_days_before_due": 0, "overdue_repeat_days": 14}}
        )
        assert (resolved.days_before_due, resolved.overdue_repeat_days) == (0, 14)

    @pytest.mark.parametrize("bad", [-1, 31, 2.5, "3", True, None, [3]])
    def test_a_malformed_lead_time_reads_as_the_default(self, bad):
        resolved = minutes_reminder_settings_in(
            {"minutes": {"reminder_days_before_due": bad}}
        )
        assert resolved.days_before_due == 3

    @pytest.mark.parametrize("bad", [-1, 91, 1.5, "7", False])
    def test_a_malformed_repeat_reads_as_the_default(self, bad):
        resolved = minutes_reminder_settings_in(
            {"minutes": {"overdue_repeat_days": bad}}
        )
        assert resolved.overdue_repeat_days == 7

    def test_a_non_dict_section_reads_as_the_defaults(self):
        assert minutes_reminder_settings_in({"minutes": "on"}).days_before_due == 3


class TestSettingsSchema:
    def test_the_minutes_section_is_accepted_and_only_what_was_sent_is_dumped(self):
        update = OrganizationSettingsUpdate(minutes={"overdue_repeat_days": 14})
        assert update.model_dump(exclude_unset=True) == {
            "minutes": {"overdue_repeat_days": 14}
        }

    @pytest.mark.parametrize(
        "bad",
        [
            {"reminder_days_before_due": 31},
            {"reminder_days_before_due": -1},
            {"overdue_repeat_days": 91},
            {"overdue_repeat_days": -1},
        ],
    )
    def test_out_of_range_numbers_are_refused(self, bad):
        with pytest.raises(ValidationError):
            OrganizationSettingsUpdate(minutes=bad)
