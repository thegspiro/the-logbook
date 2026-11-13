"""
History import: the rules, as pure functions.

Reading a roster file, reading the partial dates historians write ("1952",
"June 1952", "c. 1950", "present"), finding the problems in a row, and
suggesting what each row is: an existing history record, a member account, a
new person, or the same person as another line of the same file.

Nothing here touches the database. ``history_import_service`` loads what these
rules need, stores the Historian's decisions, and writes the records.

Suggestions are only ever suggestions. A row becomes something only when the
Historian decides it, which is why two equally good candidates are both offered
and neither is preselected.
"""

import csv
import io
import re
from dataclasses import dataclass, field
from datetime import date
from typing import Iterable, Mapping, Optional, Sequence

from app.models.history import DatePrecision

#: Owner decision (2026-11-03): one file holds at most this many people.
MAX_IMPORT_ROWS = 5000
MAX_IMPORT_BYTES = 5 * 1024 * 1024

#: Every column the import reads, in template order.
FIELDS = (
    "first_name",
    "middle_name",
    "last_name",
    "suffix",
    "nickname",
    "badge_number",
    "joined",
    "left",
    "titles",
    "birth_date",
    "death_date",
    "line_of_duty_death",
    "notes",
)

#: Read only when the file has no last-name column of its own.
FULL_NAME = "full_name"

TEMPLATE_HEADERS = (
    "First Name",
    "Middle Name",
    "Last Name",
    "Suffix",
    "Nickname",
    "Badge Number",
    "Joined",
    "Left",
    "Titles",
    "Birth Date",
    "Death Date",
    "Line of Duty Death",
    "Notes",
)

TEMPLATE_EXAMPLE = (
    "John",
    "Robert",
    "Smith",
    "Jr.",
    "Jack",
    "14",
    "c. 1951",
    "1972-06",
    "Firefighter; Lieutenant; Captain",
    "1929-03-02",
    "",
    "no",
    "Joined after his father; see 1951 minutes",
)

_ALIASES: dict[str, tuple[str, ...]] = {
    "first_name": ("first_name", "first", "given_name", "forename", "firstname"),
    "middle_name": ("middle_name", "middle", "middle_initial", "middlename"),
    "last_name": ("last_name", "last", "surname", "family_name", "lastname"),
    "suffix": ("suffix", "name_suffix"),
    "nickname": ("nickname", "nick_name", "known_as", "preferred_name"),
    "badge_number": (
        "badge_number",
        "badge",
        "badge_no",
        "member_number",
        "membership_number",
    ),
    "joined": ("joined", "date_joined", "joined_date", "start", "start_date", "from"),
    "left": ("left", "date_left", "left_date", "end", "end_date", "to"),
    "titles": ("titles", "title", "ranks", "rank", "positions", "position"),
    "birth_date": ("birth_date", "born", "date_of_birth", "dob", "birthdate"),
    "death_date": ("death_date", "died", "date_of_death", "deathdate", "dod"),
    "line_of_duty_death": ("line_of_duty_death", "lodd", "line_of_duty"),
    "notes": ("notes", "note", "comments", "comment", "research_notes"),
    FULL_NAME: ("full_name", "name", "member_name"),
}

#: Longest value each field may carry, matching the columns it is written to.
MAX_LENGTHS = {
    "first_name": 100,
    "middle_name": 100,
    "last_name": 100,
    "suffix": 20,
    "nickname": 100,
    "badge_number": 50,
}

TITLE_MAX_LENGTH = 150


def normalize_header(header: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", header.strip().lower()).strip("_")


def detect_column_mapping(headers: Sequence[str]) -> dict[str, str]:
    """{field: header} for every field a header names. First header wins."""
    by_normal: dict[str, str] = {}
    for header in headers:
        by_normal.setdefault(normalize_header(header), header)
    mapping: dict[str, str] = {}
    for field_name, aliases in _ALIASES.items():
        for alias in aliases:
            if alias in by_normal:
                mapping[field_name] = by_normal[alias]
                break
    if "last_name" in mapping:
        mapping.pop(FULL_NAME, None)
    return mapping


def decode_upload(contents: bytes) -> str:
    try:
        return contents.decode("utf-8-sig")
    except UnicodeDecodeError:
        # Spreadsheet exports from older Windows tools are often cp1252;
        # latin-1 decodes any byte sequence, so it is the last resort.
        return contents.decode("latin-1")


def read_csv(text: str) -> tuple[list[str], list[tuple[int, dict[str, str]]]]:
    """The header row and the data rows with their line numbers.

    Refuses what cannot be imported faithfully: an empty file, a repeated
    column name, too many rows, or no column naming the person.
    """
    reader = csv.reader(io.StringIO(text))
    try:
        header_row = next(reader)
    except StopIteration:
        raise ValueError("The file is empty")
    headers = [h.strip() for h in header_row]
    named = [h for h in headers if h]
    if not named:
        raise ValueError("The file has no header row")
    if len({h.casefold() for h in named}) != len(named):
        raise ValueError(
            "The header row repeats a column name. Rename the duplicate so each "
            "column can be told apart"
        )
    mapping = detect_column_mapping(named)
    if "last_name" not in mapping and FULL_NAME not in mapping:
        raise ValueError(
            "No column names the person. The file needs a Last Name column "
            "(or a Name column); download the template to see the columns read"
        )
    rows: list[tuple[int, dict[str, str]]] = []
    for cells in reader:
        if not any(c.strip() for c in cells):
            continue
        rows.append(
            (
                reader.line_num,
                {
                    header: (cells[i] if i < len(cells) else "")
                    for i, header in enumerate(headers)
                    if header
                },
            )
        )
        if len(rows) > MAX_IMPORT_ROWS:
            raise ValueError(
                f"The file has more than {MAX_IMPORT_ROWS:,} people. Split it into "
                "smaller files and import each one"
            )
    if not rows:
        raise ValueError("The file has a header row but no people")
    return named, rows


def cells_for(raw: Mapping[str, str], mapping: Mapping[str, str]) -> dict[str, str]:
    """{field: text} for one row, keeping only the columns the import reads."""
    out: dict[str, str] = {}
    for field_name, header in mapping.items():
        value = (raw.get(header) or "").strip()
        if value:
            out[field_name] = value
    return out


# ---------------------------------------------------------------------------
# Names
# ---------------------------------------------------------------------------

_SUFFIXES = {"jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "v"}


def split_full_name(full: str) -> dict[str, str]:
    """ "Smith, John R." or "John R. Smith Jr." into name parts."""
    text = re.sub(r"\s+", " ", full).strip()
    if not text:
        return {}
    if "," in text:
        last, _, rest = text.partition(",")
        given = rest.strip().split(" ") if rest.strip() else []
        out = {"last_name": last.strip()}
        if given and given[-1].casefold() in _SUFFIXES:
            out["suffix"] = given.pop()
        if given:
            out["first_name"] = given[0]
        if len(given) > 1:
            out["middle_name"] = " ".join(given[1:])
        return out
    words = text.split(" ")
    out = {}
    if len(words) > 1 and words[-1].casefold() in _SUFFIXES:
        out["suffix"] = words.pop()
    out["last_name"] = words.pop()
    if words:
        out["first_name"] = words[0]
    if len(words) > 1:
        out["middle_name"] = " ".join(words[1:])
    return out


def effective_values(
    cells: Mapping[str, str], edits: Optional[Mapping[str, str]]
) -> dict[str, str]:
    """The file's values with the Historian's corrections laid over them.

    An edit to an empty string clears the file's value.
    """
    values = dict(cells)
    if FULL_NAME in values and "last_name" not in values:
        for key, part in split_full_name(values[FULL_NAME]).items():
            values.setdefault(key, part)
    values.pop(FULL_NAME, None)
    for key, value in (edits or {}).items():
        if key not in FIELDS:
            continue
        text = (value or "").strip()
        if text:
            values[key] = text
        else:
            values.pop(key, None)
    return values


def _fold(value: Optional[str]) -> str:
    return re.sub(r"\s+", " ", (value or "")).strip().casefold()


def first_names_compatible(a: Optional[str], b: Optional[str]) -> bool:
    """The rule phase 1's duplicate warning uses: a missing first name on
    either side, the same name, or "J." beside "John" are all worth a look."""
    left, right = _fold(a), _fold(b)
    if not left or not right:
        return True
    return left[0] == right[0]


# ---------------------------------------------------------------------------
# Partial dates
# ---------------------------------------------------------------------------

_CIRCA_RE = re.compile(r"^(?:circa|ca\.?|c\.?|abt\.?|about|approx\.?|~)\s*", re.I)
_PRESENT = {"present", "current", "now", "still serving", "active"}
_MONTHS = {
    name: index
    for index, names in enumerate(
        (
            ("january", "jan"),
            ("february", "feb"),
            ("march", "mar"),
            ("april", "apr"),
            ("may",),
            ("june", "jun"),
            ("july", "jul"),
            ("august", "aug"),
            ("september", "sep", "sept"),
            ("october", "oct"),
            ("november", "nov"),
            ("december", "dec"),
        ),
        start=1,
    )
    for name in names
}

_ISO_DAY = re.compile(r"^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$")
_ISO_MONTH = re.compile(r"^(\d{4})[-/.](\d{1,2})$")
_YEAR = re.compile(r"^(\d{4})$")
_US_DAY = re.compile(r"^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$")
_US_MONTH = re.compile(r"^(\d{1,2})[-/](\d{4})$")
_NAMED_MONTH_YEAR = re.compile(r"^([a-z]+)\.?\s+(\d{4})$", re.I)
_NAMED_DAY_FIRST = re.compile(r"^(\d{1,2})\s+([a-z]+)\.?,?\s+(\d{4})$", re.I)
_NAMED_MONTH_FIRST = re.compile(r"^([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$", re.I)

_EARLIEST_YEAR = 1700


@dataclass(frozen=True)
class PartialDate:
    value: Optional[date] = None
    precision: DatePrecision = DatePrecision.YEAR
    circa: bool = False
    ongoing: bool = False
    error: Optional[str] = None

    @property
    def empty(self) -> bool:
        return self.value is None and not self.ongoing and self.error is None


def _build(
    year: int, month: int, day: int, precision: DatePrecision, circa: bool
) -> PartialDate:
    if year < _EARLIEST_YEAR:
        return PartialDate(error=f"{year} is earlier than the archive accepts")
    try:
        return PartialDate(
            value=date(year, month, day), precision=precision, circa=circa
        )
    except ValueError:
        return PartialDate(error="is not a real date")


def parse_partial_date(text: Optional[str], *, allow_present: bool) -> PartialDate:
    """Read a date the way a historian writes one.

    ``1952`` is a year, ``1952-06`` / ``June 1952`` / ``6/1952`` a month,
    ``1952-06-14`` / ``6/14/1952`` / ``June 14, 1952`` a day. Slashed dates
    are read month first, as US departments write them; one whose month would
    be over 12 is reported rather than guessed at. A leading ``c.``, ``ca.``,
    ``circa``, ``about`` or ``~`` marks the date approximate. ``present`` is
    read only where *allow_present* says a service period may still be going.
    """
    raw = re.sub(r"\s+", " ", (text or "")).strip()
    if not raw:
        return PartialDate()
    if raw.casefold() in _PRESENT:
        if allow_present:
            return PartialDate(ongoing=True)
        return PartialDate(error='"present" can only be used for the date someone left')
    circa = False
    stripped = _CIRCA_RE.sub("", raw, count=1)
    if stripped != raw:
        circa = True
        raw = stripped.strip()
    if match := _YEAR.match(raw):
        return _build(int(match[1]), 1, 1, DatePrecision.YEAR, circa)
    if match := _ISO_MONTH.match(raw):
        return _build(int(match[1]), int(match[2]), 1, DatePrecision.MONTH, circa)
    if match := _ISO_DAY.match(raw):
        return _build(
            int(match[1]), int(match[2]), int(match[3]), DatePrecision.DAY, circa
        )
    if match := _US_DAY.match(raw):
        return _build(
            int(match[3]), int(match[1]), int(match[2]), DatePrecision.DAY, circa
        )
    if match := _US_MONTH.match(raw):
        return _build(int(match[2]), int(match[1]), 1, DatePrecision.MONTH, circa)
    if match := _NAMED_MONTH_YEAR.match(raw):
        month = _MONTHS.get(match[1].casefold())
        if month:
            return _build(int(match[2]), month, 1, DatePrecision.MONTH, circa)
    if match := _NAMED_MONTH_FIRST.match(raw):
        month = _MONTHS.get(match[1].casefold())
        if month:
            return _build(int(match[3]), month, int(match[2]), DatePrecision.DAY, circa)
    if match := _NAMED_DAY_FIRST.match(raw):
        month = _MONTHS.get(match[2].casefold())
        if month:
            return _build(int(match[3]), month, int(match[1]), DatePrecision.DAY, circa)
    return PartialDate(error="is not a date the import can read")


_YES = {"yes", "y", "true", "1", "x", "lodd"}
_NO = {"no", "n", "false", "0", ""}


def parse_flag(text: Optional[str]) -> Optional[bool]:
    folded = _fold(text)
    if folded in _YES:
        return True
    if folded in _NO:
        return False
    return None


def split_titles(text: Optional[str]) -> list[str]:
    """Distinct titles from a ``;``-separated cell, in the order written."""
    seen: dict[str, str] = {}
    for part in re.split(r"[;\n]", text or ""):
        name = re.sub(r"\s+", " ", part).strip()
        if name:
            seen.setdefault(name.casefold(), name)
    return list(seen.values())


# ---------------------------------------------------------------------------
# One row, read
# ---------------------------------------------------------------------------

_DATE_LABELS = {
    "joined": "Joined",
    "left": "Left",
    "birth_date": "Birth date",
    "death_date": "Death date",
}


@dataclass
class ParsedRow:
    values: dict[str, str]
    joined: PartialDate
    left: PartialDate
    birth: PartialDate
    death: PartialDate
    line_of_duty_death: bool
    titles: list[str]
    issues: list[str] = field(default_factory=list)

    @property
    def has_period(self) -> bool:
        return bool(
            self.joined.value or self.left.value or self.left.ongoing or self.titles
        )


def parse_row(values: Mapping[str, str]) -> ParsedRow:
    issues: list[str] = []
    if not values.get("last_name"):
        issues.append("No last name")
    for key, limit in MAX_LENGTHS.items():
        if len(values.get(key, "")) > limit:
            issues.append(
                f"{key.replace('_', ' ').capitalize()} is over {limit} characters"
            )
    dates = {
        key: parse_partial_date(values.get(key), allow_present=key == "left")
        for key in _DATE_LABELS
    }
    for key, parsed in dates.items():
        if parsed.error:
            issues.append(f'{_DATE_LABELS[key]} "{values.get(key)}" {parsed.error}')
    joined, left = dates["joined"], dates["left"]
    if joined.value and left.value and left.value < joined.value:
        issues.append("Left is before Joined")
    birth, death = dates["birth_date"], dates["death_date"]
    if birth.value and death.value and death.value < birth.value:
        issues.append("Death date is before birth date")
    flag = parse_flag(values.get("line_of_duty_death"))
    if flag is None:
        issues.append(
            f'Line of duty death "{values.get("line_of_duty_death")}" should be yes or no'
        )
    titles = split_titles(values.get("titles"))
    for title in titles:
        if len(title) > TITLE_MAX_LENGTH:
            issues.append(f"A title is over {TITLE_MAX_LENGTH} characters")
            break
    return ParsedRow(
        values=dict(values),
        joined=joined,
        left=left,
        birth=birth,
        death=death,
        line_of_duty_death=bool(flag),
        titles=titles,
        issues=issues,
    )


# ---------------------------------------------------------------------------
# Suggestions
# ---------------------------------------------------------------------------

STRONG = "strong"
WEAK = "weak"

SUGGEST_MATCH = "match"
SUGGEST_MAP = "map"
SUGGEST_SAME_AS = "same_as"


@dataclass(frozen=True)
class ExistingPerson:
    id: str
    last_name: str
    first_name: Optional[str]
    badge_number: Optional[str]
    #: (start year, end year) per service period; None where unknown.
    spans: tuple[tuple[Optional[int], Optional[int]], ...]
    user_id: Optional[str]


@dataclass(frozen=True)
class Account:
    id: str
    last_name: str
    first_name: Optional[str]
    preferred_name: Optional[str]


@dataclass(frozen=True)
class FileRow:
    """A row as the same-file check needs it."""

    id: str
    line_number: int
    last_name: str
    first_name: Optional[str]
    badge_number: Optional[str]


def _row_span(row: ParsedRow) -> Optional[tuple[Optional[int], Optional[int]]]:
    start = row.joined.value.year if row.joined.value else None
    end = row.left.value.year if row.left.value else None
    if row.left.ongoing:
        end = 9999
    if start is None and end is None:
        return None
    return (start, end)


def _overlaps(
    span: tuple[Optional[int], Optional[int]],
    other: tuple[Optional[int], Optional[int]],
) -> bool:
    start, end = span[0] or span[1], span[1] or span[0]
    o_start, o_end = other[0] or other[1], other[1] or other[0]
    if start is None or o_start is None or end is None or o_end is None:
        return True
    return start <= o_end and o_start <= end


def _years_agree(row: ParsedRow, person: ExistingPerson) -> bool:
    """True when the years overlap, or when either side has none to compare:
    an undated record is exactly the kind an import fills in."""
    span = _row_span(row)
    if span is None or not person.spans:
        return True
    return any(_overlaps(span, other) for other in person.spans)


def suggest(
    row: ParsedRow,
    people: Iterable[ExistingPerson],
    accounts: Iterable[Account],
    linked_people_by_user: Mapping[str, str],
) -> list[dict[str, str]]:
    """What this row might be, strongest first. Ids only, never names."""
    last = _fold(row.values.get("last_name"))
    if not last:
        return []
    first = row.values.get("first_name")
    badge = _fold(row.values.get("badge_number"))
    out: list[dict[str, str]] = []
    seen_people: set[str] = set()
    for person in people:
        if _fold(person.last_name) != last:
            continue
        if not first_names_compatible(first, person.first_name):
            continue
        if badge and badge == _fold(person.badge_number):
            out.append({"kind": SUGGEST_MATCH, "id": person.id, "strength": STRONG})
        elif _years_agree(row, person):
            out.append({"kind": SUGGEST_MATCH, "id": person.id, "strength": WEAK})
        else:
            continue
        seen_people.add(person.id)
    first_folded = _fold(first)
    for account in accounts:
        if _fold(account.last_name) != last or not first_folded:
            continue
        if first_folded not in (
            _fold(account.first_name),
            _fold(account.preferred_name),
        ):
            continue
        linked = linked_people_by_user.get(account.id)
        if linked:
            # The account already has a history record: that record is the
            # one to fill, not a second record for the same account.
            if linked not in seen_people:
                out.append({"kind": SUGGEST_MATCH, "id": linked, "strength": STRONG})
                seen_people.add(linked)
            continue
        out.append({"kind": SUGGEST_MAP, "id": account.id, "strength": STRONG})
    out.sort(key=lambda s: 0 if s["strength"] == STRONG else 1)
    return out


def same_person_in_file(rows: Sequence[FileRow]) -> dict[str, str]:
    """{row id: id of the earlier row it repeats}.

    The same last and first name, with the same badge number or no badge on
    either: someone who left and rejoined, written as two lines. Only the
    first occurrence stands alone; every repeat points at it.
    """
    out: dict[str, str] = {}
    first_seen: dict[tuple[str, str], list[FileRow]] = {}
    for row in sorted(rows, key=lambda r: r.line_number):
        key = (_fold(row.last_name), _fold(row.first_name))
        if not key[0] or not key[1]:
            continue
        for earlier in first_seen.get(key, []):
            badges = (_fold(row.badge_number), _fold(earlier.badge_number))
            if not badges[0] or not badges[1] or badges[0] == badges[1]:
                out[row.id] = earlier.id
                break
        else:
            first_seen.setdefault(key, []).append(row)
    return out
