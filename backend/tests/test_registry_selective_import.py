"""
Tests for pick-and-choose registry import:
  * preview_registry_requirements flags already-imported items
  * import_registry_requirements(selected_codes=...) imports only those codes
Runs against the real NFPA registry file; DB mocked.
"""

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from app.api.v1.endpoints.training_programs import _REGISTRY_DIR, _REGISTRY_FILES
from app.services.training_program_service import TrainingProgramService

NFPA_PATH = str(_REGISTRY_DIR / _REGISTRY_FILES["nfpa"])


def _rows(rows):
    r = MagicMock()
    r.all.return_value = rows
    return r


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


class RecordingSession:
    def __init__(self, results):
        self._results = list(results)
        self.added = []
        self.commit = AsyncMock()

    def add(self, obj):
        self.added.append(obj)

    async def execute(self, statement, *args, **kwargs):
        return self._results.pop(0) if self._results else MagicMock()


class TestPreview:
    async def test_lists_requirements_and_flags_already_imported(self):
        # Org already holds NFPA 1001.
        db = RecordingSession([_rows([("NFPA 1001",)])])
        svc = TrainingProgramService(db)

        items, error = await svc.preview_registry_requirements(NFPA_PATH, uuid4())

        assert error is None
        by_code = {i["registry_code"]: i for i in items}
        assert by_code["NFPA 1001"]["already_imported"] is True
        assert by_code["NFPA 1072"]["already_imported"] is False
        # Preview carries enough to render each row.
        assert by_code["NFPA 1072"]["name"]
        assert by_code["NFPA 1072"]["requirement_type"] == "hours"

    async def test_missing_file_returns_error(self):
        svc = TrainingProgramService(RecordingSession([]))
        items, error = await svc.preview_registry_requirements("/nope.json", uuid4())
        assert items is None and "not found" in error.lower()


class TestSelectiveImport:
    async def test_imports_only_selected_codes(self):
        # One selected code (1072); its existence check returns None -> created.
        db = RecordingSession([_one(None)])
        svc = TrainingProgramService(db)

        count, errors, _, _ = await svc.import_registry_requirements(
            registry_file_path=NFPA_PATH,
            organization_id=uuid4(),
            created_by=uuid4(),
            selected_codes=["NFPA 1072"],
        )

        assert count == 1
        assert not errors
        assert len(db.added) == 1
        assert db.added[0].registry_code == "NFPA 1072"

    async def test_empty_selection_imports_nothing(self):
        db = RecordingSession([])
        svc = TrainingProgramService(db)

        count, errors, _, _ = await svc.import_registry_requirements(
            registry_file_path=NFPA_PATH,
            organization_id=uuid4(),
            created_by=uuid4(),
            selected_codes=[],
        )

        assert count == 0
        assert db.added == []

    async def test_none_selection_imports_all(self):
        # No selection -> whole registry; every existence check returns None.
        db = RecordingSession([_one(None) for _ in range(20)])
        svc = TrainingProgramService(db)

        count, _, _, _ = await svc.import_registry_requirements(
            registry_file_path=NFPA_PATH,
            organization_id=uuid4(),
            created_by=uuid4(),
            selected_codes=None,
        )

        assert count == len(db.added) == 14  # full NFPA registry
