"""Granting one named person sight of a single skills test's result.

``add_test_viewer`` (``POST /tests/{test_id}/viewers``) exists for a
relationship the candidate and template position rules cannot express — a
preceptor, an FTO, a mentor. Two people already see the result through other
means and a grant naming either is a no-op the officer could not tell had done
nothing: the candidate (who sees their own result as policy allows) and the
examiner (who holds FULL disclosure on their own scoring regardless of any
grant — see ``resolve_result_view``'s examiner short-circuit). Both are
rejected server-side so a caller bypassing ``TestViewersPanel.tsx``'s picker
(which excludes both from the search results client-side) cannot write a
grant the frontend's own docstring already claims the API refuses.

DB is mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints import skills_testing as endpoint
from app.schemas.skills_testing import SkillTestViewerCreate


def _scalar(value):
    r = MagicMock()
    r.scalar_one_or_none.return_value = value
    return r


class RecordingSession:
    """Minimal AsyncSession stand-in returning queued results in order."""

    def __init__(self, results):
        self._results = list(results)

    async def execute(self, *args, **kwargs):
        return self._results.pop(0)


class TestAddViewerSelfDealingGuard:
    async def test_naming_the_candidate_is_rejected(self):
        candidate_id = uuid4()
        examiner_id = uuid4()
        org_id = uuid4()
        current_user = SimpleNamespace(id=uuid4(), organization_id=org_id)
        test = SimpleNamespace(
            candidate_id=str(candidate_id), examiner_id=str(examiner_id)
        )
        candidate_user = SimpleNamespace(id=candidate_id)

        # Query order: fetch the test, then fetch the named user.
        db = RecordingSession([_scalar(test), _scalar(candidate_user)])

        with pytest.raises(HTTPException) as exc:
            await endpoint.add_test_viewer(
                test_id=uuid4(),
                viewer_data=SkillTestViewerCreate(user_id=candidate_id),
                db=db,
                current_user=current_user,
            )
        assert exc.value.status_code == 400
        assert "candidate" in exc.value.detail.lower()

    async def test_naming_the_examiner_is_rejected(self):
        candidate_id = uuid4()
        examiner_id = uuid4()
        org_id = uuid4()
        current_user = SimpleNamespace(id=uuid4(), organization_id=org_id)
        test = SimpleNamespace(
            candidate_id=str(candidate_id), examiner_id=str(examiner_id)
        )
        examiner_user = SimpleNamespace(id=examiner_id)

        db = RecordingSession([_scalar(test), _scalar(examiner_user)])

        with pytest.raises(HTTPException) as exc:
            await endpoint.add_test_viewer(
                test_id=uuid4(),
                viewer_data=SkillTestViewerCreate(user_id=examiner_id),
                db=db,
                current_user=current_user,
            )
        assert exc.value.status_code == 400
        assert "examiner" in exc.value.detail.lower()

    async def test_a_third_party_is_still_grantable(self, monkeypatch):
        """Guards against the fix over-matching: an ordinary member — neither
        candidate nor examiner — must still reach the grant path."""
        candidate_id = uuid4()
        examiner_id = uuid4()
        org_id = uuid4()
        current_user = SimpleNamespace(
            id=uuid4(),
            organization_id=org_id,
            username="officer",
            first_name="Sam",
            last_name="Officer",
        )
        test = SimpleNamespace(
            candidate_id=str(candidate_id), examiner_id=str(examiner_id)
        )
        mentor_id = uuid4()
        mentor_user = SimpleNamespace(
            id=mentor_id, first_name="Pat", last_name="Mentor"
        )

        # Query order after the two self-dealing checks pass: the in-org member
        # lookup, then the existing-grant lookup (none found).
        db = RecordingSession([_scalar(test), _scalar(mentor_user), _scalar(None)])
        db.add = MagicMock()
        db.commit = AsyncMock()

        async def _refresh(grant):
            grant.id = uuid4()
            grant.granted_at = None

        db.refresh = _refresh

        monkeypatch.setattr(endpoint, "log_audit_event", AsyncMock())

        result = await endpoint.add_test_viewer(
            test_id=uuid4(),
            viewer_data=SkillTestViewerCreate(user_id=mentor_id),
            db=db,
            current_user=current_user,
        )
        assert str(result.user_id) == str(mentor_id)
