"""
The create-pipeline wizard's call-type restriction must survive the build.

The wizard sends ``required_call_types`` on a "calls" requirement through
POST /training/programs/programs/build. The build input schema had no such
field, so Pydantic dropped it and the requirement was saved unrestricted —
every call counted, whatever type the officer had picked. The edit-modal path
(/training/programs/requirements) always stored it, so the same requirement
behaved differently depending on which screen created it.
"""

import pytest
from pydantic import ValidationError
from sqlalchemy import select

from app.models.training import ProgramRequirement, TrainingRequirement
from app.schemas.training_program import (
    ProgramBuildPhaseInput,
    ProgramBuildRequest,
    ProgramBuildRequirementInput,
    TrainingProgramCreate,
    TrainingRequirementEnhancedCreate,
)
from app.services.training_program_service import TrainingProgramService


def _calls_requirement(**extra):
    return ProgramBuildRequirementInput(
        name="Structure fire responses",
        requirement_type="calls",
        required_calls=5,
        **extra,
    )


async def _build_one(db_session, org_id, admin_id, requirement):
    payload = ProgramBuildRequest(
        program=TrainingProgramCreate(name="Probie", structure_type="phases"),
        phases=[
            ProgramBuildPhaseInput(
                phase_number=1, name="Phase 1", requirements=[requirement]
            )
        ],
    )
    program, error = await TrainingProgramService(db_session).build_program(
        payload, org_id, admin_id
    )
    assert error is None
    result = await db_session.execute(
        select(TrainingRequirement)
        .join(
            ProgramRequirement,
            ProgramRequirement.requirement_id == TrainingRequirement.id,
        )
        .where(ProgramRequirement.program_id == program.id)
        .where(TrainingRequirement.organization_id == org_id)
    )
    return result.scalar_one()


@pytest.mark.integration
class TestBuildStoresCallTypes:
    async def test_call_types_are_stored_on_the_built_requirement(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        req = await _build_one(
            db_session,
            org_id,
            admin_id,
            _calls_requirement(required_call_types=["structure_fire", "ems"]),
        )
        assert req.required_call_types == ["structure_fire", "ems"]

    async def test_no_call_types_leaves_the_requirement_unrestricted(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        req = await _build_one(db_session, org_id, admin_id, _calls_requirement())
        assert req.required_call_types is None

    async def test_build_stores_values_exactly_as_the_edit_path_does(
        self, db_session, setup_org_and_admin
    ):
        """Neither path validates the strings against the org's call types —
        the reader matches by type, not spelling — so build must not invent a
        stricter rule. Whatever create stores, build stores."""
        org_id, admin_id = setup_org_and_admin
        values = ["Structure Fire", "not-a-configured-type", ""]
        service = TrainingProgramService(db_session)
        created, error = await service.create_training_requirement(
            TrainingRequirementEnhancedCreate(
                name="Edit-path twin",
                requirement_type="calls",
                frequency="one_time",
                required_calls=5,
                required_call_types=values,
            ),
            org_id,
            admin_id,
        )
        assert error is None
        built = await _build_one(
            db_session,
            org_id,
            admin_id,
            _calls_requirement(required_call_types=values),
        )
        assert built.required_call_types == created.required_call_types == values


@pytest.mark.unit
class TestBuildInputCallTypeShape:
    @pytest.mark.parametrize("bad", ["structure_fire", [1, 2], {"a": "b"}])
    def test_rejects_the_same_shapes_the_create_schema_rejects(self, bad):
        with pytest.raises(ValidationError):
            TrainingRequirementEnhancedCreate(
                name="x",
                requirement_type="calls",
                frequency="one_time",
                required_call_types=bad,
            )
        with pytest.raises(ValidationError):
            _calls_requirement(required_call_types=bad)
