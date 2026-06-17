"""
Tests for event CSV import (app/services/event_service.py).

Covers parse_csv_file (header normalization, BOM handling, value stripping)
and import_events_from_csv row validation: missing/invalid title,
event_type, and datetimes; the multi-format datetime parser; the
end-after-start rule; is_mandatory truthiness; 1-based+header row numbering;
and a successful multi-row import. DB mocked; no MySQL.
"""

from unittest.mock import AsyncMock, MagicMock

from app.services.event_service import EventService


class _SavepointCM:
    """Stand-in for db.begin_nested()'s async savepoint context manager."""

    async def __aenter__(self):
        return None

    async def __aexit__(self, *exc):
        return False  # don't suppress — a row error propagates to the caller


def _db():
    db = MagicMock()
    db.add = MagicMock()
    db.flush = AsyncMock()
    db.commit = AsyncMock()
    db.begin_nested = MagicMock(side_effect=lambda: _SavepointCM())
    return db


def _row(**kw):
    base = {
        "title": "Drill",
        "event_type": "training",
        "start_datetime": "2026-06-01 19:00",
        "end_datetime": "2026-06-01 21:00",
    }
    base.update(kw)
    return base


async def _import(rows):
    db = _db()
    count, errors = await EventService(db).import_events_from_csv(rows, "org-1", "u1")
    return db, count, errors


class TestParseCsvFile:
    def test_normalizes_headers_and_strips(self):
        content = b"Title, Event Type ,Start Datetime\n Drill , training , 2026-06-01 19:00 \n"
        rows = EventService.parse_csv_file(content)
        assert rows == [
            {
                "title": "Drill",
                "event_type": "training",
                "start_datetime": "2026-06-01 19:00",
            }
        ]

    def test_handles_utf8_bom(self):
        content = "﻿title\nDrill\n".encode("utf-8")  # leading BOM
        rows = EventService.parse_csv_file(content)
        assert rows[0]["title"] == "Drill"


class TestImportValidation:
    async def test_missing_title(self):
        _, count, errors = await _import([_row(title="")])
        assert count == 0
        assert errors[0]["error"] == "Missing required field: title"
        assert errors[0]["row"] == 2  # header is row 1

    async def test_missing_event_type(self):
        _, count, errors = await _import([_row(event_type="")])
        assert errors[0]["error"] == "Missing required field: event_type"

    async def test_invalid_event_type(self):
        _, count, errors = await _import([_row(event_type="banquet")])
        assert "Invalid event_type" in errors[0]["error"]

    async def test_missing_start(self):
        _, count, errors = await _import([_row(start_datetime="")])
        assert errors[0]["error"] == "Missing required field: start_datetime"

    async def test_invalid_start_format(self):
        _, count, errors = await _import([_row(start_datetime="not-a-date")])
        assert "Invalid start_datetime format" in errors[0]["error"]

    async def test_end_before_start(self):
        _, count, errors = await _import(
            [_row(start_datetime="2026-06-01 21:00", end_datetime="2026-06-01 19:00")]
        )
        assert errors[0]["error"] == "end_datetime must be after start_datetime"

    async def test_event_type_space_normalized(self):
        # "public education" -> "public_education"
        db, count, errors = await _import([_row(event_type="public education")])
        assert count == 1
        assert errors == []


class TestImportSuccess:
    async def test_imports_valid_rows_and_commits(self):
        rows = [_row(title="Drill A"), _row(title="Drill B")]
        db, count, errors = await _import(rows)
        assert count == 2
        assert errors == []
        assert db.add.call_count == 2
        db.commit.assert_awaited()

    async def test_row_db_failure_is_isolated_to_that_row(self):
        # A row that fails inside its savepoint (e.g. a DB constraint at flush)
        # must be recorded as a per-row error without aborting the rest of the
        # import — the good rows still import and commit.
        rows = [_row(title="A"), _row(title="B"), _row(title="C")]
        db = _db()
        calls = {"n": 0}

        def add_side(_event):
            calls["n"] += 1
            if calls["n"] == 2:  # the second data row fails
                raise RuntimeError("simulated db constraint")

        db.add = MagicMock(side_effect=add_side)

        count, errors = await EventService(db).import_events_from_csv(
            rows, "org-1", "u1"
        )
        assert count == 2
        assert len(errors) == 1
        assert errors[0]["row"] == 3  # header=row 1, data rows start at 2
        db.commit.assert_awaited()  # the two good rows are still committed

    async def test_is_mandatory_truthiness(self):
        db = _db()
        await EventService(db).import_events_from_csv(
            [_row(is_mandatory="yes")], "org-1", "u1"
        )
        event = db.add.call_args.args[0]
        assert event.is_mandatory is True

    async def test_mixed_valid_and_invalid_rows(self):
        rows = [_row(title="Good"), _row(title=""), _row(event_type="training")]
        db, count, errors = await _import(rows)
        assert count == 2  # rows 1 and 3 valid
        assert len(errors) == 1
        assert errors[0]["row"] == 3  # the empty-title row (2nd data row)

    async def test_us_datetime_format_parsed(self):
        # "06/01/2026 07:00 PM" should parse via the %m/%d/%Y %I:%M %p format.
        db, count, errors = await _import(
            [
                _row(
                    start_datetime="06/01/2026 07:00 PM",
                    end_datetime="06/01/2026 09:00 PM",
                )
            ]
        )
        assert count == 1
        assert errors == []


if __name__ == "__main__":  # pragma: no cover
    import pytest

    raise SystemExit(pytest.main([__file__, "-v"]))
