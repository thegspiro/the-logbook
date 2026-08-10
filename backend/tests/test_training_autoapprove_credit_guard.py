"""
TR-5 (owner decision 2026-08-09): auto-approve on self-reported training must
never let a member self-credit a certification or a training requirement without
a second person's sign-off. A submission that would credit a
certification/requirement is always routed to manual review (PENDING_REVIEW),
regardless of the org's auto-approve config; only non-crediting submissions
(plain logged hours, skills practice) may auto-approve. DB mocked; no MySQL.
"""

from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.training import SubmissionStatus, TrainingType
from app.services.training_submission_service import TrainingSubmissionService


def _svc(config):
    svc = TrainingSubmissionService(MagicMock())
    svc.get_config = AsyncMock(return_value=config)
    svc.db.add = MagicMock()
    svc.db.commit = AsyncMock()
    svc.db.refresh = AsyncMock()
    # Guard against the auto-approve side effects touching the mocked DB.
    svc._check_duplicate = AsyncMock(return_value=None)
    svc._create_record_from_submission = AsyncMock(return_value=None)
    return svc


def _config(*, require_approval=False, auto_approve_under_hours=None):
    return SimpleNamespace(
        require_approval=require_approval,
        auto_approve_under_hours=auto_approve_under_hours,
        max_hours_per_submission=None,
        allowed_training_types=None,
    )


class TestAutoApproveCreditGuard:
    async def test_helper_flags_certification_type(self):
        assert TrainingSubmissionService._credits_certification_or_requirement(
            TrainingType.CERTIFICATION.value, {}
        )

    async def test_helper_flags_certification_number(self):
        assert TrainingSubmissionService._credits_certification_or_requirement(
            TrainingType.CONTINUING_EDUCATION.value, {"certification_number": "NR-1"}
        )

    async def test_helper_flags_category_link(self):
        assert TrainingSubmissionService._credits_certification_or_requirement(
            TrainingType.CONTINUING_EDUCATION.value, {"category_id": "cat1"}
        )

    async def test_helper_allows_plain_logged_hours(self):
        assert not TrainingSubmissionService._credits_certification_or_requirement(
            TrainingType.SKILLS_PRACTICE.value, {"instructor": "Chief"}
        )

    async def test_certification_never_auto_approves(self):
        # No approval required at all, yet a certification submission must still
        # wait for a second person.
        svc = _svc(_config(require_approval=False))
        sub = await svc.create_submission(
            organization_id="org1",
            submitted_by="u1",
            course_name="Firefighter II",
            training_type=TrainingType.CERTIFICATION.value,
            completion_date=date(2026, 8, 1),
            hours_completed=2.0,
        )
        assert sub.status == SubmissionStatus.PENDING_REVIEW
        svc._create_record_from_submission.assert_not_awaited()

    async def test_requirement_linked_never_auto_approves(self):
        svc = _svc(_config(auto_approve_under_hours=40))
        sub = await svc.create_submission(
            organization_id="org1",
            submitted_by="u1",
            course_name="EMT CE",
            training_type=TrainingType.CONTINUING_EDUCATION.value,
            completion_date=date(2026, 8, 1),
            hours_completed=1.0,
            category_id="cat1",
        )
        assert sub.status == SubmissionStatus.PENDING_REVIEW
        svc._create_record_from_submission.assert_not_awaited()

    async def test_non_crediting_still_auto_approves(self):
        svc = _svc(_config(require_approval=False))
        sub = await svc.create_submission(
            organization_id="org1",
            submitted_by="u1",
            course_name="Station cleanup skills",
            training_type=TrainingType.SKILLS_PRACTICE.value,
            completion_date=date(2026, 8, 1),
            hours_completed=1.0,
        )
        assert sub.status == SubmissionStatus.APPROVED
        svc._create_record_from_submission.assert_awaited()


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
