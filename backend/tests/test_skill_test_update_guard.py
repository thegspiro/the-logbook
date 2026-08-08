"""
Tests for the write guard on ``PUT /training/skills-testing/tests/{id}``.

A completed test is frozen apart from notes, and every save from the examiner
screen also carries ``expected_version`` so a concurrent edit is refused rather
than silently overwritten. Those two rules meet here: the version is the copy
the client is writing *against*, not a column it is asking to change, so it must
never be counted among the fields a completed test rejects.

DB is mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.skills_testing import update_test
from app.schemas.skills_testing import SkillTestUpdate

EXAMINER_ID = uuid4()
ORG_ID = uuid4()
TEST_ID = uuid4()


class StubSession:
    """AsyncSession stand-in whose first execute() returns the test row."""

    def __init__(self, test):
        result = MagicMock()
        result.scalar_one_or_none.return_value = test
        self._result = result
        self.committed = False

    async def execute(self, *args, **kwargs):
        return self._result

    async def commit(self):
        self.committed = True

    async def refresh(self, obj):
        return obj


def _completed_test(**overrides):
    base = {
        "id": str(TEST_ID),
        "organization_id": str(ORG_ID),
        "examiner_id": str(EXAMINER_ID),
        "candidate_id": str(uuid4()),
        "status": "completed",
        "version": 4,
        "validated_at": None,
        "started_at": None,
        "notes": None,
        "section_results": [],
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def _examiner():
    """The member running the test — authorized to write it, not an officer."""
    return SimpleNamespace(
        id=EXAMINER_ID,
        organization_id=ORG_ID,
        username="examiner",
        is_superuser=False,
        positions=[],
        rank=None,
    )


class TestCompletedTestFieldGuard:
    async def test_expected_version_is_not_treated_as_an_updated_field(self):
        """The version token must not be reported as a field being changed.

        Before this, a save of criterion notes on a completed test — which the
        examiner screen sends with expected_version on every write — came back
        "Cannot update expected_version on a completed test", naming a field the
        examiner never touched and hiding whatever the real problem was.
        """
        db = StubSession(_completed_test())

        with pytest.raises(HTTPException) as exc:
            await update_test(
                test_id=TEST_ID,
                test_update=SkillTestUpdate(notes="Reviewed", expected_version=1),
                db=db,
                current_user=_examiner(),
            )

        # Stale version, so this stops at the concurrency check — the point being
        # that it is that check it reaches, not the frozen-field one.
        assert exc.value.status_code == 409
        assert "expected_version" not in str(exc.value.detail)
        assert not db.committed

    async def test_genuinely_frozen_fields_are_still_refused(self):
        db = StubSession(_completed_test())

        with pytest.raises(HTTPException) as exc:
            await update_test(
                test_id=TEST_ID,
                test_update=SkillTestUpdate(elapsed_seconds=120, expected_version=4),
                db=db,
                current_user=_examiner(),
            )

        assert exc.value.status_code == 400
        assert "elapsed_seconds" in str(exc.value.detail)
        # Only the offending field is named.
        assert "expected_version" not in str(exc.value.detail)
        assert not db.committed
