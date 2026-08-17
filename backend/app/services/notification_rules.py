"""Notification rules: the org-level switch on an automated notification.

The ``notification_rules`` table, its CRUD endpoints and its admin screen had
been shipped without anything that reads them. A chief could create "Event
reminders", see it listed as *Active*, toggle it off — and the reminders kept
going out, because no sender ever consulted the table. A switch wired to
nothing is worse than no switch: it invites someone to believe a notification
is off when it is not.

This module is the thing that reads them. A sender asks
:class:`NotificationRuleResolver` whether its trigger is on for an
organization, and skips the work if not.

Two properties matter more than anything else here:

**Absence means on.** An organization with no rule for a trigger keeps exactly
the behaviour it had before rules were enforced. Departments upgrading must not
silently lose their reminders because a table they never populated is empty —
a missed drill notice is a real operational cost, and nobody would connect it
to an upgrade.

**Only enforced triggers claim to work.** :data:`ENFORCED_TRIGGERS` is the set
a sender actually consults. The others remain in the enum because rules may
already exist for them, but the API marks them so the admin screen can show
them as not enforced rather than repeating the original bug at a smaller
scale. Wiring one means finding the sender, calling the resolver in it, and
adding the trigger here — in that order.
"""

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import (  # noqa: F401  (re-exported for callers)
    ENFORCED_TRIGGERS,
    NotificationRule,
    NotificationTrigger,
    is_enforced,
)

# What a trigger does for an organization that has no rule for it. These must
# keep matching what the sender did before it consulted the resolver.
_DEFAULT_CONFIG: Dict[NotificationTrigger, Dict[str, Any]] = {
    # Per-event schedules still win; this is only the fallback for an event
    # that carries none, and [24] is the literal the task used before.
    NotificationTrigger.EVENT_REMINDER: {"default_reminder_schedule": [24]},
    NotificationTrigger.TRAINING_EXPIRY: {},
}


@dataclass(frozen=True)
class ResolvedRule:
    """The effective rule for one (organization, trigger) pair."""

    enabled: bool
    config: Dict[str, Any] = field(default_factory=dict)


class NotificationRuleResolver:
    """Answers "is this notification on for this org, and configured how".

    Results are cached per instance. Senders iterate organizations and then
    rows within them (``run_event_reminders`` walks every upcoming event), so
    an uncached resolver would put a query on the inner loop.
    """

    def __init__(self, db: AsyncSession):
        self.db = db
        self._cache: Dict[Tuple[str, str], ResolvedRule] = {}

    async def resolve(
        self, organization_id: UUID | str, trigger: NotificationTrigger
    ) -> ResolvedRule:
        key = (str(organization_id), trigger.value)
        cached = self._cache.get(key)
        if cached is not None:
            return cached

        defaults = dict(_DEFAULT_CONFIG.get(trigger, {}))
        result = await self.db.execute(
            select(NotificationRule)
            .where(NotificationRule.organization_id == str(organization_id))
            .where(NotificationRule.trigger == trigger)
            .order_by(NotificationRule.name)
        )
        rules = list(result.scalars().all())

        if not rules:
            resolved = ResolvedRule(enabled=True, config=defaults)
        else:
            # Any enabled rule keeps the notification on. An admin who wants
            # it off turns off every rule they made for it — safer than the
            # reverse, where one forgotten disabled row silences a channel
            # the other rules say should be running.
            active = [rule for rule in rules if rule.enabled]
            config = defaults
            for rule in active:
                if isinstance(rule.config, dict):
                    config = {**config, **rule.config}
            resolved = ResolvedRule(enabled=bool(active), config=config)

        self._cache[key] = resolved
        return resolved

    async def is_enabled(
        self, organization_id: UUID | str, trigger: NotificationTrigger
    ) -> bool:
        """Shorthand for senders that take no configuration."""
        return (await self.resolve(organization_id, trigger)).enabled


def reminder_schedule_from(config: Dict[str, Any]) -> List[int]:
    """The fallback reminder schedule (hours before start) from a rule config.

    Defensive because ``config`` is free-form JSON on the rule row: a value an
    admin or an import put there must degrade to the built-in default rather
    than raise inside a scheduled task, where the exception would take out the
    whole organization's reminders rather than one bad setting.
    """
    default = [24]
    raw: Optional[Any] = (config or {}).get("default_reminder_schedule")
    if not isinstance(raw, (list, tuple)):
        return default
    hours = [
        int(value)
        for value in raw
        if isinstance(value, (int, float))
        and not isinstance(value, bool)
        and 0 < int(value) <= 168
    ]
    return sorted(set(hours), reverse=True) or default
