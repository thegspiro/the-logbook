"""Deleting a training requirement: what it reports, and the permanent path.

``test_delete_in_use_deactivates.py`` covers the ordinary delete's rule (in
use -> deactivated, unused -> deleted). This covers the deletion-impact
listing, the permanent delete a department uses to clear out requirements it
created while setting up, and the schema check that keeps the reference list
complete.
"""

import uuid
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.api.v1.endpoints import training as training_endpoints
from app.core.database import Base
from app.models.compliance_config import ComplianceConfig, ComplianceProfile
from app.models.skills_testing import SkillTemplate
from app.models.training import (
    EnrollmentStatus,
    ProgramEnrollment,
    ProgramRequirement,
    RequirementFrequency,
    RequirementProgress,
    RequirementProgressStatus,
    RequirementType,
    TrainingRequirement,
    TrainingRequirementOverride,
    TrainingWaiver,
)
from app.schemas.training_program import TrainingProgramCreate
from app.services import training_requirement_removal as removal
from app.services.training_program_service import TrainingProgramService


@pytest.mark.unit
class TestReferenceListCoversTheSchema:
    def test_every_foreign_key_to_training_requirements_is_listed(self):
        """A column left off the list is counted by nothing, so an ordinary
        delete hard-deletes a requirement only it references and the database
        cascades or nulls that row without anyone being told."""
        in_schema = {
            (fk.parent.table.name, fk.parent.name)
            for table in Base.metadata.tables.values()
            for fk in table.foreign_keys
            if fk.column.table.name == "training_requirements"
        }
        listed = {
            (ref.column.class_.__tablename__, ref.column.key)
            for ref in removal._FOREIGN_KEY_REFERENCES
        }
        assert listed == in_schema

    def test_on_delete_matches_the_foreign_key_action(self):
        """``REMOVED`` rows are the ones the database would cascade; the
        dialog tells the officer which rows go, so the two must agree."""
        for ref in removal._FOREIGN_KEY_REFERENCES:
            (fk,) = [
                fk
                for fk in ref.column.property.columns[0].foreign_keys
                if fk.column.table.name == "training_requirements"
            ]
            expected = removal.REMOVED if fk.ondelete == "CASCADE" else removal.UNLINKED
            assert ref.on_delete == expected, ref.kind


def _officer(org_id: str, user_id: str):
    return SimpleNamespace(
        id=user_id, username="training-officer", organization_id=org_id
    )


async def _requirement(db_session, org_id: str, name: str) -> TrainingRequirement:
    requirement = TrainingRequirement(
        organization_id=org_id,
        name=name,
        requirement_type=RequirementType.HOURS,
        required_hours=4.0,
        frequency=RequirementFrequency.ONE_TIME,
        applies_to_all=True,
        active=True,
    )
    db_session.add(requirement)
    await db_session.flush()
    return requirement


async def _reload(db_session, model, row_id):
    result = await db_session.execute(
        select(model)
        .where(model.id == str(row_id))
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


async def _enrollment_with_progress(db_session, org_id, admin_id, requirement):
    program, error = await TrainingProgramService(db_session).create_training_program(
        TrainingProgramCreate(name="Recruit School"), org_id, admin_id
    )
    assert error is None, error
    link = ProgramRequirement(program_id=program.id, requirement_id=requirement.id)
    db_session.add(link)
    enrollment = ProgramEnrollment(
        organization_id=org_id,
        user_id=admin_id,
        program_id=program.id,
        status=EnrollmentStatus.ACTIVE,
    )
    db_session.add(enrollment)
    await db_session.flush()
    progress = RequirementProgress(
        enrollment_id=enrollment.id,
        requirement_id=requirement.id,
        status=RequirementProgressStatus.IN_PROGRESS,
        progress_value=1.0,
    )
    db_session.add(progress)
    await db_session.flush()
    return link, enrollment, progress


async def _profile(db_session, org_id, required, optional=None):
    config = ComplianceConfig(organization_id=org_id)
    db_session.add(config)
    await db_session.flush()
    profile = ComplianceProfile(
        config_id=config.id,
        name="Drivers",
        required_requirement_ids=required,
        optional_requirement_ids=optional,
    )
    db_session.add(profile)
    await db_session.flush()
    return profile


async def _waiver(db_session, org_id, user_id, requirement_ids):
    waiver = TrainingWaiver(
        organization_id=org_id,
        user_id=user_id,
        start_date=date(2026, 1, 1),
        requirement_ids=requirement_ids,
        active=True,
    )
    db_session.add(waiver)
    await db_session.flush()
    return waiver


@pytest.mark.integration
class TestDeletionImpact:
    async def test_lists_each_kind_of_reference_with_its_count(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        requirement = await _requirement(db_session, org_id, "HIPAA")
        await _enrollment_with_progress(db_session, org_id, admin_id, requirement)
        await _profile(db_session, org_id, [requirement.id])

        impact = await training_endpoints.get_requirement_deletion_impact(
            uuid.UUID(requirement.id), db_session, _officer(org_id, admin_id)
        )

        by_kind = {ref.kind: (ref.count, ref.on_delete) for ref in impact.references}
        assert by_kind == {
            "program_requirements": (1, "removed"),
            "requirement_progress": (1, "removed"),
            "compliance_profiles": (1, "unlinked"),
        }
        assert impact.total == 3
        assert impact.name == "HIPAA"
        assert impact.active is True

    async def test_unused_requirement_has_no_references(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        requirement = await _requirement(db_session, org_id, "Typo")

        impact = await training_endpoints.get_requirement_deletion_impact(
            uuid.UUID(requirement.id), db_session, _officer(org_id, admin_id)
        )

        assert impact.total == 0
        assert impact.references == []

    async def test_another_organizations_requirement_is_not_found(
        self, db_session, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        requirement = await _requirement(db_session, org_id, "HIPAA")

        with pytest.raises(HTTPException) as exc:
            await training_endpoints.get_requirement_deletion_impact(
                uuid.UUID(requirement.id),
                db_session,
                _officer(str(uuid.uuid4()), admin_id),
            )
        assert exc.value.status_code == 404


@pytest.mark.integration
class TestOrdinaryDeleteCountsEveryReference:
    async def test_requirement_named_only_by_a_chief_override_is_deactivated(
        self, db_session, setup_org_and_admin, monkeypatch
    ):
        """The override table was missing from the count, so this requirement
        was hard-deleted and the cascade took the override — a record the
        model says is revoked, never deleted, so who granted it survives."""
        org_id, admin_id = setup_org_and_admin
        monkeypatch.setattr(training_endpoints, "log_audit_event", AsyncMock())
        requirement = await _requirement(db_session, org_id, "Drill attendance")
        override = TrainingRequirementOverride(
            organization_id=org_id,
            requirement_id=requirement.id,
            user_id=admin_id,
            start_date=date(2026, 1, 1),
            end_date=date(2026, 12, 31),
            reason="Deployed",
            granted_by=admin_id,
            granted_at=datetime.now(timezone.utc),
        )
        db_session.add(override)
        await db_session.flush()

        await training_endpoints.delete_requirement(
            uuid.UUID(requirement.id), db_session, _officer(org_id, admin_id)
        )

        kept = await _reload(db_session, TrainingRequirement, requirement.id)
        assert kept is not None
        assert kept.active is False
        assert await _reload(db_session, TrainingRequirementOverride, override.id)


@pytest.mark.integration
class TestPermanentDelete:
    async def test_removes_the_requirement_and_what_exists_only_for_it(
        self, db_session, setup_org_and_admin, monkeypatch
    ):
        org_id, admin_id = setup_org_and_admin
        audit = AsyncMock()
        monkeypatch.setattr(training_endpoints, "log_audit_event", audit)
        requirement = await _requirement(db_session, org_id, "Trial requirement")
        link, enrollment, progress = await _enrollment_with_progress(
            db_session, org_id, admin_id, requirement
        )

        await training_endpoints.delete_requirement(
            uuid.UUID(requirement.id),
            db_session,
            _officer(org_id, admin_id),
            permanent=True,
        )

        assert await _reload(db_session, TrainingRequirement, requirement.id) is None
        assert await _reload(db_session, ProgramRequirement, link.id) is None
        assert await _reload(db_session, RequirementProgress, progress.id) is None
        # The member's enrollment is theirs, not the requirement's.
        assert await _reload(db_session, ProgramEnrollment, enrollment.id)
        kwargs = audit.await_args.kwargs
        assert kwargs["event_type"] == "training_requirement_permanently_deleted"
        assert kwargs["event_data"]["references"] == {
            "program_requirements": 1,
            "requirement_progress": 1,
        }

    async def test_unlinks_records_that_only_point_at_it(
        self, db_session, setup_org_and_admin, monkeypatch
    ):
        org_id, admin_id = setup_org_and_admin
        monkeypatch.setattr(training_endpoints, "log_audit_event", AsyncMock())
        requirement = await _requirement(db_session, org_id, "Trial requirement")
        other = await _requirement(db_session, org_id, "EVOC")
        template = SkillTemplate(
            organization_id=org_id,
            name="Ladder raise",
            sections=[],
            requirement_id=requirement.id,
        )
        db_session.add(template)
        await db_session.flush()
        profile = await _profile(
            db_session, org_id, [requirement.id, other.id], [requirement.id]
        )
        shared_waiver = await _waiver(
            db_session, org_id, admin_id, [requirement.id, other.id]
        )

        await training_endpoints.delete_requirement(
            uuid.UUID(requirement.id),
            db_session,
            _officer(org_id, admin_id),
            permanent=True,
        )

        kept_template = await _reload(db_session, SkillTemplate, template.id)
        assert kept_template is not None
        assert kept_template.requirement_id is None
        kept_profile = await _reload(db_session, ComplianceProfile, profile.id)
        assert kept_profile.required_requirement_ids == [other.id]
        assert kept_profile.optional_requirement_ids == []
        kept_waiver = await _reload(db_session, TrainingWaiver, shared_waiver.id)
        assert kept_waiver.requirement_ids == [other.id]
        assert kept_waiver.active is True

    async def test_a_waiver_for_only_this_requirement_is_deactivated_not_widened(
        self, db_session, setup_org_and_admin, monkeypatch
    ):
        """An empty ``requirement_ids`` means "every requirement" to the
        waiver checks; stripping the last id would excuse the member from
        all of them."""
        org_id, admin_id = setup_org_and_admin
        monkeypatch.setattr(training_endpoints, "log_audit_event", AsyncMock())
        requirement = await _requirement(db_session, org_id, "Trial requirement")
        waiver = await _waiver(db_session, org_id, admin_id, [requirement.id])

        await training_endpoints.delete_requirement(
            uuid.UUID(requirement.id),
            db_session,
            _officer(org_id, admin_id),
            permanent=True,
        )

        kept = await _reload(db_session, TrainingWaiver, waiver.id)
        assert kept is not None
        assert kept.active is False
        assert kept.requirement_ids == [requirement.id]

    async def test_recalculates_live_enrollments_that_linked_it(
        self, db_session, setup_org_and_admin, monkeypatch
    ):
        org_id, admin_id = setup_org_and_admin
        monkeypatch.setattr(training_endpoints, "log_audit_event", AsyncMock())
        recalculated = AsyncMock()
        monkeypatch.setattr(
            TrainingProgramService, "recalculate_enrollments", recalculated
        )
        requirement = await _requirement(db_session, org_id, "Trial requirement")
        _, enrollment, _ = await _enrollment_with_progress(
            db_session, org_id, admin_id, requirement
        )

        await training_endpoints.delete_requirement(
            uuid.UUID(requirement.id),
            db_session,
            _officer(org_id, admin_id),
            permanent=True,
        )

        assert recalculated.await_args.args[-1] == [enrollment.id]

    async def test_another_organizations_requirement_is_not_found(
        self, db_session, setup_org_and_admin, monkeypatch
    ):
        org_id, admin_id = setup_org_and_admin
        monkeypatch.setattr(training_endpoints, "log_audit_event", AsyncMock())
        requirement = await _requirement(db_session, org_id, "HIPAA")

        with pytest.raises(HTTPException) as exc:
            await training_endpoints.delete_requirement(
                uuid.UUID(requirement.id),
                db_session,
                _officer(str(uuid.uuid4()), admin_id),
                permanent=True,
            )
        assert exc.value.status_code == 404
        assert await _reload(db_session, TrainingRequirement, requirement.id)
