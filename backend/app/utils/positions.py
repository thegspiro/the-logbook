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

The seat *name* is settled here for the same reason. The apparatus editor wrote
the EMT seat as ``"EMT"`` while every other writer used ``"ems"``, and because
``POSITION_LABELS`` renders ``EMT``/``EMS``/``ems`` identically, the two looked
like one seat on screen and were two different tokens in the database. Nothing
grants ``"EMT"`` — not a rank, a held position, or a completed program — and
``ShiftPosition`` has no such member, so the API could not even name that seat.
An ambulance built from the defaults therefore had an EMT seat no EMT could
sign up for, and no setting could unblock it (see CHANGELOG 2026-08-26).
"""

from typing import Any, Dict, List

# The seat vocabulary the rest of the system speaks: ``ShiftPosition`` on the
# wire, ``operational_ranks.eligible_positions`` in config, and the rank
# editor's own button list. ``tests/test_position_slots.py`` asserts this set
# against ShiftPosition so the two cannot drift apart again.
CANONICAL_POSITIONS = frozenset(
    {
        "officer",
        "driver",
        "firefighter",
        "ems",
        "paramedic",
        "captain",
        "lieutenant",
        "probationary",
        "volunteer",
        "other",
    }
)

# Spellings that mean a canonical seat but are not one. Keyed casefolded.
_POSITION_ALIASES = {"emt": "ems"}


def canonical_position(name: str) -> str:
    """Settle one seat name onto the vocabulary the signup API speaks.

    A known seat is case-folded and de-aliased, so ``"EMT"``, ``"EMS"`` and
    ``" ems "`` all become ``"ems"``. Anything else is a department's own
    custom position and is returned trimmed but otherwise verbatim — its value
    is chosen by an admin and has to round-trip exactly, so case-folding it
    would rename their seat.
    """
    cleaned = name.strip()
    if not cleaned:
        return ""
    folded = cleaned.casefold()
    if folded in _POSITION_ALIASES:
        return _POSITION_ALIASES[folded]
    if folded in CANONICAL_POSITIONS:
        return folded
    return cleaned


# What each canonical seat is called on screen and in print. Mirrors
# POSITION_LABELS in frontend/src/constants/enums.ts: the "ems" seat is the one
# that matters here, because the department calls it EMT everywhere it is
# chosen and a printed roster or a reminder email that says "EMS" reads as a
# different seat rather than the same one spelled another way.
POSITION_LABELS = {
    "officer": "Officer",
    "driver": "Driver/Operator",
    "firefighter": "Firefighter",
    "ems": "EMT",
    "paramedic": "Paramedic",
    "captain": "Captain",
    "lieutenant": "Lieutenant",
    "probationary": "Probationary",
    "volunteer": "Volunteer",
    "other": "Other",
}


def position_label(name: Any) -> str:
    """The display name for one seat token.

    A department's own custom seat is not in the label map — its value is
    chosen by an admin — so it is returned title-cased rather than blank.
    """
    token = str(getattr(name, "value", name) or "").strip()
    if not token:
        return ""
    canonical = canonical_position(token)
    label = POSITION_LABELS.get(canonical)
    if label:
        return label
    return canonical.replace("_", " ").title()


def normalize_stored_positions(positions: Any) -> Any:
    """Return a seat list in the canonical structured form.

    Anything that is not a list is returned untouched — an event template
    stores its resource metadata in this same column, and flattening that into
    seats would destroy the structure the event screens read.

    Entries with no usable position name are dropped: they cannot be assigned
    to and render blank, so they only inflate the staffing target.

    A ``count`` — the shape ShiftTemplate.positions documents, though nothing
    in the app has ever written one — expands into that many seats. One slot
    per seat is what every reader counts, so collapsing a count would quietly
    cut a three-firefighter template down to one.
    """
    if not isinstance(positions, list):
        return positions

    slots: List[Dict[str, Any]] = []
    for entry in positions:
        if isinstance(entry, str):
            name = canonical_position(entry)
            if name:
                slots.append(
                    {
                        "position": name,
                        "required": True,
                        "allow_administrative_members": False,
                    }
                )
        elif isinstance(entry, dict):
            name = canonical_position(str(entry.get("position") or ""))
            if name:
                # Only an explicit False makes a seat optional, matching the
                # frontend's `required !== false`. A missing or null flag is a
                # required seat, which is what every legacy row means.
                slot = {
                    "position": name,
                    "required": entry.get("required") is not False,
                    "allow_administrative_members": entry.get(
                        "allow_administrative_members"
                    )
                    is True,
                }
                for _ in range(_seat_count(entry.get("count"))):
                    slots.append(dict(slot))
    return slots


# A seat list this long is corrupt data, not a staffing plan; min_staffing caps
# at 50, so expanding past that would only be a way to exhaust memory from a
# JSON column.
_MAX_SEAT_COUNT = 50


def _seat_count(count: Any) -> int:
    """How many seats one entry stands for. Anything unusable means one."""
    if isinstance(count, bool) or not isinstance(count, int):
        return 1
    if count < 1:
        return 1
    return min(count, _MAX_SEAT_COUNT)
