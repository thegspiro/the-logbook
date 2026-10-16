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

``signature_slots``
    Who signs adopted minutes: a list of ``{key, title, position_slug}``. A
    slot with a ``position_slug`` is signed by a member holding that position;
    one without is signed by anyone who holds ``minutes.manage``. Absent or
    unusable reads as the two slots every department started with, a recording
    secretary and a presiding officer, so an upgrade changes nothing a
    department had set up.

Every value is read defensively. The JSON is unvalidated and an exception here
would take out the daily task for the whole organization over one mistyped
setting, so anything malformed reads as its default.
"""

import re
from dataclasses import dataclass
from typing import Any, List, Optional

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

SIGNATURE_SLOTS_KEY = "signature_slots"
MAX_SIGNATURE_SLOTS = 6
_SLOT_KEY = re.compile(r"^[a-z][a-z0-9_]{0,49}$")

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


@dataclass(frozen=True)
class SignatureSlot:
    key: str
    title: str
    position_slug: Optional[str] = None


DEFAULT_SIGNATURE_SLOTS = (
    SignatureSlot("recording_secretary", "Recording Secretary"),
    SignatureSlot("presiding_officer", "Presiding Officer"),
)


def signature_slots_in(settings: Any) -> List[SignatureSlot]:
    """The slots adopted minutes are signed in, in order.

    Anything that is not a usable list reads as the defaults. Within a list, an
    entry that is malformed or repeats an earlier key is dropped rather than
    failing the rest: this is read when someone signs, and one mistyped entry
    must not stop the others from being signed.
    """
    section = settings.get(MINUTES_SETTINGS_KEY) if isinstance(settings, dict) else None
    raw = section.get(SIGNATURE_SLOTS_KEY) if isinstance(section, dict) else None
    if not isinstance(raw, list):
        return list(DEFAULT_SIGNATURE_SLOTS)

    slots: List[SignatureSlot] = []
    seen: set[str] = set()
    for entry in raw[:MAX_SIGNATURE_SLOTS]:
        if not isinstance(entry, dict):
            continue
        key, title = entry.get("key"), entry.get("title")
        if not isinstance(key, str) or not _SLOT_KEY.match(key) or key in seen:
            continue
        if not isinstance(title, str) or not title.strip() or len(title) > 100:
            continue
        position = entry.get("position_slug")
        slots.append(
            SignatureSlot(
                key,
                title.strip(),
                position if isinstance(position, str) and position else None,
            )
        )
        seen.add(key)
    return slots or list(DEFAULT_SIGNATURE_SLOTS)


async def load_signature_slots(
    db: AsyncSession, organization_id: str
) -> List[SignatureSlot]:
    result = await db.execute(
        select(Organization.settings).where(Organization.id == str(organization_id))
    )
    return signature_slots_in(result.scalar_one_or_none())
