"""
Historical staffing: reading a previous system's roster export.

A staffing export says who was scheduled into which seat at which event. It
comes in one of two shapes, and the import reads both:

* **Two files joined on an event key.** A seats file, one row per seat (the
  event it belongs to, the seat's title, who held it), and an events file, one
  row per event (its date, times, activity and location). A scheduling
  database exports its tables this way.
* **One flat file.** Each seat row carries its event's date and times itself.
  Seats are grouped into events by the event key when the file has one, and
  otherwise by date, start time and activity.

This module is pure: it parses cells and joins rows. It writes nothing and
reads no database, so it is tested without one.

Staffing is the roster, not hours. A seat records who was scheduled; the hours
file records who worked, and only the hours file credits time.
"""

import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, time
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from app.services import shift_history_import_engine as shift_engine
from app.services.historical_import_engine import cell, parse_date_cell

SEATS = "seats"
EVENTS = "events"
KINDS: Tuple[str, ...] = (SEATS, EVENTS)

SEAT_FIELDS: Tuple[str, ...] = (
    "event_key",
    "seat_id",
    "title",
    "membership_number",
    "member_name",
    "first_name",
    "last_name",
    "required",
    # Present only in a flat file, where each seat row carries its event.
    "date",
    "start_time",
    "end_time",
    "activity",
    "location",
)

EVENT_FIELDS: Tuple[str, ...] = (
    "event_key",
    "date",
    "start_time",
    "end_time",
    "activity",
    "location",
)

FIELDS_BY_KIND: Dict[str, Tuple[str, ...]] = {SEATS: SEAT_FIELDS, EVENTS: EVENT_FIELDS}

_MEMBER_FIELDS: Tuple[str, ...] = (
    "membership_number",
    "member_name",
    "first_name",
    "last_name",
)

_SHARED = shift_engine.HEADER_ALIASES

_ALIASES: Dict[str, Tuple[str, ...]] = {
    "event_key": (
        "event_id",
        "eventid",
        "event_key",
        "event_number",
        "event_no",
        "shift_id",
        "shiftid",
        "schedule_id",
    ),
    "seat_id": (
        "position_id",
        "positionid",
        "seat_id",
        "slot_id",
        "assignment_id",
        "staffing_id",
    ),
    "title": (
        "title",
        "position_title",
        "position",
        "seat",
        "seat_title",
        "role",
        "slot",
    ),
    "membership_number": ("vid", "volunteer_id", "volunteer_number")
    + _SHARED["membership_number"],
    "member_name": _SHARED["member_name"],
    "first_name": _SHARED["first_name"],
    "last_name": _SHARED["last_name"],
    "required": (
        "minimum_staffing",
        "minimumstaffing",
        "required",
        "is_required",
        "mandatory",
        "min_staffing",
    ),
    "date": ("edate", "event_date", "eventdate") + _SHARED["date"],
    "start_time": ("starttime", "start_time", "event_start") + _SHARED["start_time"],
    "end_time": ("endtime", "end_time", "event_end") + _SHARED["end_time"],
    "activity": (
        "activity",
        "event_name",
        "eventname",
        "event_title",
        "event",
        "description",
        "name",
    ),
    "location": ("location", "venue", "place", "station", "site"),
}

# The usual range of a file's dates runs from the first to the last year
# holding at least this many events. An event outside it (one dated 1931 in a
# file whose history starts in 2000) is far likelier a typing slip or a test
# entry than history, so it is flagged for the reviewer and skipped by default.
USUAL_RANGE_MIN_EVENTS_PER_YEAR = 5

EXAMPLES = 20


def detect_mapping(kind: str, headers: Sequence[str]) -> Dict[str, str]:
    """Which header feeds which field of a ``kind`` file, by spelling.

    Fields are tried in order and a header feeds at most one, so in an events
    file an ``EventID`` column is the key, never the activity.
    """
    by_normalized: Dict[str, str] = {}
    for header in headers:
        by_normalized.setdefault(shift_engine.normalize_header(header), header)
    mapping: Dict[str, str] = {}
    used: set = set()
    for field_name in FIELDS_BY_KIND[kind]:
        for alias in _ALIASES[field_name]:
            found = by_normalized.get(alias)
            if found is not None and found not in used:
                mapping[field_name] = found
                used.add(found)
                break
    return mapping


def clean_mapping(
    kind: str, headers: Sequence[str], requested: Mapping[str, Any]
) -> Dict[str, str]:
    """A mapping the screen sent, checked against the file.

    A null or empty header unmaps a field. A header feeds at most one field.
    """
    fields = FIELDS_BY_KIND[kind]
    known = set(headers)
    mapping: Dict[str, str] = {}
    for field_name, header in requested.items():
        if field_name not in fields:
            raise ValueError(f"'{field_name}' is not a field of this file.")
        if header is None or header == "":
            continue
        if header not in known:
            raise ValueError(f"The file has no column named '{header}'.")
        if header in mapping.values():
            raise ValueError(f"The column '{header}' is chosen for two fields.")
        mapping[field_name] = header
    return mapping


# ---------------------------------------------------------------------------
# Cells
# ---------------------------------------------------------------------------

_FRACTION_RE = re.compile(r"(\d{1,2}:\d{2}:\d{2})\.\d+$")


def parse_clock_cell(value: str) -> Optional[time]:
    """A time of day, from a clock cell or a date-time cell.

    Database exports often store a time as a date-time on a placeholder day
    (``1899-12-30 19:00:00.000``); only the clock is read.
    """
    cleaned = _FRACTION_RE.sub(r"\1", value.strip())
    if not cleaned:
        return None
    _, clock = shift_engine.parse_time_cell(cleaned)
    return clock


def has_member(values: Mapping[str, str]) -> bool:
    """Whether a seat names anyone. A number of all zeros names nobody: some
    systems write ``0`` in an empty seat."""
    for field_name in _MEMBER_FIELDS:
        value = (values.get(field_name) or "").strip()
        if value and value.strip("0") != "":
            return True
    return False


# ---------------------------------------------------------------------------
# Events and seats
# ---------------------------------------------------------------------------


@dataclass
class StaffingEvent:
    key: str
    line_number: int
    day: Optional[date]
    start: Optional[time]
    end: Optional[time]
    activity: str
    location: str
    seat_count: int = 0
    filled_count: int = 0

    @property
    def overnight(self) -> bool:
        """Ends at or before it starts: it runs past midnight into the next
        day, as an 08:00 to 07:59 on-call day or a 19:00 to 07:00 night does."""
        return (
            self.start is not None and self.end is not None and self.end <= self.start
        )


@dataclass
class Seat:
    line_number: int
    event_key: str
    seat_id: str
    title: str
    member: Dict[str, str]
    required: bool

    @property
    def filled(self) -> bool:
        return has_member(self.member)


_TRUTHY = frozenset({"1", "true", "yes", "y", "x", "t", "-1"})


def _seat(line_number: int, raw: Mapping[str, Any], mapping: Mapping[str, str]) -> Seat:
    return Seat(
        line_number=line_number,
        event_key=cell(raw, mapping.get("event_key")),
        seat_id=cell(raw, mapping.get("seat_id")),
        title=cell(raw, mapping.get("title")),
        member={f: cell(raw, mapping.get(f)) for f in _MEMBER_FIELDS},
        required=cell(raw, mapping.get("required")).casefold() in _TRUTHY,
    )


def _event(
    key: str, line_number: int, raw: Mapping[str, Any], mapping: Mapping[str, str]
) -> StaffingEvent:
    return StaffingEvent(
        key=key,
        line_number=line_number,
        day=parse_date_cell(cell(raw, mapping.get("date"))),
        start=parse_clock_cell(cell(raw, mapping.get("start_time"))),
        end=parse_clock_cell(cell(raw, mapping.get("end_time"))),
        activity=cell(raw, mapping.get("activity")),
        location=cell(raw, mapping.get("location")),
    )


@dataclass
class FileInput:
    mapping: Mapping[str, str]
    # ``(line_number, raw)`` in file order.
    rows: Sequence[Tuple[int, Mapping[str, Any]]]


@dataclass
class Joined:
    seats: List[Seat]
    events: Dict[str, StaffingEvent]
    # Seat rows naming no event at all, and rows naming one nothing describes.
    seats_without_key: List[Seat] = field(default_factory=list)
    seats_missing_event: List[Seat] = field(default_factory=list)
    duplicate_event_keys: List[str] = field(default_factory=list)


def flat_file(seats: FileInput) -> bool:
    """Whether the seats file carries its events' dates itself."""
    return bool(seats.mapping.get("date"))


def _flat_key(raw: Mapping[str, Any], mapping: Mapping[str, str]) -> str:
    key = cell(raw, mapping.get("event_key"))
    if key:
        return key
    return "|".join(
        cell(raw, mapping.get(f)).casefold() for f in ("date", "start_time", "activity")
    )


def join(seats: FileInput, events: Optional[FileInput]) -> Joined:
    """Every seat, and the events they belong to.

    With an events file, a seat finds its event by key. Without one (a flat
    file), each distinct event key, or date, start and activity where the file
    has no key, is one event, described by its first seat row.
    """
    seat_list: List[Seat] = []
    by_key: Dict[str, StaffingEvent] = {}
    duplicates: List[str] = []
    use_flat = events is None and flat_file(seats)

    if events is not None:
        for line_number, raw in events.rows:
            key = cell(raw, events.mapping.get("event_key"))
            if not key:
                continue
            if key in by_key:
                duplicates.append(key)
                continue
            by_key[key] = _event(key, line_number, raw, events.mapping)

    joined = Joined(seats=seat_list, events=by_key, duplicate_event_keys=duplicates)
    for line_number, raw in seats.rows:
        seat = _seat(line_number, raw, seats.mapping)
        if use_flat:
            key = _flat_key(raw, seats.mapping)
            seat.event_key = key
            if key not in by_key:
                by_key[key] = _event(key, line_number, raw, seats.mapping)
        seat_list.append(seat)
        if not seat.event_key:
            joined.seats_without_key.append(seat)
            continue
        found = by_key.get(seat.event_key)
        if found is None:
            joined.seats_missing_event.append(seat)
            continue
        found.seat_count += 1
        if seat.filled:
            found.filled_count += 1
    return joined


# ---------------------------------------------------------------------------
# What the screen shows before anything is decided
# ---------------------------------------------------------------------------


def mapping_problems(
    seats: Optional[FileInput], events: Optional[FileInput]
) -> List[str]:
    """What must be chosen before the files can be read together."""
    problems: List[str] = []
    if seats is None:
        return ["Upload the seats file: one row per seat, naming who held it."]
    mapping = seats.mapping
    if not mapping.get("title"):
        problems.append("Choose the seats file's seat title column.")
    if not any(mapping.get(f) for f in _MEMBER_FIELDS):
        problems.append("Choose the column naming who held each seat.")
    if events is None:
        if not mapping.get("date"):
            problems.append(
                "Upload the events file, or choose the seats file's date column "
                "if each seat row carries its event's date."
            )
        elif not mapping.get("event_key") and not mapping.get("activity"):
            # Without either, every seat on a day falls into one event.
            problems.append(
                "Choose the seats file's event column, or its activity column, "
                "so seats on the same day are told apart by event."
            )
    else:
        if not mapping.get("event_key"):
            problems.append("Choose the seats file's event column.")
        if not events.mapping.get("event_key"):
            problems.append("Choose the events file's event column.")
        if not events.mapping.get("date"):
            problems.append("Choose the events file's date column.")
    return problems


def _examples(values: Sequence[Any]) -> List[Any]:
    return list(values[:EXAMPLES])


def usual_years(days: Sequence[date], today: date) -> Optional[Tuple[int, int]]:
    """The first and last year holding enough events to be the file's own
    history; None when no year does (a small file is not judged).

    The range always runs through next year: an export taken in November
    holds only the first few of next year's scheduled events, and those are
    upcoming, not suspect.
    """
    per_year = Counter(d.year for d in days)
    busy = [y for y, n in per_year.items() if n >= USUAL_RANGE_MIN_EVENTS_PER_YEAR]
    if not busy:
        return None
    return min(busy), max(max(busy), today.year + 1)


def outside_usual_range(day: Optional[date], years: Optional[Tuple[int, int]]) -> bool:
    return (
        day is not None and years is not None and not years[0] <= day.year <= years[1]
    )


def summarize(joined: Joined, today: date) -> Dict[str, Any]:
    """Counts the screen shows, with a few examples of each problem.

    ``today`` is the department's date: an event after it is upcoming and is
    imported as a scheduled event rather than a past one.
    """
    seats = joined.seats
    events = list(joined.events.values())
    filled = sum(1 for s in seats if s.filled)
    missing_keys = Counter(s.event_key for s in joined.seats_missing_event)
    dated = [e for e in events if e.day is not None]
    undated = [e for e in events if e.day is None]
    years = usual_years([e.day for e in dated if e.day is not None], today)
    unusual = [e for e in dated if outside_usual_range(e.day, years)]
    usual = [e for e in dated if not outside_usual_range(e.day, years)]
    upcoming = [e for e in usual if e.day is not None and e.day > today]
    staffed = [e for e in events if e.seat_count]
    # Unstaffed events the import makes calendar events: those it can place
    # on a date in the usual range (past ones, and upcoming ones as scheduled).
    unstaffed_importable = sum(
        1 for e in usual if e.day is not None and not e.seat_count
    )
    in_range = [e.day for e in usual if e.day is not None]
    return {
        "seats": {
            "rows": len(seats),
            "filled": filled,
            "unfilled": len(seats) - filled,
            "without_event_key": len(joined.seats_without_key),
            "missing_event": len(joined.seats_missing_event),
            "missing_event_filled": sum(
                1 for s in joined.seats_missing_event if s.filled
            ),
            "missing_event_keys": len(missing_keys),
            "missing_event_examples": _examples(
                [{"event_key": k, "seats": n} for k, n in missing_keys.most_common()]
            ),
        },
        "events": {
            "rows": len(events),
            "staffed": len(staffed),
            "unstaffed": len(events) - len(staffed),
            "unstaffed_importable": unstaffed_importable,
            "undated": len(undated),
            "undated_examples": _examples([e.line_number for e in undated]),
            "usual_first_year": years[0] if years else None,
            "usual_last_year": years[1] if years else None,
            "outside_usual_range": len(unusual),
            "outside_usual_range_examples": _examples(
                [
                    {
                        "line_number": e.line_number,
                        "date": e.day,
                        "activity": e.activity,
                        "seats": e.seat_count,
                    }
                    for e in unusual
                ]
            ),
            # After the department's today: imported as scheduled events.
            "upcoming": len(upcoming),
            "overnight": sum(1 for e in events if e.overnight),
            "duplicate_keys": len(joined.duplicate_event_keys),
            "first_date": min(in_range) if in_range else None,
            "last_date": max(in_range) if in_range else None,
        },
    }
