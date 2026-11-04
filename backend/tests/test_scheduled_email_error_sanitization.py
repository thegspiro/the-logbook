"""`ScheduledEmail.error_message` must never carry raw exception text.

`_run_scheduled_emails_inner`'s outer `except Exception as e:` handler wrote
`item.error_message = str(e)[:500]` directly — the unfiltered exception
message, merely truncated. `ScheduledEmailResponse` (the schema backing
`GET /email-templates/scheduled`) serializes `error_message` straight back to
the client. The route is gated behind `settings.manage` /
`organization.update_settings`, not open to every member, but CLAUDE.md's
`safe_error_detail()` pattern and this project's standing rule (exercised by
SEC13-1/SEC14-1 against `ExternalTrainingImport.import_error`, a column of the
identical shape) is that an already-authenticated, already-permitted caller
still must not receive raw driver/SQL/path text — only a sanitized message or
the caller's own safe `ValueError`/`PermissionError` text.

A duplicate-key `IntegrityError`, a transient driver error, or any other
exception bubbling out of `email_svc.send_email(...)` would otherwise persist
its full driver/SQL text onto the row and hand it back on the next list call.
"""

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest

from app.core.config import settings
from app.models.email_template import (
    EmailTemplate,
    EmailTemplateType,
    ScheduledEmail,
    ScheduledEmailStatus,
)
from app.models.user import Organization
from app.services import scheduled_tasks

pytestmark = [pytest.mark.integration]


async def _org(db):
    org = Organization(
        name="Scheduled Mail Error FD",
        slug=f"schedmail-err-{uuid.uuid4().hex[:8]}",
        active=True,
    )
    db.add(org)
    await db.flush()
    return org


async def _template(db, org):
    template = EmailTemplate(
        organization_id=org.id,
        template_type=EmailTemplateType.CUSTOM,
        name="Custom",
        subject="Subject",
        html_body="<p>Body</p>",
        is_active=True,
    )
    db.add(template)
    await db.flush()
    return template


async def _due_email(db, org):
    item = ScheduledEmail(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        template_type=EmailTemplateType.CUSTOM,
        to_emails=[f"{uuid.uuid4().hex[:8]}@example.test"],
        context={},
        scheduled_at=datetime.now(timezone.utc) - timedelta(minutes=5),
        status=ScheduledEmailStatus.PENDING,
    )
    db.add(item)
    await db.flush()
    return item


class TestScheduledEmailFailureDoesNotPersistRawExceptionText:
    async def test_a_send_failure_s_error_message_is_sanitized(
        self, db_session, monkeypatch
    ):
        monkeypatch.setattr(settings, "EMAIL_ENABLED", True)
        org = await _org(db_session)
        await _template(db_session, org)
        item = await _due_email(db_session, org)
        await db_session.commit()

        raw = (
            "(pymysql.err.IntegrityError) (1062, \"Duplicate entry 'x' for key "
            "'scheduled_emails.PRIMARY'\") [SQL: INSERT INTO scheduled_emails "
            "(id, organization_id) VALUES (%s, %s)] File "
            '"/app/services/email_service.py", line 412, in send_email'
        )

        with patch(
            "app.services.email_service.EmailService.send_email",
            new=AsyncMock(side_effect=RuntimeError(raw)),
        ):
            result = await scheduled_tasks._run_scheduled_emails_inner(db_session)

        assert result["failed"] == 1
        await db_session.refresh(item)
        assert item.status == ScheduledEmailStatus.FAILED

        msg = item.error_message or ""
        assert msg, "error_message was left empty rather than sanitized"
        for leak in ("pymysql", "IntegrityError", "INSERT INTO", "email_service.py"):
            assert leak not in msg, (
                f"raw exception text ({leak!r}) reached "
                "ScheduledEmail.error_message, which GET /email-templates/"
                "scheduled serializes straight back to the client"
            )
