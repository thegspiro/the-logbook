"""
Historical staffing: which hours entry each roster sign-up was.

The old system kept who signed up for which seat (the staffing roster) apart
from the hours each member recorded (the hours file), with no id shared between
them. A seat says a member was the driver on a shift; the hours entry says the
same member worked 07:00 to 19:00 and ran three calls, and names no seat. They
are the same duty when they are the same member and their times overlap.

Each sign-up is paired with the one hours entry of its member that its time
overlaps most, by at least ``MIN_OVERLAP``. One entry pairs with one sign-up:
when two of a member's sign-ups overlap the same entry, the larger overlap
takes it and the other is left unmatched (owner decision 2026-11-21). The
commit then writes the sign-up's seat onto that entry's shift, so the member's
history shows the position beside the hours and the calls.

Pure functions only; the commit service loads both sides and writes.
"""

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

from app.utils.positions import CANONICAL_POSITIONS, canonical_position

#: A sign-up and an hours entry are one duty only when they share at least
#: this much time. Below it a member's back-to-back but separate duties, such
#: as a day shift ending as an evening detail starts, would pair up.
MIN_OVERLAP = timedelta(minutes=30)


@dataclass(frozen=True)
class SignUp:
    """One roster seat with a known member, at its event's time."""

    key: str
    user_id: str
    start: datetime
    end: datetime


@dataclass(frozen=True)
class HoursEntry:
    """One attendance the department already has: who, when, on which shift."""

    attendance_id: str
    shift_id: str
    user_id: str
    start: datetime
    end: datetime
    day: Optional[date] = None


@dataclass
class HoursMatch:
    #: Sign-up key to the hours entry it was paired with.
    matched: Dict[str, HoursEntry]
    #: Sign-up keys with no hours entry of their member overlapping enough.
    unmatched_signups: List[str]
    #: Hours entries no sign-up was paired with.
    unmatched_hours: List[HoursEntry]


def overlap(a_start: datetime, a_end: datetime, b_start: datetime, b_end: datetime):
    """How long two spans share, never negative."""
    return max(timedelta(0), min(a_end, b_end) - max(a_start, b_start))


def match(signups: Sequence[SignUp], entries: Sequence[HoursEntry]) -> HoursMatch:
    """Pair sign-ups with hours entries, largest overlaps first.

    Greedy on the overlap rather than sign-up by sign-up, so the result does
    not depend on the order the roster lists its seats in. Ties fall to the
    earlier sign-up and entry, by time and then key, so a re-run pairs the
    same way.
    """
    by_user: Dict[str, List[HoursEntry]] = {}
    for entry in entries:
        by_user.setdefault(entry.user_id, []).append(entry)

    candidates: List[Tuple[timedelta, SignUp, HoursEntry]] = []
    for signup in signups:
        for entry in by_user.get(signup.user_id, ()):
            shared = overlap(signup.start, signup.end, entry.start, entry.end)
            if shared >= MIN_OVERLAP:
                candidates.append((shared, signup, entry))
    candidates.sort(
        key=lambda c: (
            -c[0],
            c[1].start,
            c[1].key,
            c[2].start,
            c[2].attendance_id,
        )
    )

    matched: Dict[str, HoursEntry] = {}
    taken: set[str] = set()
    for _, signup, entry in candidates:
        if signup.key in matched or entry.attendance_id in taken:
            continue
        matched[signup.key] = entry
        taken.add(entry.attendance_id)

    return HoursMatch(
        matched=matched,
        unmatched_signups=[s.key for s in signups if s.key not in matched],
        unmatched_hours=sorted(
            (e for e in entries if e.attendance_id not in taken),
            key=lambda e: (e.start, e.attendance_id),
        ),
    )


def crew_seat_for(title: str, department_seats: Iterable[str]) -> Optional[str]:
    """The crew seat an event sign-up's title names, or None.

    An event's seats are mapped to outreach roles, which are not crew seats:
    coverage and eligibility read a shift's ``position``, so only a title that
    is itself a crew seat (a built-in one, or one of the department's own
    units' seats) is written onto the hours entry's shift (owner decision
    2026-11-21). "EMT" settles onto the built-in ``ems``; a department seat is
    returned in the department's own spelling.
    """
    settled = canonical_position(title)
    if not settled:
        return None
    if settled in CANONICAL_POSITIONS:
        return settled
    folded = settled.casefold()
    for seat in department_seats:
        if seat.strip().casefold() == folded:
            return seat.strip()
    return None
