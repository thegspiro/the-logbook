"""Review fixes for checklist member self-reporting (PR #1419).

Four issues raised in review, all around the checklist self-report flow:

* a metadata-only resave of ``checklist_items`` (normalization injects
  ``member_can_complete`` into every item, so legacy rows never compare equal)
  must not register as a target change and reopen satisfied progress
* ``_recompute_checklist_progress`` must never downgrade a row an officer
  marked completed/verified/waived
* a member self-report against an already-satisfied requirement is rejected
* only NEWLY-ADDED claim ids are validated, so a claim stored before an
  officer disabled self-reporting on the step doesn't poison every later save
* the progress fetch locks FOR UPDATE so member claims and officer sign-offs
  serialize instead of overwriting each other's progress_notes JSON

DB mocked; no MySQL.
"""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from app.api.v1.endpoints.training_programs import _member_progress
from app.models.training import RequirementProgressStatus, RequirementType
from app.schemas.training_program import RequirementProgressUpdate
from app.services.training_program_service import TrainingProgramService

ITEMS = [
    {
        "id": "s1",
        "text": "Gear issued",
        "member_visible": True,
        "member_can_complete": True,
    },
    {"id": "s2", "text": "References called", "member_visible": False},
]


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


# ==================== Fix 1a: metadata-only resave is not a target change ====


def _requirement(**overrides):
    base = dict(
        id=str(uuid4()),
        organization_id=str(uuid4()),
        is_editable=True,
        requirement_type=RequirementType.CHECKLIST,
        # Legacy storage: no member_can_complete key on any item, one bare
        # string — exactly what normalization rewrites on every resave.
        checklist_items=[
            {"id": "s1", "text": "Gear issued", "member_visible": True},
            "Station tour",
        ],
        required_hours=None,
        required_shifts=None,
        required_calls=None,
        required_courses=None,
        name="Orientation",
        updated_at=None,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def _update_svc(requirement):
    db = MagicMock()
    db.execute = AsyncMock(return_value=_one(requirement))
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    svc = TrainingProgramService(db)
    svc._recompute_progress_for_requirement = AsyncMock()
    return svc


class TestTargetChangeDetection:
    async def test_metadata_only_resave_does_not_recompute(self):
        requirement = _requirement()
        svc = _update_svc(requirement)

        # Same steps, same ids — the officer only enabled self-reporting.
        _, error = await svc.update_training_requirement(
            uuid4(),
            uuid4(),
            {
                "checklist_items": [
                    {
                        "id": "s1",
                        "text": "Gear issued",
                        "member_visible": True,
                        "member_can_complete": True,
                    },
                    {"id": "item-1", "text": "Station tour", "member_visible": True},
                ]
            },
        )

        assert error is None
        svc._recompute_progress_for_requirement.assert_not_awaited()

    async def test_rewording_a_step_keeps_its_identity(self):
        requirement = _requirement()
        svc = _update_svc(requirement)

        _, error = await svc.update_training_requirement(
            uuid4(),
            uuid4(),
            {
                "checklist_items": [
                    {"id": "s1", "text": "Gear issued and logged"},
                    {"id": "item-1", "text": "Station tour"},
                ]
            },
        )

        assert error is None
        svc._recompute_progress_for_requirement.assert_not_awaited()

    async def test_adding_a_step_still_recomputes(self):
        requirement = _requirement()
        svc = _update_svc(requirement)

        _, error = await svc.update_training_requirement(
            uuid4(),
            uuid4(),
            {
                "checklist_items": [
                    {"id": "s1", "text": "Gear issued"},
                    {"id": "item-1", "text": "Station tour"},
                    {"id": "s9", "text": "Ride-along"},
                ]
            },
        )

        assert error is None
        svc._recompute_progress_for_requirement.assert_awaited_once()

    async def test_removing_a_step_still_recomputes(self):
        requirement = _requirement()
        svc = _update_svc(requirement)

        _, error = await svc.update_training_requirement(
            uuid4(),
            uuid4(),
            {"checklist_items": [{"id": "s1", "text": "Gear issued"}]},
        )

        assert error is None
        svc._recompute_progress_for_requirement.assert_awaited_once()

    async def test_numeric_target_change_still_recomputes(self):
        requirement = _requirement(
            requirement_type=RequirementType.HOURS,
            checklist_items=None,
            required_hours=10,
        )
        svc = _update_svc(requirement)

        _, error = await svc.update_training_requirement(
            uuid4(), uuid4(), {"required_hours": 12}
        )

        assert error is None
        svc._recompute_progress_for_requirement.assert_awaited_once()

    async def test_unchanged_numeric_target_does_not_recompute(self):
        requirement = _requirement(
            requirement_type=RequirementType.HOURS,
            checklist_items=None,
            required_hours=10,
        )
        svc = _update_svc(requirement)

        _, error = await svc.update_training_requirement(
            uuid4(), uuid4(), {"required_hours": 10, "name": "Renamed"}
        )

        assert error is None
        svc._recompute_progress_for_requirement.assert_not_awaited()


# ==================== Fix 1b: recompute never downgrades satisfied rows =====


def _progress_row(status, done, enrollment_id=None, percentage=100.0):
    return SimpleNamespace(
        enrollment_id=enrollment_id or str(uuid4()),
        status=status,
        progress_notes={"checklist_done": list(done)},
        progress_value=float(len(done)),
        progress_percentage=percentage,
        completed_at=datetime.now(timezone.utc),
    )


class TestRecomputePreservesSatisfiedRows:
    async def test_satisfied_rows_with_partial_ticks_stay_satisfied(self):
        requirement = SimpleNamespace(
            id=str(uuid4()),
            checklist_items=[
                {"id": "s1", "text": "One"},
                {"id": "s2", "text": "Two"},
                {"id": "s3", "text": "Three (new)"},
            ],
        )
        satisfied = [
            _progress_row(RequirementProgressStatus.COMPLETED, ["s1"]),
            _progress_row(RequirementProgressStatus.VERIFIED, ["s1", "s2"]),
            _progress_row(RequirementProgressStatus.WAIVED, []),
        ]
        open_row = _progress_row(
            RequirementProgressStatus.IN_PROGRESS, ["s1", "s2"], percentage=100.0
        )
        rows = MagicMock()
        rows.scalars.return_value.all.return_value = satisfied + [open_row]
        db = MagicMock()
        db.execute = AsyncMock(return_value=rows)
        db.commit = AsyncMock()
        svc = TrainingProgramService(db)
        svc._recalculate_enrollment_progress = AsyncMock()
        svc._maybe_auto_advance_phase = AsyncMock()

        await svc._recompute_checklist_progress(requirement)

        for row in satisfied:
            assert row.status in (
                RequirementProgressStatus.COMPLETED,
                RequirementProgressStatus.VERIFIED,
                RequirementProgressStatus.WAIVED,
            )
            assert row.progress_percentage == 100.0
            assert row.completed_at is not None

        # The open row is re-measured against the new three-step total.
        assert open_row.status == RequirementProgressStatus.IN_PROGRESS
        assert open_row.progress_percentage == (2 / 3 * 100)
        # Only the open row's enrollment is rolled up.
        assert svc._recalculate_enrollment_progress.await_count == 1


# ==================== Fixes 2 + 3: member claim validation ==================


def _member_progress_row(items, notes=None, status=None):
    return SimpleNamespace(
        id=str(uuid4()),
        enrollment_id="enr-1",
        requirement_id="req-1",
        enrollment=SimpleNamespace(user_id="me", program_id="prog-1"),
        requirement=SimpleNamespace(
            requirement_type=RequirementType.CHECKLIST,
            checklist_items=items,
            passing_score=None,
            max_attempts=None,
        ),
        status=status or RequirementProgressStatus.NOT_STARTED,
        progress_value=0.0,
        progress_percentage=0.0,
        progress_notes=notes,
        started_at=None,
        completed_at=None,
        verified_at=None,
        verified_by=None,
        updated_at=None,
    )


def _claim_svc(progress):
    db = MagicMock()
    db.execute = AsyncMock(return_value=_one(progress))
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    svc = TrainingProgramService(db)
    svc._recalculate_enrollment_progress = AsyncMock()
    svc._maybe_auto_advance_phase = AsyncMock()
    return svc


async def _member_claim(svc, claimed):
    return await svc.update_requirement_progress(
        progress_id=uuid4(),
        organization_id=uuid4(),
        updates=RequirementProgressUpdate(checklist_claimed=claimed),
        acting_user_id="me",
        can_manage=False,
    )


class TestClaimsOnSatisfiedRequirements:
    async def test_new_claim_on_completed_requirement_is_rejected(self):
        progress = _member_progress_row(
            ITEMS, status=RequirementProgressStatus.COMPLETED
        )
        svc = _claim_svc(progress)

        out, error = await _member_claim(svc, ["s1"])

        assert out is None
        assert "already satisfied" in error

    async def test_new_claim_on_waived_requirement_is_rejected(self):
        progress = _member_progress_row(ITEMS, status=RequirementProgressStatus.WAIVED)
        svc = _claim_svc(progress)

        out, error = await _member_claim(svc, ["s1"])

        assert out is None
        assert "already satisfied" in error

    async def test_retracting_claims_on_satisfied_requirement_is_allowed(self):
        # Clearing claims adds nothing, so it cannot forge progress — and
        # rejecting it would strand the stale claim forever.
        progress = _member_progress_row(
            ITEMS,
            notes={"checklist_claimed": ["s1"]},
            status=RequirementProgressStatus.COMPLETED,
        )
        svc = _claim_svc(progress)

        out, error = await _member_claim(svc, [])

        assert error is None
        assert out.progress_notes["checklist_claimed"] == []

    async def test_new_claim_on_open_requirement_still_works(self):
        progress = _member_progress_row(
            ITEMS, status=RequirementProgressStatus.IN_PROGRESS
        )
        svc = _claim_svc(progress)

        out, error = await _member_claim(svc, ["s1"])

        assert error is None
        assert out.progress_notes["checklist_claimed"] == ["s1"]


class TestStaleClaimsAfterSelfReportDisabled:
    # s1 was claimable when the member claimed it; the officer has since
    # turned member_can_complete off. s3 is still claimable.
    ITEMS_DISABLED = [
        {
            "id": "s1",
            "text": "Gear issued",
            "member_visible": True,
            "member_can_complete": False,
        },
        {"id": "s2", "text": "References called", "member_visible": False},
        {
            "id": "s3",
            "text": "Station tour",
            "member_visible": True,
            "member_can_complete": True,
        },
    ]

    async def test_stored_stale_claim_does_not_block_a_new_valid_claim(self):
        progress = _member_progress_row(
            self.ITEMS_DISABLED, notes={"checklist_claimed": ["s1"]}
        )
        svc = _claim_svc(progress)

        out, error = await _member_claim(svc, ["s1", "s3"])

        assert error is None
        assert out.progress_notes["checklist_claimed"] == ["s1", "s3"]

    async def test_newly_added_ineligible_claim_is_still_rejected(self):
        progress = _member_progress_row(
            self.ITEMS_DISABLED, notes={"checklist_claimed": ["s3"]}
        )
        svc = _claim_svc(progress)

        out, error = await _member_claim(svc, ["s3", "s1"])

        assert out is None
        assert "cannot be completed by a member" in error

    async def test_officer_only_step_claim_is_still_rejected(self):
        progress = _member_progress_row(self.ITEMS_DISABLED)
        svc = _claim_svc(progress)

        out, error = await _member_claim(svc, ["s2"])

        assert out is None
        assert "cannot be completed by a member" in error


class TestMemberProgressEndpointFilter:
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
            "checklist_items": TestStaleClaimsAfterSelfReportDisabled.ITEMS_DISABLED,
        }

    def test_claims_filtered_to_member_completable_steps(self):
        now = datetime.now(timezone.utc)
        response = _member_progress(
            {
                "id": uuid4(),
                "enrollment_id": uuid4(),
                "requirement_id": uuid4(),
                "status": "in_progress",
                "progress_value": 1,
                "progress_percentage": 33,
                # s1's self-reporting was disabled after the claim was stored;
                # echoing it back would make the member's UI resubmit it.
                "progress_notes": {
                    "checklist_done": ["s1"],
                    "checklist_claimed": ["s1", "s3"],
                },
                "requirement": self._requirement_response_data(),
                "created_at": now,
                "updated_at": now,
            }
        )

        assert response.progress_notes["checklist_claimed"] == ["s3"]
        # Done ticks are still shown for every visible step, claimable or not.
        assert response.progress_notes["checklist_done"] == ["s1"]


# ==================== Fix 4: progress fetch locks FOR UPDATE ================


class TestProgressFetchLocksRow:
    async def test_update_requirement_progress_selects_for_update(self):
        statements = []

        async def execute(statement, *args, **kwargs):
            statements.append(statement)
            return _one(None)

        db = MagicMock()
        db.execute = AsyncMock(side_effect=execute)
        svc = TrainingProgramService(db)

        out, error = await svc.update_requirement_progress(
            progress_id=uuid4(),
            organization_id=uuid4(),
            updates=RequirementProgressUpdate(progress_notes={"member_note": "x"}),
        )

        assert out is None
        assert error == "Requirement progress not found"
        # Concurrent member claims and officer sign-offs read-modify-write the
        # same progress_notes JSON; the fetch must serialize them.
        assert statements[0]._for_update_arg is not None
