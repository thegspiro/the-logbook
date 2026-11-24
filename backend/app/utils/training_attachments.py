"""Stable identity for the attachment entries on training submissions and records.

Each entry in ``training_submissions.attachments`` and
``training_records.attachments`` carries an ``id``: a ``str(uuid4())`` written
when the entry is created and kept for as long as the entry exists. An index
moves when an earlier entry is removed, so a removal addressed by index is not
safe to repeat (CLAUDE.md pitfall #36): a retry after a lost 204 removed
whichever entry had moved into that slot, and its file. An id cannot move.

This module is the write-side authority for the id (pitfall #20); migration
``…_training_attachment_entry_ids`` keeps its own frozen copy of the stamping
rule for the rows that predate it.

The routes accept either form in one path segment. A string of digits is a
legacy index; anything else is an id. ``str(uuid4())`` always contains
hyphens, so the two never collide — which is also why the id is not the
``uuid4().hex`` the event attachments use: 32 hex characters can, rarely, all
be digits.
"""

import copy
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Optional

from app.core.utils import generate_uuid

_INDEX = re.compile(r"\d+")


class EntryMoved(Exception):
    """A legacy index no longer names the entry the client expected."""


@dataclass(frozen=True)
class EntryRef:
    """What a route's ``{entry}`` segment names: an index or an id."""

    index: Optional[int] = None
    entry_id: Optional[str] = None


def new_entry_id() -> str:
    return generate_uuid()


def with_entry_ids(attachments: Any) -> Any:
    """A deep copy of ``attachments`` with an id on every dict entry.

    Existing ids are kept, so a record copied from a submission keeps each
    entry's id: the record's entry and the submission's are the same upload.
    The copy also stops the record and the submission sharing one Python list.
    Anything that is not a list is returned unchanged.
    """
    if not isinstance(attachments, list):
        return attachments
    stamped: list[Any] = []
    for entry in attachments:
        entry = copy.deepcopy(entry)
        if isinstance(entry, dict) and not isinstance(entry.get("id"), str):
            entry["id"] = new_entry_id()
        stamped.append(entry)
    return stamped


def parse_entry_ref(entry: str) -> EntryRef:
    if _INDEX.fullmatch(entry):
        return EntryRef(index=int(entry))
    return EntryRef(entry_id=entry)


def find_entry(attachments: Any, entry_id: str) -> Optional[tuple[int, Any]]:
    for index, entry in enumerate(attachments or []):
        if isinstance(entry, dict) and entry.get("id") == entry_id:
            return index, entry
    return None


def resolve_entry(
    attachments: Any, entry: str, expected_id: Optional[str] = None
) -> Optional[tuple[int, Any]]:
    """The ``(index, entry)`` a route's ``{entry}`` segment names, or None.

    An id that is not present resolves to None. A legacy index out of range
    resolves to None; one whose entry does not carry ``expected_id``, when the
    client sent one, raises :class:`EntryMoved` so the route can answer 409
    instead of acting on a different entry.
    """
    ref = parse_entry_ref(entry)
    if ref.index is None:
        return find_entry(attachments, entry)
    items = list(attachments or [])
    if ref.index >= len(items):
        return None
    found = items[ref.index]
    if expected_id is not None:
        current = found.get("id") if isinstance(found, dict) else None
        if current != expected_id:
            raise EntryMoved(entry)
    return ref.index, found


# --- removal markers ---------------------------------------------------------
#
# Owner decision 2026-11-23: when a stored file is deleted by the department's
# certificate retention, or by the malware rescan, its entry is replaced by a
# marker rather than dropped, so the member and the officers can see that a
# file was there and why it is gone. A marker keeps the entry's id and name and
# never a file_path: every reader that looks for a stored file finds none, the
# same way it treats a path-less entry, so collect_references, the downloads,
# the shared-file check and anonymisation need no special case beyond what
# they do for those. The JSON column has no schema, so no migration.

REMOVED_RETENTION = "retention"
REMOVED_MALWARE = "malware"
REMOVAL_REASONS = (REMOVED_RETENTION, REMOVED_MALWARE)


def removal_marker(entry: Any, reason: str, removed_at: datetime) -> dict:
    """The marker that replaces *entry* once its file is deleted for *reason*.

    Keeps the entry's id (routes address it) and its name; drops the path,
    size and type, which described a file that no longer exists.
    """
    if reason not in REMOVAL_REASONS:
        raise ValueError(f"Unknown removal reason: {reason}")
    marker: dict[str, Any] = {
        "removed_at": removed_at.isoformat(),
        "removed_reason": reason,
    }
    if isinstance(entry, dict):
        if entry.get("id"):
            marker["id"] = entry["id"]
        if entry.get("file_name"):
            marker["file_name"] = entry["file_name"]
    elif isinstance(entry, str) and entry:
        marker["file_name"] = entry
    return marker


def is_removal_marker(entry: Any) -> bool:
    return (
        isinstance(entry, dict)
        and entry.get("removed_reason") in REMOVAL_REASONS
        and not entry.get("file_path")
    )


#: What a download of a marker answers (410 Gone): the file existed and was
#: removed on purpose, which a 404 would hide.
REMOVED_DOWNLOAD_DETAIL = {
    REMOVED_RETENTION: (
        "This certificate file was removed under the department's retention " "policy."
    ),
    REMOVED_MALWARE: (
        "This certificate file was removed because the malware scan found it "
        "infected."
    ),
}


def removal_notices(attachments: Any) -> list[dict[str, Any]]:
    """``{"removed_at", "removed_reason"}`` for each marker in *attachments*,
    for a screen that shows why a certificate is no longer there. Nothing
    else about the entry, and never a path."""
    if not isinstance(attachments, list):
        return []
    return [
        {
            "removed_at": entry.get("removed_at"),
            "removed_reason": entry.get("removed_reason"),
        }
        for entry in attachments
        if is_removal_marker(entry)
    ]
