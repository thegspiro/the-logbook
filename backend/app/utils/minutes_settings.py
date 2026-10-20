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

``public_posting``
    Whether published minutes are also posted on the department's public
    minutes page. **Off unless set to a literal ``True``**: this is a door to
    the public, so an absent, mistyped or malformed value must read as shut.

``executive_library_publishing``
    Whether executive-session minutes may be published to the Documents
    library at all. Off unless a literal ``True``. When on they are filed in a
    leadership-only folder, never in the folder every member can read.

``executive_public_posting``
    Whether executive-session minutes may be posted publicly. Off unless a
    literal ``True``, and only effective when ``public_posting`` and
    ``executive_library_publishing`` are on too (see
    ``MinutesPublishingSettings.public_allowed``), so one stray switch cannot
    open it.

``attendance_listing``
    Which attendance statuses the minutes name: ``all``, ``present_excused`` or
    ``present``. Absent or unrecognised reads as ``all``, the behaviour every
    department had before this existed, so an upgrade changes nothing on a
    printed or published copy. Display only: the roll is always recorded in
    full, because quorum and the attendance reports read it. A set of minutes
    can carry its own choice (``meeting_minutes.attendance_listing``).

``auto_file_election_results``
    Whether a closed election's certified result is filed with the minutes of
    the meeting it was held at without anyone importing it: when the election
    closes if those minutes exist, otherwise when they are created, and as a
    permanent addendum when the minutes have already been circulated or
    adopted. On unless set to a literal ``False``. Switching it off leaves the
    manual import on the minutes page exactly as it was.

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
from app.utils.minutes_attendance import DEFAULT_ATTENDANCE_LISTING, normalize_listing

MINUTES_SETTINGS_KEY = "minutes"

REMINDERS_FLAG = "action_item_reminders"
DAYS_BEFORE_KEY = "reminder_days_before_due"
OVERDUE_REPEAT_KEY = "overdue_repeat_days"
DIGEST_FLAG = "open_items_digest"
# Not a setting: the day the weekly digest last went out, kept here so the
# week is measured from what was sent rather than from a process that forgets
# its last run on every restart.
LAST_DIGEST_KEY = "last_open_items_digest_on"

PUBLIC_POSTING_FLAG = "public_posting"
EXECUTIVE_LIBRARY_FLAG = "executive_library_publishing"
EXECUTIVE_PUBLIC_FLAG = "executive_public_posting"

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


@dataclass(frozen=True)
class MinutesPublishingSettings:
    public_posting: bool
    executive_library: bool
    executive_public: bool

    def library_allowed(self, is_executive: bool) -> bool:
        """Whether minutes of this kind may be filed in the library."""
        return self.executive_library if is_executive else True

    def public_allowed(self, is_executive: bool) -> bool:
        """Whether minutes of this kind may be posted on the public page.

        Executive-session minutes need all three switches. The public one on its
        own does nothing: a copy that cannot be filed in the library cannot be
        published, so it cannot be posted either.
        """
        if not self.public_posting:
            return False
        if is_executive:
            return self.executive_library and self.executive_public
        return True


def minutes_publishing_settings_in(settings: Any) -> MinutesPublishingSettings:
    """Resolve the publishing switches; every one reads as off unless ``True``."""
    section = settings.get(MINUTES_SETTINGS_KEY) if isinstance(settings, dict) else None
    if not isinstance(section, dict):
        section = {}
    return MinutesPublishingSettings(
        public_posting=section.get(PUBLIC_POSTING_FLAG) is True,
        executive_library=section.get(EXECUTIVE_LIBRARY_FLAG) is True,
        executive_public=section.get(EXECUTIVE_PUBLIC_FLAG) is True,
    )


async def load_minutes_publishing_settings(
    db: AsyncSession, organization_id: str
) -> MinutesPublishingSettings:
    result = await db.execute(
        select(Organization.settings).where(Organization.id == str(organization_id))
    )
    return minutes_publishing_settings_in(result.scalar_one_or_none())


ATTENDANCE_LISTING_FLAG = "attendance_listing"


def attendance_listing_in(settings: Any) -> str:
    """The department's attendance listing; ``all`` unless set to a known value."""
    section = settings.get(MINUTES_SETTINGS_KEY) if isinstance(settings, dict) else None
    if not isinstance(section, dict):
        return DEFAULT_ATTENDANCE_LISTING
    return normalize_listing(section.get(ATTENDANCE_LISTING_FLAG))


async def load_attendance_listing(db: AsyncSession, organization_id: str) -> str:
    result = await db.execute(
        select(Organization.settings).where(Organization.id == str(organization_id))
    )
    return attendance_listing_in(result.scalar_one_or_none())


AUTO_FILE_ELECTIONS_FLAG = "auto_file_election_results"


def auto_file_election_results_in(settings: Any) -> bool:
    """On unless the department set it to a literal ``False``."""
    section = settings.get(MINUTES_SETTINGS_KEY) if isinstance(settings, dict) else None
    if not isinstance(section, dict):
        return True
    return section.get(AUTO_FILE_ELECTIONS_FLAG) is not False


async def load_auto_file_election_results(
    db: AsyncSession, organization_id: str
) -> bool:
    result = await db.execute(
        select(Organization.settings).where(Organization.id == str(organization_id))
    )
    return auto_file_election_results_in(result.scalar_one_or_none())
