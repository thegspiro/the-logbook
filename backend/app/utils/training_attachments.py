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
