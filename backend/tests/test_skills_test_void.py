"""
Tests for withdrawing an official skills-test result.

Official results are never deleted — a member's certification may rest on one —
so a mistaken or invalidated test is *voided*: the row survives with its reason
and author, drops out of statistics, and releases any training-pipeline
requirement its pass had credited.

Covers the pipeline release (revert_test_pass_from_pipeline) and the
authorization helpers that decide who may drive a test. DB is mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.skills_testing import _authorize_test_write
from app.models.training import RequirementProgressStatus
from app.services.skills_testing_service import revert_test_pass_from_pipeline
from app.services.training_program_service import TrainingProgramService


def _scalars(items):
    r = MagicMock()
    r.scalars.return_value.all.return_value = items
    return r


class RecordingSession:
    """Minimal AsyncSession stand-in returning queued results in order."""

    def __init__(self, results=None):
        self._results = list(results or [])
        self.executed = []

    async def execute(self, *args, **kwargs):
        self.executed.append(args[0] if args else None)
        return self._results.pop(0) if self._results else MagicMock()


class TestRevertTestPassFromPipeline:
    async def test_reverts_requirement_on_each_enrollment(self, monkeypatch):
        progress_a = SimpleNamespace(id="rp-a")
        progress_b = SimpleNamespace(id="rp-b")
        db = RecordingSession([_scalars([progress_a, progress_b])])

        mock_update = AsyncMock(return_value=(SimpleNamespace(), None))
        monkeypatch.setattr(
            TrainingProgramService, "update_requirement_progress", mock_update
        )

        org = uuid4()
        await revert_test_pass_from_pipeline(
            db=db,
            candidate_id="cand-1",
            requirement_id="req-1",
            organization_id=org,
        )

        assert mock_update.await_count == 2
        seen_ids = {c.kwargs["progress_id"] for c in mock_update.await_args_list}
        assert seen_ids == {"rp-a", "rp-b"}
        for call in mock_update.await_args_list:
            # not_started clears completed_at and the rollup percentage, which is
            # what actually un-credits the requirement.
            assert call.kwargs["updates"].status == "not_started"
            assert call.kwargs["organization_id"] == org

    async def test_does_not_reverify_on_revert(self, monkeypatch):
        """A revert must not stamp verified_by — nobody verified anything."""
        db = RecordingSession([_scalars([SimpleNamespace(id="rp-a")])])
        mock_update = AsyncMock(return_value=(SimpleNamespace(), None))
        monkeypatch.setattr(
            TrainingProgramService, "update_requirement_progress", mock_update
        )

        await revert_test_pass_from_pipeline(
            db=db,
            candidate_id="cand-1",
            requirement_id="req-1",
            organization_id=uuid4(),
        )

        assert mock_update.await_args_list[0].kwargs.get("verified_by") is None

    async def test_only_satisfied_progress_is_queried(self, monkeypatch):
        """Waived requirements are an officer's own call, not this test's doing,
        so the query narrows to completed/verified rows."""
        db = RecordingSession([_scalars([])])
        monkeypatch.setattr(
            TrainingProgramService, "update_requirement_progress", AsyncMock()
        )

        await revert_test_pass_from_pipeline(
            db=db,
            candidate_id="cand-1",
            requirement_id="req-1",
            organization_id=uuid4(),
        )

        # render_postcompile expands the IN (...) list, which is otherwise held
        # back as a single POSTCOMPILE placeholder with no values in .params.
        compiled = db.executed[0].compile(compile_kwargs={"render_postcompile": True})
        bound = {
            v.value if isinstance(v, RequirementProgressStatus) else v
            for v in compiled.params.values()
        }

        assert {
            RequirementProgressStatus.COMPLETED.value,
            RequirementProgressStatus.VERIFIED.value,
        }.issubset(bound)
        assert RequirementProgressStatus.WAIVED.value not in bound

    async def test_noop_when_no_matching_progress(self, monkeypatch):
        db = RecordingSession([_scalars([])])
        mock_update = AsyncMock()
        monkeypatch.setattr(
            TrainingProgramService, "update_requirement_progress", mock_update
        )

        await revert_test_pass_from_pipeline(
            db=db,
            candidate_id="cand-1",
            requirement_id="req-1",
            organization_id=uuid4(),
        )
        mock_update.assert_not_awaited()

    async def test_updater_failure_is_swallowed(self, monkeypatch):
        db = RecordingSession([_scalars([SimpleNamespace(id="rp-a")])])
        monkeypatch.setattr(
            TrainingProgramService,
            "update_requirement_progress",
            AsyncMock(side_effect=RuntimeError("boom")),
        )

        # Must not raise — the void itself is already committed.
        await revert_test_pass_from_pipeline(
            db=db,
            candidate_id="cand-1",
            requirement_id="req-1",
            organization_id=uuid4(),
        )


class TestAuthorizeTestWrite:
    """Who may drive a test: officers always, peer examiners only on practice."""

    @staticmethod
    def _user(user_id, permissions):
        return SimpleNamespace(id=user_id, permissions=permissions, roles=[])

    @staticmethod
    def _test(examiner_id, candidate_id, is_practice):
        return SimpleNamespace(
            examiner_id=examiner_id,
            candidate_id=candidate_id,
            is_practice=is_practice,
        )

    def test_officer_may_write_official_test(self, monkeypatch):
        monkeypatch.setattr(
            "app.api.v1.endpoints.skills_testing.user_has_permission",
            lambda user, perm: True,
        )
        _authorize_test_write(
            self._test("someone-else", "cand", False), self._user("officer", ["*"])
        )

    def test_member_may_write_own_practice_test(self, monkeypatch):
        monkeypatch.setattr(
            "app.api.v1.endpoints.skills_testing.user_has_permission",
            lambda user, perm: False,
        )
        _authorize_test_write(
            self._test("member-1", "cand", True), self._user("member-1", [])
        )

    def test_member_may_not_write_official_test(self, monkeypatch):
        monkeypatch.setattr(
            "app.api.v1.endpoints.skills_testing.user_has_permission",
            lambda user, perm: False,
        )
        with pytest.raises(HTTPException) as exc:
            _authorize_test_write(
                self._test("member-1", "cand", False), self._user("member-1", [])
            )
        assert exc.value.status_code == 403

    def test_candidate_may_not_score_their_own_practice_test(self, monkeypatch):
        """The candidate is the one being evaluated — write access would make the
        practice record self-scored."""
        monkeypatch.setattr(
            "app.api.v1.endpoints.skills_testing.user_has_permission",
            lambda user, perm: False,
        )
        with pytest.raises(HTTPException) as exc:
            _authorize_test_write(
                self._test("examiner-1", "member-1", True), self._user("member-1", [])
            )
        assert exc.value.status_code == 403

    def test_unrelated_member_may_not_write_practice_test(self, monkeypatch):
        monkeypatch.setattr(
            "app.api.v1.endpoints.skills_testing.user_has_permission",
            lambda user, perm: False,
        )
        with pytest.raises(HTTPException) as exc:
            _authorize_test_write(
                self._test("examiner-1", "cand-1", True), self._user("stranger", [])
            )
        assert exc.value.status_code == 403
