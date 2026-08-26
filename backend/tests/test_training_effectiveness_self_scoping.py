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
``user_id=None if is_officer else current_user.id``). DB mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.api.v1.endpoints.training_enhancements import get_effectiveness_evaluations


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

    async def test_officer_sees_whole_org(self):
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
