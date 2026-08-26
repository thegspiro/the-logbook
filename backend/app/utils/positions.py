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

The same vocabulary answers a second question: which seat a completed program
or a held certification qualifies a member to fill
(``training_target_to_position``). It lives here rather than beside its reader
so the schema layer can validate a course's ``target_position`` against the
set the eligibility service resolves it through — a value the API accepts and
the resolver does not understand would be a seat grant that silently does
nothing. Keeping it here is also what lets the ``emt`` -> ``ems`` alias be
stated once instead of once per consumer.
"""

from typing import Any, Dict, List, Optional

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


# Program / course ``target_position`` values that are *not* seat names -- the
# pipeline names departments actually type. Everything else a program or course
# can target is a seat name (or an alias of one) and resolves through
# ``canonical_position``, so ``emt`` maps to the EMS seat here for the same
# reason it does anywhere else, stated once.
_TRAINING_PIPELINE_TARGETS = {
    "driver_candidate": "driver",
    "aic": "officer",
}

# Everything a ``target_position`` may be spelled as. The schema layer validates
# against this so a value the API accepts and the resolver cannot understand --
# a seat grant that silently does nothing -- is refused at the door.
TRAINING_TARGET_VALUES = (
    frozenset(_TRAINING_PIPELINE_TARGETS)
    | CANONICAL_POSITIONS
    | frozenset(_POSITION_ALIASES)
)


def training_target_to_position(target: Optional[str]) -> str:
    """The seat a program's or course's ``target_position`` qualifies for.

    Completing a ``driver_candidate`` pipeline qualifies a member for the
    ``driver`` seat; holding an ``emt`` certification qualifies them for the
    ``ems`` one. Only the pipeline names need their own entry -- the rest are
    seat names or aliases, and ``canonical_position`` already settles those.
    """
    if not target:
        return ""
    folded = target.strip().casefold()
    if folded in _TRAINING_PIPELINE_TARGETS:
        return _TRAINING_PIPELINE_TARGETS[folded]
    return canonical_position(target)


def training_targets_for(position: str) -> List[str]:
    """Every ``target_position`` spelling that resolves to ``position``.

    The reverse of ``training_target_to_position``. Lets a roster filter in SQL
    rather than reading every certification a department holds and discarding
    most of them in Python.
    """
    return sorted(
        v for v in TRAINING_TARGET_VALUES if training_target_to_position(v) == position
    )


def normalize_stored_positions(positions: Any) -> Any:
    """Return a seat list as ``[{"position": str, "required": bool}]``.

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
                slots.append({"position": name, "required": True})
        elif isinstance(entry, dict):
            name = canonical_position(str(entry.get("position") or ""))
            if name:
                # Only an explicit False makes a seat optional, matching the
                # frontend's `required !== false`. A missing or null flag is a
                # required seat, which is what every legacy row means.
                slot = {
                    "position": name,
                    "required": entry.get("required") is not False,
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
