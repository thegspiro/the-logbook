"""
Checklist requirement items.

A CHECKLIST training requirement carries the list of steps a member has to work
through. The column (``training_requirements.checklist_items``) is a plain JSON
array, and it originally held bare strings. It now holds objects so each step
can carry two things a bare string could not:

* a stable ``id``, so ticking a step survives the list being reordered or a
  neighbouring step being reworded, and
* ``member_visible``, so a department can keep some steps officer-only —
  "references called", "background check returned" — without hiding the whole
  requirement from the member it applies to.

Rows written before this change are plain strings, and there is no migration to
rewrite them: normalising on read is enough, costs no lock on a JSON column, and
means an older deployment reading newer data still sees something sensible.
Everything that touches the column goes through :func:`normalize_checklist_items`
so the rest of the codebase only ever sees one shape.

Legacy strings get positional ids (``item-0``, ``item-1``, …). Those are stable
until the list is edited, at which point the editor sends real ids back and the
row is stored in the new shape for good.
"""

from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple
from uuid import uuid4


def _coerce_item(raw: Any, index: int) -> Optional[Dict[str, Any]]:
    """One stored entry (legacy string or object) as a normalized item."""
    if isinstance(raw, str):
        text = raw.strip()
        return (
            {"id": f"item-{index}", "text": text, "member_visible": True}
            if text
            else None
        )

    if isinstance(raw, dict):
        text = str(raw.get("text") or "").strip()
        if not text:
            return None
        item_id = str(raw.get("id") or "").strip() or f"item-{index}"
        # Absent means visible: a step is shown to the member unless the
        # department deliberately marked it officer-only.
        visible = raw.get("member_visible")
        return {
            "id": item_id,
            "text": text,
            "member_visible": True if visible is None else bool(visible),
        }

    return None


def normalize_checklist_items(raw: Any) -> List[Dict[str, Any]]:
    """Stored ``checklist_items`` as a list of ``{id, text, member_visible}``.

    Accepts the legacy list-of-strings shape, the current list-of-objects shape,
    or a mix of the two. Blank entries are dropped, and duplicate ids are
    re-issued so a caller can always key progress off ``id``.
    """
    if not raw or not isinstance(raw, (list, tuple)):
        return []

    items: List[Dict[str, Any]] = []
    seen_ids: set = set()
    for index, entry in enumerate(raw):
        item = _coerce_item(entry, index)
        if item is None:
            continue
        if item["id"] in seen_ids:
            item = {**item, "id": f"{item['id']}-{uuid4().hex[:8]}"}
        seen_ids.add(item["id"])
        items.append(item)
    return items


def to_storage(value: Any) -> Optional[List[Dict[str, Any]]]:
    """Normalize a value on its way into the JSON column.

    Accepts what a schema hands over (``ChecklistItem`` models), what a sample
    template or an imported program declares (bare strings), and what an older
    client sends (dicts). ``None`` is preserved — "not supplied" and "no steps"
    are different, and only the former should leave the column alone.
    """
    if value is None:
        return None
    raw = [
        entry.model_dump() if hasattr(entry, "model_dump") else entry
        for entry in (value or [])
    ]
    return normalize_checklist_items(raw)


def member_visible_items(raw: Any) -> List[Dict[str, Any]]:
    """Only the steps the member is allowed to see."""
    return [item for item in normalize_checklist_items(raw) if item["member_visible"]]


def checklist_progress(
    raw: Any, done_ids: Optional[Iterable[str]] = None
) -> Tuple[int, int]:
    """``(completed, total)`` for a checklist requirement.

    Ticks are matched against the ids that currently exist, so a step deleted
    from the requirement stops counting toward the member's progress instead of
    leaving them permanently above the real total.

    Officer-only steps count toward both numbers: they are real work someone has
    to do, and excluding them would let a requirement read 100% complete while
    the background check was still outstanding.
    """
    items = normalize_checklist_items(raw)
    if not items:
        return 0, 0
    done = {str(i) for i in (done_ids or [])}
    return sum(1 for item in items if item["id"] in done), len(items)


def prune_done_ids(raw: Any, done_ids: Optional[Sequence[str]]) -> List[str]:
    """The submitted tick list narrowed to steps that actually exist, in list
    order. Guards against a stale client sending ids for deleted steps."""
    valid = {item["id"] for item in normalize_checklist_items(raw)}
    seen: set = set()
    pruned: List[str] = []
    for item_id in done_ids or []:
        key = str(item_id)
        if key in valid and key not in seen:
            seen.add(key)
            pruned.append(key)
    return pruned
