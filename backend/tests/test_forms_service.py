"""
Unit tests for pure helpers in the forms service
(app/services/forms_service.py). DB-free, except
``TestConcurrentDuplicateSubmissionCheck`` (marked ``integration``), which
needs two real, independently-committing database sessions to reproduce a
REPEATABLE READ snapshot race and so cannot run in the no-DB unit job.

Focus: FORM-6 — a required field is satisfied only by a non-empty value, not
merely by the key being present.
"""

import asyncio
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import text

from app.core.database import database_manager
from app.models.forms import (
    FieldType,
    Form,
    FormField,
    FormIntegration,
    FormStatus,
    IntegrationTarget,
    IntegrationType,
)
from app.services.forms_service import FormsService


class TestIsEmptyValue:
    """FORM-6: what counts as "not provided" for a required field."""

    def test_none_is_empty(self):
        assert FormsService._is_empty_value(None) is True

    def test_empty_string_is_empty(self):
        assert FormsService._is_empty_value("") is True

    def test_whitespace_string_is_empty(self):
        assert FormsService._is_empty_value("   \t\n") is True

    def test_empty_list_is_empty(self):
        # A required multiselect with nothing chosen.
        assert FormsService._is_empty_value([]) is True

    def test_empty_dict_is_empty(self):
        assert FormsService._is_empty_value({}) is True

    def test_nonempty_string_is_not_empty(self):
        assert FormsService._is_empty_value("hello") is False

    def test_zero_is_not_empty(self):
        # A required number field answered with 0 is a real answer.
        assert FormsService._is_empty_value(0) is False

    def test_false_is_not_empty(self):
        # A required boolean answered False is a real answer.
        assert FormsService._is_empty_value(False) is False

    def test_nonempty_list_is_not_empty(self):
        assert FormsService._is_empty_value(["a"]) is False


@pytest.mark.asyncio
async def test_get_forms_filters_direct_and_related_integrations():
    """The module filter must include both current and legacy form storage."""
    count_result = MagicMock()
    count_result.scalar.return_value = 0
    forms_result = MagicMock()
    forms_result.scalars.return_value.all.return_value = []
    db = AsyncMock()
    db.execute.side_effect = [count_result, forms_result]

    await FormsService(db).get_forms(
        organization_id="00000000-0000-0000-0000-000000000001",
        integration_type=IntegrationType.EVENT_REQUEST,
    )

    count_statement = db.execute.await_args_list[0].args[0]
    sql = str(count_statement.compile(compile_kwargs={"literal_binds": True}))
    assert "forms.integration_type = 'event_request'" in sql
    assert "EXISTS" in sql
    assert "form_integrations.integration_type = 'event_request'" in sql


@pytest.mark.asyncio
async def test_create_form_persists_direct_integration_marker_without_fields():
    """An integration form remains discoverable when no mapping row is made."""
    db = MagicMock()
    db.flush = AsyncMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()
    query_result = MagicMock()
    query_result.scalar_one.return_value = SimpleNamespace(id="form-id")
    db.execute = AsyncMock(return_value=query_result)

    result, error = await FormsService(db).create_form(
        organization_id="00000000-0000-0000-0000-000000000001",
        form_data={"name": "Outreach", "integration_type": "event_request"},
        created_by="00000000-0000-0000-0000-000000000002",
    )

    created_form = db.add.call_args.args[0]
    assert error is None
    assert result.id == "form-id"
    assert created_form.integration_type == "event_request"


@pytest.mark.asyncio
async def test_public_form_enforces_authentication_policy():
    db = AsyncMock()
    service = FormsService(db)
    service.get_form_by_slug = AsyncMock(
        return_value=SimpleNamespace(require_authentication=True)
    )

    result, error = await service.submit_public_form("abc123abc123", {})

    assert result is None
    assert error == "Authentication is required to submit this form"
    db.add.assert_not_called()


@pytest.mark.asyncio
async def test_public_form_rejects_repeat_member_submission():
    db = AsyncMock()
    prior_result = MagicMock()
    prior_result.scalar_one_or_none.return_value = "existing-submission"
    db.execute.side_effect = [MagicMock(), prior_result]
    service = FormsService(db)
    service.get_form_by_slug = AsyncMock(
        return_value=SimpleNamespace(
            id="form-id",
            require_authentication=False,
            allow_multiple_submissions=False,
        )
    )

    result, error = await service.submit_public_form(
        "abc123abc123", {}, submitted_by="member-id"
    )

    assert result is None
    assert error == "You have already submitted this form"
    assert db.execute.await_count == 2
    db.add.assert_not_called()


@pytest.mark.asyncio
async def test_invalid_public_form_does_not_consume_daily_cap(monkeypatch):
    db = AsyncMock()
    field = SimpleNamespace(id="field-id", label="Required", required=True)
    service = FormsService(db)
    service.get_form_by_slug = AsyncMock(
        return_value=SimpleNamespace(
            id="form-id",
            fields=[field],
            require_authentication=False,
            allow_multiple_submissions=True,
        )
    )
    cap = AsyncMock(return_value=False)
    monkeypatch.setattr("app.services.forms_service.daily_cap_exceeded", cap)

    result, error = await service.submit_public_form(
        "abc123abc123", {}, enforce_daily_cap=True
    )

    assert result is None
    assert error == "Required field 'Required' is missing"
    cap.assert_not_awaited()
    db.add.assert_not_called()


def _db_returning(row):
    db = MagicMock()
    db.execute = AsyncMock(
        return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=row))
    )
    db.commit = AsyncMock()
    db.flush = AsyncMock()
    db.refresh = AsyncMock()
    db.rollback = AsyncMock()
    return db


class TestUpdateForm:
    """update_form must route through apply_updates so an explicit null
    actually clears a nullable field, and rejects one against a NOT NULL
    column with a clean error instead of a blind setattr."""

    async def test_clears_a_nullable_field(self):
        form = Form(
            id="f1",
            organization_id="org-1",
            name="Outreach",
            description="old description",
        )
        db = _db_returning(form)
        service = FormsService(db)
        service.get_form_by_id = AsyncMock(return_value=form)

        result, error = await service.update_form("f1", "org-1", {"description": None})

        assert error is None
        assert result.description is None

    async def test_rejects_null_against_not_null_name(self):
        form = Form(id="f1", organization_id="org-1", name="Outreach")
        db = _db_returning(form)
        service = FormsService(db)
        service.get_form_by_id = AsyncMock(return_value=form)

        result, error = await service.update_form("f1", "org-1", {"name": None})

        assert result is None
        assert error is not None
        db.rollback.assert_awaited_once()


class TestUpdateField:
    async def test_clears_a_nullable_field(self):
        field = FormField(
            id="fld1",
            form_id="f1",
            label="Notes",
            field_type=FieldType.TEXT,
            help_text="old help text",
        )
        db = _db_returning(field)
        service = FormsService(db)
        service.get_form_by_id = AsyncMock(
            return_value=Form(id="f1", organization_id="org-1", name="Outreach")
        )

        result, error = await service.update_field(
            "fld1", "f1", "org-1", {"help_text": None}
        )

        assert error is None
        assert result.help_text is None

    async def test_rejects_null_against_not_null_label(self):
        field = FormField(
            id="fld1", form_id="f1", label="Notes", field_type=FieldType.TEXT
        )
        db = _db_returning(field)
        service = FormsService(db)
        service.get_form_by_id = AsyncMock(
            return_value=Form(id="f1", organization_id="org-1", name="Outreach")
        )

        result, error = await service.update_field(
            "fld1", "f1", "org-1", {"label": None}
        )

        assert result is None
        assert error is not None
        db.rollback.assert_awaited_once()


class TestUpdateIntegration:
    async def test_rejects_null_against_not_null_target_module(self):
        integration = FormIntegration(
            id="int1",
            form_id="f1",
            organization_id="org-1",
            target_module=IntegrationTarget.INVENTORY,
            integration_type=IntegrationType.EQUIPMENT_ASSIGNMENT,
        )
        db = _db_returning(integration)
        service = FormsService(db)

        result, error = await service.update_integration(
            "int1", "f1", "org-1", {"target_module": None}
        )

        assert result is None
        assert error is not None
        db.rollback.assert_awaited_once()


class TestIntegrationProcessorsSanitizeErrors:
    """An integration-processor exception is stored on
    submission.integration_result, and FormSubmissionResponse serializes
    that column straight back to the caller of submit_form (any
    authenticated member — submit_form carries no elevated permission
    requirement) and to forms.manage admins via get_submission/
    list_submissions/reprocess_submission_integrations. Raw ``str(e)`` here
    is the same leak class FORM-7 fixed on the (result, error) tuple path,
    just reached through a different field — every processor must route the
    exception through safe_error_detail() instead of interpolating it
    directly."""

    async def test_equipment_assignment_processor_sanitizes_db_error(self):
        submission = SimpleNamespace(
            data={"f-member": "user-1", "f-item": "item-1"},
            organization_id="org-1",
            submitted_by="user-1",
        )
        form = SimpleNamespace(fields=[])
        integration = SimpleNamespace(
            field_mappings={"f-member": "member_id", "f-item": "item_id"}
        )
        # _entity_in_org: any by-id lookup resolves to a row in-org.
        db = _db_returning("found")
        service = FormsService(db)

        sensitive = "Unknown column 'assigned_by_fk' in 'field list'"
        with patch("app.services.inventory_service.InventoryService") as mock_inv:
            mock_inv.return_value.assign_item_to_user = AsyncMock(
                side_effect=RuntimeError(sensitive)
            )
            result = await service._process_equipment_assignment(
                submission, integration=integration, form=form
            )

        assert result["success"] is False
        assert sensitive not in result["error"]
        assert "field list" not in result["error"]

    async def test_equipment_assignment_processor_sanitizes_returned_error(self):
        """InventoryService.assign_item_to_user() doesn't raise on failure —
        it returns (None, str(e)) (inventory_service.py). That bypasses the
        except-block sanitizer entirely, so the (result, error) tuple branch
        needs its own sanitize_error_message() call, not just the except."""
        submission = SimpleNamespace(
            data={"f-member": "user-1", "f-item": "item-1"},
            organization_id="org-1",
            submitted_by="user-1",
        )
        form = SimpleNamespace(fields=[])
        integration = SimpleNamespace(
            field_mappings={"f-member": "member_id", "f-item": "item_id"}
        )
        db = _db_returning("found")
        service = FormsService(db)

        sensitive = "(pymysql.err.IntegrityError) (1452, 'Cannot add or update')"
        with patch("app.services.inventory_service.InventoryService") as mock_inv:
            mock_inv.return_value.assign_item_to_user = AsyncMock(
                return_value=(None, sensitive)
            )
            result = await service._process_equipment_assignment(
                submission, integration=integration, form=form
            )

        assert result["success"] is False
        assert sensitive not in result["error"]
        assert "pymysql" not in result["error"]

    async def test_process_integrations_direct_path_sanitizes_error(self):
        """The aggregator's own except (form.integration_type set, no
        FormIntegration row) must not leak a processor's raw exception."""
        submission = SimpleNamespace(
            id="sub-1",
            integration_processed=False,
            integration_result=None,
        )
        form = SimpleNamespace(integration_type="equipment_assignment", integrations=[])
        db = AsyncMock()
        service = FormsService(db)

        sensitive = 'OperationalError: (2003, "Can\'t connect to MySQL server")'
        service._process_equipment_assignment = AsyncMock(
            side_effect=RuntimeError(sensitive)
        )
        service._auto_advance_pipeline_step = AsyncMock()

        await service._process_integrations(submission, form)

        error_text = submission.integration_result["equipment_assignment"]["error"]
        assert sensitive not in error_text
        assert "MySQL" not in error_text

    async def test_process_integrations_legacy_path_sanitizes_error(self):
        """Same aggregator except, taken via the legacy FormIntegration-row
        path (form.integration_type unset)."""
        submission = SimpleNamespace(
            id="sub-2",
            integration_processed=False,
            integration_result=None,
        )
        legacy_integration = SimpleNamespace(
            integration_type=IntegrationType.EVENT_REGISTRATION, is_active=True
        )
        form = SimpleNamespace(integration_type=None, integrations=[legacy_integration])
        db = AsyncMock()
        service = FormsService(db)

        sensitive = "IntegrityError: duplicate entry for key 'events.pk'"
        service._process_event_registration = AsyncMock(
            side_effect=RuntimeError(sensitive)
        )
        service._auto_advance_pipeline_step = AsyncMock()

        await service._process_integrations(submission, form)

        error_text = submission.integration_result["event_registration"]["error"]
        assert sensitive not in error_text
        assert "IntegrityError" not in error_text


async def _insert_org_and_member(
    session, org_id: str, user_id: str, label: str
) -> None:
    await session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone)"
            " VALUES (:id, :name, :otype, :slug, :tz)"
        ),
        {
            "id": org_id,
            "name": f"Forms Dup Race Test Org {label}",
            "otype": "fire_department",
            "slug": f"fdrt-{org_id[:8]}",
            "tz": "UTC",
        },
    )
    await session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name,"
            " last_name, email, password_hash, status)"
            " VALUES (:id, :org, :un, :fn, :ln, :em, :pw, 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"member-{user_id[:8]}",
            "fn": "Test",
            "ln": "Member",
            "em": f"member-{user_id[:8]}@test.com",
            "pw": "hashed",
        },
    )


async def _cleanup_org(org_id: str) -> None:
    async with database_manager.session_factory() as session:
        await session.execute(
            text("DELETE FROM form_submissions WHERE organization_id = :o"),
            {"o": org_id},
        )
        await session.execute(
            text("DELETE FROM forms WHERE organization_id = :o"), {"o": org_id}
        )
        await session.execute(
            text("DELETE FROM users WHERE organization_id = :o"), {"o": org_id}
        )
        await session.execute(
            text("DELETE FROM organizations WHERE id = :o"), {"o": org_id}
        )
        await session.commit()


@pytest.mark.integration
@pytest.mark.usefixtures("_initialize_database")
class TestConcurrentDuplicateSubmissionCheck:
    async def test_two_concurrent_submissions_from_the_same_member_never_both_succeed(
        self,
    ):
        """A form with ``allow_multiple_submissions=False`` locks the Form
        row before checking for a prior submission from the same member, but
        locking the parent row alone does not refresh a stale REPEATABLE READ
        snapshot (CLAUDE.md pitfall #27): each request's very first read is
        ``get_form_by_slug()``, so the duplicate-check query -- if it is a
        plain SELECT -- still answers from a snapshot taken before either
        request's insert committed. Two submissions arriving at the same
        moment could then both pass the check and both insert, defeating
        "one submission per member" entirely.

        Real committed rows, two independent sessions, and asyncio.gather --
        a mocked session cannot reproduce a real InnoDB/MariaDB snapshot
        staleness outcome. The invariant asserted is winner-agnostic: exactly
        one of the two concurrent submissions must succeed and the other
        must be rejected as a duplicate, regardless of which the database
        happens to serialize first.
        """
        org_id, user_id = str(uuid.uuid4()), str(uuid.uuid4())

        async with database_manager.session_factory() as setup:
            await _insert_org_and_member(setup, org_id, user_id, "")
            form = Form(
                organization_id=org_id,
                name="No Repeat Form",
                status=FormStatus.PUBLISHED,
                is_public=True,
                require_authentication=False,
                allow_multiple_submissions=False,
                public_slug=uuid.uuid4().hex[:12],
            )
            setup.add(form)
            await setup.commit()
            slug = form.public_slug

        session_a = database_manager.session_factory()
        session_b = database_manager.session_factory()
        try:
            # Pin both transactions' REPEATABLE READ snapshot *before* either
            # coroutine starts: a snapshot is fixed at a transaction's first
            # read, whichever statement that happens to be, so an innocuous
            # throwaway read here has the same effect as the real first read
            # inside submit_public_form(). asyncio.gather does not guarantee
            # that both attempts reach their own first read before either
            # commits -- without this, a scheduling quirk could let session
            # A run to completion before session B's snapshot is taken, in
            # which case B would see A's committed row and correctly reject
            # it, passing the assertion below without ever exercising the
            # staleness this test exists to catch.
            await session_a.execute(text("SELECT 1"))
            await session_b.execute(text("SELECT 1"))

            svc_a = FormsService(session_a)
            svc_b = FormsService(session_b)

            async def attempt(svc, session):
                result, error = await svc.submit_public_form(
                    slug=slug,
                    data={},
                    submitted_by=user_id,
                )
                await session.commit()
                return result, error

            outcome_a, outcome_b = await asyncio.gather(
                attempt(svc_a, session_a),
                attempt(svc_b, session_b),
                return_exceptions=True,
            )

            for label, outcome in (("A", outcome_a), ("B", outcome_b)):
                assert not isinstance(
                    outcome, BaseException
                ), f"attempt {label} raised {outcome!r} instead of completing"

            results = [outcome_a, outcome_b]
            successes = [r for r, e in results if r is not None]
            rejections = [e for r, e in results if r is None]

            assert len(successes) == 1, (
                f"expected exactly one submission to succeed, got "
                f"{len(successes)} -- the duplicate check let both through"
            )
            assert rejections == ["You have already submitted this form"]
        finally:
            await session_a.rollback()
            await session_b.rollback()
            await session_a.close()
            await session_b.close()
            await _cleanup_org(org_id)
