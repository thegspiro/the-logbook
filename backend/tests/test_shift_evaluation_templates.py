"""Shift evaluation templates against real tables.

Pins what the service promises beyond the schema:

  * every read and write is confined to the caller's department, including a
    template id named in a program or in the department's settings (XC-1);
  * names are unique per department, case-insensitively;
  * an edit replaces the content and raises the version;
  * deleting a template clears it from the programs and settings that named
    it, and turns the general evaluation off rather than leaving a mode with
    no form;
  * the settings refuse a general mode with no form to fill out;
  * a settings row written before this feature reads as "off".
"""

import uuid

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.shift_evaluation import ShiftEvaluationTemplate
from app.models.training import TrainingModuleConfig, TrainingProgram
from app.models.user import Organization, User, UserStatus
from app.schemas.shift_evaluation import (
    ShiftEvaluationSettingsUpdate,
    ShiftEvaluationTemplateWrite,
)
from app.schemas.training_program import (
    TrainingProgramCreate,
    TrainingProgramUpdate,
)
from app.services.sample_evaluation_templates import emt_shift_evaluation_example
from app.services.shift_evaluation_template_service import (
    DUPLICATE_NAME_MESSAGE,
    ShiftEvaluationTemplateService,
)
from app.services.training_program_service import TrainingProgramService

pytestmark = pytest.mark.integration


async def _org(db_session: AsyncSession) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name="Evaluation Department",
        slug=f"eval-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _user(db_session: AsyncSession, org: Organization) -> User:
    handle = uuid.uuid4().hex[:10]
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"eval-{handle}",
        email=f"{handle}@eval.test",
        first_name="Dana",
        last_name="Whitfield",
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    user.positions = []
    db_session.add(user)
    await db_session.flush()
    return user


def _write(
    name: str = "Driver Evaluation", **overrides
) -> ShiftEvaluationTemplateWrite:
    body = {
        "name": name,
        "scale": [{"value": 1, "label": "Low"}, {"value": 2, "label": "High"}],
        "sections": [
            {
                "key": "driving",
                "title": "Driving",
                "items": [{"key": "backing", "label": "Backing"}],
            }
        ],
    }
    body.update(overrides)
    return ShiftEvaluationTemplateWrite.model_validate(body)


async def _template(db_session, org, user, name="Driver Evaluation"):
    service = ShiftEvaluationTemplateService(db_session)
    return await service.create_template(org.id, _write(name), user.id)


class TestTemplates:
    async def test_create_list_and_get(self, db_session):
        org = await _org(db_session)
        user = await _user(db_session, org)
        service = ShiftEvaluationTemplateService(db_session)

        created = await service.create_template(
            org.id, emt_shift_evaluation_example(), user.id
        )

        assert created.version == 1
        assert created.created_by == user.id
        listed = await service.list_templates(org.id)
        assert [t.name for t in listed] == ["EMT Shift Evaluation"]
        fetched = await service.get_template_response(created.id, org.id)
        assert fetched is not None
        assert fetched.sections[0].items[0].key == "als_assist"
        assert fetched.program_names == []
        assert fetched.is_general_form is False

    async def test_names_are_unique_per_department_ignoring_case(self, db_session):
        org = await _org(db_session)
        user = await _user(db_session, org)
        service = ShiftEvaluationTemplateService(db_session)
        await _template(db_session, org, user, "Driver Evaluation")

        with pytest.raises(ValueError, match=DUPLICATE_NAME_MESSAGE):
            await service.create_template(org.id, _write("driver evaluation"), user.id)

        other_org = await _org(db_session)
        other_user = await _user(db_session, other_org)
        # Another department may use the same name.
        await service.create_template(
            other_org.id, _write("Driver Evaluation"), other_user.id
        )

    async def test_an_edit_replaces_content_and_raises_the_version(self, db_session):
        org = await _org(db_session)
        user = await _user(db_session, org)
        service = ShiftEvaluationTemplateService(db_session)
        template = await _template(db_session, org, user)

        updated = await service.update_template(
            template.id,
            org.id,
            _write(
                "Driver Evaluation",
                sections=[
                    {
                        "key": "driving",
                        "title": "Driving",
                        "items": [
                            {"key": "backing", "label": "Backing with a spotter"},
                            {"label": "Intersections"},
                        ],
                    }
                ],
            ),
            user.id,
        )

        assert updated is not None
        assert updated.version == 2
        reloaded = (
            await db_session.execute(
                select(ShiftEvaluationTemplate).where(
                    ShiftEvaluationTemplate.id == template.id
                )
            )
        ).scalar_one()
        await db_session.refresh(reloaded)
        items = reloaded.sections[0]["items"]
        assert [i["label"] for i in items] == [
            "Backing with a spotter",
            "Intersections",
        ]
        # The renamed item kept its key, so ratings given against it survive.
        assert items[0]["key"] == "backing"

    async def test_keeping_its_own_name_is_not_a_duplicate(self, db_session):
        org = await _org(db_session)
        user = await _user(db_session, org)
        service = ShiftEvaluationTemplateService(db_session)
        template = await _template(db_session, org, user)

        updated = await service.update_template(
            template.id, org.id, _write("Driver Evaluation"), user.id
        )

        assert updated is not None

    async def test_another_department_cannot_reach_a_template(self, db_session):
        org = await _org(db_session)
        user = await _user(db_session, org)
        template = await _template(db_session, org, user)
        other_org = await _org(db_session)
        other_user = await _user(db_session, other_org)
        service = ShiftEvaluationTemplateService(db_session)

        assert await service.get_template_response(template.id, other_org.id) is None
        assert (
            await service.update_template(
                template.id, other_org.id, _write("Hijacked"), other_user.id
            )
            is None
        )
        assert await service.delete_template(template.id, other_org.id) is None
        assert await service.list_templates(other_org.id) == []
        still_there = await service.get_template(template.id, org.id)
        assert still_there is not None
        assert still_there.name == "Driver Evaluation"


class TestDelete:
    async def test_clears_programs_and_turns_the_general_form_off(self, db_session):
        org = await _org(db_session)
        user = await _user(db_session, org)
        service = ShiftEvaluationTemplateService(db_session)
        template = await _template(db_session, org, user)
        program = TrainingProgram(
            organization_id=org.id,
            name="Driver Candidate",
            shift_evaluation_template_id=template.id,
        )
        db_session.add(program)
        await db_session.flush()
        await service.update_settings(
            org.id,
            ShiftEvaluationSettingsUpdate(
                general_shift_evaluation_template_id=template.id,
                general_shift_evaluation_mode="required",
            ),
            user.id,
        )
        listed = await service.list_templates(org.id)
        assert listed[0].program_names == ["Driver Candidate"]
        assert listed[0].is_general_form is True

        cleared = await service.delete_template(template.id, org.id)

        assert cleared == ["Driver Candidate"]
        await db_session.refresh(program)
        assert program.shift_evaluation_template_id is None
        settings = await service.get_settings(org.id)
        assert settings.general_shift_evaluation_template_id is None
        assert settings.general_shift_evaluation_mode == "off"


class TestSettings:
    async def test_a_department_that_never_chose_reads_off(self, db_session):
        org = await _org(db_session)
        # Written the way a row from before this feature was: no evaluation
        # columns named, so the database defaults decide them.
        await db_session.execute(
            text(
                "INSERT INTO training_module_configs (id, organization_id) "
                "VALUES (:id, :org)"
            ),
            {"id": str(uuid.uuid4()), "org": org.id},
        )

        settings = await ShiftEvaluationTemplateService(db_session).get_settings(org.id)

        assert settings.general_shift_evaluation_template_id is None
        assert settings.general_shift_evaluation_mode == "off"
        assert settings.one_shift_evaluation_for_multiple_programs is False

    async def test_a_mode_without_a_form_is_refused(self, db_session):
        org = await _org(db_session)
        user = await _user(db_session, org)

        with pytest.raises(ValueError, match="general evaluation form first"):
            await ShiftEvaluationTemplateService(db_session).update_settings(
                org.id,
                ShiftEvaluationSettingsUpdate(general_shift_evaluation_mode="required"),
                user.id,
            )

    async def test_another_departments_template_is_refused(self, db_session):
        org = await _org(db_session)
        user = await _user(db_session, org)
        other_org = await _org(db_session)
        other_user = await _user(db_session, other_org)
        foreign = await _template(db_session, other_org, other_user)

        with pytest.raises(ValueError, match="Invalid shift evaluation template"):
            await ShiftEvaluationTemplateService(db_session).update_settings(
                org.id,
                ShiftEvaluationSettingsUpdate(
                    general_shift_evaluation_template_id=foreign.id
                ),
                user.id,
            )

    async def test_clearing_the_form_turns_the_mode_off(self, db_session):
        org = await _org(db_session)
        user = await _user(db_session, org)
        service = ShiftEvaluationTemplateService(db_session)
        template = await _template(db_session, org, user)
        await service.update_settings(
            org.id,
            ShiftEvaluationSettingsUpdate(
                general_shift_evaluation_template_id=template.id,
                general_shift_evaluation_mode="optional",
            ),
            user.id,
        )

        settings = await service.update_settings(
            org.id,
            ShiftEvaluationSettingsUpdate(general_shift_evaluation_template_id=None),
            user.id,
        )

        assert settings.general_shift_evaluation_template_id is None
        assert settings.general_shift_evaluation_mode == "off"

    async def test_omitted_fields_are_left_alone(self, db_session):
        org = await _org(db_session)
        user = await _user(db_session, org)
        service = ShiftEvaluationTemplateService(db_session)
        template = await _template(db_session, org, user)
        await service.update_settings(
            org.id,
            ShiftEvaluationSettingsUpdate(
                general_shift_evaluation_template_id=template.id,
                general_shift_evaluation_mode="optional",
            ),
            user.id,
        )

        settings = await service.update_settings(
            org.id,
            ShiftEvaluationSettingsUpdate(
                one_shift_evaluation_for_multiple_programs=True
            ),
            user.id,
        )

        assert settings.general_shift_evaluation_template_id == template.id
        assert settings.general_shift_evaluation_mode == "optional"
        assert settings.one_shift_evaluation_for_multiple_programs is True
        stored = (
            await db_session.execute(
                select(TrainingModuleConfig).where(
                    TrainingModuleConfig.organization_id == org.id
                )
            )
        ).scalar_one()
        assert stored.updated_by == user.id


class TestProgramLink:
    async def test_a_program_takes_its_own_departments_template(self, db_session):
        org = await _org(db_session)
        user = await _user(db_session, org)
        template = await _template(db_session, org, user)
        service = TrainingProgramService(db_session)

        program, error = await service.create_training_program(
            TrainingProgramCreate(
                name="Driver Candidate", shift_evaluation_template_id=template.id
            ),
            org.id,
            user.id,
        )

        assert error is None
        assert program is not None
        assert program.shift_evaluation_template_id == template.id

    async def test_another_departments_template_is_refused_on_create(self, db_session):
        org = await _org(db_session)
        user = await _user(db_session, org)
        other_org = await _org(db_session)
        foreign = await _template(
            db_session, other_org, await _user(db_session, other_org)
        )

        program, error = await TrainingProgramService(
            db_session
        ).create_training_program(
            TrainingProgramCreate(
                name="Driver Candidate", shift_evaluation_template_id=foreign.id
            ),
            org.id,
            user.id,
        )

        assert program is None
        assert error == "Invalid shift evaluation template"

    async def test_update_sets_refuses_and_clears(self, db_session):
        org = await _org(db_session)
        user = await _user(db_session, org)
        template = await _template(db_session, org, user)
        other_org = await _org(db_session)
        foreign = await _template(
            db_session, other_org, await _user(db_session, other_org)
        )
        service = TrainingProgramService(db_session)
        program, _ = await service.create_training_program(
            TrainingProgramCreate(name="EMT Field Internship"), org.id, user.id
        )
        assert program is not None
        assert program.shift_evaluation_template_id is None

        updated, error = await service.update_training_program(
            program.id,
            org.id,
            TrainingProgramUpdate(shift_evaluation_template_id=template.id),
        )
        assert error is None
        assert updated is not None
        assert updated.shift_evaluation_template_id == template.id

        refused, error = await service.update_training_program(
            program.id,
            org.id,
            TrainingProgramUpdate(shift_evaluation_template_id=foreign.id),
        )
        assert refused is None
        assert error == "Invalid shift evaluation template"

        cleared, error = await service.update_training_program(
            program.id,
            org.id,
            TrainingProgramUpdate.model_validate(
                {"shift_evaluation_template_id": None}
            ),
        )
        assert error is None
        assert cleared is not None
        assert cleared.shift_evaluation_template_id is None

    async def test_a_duplicate_keeps_the_form(self, db_session):
        org = await _org(db_session)
        user = await _user(db_session, org)
        template = await _template(db_session, org, user)
        service = TrainingProgramService(db_session)
        program, _ = await service.create_training_program(
            TrainingProgramCreate(
                name="Driver Candidate", shift_evaluation_template_id=template.id
            ),
            org.id,
            user.id,
        )
        assert program is not None

        copy, error = await service.duplicate_program(
            program.id, "Driver Candidate (copy)", org.id, user.id
        )

        assert error is None
        assert copy is not None
        assert copy.shift_evaluation_template_id == template.id


class TestProgramDetailEndpoint:
    async def test_the_detail_response_carries_the_programs_form(self, db_session):
        """The edit dialog is seeded from this response, so a form left out of
        it is sent back as null and removed by the next unrelated edit."""
        from app.api.v1.endpoints.training_programs import get_training_program

        org = await _org(db_session)
        user = await _user(db_session, org)
        template = await _template(db_session, org, user)
        program, _ = await TrainingProgramService(db_session).create_training_program(
            TrainingProgramCreate(
                name="Driver Candidate", shift_evaluation_template_id=template.id
            ),
            org.id,
            user.id,
        )
        assert program is not None

        body = await get_training_program(
            program_id=uuid.UUID(program.id), db=db_session, current_user=user
        )

        assert str(body.shift_evaluation_template_id) == template.id


class TestConcurrentEdits:
    async def test_an_edit_reads_the_template_under_a_row_lock(self, db_session):
        """Two saves at once must take turns, or both write the same version."""
        from unittest.mock import patch

        org = await _org(db_session)
        user = await _user(db_session, org)
        template = await _template(db_session, org, user)
        service = ShiftEvaluationTemplateService(db_session)
        seen: list[bool] = []
        original = service.get_template

        async def spy(template_id, organization_id, *, for_update=False):
            seen.append(for_update)
            return await original(template_id, organization_id, for_update=for_update)

        with patch.object(service, "get_template", spy):
            await service.update_template(
                template.id, org.id, _write("Driver Evaluation"), user.id
            )

        assert seen[0] is True

    async def test_each_saved_edit_raises_the_version_by_one(self, db_session):
        org = await _org(db_session)
        user = await _user(db_session, org)
        template = await _template(db_session, org, user)
        service = ShiftEvaluationTemplateService(db_session)

        for _ in range(3):
            await service.update_template(
                template.id, org.id, _write("Driver Evaluation"), user.id
            )

        reloaded = await service.get_template(template.id, org.id)
        assert reloaded is not None
        assert reloaded.version == 4
