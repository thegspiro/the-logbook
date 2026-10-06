"""TR-17 residual: enum fields on the bulk and historical imports.

The two imports record the good rows and report the bad ones, so a bad
``training_type`` or ``status`` is checked per row, with a message naming the
field and the valid values, rather than by a schema validator that would
reject the whole request (or by the database, whose failed flush used to take
every later row in the batch down with it).

DB mocked; no MySQL.
"""

from contextlib import asynccontextmanager
from datetime import date
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.api.v1.endpoints import training as training_endpoints
from app.api.v1.endpoints.training import (
    confirm_historical_import,
    create_records_bulk,
)
from app.models.training import TrainingCourse, TrainingRecord
from app.schemas.training import (
    BulkTrainingRecordCreate,
    BulkTrainingRecordEntry,
    CourseMappingEntry,
    HistoricalImportConfirmRequest,
    HistoricalImportParsedRow,
)

pytestmark = pytest.mark.unit


def _scalars(items):
    r = MagicMock()
    r.scalars.return_value.all.return_value = items
    return r


def _rows(rows):
    r = MagicMock()
    r.all.return_value = rows
    return r


class _Session:
    def __init__(self, results=None, failing_savepoints=()):
        self._results = list(results or [])
        self.added = []
        self.add = MagicMock(side_effect=self.added.append)
        self.commit = AsyncMock()
        self.flush = AsyncMock()
        self.rollback = AsyncMock()
        self._savepoint = 0
        self._failing = set(failing_savepoints)

    async def execute(self, statement, *args, **kwargs):
        return self._results.pop(0) if self._results else MagicMock()

    @asynccontextmanager
    async def _nested(self):
        self._savepoint += 1
        number = self._savepoint
        yield
        if number in self._failing:
            # What a rejected flush does: the savepoint rolls back and the
            # object is gone, but the session carries on.
            self.added.pop()
            raise RuntimeError("flush rejected")

    def begin_nested(self):
        return self._nested()


def _user():
    return MagicMock(id="u-officer", organization_id="org-1", username="officer1")


@pytest.fixture(autouse=True)
def _quiet(monkeypatch):
    monkeypatch.setattr(
        training_endpoints, "_check_duplicate_records", AsyncMock(return_value=[])
    )
    monkeypatch.setattr(training_endpoints, "_sync_qualifications", AsyncMock())
    monkeypatch.setattr(training_endpoints, "log_audit_event", AsyncMock())


def _entry(member_id, **overrides):
    fields = {
        "user_id": member_id,
        "course_name": "CPR",
        "hours_completed": 2,
    }
    fields.update(overrides)
    return BulkTrainingRecordEntry(**fields)


class TestBulkRows:
    async def test_a_bad_training_type_fails_only_its_row(self):
        member_id = uuid4()
        member = MagicMock(id=str(member_id), rank="FF", station="1")
        db = _Session(results=[_scalars([member])])
        payload = BulkTrainingRecordCreate(
            records=[
                _entry(member_id, training_type="drill"),
                _entry(member_id, course_name="Ladders"),
            ]
        )

        result = await create_records_bulk(payload, MagicMock(), db, _user())

        assert result.created == 1
        assert result.failed == 1
        assert result.errors[0].startswith("Row 1: Invalid training_type 'drill'")
        assert "continuing_education" in result.errors[0]
        assert [r.course_name for r in db.added] == ["Ladders"]

    async def test_a_bad_status_fails_only_its_row(self):
        member_id = uuid4()
        member = MagicMock(id=str(member_id), rank="FF", station="1")
        db = _Session(results=[_scalars([member])])
        payload = BulkTrainingRecordCreate(records=[_entry(member_id, status="done")])

        result = await create_records_bulk(payload, MagicMock(), db, _user())

        assert result.failed == 1
        assert result.errors == [
            "Row 1: Invalid status 'done'. Valid values: cancelled, completed, "
            "failed, in_progress, scheduled"
        ]
        assert db.added == []

    async def test_case_and_spacing_are_forgiven_and_stored_canonically(self):
        member_id = uuid4()
        member = MagicMock(id=str(member_id), rank="FF", station="1")
        db = _Session(results=[_scalars([member])])
        payload = BulkTrainingRecordCreate(
            records=[
                _entry(member_id, training_type=" Certification", status="COMPLETED")
            ]
        )

        result = await create_records_bulk(payload, MagicMock(), db, _user())

        assert result.created == 1
        record = db.added[0]
        assert isinstance(record, TrainingRecord)
        assert record.training_type == "certification"
        assert record.status == "completed"

    async def test_a_rejected_insert_does_not_take_the_next_row_with_it(self):
        member_id = uuid4()
        member = MagicMock(id=str(member_id), rank="FF", station="1")
        db = _Session(results=[_scalars([member])], failing_savepoints={1})
        payload = BulkTrainingRecordCreate(
            records=[_entry(member_id), _entry(member_id, course_name="Ladders")]
        )

        result = await create_records_bulk(payload, MagicMock(), db, _user())

        assert result.created == 1
        assert result.failed == 1
        assert [r.course_name for r in db.added] == ["Ladders"]


def _historical_row(member_id, number, course="New Course", training_type=None):
    return HistoricalImportParsedRow(
        row_number=number,
        user_id=str(member_id),
        course_name=course,
        course_matched=False,
        training_type=training_type,
        hours_completed=1,
        completion_date=date(2026, 1, 1),
    )


class TestHistoricalImport:
    async def test_a_mapping_with_a_bad_type_fails_its_rows_not_the_import(self):
        member_id = uuid4()
        db = _Session(results=[_rows([(str(member_id),)])])
        request = HistoricalImportConfirmRequest(
            rows=[
                _historical_row(member_id, 1, course="Bad Type"),
                _historical_row(member_id, 2, course="Fine"),
            ],
            course_mappings=[
                CourseMappingEntry(
                    csv_course_name="Bad Type",
                    action="create_new",
                    new_training_type="drill",
                )
            ],
        )

        result = await confirm_historical_import(request, db, _user())

        assert result.imported == 1
        assert result.failed == 1
        assert result.errors[0].startswith("Row 1: Invalid training_type 'drill'")
        assert not any(isinstance(obj, TrainingCourse) for obj in db.added)

    async def test_a_row_type_in_another_case_is_kept(self):
        member_id = uuid4()
        db = _Session(results=[_rows([(str(member_id),)])])
        request = HistoricalImportConfirmRequest(
            rows=[_historical_row(member_id, 1, training_type="Certification")]
        )

        await confirm_historical_import(request, db, _user())

        records = [obj for obj in db.added if isinstance(obj, TrainingRecord)]
        assert records[0].training_type == "certification"

    async def test_a_free_text_category_still_falls_back_to_the_default(self):
        member_id = uuid4()
        db = _Session(results=[_rows([(str(member_id),)])])
        request = HistoricalImportConfirmRequest(
            rows=[_historical_row(member_id, 1, training_type="Hazmat")],
            default_training_type="refresher",
        )

        result = await confirm_historical_import(request, db, _user())

        assert result.imported == 1
        records = [obj for obj in db.added if isinstance(obj, TrainingRecord)]
        assert records[0].training_type == "refresher"

    @pytest.mark.parametrize("field", ["default_training_type", "default_status"])
    def test_a_bad_request_default_is_refused_up_front(self, field):
        with pytest.raises(ValidationError, match=field):
            HistoricalImportConfirmRequest(rows=[], **{field: "bogus"})
