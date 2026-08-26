"""
Security-review finding (training extended, 2026-08-26): TRX-3.

``GET /training-enhancements/effectiveness/evaluations`` was gated on
``get_current_user`` only — no permission dependency, no self-filter — and
``TrainingEffectivenessService.get_evaluations`` filtered solely by
``organization_id``, so any authenticated member (no ``training.manage``)
could read every other member's self-submitted effectiveness evaluations —
free-text comments, behavior ratings — for the whole org. This is the same
member-training-PII class ``get_member_competencies`` already gates in the
same file ("competency levels are member training PII. Members read their
own via GET /competency/me").

Fixed by confining non-officers to their own submissions, mirroring the
established `training.py` pattern (`get_expiring_certifications`:
``user_id=None if is_officer else current_user.id``), and by using the
shared ``can_view_officer_training_data`` helper so ``training.view_all``
(not just ``training.manage``) also counts as officer access, matching
every other officer-gated read in this file.

The first draft's endpoint-level tests mocked the whole
``TrainingEffectivenessService``, so the ``user_id=`` keyword argument the
endpoint was now sending flowed straight past a real signature check — a
Codex review on the PR caught that ``get_evaluations`` itself was never
updated to accept it, so *every* request to this endpoint (officer or not)
would have 500'd with ``TypeError: unexpected keyword argument 'user_id'``.
``TestGetEvaluationsUserFilter`` below exercises the real service method
against a mocked DB so a signature drift like that fails loudly. DB mocked;
no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from app.api.v1.endpoints.training_enhancements import get_effectiveness_evaluations
from app.services.training_enhancement_service import TrainingEffectivenessService


def _user_with(*permissions: str):
    return SimpleNamespace(
        id="user-1",
        organization_id="org-1",
        rank=None,
        positions=[SimpleNamespace(permissions=list(permissions))],
    )


class TestEffectivenessEvaluationsSelfScoping:
    async def test_non_officer_is_confined_to_own_submissions(self):
        db = SimpleNamespace()
        with patch(
            "app.api.v1.endpoints.training_enhancements.TrainingEffectivenessService"
        ) as ServiceCls:
            instance = ServiceCls.return_value
            instance.get_evaluations = AsyncMock(return_value=[])

            await get_effectiveness_evaluations(
                course_id=None,
                session_id=None,
                level=None,
                db=db,
                current_user=_user_with(),
            )

            instance.get_evaluations.assert_awaited_once_with(
                "org-1", course_id=None, session_id=None, level=None, user_id="user-1"
            )

    async def test_manage_permission_sees_whole_org(self):
        db = SimpleNamespace()
        with patch(
            "app.api.v1.endpoints.training_enhancements.TrainingEffectivenessService"
        ) as ServiceCls:
            instance = ServiceCls.return_value
            instance.get_evaluations = AsyncMock(return_value=[])

            await get_effectiveness_evaluations(
                course_id=None,
                session_id=None,
                level=None,
                db=db,
                current_user=_user_with("training.manage"),
            )

            instance.get_evaluations.assert_awaited_once_with(
                "org-1", course_id=None, session_id=None, level=None, user_id=None
            )

    async def test_view_all_permission_also_sees_whole_org(self):
        """training.view_all is read-only officer access, not training.manage,
        but can_view_officer_training_data treats it as sufficient for every
        other officer-gated training read — this endpoint must match."""
        db = SimpleNamespace()
        with patch(
            "app.api.v1.endpoints.training_enhancements.TrainingEffectivenessService"
        ) as ServiceCls:
            instance = ServiceCls.return_value
            instance.get_evaluations = AsyncMock(return_value=[])

            await get_effectiveness_evaluations(
                course_id=None,
                session_id=None,
                level=None,
                db=db,
                current_user=_user_with("training.view_all"),
            )

            instance.get_evaluations.assert_awaited_once_with(
                "org-1", course_id=None, session_id=None, level=None, user_id=None
            )


class TestGetEvaluationsUserFilter:
    """Exercises the real service method (not a mocked stand-in) so a
    signature drift between the endpoint and the service — the P1 Codex
    caught on this PR's first draft — fails here instead of 500ing in
    production."""

    async def test_user_id_narrows_the_query(self):
        db = MagicMock()
        result = MagicMock()
        result.scalars.return_value.all.return_value = []
        db.execute = AsyncMock(return_value=result)

        service = TrainingEffectivenessService(db)
        await service.get_evaluations("org-1", user_id="user-1")

        stmt = db.execute.await_args.args[0]
        assert "user_id" in str(stmt.whereclause)

    async def test_no_user_id_does_not_filter_by_user(self):
        db = MagicMock()
        result = MagicMock()
        result.scalars.return_value.all.return_value = []
        db.execute = AsyncMock(return_value=result)

        service = TrainingEffectivenessService(db)
        await service.get_evaluations("org-1")

        stmt = db.execute.await_args.args[0]
        assert "user_id" not in str(stmt.whereclause)
