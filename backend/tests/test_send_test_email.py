"""A template's test send is sent the way the real notice is.

The test send rendered the template but never attached its files, so a
department checking its welcome email with a handbook attached saw a message
without one and could not tell whether the attachment would arrive.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.api.v1.endpoints.message_history import send_test_email
from app.models.email_template import EmailTemplateType
from app.schemas.email_template import SendTestEmailRequest

pytestmark = pytest.mark.unit


def _result(value):
    result = MagicMock()
    result.scalar_one_or_none.return_value = value
    return result


def _template(allow_attachments, attachments):
    return SimpleNamespace(
        id="tpl-1",
        template_type=EmailTemplateType.WELCOME,
        allow_attachments=allow_attachments,
        attachments=attachments,
    )


async def _send(template):
    org = SimpleNamespace(id="org-1", name="Station 12")
    history = SimpleNamespace(id="hist-1")
    db = MagicMock()
    db.execute = AsyncMock(
        side_effect=[_result(org), _result(template), _result(history)]
    )
    db.commit = AsyncMock()

    email_service = MagicMock()
    email_service.send_email = AsyncMock(return_value=(1, 0))
    email_service.last_message_history_id = "hist-1"

    user = SimpleNamespace(
        organization_id="org-1", id="user-1", email="chief@station12.org"
    )
    with (
        patch(
            "app.api.v1.endpoints.message_history.EmailService",
            return_value=email_service,
        ),
        patch(
            "app.api.v1.endpoints.message_history.OfficerService.overlay_preview_context",
            new=AsyncMock(),
        ),
        patch(
            "app.services.email_template_service.EmailTemplateService.render",
            return_value=("Welcome", "<p>Welcome</p>", "Welcome"),
        ),
    ):
        await send_test_email(
            SendTestEmailRequest(template_id="tpl-1"), db=db, current_user=user
        )
    return email_service.send_email.await_args.kwargs


async def test_the_templates_attachments_ride_along():
    kwargs = await _send(
        _template(
            True,
            [
                SimpleNamespace(storage_path="/data/attachments/handbook.pdf"),
                SimpleNamespace(storage_path="/data/attachments/sop.pdf"),
            ],
        )
    )
    assert kwargs["attachment_paths"] == [
        "/data/attachments/handbook.pdf",
        "/data/attachments/sop.pdf",
    ]
    assert kwargs["subject"] == "[TEST] Welcome"


async def test_files_on_a_template_with_attachments_switched_off_are_not_sent():
    """The real send ignores them in that case, so the test does too."""
    kwargs = await _send(
        _template(False, [SimpleNamespace(storage_path="/data/attachments/a.pdf")])
    )
    assert kwargs["attachment_paths"] is None


async def test_a_template_without_attachments_sends_none():
    kwargs = await _send(_template(True, []))
    assert kwargs["attachment_paths"] is None
