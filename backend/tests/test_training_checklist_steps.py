"""
Tests for checklist requirement steps.

A CHECKLIST requirement's steps used to be bare strings that nothing ever showed
to anybody. They are now objects carrying a stable id and a member-visible flag,
signed off one at a time. Covers:

* normalization — legacy strings, objects, and a mix of the two
* per-step sign-off through update_requirement_progress (officer only)
* the officer-only flag keeping a step out of the member's view while still
  counting toward the requirement

DB mocked; no MySQL.
"""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from app.api.v1.endpoints.training_programs import (
    _member_progress,
    _member_requirement,
)
from app.models.training import RequirementProgressStatus, RequirementType
from app.schemas.training_program import RequirementProgressUpdate
from app.services.training_program_service import TrainingProgramService
from app.utils.checklist import (
    checklist_progress,
    member_visible_items,
    normalize_checklist_items,
    prune_done_ids,
    to_storage,
)


class TestNormalization:
    def test_legacy_strings_become_visible_steps_with_ids(self):
        items = normalize_checklist_items(["Gear issued", "Station tour"])
        assert [i["text"] for i in items] == ["Gear issued", "Station tour"]
        assert all(i["member_visible"] for i in items)
        assert len({i["id"] for i in items}) == 2

    def test_objects_keep_their_id_and_visibility(self):
        items = normalize_checklist_items(
            [{"id": "s1", "text": "References called", "member_visible": False}]
        )
        assert items == [
            {"id": "s1", "text": "References called", "member_visible": False}
        ]

    def test_a_mixed_list_normalizes(self):
        items = normalize_checklist_items(
            [
                "Gear issued",
                {"id": "s2", "text": "Background check", "member_visible": False},
            ]
        )
        assert [i["member_visible"] for i in items] == [True, False]

    def test_blank_and_non_entries_are_dropped(self):
        assert normalize_checklist_items(["  ", {"text": ""}, None, 7]) == []

    def test_absent_visibility_defaults_to_shown(self):
        # Hiding a step is the deliberate choice; anything else is visible.
        items = normalize_checklist_items([{"id": "s1", "text": "Gear issued"}])
        assert items[0]["member_visible"] is True

    def test_duplicate_ids_are_reissued(self):
        items = normalize_checklist_items(
            [{"id": "same", "text": "One"}, {"id": "same", "text": "Two"}]
        )
        assert len({i["id"] for i in items}) == 2

    def test_none_survives_to_storage(self):
        # "not supplied" must not be flattened into "no steps" — the former
        # leaves the column alone.
        assert to_storage(None) is None
        assert to_storage([]) == []


class TestVisibilityAndProgress:
    ITEMS = [
        {"id": "s1", "text": "Gear issued", "member_visible": True},
        {"id": "s2", "text": "References called", "member_visible": False},
    ]

    def test_member_sees_only_the_visible_steps(self):
        assert [i["id"] for i in member_visible_items(self.ITEMS)] == ["s1"]

    def test_officer_only_steps_still_count_toward_progress(self):
        # Otherwise a requirement reads 100% while the background check is out.
        assert checklist_progress(self.ITEMS, ["s1"]) == (1, 2)
        assert checklist_progress(self.ITEMS, ["s1", "s2"]) == (2, 2)

    def test_ticks_for_deleted_steps_are_ignored(self):
        assert checklist_progress(self.ITEMS, ["s1", "gone"]) == (1, 2)
        assert prune_done_ids(self.ITEMS, ["gone", "s2", "s2"]) == ["s2"]

    @staticmethod
    def _requirement_response_data():
        now = datetime.now(timezone.utc)
        return {
            "id": uuid4(),
            "organization_id": uuid4(),
            "name": "Station orientation",
            "requirement_type": "checklist",
            "source": "department",
            "frequency": "one_time",
            "active": True,
            "created_at": now,
            "updated_at": now,
            "checklist_items": TestVisibilityAndProgress.ITEMS,
        }

    def test_member_requirement_response_omits_officer_only_steps(self):
        response = _member_requirement(self._requirement_response_data())

        assert [item.id for item in response.checklist_items] == ["s1"]

    def test_member_progress_omits_hidden_step_and_its_signoff_state(self):
        now = datetime.now(timezone.utc)
        response = _member_progress(
            {
                "id": uuid4(),
                "enrollment_id": uuid4(),
                "requirement_id": uuid4(),
                "status": "in_progress",
                "progress_value": 2,
                "progress_percentage": 100,
                "progress_notes": {"checklist_done": ["s1", "s2"]},
                "requirement": self._requirement_response_data(),
                "created_at": now,
                "updated_at": now,
            }
        )

        assert [item.id for item in response.requirement.checklist_items] == ["s1"]
        assert response.progress_notes["checklist_done"] == ["s1"]


def _progress(items, owner="u1", notes=None):
    return SimpleNamespace(
        id=str(uuid4()),
        enrollment_id="enr-1",
        requirement_id="req-1",
        enrollment=SimpleNamespace(user_id=owner, program_id="prog-1"),
        requirement=SimpleNamespace(
            requirement_type=RequirementType.CHECKLIST,
            checklist_items=items,
            passing_score=None,
            max_attempts=None,
        ),
        status=RequirementProgressStatus.NOT_STARTED,
        progress_value=0.0,
        progress_percentage=0.0,
        progress_notes=notes,
        started_at=None,
        completed_at=None,
        verified_at=None,
        verified_by=None,
        updated_at=None,
    )


def _svc(progress):
    db = MagicMock()
    db.execute = AsyncMock(
        return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=progress))
    )
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    svc = TrainingProgramService(db)
    svc._recalculate_enrollment_progress = AsyncMock()
    svc._maybe_auto_advance_phase = AsyncMock()
    return svc


class TestCheckingOffSteps:
    ITEMS = [
        {"id": "s1", "text": "Gear issued", "member_visible": True},
        {"id": "s2", "text": "References called", "member_visible": False},
    ]

    async def test_partial_tick_moves_progress_without_completing(self):
        progress = _progress(self.ITEMS)
        svc = _svc(progress)

        out, error = await svc.update_requirement_progress(
            progress_id=uuid4(),
            organization_id=uuid4(),
            updates=RequirementProgressUpdate(checklist_done=["s1"]),
        )

        assert error is None
        assert out.progress_percentage == 50.0
        assert out.status == RequirementProgressStatus.IN_PROGRESS
        assert out.completed_at is None
        assert out.progress_notes["checklist_done"] == ["s1"]

    async def test_every_step_completes_the_requirement(self):
        progress = _progress(self.ITEMS)
        svc = _svc(progress)

        out, error = await svc.update_requirement_progress(
            progress_id=uuid4(),
            organization_id=uuid4(),
            updates=RequirementProgressUpdate(checklist_done=["s1", "s2"]),
        )

        assert error is None
        assert out.progress_percentage == 100.0
        assert out.status == RequirementProgressStatus.COMPLETED
        assert out.completed_at is not None

    async def test_unticking_reopens_the_requirement(self):
        progress = _progress(self.ITEMS, notes={"checklist_done": ["s1", "s2"]})
        progress.status = RequirementProgressStatus.COMPLETED
        svc = _svc(progress)

        out, error = await svc.update_requirement_progress(
            progress_id=uuid4(),
            organization_id=uuid4(),
            updates=RequirementProgressUpdate(checklist_done=["s1"]),
        )

        assert error is None
        assert out.status == RequirementProgressStatus.IN_PROGRESS
        assert out.completed_at is None

    async def test_a_member_may_not_check_their_own_steps_off(self):
        progress = _progress(self.ITEMS, owner="me")
        svc = _svc(progress)

        out, error = await svc.update_requirement_progress(
            progress_id=uuid4(),
            organization_id=uuid4(),
            updates=RequirementProgressUpdate(checklist_done=["s1"]),
            acting_user_id="me",
            can_manage=False,
        )

        assert out is None
        assert "training officer" in error

    async def test_a_member_may_not_write_checklist_state_through_notes(self):
        progress = _progress(self.ITEMS, owner="me", notes={"checklist_done": []})
        svc = _svc(progress)

        out, error = await svc.update_requirement_progress(
            progress_id=uuid4(),
            organization_id=uuid4(),
            updates=RequirementProgressUpdate(
                progress_notes={"checklist_done": ["s1", "s2"]}
            ),
            acting_user_id="me",
            can_manage=False,
        )

        assert out is None
        assert "training officer" in error
        assert progress.progress_notes == {"checklist_done": []}

    async def test_ticks_are_rejected_on_a_non_checklist_requirement(self):
        progress = _progress(self.ITEMS)
        progress.requirement.requirement_type = RequirementType.HOURS
        svc = _svc(progress)

        out, error = await svc.update_requirement_progress(
            progress_id=uuid4(),
            organization_id=uuid4(),
            updates=RequirementProgressUpdate(checklist_done=["s1"]),
        )

        assert out is None
        assert "not a checklist" in error

    async def test_ticks_for_steps_that_no_longer_exist_are_dropped(self):
        progress = _progress(self.ITEMS)
        svc = _svc(progress)

        out, error = await svc.update_requirement_progress(
            progress_id=uuid4(),
            organization_id=uuid4(),
            updates=RequirementProgressUpdate(checklist_done=["s1", "deleted-step"]),
        )

        assert error is None
        assert out.progress_notes["checklist_done"] == ["s1"]
        assert out.progress_percentage == 50.0
