"""
Unit tests for pure helpers in the forms service
(app/services/forms_service.py). DB-free.

Focus: FORM-6 — a required field is satisfied only by a non-empty value, not
merely by the key being present.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.forms import IntegrationType
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
