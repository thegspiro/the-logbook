"""
The decisions a shift history import makes, as pure functions.

Everything here works on plain values the service has already loaded, so the
rules a department's years of history are judged by can be tested without a
database, and so a draft can be re-analysed after every edit without
remembering intermediate results that an edit would invalidate.

The pipeline, in order — the order is load-bearing:

1. **Parse** each row's cells into a member identity, a unit, a seat and a
   UTC start/end, read in the import's time zone.
2. **Resolve** who the member is, which unit the vehicle name means and which
   seat the position names, from automatic matches and the reviewer's
   mappings.
3. **Join** one member's back-to-back entries on one unit into a single
   attendance. This runs *before* grouping: the 06:00-07:30 tail of a shift a
   previous system could only log up to 06:00 starts within the grouping
   tolerance of the next day's 07:00 shift, and grouped first it would put
   the member on the wrong crew.
4. **Group** attendances on the same unit and day into proposed shifts, with
   a confidence score for each join.
5. **Match** each proposed shift against shifts already on the schedule, and
   each outside-agency entry against hours already logged, so re-importing a
   file or importing after go-live does not create duplicates.
"""

import re
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple
from zoneinfo import ZoneInfo

from app.utils.positions import CANONICAL_POSITIONS, canonical_position

# ---------------------------------------------------------------------------
# Tunables. Agreed with the department owner when the feature was specified.
# ---------------------------------------------------------------------------

MAX_IMPORT_ROWS = 10_000

# Two rows are the same shift only when their start and end times sit within
# this of each other; the confidence falls linearly to zero at the edge.
MATCH_TOLERANCE_MINUTES = 120
# A join scoring at or above this is made without asking.
AUTO_MATCH_CONFIDENCE = 90
# A join scoring at or above this, but below the automatic band, is proposed
# and held for the reviewer to confirm or split. Below it, a separate shift.
PROBABLE_MATCH_CONFIDENCE = 60
# Start time decides more than end time: crews start together and leave as
# calls and relief allow.
_START_WEIGHT = 0.6
_END_WEIGHT = 0.4

# Consecutive entries for one member on one unit separated by no more than
# this are one stretch on duty, logged in pieces.
JOIN_GAP_MINUTES = 30

# One row is at most one day; a joined attendance may run past it. Longer is a
# data error rather than a shift. External hours carry the same 48h ceiling as
# a database constraint.
MAX_ATTENDANCE_MINUTES = 48 * 60

MAX_CALL_COUNT = 500

# ---------------------------------------------------------------------------
# Columns
# ---------------------------------------------------------------------------

FIELDS: Tuple[str, ...] = (
    "member_name",
    "first_name",
    "last_name",
    "membership_number",
    "email",
    "username",
    "unit",
    "agency",
    "position",
    "date",
    "start_time",
    "end_time",
    "call_count",
    "status",
)

# What the downloadable template's header row carries. ``first_name`` /
# ``last_name`` are accepted on upload but the template uses one name column.
TEMPLATE_HEADERS: Tuple[str, ...] = (
    "member_name",
    "membership_number",
    "email",
    "username",
    "unit",
    "agency",
    "position",
    "date",
    "start_time",
    "end_time",
    "call_count",
    "status",
)

# Header spellings recognised per field, compared after ``normalize_header``.
# Ordered most specific first; a header is assigned to at most one field.
HEADER_ALIASES: Dict[str, Tuple[str, ...]] = {
    "member_name": (
        "member_name",
        "name",
        "full_name",
        "member",
        "employee_name",
        "employee",
        "personnel",
        "firefighter",
    ),
    "first_name": ("first_name", "first", "given_name", "fname"),
    "last_name": ("last_name", "last", "surname", "family_name", "lname"),
    "membership_number": (
        "membership_number",
        "member_number",
        "member_no",
        "member_id",
        "department_id",
        "dept_id",
        "badge_number",
        "badge_no",
        "badge",
        "employee_id",
        "employee_number",
        "id_number",
    ),
    "email": ("email", "e_mail", "email_address", "member_email"),
    "username": ("username", "user_name", "login", "user_id"),
    "unit": (
        "unit",
        "unit_name",
        "unit_number",
        "apparatus",
        "apparatus_name",
        "vehicle",
        "truck",
        "rig",
    ),
    "agency": ("agency", "agency_name", "owner", "owning_agency", "department"),
    "position": ("position", "seat", "riding_position", "role"),
    "date": ("date", "shift_date", "start_date", "day"),
    "start_time": (
        "start_time",
        "start",
        "time_in",
        "in",
        "clock_in",
        "shift_start",
        "from",
    ),
    "end_time": ("end_time", "end", "time_out", "out", "clock_out", "shift_end", "to"),
    "call_count": (
        "call_count",
        "calls",
        "number_of_calls",
        "num_calls",
        "runs",
        "call_total",
    ),
    "status": ("status", "shift_status", "attendance_status"),
}

_FIELD_MAX_LENGTH = {
    "member_name": 200,
    "first_name": 100,
    "last_name": 100,
    "membership_number": 50,
    "email": 255,
    "username": 100,
    "unit": 100,
    "agency": 255,
    "position": 100,
}

# Status values that mean the member did not work the shift. Compared with
# everything but letters removed, so "No-Show", "no show" and "NOSHOW" agree.
_SKIP_STATUSES = frozenset({"cancelled", "canceled", "cancel", "noshow"})


def normalize_header(header: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", header.strip().lower()).strip("_")


def detect_column_mapping(headers: Sequence[str]) -> Dict[str, str]:
    """Which header feeds which field, by recognised spelling."""
    by_normalized: Dict[str, str] = {}
    for header in headers:
        by_normalized.setdefault(normalize_header(header), header)
    mapping: Dict[str, str] = {}
    used: set[str] = set()
    for field_name in FIELDS:
        for alias in HEADER_ALIASES[field_name]:
            found = by_normalized.get(alias)
            if found is not None and found not in used:
                mapping[field_name] = found
                used.add(found)
                break
    return mapping


def effective_values(
    raw: Mapping[str, Any],
    edits: Optional[Mapping[str, Any]],
    column_mapping: Mapping[str, Any],
) -> Dict[str, str]:
    """A row's field values: the reviewer's edit where there is one, else the
    mapped cell, trimmed."""
    values: Dict[str, str] = {}
    for field_name in FIELDS:
        if edits and field_name in edits:
            value = edits[field_name]
        else:
            header = column_mapping.get(field_name)
            value = raw.get(header) if header else None
        values[field_name] = "" if value is None else str(value).strip()
    return values


# ---------------------------------------------------------------------------
# Dates and times
# ---------------------------------------------------------------------------

# Month first: the departments this serves write US dates. ISO is accepted
# everywhere and is what the template asks for.
_DATE_FORMATS = (
    "%Y-%m-%d",
    "%Y/%m/%d",
    "%m/%d/%Y",
    "%m/%d/%y",
    "%m-%d-%Y",
    "%m-%d-%y",
)

_CLOCK_RE = re.compile(
    r"^(?P<h>\d{1,2}):(?P<m>\d{2})(?::(?P<s>\d{2}))?\s*(?P<ampm>[ap]\.?m\.?)?$",
    re.IGNORECASE,
)
_MILITARY_RE = re.compile(r"^(?P<hm>\d{3,4})$")
_HOUR_AMPM_RE = re.compile(r"^(?P<h>\d{1,2})\s*(?P<ampm>[ap]\.?m\.?)$", re.IGNORECASE)


def parse_date(value: str) -> Optional[date]:
    cleaned = value.strip()
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(cleaned, fmt).date()
        except ValueError:
            continue
    return None


def _apply_ampm(hour: int, ampm: Optional[str]) -> Optional[int]:
    if not ampm:
        return hour
    if not 1 <= hour <= 12:
        return None
    is_pm = ampm.lower().startswith("p")
    if hour == 12:
        return 12 if is_pm else 0
    return hour + 12 if is_pm else hour


def parse_clock(value: str) -> Optional[time]:
    """A wall-clock time: ``07:00``, ``7:00 PM``, ``0700``, ``700``, ``7pm``.

    ``24:00`` / ``2400`` read as midnight, which the crossing rule then places
    on the following day when it is an end time.
    """
    cleaned = value.strip()
    hour: Optional[int]
    minute = 0
    match = _CLOCK_RE.match(cleaned)
    if match:
        hour = _apply_ampm(int(match["h"]), match["ampm"])
        minute = int(match["m"])
    elif (military := _MILITARY_RE.match(cleaned)) is not None:
        digits = military["hm"]
        hour, minute = int(digits[:-2]), int(digits[-2:])
    elif (hour_only := _HOUR_AMPM_RE.match(cleaned)) is not None:
        hour = _apply_ampm(int(hour_only["h"]), hour_only["ampm"])
    else:
        return None
    if hour is None or minute > 59:
        return None
    if hour == 24 and minute == 0:
        return time(0, 0)
    if hour > 23:
        return None
    return time(hour, minute)


def parse_time_cell(value: str) -> Tuple[Optional[date], Optional[time]]:
    """A time cell, which some exports fill with a full date and time."""
    cleaned = value.strip()
    clock = parse_clock(cleaned)
    if clock is not None:
        return None, clock
    parts = re.split(r"[\sT]+", cleaned, maxsplit=1)
    if len(parts) == 2:
        day = parse_date(parts[0])
        clock = parse_clock(parts[1])
        if day is not None and clock is not None:
            return day, clock
    return None, None


def localize(day: date, clock: time, tz: ZoneInfo) -> datetime:
    """A local wall-clock reading as a UTC instant.

    ``fold=0`` is the standard rule for the two hours a year the wall clock
    lies: a time skipped by spring-forward reads with the offset in force
    before the change, landing an hour later on the clock; a time repeated by
    fall-back reads as its first occurrence.
    """
    return datetime.combine(day, clock, tzinfo=tz).astimezone(timezone.utc)


# ---------------------------------------------------------------------------
# Identities
# ---------------------------------------------------------------------------


def _squash(value: str) -> str:
    return " ".join(value.split()).casefold()


def split_name(full: str) -> Tuple[str, str]:
    """``"Smith, John A"`` and ``"John A Smith"`` both give ``("John", "Smith")``."""
    cleaned = " ".join(full.split())
    if not cleaned:
        return "", ""
    if "," in cleaned:
        last, rest = (p.strip() for p in cleaned.split(",", 1))
        first = rest.split(" ")[0] if rest else ""
        return first, last
    tokens = cleaned.split(" ")
    if len(tokens) == 1:
        return tokens[0], ""
    return tokens[0], tokens[-1]


@dataclass(frozen=True)
class MemberIdentity:
    display_name: str
    first: str
    last: str
    membership_number: str
    email: str
    username: str

    @property
    def key(self) -> str:
        """One key per person as the file names them, preferring the
        identifier least likely to be shared."""
        if self.membership_number:
            return f"number:{_squash(self.membership_number)}"
        if self.email:
            return f"email:{_squash(self.email)}"
        if self.username:
            return f"username:{_squash(self.username)}"
        return f"name:{_squash(self.first)} {_squash(self.last)}".rstrip()

    @property
    def has_any(self) -> bool:
        return bool(
            self.first
            or self.last
            or self.membership_number
            or self.email
            or self.username
        )


def identity_from_values(values: Mapping[str, str]) -> MemberIdentity:
    first, last = values.get("first_name", ""), values.get("last_name", "")
    full = values.get("member_name", "")
    if not (first or last) and full:
        first, last = split_name(full)
    display = full or " ".join(p for p in (first, last) if p)
    return MemberIdentity(
        display_name=display,
        first=first,
        last=last,
        membership_number=values.get("membership_number", ""),
        email=values.get("email", ""),
        username=values.get("username", ""),
    )


def unit_key(unit: str, agency: str) -> str:
    return f"{_squash(agency)}|{_squash(unit)}"


def position_key(position: str) -> str:
    return _squash(position)


# ---------------------------------------------------------------------------
# Parsed rows
# ---------------------------------------------------------------------------


@dataclass
class RowInput:
    id: str
    line_number: int
    raw: Mapping[str, Any]
    edits: Optional[Mapping[str, Any]]
    excluded: bool
    match_decision: Optional[str]
    keep_separate: bool = False


@dataclass
class Issue:
    code: str
    message: str
    blocking: bool
    row_ids: List[str] = field(default_factory=list)
    ref: Optional[str] = None


@dataclass
class ParsedRow:
    id: str
    line_number: int
    values: Dict[str, str]
    excluded: bool
    match_decision: Optional[str]
    identity: MemberIdentity
    unit_key: str
    position_key: str
    start: Optional[datetime] = None
    end: Optional[datetime] = None
    local_date: Optional[date] = None
    call_count: Optional[int] = None
    skipped_reason: Optional[str] = None
    errors: List[str] = field(default_factory=list)
    keep_separate: bool = False

    @property
    def active(self) -> bool:
        """Takes part in grouping: not excluded, not skipped, and parsed."""
        return not self.excluded and not self.skipped_reason and not self.errors

    @property
    def minutes(self) -> Optional[int]:
        if self.start is None or self.end is None:
            return None
        return int(round((self.end - self.start).total_seconds() / 60))


def _parse_timing(values: Mapping[str, str], tz: ZoneInfo, row: ParsedRow) -> None:
    start_day, start_clock = parse_time_cell(values["start_time"])
    end_day, end_clock = parse_time_cell(values["end_time"])
    if values["start_time"] and start_clock is None:
        row.errors.append(f"Start time '{values['start_time']}' is not a time.")
    if values["end_time"] and end_clock is None:
        row.errors.append(f"End time '{values['end_time']}' is not a time.")
    if values["date"]:
        column_day = parse_date(values["date"])
        if column_day is None:
            row.errors.append(
                f"Date '{values['date']}' is not a date. Use YYYY-MM-DD or MM/DD/YYYY."
            )
        start_day = start_day or column_day
    if start_clock is None or end_clock is None or start_day is None:
        return

    start_local = datetime.combine(start_day, start_clock)
    if end_day is not None:
        end_local = datetime.combine(end_day, end_clock)
        if end_local <= start_local:
            row.errors.append("The end is not after the start.")
            return
    else:
        end_local = datetime.combine(start_day, end_clock)
        # An end at or before the start crossed midnight: 07:00 to 06:00 is
        # 23 hours, and 07:00 to 07:00 a full 24-hour shift.
        if end_local <= start_local:
            end_local += timedelta(days=1)

    row.local_date = start_day
    row.start = localize(start_local.date(), start_local.time(), tz)
    row.end = localize(end_local.date(), end_local.time(), tz)
    minutes = row.minutes or 0
    if minutes <= 0:
        # Only reachable across a DST change that swallows a very short row.
        row.errors.append("The end is not after the start.")
    elif minutes > MAX_ATTENDANCE_MINUTES:
        row.errors.append("A single row cannot be longer than 48 hours.")


def parse_row(
    row: RowInput,
    column_mapping: Mapping[str, Any],
    tz: ZoneInfo,
    now: datetime,
) -> ParsedRow:
    values = effective_values(row.raw, row.edits, column_mapping)
    identity = identity_from_values(values)
    parsed = ParsedRow(
        id=row.id,
        line_number=row.line_number,
        values=values,
        excluded=row.excluded,
        match_decision=row.match_decision,
        keep_separate=row.keep_separate,
        identity=identity,
        unit_key=unit_key(values["unit"], values["agency"]),
        position_key=position_key(values["position"]),
    )

    status = re.sub(r"[^a-z]", "", values["status"].casefold())
    if status in _SKIP_STATUSES:
        parsed.skipped_reason = f"Marked '{values['status']}' in the file."
        return parsed

    for field_name, limit in _FIELD_MAX_LENGTH.items():
        if len(values[field_name]) > limit:
            parsed.errors.append(
                f"{field_name.replace('_', ' ').capitalize()} is longer than "
                f"{limit} characters."
            )
    if not identity.has_any:
        parsed.errors.append(
            "No member: give a name, membership number, email or username."
        )
    if values["email"] and not re.fullmatch(
        r"[^@\s]+@[^@\s]+\.[^@\s]+", values["email"]
    ):
        parsed.errors.append(f"Email '{values['email']}' is not an email address.")
    if not values["unit"]:
        parsed.errors.append("No unit.")
    if not values["start_time"]:
        parsed.errors.append("No start time.")
    if not values["end_time"]:
        parsed.errors.append("No end time.")
    if not values["date"] and not parse_time_cell(values["start_time"])[0]:
        parsed.errors.append("No date.")

    _parse_timing(values, tz, parsed)
    if parsed.end is not None and parsed.end > now:
        parsed.errors.append("The shift has not ended yet; only past shifts import.")

    if values["call_count"]:
        try:
            calls = float(values["call_count"])
        except ValueError:
            calls = -1.0
        if calls < 0 or calls != int(calls) or calls > MAX_CALL_COUNT:
            parsed.errors.append(
                f"Call count '{values['call_count']}' is not a whole number "
                f"from 0 to {MAX_CALL_COUNT}."
            )
        else:
            parsed.call_count = int(calls)
    return parsed


def parse_rows(
    rows: Iterable[RowInput],
    column_mapping: Mapping[str, Any],
    tz: ZoneInfo,
    now: datetime,
) -> List[ParsedRow]:
    return [parse_row(r, column_mapping, tz, now) for r in rows]


# ---------------------------------------------------------------------------
# Directories: what the department already has, loaded by the service
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class MemberRecord:
    id: str
    first_name: str
    last_name: str
    preferred_name: str
    membership_number: str
    email: str
    personal_email: str
    username: str
    status: str

    @property
    def display_name(self) -> str:
        return " ".join(p for p in (self.first_name, self.last_name) if p)


@dataclass(frozen=True)
class OwnUnit:
    id: str
    unit_number: str
    name: str


@dataclass(frozen=True)
class ExternalUnit:
    id: str
    name: str
    agency_id: str
    agency_name: str


@dataclass(frozen=True)
class ExistingShift:
    id: str
    apparatus_id: str
    shift_date: date
    start: datetime
    end: Optional[datetime]
    attendee_ids: frozenset


@dataclass(frozen=True)
class ExistingExternalEntry:
    user_id: str
    external_apparatus_id: Optional[str]
    shift_date: date
    start: Optional[datetime]
    end: Optional[datetime]


@dataclass
class AnalysisContext:
    organization_name: str
    members: Sequence[MemberRecord]
    own_units: Sequence[OwnUnit]
    external_units: Sequence[ExternalUnit]
    department_seats: Sequence[str]
    member_mappings: Mapping[str, Any]
    unit_mappings: Mapping[str, Any]
    position_mappings: Mapping[str, Any]
    existing_shift_decisions: Mapping[str, Any]
    existing_shifts: Sequence[ExistingShift] = ()
    existing_external: Sequence[ExistingExternalEntry] = ()
    # Every member record the department's unique indexes still cover,
    # removed members included: a new member may not take an email, username
    # or membership number from one of those either. Defaults to ``members``.
    identifier_holders: Sequence[MemberRecord] = ()
    # Decisions committed with earlier imports, keyed like the draft's own.
    # They apply only where the draft has made no decision of its own.
    saved_member_mappings: Mapping[str, Any] = field(default_factory=dict)
    saved_unit_mappings: Mapping[str, Any] = field(default_factory=dict)
    saved_position_mappings: Mapping[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Resolution
# ---------------------------------------------------------------------------

MEMBER_MATCHED = "matched"
MEMBER_CONFLICT = "conflict"
MEMBER_AMBIGUOUS = "ambiguous"
MEMBER_UNMATCHED = "unmatched"
MEMBER_MAPPED = "mapped"
MEMBER_CREATE = "create"

UNIT_MATCHED = "matched"
UNIT_AMBIGUOUS = "ambiguous"
UNIT_UNMATCHED = "unmatched"
UNIT_MAPPED = "mapped"

POSITION_MATCHED = "matched"
POSITION_UNMATCHED = "unmatched"
POSITION_MAPPED = "mapped"

OWN = "own"
EXTERNAL = "external"
NEW_EXTERNAL = "new_external"

DEFAULT_SEAT = "firefighter"


@dataclass
class MemberResolution:
    key: str
    identity: MemberIdentity
    status: str
    user_id: Optional[str] = None
    candidate_ids: List[str] = field(default_factory=list)
    reason: str = ""
    row_ids: List[str] = field(default_factory=list)
    # Settled by a decision remembered from an earlier import.
    remembered: bool = False

    @property
    def ref(self) -> Optional[str]:
        """Who the rows are, once decided: a user id, or ``new:<key>`` for a
        member the commit will create."""
        if self.status in (MEMBER_MATCHED, MEMBER_MAPPED) and self.user_id:
            return self.user_id
        if self.status == MEMBER_CREATE:
            return f"new:{self.key}"
        return None


@dataclass
class UnitResolution:
    key: str
    unit: str
    agency: str
    status: str
    target_kind: Optional[str] = None
    target_id: Optional[str] = None
    candidates: List[Tuple[str, str]] = field(default_factory=list)
    new_agency_name: str = ""
    new_unit_name: str = ""
    row_ids: List[str] = field(default_factory=list)
    remembered: bool = False

    @property
    def ref(self) -> Optional[Tuple[str, str]]:
        if self.target_kind is None:
            return None
        if self.target_kind == NEW_EXTERNAL:
            return (NEW_EXTERNAL, self.key)
        return (self.target_kind, self.target_id or "")


@dataclass
class PositionResolution:
    key: str
    source: str
    status: str
    seat: Optional[str] = None
    row_ids: List[str] = field(default_factory=list)
    remembered: bool = False


def _names_compatible(identity: MemberIdentity, record: MemberRecord) -> bool:
    """Whether a row matched by an identifier plausibly names the same person.

    Only the surname is compared: a nickname or initial in the file is normal,
    a different surname behind the same badge number is the reused-number
    case that has to go to a person.
    """
    if not identity.last and not identity.first:
        return True
    surname = _squash(identity.last or identity.first)
    return surname in {_squash(record.last_name), _squash(record.first_name)}


def auto_match_member(
    identity: MemberIdentity, members: Sequence[MemberRecord]
) -> MemberResolution:
    resolution = MemberResolution(
        key=identity.key, identity=identity, status=MEMBER_UNMATCHED
    )
    lookups = (
        (
            "membership number",
            identity.membership_number,
            lambda m: [m.membership_number],
        ),
        ("email", identity.email, lambda m: [m.email, m.personal_email]),
        ("username", identity.username, lambda m: [m.username]),
    )
    for label, wanted, fields_of in lookups:
        if not wanted:
            continue
        hits = [
            m
            for m in members
            if any(v and _squash(v) == _squash(wanted) for v in fields_of(m))
        ]
        if not hits:
            continue
        record = hits[0]
        if len(hits) == 1 and _names_compatible(identity, record):
            resolution.status = MEMBER_MATCHED
            resolution.user_id = record.id
            return resolution
        resolution.status = MEMBER_CONFLICT
        resolution.candidate_ids = [h.id for h in hits]
        resolution.reason = (
            f"The {label} '{wanted}' belongs to {record.display_name}, but the "
            f"file names '{identity.display_name}'."
        )
        return resolution

    if identity.first or identity.last:
        wanted_first, wanted_last = _squash(identity.first), _squash(identity.last)
        hits = [
            m
            for m in members
            if _squash(m.last_name) == wanted_last
            and wanted_first in {_squash(m.first_name), _squash(m.preferred_name)}
        ]
        if len(hits) == 1:
            resolution.status = MEMBER_MATCHED
            resolution.user_id = hits[0].id
        elif hits:
            resolution.status = MEMBER_AMBIGUOUS
            resolution.candidate_ids = [h.id for h in hits]
            resolution.reason = (
                f"{len(hits)} members are named '{identity.display_name}'."
            )
    return resolution


def resolve_member(
    identity: MemberIdentity,
    members: Sequence[MemberRecord],
    mapping: Any,
) -> MemberResolution:
    resolution = auto_match_member(identity, members)
    if not isinstance(mapping, Mapping):
        return resolution
    action = mapping.get("action")
    if action == "map":
        user_id = str(mapping.get("user_id") or "")
        if any(m.id == user_id for m in members):
            resolution.status = MEMBER_MAPPED
            resolution.user_id = user_id
            resolution.reason = ""
    elif action == "create":
        resolution.status = MEMBER_CREATE
        resolution.user_id = None
        resolution.reason = ""
    return resolution


def auto_match_unit(
    unit: str,
    agency: str,
    organization_name: str,
    own_units: Sequence[OwnUnit],
    external_units: Sequence[ExternalUnit],
) -> UnitResolution:
    """Exact names only: ``A106`` and ``A106E`` are different vehicles."""
    resolution = UnitResolution(
        key=unit_key(unit, agency), unit=unit, agency=agency, status=UNIT_UNMATCHED
    )
    wanted = _squash(unit)
    wanted_agency = _squash(agency)
    is_own_agency = not wanted_agency or wanted_agency == _squash(organization_name)

    candidates: List[Tuple[str, str]] = []
    if is_own_agency:
        candidates.extend(
            (OWN, u.id)
            for u in own_units
            if wanted in {_squash(u.unit_number), _squash(u.name)}
        )
    if not wanted_agency or not is_own_agency:
        candidates.extend(
            (EXTERNAL, u.id)
            for u in external_units
            if _squash(u.name) == wanted
            and (not wanted_agency or _squash(u.agency_name) == wanted_agency)
        )
    if len(candidates) == 1:
        resolution.status = UNIT_MATCHED
        resolution.target_kind, resolution.target_id = candidates[0]
    elif candidates:
        resolution.status = UNIT_AMBIGUOUS
        resolution.candidates = candidates
    return resolution


def resolve_unit(
    unit: str,
    agency: str,
    context: AnalysisContext,
    mapping: Any,
) -> UnitResolution:
    resolution = auto_match_unit(
        unit,
        agency,
        context.organization_name,
        context.own_units,
        context.external_units,
    )
    if not isinstance(mapping, Mapping):
        return resolution
    action = mapping.get("action")
    target = str(mapping.get("id") or "")
    if action == OWN and any(u.id == target for u in context.own_units):
        resolution.status, resolution.target_kind = UNIT_MAPPED, OWN
        resolution.target_id = target
    elif action == EXTERNAL and any(u.id == target for u in context.external_units):
        resolution.status, resolution.target_kind = UNIT_MAPPED, EXTERNAL
        resolution.target_id = target
    elif action == "create_external":
        agency_name = str(mapping.get("agency_name") or "").strip()
        unit_name = str(mapping.get("unit_name") or "").strip()
        if agency_name and unit_name:
            resolution.status, resolution.target_kind = UNIT_MAPPED, NEW_EXTERNAL
            resolution.target_id = None
            resolution.new_agency_name = agency_name
            resolution.new_unit_name = unit_name
    return resolution


def resolve_position(
    source: str, department_seats: Sequence[str], mapping: Any
) -> PositionResolution:
    key = position_key(source)
    if isinstance(mapping, Mapping) and mapping.get("seat"):
        return PositionResolution(
            key=key, source=source, status=POSITION_MAPPED, seat=str(mapping["seat"])
        )
    if not key:
        return PositionResolution(
            key=key, source=source, status=POSITION_MATCHED, seat=DEFAULT_SEAT
        )
    canonical = canonical_position(source)
    if canonical.casefold() in CANONICAL_POSITIONS:
        return PositionResolution(
            key=key, source=source, status=POSITION_MATCHED, seat=canonical
        )
    for seat in department_seats:
        if _squash(seat) == key:
            return PositionResolution(
                key=key, source=source, status=POSITION_MATCHED, seat=seat
            )
    return PositionResolution(key=key, source=source, status=POSITION_UNMATCHED)


# ---------------------------------------------------------------------------
# Joining, grouping and matching
# ---------------------------------------------------------------------------


def match_confidence(
    a_start: datetime,
    a_end: Optional[datetime],
    b_start: datetime,
    b_end: Optional[datetime],
) -> int:
    """How sure, 0-100, that two time spans on one unit and day are one shift."""
    window = MATCH_TOLERANCE_MINUTES * 60

    def closeness(a: datetime, b: datetime) -> float:
        return max(0.0, 1.0 - abs((a - b).total_seconds()) / window)

    score = _START_WEIGHT * closeness(a_start, b_start)
    if a_end is not None and b_end is not None:
        score += _END_WEIGHT * closeness(a_end, b_end)
    return int(round(score * 100))


@dataclass
class Attendance:
    """One member's continuous stretch on one unit, from one or more rows."""

    key: str
    rows: List[ParsedRow]
    member_ref: str
    unit_ref: Tuple[str, str]
    seat: str
    role: str
    start: datetime
    end: datetime
    local_date: date
    call_count: Optional[int]
    confidence: int = 100
    needs_confirmation: bool = False
    duplicate_existing: bool = False

    @property
    def joined(self) -> bool:
        return len(self.rows) > 1

    @property
    def minutes(self) -> int:
        return int(round((self.end - self.start).total_seconds() / 60))

    @property
    def seed(self) -> ParsedRow:
        return self.rows[0]


EXISTING_NONE = "none"
EXISTING_AUTO = "auto"
EXISTING_PENDING = "pending"
EXISTING_ACCEPTED = "accepted"
EXISTING_SEPARATED = "separated"


@dataclass
class ProposedShift:
    key: str
    apparatus_id: str
    shift_date: date
    anchor_start: datetime
    anchor_end: datetime
    attendances: List[Attendance] = field(default_factory=list)
    existing_shift_id: Optional[str] = None
    existing_confidence: Optional[int] = None
    existing_status: str = EXISTING_NONE

    @property
    def start(self) -> datetime:
        return min(a.start for a in self.attendances)

    @property
    def end(self) -> datetime:
        return max(a.end for a in self.attendances)

    @property
    def attaches_to_existing(self) -> bool:
        return self.existing_status in (EXISTING_AUTO, EXISTING_ACCEPTED)


@dataclass
class Analysis:
    rows: List[ParsedRow]
    members: List[MemberResolution]
    units: List[UnitResolution]
    positions: List[PositionResolution]
    shifts: List[ProposedShift]
    external: List[Attendance]
    issues: List[Issue]

    @property
    def blocking_issue_count(self) -> int:
        return sum(1 for i in self.issues if i.blocking)

    @property
    def can_commit(self) -> bool:
        has_work = next(iter(self.committable_attendances()), None) is not None
        return self.blocking_issue_count == 0 and has_work

    def committable_attendances(self) -> Iterable[Attendance]:
        for shift in self.shifts:
            for att in shift.attendances:
                if not att.duplicate_existing:
                    yield att
        for att in self.external:
            if not att.duplicate_existing:
                yield att


def _join(
    attendances_by_pair: Dict[Tuple[str, Tuple[str, str]], List[Attendance]],
    issues: List[Issue],
) -> List[Attendance]:
    joined: List[Attendance] = []
    gap = timedelta(minutes=JOIN_GAP_MINUTES)
    for pieces in attendances_by_pair.values():
        pieces.sort(key=lambda a: (a.start, a.seed.line_number))
        current: Optional[Attendance] = None
        for piece in pieces:
            if current is None:
                current = piece
                continue
            if piece.start < current.end:
                issues.append(
                    Issue(
                        code="overlapping_entries",
                        message=(
                            f"Lines {current.seed.line_number} and "
                            f"{piece.seed.line_number} put the same member on "
                            "the same unit at overlapping times. Exclude or "
                            "correct one."
                        ),
                        blocking=True,
                        row_ids=[r.id for r in current.rows + piece.rows],
                    )
                )
                joined.append(current)
                current = piece
            elif piece.start - current.end <= gap and not piece.seed.keep_separate:
                current.rows.extend(piece.rows)
                current.end = max(current.end, piece.end)
                if piece.call_count is not None:
                    current.call_count = (current.call_count or 0) + piece.call_count
            else:
                joined.append(current)
                current = piece
        if current is not None:
            joined.append(current)
    return joined


def _group(attendances: List[Attendance], issues: List[Issue]) -> List[ProposedShift]:
    buckets: Dict[Tuple[str, date], List[Attendance]] = {}
    for att in attendances:
        buckets.setdefault((att.unit_ref[1], att.local_date), []).append(att)

    shifts: List[ProposedShift] = []
    for (apparatus_id, shift_date), members in sorted(
        buckets.items(), key=lambda kv: (kv[0][1], kv[0][0])
    ):
        members.sort(key=lambda a: (a.start, -a.minutes, a.seed.line_number))
        proposed: List[ProposedShift] = []
        for att in members:
            best: Optional[ProposedShift] = None
            best_score = -1
            if att.seed.match_decision != "separate":
                for candidate in proposed:
                    score = match_confidence(
                        att.start, att.end, candidate.anchor_start, candidate.anchor_end
                    )
                    if score > best_score:
                        best, best_score = candidate, score
            if best is not None and best_score >= AUTO_MATCH_CONFIDENCE:
                att.confidence = best_score
                best.attendances.append(att)
            elif best is not None and best_score >= PROBABLE_MATCH_CONFIDENCE:
                att.confidence = best_score
                att.needs_confirmation = att.seed.match_decision != "accept"
                best.attendances.append(att)
                if att.needs_confirmation:
                    issues.append(
                        Issue(
                            code="probable_match",
                            message=(
                                f"Line {att.seed.line_number} is a {best_score}% "
                                f"match for the shift starting with line "
                                f"{best.attendances[0].seed.line_number}. Confirm "
                                "it is the same shift, or keep it separate."
                            ),
                            blocking=True,
                            row_ids=[att.seed.id],
                            ref=best.key,
                        )
                    )
            else:
                att.confidence = 100
                proposed.append(
                    ProposedShift(
                        key=att.seed.id,
                        apparatus_id=apparatus_id,
                        shift_date=shift_date,
                        anchor_start=att.start,
                        anchor_end=att.end,
                        attendances=[att],
                    )
                )
        for shift in proposed:
            seen: Dict[str, Attendance] = {}
            for att in shift.attendances:
                prior = seen.get(att.member_ref)
                if prior is not None:
                    issues.append(
                        Issue(
                            code="duplicate_member_in_shift",
                            message=(
                                f"Lines {prior.seed.line_number} and "
                                f"{att.seed.line_number} put the same member on "
                                "this shift twice. Exclude one, or keep one "
                                "separate."
                            ),
                            blocking=True,
                            row_ids=[prior.seed.id, att.seed.id],
                            ref=shift.key,
                        )
                    )
                else:
                    seen[att.member_ref] = att
        shifts.extend(proposed)
    return shifts


def _match_existing(
    shifts: List[ProposedShift],
    existing: Sequence[ExistingShift],
    decisions: Mapping[str, Any],
    issues: List[Issue],
) -> None:
    by_slot: Dict[Tuple[str, date], List[ExistingShift]] = {}
    for shift in existing:
        by_slot.setdefault((shift.apparatus_id, shift.shift_date), []).append(shift)
    for proposed in shifts:
        best: Optional[ExistingShift] = None
        best_score = -1
        for candidate in by_slot.get((proposed.apparatus_id, proposed.shift_date), []):
            score = match_confidence(
                proposed.anchor_start,
                proposed.anchor_end,
                candidate.start,
                candidate.end,
            )
            if score > best_score:
                best, best_score = candidate, score
        if best is None or best_score < PROBABLE_MATCH_CONFIDENCE:
            continue
        proposed.existing_shift_id = best.id
        proposed.existing_confidence = best_score
        decision = decisions.get(proposed.key)
        if best_score >= AUTO_MATCH_CONFIDENCE:
            proposed.existing_status = EXISTING_AUTO
        elif decision == "accept":
            proposed.existing_status = EXISTING_ACCEPTED
        elif decision == "separate":
            proposed.existing_status = EXISTING_SEPARATED
        else:
            proposed.existing_status = EXISTING_PENDING
            issues.append(
                Issue(
                    code="probable_existing_match",
                    message=(
                        f"The shift starting with line "
                        f"{proposed.attendances[0].seed.line_number} is a "
                        f"{best_score}% match for a shift already on the "
                        "schedule. Add these members to it, or import it as a "
                        "separate shift."
                    ),
                    blocking=True,
                    row_ids=[a.seed.id for a in proposed.attendances],
                    ref=proposed.key,
                )
            )
        if proposed.attaches_to_existing:
            for att in proposed.attendances:
                if att.member_ref in best.attendee_ids:
                    att.duplicate_existing = True


def _mark_external_duplicates(
    external: List[Attendance], existing: Sequence[ExistingExternalEntry]
) -> None:
    by_member: Dict[str, List[ExistingExternalEntry]] = {}
    for entry in existing:
        by_member.setdefault(entry.user_id, []).append(entry)
    for att in external:
        if att.unit_ref[0] != EXTERNAL:
            continue
        for entry in by_member.get(att.member_ref, []):
            if entry.external_apparatus_id != att.unit_ref[1]:
                continue
            if entry.start is not None and entry.end is not None:
                if entry.start < att.end and att.start < entry.end:
                    att.duplicate_existing = True
            elif entry.shift_date == att.local_date:
                att.duplicate_existing = True


def _check_new_members(
    members: List[MemberResolution],
    directory: Sequence[MemberRecord],
    issues: List[Issue],
) -> None:
    """A member the commit creates must not take an identifier someone holds."""
    taken: Dict[Tuple[str, str], str] = {}
    for record in directory:
        for kind, value in (
            ("membership number", record.membership_number),
            ("email", record.email),
            ("username", record.username),
        ):
            if value:
                taken[(kind, _squash(value))] = record.display_name
    for resolution in members:
        if resolution.status != MEMBER_CREATE:
            continue
        identity = resolution.identity
        if not identity.first and not identity.last:
            issues.append(
                Issue(
                    code="new_member_without_name",
                    message=(
                        f"'{resolution.key}' has no name in the file, so a "
                        "member cannot be created for it. Map it to an "
                        "existing member, or add the name to its rows."
                    ),
                    blocking=True,
                    row_ids=list(resolution.row_ids),
                    ref=resolution.key,
                )
            )
        for kind, value in (
            ("membership number", identity.membership_number),
            ("email", identity.email),
            ("username", identity.username),
        ):
            if not value:
                continue
            holder = taken.get((kind, _squash(value)))
            if holder is not None:
                issues.append(
                    Issue(
                        code="new_member_identifier_taken",
                        message=(
                            f"A new member for '{identity.display_name}' would "
                            f"reuse the {kind} '{value}', which belongs to "
                            f"{holder}. Map the rows to that member, or edit "
                            f"the {kind} on them."
                        ),
                        blocking=True,
                        row_ids=list(resolution.row_ids),
                        ref=resolution.key,
                    )
                )
            else:
                taken[(kind, _squash(value))] = identity.display_name


def _decision(
    draft: Mapping[str, Any], saved: Mapping[str, Any], key: str
) -> Tuple[Any, bool]:
    """The draft's decision for ``key``, else the remembered one, and whether
    the remembered one is what was used."""
    if key in draft:
        return draft[key], False
    if key in saved:
        return saved[key], True
    return None, False


def analyze(parsed: List[ParsedRow], context: AnalysisContext) -> Analysis:
    issues: List[Issue] = []
    members: Dict[str, MemberResolution] = {}
    units: Dict[str, UnitResolution] = {}
    positions: Dict[str, PositionResolution] = {}

    for row in parsed:
        if row.excluded or row.skipped_reason:
            continue
        if row.errors:
            issues.append(
                Issue(
                    code="row_error",
                    message=f"Line {row.line_number}: " + " ".join(row.errors),
                    blocking=True,
                    row_ids=[row.id],
                )
            )
        if row.identity.has_any:
            resolution = members.get(row.identity.key)
            if resolution is None:
                mapping, from_saved = _decision(
                    context.member_mappings,
                    context.saved_member_mappings,
                    row.identity.key,
                )
                resolution = resolve_member(row.identity, context.members, mapping)
                # A remembered mapping to a member since removed is ignored by
                # resolve_member; it then settles nothing and is not credited.
                resolution.remembered = (
                    from_saved and resolution.status == MEMBER_MAPPED
                )
                members[row.identity.key] = resolution
            resolution.row_ids.append(row.id)
        if row.values["unit"]:
            unit = units.get(row.unit_key)
            if unit is None:
                mapping, from_saved = _decision(
                    context.unit_mappings, context.saved_unit_mappings, row.unit_key
                )
                unit = resolve_unit(
                    row.values["unit"], row.values["agency"], context, mapping
                )
                unit.remembered = from_saved and unit.status == UNIT_MAPPED
                units[row.unit_key] = unit
            unit.row_ids.append(row.id)

    for resolution in members.values():
        if resolution.ref is None:
            issues.append(
                Issue(
                    code=f"member_{resolution.status}",
                    message=resolution.reason
                    or (
                        f"No member matches '{resolution.identity.display_name or resolution.key}'. "
                        "Map the rows to a member, or create an inactive member."
                    ),
                    blocking=True,
                    row_ids=list(resolution.row_ids),
                    ref=resolution.key,
                )
            )
    _check_new_members(
        list(members.values()), context.identifier_holders or context.members, issues
    )
    for unit in units.values():
        if unit.ref is None:
            label = f"{unit.unit} ({unit.agency})" if unit.agency else unit.unit
            issues.append(
                Issue(
                    code=f"unit_{unit.status}",
                    message=(
                        f"'{label}' matches more than one unit. Choose which."
                        if unit.status == UNIT_AMBIGUOUS
                        else f"No unit is named '{label}'. Map it to a unit, or "
                        "add it as an outside agency's unit."
                    ),
                    blocking=True,
                    row_ids=list(unit.row_ids),
                    ref=unit.key,
                )
            )

    # Seats matter only for the department's own shifts; time on another
    # agency's unit keeps the file's wording as its role.
    pairs: Dict[Tuple[str, Tuple[str, str]], List[Attendance]] = {}
    for row in parsed:
        if not row.active:
            continue
        member = members.get(row.identity.key)
        unit = units.get(row.unit_key)
        member_ref = member.ref if member else None
        unit_ref = unit.ref if unit else None
        if member_ref is None or unit_ref is None:
            continue
        seat = ""
        if unit_ref[0] == OWN:
            position = positions.get(row.position_key)
            if position is None:
                mapping, from_saved = _decision(
                    context.position_mappings,
                    context.saved_position_mappings,
                    row.position_key,
                )
                position = resolve_position(
                    row.values["position"], context.department_seats, mapping
                )
                position.remembered = from_saved and position.status == POSITION_MAPPED
                positions[row.position_key] = position
            position.row_ids.append(row.id)
            if position.seat is None:
                continue
            seat = position.seat
        if row.start is None or row.end is None or row.local_date is None:
            continue
        pairs.setdefault((member_ref, unit_ref), []).append(
            Attendance(
                key=row.id,
                rows=[row],
                member_ref=member_ref,
                unit_ref=unit_ref,
                seat=seat,
                role=row.values["position"],
                start=row.start,
                end=row.end,
                local_date=row.local_date,
                call_count=row.call_count,
            )
        )

    for position in positions.values():
        if position.seat is None:
            issues.append(
                Issue(
                    code="position_unmatched",
                    message=(
                        f"'{position.source}' is not a seat this department "
                        "has. Map it to one."
                    ),
                    blocking=True,
                    row_ids=list(position.row_ids),
                    ref=position.key,
                )
            )

    attendances = _join(pairs, issues)
    for att in attendances:
        if att.minutes > MAX_ATTENDANCE_MINUTES:
            issues.append(
                Issue(
                    code="attendance_too_long",
                    message=(
                        f"Lines {', '.join(str(r.line_number) for r in att.rows)} "
                        "join into one stretch longer than 48 hours. Correct "
                        "the times, or exclude a row."
                    ),
                    blocking=True,
                    row_ids=[r.id for r in att.rows],
                )
            )
    own = [a for a in attendances if a.unit_ref[0] == OWN]
    external = sorted(
        (a for a in attendances if a.unit_ref[0] != OWN),
        key=lambda a: (a.start, a.seed.line_number),
    )

    shifts = _group(own, issues)
    _match_existing(
        shifts, context.existing_shifts, context.existing_shift_decisions, issues
    )
    _mark_external_duplicates(external, context.existing_external)

    return Analysis(
        rows=parsed,
        members=sorted(members.values(), key=lambda m: m.key),
        units=sorted(units.values(), key=lambda u: u.key),
        positions=sorted(positions.values(), key=lambda p: p.key),
        shifts=shifts,
        external=external,
        issues=issues,
    )


def date_span(parsed: Sequence[ParsedRow]) -> Optional[Tuple[date, date]]:
    """The local dates the active rows cover, padded a day for joined
    stretches, so the service loads only the existing records that can
    match."""
    days = [r.local_date for r in parsed if r.active and r.local_date is not None]
    if not days:
        return None
    return min(days) - timedelta(days=1), max(days) + timedelta(days=1)
