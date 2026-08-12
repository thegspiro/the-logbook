"""
Unit tests for pure helpers in the forms service
(app/services/forms_service.py). DB-free.

Focus: FORM-6 — a required field is satisfied only by a non-empty value, not
merely by the key being present.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

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
