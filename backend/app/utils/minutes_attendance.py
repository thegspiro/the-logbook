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

from typing import Any, Mapping, Optional

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
