"""
Security-review finding (training core, 2026-08-26): a client-supplied
``course_id`` was never validated in-org on any of the three write paths
that persist it -- ``create_record``, ``create_records_bulk``, and
``confirm_historical_import`` -- unlike ``user_id`` (TR-2) and
``category_id`` (TR-7) on the exact same endpoints, which already do. Each
now rejects a course_id that doesn't resolve to a row in the caller's org
before storing it (XC-1).

DB mocked; no MySQL.
"""

from datetime import date
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.training import (
    confirm_historical_import,
    create_record,
    create_records_bulk,
)
from app.schemas.training import (
    BulkTrainingRecordCreate,
    BulkTrainingRecordEntry,
    CourseMappingEntry,
    HistoricalImportConfirmRequest,
    HistoricalImportParsedRow,
    TrainingRecordCreate,
)


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


def _scalars(items):
    r = MagicMock()
    r.scalars.return_value.all.return_value = items
    return r


def _rows(rows):
    r = MagicMock()
    r.all.return_value = rows
    return r


class _RecordingSession:
    def __init__(self, results=None):
        self._results = list(results or [])
        self.added = []
        self.add = MagicMock(side_effect=self.added.append)
        self.commit = AsyncMock()
        self.refresh = AsyncMock()
        self.flush = AsyncMock()
        self.rollback = AsyncMock()
        self.get = AsyncMock(return_value=None)

    async def execute(self, statement, *args, **kwargs):
        return self._results.pop(0) if self._results else MagicMock()


def _user():
    return MagicMock(id="u-officer", organization_id="org-1", username="officer1")


class TestCreateRecordCourseScoping:
    async def test_rejects_a_foreign_course_id(self):
        db = _RecordingSession(results=[_one(None)])  # course lookup -> not found
        record = TrainingRecordCreate(
            user_id=uuid4(),
            course_id=uuid4(),
            course_name="CPR",
            training_type="continuing_education",
            hours_completed=2,
        )

        with pytest.raises(HTTPException) as exc:
            await create_record(record, MagicMock(), db, _user())

        assert exc.value.status_code == 404
        assert "course" in exc.value.detail.lower()
        assert db.added == []


class TestCreateRecordsBulkCourseScoping:
    async def test_rejects_a_row_with_a_foreign_course_id(self):
        member_id = uuid4()
        member = MagicMock(id=str(member_id), rank="FF", station="1")
        db = _RecordingSession(
            results=[
                _scalars([member]),  # in-org members pre-fetch
                _one(None),  # course lookup -> not found
            ]
        )
        entry = BulkTrainingRecordEntry(
            user_id=member_id,
            course_id=uuid4(),
            course_name="CPR",
            training_type="continuing_education",
            hours_completed=2,
            completion_date=None,
        )
        payload = BulkTrainingRecordCreate(records=[entry])

        result = await create_records_bulk(payload, MagicMock(), db, _user())

        assert result.created == 0
        assert result.failed == 1
        assert any("course" in e.lower() for e in result.errors)
        assert db.added == []


class TestConfirmHistoricalImportCourseScoping:
    async def test_rejects_a_map_existing_row_with_a_foreign_course(self):
        member_id = uuid4()
        foreign_course_id = str(uuid4())

        db = _RecordingSession(
            results=[
                _rows([(str(member_id),)]),  # valid in-org member ids
                _rows([]),  # valid in-org course ids: none found
            ]
        )

        row = HistoricalImportParsedRow(
            row_number=1,
            user_id=str(member_id),
            course_name="Unmatched Course",
            course_matched=False,
            hours_completed=1,
            completion_date=date(2026, 1, 1),
        )
        mapping = CourseMappingEntry(
            csv_course_name="Unmatched Course",
            action="map_existing",
            existing_course_id=foreign_course_id,
        )
        request = HistoricalImportConfirmRequest(
            rows=[row],
            course_mappings=[mapping],
            default_training_type="continuing_education",
            default_status="completed",
        )

        result = await confirm_historical_import(request, db, _user())

        assert result.imported == 0
        assert result.failed == 1
        assert any("catalog" in e.lower() for e in result.errors)
        assert db.added == []
