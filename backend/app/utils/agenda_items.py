"""A meeting's agenda as structured items, and the minutes sections they become.

``meetings.agenda_items`` is untyped JSON, so it gets one canonical stored
shape settled at the write (CLAUDE.md pitfall #20)::

    {"key": str, "title": str, "presenter": str, "notes": str,
     "needs_motion": bool, "motion_text": str,
     "documents": [{"id": str, "name": str}]}

``key`` is the item's identity across edits. A minutes section made from an item
is named ``agenda-<key>``, which is what lets a later "sync from agenda" tell a
renamed item from a removed one and a new one.

The free-text ``meetings.agenda`` is untouched: departments that never adopt the
editor keep exactly what they had, and it is what the legacy screens still read.
"""

import re
from typing import Any, Dict, List, Optional

MAX_AGENDA_ITEMS = 60
MAX_ITEM_DOCUMENTS = 10
MAX_TITLE = 200
MAX_PRESENTER = 200
MAX_NOTES = 2000
MAX_MOTION_TEXT = 2000

AGENDA_SECTION_PREFIX = "agenda-"
_KEY_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]{0,49}$")


def agenda_section_key(item_key: str) -> str:
    """The minutes section key an agenda item's section carries."""
    return f"{AGENDA_SECTION_PREFIX}{item_key}"


def is_valid_item_key(value: Any) -> bool:
    return isinstance(value, str) and bool(_KEY_PATTERN.match(value))


def _text(value: Any, limit: int) -> str:
    return value.strip()[:limit] if isinstance(value, str) else ""


def _documents(value: Any) -> List[Dict[str, str]]:
    documents: List[Dict[str, str]] = []
    seen = set()
    for entry in value if isinstance(value, list) else []:
        if not isinstance(entry, dict):
            continue
        doc_id = entry.get("id")
        if not isinstance(doc_id, str) or not doc_id or doc_id in seen:
            continue
        seen.add(doc_id)
        documents.append({"id": doc_id, "name": _text(entry.get("name"), 255)})
        if len(documents) >= MAX_ITEM_DOCUMENTS:
            break
    return documents


def normalize_agenda_items(raw: Any) -> List[Dict[str, Any]]:
    """The agenda items in *raw*, in the canonical shape.

    Defensive on purpose (pitfall #19): the column is unvalidated JSON, and an
    exception here would take down meeting creation or minutes drafting for the
    whole organization. An entry that is not a dict, has no usable title, or
    repeats an earlier key is dropped rather than raised on.
    """
    items: List[Dict[str, Any]] = []
    seen = set()
    for entry in raw if isinstance(raw, list) else []:
        if not isinstance(entry, dict):
            continue
        key = entry.get("key")
        title = _text(entry.get("title"), MAX_TITLE)
        if not is_valid_item_key(key) or not title or key in seen:
            continue
        seen.add(key)
        items.append(
            {
                "key": key,
                "title": title,
                "presenter": _text(entry.get("presenter"), MAX_PRESENTER),
                "notes": _text(entry.get("notes"), MAX_NOTES),
                "needs_motion": bool(entry.get("needs_motion", False)),
                "motion_text": _text(entry.get("motion_text"), MAX_MOTION_TEXT),
                "documents": _documents(entry.get("documents")),
            }
        )
        if len(items) >= MAX_AGENDA_ITEMS:
            break
    return items


def section_from_item(item: Dict[str, Any], order: int) -> Dict[str, Any]:
    """The minutes section an agenda item becomes.

    An item's notes are the secretary's starting text, so the section opens with
    them rather than blank. ``agenda_key`` marks the section as agenda-born,
    which is how sync knows which sections it may touch.
    """
    section: Dict[str, Any] = {
        "order": order,
        "key": agenda_section_key(item["key"]),
        "title": item["title"],
        "content": item.get("notes", ""),
        "format": "text",
        "required": False,
        "needs_motion": bool(item.get("needs_motion", False)),
        "motion_text": item.get("motion_text", ""),
        "agenda_key": item["key"],
    }
    if item.get("presenter"):
        section["presenter"] = item["presenter"]
    if item.get("documents"):
        section["documents"] = [dict(d) for d in item["documents"]]
    return section


def sections_from_agenda(items: Any) -> List[Dict[str, Any]]:
    """Minutes sections, in agenda order, for every item in *items*."""
    return [
        section_from_item(item, index)
        for index, item in enumerate(normalize_agenda_items(items))
    ]


def agenda_item_key_of(section: Dict[str, Any]) -> Optional[str]:
    """The agenda item a section was made from, or None for any other section."""
    key = section.get("agenda_key")
    return key if isinstance(key, str) and key else None
