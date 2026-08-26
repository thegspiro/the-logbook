"""
Security-review finding (training core, 2026-08-26): ``import_program_from_json``
ingests an arbitrary user-uploaded JSON body and wrote a requirement's
client-supplied ``category_ids`` straight onto ``TrainingRequirement`` with no
in-org check -- unlike ``required_courses``/linked-requirement ids on every
other creation path in this file, which all go through ``assert_all_in_org``.
An out-of-org category id would persist a dangling cross-tenant reference the
compliance evaluator later matches training records against (XC-1).

DB mocked; no MySQL.
"""

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.services.training_program_service import TrainingProgramService


def _rows(rows):
    """Result whose ``.all()`` yields raw rows, as org-scope checks read them."""
    r = MagicMock()
    r.all.return_value = rows
    return r


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


class RecordingSession:
    """Async session that returns queued results and records added objects."""

    def __init__(self, results=None):
        self._results = list(results or [])
        self.added = []
        self.commit = AsyncMock()
        self.refresh = AsyncMock()
        self.flush = AsyncMock()
        self.rollback = AsyncMock()

    def add(self, obj):
        self.added.append(obj)

    async def execute(self, statement, *args, **kwargs):
        return self._results.pop(0) if self._results else MagicMock()


def _import_payload(category_ids):
    return {
        "program": {"name": "EMT Refresher", "structure_type": "flexible"},
        "phases": [
            {
                "phase_number": 1,
                "name": "Phase 1",
                "requirements": [
                    {
                        "requirement": {
                            "name": "CPR Card",
                            "category_ids": category_ids,
                        }
                    }
                ],
            }
        ],
    }


class TestImportProgramCategoryScoping:
    async def test_rejects_a_foreign_category_id(self):
        db = RecordingSession(
            results=[
                _one(None),  # no existing requirement with this name/source
                _rows([]),  # category not in this org
            ]
        )
        svc = TrainingProgramService(db)

        with pytest.raises(ValueError, match="category"):
            await svc.import_program_from_json(
                _import_payload([str(uuid4())]), "org-1", "u1"
            )

    async def test_accepts_an_in_org_category_id(self):
        cat_id = str(uuid4())
        db = RecordingSession(
            results=[
                _one(None),  # no existing requirement with this name/source
                _rows([(cat_id,)]),  # category found in this org
            ]
        )
        svc = TrainingProgramService(db)

        # Does not raise.
        await svc.import_program_from_json(_import_payload([cat_id]), "org-1", "u1")

        created = [
            obj for obj in db.added if type(obj).__name__ == "TrainingRequirement"
        ]
        assert len(created) == 1
        assert created[0].category_ids == [cat_id]

    async def test_no_category_ids_skips_validation(self):
        db = RecordingSession(
            results=[_one(None)]  # no existing requirement with this name/source
        )
        svc = TrainingProgramService(db)

        await svc.import_program_from_json(_import_payload(None), "org-1", "u1")

        created = [
            obj for obj in db.added if type(obj).__name__ == "TrainingRequirement"
        ]
        assert len(created) == 1
