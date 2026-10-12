"""Contract test: the fields a finalized event locks, on both sides of the wire.

``ATTENDANCE_SENSITIVE_UPDATE_FIELDS`` decides what a finalized event refuses
to change. The edit page mirrors it as ``ATTENDANCE_LOCKED_EVENT_FIELDS`` to
leave those fields out of the save, and nothing at build time makes the two
agree.

Drift is quiet in both directions. A field the backend locks and the frontend
does not is resent on every save, and the first time the browser's copy of it
differs from the stored one — a rounded time, a defaulted lead time — a title
fix is refused for a change nobody made. A field the frontend locks and the
backend does not is silently dropped from every save of a finalized event.

Like test_garment_style_axis_parity.py, this reads the .ts file as text. If it
fails, fix whichever side is wrong. Do not loosen the comparison.
"""

import re
from pathlib import Path

import pytest

from app.schemas.event import EventUpdate
from app.services.event_service import ATTENDANCE_SENSITIVE_UPDATE_FIELDS

pytestmark = pytest.mark.unit

_LOCK_FILE = (
    Path(__file__).resolve().parents[2]
    / "frontend"
    / "src"
    / "utils"
    / "eventAttendanceLock.ts"
)

_LIST = re.compile(
    r"export const ATTENDANCE_LOCKED_EVENT_FIELDS = \[(?P<body>.*?)\]", re.S
)
_ENTRY = re.compile(r"'(?P<field>[a-z_]+)'")
# A commented-out entry is invisible to the compiler, so it must be here too.
_COMMENT = re.compile(r"//[^\n]*|/\*.*?\*/", re.S)


def _entries(source: str) -> list[str]:
    match = _LIST.search(source)
    assert match, "ATTENDANCE_LOCKED_EVENT_FIELDS not found"
    return _ENTRY.findall(_COMMENT.sub("", match.group("body")))


def _frontend_fields() -> list[str]:
    return _entries(_LOCK_FILE.read_text(encoding="utf-8"))


class TestTheParser:
    """A regex that silently matched nothing would make the test below pass
    for an empty list on one side only — so prove it reads the list."""

    def test_it_finds_the_list(self):
        assert "start_datetime" in _frontend_fields()

    def test_a_commented_out_entry_is_not_counted(self):
        source = (
            "export const ATTENDANCE_LOCKED_EVENT_FIELDS = [\n"
            "  'start_datetime',\n"
            "  // 'require_checkout',\n"
            "  /* 'event_type', */\n"
            "] as const;\n"
        )
        assert _entries(source) == ["start_datetime"]


def test_the_frontend_leaves_out_exactly_what_the_backend_locks():
    """Limited to what an update can carry: the actual start and end are
    locked too, but are recorded through their own endpoint."""
    expected = ATTENDANCE_SENSITIVE_UPDATE_FIELDS & set(EventUpdate.model_fields)
    fields = _frontend_fields()

    assert len(fields) == len(set(fields)), "a field is listed twice"
    assert set(fields) == expected
