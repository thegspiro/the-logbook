"""
The decisions a historical data import makes, as pure functions.

A previous system's export usually holds every kind of hour in one file, one
row per entry, with a column per kind of hour (``Standby``, ``Training``,
``Admin``...) of which one is nonzero. This module reads such a file the way
the department has said to read it:

1. **Detect** which header means which field, and which columns hold hours or
   call counts, by recognised spelling. Every guess is shown and correctable.
2. **Route** each row to the kind of record each of its nonzero hours columns
   describes, and note the clean-up applied on the way: hours that disagree
   with the clock times, an end time on the next day, a date with a time
   stuck to it.
3. **Batch** the shift and on-call rows into review drafts for the shift
   history import, split at month boundaries so no draft is too large to
   review comfortably.

Nothing here touches the database, so the rules a department's history is
read by can be tested without one.
"""

import hashlib
import json
import re
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from app.services import shift_history_import_engine as shift_engine

# ---------------------------------------------------------------------------
# Tunables
# ---------------------------------------------------------------------------

# A file this large is an export of a whole department's history, not a
# spreadsheet someone typed. Bounded so one upload cannot exhaust memory.
MAX_IMPORT_ROWS = 200_000

# Rows per shift review batch. The review screen loads a batch whole; this keeps
# it responsive. A month is never split, so a batch can exceed it by up to one
# month's rows, and never exceeds the shift import's own row cap.
SHIFT_BATCH_TARGET_ROWS = 5_000

# Hours and clock times that disagree by more than this are reported.
_SPAN_TOLERANCE_MINUTES = 1

# ---------------------------------------------------------------------------
# Record types
# ---------------------------------------------------------------------------

SHIFT = "shift"
ON_CALL = "on_call"
TRAINING = "training"
ADMIN = "admin"
IGNORE = "ignore"

RECORD_TYPES: Tuple[str, ...] = (SHIFT, ON_CALL, TRAINING, ADMIN, IGNORE)
# What this release can send on. Training and administrative hours are routed
# and counted now, and imported by their own steps.
SHIFT_TYPES: Tuple[str, ...] = (SHIFT, ON_CALL)

# ---------------------------------------------------------------------------
# Fields
# ---------------------------------------------------------------------------

FIELDS: Tuple[str, ...] = (
    "membership_number",
    "member_name",
    "first_name",
    "last_name",
    "email",
    "date",
    "start_time",
    "end_time",
    "source_id",
    "unit",
    "agency",
    "position",
)

# Fields whose values reach the shift review unchanged (``date`` is normalized
# first). ``source_id`` is the row's ledger key and is handled separately.
_SHIFT_PASSTHROUGH: Tuple[str, ...] = (
    "membership_number",
    "member_name",
    "first_name",
    "last_name",
    "email",
    "start_time",
    "end_time",
    "unit",
    "agency",
    "position",
)

_EXTRA_ALIASES: Dict[str, Tuple[str, ...]] = {
    # Volunteer departments commonly key members by a volunteer id.
    "membership_number": ("vid", "volunteer_id", "volunteer_number"),
    "date": ("activity_date", "entry_date", "work_date"),
    "unit": ("unit_staffed", "unitstaffed", "apparatus_staffed"),
    "source_id": (
        "source_id",
        "unique_id",
        "uniqueid",
        "record_id",
        "entry_id",
        "row_id",
    ),
}


def _aliases(field_name: str) -> Tuple[str, ...]:
    return shift_engine.HEADER_ALIASES.get(field_name, ()) + _EXTRA_ALIASES.get(
        field_name, ()
    )


normalize_header = shift_engine.normalize_header

_HOUR_COLUMN_SPELLINGS: Dict[str, Tuple[str, ...]] = {
    SHIFT: (
        "standby",
        "standby_hours",
        "shift",
        "shift_hours",
        "duty",
        "duty_hours",
        "station_hours",
    ),
    ON_CALL: ("recall", "recall_hours", "on_call", "oncall", "on_call_hours"),
    TRAINING: ("training", "training_hours"),
    ADMIN: (
        "admin",
        "admin_hours",
        "administrative",
        "administrative_hours",
        "pubed",
        "pub_ed",
        "public_education",
        "public_ed",
    ),
}


def detect_column_mapping(headers: Sequence[str]) -> Dict[str, str]:
    """Which header feeds which field, by recognised spelling."""
    by_normalized: Dict[str, str] = {}
    for header in headers:
        by_normalized.setdefault(normalize_header(header), header)
    mapping: Dict[str, str] = {}
    used: set = set()
    for field_name in FIELDS:
        for alias in _aliases(field_name):
            found = by_normalized.get(alias)
            if found is not None and found not in used:
                mapping[field_name] = found
                used.add(found)
                break
    return mapping


def detect_hour_columns(
    headers: Sequence[str], taken: Sequence[str] = ()
) -> Dict[str, str]:
    """Columns that look like hours, by the kind of hour their name suggests."""
    found: Dict[str, str] = {}
    for header in headers:
        if header in taken:
            continue
        key = normalize_header(header)
        for record_type, spellings in _HOUR_COLUMN_SPELLINGS.items():
            if key in spellings:
                found[header] = record_type
                break
    return found


def detect_call_columns(
    headers: Sequence[str],
    call_types: Sequence[Mapping[str, str]],
    taken: Sequence[str] = (),
) -> Dict[str, str]:
    """Columns counting calls of one of the department's types.

    ``EMSCalls``, ``EMS Calls`` and ``ems_calls`` all name the ``ems`` type: the
    word "calls" is dropped and what is left is compared with each type's slug
    and label.
    """
    by_name: Dict[str, str] = {}
    for call_type in call_types:
        slug = str(call_type.get("slug") or "")
        if not slug:
            continue
        by_name.setdefault(_squash_letters(slug), slug)
        by_name.setdefault(_squash_letters(str(call_type.get("label") or "")), slug)
    found: Dict[str, str] = {}
    for header in headers:
        if header in taken:
            continue
        key = _squash_letters(header)
        if not key.endswith("calls") or key == "calls":
            continue
        matched = by_name.get(key[: -len("calls")])
        if matched and matched not in found.values():
            found[header] = matched
    return found


def _squash_letters(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.casefold())


# ---------------------------------------------------------------------------
# Cells
# ---------------------------------------------------------------------------


def parse_date_cell(value: str) -> Optional[date]:
    """A date, or a date with a time stuck to it (``2015-11-08 00:00:00.000``),
    which is how a database export writes a date column."""
    cleaned = value.strip()
    if not cleaned:
        return None
    day = shift_engine.parse_date(cleaned)
    if day is not None:
        return day
    head = re.split(r"[\sT]+", cleaned, maxsplit=1)[0]
    return shift_engine.parse_date(head)


def _span_minutes(start: time, end: time) -> int:
    begin = datetime.combine(date(2000, 1, 1), start)
    finish = datetime.combine(date(2000, 1, 1), end)
    if finish <= begin:
        finish += timedelta(days=1)
    return int(round((finish - begin).total_seconds() / 60))


def _format_hours(minutes: float) -> str:
    hours = minutes / 60
    return f"{hours:g}"


def fingerprint(raw: Mapping[str, Any]) -> str:
    """A stable id for a row with no id column: a digest of its cells.

    The same row exported twice gives the same digest, so the ledger still
    recognises a re-import; two genuinely identical rows give the same digest
    too, which the shift review reports as a repeated id rather than letting
    one silently swallow the other.
    """
    canonical = json.dumps(
        {str(k): str(v).strip() for k, v in raw.items()},
        sort_keys=True,
        ensure_ascii=True,
    )
    return "row:" + hashlib.sha256(canonical.encode("ascii")).hexdigest()[:32]


# ---------------------------------------------------------------------------
# Routing
# ---------------------------------------------------------------------------


@dataclass
class Settings:
    column_mapping: Mapping[str, str]
    hour_columns: Mapping[str, str]
    call_columns: Mapping[str, str]


@dataclass
class RoutedItem:
    """One record a row will become: one nonzero hours column of it."""

    row_id: str
    line_number: int
    record_type: str
    hours_column: str
    hours_cell: str
    minutes: int
    source_id: str
    local_date: Optional[date]
    # Clock times as the shift review should read them, after clean-up.
    start_cell: str = ""
    end_cell: str = ""
    # ``(kind, message)`` for each clean-up applied: ``next_day``,
    # ``hours_differ``, ``past_midnight``.
    notes: List[Tuple[str, str]] = field(default_factory=list)

    @property
    def note_text(self) -> str:
        return " ".join(message for _, message in self.notes)


@dataclass
class RowRouting:
    row_id: str
    line_number: int
    items: List[RoutedItem] = field(default_factory=list)
    skipped_reason: Optional[str] = None
    errors: List[str] = field(default_factory=list)


@dataclass
class RowInput:
    id: str
    line_number: int
    raw: Mapping[str, Any]


def _cell(raw: Mapping[str, Any], header: Optional[str]) -> str:
    if not header:
        return ""
    value = raw.get(header)
    return "" if value is None else str(value).strip()


_PAST_MIDNIGHT_RE = re.compile(r"^(?P<h>\d{1,2})(?P<m>\d{2})$")


def normalize_clock_cell(value: str) -> Tuple[str, bool]:
    """A military time written past midnight, read as the next day's clock.

    Some systems record a shift running past midnight as ``2430`` rather than
    ``0030``, keeping the entry on the day it started. Returns the cell with
    the hour brought back under 24, and whether that was needed. ``2400`` is
    included: as a start it means the first minute of the next day.
    """
    match = _PAST_MIDNIGHT_RE.match(value.strip())
    if not match:
        return value, False
    hour, minute = int(match["h"]), int(match["m"])
    if not 24 <= hour < 48 or minute > 59:
        return value, False
    return f"{hour - 24:02d}{minute:02d}", True


def route_row(row: RowInput, settings: Settings) -> RowRouting:
    routing = RowRouting(row_id=row.id, line_number=row.line_number)
    mapping = settings.column_mapping
    source_id = _cell(row.raw, mapping.get("source_id")) or fingerprint(row.raw)
    if len(source_id) > 90:
        routing.errors.append(
            "The source row id is longer than 90 characters, so it cannot be "
            "recorded."
        )

    date_cell = _cell(row.raw, mapping.get("date"))
    local_date = parse_date_cell(date_cell) if date_cell else None
    if date_cell and local_date is None:
        routing.errors.append(f"Date '{date_cell}' is not a date.")

    raw_start = _cell(row.raw, mapping.get("start_time"))
    raw_end = _cell(row.raw, mapping.get("end_time"))
    start_cell, start_rolled = normalize_clock_cell(raw_start)
    end_cell, end_rolled = normalize_clock_cell(raw_end)
    start = shift_engine.parse_clock(start_cell)
    end = shift_engine.parse_clock(end_cell)
    clean_up: List[Tuple[str, str]] = []
    if start_rolled and start is not None:
        # The entry is filed under the day it began, so a start past
        # midnight belongs to the next day; the end follows it.
        if local_date is not None:
            local_date += timedelta(days=1)
        clean_up.append(
            (
                "past_midnight",
                f"Start time {raw_start} read as {start_cell} the next day.",
            )
        )
    if end_rolled and end is not None:
        clean_up.append(("past_midnight", f"End time {raw_end} read as {end_cell}."))

    nonzero: List[Tuple[str, str, str, float]] = []
    for header, record_type in settings.hour_columns.items():
        if record_type == IGNORE:
            continue
        cell = _cell(row.raw, header)
        if not cell:
            continue
        try:
            hours = float(cell)
        except ValueError:
            routing.errors.append(f"{header} '{cell}' is not a number of hours.")
            continue
        if hours < 0:
            routing.errors.append(f"{header} '{cell}' is negative.")
            continue
        if hours > 0:
            nonzero.append((header, record_type, cell, hours))

    if not nonzero:
        if not routing.errors:
            routing.skipped_reason = "No hours recorded."
        return routing

    for header, record_type, cell, hours in nonzero:
        minutes = int(round(hours * 60))
        item = RoutedItem(
            row_id=row.id,
            line_number=row.line_number,
            record_type=record_type,
            hours_column=header,
            hours_cell=cell,
            minutes=minutes,
            # A row with hours in two columns becomes two records, each needing
            # its own ledger key; a row with one keeps the source id as is.
            source_id=(
                f"{source_id}#{header}"[:100] if len(nonzero) > 1 else source_id
            ),
            local_date=local_date,
            start_cell=start_cell,
            end_cell=end_cell,
            notes=list(clean_up),
        )
        if start is not None and end is not None:
            span = _span_minutes(start, end)
            if end <= start:
                item.notes.append(("next_day", "Ends the next day."))
            if abs(span - minutes) > _SPAN_TOLERANCE_MINUTES:
                item.notes.append(
                    (
                        "hours_differ",
                        f"Recorded hours ({_format_hours(minutes)}) used "
                        f"instead of the clock times ({_format_hours(span)} h).",
                    )
                )
        routing.items.append(item)
    return routing


def route_rows(rows: Sequence[RowInput], settings: Settings) -> List[RowRouting]:
    return [route_row(r, settings) for r in rows]


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

_EXAMPLES_PER_KIND = 20


@dataclass
class TypeTotals:
    records: int = 0
    minutes: int = 0
    first_date: Optional[date] = None
    last_date: Optional[date] = None


def summarize(routings: Sequence[RowRouting]) -> Dict[str, Any]:
    """Counts per record type, plus examples of every problem and clean-up."""
    totals: Dict[str, TypeTotals] = {
        t: TypeTotals() for t in RECORD_TYPES if t != IGNORE
    }
    skipped = 0
    errors: List[Dict[str, Any]] = []
    error_count = 0
    notes: Dict[str, Dict[str, Any]] = {}
    for routing in routings:
        if routing.skipped_reason:
            skipped += 1
        if routing.errors:
            error_count += 1
            if len(errors) < _EXAMPLES_PER_KIND * 5:
                errors.append(
                    {"line_number": routing.line_number, "messages": routing.errors}
                )
        for item in routing.items:
            bucket = totals[item.record_type]
            bucket.records += 1
            bucket.minutes += item.minutes
            if item.local_date is not None:
                if bucket.first_date is None or item.local_date < bucket.first_date:
                    bucket.first_date = item.local_date
                if bucket.last_date is None or item.local_date > bucket.last_date:
                    bucket.last_date = item.local_date
            for kind, note in item.notes:
                entry = notes.setdefault(kind, {"count": 0, "examples": []})
                entry["count"] += 1
                if len(entry["examples"]) < _EXAMPLES_PER_KIND:
                    entry["examples"].append(
                        {"line_number": item.line_number, "message": note}
                    )
    return {
        "rows": len(routings),
        "skipped": skipped,
        "with_errors": error_count,
        "errors": errors,
        "notes": notes,
        "types": {
            name: {
                "records": t.records,
                "hours": round(t.minutes / 60, 2),
                # ISO strings: the summary is stored in a JSON column.
                "first_date": t.first_date.isoformat() if t.first_date else None,
                "last_date": t.last_date.isoformat() if t.last_date else None,
            }
            for name, t in totals.items()
        },
    }


# ---------------------------------------------------------------------------
# Shift batches
# ---------------------------------------------------------------------------


@dataclass
class ShiftBatch:
    label: str
    rows: List[Tuple[int, Dict[str, str]]]


def shift_row(
    raw: Mapping[str, Any], item: RoutedItem, settings: Settings
) -> Dict[str, str]:
    """A routed item as a row of the shift history import, in its own field
    names, so the shift review needs no column mapping of its own."""
    mapping = settings.column_mapping
    values: Dict[str, str] = {}
    for field_name in _SHIFT_PASSTHROUGH:
        if mapping.get(field_name):
            values[field_name] = _cell(raw, mapping[field_name])
    if mapping.get("start_time"):
        values["start_time"] = item.start_cell
    if mapping.get("end_time"):
        values["end_time"] = item.end_cell
    if mapping.get("date"):
        values["date"] = (
            item.local_date.isoformat()
            if item.local_date is not None
            else _cell(raw, mapping["date"])
        )
    values["hours"] = item.hours_cell
    values["duty_type"] = (
        shift_engine.DUTY_ON_CALL
        if item.record_type == ON_CALL
        else shift_engine.DUTY_IN_STATION
    )
    values["source_id"] = item.source_id
    for header, slug in settings.call_columns.items():
        values[shift_engine.call_type_field(slug)] = _cell(raw, header)
    return values


def shift_column_mapping(settings: Settings) -> Dict[str, str]:
    """The identity mapping a batch is created with: every field it carries
    is a column of the same name."""
    fields = [f for f in _SHIFT_PASSTHROUGH if settings.column_mapping.get(f)]
    if settings.column_mapping.get("date"):
        fields.append("date")
    fields.extend(["hours", "duty_type", "source_id"])
    fields.extend(
        shift_engine.call_type_field(slug) for slug in settings.call_columns.values()
    )
    return {f: f for f in fields}


def build_shift_batches(
    rows: Sequence[RowInput],
    routings: Sequence[RowRouting],
    settings: Settings,
    already_imported: frozenset = frozenset(),
    target_rows: int = SHIFT_BATCH_TARGET_ROWS,
) -> List[ShiftBatch]:
    """Shift and on-call items as review batches, oldest first.

    Months are kept whole — a shift crossing midnight on the last of the month
    is grouped by its start date, so a month boundary never splits a crew —
    and consecutive months are packed until a batch reaches ``target_rows``.
    Items the ledger already holds are left out: they were imported before,
    and a batch of nothing but repeats is noise. Items with no readable date
    go in a final batch of their own, where the shift review reports them.
    """
    raw_by_id = {r.id: r.raw for r in rows}
    by_month: Dict[Tuple[int, int], List[Tuple[int, Dict[str, str]]]] = {}
    undated: List[Tuple[int, Dict[str, str]]] = []
    for routing in routings:
        for item in routing.items:
            if item.record_type not in SHIFT_TYPES:
                continue
            if item.source_id in already_imported:
                continue
            entry = (
                item.line_number,
                shift_row(raw_by_id.get(item.row_id, {}), item, settings),
            )
            if item.local_date is None:
                undated.append(entry)
            else:
                key = (item.local_date.year, item.local_date.month)
                by_month.setdefault(key, []).append(entry)

    batches: List[ShiftBatch] = []
    current: List[Tuple[int, Dict[str, str]]] = []
    first: Optional[Tuple[int, int]] = None
    last: Optional[Tuple[int, int]] = None

    def flush() -> None:
        if current and first is not None and last is not None:
            batches.append(
                ShiftBatch(label=_month_range(first, last), rows=list(current))
            )

    for month in sorted(by_month):
        entries = by_month[month]
        if len(entries) > shift_engine.MAX_IMPORT_ROWS:
            raise ValueError(
                f"{month[0]}-{month[1]:02d} has {len(entries):,} shift rows, more "
                f"than one review batch can hold ({shift_engine.MAX_IMPORT_ROWS:,})."
            )
        if current and len(current) + len(entries) > target_rows:
            flush()
            current, first = [], None
        if first is None:
            first = month
        last = month
        current.extend(entries)
    flush()
    if undated:
        batches.append(ShiftBatch(label="rows without a date", rows=undated))
    return batches


def _month_range(first: Tuple[int, int], last: Tuple[int, int]) -> str:
    start = f"{first[0]}-{first[1]:02d}"
    end = f"{last[0]}-{last[1]:02d}"
    return start if start == end else f"{start} to {end}"


# ---------------------------------------------------------------------------
# Administrative hours
# ---------------------------------------------------------------------------

ADMIN_TYPES: Tuple[str, ...] = (ADMIN,)

# A flag column is "set" when its cell reads as yes. Exports write booleans as
# 1/0, Yes/No, True/False or an X in the box.
_TRUTHY = frozenset({"1", "true", "yes", "y", "x", "t"})


def is_flag_set(value: Any) -> bool:
    return str(value or "").strip().casefold() in _TRUTHY


@dataclass
class AdminSettings:
    """How administrative rows become Admin Hours entries."""

    description_columns: Sequence[str] = ()
    # ``(column, category_id)`` in priority order: the first set flag wins.
    flag_categories: Sequence[Tuple[str, str]] = ()
    # Hours column -> the category its rows take when no flag is set.
    default_categories: Mapping[str, str] = field(default_factory=dict)

    @classmethod
    def from_stored(cls, value: Any) -> "AdminSettings":
        """Read the stored JSON defensively: it is unvalidated once stored,
        and a malformed entry should drop that one rule, not the import."""
        if not isinstance(value, Mapping):
            return cls()
        columns = [
            str(c) for c in value.get("description_columns") or [] if str(c or "")
        ]
        flags: List[Tuple[str, str]] = []
        for rule in value.get("flag_categories") or []:
            if (
                isinstance(rule, Mapping)
                and rule.get("column")
                and rule.get("category_id")
            ):
                flags.append((str(rule["column"]), str(rule["category_id"])))
        defaults_raw = value.get("default_categories")
        defaults = (
            {str(k): str(v) for k, v in defaults_raw.items() if k and v}
            if isinstance(defaults_raw, Mapping)
            else {}
        )
        return cls(
            description_columns=columns,
            flag_categories=flags,
            default_categories=defaults,
        )

    def to_stored(self) -> Dict[str, Any]:
        return {
            "description_columns": list(self.description_columns),
            "flag_categories": [
                {"column": column, "category_id": category}
                for column, category in self.flag_categories
            ],
            "default_categories": dict(self.default_categories),
        }


def admin_category(
    raw: Mapping[str, Any], item: RoutedItem, settings: AdminSettings
) -> Optional[str]:
    """The category an administrative row goes to: the first flag rule whose
    column is set, else the default for the column its hours are in."""
    for column, category in settings.flag_categories:
        if is_flag_set(raw.get(column)):
            return category
    return settings.default_categories.get(item.hours_column)


def admin_description(raw: Mapping[str, Any], settings: AdminSettings) -> str:
    """The first non-empty description column, trimmed."""
    for column in settings.description_columns:
        text = _cell(raw, column)
        if text:
            return text
    return ""


def flag_conflicts(
    rows: Sequence[RowInput],
    routings: Sequence[RowRouting],
    settings: AdminSettings,
) -> int:
    """Administrative rows with more than one flag rule set, where the rule
    order decides the category."""
    raw_by_id = {r.id: r.raw for r in rows}
    count = 0
    for routing in routings:
        raw = raw_by_id.get(routing.row_id, {})
        for item in routing.items:
            if item.record_type not in ADMIN_TYPES:
                continue
            hits = sum(
                1
                for column, _ in settings.flag_categories
                if is_flag_set(raw.get(column))
            )
            if hits > 1:
                count += 1
    return count


def member_values(raw: Mapping[str, Any], settings: Settings) -> Dict[str, str]:
    """The member fields of a row, under the shift import's field names, so a
    member is keyed exactly as the shift review keys them and the decisions
    made there apply here."""
    values = {f: "" for f in shift_engine.FIELDS}
    for field_name in (
        "membership_number",
        "member_name",
        "first_name",
        "last_name",
        "email",
    ):
        values[field_name] = _cell(raw, settings.column_mapping.get(field_name))
    return values


def entry_span(item: RoutedItem, tz: Any) -> Optional[Tuple[datetime, datetime]]:
    """UTC start and end for an entry, read in ``tz``.

    The clock times when the row has both; otherwise the start of the day plus
    the recorded hours. ``None`` when the row has no date. The end is what the
    clock says even when the recorded hours differ: the hours are the credit,
    the times are when it happened.
    """
    if item.local_date is None:
        return None
    start_clock = shift_engine.parse_clock(item.start_cell)
    end_clock = shift_engine.parse_clock(item.end_cell)
    if start_clock is None or end_clock is None:
        begin = datetime.combine(item.local_date, time(0, 0))
        finish = begin + timedelta(minutes=item.minutes)
    else:
        begin = datetime.combine(item.local_date, start_clock)
        finish = datetime.combine(item.local_date, end_clock)
        if finish <= begin:
            finish += timedelta(days=1)
    return (
        shift_engine.localize(begin.date(), begin.time(), tz),
        shift_engine.localize(finish.date(), finish.time(), tz),
    )
