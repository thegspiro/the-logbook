"""
Shift evaluation template service

Create, edit and delete a department's evaluation forms, and read and change
how the department uses them (its general form and whether one evaluation
counts for several programs).

Every read and write is scoped to the caller's organization, and every
client-supplied template id is resolved in-org before it is stored or acted on
(Pitfall #14).
"""

from typing import Optional
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.shift_evaluation import (
    DEFAULT_GENERAL_EVALUATION_MODE,
    ShiftEvaluationTemplate,
)
from app.models.training import TrainingModuleConfig, TrainingProgram
from app.schemas.shift_evaluation import (
    ShiftEvaluationSettingsResponse,
    ShiftEvaluationSettingsUpdate,
    ShiftEvaluationTemplateResponse,
    ShiftEvaluationTemplateWrite,
)
from app.services.training_module_config_service import TrainingModuleConfigService

DUPLICATE_NAME_MESSAGE = "Another evaluation template already has this name"


class ShiftEvaluationTemplateService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # -- Templates ---------------------------------------------------------

    async def list_templates(
        self, organization_id: UUID | str
    ) -> list[ShiftEvaluationTemplateResponse]:
        result = await self.db.execute(
            select(ShiftEvaluationTemplate)
            .where(ShiftEvaluationTemplate.organization_id == str(organization_id))
            .order_by(ShiftEvaluationTemplate.name)
        )
        templates = list(result.scalars().all())
        return await self._with_usage(templates, organization_id)

    async def get_template(
        self,
        template_id: UUID | str,
        organization_id: UUID | str,
        *,
        for_update: bool = False,
    ) -> Optional[ShiftEvaluationTemplate]:
        query = select(ShiftEvaluationTemplate).where(
            ShiftEvaluationTemplate.id == str(template_id),
            ShiftEvaluationTemplate.organization_id == str(organization_id),
        )
        if for_update:
            # A locking read that also refreshes any copy already loaded in
            # this session, so the version read is the one committed last.
            query = query.with_for_update().execution_options(populate_existing=True)
        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def get_template_response(
        self, template_id: UUID | str, organization_id: UUID | str
    ) -> Optional[ShiftEvaluationTemplateResponse]:
        template = await self.get_template(template_id, organization_id)
        if template is None:
            return None
        return (await self._with_usage([template], organization_id))[0]

    async def create_template(
        self,
        organization_id: UUID | str,
        body: ShiftEvaluationTemplateWrite,
        user_id: UUID | str,
    ) -> ShiftEvaluationTemplate:
        await self._refuse_duplicate_name(organization_id, body.name)
        template = ShiftEvaluationTemplate(
            organization_id=str(organization_id),
            created_by=str(user_id),
            updated_by=str(user_id),
            version=1,
            **body.column_values(),
        )
        self.db.add(template)
        await self.db.commit()
        await self.db.refresh(template)
        return template

    async def update_template(
        self,
        template_id: UUID | str,
        organization_id: UUID | str,
        body: ShiftEvaluationTemplateWrite,
        user_id: UUID | str,
    ) -> Optional[ShiftEvaluationTemplate]:
        # Locked so two officers saving at once take turns: each edit raises
        # the version by one instead of both writing the same next number.
        template = await self.get_template(
            template_id, organization_id, for_update=True
        )
        if template is None:
            return None
        await self._refuse_duplicate_name(
            organization_id, body.name, exclude_id=template.id
        )
        # Fresh values for every JSON column, so SQLAlchemy sees a change
        # rather than a mutated shared reference (Pitfall #12).
        for column, value in body.column_values().items():
            setattr(template, column, value)
        template.version = (template.version or 1) + 1
        template.updated_by = str(user_id)
        await self.db.commit()
        await self.db.refresh(template)
        return template

    async def delete_template(
        self, template_id: UUID | str, organization_id: UUID | str
    ) -> Optional[list[str]]:
        """Delete a template; returns the names of programs it is cleared from.

        The foreign keys are SET NULL, but they are cleared here first and
        explicitly, scoped to this org, so the outcome does not depend on the
        database enforcing them and the caller can report which programs lost
        their form.
        """
        template = await self.get_template(template_id, organization_id)
        if template is None:
            return None
        programs = await self._program_names_by_template(organization_id)
        program_names = programs.get(template.id, [])
        await self.db.execute(
            update(TrainingProgram)
            .where(
                TrainingProgram.organization_id == str(organization_id),
                TrainingProgram.shift_evaluation_template_id == template.id,
            )
            .values(shift_evaluation_template_id=None)
        )
        await self.db.execute(
            update(TrainingModuleConfig)
            .where(
                TrainingModuleConfig.organization_id == str(organization_id),
                TrainingModuleConfig.general_shift_evaluation_template_id
                == template.id,
            )
            .values(
                general_shift_evaluation_template_id=None,
                general_shift_evaluation_mode=DEFAULT_GENERAL_EVALUATION_MODE,
            )
        )
        await self.db.delete(template)
        await self.db.commit()
        return program_names

    # -- Department settings ----------------------------------------------

    async def get_settings(
        self, organization_id: UUID | str
    ) -> ShiftEvaluationSettingsResponse:
        config = await TrainingModuleConfigService(self.db).get_config(organization_id)
        return _settings_response(config)

    async def update_settings(
        self,
        organization_id: UUID | str,
        body: ShiftEvaluationSettingsUpdate,
        user_id: UUID | str,
    ) -> ShiftEvaluationSettingsResponse:
        """Apply the fields the caller sent. Raises ValueError on a bad choice."""
        sent = body.model_fields_set
        config = await TrainingModuleConfigService(self.db).get_config(organization_id)

        template_id = config.general_shift_evaluation_template_id
        if "general_shift_evaluation_template_id" in sent:
            if body.general_shift_evaluation_template_id is None:
                template_id = None
            else:
                template = await self.get_template(
                    body.general_shift_evaluation_template_id, organization_id
                )
                if template is None:
                    raise ValueError("Invalid shift evaluation template")
                template_id = template.id

        mode = config.general_shift_evaluation_mode or DEFAULT_GENERAL_EVALUATION_MODE
        if (
            "general_shift_evaluation_mode" in sent
            and body.general_shift_evaluation_mode
        ):
            mode = body.general_shift_evaluation_mode
        if template_id is None:
            # Clearing the form turns the general evaluation off rather than
            # leaving a mode that names nothing to fill out.
            if "general_shift_evaluation_mode" in sent and mode != "off":
                raise ValueError("Choose a general evaluation form first")
            mode = DEFAULT_GENERAL_EVALUATION_MODE

        config.general_shift_evaluation_template_id = template_id
        config.general_shift_evaluation_mode = mode
        if (
            "one_shift_evaluation_for_multiple_programs" in sent
            and body.one_shift_evaluation_for_multiple_programs is not None
        ):
            config.one_shift_evaluation_for_multiple_programs = (
                body.one_shift_evaluation_for_multiple_programs
            )
        config.updated_by = str(user_id)
        await self.db.commit()
        await self.db.refresh(config)
        return _settings_response(config)

    # -- Helpers -------------------------------------------------------------

    async def _refuse_duplicate_name(
        self,
        organization_id: UUID | str,
        name: str,
        exclude_id: Optional[str] = None,
    ) -> None:
        # Checked in Python as well as by the unique constraint so the caller
        # gets a sentence rather than an IntegrityError. Case-insensitive to
        # match the column's collation.
        query = select(func.count(ShiftEvaluationTemplate.id)).where(
            ShiftEvaluationTemplate.organization_id == str(organization_id),
            func.lower(ShiftEvaluationTemplate.name) == name.lower(),
        )
        if exclude_id is not None:
            query = query.where(ShiftEvaluationTemplate.id != exclude_id)
        if (await self.db.execute(query)).scalar_one():
            raise ValueError(DUPLICATE_NAME_MESSAGE)

    async def _program_names_by_template(
        self, organization_id: UUID | str
    ) -> dict[str, list[str]]:
        result = await self.db.execute(
            select(TrainingProgram.shift_evaluation_template_id, TrainingProgram.name)
            .where(
                TrainingProgram.organization_id == str(organization_id),
                TrainingProgram.shift_evaluation_template_id.is_not(None),
            )
            .order_by(TrainingProgram.name)
        )
        names: dict[str, list[str]] = {}
        for template_id, name in result.all():
            names.setdefault(str(template_id), []).append(name)
        return names

    async def _with_usage(
        self, templates: list[ShiftEvaluationTemplate], organization_id: UUID | str
    ) -> list[ShiftEvaluationTemplateResponse]:
        programs = await self._program_names_by_template(organization_id)
        general_id = (
            await self.db.execute(
                select(TrainingModuleConfig.general_shift_evaluation_template_id).where(
                    TrainingModuleConfig.organization_id == str(organization_id)
                )
            )
        ).scalar_one_or_none()
        responses = []
        for template in templates:
            response = ShiftEvaluationTemplateResponse.model_validate(template)
            response.program_names = programs.get(template.id, [])
            response.is_general_form = general_id == template.id
            responses.append(response)
        return responses


def _settings_response(config: TrainingModuleConfig) -> ShiftEvaluationSettingsResponse:
    return ShiftEvaluationSettingsResponse(
        general_shift_evaluation_template_id=config.general_shift_evaluation_template_id,
        general_shift_evaluation_mode=(
            config.general_shift_evaluation_mode or DEFAULT_GENERAL_EVALUATION_MODE
        ),
        one_shift_evaluation_for_multiple_programs=bool(
            config.one_shift_evaluation_for_multiple_programs
        ),
    )
