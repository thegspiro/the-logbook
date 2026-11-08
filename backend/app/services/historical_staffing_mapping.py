"""
Historical staffing: deciding what each event is and what each seat title means.

Two decisions, both the reviewer's, both suggested first:

* **What each activity is.** A *shift* is duty on a unit ("A106E NS", "LA106
  Call Back Staff"); its seats become crew seats. An *event* is anything else
  (a party, an open house, a class); its seats become outreach roles, or
  attendance where the title says the person attended. An activity can also be
  left out. Activities are decided by their normalized text, so one decision
  covers every event carrying it.
* **What each seat title means.** Titles are matched only to the department's
  own choices, never added to them (the department's decision): on a shift,
  one of its crew seats; at an event, one of its outreach roles or attendance.
  A title can also be left out. Titles are decided by their core: the title
  with its unit, time window and shift labels taken off, so "LA106 Dayside
  Driver (0800-1800)" and "Driver" are one decision.

Pure functions only; the service loads the vocabulary and stores decisions.
"""

import html
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

from app.services.historical_staffing_engine import Joined

SHIFT = "shift"
EVENT = "event"
SKIP = "skip"
ACTIVITY_KINDS: Tuple[str, ...] = (SHIFT, EVENT, SKIP)

# Title choices that are not a seat or role value.
TITLE_SKIP = "__skip__"
ATTENDANCE = "__attendance__"

ACTIVITIES = "activities"
SEAT_TITLES = "seat_titles"
EVENT_TITLES = "event_titles"
LISTS: Tuple[str, ...] = (ACTIVITIES, SEAT_TITLES, EVENT_TITLES)

# The same bar the training step's course suggestions use.
SUGGESTION_THRESHOLD = 0.85

MAX_KEY_LENGTH = 200

# ---------------------------------------------------------------------------
# Normalizing text
# ---------------------------------------------------------------------------

# A unit number as fire and EMS departments write one: capital letters then
# two or three digits, optionally a trailing letter and a suffix ("A102",
# "LA106", "UT 106", "A106E", "A102-RS"). Four digits are left out so a year
# ("CPR 2016") is not read as a unit.
_UNIT_RE = re.compile(r"\b[A-Z]{1,3}\s?\d{2,3}[A-Z]?(?:-[A-Z]{1,3})?\b")
_TIME_RANGE_RE = re.compile(r"\b\d{3,4}\s*[-–]\s*\d{3,4}\b")
_PARENS_RE = re.compile(r"\([^)]*\)")
_SHIFT_WORDS_RE = re.compile(
    r"\b(dayside|nightside|day side|night side|ds|ns|days?|nights?|"
    r"mon(day)?|tue(s(day)?)?|wed(nesday)?|thu(rs(day)?)?|fri(day)?|"
    r"sat(urday)?|sun(day)?)\b",
    re.IGNORECASE,
)
_NON_WORD_RE = re.compile(r"[^\w\s/&'.]+", re.UNICODE)
_SPACE_RE = re.compile(r"\s+")

# Words that mark duty on a unit when no unit number is in the text.
_DUTY_WORDS = (
    "nightside",
    "dayside",
    "duty crew",
    "call back",
    "callback",
    "standby",
    "stand by",
    "staffing",
    "on call",
    "on-call",
    "crew a",
    "crew b",
)

# Titles meaning the person attended rather than worked.
_ATTENDANCE_WORDS = (
    "attendee",
    "participant",
    "student",
    "candidate",
    "trainee",
    "attending",
    "observer",
)


def _plain(value: str) -> str:
    """Entities decoded and symbols (emoji, bullets) dropped."""
    text = html.unescape(value or "")
    text = _NON_WORD_RE.sub(" ", text)
    return _SPACE_RE.sub(" ", text).strip()


def activity_key(activity: str) -> str:
    """One decision per activity text, whatever its case, entities or emoji:
    "&#128680; LA106 Call Back Staff" and "LA106 call back staff" agree."""
    return _plain(activity).casefold()[:MAX_KEY_LENGTH]


def title_core(title: str) -> str:
    """A seat title with its unit, time window and shift labels taken off,
    as written otherwise: "LA106 Dayside Driver (0800-1800)" is "Driver"."""
    text = html.unescape(title or "")
    text = _PARENS_RE.sub(" ", text)
    text = _TIME_RANGE_RE.sub(" ", text)
    text = _UNIT_RE.sub(" ", text)
    text = _SHIFT_WORDS_RE.sub(" ", text)
    text = re.sub(r"[:\-–]+", " ", text)
    return _SPACE_RE.sub(" ", _plain(text)).strip()


def title_key(title: str) -> str:
    return title_core(title).casefold()[:MAX_KEY_LENGTH]


def _compare_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.casefold())


# ---------------------------------------------------------------------------
# Suggestions
# ---------------------------------------------------------------------------


def suggest_kind(activity: str, unit_names: Iterable[str]) -> str:
    """Shift when the activity names a unit or duty words, else event.

    ``unit_names`` are the department's own unit numbers and names; any
    unit-shaped token counts too, since a retired unit is no longer on file.
    """
    text = _plain(activity)
    folded = text.casefold()
    squashed = _compare_key(text)
    for unit in unit_names:
        key = _compare_key(unit)
        if len(key) >= 3 and key in squashed:
            return SHIFT
    if _UNIT_RE.search(text):
        return SHIFT
    if any(word in folded for word in _DUTY_WORDS):
        return SHIFT
    return EVENT


@dataclass(frozen=True)
class Choice:
    value: str
    label: str


def _best(core: str, choices: Sequence[Choice]) -> Optional[str]:
    key = _compare_key(core)
    if not key:
        return None
    best_score, best_value = 0.0, None
    for choice in choices:
        for name in (choice.label, choice.value):
            candidate = _compare_key(name)
            if not candidate:
                continue
            if candidate == key:
                return choice.value
            score = SequenceMatcher(None, key, candidate).ratio()
            if score > best_score:
                best_score, best_value = score, choice.value
    return best_value if best_score >= SUGGESTION_THRESHOLD else None


def suggest_seat(core: str, seats: Sequence[Choice]) -> Optional[str]:
    """The crew seat a shift title most resembles, if any is close enough."""
    folded = core.casefold()
    # EMT spellings are the department's EMT seat however they are written.
    if re.fullmatch(r"(ff\s*/\s*)?emt(\s*[- ]?b(asic)?)?", folded):
        for seat in seats:
            if seat.value == "ems":
                return seat.value
    return _best(core, seats)


def suggest_event_title(core: str, roles: Sequence[Choice]) -> Optional[str]:
    """Attendance for a title saying the person attended; else the outreach
    role it most resembles, if any is close enough."""
    folded = core.casefold()
    if any(word in folded for word in _ATTENDANCE_WORDS):
        return ATTENDANCE
    return _best(core, roles)


# ---------------------------------------------------------------------------
# Decisions
# ---------------------------------------------------------------------------


@dataclass
class Decisions:
    """The reviewer's choices, keyed by normalized activity or title."""

    activity_kinds: Dict[str, str] = field(default_factory=dict)
    seat_titles: Dict[str, str] = field(default_factory=dict)
    event_titles: Dict[str, str] = field(default_factory=dict)

    @classmethod
    def from_stored(cls, stored: Any) -> "Decisions":
        """Read defensively: the column is untyped JSON (pitfall #19)."""
        data = stored if isinstance(stored, Mapping) else {}

        def strings(value: Any) -> Dict[str, str]:
            if not isinstance(value, Mapping):
                return {}
            return {
                str(k): str(v) for k, v in value.items() if k and isinstance(v, str)
            }

        kinds = {
            k: v
            for k, v in strings(data.get("activity_kinds")).items()
            if v in ACTIVITY_KINDS
        }
        return cls(
            activity_kinds=kinds,
            seat_titles=strings(data.get("seat_titles")),
            event_titles=strings(data.get("event_titles")),
        )

    def to_stored(self) -> Dict[str, Any]:
        return {
            "activity_kinds": dict(self.activity_kinds),
            "seat_titles": dict(self.seat_titles),
            "event_titles": dict(self.event_titles),
        }

    def mapping(self, list_name: str) -> Dict[str, str]:
        return {
            ACTIVITIES: self.activity_kinds,
            SEAT_TITLES: self.seat_titles,
            EVENT_TITLES: self.event_titles,
        }[list_name]


def allowed_values(
    list_name: str, seats: Sequence[Choice], roles: Sequence[Choice]
) -> set:
    if list_name == ACTIVITIES:
        return set(ACTIVITY_KINDS)
    if list_name == SEAT_TITLES:
        return {s.value for s in seats} | {TITLE_SKIP}
    return {r.value for r in roles} | {ATTENDANCE, TITLE_SKIP}


def merge(
    decisions: Decisions,
    list_name: str,
    updates: Mapping[str, Optional[str]],
    seats: Sequence[Choice],
    roles: Sequence[Choice],
) -> Decisions:
    """Decisions with ``updates`` applied to one list; a null clears a key.

    A value must be one of the department's own choices: the import adds no
    seat or role.
    """
    if list_name not in LISTS:
        raise ValueError("Choose activities, shift seat titles or event titles.")
    allowed = allowed_values(list_name, seats, roles)
    current = dict(decisions.mapping(list_name))
    for key, value in updates.items():
        if not key or len(key) > MAX_KEY_LENGTH:
            raise ValueError("A key is missing or too long.")
        if value is None or value == "":
            current.pop(key, None)
            continue
        if value not in allowed:
            raise ValueError(f"'{value}' is not one of the department's choices.")
        current[key] = value
    merged = Decisions(
        activity_kinds=dict(decisions.activity_kinds),
        seat_titles=dict(decisions.seat_titles),
        event_titles=dict(decisions.event_titles),
    )
    if list_name == ACTIVITIES:
        merged.activity_kinds = current
    elif list_name == SEAT_TITLES:
        merged.seat_titles = current
    else:
        merged.event_titles = current
    return merged


# ---------------------------------------------------------------------------
# The lists the reviewer works through
# ---------------------------------------------------------------------------


@dataclass
class Item:
    key: str
    # The most common spelling in the file, to show the reviewer.
    label: str
    seats: int
    events: int
    suggestion: Optional[str]
    choice: Optional[str]
    # A few spellings that share this key, for a title with variants.
    examples: List[str] = field(default_factory=list)

    @property
    def effective(self) -> Optional[str]:
        return self.choice or self.suggestion


@dataclass
class Lists:
    activities: List[Item]
    seat_titles: List[Item]
    event_titles: List[Item]

    def get(self, name: str) -> List[Item]:
        return {
            ACTIVITIES: self.activities,
            SEAT_TITLES: self.seat_titles,
            EVENT_TITLES: self.event_titles,
        }[name]


def _ranked(items: Iterable[Item]) -> List[Item]:
    return sorted(items, key=lambda i: (-i.seats, -i.events, i.key))


def build_lists(
    joined: Joined,
    decisions: Decisions,
    unit_names: Sequence[str],
    seats: Sequence[Choice],
    roles: Sequence[Choice],
) -> Lists:
    """Every activity, and every seat title by the kind of event it is on.

    A title's list follows its event's activity, decided or suggested, so
    flipping an activity moves its titles between the lists.
    """
    activity_spellings: Dict[str, Counter] = defaultdict(Counter)
    activity_events: Counter = Counter()
    activity_seats: Counter = Counter()
    kind_of_event: Dict[str, str] = {}
    suggested_kind: Dict[str, str] = {}
    for event in joined.events.values():
        key = activity_key(event.activity)
        activity_spellings[key][event.activity] += 1
        activity_events[key] += 1
        activity_seats[key] += event.seat_count
        if key not in suggested_kind:
            suggested_kind[key] = suggest_kind(event.activity, unit_names)
        kind_of_event[event.key] = decisions.activity_kinds.get(
            key, suggested_kind[key]
        )

    activities = [
        Item(
            key=key,
            label=spellings.most_common(1)[0][0],
            seats=activity_seats[key],
            events=activity_events[key],
            suggestion=suggested_kind[key],
            choice=decisions.activity_kinds.get(key),
        )
        for key, spellings in activity_spellings.items()
        # An event with no seats becomes a calendar event whatever it is, so
        # only activities with seats need deciding.
        if activity_seats[key]
    ]

    titles: Dict[str, Dict[str, Counter]] = {
        SHIFT: defaultdict(Counter),
        EVENT: defaultdict(Counter),
    }
    title_events: Dict[str, Dict[str, set]] = {
        SHIFT: defaultdict(set),
        EVENT: defaultdict(set),
    }
    for seat in joined.seats:
        kind = kind_of_event.get(seat.event_key)
        if kind not in (SHIFT, EVENT):
            continue
        key = title_key(seat.title)
        titles[kind][key][seat.title] += 1
        title_events[kind][key].add(seat.event_key)

    def title_items(kind: str) -> List[Item]:
        chosen = decisions.seat_titles if kind == SHIFT else decisions.event_titles
        out = []
        for key, spellings in titles[kind].items():
            core = title_core(spellings.most_common(1)[0][0])
            suggestion = (
                suggest_seat(core, seats)
                if kind == SHIFT
                else suggest_event_title(core, roles)
            )
            out.append(
                Item(
                    key=key,
                    label=core or "(no title)",
                    seats=sum(spellings.values()),
                    events=len(title_events[kind][key]),
                    suggestion=suggestion,
                    choice=chosen.get(key),
                    examples=[s for s, _ in spellings.most_common(3)],
                )
            )
        return _ranked(out)

    return Lists(
        activities=_ranked(activities),
        seat_titles=title_items(SHIFT),
        event_titles=title_items(EVENT),
    )


def progress(items: Sequence[Item]) -> Dict[str, int]:
    """How far the reviewer has got through one list, in items and seats."""
    return {
        "items": len(items),
        "decided": sum(1 for i in items if i.choice),
        "suggested": sum(1 for i in items if not i.choice and i.suggestion),
        "undecided": sum(1 for i in items if not i.choice and not i.suggestion),
        "seats": sum(i.seats for i in items),
        "seats_settled": sum(i.seats for i in items if i.effective),
    }


def search(items: Sequence[Item], text: str) -> List[Item]:
    needle = text.strip().casefold()
    if not needle:
        return list(items)
    return [
        i
        for i in items
        if needle in i.key or any(needle in e.casefold() for e in i.examples)
    ]
