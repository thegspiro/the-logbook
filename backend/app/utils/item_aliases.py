"""The canonical shape of an inventory item's "also called" names.

An item is called one thing on the ambulance and another by its manufacturer —
"BVM" for "Bag Valve Mask" — and the checklist matcher looks through these when
it proposes a catalog item. The column is untyped JSON, so the shape is settled
here, on every write path, rather than tolerated by every reader (CLAUDE.md
pitfall #20): ``None`` for no aliases, otherwise a list of trimmed, distinct,
non-empty strings.
"""

from typing import Iterable, List, Optional

from app.utils.name_matching import normalize_name

MAX_ALIASES = 10
MAX_ALIAS_LENGTH = 100


def normalize_aliases(
    values: Optional[Iterable[str]], item_name: Optional[str] = None
) -> Optional[List[str]]:
    """Trim, de-duplicate and bound a list of aliases.

    Two spellings that normalize alike ("BVM", "b.v.m.") are one alias, and so
    is an alias that is just the item's own name when ``item_name`` is given.
    Blank entries are dropped, so a form can send the box it has. Raises
    ``ValueError`` rather than truncating: silently losing the eleventh alias,
    or the end of a long one, would be a surprise nobody could see.
    """
    if values is None:
        return None

    seen = {normalize_name(item_name)} if item_name else set()
    cleaned: List[str] = []
    for raw in values:
        if not isinstance(raw, str):
            raise ValueError("Each alias must be text")
        alias = " ".join(raw.split())
        key = normalize_name(alias)
        if not key or key in seen:
            continue
        if len(alias) > MAX_ALIAS_LENGTH:
            raise ValueError(f"An alias can be at most {MAX_ALIAS_LENGTH} characters")
        seen.add(key)
        cleaned.append(alias)

    if len(cleaned) > MAX_ALIASES:
        raise ValueError(f"An item can have at most {MAX_ALIASES} alternate names")
    return cleaned or None
