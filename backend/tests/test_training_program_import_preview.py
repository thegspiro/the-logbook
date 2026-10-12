"""
Training program import dry run (KNOWN_LIMITATIONS "Program Import Has No
Preview"): choosing a file used to import it on the spot. The service now has
a summary mode that stages the import in a SAVEPOINT, reports what it would
create, and rolls it back, so the UI can ask the officer to confirm first.

These run against the database because the point is what is (not) left behind.
"""

import uuid

import pytest
from sqlalchemy import func, select

from app.models.training import (
    ProgramPhase,
    TrainingProgram,
    TrainingRequirement,
)
from app.services.training_program_service import TrainingProgramService

pytestmark = pytest.mark.integration


def _payload(existing_requirement_name: str) -> dict:
    return {
        "program": {"name": "Recruit School", "structure_type": "phases"},
        "phases": [
            {
                "phase_number": 1,
                "name": "Foundations",
                "requirements": [
                    {"requirement": {"name": "New Skill Sheet"}},
                    {"requirement": {"name": existing_requirement_name}},
                ],
                "milestones": [{"name": "Halfway"}],
            },
            {
                "phase_number": 2,
                "name": "Live Fire",
                # The same new requirement referenced a second time is created
                # once, and must not be reported as a pre-existing reuse.
                "requirements": [{"requirement": {"name": "New Skill Sheet"}}],
            },
        ],
        "program_milestones": [{"name": "Graduation"}],
    }


async def _seed_requirement(db_session, org_id: str, admin_id: str) -> str:
    name = f"Existing CPR {uuid.uuid4().hex[:6]}"
    db_session.add(
        TrainingRequirement(
            organization_id=org_id,
            name=name,
            requirement_type="hours",
            source="department",
            frequency="annual",
            created_by=admin_id,
        )
    )
    await db_session.flush()
    return name


async def _count(db_session, model, *where) -> int:
    return (
        await db_session.execute(select(func.count()).select_from(model).where(*where))
    ).scalar_one()


class TestProgramImportDryRun:
    async def test_dry_run_reports_without_creating(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        existing = await _seed_requirement(db_session, org_id, admin_id)
        svc = TrainingProgramService(db_session)

        result = await svc.import_program_from_json(
            _payload(existing), org_id, admin_id, dry_run=True
        )

        assert result.program is None
        summary = result.summary
        assert summary["program_name"] == "Recruit School"
        assert summary["structure_type"] == "phases"
        assert summary["phase_count"] == 2
        assert [p["requirement_count"] for p in summary["phases"]] == [2, 1]
        assert summary["milestone_count"] == 2
        assert summary["requirements_created"] == ["New Skill Sheet"]
        assert summary["requirements_reused"] == [existing]

        assert (
            await _count(
                db_session,
                TrainingProgram,
                TrainingProgram.organization_id == org_id,
            )
            == 0
        )
        assert (
            await _count(
                db_session,
                TrainingRequirement,
                TrainingRequirement.organization_id == org_id,
            )
            == 1
        )

    async def test_real_import_matches_its_preview(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        existing = await _seed_requirement(db_session, org_id, admin_id)
        svc = TrainingProgramService(db_session)

        preview = await svc.import_program_from_json(
            _payload(existing), org_id, admin_id, dry_run=True
        )
        result = await svc.import_program_from_json(
            _payload(existing), org_id, admin_id
        )

        assert result.program is not None
        assert result.summary == preview.summary
        assert (
            await _count(
                db_session,
                ProgramPhase,
                ProgramPhase.program_id == result.program.id,
            )
            == 2
        )
        assert (
            await _count(
                db_session,
                TrainingRequirement,
                TrainingRequirement.organization_id == org_id,
            )
            == 2
        )

    async def test_dry_run_rejects_what_the_import_rejects(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        svc = TrainingProgramService(db_session)
        payload = {
            "program": {"name": "Bad", "structure_type": "flexible"},
            "program_requirements": [
                {
                    "requirement": {
                        "name": "Foreign Category",
                        "category_ids": [str(uuid.uuid4())],
                    }
                }
            ],
        }

        with pytest.raises(ValueError, match="category"):
            await svc.import_program_from_json(payload, org_id, admin_id, dry_run=True)
        assert (
            await _count(
                db_session,
                TrainingProgram,
                TrainingProgram.organization_id == org_id,
            )
            == 0
        )
