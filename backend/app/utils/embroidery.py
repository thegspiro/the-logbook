"""Embroidery thread colors a store product can be personalized in.

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
