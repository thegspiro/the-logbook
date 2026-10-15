"""Per-department settings for meeting minutes.

Stored in the organization settings as the ``minutes`` section and written
through ``PATCH /organization/settings`` (``settings.manage``).

Pitfall #19: this module is the reader. ``MinutesReminderService`` consults it
on every daily run, and ``GET /minutes-records/settings`` reports what it
resolved, so the screen shows what the sender will do rather than a copy of
these defaults.

``action_item_reminders``
    Master switch for the reminder emails an assignee gets about an open action
    item. On unless set to a literal ``False``: an absent value reads as the
    default, which is on. Turning it off stops these emails only; the bell
    reminders and the Action Items list are unaffected.

``reminder_days_before_due``
    How many days ahead of the due date the first reminder goes out. ``0``
    reminds on the day it is due and not before. Default 3, at most 30.

``overdue_repeat_days``
    How many days between repeat reminders on an item that is past due. The
    first overdue reminder is sent the day after the due date whatever this is;
    ``0`` means that one only. Default 7, at most 90.

``open_items_digest``
    Whether members who hold ``minutes.manage`` get a weekly list of every open
    action item and who owns it. On unless set to a literal ``False``.

Every value is read defensively. The JSON is unvalidated and an exception here
would take out the daily task for the whole organization over one mistyped
setting, so anything malformed reads as its default.
"""

from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import Organization

MINUTES_SETTINGS_KEY = "minutes"

REMINDERS_FLAG = "action_item_reminders"
DAYS_BEFORE_KEY = "reminder_days_before_due"
OVERDUE_REPEAT_KEY = "overdue_repeat_days"
DIGEST_FLAG = "open_items_digest"
# Not a setting: the day the weekly digest last went out, kept here so the
# week is measured from what was sent rather than from a process that forgets
# its last run on every restart.
LAST_DIGEST_KEY = "last_open_items_digest_on"

DEFAULT_DAYS_BEFORE_DUE = 3
MAX_DAYS_BEFORE_DUE = 30
DEFAULT_OVERDUE_REPEAT_DAYS = 7
MAX_OVERDUE_REPEAT_DAYS = 90


@dataclass(frozen=True)
class MinutesReminderSettings:
    reminders_enabled: bool
    days_before_due: int
    overdue_repeat_days: int
    digest_enabled: bool


def _bounded_int(value: Any, default: int, maximum: int) -> int:
    # bool is an int subclass; a stray ``true`` must not read as 1 day.
    if isinstance(value, bool) or not isinstance(value, int):
        return default
    return value if 0 <= value <= maximum else default


def minutes_reminder_settings_in(settings: Any) -> MinutesReminderSettings:
    """Resolve the reminder settings out of an organization's settings JSON."""
    section = settings.get(MINUTES_SETTINGS_KEY) if isinstance(settings, dict) else None
    if not isinstance(section, dict):
        section = {}

    return MinutesReminderSettings(
        reminders_enabled=section.get(REMINDERS_FLAG) is not False,
        days_before_due=_bounded_int(
            section.get(DAYS_BEFORE_KEY), DEFAULT_DAYS_BEFORE_DUE, MAX_DAYS_BEFORE_DUE
        ),
        overdue_repeat_days=_bounded_int(
            section.get(OVERDUE_REPEAT_KEY),
            DEFAULT_OVERDUE_REPEAT_DAYS,
            MAX_OVERDUE_REPEAT_DAYS,
        ),
        digest_enabled=section.get(DIGEST_FLAG) is not False,
    )


async def load_minutes_reminder_settings(
    db: AsyncSession, organization_id: str
) -> MinutesReminderSettings:
    result = await db.execute(
        select(Organization.settings).where(Organization.id == str(organization_id))
    )
    return minutes_reminder_settings_in(result.scalar_one_or_none())
