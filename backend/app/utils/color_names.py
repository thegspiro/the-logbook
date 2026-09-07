"""Canonical spelling for the free-text colour on an inventory item.

Colour is the one variant axis with no vocabulary, and it cannot have a fixed
one: a department stocks whatever its supplier sells, so an enum would block a
legitimate colour rather than catch a mistake. What it can have is one spelling
per colour.

Without that the two layers disagreed, which is the part that actually hurt.
The member-facing catalog collapses variants with ``(item.color or "")
.casefold()``, so "Navy" and "navy" were one variant with their stock summed.
The admin list filtered with a case-sensitive ``==``, so the quartermaster saw
two colours and could never see both at once — and the "All Colors" dropdown
offered both spellings as separate entries filtering disjoint sets.

So: normalize on write and fold new spellings into the one already in use. A
department that has been stocking "Navy" for a year and types "navy" today gets
"Navy", because the established spelling is the one already printed on labels
and read off shelves.
"""

from typing import Iterable, Optional

# Collapses runs of any whitespace, so "Dark  Navy" and "Dark\tNavy" are one
# colour rather than two that look identical in every UI that renders them.
_WHITESPACE = "\t\n\r\v\f "


def normalize_color(value: Optional[str]) -> Optional[str]:
    """Trim and collapse internal whitespace. Empty becomes ``None``.

    Case is deliberately left alone here — see :func:`canonical_color`. Title
    casing every colour would rewrite "OD Green" to "Od Green" and a supplier's
    "MultiCam" to "Multicam", which is worse than the inconsistency it fixes.
    """
    if value is None:
        return None
    collapsed = " ".join(str(value).split())
    return collapsed or None


def canonical_color(
    value: Optional[str], known: Iterable[Optional[str]]
) -> Optional[str]:
    """The spelling this colour should be stored under.

    Reuses an existing spelling from *known* when one matches case-insensitively,
    so a new entry folds into the department's established one instead of
    starting a second spelling of the same colour. Falls back to the caller's
    own spelling, which is what makes a genuinely new colour possible.
    """
    normalized = normalize_color(value)
    if normalized is None:
        return None
    folded = normalized.casefold()
    for candidate in known:
        existing = normalize_color(candidate)
        if existing is not None and existing.casefold() == folded:
            return existing
    return normalized
