"""
Historical staffing: what the roster import will write, before it writes it.

From the joined files and the reviewer's decisions this works out, event by
event, what becomes of it and of each seat:

* a **shift** activity fills a crew roster: each seat whose title maps to one
  of the department's crew seats becomes that member's seat on the shift;
* an **event** activity becomes a calendar event: a seat mapped to attendance
  checks its member in, and a seat mapped to an outreach role puts its member
  on the event's outreach signup sheet in that role;
* an event with no seats becomes a calendar event when the reviewer keeps
  that option on.

A seat is left out, and counted by reason, when its event has no date, falls
outside the usual years, or is not in the export; when its activity or title is
left out or not yet decided; or when nobody held it and the reviewer assigned
nobody. Nothing is credited as hours: the roster is who was scheduled.

Pure functions only; the service resolves members and writes.
"""

import hashlib
import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, time
from typing import Dict, List, Mapping, Optional, Sequence, Tuple

from app.services import historical_staffing_engine as engine
from app.services import historical_staffing_mapping as mapping_rules

# Ledger keys, under the import's source system. A seat is keyed by the source
# system's own seat id where the file has one, else by its line.
EVENT_PREFIX = "staff-event:"
SHIFT_PREFIX = "staff-shift:"
SHEET_PREFIX = "staff-sheet:"
SEAT_PREFIX = "staff-seat:"
_LEDGER_KEY_MAX = 100

# Why a seat is not written, for the summary.
SKIP_NO_EVENT = "no_event"
SKIP_UNDATED = "undated"
SKIP_OUTSIDE_RANGE = "outside_usual_range"
SKIP_ACTIVITY = "activity_left_out"
SKIP_ACTIVITY_UNDECIDED = "activity_undecided"
SKIP_TITLE = "title_left_out"
SKIP_TITLE_UNDECIDED = "title_undecided"
SKIP_UNFILLED = "unfilled"

# Words in a shift's activity that make it an on-call (recall) shift: the
# crew at home and responding if paged, as the hours import tells them apart.
_ON_CALL_RE = re.compile(r"\b(call\s*back|callback|recall|on[\s-]?call)\b", re.I)


def ledger_id(prefix: str, key: str) -> str:
    """A ledger source id within the column's length: a long flat-file key
    (date, start and activity) is replaced by its digest."""
    value = f"{prefix}{key}"
    if len(value) <= _LEDGER_KEY_MAX:
        return value
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()[:40]
    return f"{prefix}#{digest}"


def seat_ledger_id(seat: engine.Seat) -> str:
    return ledger_id(SEAT_PREFIX, seat.seat_id or f"line-{seat.line_number}")


def is_on_call(activity: str) -> bool:
    return bool(_ON_CALL_RE.search(activity or ""))


@dataclass
class PlannedSeat:
    seat: engine.Seat
    # A crew seat value (shifts), an outreach role value, or attendance.
    value: str
    # The member the reviewer assigned to an unfilled seat, by user id.
    assigned_user_id: Optional[str] = None

    @property
    def attendance(self) -> bool:
        return self.value == mapping_rules.ATTENDANCE


@dataclass
class PlannedEvent:
    event: engine.StaffingEvent
    kind: str  # mapping_rules.SHIFT or EVENT
    upcoming: bool
    seats: List[PlannedSeat] = field(default_factory=list)


@dataclass
class Plan:
    events: List[PlannedEvent]
    skipped: Counter
    # Unfilled seats that would be written if someone were assigned: the
    # reviewer's worklist.
    unfilled: List[Tuple[engine.StaffingEvent, engine.Seat, str]]

    def counts(self) -> Dict[str, int]:
        shifts = [p for p in self.events if p.kind == mapping_rules.SHIFT]
        events = [p for p in self.events if p.kind == mapping_rules.EVENT]
        return {
            "shifts": len(shifts),
            "shift_seats": sum(len(p.seats) for p in shifts),
            "events": len(events),
            "upcoming_events": sum(1 for p in events if p.upcoming),
            "check_ins": sum(1 for p in events for s in p.seats if s.attendance),
            "outreach_seats": sum(
                1 for p in events for s in p.seats if not s.attendance
            ),
            "assigned_unfilled": sum(
                1 for p in self.events for s in p.seats if s.assigned_user_id
            ),
        }


def build_plan(
    joined: engine.Joined,
    decisions: mapping_rules.Decisions,
    seat_members: Mapping[str, str],
    unit_names: Sequence[str],
    today: date,
    *,
    include_unstaffed: bool,
) -> Plan:
    """What will be written. Only decided activities and titles count: a
    suggestion the reviewer has not accepted writes nothing."""
    skipped: Counter = Counter()
    for seat in joined.seats_missing_event + joined.seats_without_key:
        skipped[SKIP_NO_EVENT] += 1

    dated = [e.day for e in joined.events.values() if e.day is not None]
    years = engine.usual_years(dated, today)
    by_event: Dict[str, List[engine.Seat]] = {}
    for seat in joined.seats:
        if seat.event_key in joined.events:
            by_event.setdefault(seat.event_key, []).append(seat)

    planned: List[PlannedEvent] = []
    unfilled: List[Tuple[engine.StaffingEvent, engine.Seat, str]] = []
    for event in joined.events.values():
        seats = by_event.get(event.key, [])
        if event.day is None:
            skipped[SKIP_UNDATED] += len(seats)
            continue
        if engine.outside_usual_range(event.day, years):
            skipped[SKIP_OUTSIDE_RANGE] += len(seats)
            continue
        upcoming = event.day > today
        if not seats:
            if include_unstaffed:
                planned.append(
                    PlannedEvent(
                        event=event, kind=mapping_rules.EVENT, upcoming=upcoming
                    )
                )
            continue
        kind = decisions.activity_kinds.get(mapping_rules.activity_key(event.activity))
        if kind is None:
            skipped[SKIP_ACTIVITY_UNDECIDED] += len(seats)
            continue
        if kind == mapping_rules.SKIP:
            skipped[SKIP_ACTIVITY] += len(seats)
            continue
        titles = (
            decisions.seat_titles
            if kind == mapping_rules.SHIFT
            else decisions.event_titles
        )
        entry = PlannedEvent(event=event, kind=kind, upcoming=upcoming)
        for seat in seats:
            value = titles.get(mapping_rules.title_key(seat.title))
            if value is None:
                skipped[SKIP_TITLE_UNDECIDED] += 1
                continue
            if value == mapping_rules.TITLE_SKIP:
                skipped[SKIP_TITLE] += 1
                continue
            if not seat.filled:
                assigned = seat_members.get(str(seat.line_number))
                if not assigned:
                    skipped[SKIP_UNFILLED] += 1
                    unfilled.append((event, seat, value))
                    continue
                entry.seats.append(PlannedSeat(seat, value, assigned_user_id=assigned))
                unfilled.append((event, seat, value))
                continue
            entry.seats.append(PlannedSeat(seat, value))
        # An event whose every seat was left out is still the department's
        # event: it is written, empty, like an unstaffed one.
        if entry.seats or kind == mapping_rules.EVENT:
            planned.append(entry)
    return Plan(events=planned, skipped=skipped, unfilled=unfilled)


def clock_or(value: Optional[time], fallback: time) -> time:
    return value if value is not None else fallback


def unit_of(activity: str, units: Sequence[Tuple[str, str]]) -> Optional[str]:
    """The id of the department unit an activity names, by unit number or
    name; the longest name wins, so "A106E" is not read as "A106"."""
    squashed = re.sub(r"[^a-z0-9]", "", (activity or "").casefold())
    best: Optional[Tuple[int, str]] = None
    for unit_id, name in units:
        key = re.sub(r"[^a-z0-9]", "", (name or "").casefold())
        if len(key) < 3 or key not in squashed:
            continue
        if best is None or len(key) > best[0]:
            best = (len(key), unit_id)
    return best[1] if best else None
