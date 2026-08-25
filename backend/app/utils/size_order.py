"""Canonical smallest-to-largest ordering for garment/equipment size labels.

A variant label is free text the quartermaster types, so the order rows come
back in is the order somebody happened to enter them — which is almost never
smallest-to-largest, because sizes get added to a product long after it is
created (a department stocks S/M/L, then adds XS and 3XL a season later, and
both land at the end). Sorting the labels alphabetically is worse, not better:
it produces L, M, S, XL, XS.

So a label is ranked by what it *means*. Three groups, in this order:

1. **Alpha sizes** — XS, S, M, L, XL, 2XL … including the spelled-out and
   abbreviated spellings vendors use interchangeably on the same catalog.
2. **Numeric sizes** — boot and waist sizes (``9``, ``10.5``, ``34x30``).
   Ranked after alpha sizes so a product mixing the two (a coat sold in both
   letter and chest sizes) still groups sensibly rather than interleaving.
3. **Unrecognized labels** — colors and anything else, held in the order the
   quartermaster entered them. A variant list is not always sizes: the column
   also carries "Navy" and "L / Navy", and inventing an order for those would
   scramble a deliberate one.

The length modifier (Tall/Short/Regular) sorts within its base size, so
S, M, MT, L, LT reads the way a size chart does.
"""

import re
from typing import Optional, Tuple

# Rank of each alpha size. Values are spaced so the numeric-extension rule
# below ("5XL" -> XL's rank plus 5) cannot collide with a neighbour.
_ALPHA_SIZES: dict[str, int] = {
    "XXXS": 10,
    "3XS": 10,
    "XXS": 20,
    "2XS": 20,
    "XS": 30,
    "XSMALL": 30,
    "EXTRASMALL": 30,
    "S": 40,
    "SM": 40,
    "SML": 40,
    "SMALL": 40,
    "M": 50,
    "MD": 50,
    "MED": 50,
    "MEDIUM": 50,
    "L": 60,
    "LG": 60,
    "LRG": 60,
    "LARGE": 60,
    "XL": 70,
    "XLARGE": 70,
    "EXTRALARGE": 70,
}

# Length modifiers sort inside their base size: Short, Regular, Tall.
_LENGTH_MODIFIERS: dict[str, int] = {
    "SHORT": -1,
    "S": -1,
    "REGULAR": 0,
    "REG": 0,
    "R": 0,
    "TALL": 1,
    "T": 1,
    "LONG": 1,
    "LT": 1,
}

_GROUP_ALPHA = 0
_GROUP_NUMERIC = 1
_GROUP_UNKNOWN = 2

# "2XL" / "XXL" / "3XL" — an XL with a repeat count.
_X_SIZE_RE = re.compile(r"^(?:(\d+)X|(X{2,}))(L|S)$")
# "34x30" (waist x inseam) or "10.5" or "9" — a numeric size. Case-insensitive
# because ``_normalize`` has already uppercased the separator to "X".
_NUMERIC_RE = re.compile(r"^(\d+(?:\.\d+)?)(?:[x×](\d+(?:\.\d+)?))?$", re.I)


def _normalize(label: str) -> str:
    """Strip spacing and separators so "X-Large" and "x large" both match.

    The decimal point survives on purpose: half sizes are real ("10.5" boots),
    and stripping it turned 10.5 into 105 — sorting it past every other size
    on the product rather than between 10 and 11.
    """
    return re.sub(r"[\s\-_]+", "", label).upper()


def _alpha_rank(token: str) -> Optional[int]:
    """Rank a single alpha size token, or None if it is not one."""
    # Dots are kept by ``_normalize`` for decimal sizes, so an abbreviated
    # spelling ("X.L.") needs them dropped before the lookup.
    token = token.replace(".", "") or token
    if token in _ALPHA_SIZES:
        return _ALPHA_SIZES[token]

    match = _X_SIZE_RE.match(token)
    if match:
        count = int(match.group(1)) if match.group(1) else len(match.group(2))
        base = match.group(3)
        # 2XL is one step past XL, 3XL two steps, and so on; the small end
        # runs the other way (2XS is one step below XS).
        if base == "L":
            return _ALPHA_SIZES["XL"] + (count - 1)
        return _ALPHA_SIZES["XS"] - (count - 1)

    return None


def size_sort_key(label: Optional[str], fallback: int = 0) -> Tuple[int, float, int]:
    """Sort key ordering *label* smallest-to-largest.

    ``fallback`` keeps unrecognized labels (and ties) in their entered order —
    pass the variant's index or existing ``sort_order``.
    """
    if not label or not label.strip():
        return (_GROUP_UNKNOWN, 0.0, fallback)

    # A compound label ("L / Navy") is sized by its first segment; the rest is
    # a color or fit that carries no size meaning.
    head = re.split(r"[/|,]", label.strip(), maxsplit=1)[0]
    token = _normalize(head)

    rank = _alpha_rank(token)
    if rank is not None:
        return (_GROUP_ALPHA, float(rank), fallback)

    # "MT" / "LT" / "M TALL" — a base size with a length modifier.
    for modifier, offset in _LENGTH_MODIFIERS.items():
        if len(token) > len(modifier) and token.endswith(modifier):
            base_rank = _alpha_rank(token[: -len(modifier)])
            if base_rank is not None:
                return (_GROUP_ALPHA, base_rank + offset * 0.1, fallback)

    match = _NUMERIC_RE.match(token)
    if match:
        primary = float(match.group(1))
        # A waist x inseam pair sorts by waist, then inseam.
        secondary = float(match.group(2)) if match.group(2) else 0.0
        return (_GROUP_NUMERIC, primary + secondary / 1000.0, fallback)

    return (_GROUP_UNKNOWN, 0.0, fallback)


def sort_by_size(items, label_getter):
    """Return *items* ordered smallest-to-largest by ``label_getter(item)``.

    Stable, so unrecognized labels keep their relative input order.
    """
    return [
        item
        for _, item in sorted(
            enumerate(items),
            key=lambda pair: size_sort_key(label_getter(pair[1]), pair[0]),
        )
    ]
