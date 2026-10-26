"""Applicant emails the pipeline used to build in code are now templates.

The step-completed notice and the status-page link email had fixed wording,
and the welcome email sent to a converted applicant never loaded the
department's Welcome template, so its edits and attachments were ignored.
"""

import uuid
from unittest.mock import AsyncMock, patch

import pytest

from app.models.email_template import EmailTemplate, EmailTemplateType
from app.models.membership_pipeline import (
    MembershipPipelineStep,
    ProspectiveMember,
    ProspectStatus,
)
from app.models.user import Organization
from app.services.email_service import EmailService
from app.services.membership_pipeline_service import MembershipPipelineService

pytestmark = pytest.mark.integration


async def _org(db_session):
    org = Organization(
        name="Oak & Ash FD",
        slug=f"prospect-templates-{uuid.uuid4().hex[:10]}",
        timezone="America/New_York",
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _template(db_session, org_id, template_type, **overrides):
    values = {
        "organization_id": org_id,
        "template_type": template_type,
        "name": "Edited",
        "subject": "Edited subject",
        "html_body": "<p>Edited</p>",
        "text_body": "Edited",
        "is_active": True,
    }
    values.update(overrides)
    template = EmailTemplate(**values)
    db_session.add(template)
    await db_session.flush()
    return template


async def _applicant(db_session, org_id, step_config=None):
    svc = MembershipPipelineService(db_session)
    pipeline = await svc.create_pipeline(organization_id=org_id, name="Recruiting")
    step = await svc.add_step(
        str(pipeline.id),
        org_id,
        {
            "name": "Interview <1>",
            "step_type": "checkbox",
            "config": step_config or {},
        },
    )
    prospect = ProspectiveMember(
        organization_id=org_id,
        pipeline_id=str(pipeline.id),
        current_step_id=str(step.id),
        first_name="Pat",
        last_name="O'Brien",
        email=f"{uuid.uuid4().hex[:10]}@example.com",
        status=ProspectStatus.ACTIVE,
        status_token="tok_123",
    )
    db_session.add(prospect)
    await db_session.flush()
    step = await db_session.get(MembershipPipelineStep, str(step.id))
    return svc, prospect, step


async def _capture(coro_factory):
    send = AsyncMock(return_value=(1, 0))
    with patch.object(EmailService, "send_email", send):
        sent = await coro_factory()
    assert sent is True
    return send.await_args.kwargs


class TestStepCompleted:
    async def test_default_wording_matches_what_was_hardcoded(self, db_session):
        org = await _org(db_session)
        svc, prospect, step = await _applicant(db_session, str(org.id))

        sent = await _capture(
            lambda: svc._send_step_completion_notification(prospect, step)
        )

        assert sent["subject"] == "Application Update — Interview <1> Complete"
        assert sent["template_type"] == "application_step_completed"
        assert "Hi Pat," in sent["html_body"]
        assert "<strong>Interview &lt;1&gt;</strong>" in sent["html_body"]
        assert (
            "The Interview <1> step of your membership application has been "
            "completed." in sent["text_body"]
        )

    async def test_the_departments_edited_template_is_sent(self, db_session):
        org = await _org(db_session)
        await _template(
            db_session,
            str(org.id),
            EmailTemplateType.APPLICATION_STEP_COMPLETED,
            subject="{{step_name}} done, {{first_name}}",
            html_body="<p>Well done, {{applicant_name}}.</p>",
        )
        svc, prospect, step = await _applicant(db_session, str(org.id))

        sent = await _capture(
            lambda: svc._send_step_completion_notification(prospect, step)
        )

        assert sent["subject"] == "Interview <1> done, Pat"
        assert "Well done, Pat O&#x27;Brien." in sent["html_body"]


class TestStatusLink:
    async def test_default_wording_carries_the_link_and_message(self, db_session):
        org = await _org(db_session)
        svc, prospect, step = await _applicant(
            db_session, str(org.id), {"custom_message": "Bring <ID>"}
        )

        with patch("app.core.config.settings.FRONTEND_URL", "https://fd.example"):
            sent = await _capture(
                lambda: svc._send_status_page_link_email(prospect, step)
            )

        link = "https://fd.example/application-status/tok_123"
        assert sent["subject"] == "Track Your Membership Application"
        assert sent["template_type"] == "application_status_link"
        assert link in sent["html_body"]
        assert link in sent["text_body"]
        assert "<p>Bring &lt;ID&gt;</p>" in sent["html_body"]
        assert "Hi Pat,\n\nBring <ID>\n\nYou can now follow" in sent["text_body"]

    async def test_no_message_leaves_no_empty_paragraph(self, db_session):
        org = await _org(db_session)
        svc, prospect, step = await _applicant(db_session, str(org.id))

        sent = await _capture(lambda: svc._send_status_page_link_email(prospect, step))

        assert "<p></p>" not in sent["html_body"]
        assert "Hi Pat,\n\nYou can now follow" in sent["text_body"]

    async def test_the_departments_edited_template_is_sent(self, db_session):
        org = await _org(db_session)
        await _template(
            db_session,
            str(org.id),
            EmailTemplateType.APPLICATION_STATUS_LINK,
            subject="Your tracker",
            html_body="<p>Follow along: {{status_url}}</p>{{custom_message_html}}",
        )
        svc, prospect, step = await _applicant(
            db_session, str(org.id), {"custom_message": "See you soon"}
        )

        sent = await _capture(lambda: svc._send_status_page_link_email(prospect, step))

        assert sent["subject"] == "Your tracker"
        assert "/application-status/tok_123</p><p>See you soon</p>" in (
            sent["html_body"]
        )


class TestConvertedApplicantWelcome:
    async def test_the_departments_welcome_template_is_sent(self, db_session):
        org = await _org(db_session)
        await _template(
            db_session,
            str(org.id),
            EmailTemplateType.WELCOME,
            subject="Welcome to the house, {{first_name}}",
            html_body="<p>Your username is {{username}}.</p>",
        )
        svc, prospect, _ = await _applicant(db_session, str(org.id))

        sent = await _capture(
            lambda: svc._send_transfer_welcome_email(
                prospect, "pobrien", "Temp-Pass-1", str(org.id)
            )
        )

        assert sent["subject"] == "Welcome to the house, Pat"
        assert "Your username is pobrien." in sent["html_body"]
