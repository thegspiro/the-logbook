"""An evaluation form in use cannot be deactivated (owner decision, 2026-11-14).

A deactivated form named by a program, or by the department's general-form
setting, was still required and still offered: deactivating it changed
nothing anyone could see. Deactivating one in use is now refused, naming what
uses it, and an inactive form cannot be newly chosen for either.
"""

import pytest

from app.schemas.shift_evaluation import ShiftEvaluationSettingsUpdate
from app.schemas.training_program import TrainingProgramCreate, TrainingProgramUpdate
from app.services.shift_evaluation_template_service import (
    ShiftEvaluationTemplateService,
)
from app.services.training_program_service import TrainingProgramService
from tests.test_shift_evaluation_templates import _org, _template, _user, _write

pytestmark = pytest.mark.integration


async def _deactivate(db, template, org, user):
    return await ShiftEvaluationTemplateService(db).update_template(
        template.id, org.id, _write(template.name, is_active=False), user.id
    )


class TestDeactivating:
    async def test_refused_while_a_program_uses_it(self, db_session):
        org = await _org(db_session)
        user = await _user(db_session, org)
        template = await _template(db_session, org, user)
        await TrainingProgramService(db_session).create_training_program(
            TrainingProgramCreate(
                name="Driver Candidate", shift_evaluation_template_id=template.id
            ),
            org.id,
            user.id,
        )

        with pytest.raises(ValueError, match="Driver Candidate"):
            await _deactivate(db_session, template, org, user)

        await db_session.refresh(template)
        assert template.is_active is True

    async def test_refused_while_it_is_the_general_form(self, db_session):
        org = await _org(db_session)
        user = await _user(db_session, org)
        template = await _template(db_session, org, user)
        await ShiftEvaluationTemplateService(db_session).update_settings(
            org.id,
            ShiftEvaluationSettingsUpdate(
                general_shift_evaluation_template_id=template.id
            ),
            user.id,
        )

        with pytest.raises(ValueError, match="general"):
            await _deactivate(db_session, template, org, user)

    async def test_allowed_once_nothing_uses_it(self, db_session):
        org = await _org(db_session)
        user = await _user(db_session, org)
        template = await _template(db_session, org, user)

        saved = await _deactivate(db_session, template, org, user)

        assert saved.is_active is False


class TestChoosingAnInactiveForm:
    async def _inactive(self, db, org, user):
        template = await _template(db, org, user)
        await _deactivate(db, template, org, user)
        return template

    async def test_a_new_program_cannot_take_one(self, db_session):
        org = await _org(db_session)
        user = await _user(db_session, org)
        template = await self._inactive(db_session, org, user)

        program, error = await TrainingProgramService(
            db_session
        ).create_training_program(
            TrainingProgramCreate(
                name="Driver Candidate", shift_evaluation_template_id=template.id
            ),
            org.id,
            user.id,
        )

        assert program is None
        assert "no longer in use" in error

    async def test_an_existing_program_cannot_switch_to_one(self, db_session):
        org = await _org(db_session)
        user = await _user(db_session, org)
        template = await self._inactive(db_session, org, user)
        service = TrainingProgramService(db_session)
        program, _ = await service.create_training_program(
            TrainingProgramCreate(name="Driver Candidate"), org.id, user.id
        )

        updated, error = await service.update_training_program(
            program.id,
            org.id,
            TrainingProgramUpdate(shift_evaluation_template_id=template.id),
        )

        assert updated is None
        assert "no longer in use" in error

    async def test_the_general_setting_cannot_take_one(self, db_session):
        org = await _org(db_session)
        user = await _user(db_session, org)
        template = await self._inactive(db_session, org, user)

        with pytest.raises(ValueError, match="no longer in use"):
            await ShiftEvaluationTemplateService(db_session).update_settings(
                org.id,
                ShiftEvaluationSettingsUpdate(
                    general_shift_evaluation_template_id=template.id
                ),
                user.id,
            )
