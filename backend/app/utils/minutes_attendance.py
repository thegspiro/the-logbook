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
quorum and older readers consume it. ``present`` is true exactly when the
member counted toward a quorum: present, late, or left early. A guest is not a
member and never counts. The migration that settled the existing rows inlines
its own copy of this mapping, so this module is free to change.
"""

from typing import Any, Mapping, Optional, Sequence

ATTENDANCE_STATUSES = (
    "present",
    "late",
    "left_early",
    "excused",
    "absent",
    "guest",
)

# Members who were in the room for the meeting. Quorum is a head-count of
# members, so ``guest`` is deliberately absent; whether a department's bylaws
# count a member who left early is not something this code decides — it counts
# them, as the roll call recorded them present.
COUNTS_TOWARD_QUORUM = frozenset({"present", "late", "left_early"})


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


def counts_toward_quorum(entry: Mapping[str, Any]) -> bool:
    """Whether this entry is part of the quorum head-count."""
    return derive_status(entry) in COUNTS_TOWARD_QUORUM


def normalize_attendee(entry: Mapping[str, Any]) -> dict[str, Optional[Any]]:
    """The canonical dict for one attendee, whatever shape came in."""
    status = derive_status(entry)
    return {
        "user_id": entry.get("user_id") or None,
        "name": entry.get("name") or "Unknown",
        "role": entry.get("role") or None,
        "status": status,
        "present": status in COUNTS_TOWARD_QUORUM,
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
# the minutes sees. A guest was in the room, so every choice lists guests.
ATTENDANCE_LISTINGS = ("all", "present_excused", "present")
DEFAULT_ATTENDANCE_LISTING = "all"

_LISTED_STATUSES = {
    "present": frozenset({"present", "late", "left_early", "guest"}),
    "present_excused": frozenset({"present", "late", "left_early", "guest", "excused"}),
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
