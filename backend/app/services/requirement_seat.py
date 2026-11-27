"""Which requirements may count time in one seat, and the stored form of it.

A shift-credited Hours or Shifts requirement may be limited to one seat
(``TrainingRequirement.credited_seat``, owner decisions 2026-11-26): only the
shifts the member held that seat on count. Every other requirement grades
from training records, evaluations or sessions, none of which has a seat.
"""

from typing import Any, Optional

from app.models.training import RequirementType
from app.utils.positions import canonical_position

SEAT_LIMIT_MESSAGE = (
    "Only a shift-credited Hours or Shifts requirement can count time in one seat"
)

_SEAT_CREDITED_TYPES = frozenset(
    {RequirementType.HOURS.value, RequirementType.SHIFTS.value}
)


def _type_value(requirement: Any) -> Optional[str]:
    value = getattr(requirement, "requirement_type", None)
    value = getattr(value, "value", value)
    return str(value) if value is not None else None


def seat_limit_allowed(requirement: Any) -> bool:
    """Whether ``requirement`` grades from shifts worked, so a seat applies.

    ``shift_credited`` may still be unset on a requirement not yet flushed;
    the model then defaults it on for SHIFTS only, and so does this.
    """
    kind = _type_value(requirement)
    if kind not in _SEAT_CREDITED_TYPES:
        return False
    credited = getattr(requirement, "shift_credited", None)
    if credited is None:
        return kind == RequirementType.SHIFTS.value
    return credited is True


def settle_credited_seat(requirement: Any, *, sent: bool) -> None:
    """Store ``credited_seat`` as ``canonical_position`` settles it.

    A seat the caller sent (``sent``) on a requirement that cannot take one
    is refused with ``ValueError``, so the officer learns it would do
    nothing. A seat already stored on a requirement an edit has just made
    ineligible (a type change, shift credit turned off) is cleared instead:
    it would otherwise sit there unread, as a stale ``due_date`` would.
    """
    seat = getattr(requirement, "credited_seat", None)
    if seat is None:
        return
    cleaned = canonical_position(str(seat))
    if not cleaned:
        requirement.credited_seat = None
        return
    if not seat_limit_allowed(requirement):
        if sent:
            raise ValueError(SEAT_LIMIT_MESSAGE)
        requirement.credited_seat = None
        return
    requirement.credited_seat = cleaned
