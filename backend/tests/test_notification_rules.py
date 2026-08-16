"""Notification rules actually gate their senders
(app/services/notification_rules.py).

Rules shipped with CRUD, an admin screen and a toggle, and no dispatcher — a
chief could turn "Event reminders" off and the reminders kept going. These
cover the resolution semantics, and above all the one that protects existing
installations: an org with no rules keeps every notification it had. DB
mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.notification import ENFORCED_TRIGGERS, NotificationTrigger, is_enforced
from app.services.notification_rules import (
    NotificationRuleResolver,
    reminder_schedule_from,
)

EVENT = NotificationTrigger.EVENT_REMINDER


def _rule(name="rule", enabled=True, config=None):
    return SimpleNamespace(name=name, enabled=enabled, config=config)


def _resolver(rules):
    db = MagicMock()
    result = MagicMock()
    result.scalars.return_value.all.return_value = rules
    db.execute = AsyncMock(return_value=result)
    return NotificationRuleResolver(db), db


class TestAbsenceMeansOn:
    async def test_an_org_with_no_rules_keeps_its_notifications(self):
        # The property that makes this safe to deploy: an installation that
        # never populated the table must not go quiet after an upgrade.
        resolver, _ = _resolver([])
        assert await resolver.is_enabled("org-1", EVENT) is True

    async def test_the_built_in_config_is_what_the_sender_used_before(self):
        resolver, _ = _resolver([])
        resolved = await resolver.resolve("org-1", EVENT)
        assert resolved.config == {"default_reminder_schedule": [24]}


class TestEnableSemantics:
    async def test_a_disabled_rule_turns_the_notification_off(self):
        resolver, _ = _resolver([_rule(enabled=False)])
        assert await resolver.is_enabled("org-1", EVENT) is False

    async def test_one_enabled_rule_among_several_keeps_it_on(self):
        # Off requires turning off every rule for the trigger. The reverse —
        # one forgotten disabled row silencing a channel the other rules say
        # should run — is the more dangerous failure for a fire department.
        resolver, _ = _resolver([_rule("a", enabled=False), _rule("b", enabled=True)])
        assert await resolver.is_enabled("org-1", EVENT) is True

    async def test_config_from_a_disabled_rule_is_ignored(self):
        resolver, _ = _resolver(
            [
                _rule("a", enabled=False, config={"default_reminder_schedule": [1]}),
                _rule("b", enabled=True),
            ]
        )
        resolved = await resolver.resolve("org-1", EVENT)
        assert resolved.config == {"default_reminder_schedule": [24]}

    async def test_an_enabled_rule_overrides_the_built_in_config(self):
        resolver, _ = _resolver([_rule(config={"default_reminder_schedule": [48, 2]})])
        resolved = await resolver.resolve("org-1", EVENT)
        assert resolved.config["default_reminder_schedule"] == [48, 2]


class TestCaching:
    async def test_the_same_trigger_is_queried_once_per_org(self):
        # run_event_reminders walks every upcoming event; an uncached resolver
        # would put this query on the inner loop.
        resolver, db = _resolver([])
        await resolver.is_enabled("org-1", EVENT)
        await resolver.is_enabled("org-1", EVENT)
        assert db.execute.await_count == 1

    async def test_a_second_org_is_resolved_separately(self):
        resolver, db = _resolver([])
        await resolver.is_enabled("org-1", EVENT)
        await resolver.is_enabled("org-2", EVENT)
        assert db.execute.await_count == 2


class TestEnforcedTriggers:
    def test_only_triggers_with_a_sender_are_reported_as_enforced(self):
        # This is the assertion to update when a trigger is wired — and the
        # one that fails if a trigger is added here without a sender reading it.
        assert {t.value for t in ENFORCED_TRIGGERS} == {
            "event_reminder",
            "training_expiry",
        }

    @pytest.mark.parametrize("trigger", ["event_reminder", "training_expiry"])
    def test_a_wired_trigger_is_enforced_by_name_or_enum(self, trigger):
        assert is_enforced(trigger) is True
        assert is_enforced(NotificationTrigger(trigger)) is True

    @pytest.mark.parametrize("trigger", ["maintenance_due", "form_submitted"])
    def test_a_trigger_with_no_sender_is_not_claimed_to_work(self, trigger):
        assert is_enforced(trigger) is False

    def test_an_unknown_trigger_is_not_enforced_rather_than_raising(self):
        assert is_enforced("something_invented") is False


class TestResponseSchema:
    def _row(self, trigger):
        from datetime import datetime, timezone
        from uuid import uuid4

        return SimpleNamespace(
            id=uuid4(),
            organization_id=uuid4(),
            name="Rule",
            description=None,
            trigger=trigger,
            category="events",
            channel="in_app",
            enabled=True,
            config=None,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
            created_by=None,
        )

    @pytest.mark.parametrize(
        ("trigger", "expected"),
        [("event_reminder", True), ("maintenance_due", False)],
    )
    def test_enforced_is_serialised_for_the_admin_screen(self, trigger, expected):
        # A computed field, so it must survive from_attributes validation of an
        # ORM row that has no such column.
        from app.schemas.notifications import NotificationRuleResponse

        payload = NotificationRuleResponse.model_validate(self._row(trigger))
        assert payload.model_dump()["enforced"] is expected


class TestReminderScheduleFrom:
    def test_the_built_in_fallback_is_the_literal_the_task_used(self):
        assert reminder_schedule_from({}) == [24]

    def test_hours_are_ordered_furthest_out_first_and_deduped(self):
        assert reminder_schedule_from({"default_reminder_schedule": [2, 48, 2]}) == [
            48,
            2,
        ]

    @pytest.mark.parametrize(
        "raw",
        [
            "48",  # a string where a list belongs
            {"hours": 48},
            [],
            [0, -3, 999],  # outside the task's 168-hour lookahead
            [True],  # bool is an int subclass; not an hour count
            ["48"],
            None,
        ],
    )
    def test_a_bad_config_degrades_to_the_default_instead_of_raising(self, raw):
        # config is free-form JSON on the row. An exception here would take out
        # the whole org's reminders inside a scheduled task, not just the
        # setting somebody typed wrong.
        assert reminder_schedule_from({"default_reminder_schedule": raw}) == [24]

    def test_a_valid_entry_survives_alongside_junk(self):
        assert reminder_schedule_from({"default_reminder_schedule": [48, 0, "x"]}) == [
            48
        ]


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
