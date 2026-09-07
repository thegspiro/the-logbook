"""Garment style axes — ten values that describe one garment, not ten garments.

``GarmentStyle`` reads like a list of alternatives and is not one. Its ten
members are four *orthogonal* descriptors: how long the sleeve is, who the
garment is cut for, what the neckline is, and how it closes. "Men's long-sleeve
polo" is one shirt wearing three of them.

Variant generation did not know that. It took a plain cartesian product over the
flat list, so a quartermaster describing a single men's long-sleeve polo got
three separate pool items — one "Long Sleeve", one "Men's", one "Polo" — none of
which is the shirt they were holding. The product has to run *across* axes and
multiply only *within* one: one pick per axis is one item, while Men's + Women's
is genuinely two.

That distinction only exists here. ``inventory_items.style`` holds a single enum
value and cannot express a composite, which is why items also carry
``style_attributes`` — the full canonical list — with ``style`` kept as the
derived primary so every older reader keeps working.

Why the axes are a partition, and enforced as one: a style value that belongs to
no axis would silently drop out of the product, and one that belongs to two
would multiply against itself. ``assert_axes_cover_enum`` proves neither has
happened; ``tests/test_garment_style_axes.py`` calls it, and the frontend mirror
in ``modules/inventory/types/index.ts`` is held to the same list by
``garmentStyleAxisParity.test.ts``. Adding a style value therefore means adding
it to an axis here, not just to the enum.
"""

from typing import Dict, Iterable, List, Optional, Sequence, Tuple

# (axis key, human heading, values in display order).
#
# This tuple's order is the CANONICAL STORAGE ORDER for ``style_attributes`` and
# it matches the chip order already on the Add Item screen, so the picker did
# not have to be reshuffled to grow its headings.
#
# Closure is its own axis rather than a fifth neckline: a quarter-zip has a
# neckline too, so folding it in would have made "crew neck quarter zip" two
# items instead of one.
GARMENT_STYLE_AXES: Tuple[Tuple[str, str, Tuple[str, ...]], ...] = (
    ("sleeve", "Sleeve", ("short_sleeve", "long_sleeve")),
    ("fit", "Fit", ("mens", "womens", "unisex")),
    ("neckline", "Neckline", ("v_neck", "crew_neck", "polo", "button_down")),
    ("closure", "Closure", ("quarter_zip",)),
)

# Proper labels. ``value.replace("_", " ").title()`` — what the item namer used
# to do — yields "Mens" and "V Neck", which is how those two reached item names.
GARMENT_STYLE_LABELS: Dict[str, str] = {
    "short_sleeve": "Short Sleeve",
    "long_sleeve": "Long Sleeve",
    "mens": "Men's",
    "womens": "Women's",
    "unisex": "Unisex",
    "v_neck": "V-Neck",
    "crew_neck": "Crew Neck",
    "polo": "Polo",
    "button_down": "Button Down",
    "quarter_zip": "Quarter Zip",
}

# English puts the cut before the sleeve: "Men's Long Sleeve Polo", not "Long
# Sleeve Men's Polo". Storage order stays as declared above; this reorders only
# for display, which is why it is a separate constant rather than a re-sort.
NAME_AXIS_ORDER: Tuple[str, ...] = ("fit", "sleeve", "neckline", "closure")

# Which attribute stands in for the whole garment in the legacy single-value
# ``style`` column. A quartermaster calls it a polo before they call it a men's
# or a long-sleeve, so the most garment-defining axis wins.
PRIMARY_AXIS_ORDER: Tuple[str, ...] = ("neckline", "closure", "sleeve", "fit")

_AXIS_OF: Dict[str, str] = {
    value: key for key, _label, values in GARMENT_STYLE_AXES for value in values
}

_AXIS_KEYS: Tuple[str, ...] = tuple(key for key, _label, _values in GARMENT_STYLE_AXES)


# The axis a member can hold a standing preference about.
#
# Fit is a property of the *person*: someone who wears a women's cut wears it
# across every shirt the department stocks. Sleeve, neckline and closure are
# properties of the garment the department chose to buy — nobody has a
# cross-wardrobe preference for "polo" — so a member preference over those
# would be asking for something no stock decision can honour.
FIT_AXIS = "fit"

FIT_VALUES: Tuple[str, ...] = next(
    values for key, _label, values in GARMENT_STYLE_AXES if key == FIT_AXIS
)

# A fit that describes anybody. Preferred over a mismatched fit when the
# member's own is not stocked, and ranked behind their actual fit.
FIT_NEUTRAL = "unisex"


def axis_of(value: str) -> Optional[str]:
    """The axis a style value belongs to, or None if it is not a known style."""
    return _AXIS_OF.get(value)


def style_label(value: str) -> str:
    """Human label for one style value, falling back to a humanised slug."""
    return GARMENT_STYLE_LABELS.get(value) or value.replace("_", " ").title()


def normalize_style_attributes(
    values: Optional[Iterable[Optional[str]]],
) -> Optional[List[str]]:
    """Settle a style attribute list into its one canonical stored shape.

    Deduped, at most one value per axis, ordered by ``GARMENT_STYLE_AXES``.
    ``None`` entries are dropped, and an empty result becomes ``None`` so "no
    style" stays a NULL column rather than an empty list — the two would
    otherwise both exist and compare unequal (CLAUDE.md pitfall #20).

    Raises ``ValueError`` for an unknown value, or for two values from the same
    axis: "short sleeve AND long sleeve" is not a garment, and silently keeping
    one of them would store something the caller did not ask for.
    """
    if values is None:
        return None

    seen_by_axis: Dict[str, str] = {}
    for raw in values:
        if raw is None:
            continue
        value = raw.strip().lower() if isinstance(raw, str) else raw
        if not value:
            continue
        axis = _AXIS_OF.get(value)
        if axis is None:
            raise ValueError(f"Unknown garment style: {raw}")
        existing = seen_by_axis.get(axis)
        if existing is not None and existing != value:
            raise ValueError(
                f"Conflicting {axis} styles: {style_label(existing)} "
                f"and {style_label(value)}"
            )
        seen_by_axis[axis] = value

    ordered = [
        seen_by_axis[key] for key in _AXIS_KEYS if seen_by_axis.get(key) is not None
    ]
    return ordered or None


def first_conflicting_axis(values: Optional[Iterable[str]]) -> Optional[str]:
    """The name of the first axis given two different values, else None.

    Used at the request boundary so a caller posting "short sleeve AND long
    sleeve" gets a 422 naming the axis, rather than having one of the two
    silently dropped by the normalizer.
    """
    seen: Dict[str, str] = {}
    for raw in values or []:
        value = raw.strip().lower() if isinstance(raw, str) else raw
        axis = _AXIS_OF.get(value)
        if axis is None:
            continue
        if axis in seen and seen[axis] != value:
            return axis
        seen[axis] = value
    return None


def primary_style(attributes: Optional[Sequence[str]]) -> Optional[str]:
    """The single value stored in the legacy ``style`` column for a composite.

    ``["long_sleeve", "mens", "polo"]`` resolves to ``"polo"``.
    """
    if not attributes:
        return None
    by_axis = {_AXIS_OF[v]: v for v in attributes if v in _AXIS_OF}
    for key in PRIMARY_AXIS_ORDER:
        found = by_axis.get(key)
        if found is not None:
            return found
    return None


def format_style_attributes(attributes: Optional[Sequence[str]]) -> Optional[str]:
    """Render a composite as a human label: "Men's Long Sleeve Polo"."""
    if not attributes:
        return None
    by_axis = {_AXIS_OF[v]: v for v in attributes if v in _AXIS_OF}
    ordered = [by_axis[key] for key in NAME_AXIS_ORDER if key in by_axis]
    # An unrecognised value cannot be dropped from a label the user will read,
    # so it trails the ones that did place.
    ordered += [v for v in attributes if v not in _AXIS_OF]
    return " ".join(style_label(v) for v in ordered) or None


def style_combinations(
    selected: Optional[Iterable[str]],
) -> List[Optional[List[str]]]:
    """Expand picked style chips into one canonical attribute list per item.

    The product runs across axes and multiplies only within one, so picking
    Long Sleeve + Men's + Polo yields a single combination while adding Women's
    yields two. Returns ``[None]`` when nothing was picked, so callers can loop
    over it uniformly and get exactly one style-less item.
    """
    values = [v for v in (selected or []) if v]
    unknown = [v for v in values if v not in _AXIS_OF]
    if unknown:
        raise ValueError(f"Unknown garment style: {unknown[0]}")

    combos: List[Optional[List[str]]] = [None]
    for key, _label, axis_values in GARMENT_STYLE_AXES:
        picked = [v for v in axis_values if v in values]
        if not picked:
            continue
        combos = [((base or []) + [value]) for base in combos for value in picked]
    # Each branch appended in axis order, so the lists are already canonical;
    # normalizing anyway keeps this function's output and the write-side
    # authority provably identical rather than merely intended to be.
    return [normalize_style_attributes(c) for c in combos]


def fit_of(attributes: Optional[Sequence[str]]) -> Optional[str]:
    """The fit a garment is cut for, or None when it is fit-agnostic."""
    for value in attributes or []:
        if _AXIS_OF.get(value) == FIT_AXIS:
            return value
    return None


def assert_axes_cover_enum() -> None:
    """Prove the axes are a partition of ``GarmentStyle``.

    Imported lazily: this module is a leaf that models and schemas may import,
    and reaching back into ``app.models`` at import time would make that a
    cycle. Called from the test suite, which is where the ratchet belongs.
    """
    from app.models.inventory import GarmentStyle

    enum_values = {member.value for member in GarmentStyle}
    axis_values: List[str] = [
        v for _k, _l, values in GARMENT_STYLE_AXES for v in values
    ]

    duplicates = {v for v in axis_values if axis_values.count(v) > 1}
    if duplicates:
        raise AssertionError(
            f"Style values in more than one axis: {sorted(duplicates)}"
        )

    unassigned = enum_values - set(axis_values)
    if unassigned:
        raise AssertionError(
            f"GarmentStyle values missing from GARMENT_STYLE_AXES: {sorted(unassigned)}"
        )

    unknown = set(axis_values) - enum_values
    if unknown:
        raise AssertionError(
            f"GARMENT_STYLE_AXES values missing from GarmentStyle: {sorted(unknown)}"
        )

    missing_labels = set(axis_values) - set(GARMENT_STYLE_LABELS)
    if missing_labels:
        raise AssertionError(f"Style values without a label: {sorted(missing_labels)}")
