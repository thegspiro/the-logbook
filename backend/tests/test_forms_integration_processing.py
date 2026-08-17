"""Direct-path integration processing tests (no DB).

The event-request form generator sets form.integration_type AND creates a
FormIntegration row carrying the explicit field_mappings. The direct path
must use that row — the label fallback does not recognize every generated
label, so ignoring the row silently drops answers — and must respect the
operator disabling or deleting it (raised in review of PR #1443).
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from app.models.forms import Form, IntegrationType
from app.models.membership_pipeline import ProspectStatus
from app.services.forms_service import FormsService


def _service():
    db = SimpleNamespace(
        execute=AsyncMock(),
        commit=AsyncMock(),
        flush=AsyncMock(),
        delete=AsyncMock(),
        rollback=AsyncMock(),
    )
    service = FormsService(db)
    service._auto_advance_pipeline_step = AsyncMock()
    service._process_event_request = AsyncMock(return_value={"success": True})
    return service


def _form(integrations):
    return SimpleNamespace(
        integration_type=IntegrationType.EVENT_REQUEST.value,
        integrations=integrations,
    )


def _submission():
    return SimpleNamespace(
        integration_processed=False,
        integration_result=None,
    )


def _row(is_active=True, integration_type=IntegrationType.EVENT_REQUEST.value):
    return SimpleNamespace(
        is_active=is_active,
        integration_type=integration_type,
        field_mappings={"field-1": "outreach_type"},
    )


class TestDirectPathUsesExplicitMappings:
    async def test_active_same_type_row_is_passed_to_the_processor(self):
        service = _service()
        row = _row()
        form = _form([row])
        submission = _submission()

        await service._process_integrations(submission, form)

        service._process_event_request.assert_awaited_once_with(
            submission, integration=row, form=form
        )

    async def test_without_a_row_the_direct_path_still_runs(self):
        service = _service()
        form = _form([])
        submission = _submission()

        await service._process_integrations(submission, form)

        service._process_event_request.assert_awaited_once_with(
            submission, integration=None, form=form
        )

    async def test_auto_advance_receives_the_specific_submission(self):
        service = _service()
        form = _form([])
        submission = _submission()

        await service._process_integrations(submission, form)

        service._auto_advance_pipeline_step.assert_awaited_once_with(form, submission)

    async def test_disabled_row_stops_direct_processing(self):
        service = _service()
        submission = _submission()

        await service._process_integrations(submission, _form([_row(is_active=False)]))

        service._process_event_request.assert_not_awaited()
        assert submission.integration_processed is False

    async def test_other_type_rows_do_not_satisfy_the_marker(self):
        service = _service()
        submission = _submission()
        unrelated = _row(integration_type=IntegrationType.MEMBERSHIP_INTEREST.value)
        form = _form([unrelated])

        await service._process_integrations(submission, form)

        # The unrelated row neither supplies mappings nor disables the path.
        service._process_event_request.assert_awaited_once_with(
            submission, integration=None, form=form
        )


class TestFormStepAutoAdvance:
    async def test_only_selects_prospect_bound_to_submission(self, monkeypatch):
        step = SimpleNamespace(id="step-1", name="Application")
        prospect = SimpleNamespace(id="prospect-1", organization_id="org-1")
        statements = []

        async def execute(statement):
            statements.append(statement)
            rows = [step] if len(statements) == 1 else [prospect]
            return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: rows))

        db = SimpleNamespace(execute=execute)
        service = FormsService(db)
        complete_step = AsyncMock()

        from app.services import membership_pipeline_service as pipeline_module

        monkeypatch.setattr(
            pipeline_module.MembershipPipelineService,
            "complete_step",
            complete_step,
        )

        form = SimpleNamespace(id="form-1")
        submission = SimpleNamespace(id="submission-1")
        await service._auto_advance_pipeline_step(form, submission)

        prospect_query = statements[1].compile()
        assert "form_submission_id" in str(prospect_query)
        assert "submission-1" in prospect_query.params.values()
        assert ProspectStatus.ACTIVE in prospect_query.params.values()
        complete_step.assert_awaited_once()
        assert (
            complete_step.await_args.kwargs["action_result"]["form_submission_id"]
            == "submission-1"
        )


class TestDeleteIntegrationClearsMarker:
    @staticmethod
    def _db(results):
        statements = []

        async def execute(statement, *args, **kwargs):
            statements.append(statement)
            return results[len(statements) - 1]

        db = SimpleNamespace(
            execute=execute,
            commit=AsyncMock(),
            flush=AsyncMock(),
            delete=AsyncMock(),
            rollback=AsyncMock(),
        )
        return db, statements

    async def test_deleting_the_last_same_type_row_clears_the_form_marker(self):
        integration = SimpleNamespace(
            id="int-1",
            integration_type=IntegrationType.EVENT_REQUEST.value,
        )
        fetch = MagicMock(scalar_one_or_none=MagicMock(return_value=integration))
        no_remaining = MagicMock(first=MagicMock(return_value=None))
        db, statements = self._db([fetch, no_remaining, MagicMock()])
        service = FormsService(db)

        ok, error = await service.delete_integration("int-1", "form-1", "org-1")

        assert ok
        assert error is None
        db.delete.assert_awaited_once_with(integration)
        marker_update = statements[-1]
        assert marker_update.table.name == Form.__tablename__
        assert marker_update.compile().params.get("integration_type") is None

    async def test_marker_survives_while_another_same_type_row_remains(self):
        integration = SimpleNamespace(
            id="int-1",
            integration_type=IntegrationType.EVENT_REQUEST.value,
        )
        fetch = MagicMock(scalar_one_or_none=MagicMock(return_value=integration))
        remaining = MagicMock(first=MagicMock(return_value=("int-2",)))
        db, statements = self._db([fetch, remaining])
        service = FormsService(db)

        ok, error = await service.delete_integration("int-1", "form-1", "org-1")

        assert ok
        assert error is None
        # Only the fetch and the remaining-rows check ran — no Form update.
        assert len(statements) == 2
