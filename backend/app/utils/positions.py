"""Canonical form for the crew-seat lists stored in JSON columns.

``shifts.positions``, ``shift_templates.positions`` and
``basic_apparatus.positions`` are untyped JSON, and three writers filled them
three different ways: bare strings from onboarding and from the pre-2026-08
scheduling UI, ``{"position", "required"}`` objects from the current shift
template form, and — on ``shift_templates`` only — an event-metadata dict that
is not a seat list at all.

Readers cannot tell those apart without help, and one of them did not try: the
templates screen rendered each entry straight into a span, so a department with
a template saved by the current form got React error #31 instead of the page.
Writers settle the shape here so readers do not have to.
"""

from typing import Any, Dict, List


def normalize_stored_positions(positions: Any) -> Any:
    """Return a seat list as ``[{"position": str, "required": bool}]``.

    Anything that is not a list is returned untouched — an event template
    stores its resource metadata in this same column, and flattening that into
    seats would destroy the structure the event screens read.

    Entries with no usable position name are dropped: they cannot be assigned
    to and render blank, so they only inflate the staffing target.
    """
    if not isinstance(positions, list):
        return positions

    slots: List[Dict[str, Any]] = []
    for entry in positions:
        if isinstance(entry, str):
            name = entry.strip()
            if name:
                slots.append({"position": name, "required": True})
        elif isinstance(entry, dict):
            name = str(entry.get("position") or "").strip()
            if name:
                # Only an explicit False makes a seat optional, matching the
                # frontend's `required !== false`. A missing or null flag is a
                # required seat, which is what every legacy row means.
                slots.append(
                    {
                        "position": name,
                        "required": entry.get("required") is not False,
                    }
                )
    return slots
