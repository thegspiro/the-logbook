"""A scheduled email carries its template's copies, except a credential one.

The scheduled-email task merges the template's default CC, CC positions and
BCC itself (the template is the one the email was scheduled with), and tells
the send layer not to look them up again. A credential template (welcome,
password reset, ballot, applicant link) is never copied, scheduled or not:
only the addresses typed for that one email are kept. DB and services
mocked; no MySQL.
"""

from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models.email_template import (
    EmailTemplateType,
    ScheduledEmail,
    ScheduledEmailStatus,
)
from app.services.scheduled_tasks import _run_scheduled_emails_inner

pytestmark = pytest.mark.unit


def _item(template_type):
    email = ScheduledEmail(
        id="email-1",
        organization_id="org-1",
        template_id=None,
        template_type=template_type,
        to_emails=["member@example.org"],
        cc_emails=["typed@example.org"],
        bcc_emails=None,
        context={},
        scheduled_at=datetime.now(timezone.utc),
        status=ScheduledEmailStatus.PENDING,
    )
    email.organization = MagicMock(
        id="org-1", settings={"email_service": {"enabled": True}}
    )
    return email


def _result(**kwargs):
    result = MagicMock()
    for name, value in kwargs.items():
        getattr(result, name).return_value = value
    return result


async def _send(template_type):
    item = _item(template_type)
    rows = MagicMock()
    rows.scalars.return_value.all.return_value = [item]
    db = MagicMock()
    db.execute = AsyncMock(
        side_effect=[
            rows,
            _result(scalar_one_or_none=ScheduledEmailStatus.PENDING),
        ]
    )
    db.commit = AsyncMock()
    db.rollback = AsyncMock()

    template = MagicMock(
        template_type=template_type,
        default_cc=["secretary@example.org"],
        default_bcc=["records@example.org"],
        default_cc_position_ids=["pos-1"],
    )
    template_service = MagicMock()
    template_service.get_template = AsyncMock(return_value=template)
    template_service.render = MagicMock(return_value=("S", "<p>h</p>", "t"))
    template_service.position_holder_emails = AsyncMock(
        return_value=["holder@example.org"]
    )
    email_service = MagicMock()
    email_service.send_email = AsyncMock(return_value=(1, 0))

    with (
        patch(
            "app.services.email_template_service.EmailTemplateService",
            return_value=template_service,
        ),
        patch(
            "app.services.email_service.EmailService",
            return_value=email_service,
        ),
    ):
        await _run_scheduled_emails_inner(db)

    return email_service.send_email.await_args.kwargs


class TestScheduledCopies:
    async def test_an_ordinary_template_carries_every_copy(self):
        kwargs = await _send(EmailTemplateType.EVENT_REMINDER)

        assert sorted(kwargs["cc_emails"]) == [
            "holder@example.org",
            "secretary@example.org",
            "typed@example.org",
        ]
        assert kwargs["bcc_emails"] == ["records@example.org"]
        assert kwargs["apply_template_copies"] is False

    async def test_a_credential_template_keeps_only_the_typed_addresses(self):
        kwargs = await _send(EmailTemplateType.PASSWORD_RESET)

        assert kwargs["cc_emails"] == ["typed@example.org"]
        assert kwargs["bcc_emails"] is None
