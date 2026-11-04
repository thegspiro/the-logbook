"""
An interest-form applicant's record holds the plain text they typed.

``FormsService`` HTML-escapes every answer it stores, and the interest-form
mapping used to copy that escaped text straight onto the applicant, so
"O'Brien" became ``O&#x27;Brien`` on every pipeline screen (KNOWN_LIMITATIONS
"Prospective Members -- Follow-up Form Links"). The record now gets the
unescaped value; React escapes it when it renders. The stored submission
answers are unchanged. DB mocked; no MySQL.
"""

import html
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.services.forms_service import FormsService
from app.services.membership_pipeline_service import MembershipPipelineService

pytestmark = pytest.mark.unit


def _field(label, field_type="text"):
    return SimpleNamespace(id=str(uuid4()), label=label, field_type=field_type)


async def test_the_applicant_record_gets_the_text_the_applicant_typed():
    fields = [
        _field("First Name"),
        _field("Last Name"),
        _field("Email", "email"),
        _field("Why are you interested", "textarea"),
    ]
    typed = {
        "first_name": "O'Brien",
        "last_name": "Smith & Jones",
        "email": "o'brien@example.com",
        "interest_reason": 'I\'d like to "help" <now>',
    }
    # Exactly what FormsService stores for those answers.
    data = {
        fields[0].id: html.escape(typed["first_name"]),
        fields[1].id: html.escape(typed["last_name"]),
        fields[2].id: html.escape(typed["email"]),
        fields[3].id: html.escape(typed["interest_reason"]),
    }
    submission = SimpleNamespace(
        id=str(uuid4()), form_id=str(uuid4()), organization_id=str(uuid4()), data=data
    )
    form = SimpleNamespace(id=submission.form_id, fields=fields)

    no_existing = MagicMock()
    no_existing.scalars.return_value.first.return_value = None
    db = MagicMock()
    db.execute = AsyncMock(return_value=no_existing)

    captured = {}

    async def create_prospect(self, organization_id, data, created_by=None):
        captured.update(data)
        return SimpleNamespace(id=str(uuid4()), form_submission_id=submission.id)

    with (
        patch.object(
            FormsService, "_resolve_pipeline_for_form", AsyncMock(return_value=None)
        ),
        patch.object(FormsService, "_complete_form_submission_step", AsyncMock()),
        patch.object(MembershipPipelineService, "create_prospect", create_prospect),
    ):
        result = await FormsService(db)._process_membership_interest(
            submission, integration=None, form=form
        )

    assert result["success"] is True, result
    for key, value in typed.items():
        assert captured[key] == value
    # The submission keeps its escaped answers.
    assert submission.data[fields[0].id] == "O&#x27;Brien"
