"""How a store product is personalized, and in what thread.

Personalization is not one process. A cloth item — job shirt, polo, ball cap —
is **embroidered**, and the thread has a colour the department orders and the
vendor stitches. A metal item — challenge coin, badge, plaque, flask — is
**engraved**, cut into the surface, and there is no thread at all. Naming the
method per product is what keeps a vendor sheet from telling an engraver to use
gold thread on a coin.

Thread colour therefore belongs to embroidery alone. ``PersonalizationMethod``
decides which of the two a product uses, and every reader — the member's
preview, the order line, the vendor purchase order, the CSV export — asks it
before mentioning thread.

The member's preview on the storefront renders their name in the thread the
department actually orders, so the color is a property of the *product* set by
the quartermaster — not a member choice. A department that embroiders its job
shirts in white and its polos in gold needs both, and the preview lying about
either is worse than showing no preview at all.

The palette is closed rather than free text for two reasons: the preview has to
resolve a real color to render, and the value lands on the vendor purchase
order, where "gold" is orderable and "goldish" is a phone call.

``hex`` is served to the client so the swatch and the preview render from one
source of truth. Values are chosen to read as thread rather than as screen
color — embroidery gold is a dull antique, not yellow.
"""

from enum import Enum
from typing import Dict, List, Optional


class PersonalizationMethod(str, Enum):
    """How a product's personalization is applied to the goods."""

    #: Stitched into cloth — carries a thread colour.
    EMBROIDERY = "embroidery"
    #: Cut into metal — no thread involved.
    ENGRAVING = "engraving"


#: Products that predate the setting were all treated as embroidery (the
#: preview stitched every name in gold), so that is what NULL means.
DEFAULT_PERSONALIZATION_METHOD = PersonalizationMethod.EMBROIDERY

_METHOD_LABELS: Dict[PersonalizationMethod, Dict[str, str]] = {
    PersonalizationMethod.EMBROIDERY: {
        "label": "Embroidered",
        # Shown beside the choice so the quartermaster picks by the goods in
        # front of them rather than by guessing what the words imply.
        "hint": "Stitched into cloth — shirts, polos, caps",
        # Default prompt the member sees when the product names none.
        "prompt": "Add name embroidery",
        "verb": "Embroidered",
    },
    PersonalizationMethod.ENGRAVING: {
        "label": "Engraved",
        "hint": "Cut into metal — coins, badges, plaques",
        "prompt": "Add name engraving",
        "verb": "Engraved",
    },
}


def normalize_personalization_method(value: Optional[str]) -> PersonalizationMethod:
    """Resolve a stored/incoming value to a supported method.

    Falls back rather than raising, for the same reason
    ``normalize_thread_color`` does: this is read on every storefront render,
    and an unrecognized value should cost a word in a label, not the page.
    """
    if not value:
        return DEFAULT_PERSONALIZATION_METHOD
    if isinstance(value, PersonalizationMethod):
        return value
    raw = value.value if isinstance(value, Enum) else value
    try:
        return PersonalizationMethod(str(raw).strip().lower())
    except ValueError:
        return DEFAULT_PERSONALIZATION_METHOD


def uses_thread_color(value: Optional[str]) -> bool:
    """True when the method involves thread — i.e. embroidery.

    The single place that decides whether a thread colour is meaningful, so a
    new method cannot quietly inherit one.
    """
    return normalize_personalization_method(value) is PersonalizationMethod.EMBROIDERY


def personalization_verb(value: Optional[str]) -> str:
    """ "Embroidered" / "Engraved" — for a line describing finished goods."""
    return _METHOD_LABELS[normalize_personalization_method(value)]["verb"]


def personalization_prompt(value: Optional[str]) -> str:
    """The default prompt shown to a member when the product names none."""
    return _METHOD_LABELS[normalize_personalization_method(value)]["prompt"]


def personalization_methods() -> List[Dict[str, str]]:
    """The methods, in the order they should be offered."""
    return [
        {
            "value": method.value,
            "label": meta["label"],
            "hint": meta["hint"],
            "prompt": meta["prompt"],
        }
        for method, meta in _METHOD_LABELS.items()
    ]


class EmbroideryThreadColor(str, Enum):
    """Thread colors offered for personalized store products."""

    GOLD = "gold"
    WHITE = "white"
    BLACK = "black"
    SILVER = "silver"
    NAVY = "navy"
    ROYAL_BLUE = "royal_blue"
    RED = "red"
    MAROON = "maroon"
    FOREST_GREEN = "forest_green"
    ORANGE = "orange"


# The color used when a product predates the setting or leaves it unset.
# Gold is the historical hardcoded value, so an existing catalog keeps looking
# exactly as it did before the setting existed.
DEFAULT_THREAD_COLOR = EmbroideryThreadColor.GOLD

_THREAD_COLORS: Dict[EmbroideryThreadColor, Dict[str, str]] = {
    EmbroideryThreadColor.GOLD: {"label": "Gold", "hex": "#c8a02c"},
    EmbroideryThreadColor.WHITE: {"label": "White", "hex": "#f5f5f4"},
    EmbroideryThreadColor.BLACK: {"label": "Black", "hex": "#1c1917"},
    EmbroideryThreadColor.SILVER: {"label": "Silver", "hex": "#c0c4c8"},
    EmbroideryThreadColor.NAVY: {"label": "Navy", "hex": "#1e3a5f"},
    EmbroideryThreadColor.ROYAL_BLUE: {"label": "Royal Blue", "hex": "#2456a6"},
    EmbroideryThreadColor.RED: {"label": "Red", "hex": "#b02020"},
    EmbroideryThreadColor.MAROON: {"label": "Maroon", "hex": "#6d1f2c"},
    EmbroideryThreadColor.FOREST_GREEN: {"label": "Forest Green", "hex": "#1f4d2e"},
    EmbroideryThreadColor.ORANGE: {"label": "Orange", "hex": "#c2570f"},
}


# Derived, never retyped: the schema defaults reference this, and a second
# literal would drift the moment the palette is retuned.
DEFAULT_THREAD_COLOR_HEX = _THREAD_COLORS[DEFAULT_THREAD_COLOR]["hex"]


def normalize_thread_color(value: Optional[str]) -> EmbroideryThreadColor:
    """Resolve a stored/incoming value to a supported color.

    Falls back to the default rather than raising: this is read on every
    storefront render, and an unrecognized value (a hand-edited row, a color
    retired from the palette) should cost a shade of thread in a preview, not
    the whole store page.
    """
    if not value:
        return DEFAULT_THREAD_COLOR
    if isinstance(value, EmbroideryThreadColor):
        return value
    # ``str()`` on a (str, Enum) member yields "EmbroideryThreadColor.WHITE",
    # not "white" — Enum.__str__ wins over str's. Reading ``.value`` first is
    # what keeps a re-normalized enum from falling through to the default.
    raw = value.value if isinstance(value, Enum) else value
    try:
        return EmbroideryThreadColor(str(raw).strip().lower())
    except ValueError:
        return DEFAULT_THREAD_COLOR


def thread_color_hex(value: Optional[str]) -> str:
    """The hex the preview and swatch render in."""
    return _THREAD_COLORS[normalize_thread_color(value)]["hex"]


def thread_color_label(value: Optional[str]) -> str:
    """Human-readable name, as it should appear on a vendor purchase order."""
    return _THREAD_COLORS[normalize_thread_color(value)]["label"]


def thread_color_palette() -> List[Dict[str, str]]:
    """The full palette, in the order it should be offered."""
    return [
        {"value": color.value, "label": meta["label"], "hex": meta["hex"]}
        for color, meta in _THREAD_COLORS.items()
    ]
