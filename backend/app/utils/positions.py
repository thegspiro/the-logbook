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

from typing import Any, Dict, Iterable, List

from pydantic import BaseModel

from app.core.error_codes import CodedValueError, ErrorCode

# The built-in seat vocabulary: ``ShiftPosition`` names the same set, and
# ``tests/test_position_slots.py`` asserts the two agree. It is not the whole
# vocabulary. A department's own seats (Scheduling → Position Names, or typed
# onto a template or apparatus) are stored and assigned verbatim alongside these
# — the position columns are VARCHAR, and ``resolve_seat`` below decides
# whether a requested seat is one the shift actually has.
#
# The rank editor's seat picker derives from ``POSITION_LABELS`` in
# ``frontend/src/constants/enums.ts``, which ``test_frontend_labels_agree``
# holds equal to this set, and unions in the department's own
# ``customPositions`` — so a seat added here reaches that picker without a
# second edit, and a seat a department invented is grantable at all. ``paramedic`` is the one canonical seat the picker withholds: a medic
# seat is a credential, granted by ``get_eligible_positions`` step 3b from the
# member's certifications as of the shift date, and a rank that could confer it
# would outlive the card.
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

    Pydantic models (``PositionSlot``) are accepted alongside dicts: an
    endpoint that hands over a parsed request body must settle to the same
    shape as one that hands over ``model_dump()`` output.
    """
    if not isinstance(positions, list):
        return positions

    slots: List[Dict[str, Any]] = []
    for entry in positions:
        # A request body typed ``List[PositionSlot | str]`` arrives already
        # parsed, so the seats reach this function as models rather than
        # dicts. Matching neither branch below dropped every structured seat
        # on POST /scheduling/apparatus while the PATCH sibling — which dumps
        # the payload first — kept them.
        if isinstance(entry, BaseModel):
            entry = entry.model_dump()
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
    # bool is an int subclass, but True is a flag, not "one seat".
    if isinstance(count, int) and not isinstance(count, bool) and count >= 1:
        return min(count, _MAX_SEAT_COUNT)
    return 1


# The widest seat name the position columns hold. Matches
# ``CustomPositionSchema.value`` — the screen a department names its own seats
# on — so any seat a department can define can also be assigned.
SEAT_NAME_MAX_LENGTH = 100


class UnknownSeatError(CodedValueError):
    """A member was asked into a seat the shift does not have.

    A ``CodedValueError`` so the paths that already carry a curated refusal up
    to the endpoint (assignment, signup, swap review) carry this one too; the
    endpoint answers it with a 422, since the request named something that
    does not exist rather than something the member is not allowed to do.
    """

    def __init__(self, message: str) -> None:
        super().__init__(message, error_code=ErrorCode.SCHED_UNKNOWN_SEAT)


def _requested_token(requested: Any) -> str:
    token = canonical_position(str(getattr(requested, "value", requested) or ""))
    if not token:
        raise UnknownSeatError("A seat is required.")
    if len(token) > SEAT_NAME_MAX_LENGTH:
        raise UnknownSeatError(
            f"A seat name can be at most {SEAT_NAME_MAX_LENGTH} characters."
        )
    return token


def resolve_seat(requested: Any, seat_names: Iterable[Any]) -> str:
    """The seat ``requested`` names on a shift whose seats are ``seat_names``.

    The one rule every path that puts a member in a seat goes through —
    signup, officer assignment and edit, swap review, offer acceptance,
    open-swap pickup and a standing shift's per-date seating — so a seat one
    path accepts is never one another refuses.

    * A seat the shift names is returned in the shift's own spelling, matched
      case-insensitively, so the assignment lines up with the seat the board
      renders.
    * A built-in seat the shift does not name is returned canonical and left to
      the capacity check, exactly as before custom seats were assignable: on a
      shift with no named seats any built-in seat is open, and on a shift with
      named seats it is refused there as no longer available.
    * Any other seat — a department's own seat the shift does not carry, or a
      name nobody defined — raises ``UnknownSeatError``. Another department's
      seat is in this group by construction: the only list consulted is the
      shift's own.
    """
    token = _requested_token(requested)
    folded = token.casefold()
    for name in seat_names:
        stored = canonical_position(str(getattr(name, "value", name) or ""))
        if stored and stored.casefold() == folded:
            return stored
    if folded in CANONICAL_POSITIONS:
        return folded
    raise UnknownSeatError(
        f"'{token}' is not a seat on this shift. Choose one of the seats the "
        "shift lists, or add the seat to the shift first."
    )


def resolve_department_seat(requested: Any, department_seats: Iterable[Any]) -> str:
    """The seat ``requested`` names in a department's vocabulary.

    For a claim made before there is a shift to check it against — a standing
    shift. The vocabulary is the built-in seats plus every seat the department
    has defined; each date the claim later seats a member on is checked again
    by ``resolve_seat`` against that shift.
    """
    token = _requested_token(requested)
    folded = token.casefold()
    if folded in CANONICAL_POSITIONS:
        return folded
    for name in department_seats:
        stored = canonical_position(str(getattr(name, "value", name) or ""))
        if stored and stored.casefold() == folded:
            return stored
    raise UnknownSeatError(
        f"'{token}' is not a seat this department has defined. Choose a "
        "built-in seat or one listed under Scheduling → Position Names."
    )
