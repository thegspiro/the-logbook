"""Canonical shape of a meeting-minutes attendee entry.

``meeting_minutes.attendees`` is an untyped JSON list that three writers have
filled three ways: ``{name, present}`` from the minutes form,
``{user_id, name, present, excused}`` from the meetings bridge, and free-text
guests with no ``user_id``. Quorum reads ``present``; the screens read whatever
they were written against. CLAUDE.md pitfall #20 applies, so there is one
stored shape, settled on every write path:

    {"user_id": str | None, "name": str, "role": str | None,
     "status": <ATTENDANCE_STATUSES>, "present": bool, "note": str | None}

``status`` is the record; ``present`` is derived from it and kept only because
older readers consume it. ``present`` is true exactly when the member was in
the room: present, late, or left early. Until 2026-11-05 that was also the
quorum rule; who counts toward quorum is now the department's choice
(``app.utils.minutes_settings.quorum_counting_in``), so ``present`` no longer
answers that question and quorum reads ``status``. A guest is not a member and
never counts. The migration that settled the existing rows inlines its own copy
of this mapping, so this module is free to change.
"""

from typing import Any, Mapping, Optional, Sequence

ATTENDANCE_STATUSES = (
    "present",
    "late",
    "left_early",
    "excused",
    "absent",
    "guest",
    # A member who was not in the room but was represented by a proxy holder.
    # Only offered on the roll call when the department uses proxies; stored
    # JSON, so adding it needed no migration.
    "proxy",
)

# Members who were in the room for the meeting: the stored ``present`` flag,
# who may vote in a roll call, and the "majority of members present" threshold.
IN_THE_ROOM = frozenset({"present", "late", "left_early"})

# Who counts toward quorum when the department has not chosen: everyone in the
# room, as before the setting existed. Quorum is a head-count of members, so
# ``guest`` never counts; ``proxy`` counts only where the department uses them.
COUNTS_TOWARD_QUORUM = IN_THE_ROOM

# What a department created from now on lists on its minutes (owner decision
# 2026-11-01). Written into the new department's settings at creation rather
# than made the reading of an absent value, so an existing department that
# never chose keeps ``DEFAULT_ATTENDANCE_LISTING`` across an upgrade.
NEW_DEPARTMENT_ATTENDANCE_LISTING = "present"


def quorum_statuses(
    *, late: bool = True, left_early: bool = True, proxies: bool = False
) -> frozenset[str]:
    """The statuses counted toward quorum under a department's choices."""
    counted = {"present"}
    if late:
        counted.add("late")
    if left_early:
        counted.add("left_early")
    if proxies:
        counted.add("proxy")
    return frozenset(counted)


def derive_status(entry: Mapping[str, Any]) -> str:
    """The attendance status of a stored or incoming entry.

    An entry that predates ``status`` carries only ``present`` (and, from the
    meetings bridge, ``excused``). A legacy free-text guest was stored as
    present and counted toward quorum, so it stays "present" rather than
    being guessed into "guest" and silently changing a recorded quorum.
    """
    status = entry.get("status")
    if status in ATTENDANCE_STATUSES:
        return str(status)
    if entry.get("present", True):
        return "present"
    return "excused" if entry.get("excused") else "absent"


def counts_toward_quorum(
    entry: Mapping[str, Any], counted: frozenset[str] = COUNTS_TOWARD_QUORUM
) -> bool:
    """Whether this entry is part of the quorum head-count under *counted*.

    ``QuorumService.calculate_quorum`` passes the department's rule; nothing
    else computes quorum.
    """
    return derive_status(entry) in counted


def in_the_room(entry: Mapping[str, Any]) -> bool:
    """Whether this member was at the meeting in person (not a proxy, not a guest)."""
    return derive_status(entry) in IN_THE_ROOM


def normalize_attendee(entry: Mapping[str, Any]) -> dict[str, Optional[Any]]:
    """The canonical dict for one attendee, whatever shape came in."""
    status = derive_status(entry)
    return {
        "user_id": entry.get("user_id") or None,
        "name": entry.get("name") or "Unknown",
        "role": entry.get("role") or None,
        "status": status,
        "present": status in IN_THE_ROOM,
        "note": entry.get("note") or None,
    }


def normalize_attendees(
    entries: Optional[list[Mapping[str, Any]]],
) -> Optional[list[dict[str, Optional[Any]]]]:
    """Normalize a whole list; ``None`` stays ``None`` (no roll was taken)."""
    if entries is None:
        return None
    return [normalize_attendee(e) for e in entries if isinstance(e, Mapping)]


# Which statuses the minutes name, as the department chose. Quorum and the
# attendance reports always read the whole roll; this is only what a reader of
# the minutes sees. A guest was in the room, so every choice lists guests; a
# proxy may have made the quorum, so every choice names who was represented.
ATTENDANCE_LISTINGS = ("all", "present_excused", "present")
DEFAULT_ATTENDANCE_LISTING = "all"

_LISTED_STATUSES = {
    "present": frozenset({"present", "late", "left_early", "guest", "proxy"}),
    "present_excused": frozenset(
        {"present", "late", "left_early", "guest", "proxy", "excused"}
    ),
    "all": frozenset(ATTENDANCE_STATUSES),
}


def normalize_listing(value: Any, default: str = DEFAULT_ATTENDANCE_LISTING) -> str:
    """A known listing, or *default* for anything else (never raises)."""
    return value if isinstance(value, str) and value in _LISTED_STATUSES else default


def effective_listing(override: Any, department: Any) -> str:
    """The listing in force: the minutes' own choice, else the department's."""
    if isinstance(override, str) and override in _LISTED_STATUSES:
        return override
    return normalize_listing(department)


def is_listed(status: str, listing: str) -> bool:
    """Whether a roll-call status is named under this listing."""
    return status in _LISTED_STATUSES[normalize_listing(listing)]


def listed_attendees(
    entries: Optional[Sequence[Mapping[str, Any]]], listing: str
) -> list[Mapping[str, Any]]:
    """The entries a reader of the minutes is shown under *listing*."""
    return [
        e
        for e in (entries or [])
        if isinstance(e, Mapping) and is_listed(derive_status(e), listing)
    ]
