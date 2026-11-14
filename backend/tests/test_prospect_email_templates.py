"""Applicant emails the pipeline used to build in code are now templates.

The step-completed notice and the status-page link email had fixed wording,
and the welcome email sent to a converted applicant never loaded the
department's Welcome template, so its edits and attachments were ignored.
"""

import uuid
from unittest.mock import AsyncMock, patch

import pytest

from app.models.email_template import (
    EmailAttachment,
    EmailTemplate,
    EmailTemplateType,
)
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


class TestWelcomeTemplateAttachments:
    """The welcome email renders through the shared path, which now also
    collects the template's stored attachments."""

    async def _send(self, db_session, tmp_path, monkeypatch, allow_attachments):
        from app.services import file_storage_service

        monkeypatch.setattr(file_storage_service, "UPLOADS_ROOT", str(tmp_path))
        org = await _org(db_session)
        template = await _template(
            db_session,
            str(org.id),
            EmailTemplateType.WELCOME,
            subject="Welcome aboard, {{first_name}}",
            allow_attachments=allow_attachments,
        )
        packet = tmp_path / str(org.id) / "email-attachments" / "tpl" / "p.pdf"
        packet.parent.mkdir(parents=True)
        packet.write_bytes(b"%PDF-1.4")
        db_session.add(
            EmailAttachment(
                template_id=str(template.id),
                filename="Welcome Packet.pdf",
                content_type="application/pdf",
                storage_path=str(packet),
            )
        )
        await db_session.flush()
        db_session.expire(template)

        sent = await _capture(
            lambda: EmailService(org).send_welcome_email(
                to_email="new@example.org",
                first_name="Pat",
                last_name="O'Brien",
                username="pobrien",
                temp_password="Temp-Pass-1",
                organization_name=org.name,
                login_url="https://fd.example/login",
                db=db_session,
                organization_id=str(org.id),
                attachment_paths=["/already/attached.pdf"],
            )
        )
        return sent, packet

    async def test_stored_attachments_ride_with_the_edited_template(
        self, db_session, tmp_path, monkeypatch
    ):
        sent, packet = await self._send(
            db_session, tmp_path, monkeypatch, allow_attachments=True
        )

        assert sent["subject"] == "Welcome aboard, Pat"
        assert sent["attachment_paths"] == [
            "/already/attached.pdf",
            (str(packet.resolve()), "Welcome Packet.pdf"),
        ]

    async def test_a_template_not_allowing_attachments_sends_none(
        self, db_session, tmp_path, monkeypatch
    ):
        sent, _packet = await self._send(
            db_session, tmp_path, monkeypatch, allow_attachments=False
        )

        assert sent["subject"] == "Welcome aboard, Pat"
        assert sent["attachment_paths"] == ["/already/attached.pdf"]


class TestInactivityWarnings:
    """The pipeline's two inactivity "Notify" boxes now send email: the
    coordinators get the Prospect Inactivity Warning, the applicant the
    Application Going Inactive notice, at the sweep's once-a-week cadence."""

    async def _stale(self, db_session, inactivity_config):
        from sqlalchemy import text

        org = await _org(db_session)
        svc = MembershipPipelineService(db_session)
        pipeline = await svc.create_pipeline(
            organization_id=str(org.id), name="Recruiting"
        )
        await svc.update_pipeline(
            pipeline.id, str(org.id), {"inactivity_config": inactivity_config}
        )
        await svc.add_step(pipeline.id, str(org.id), {"name": "Interview"})
        prospect = await svc.create_prospect(
            organization_id=str(org.id),
            data={
                "first_name": "Pat",
                "last_name": "Quiet",
                "email": f"{uuid.uuid4().hex[:10]}@example.com",
                "pipeline_id": pipeline.id,
            },
        )
        # 80 days quiet against a 90-day timeout: inside the 80% warning band.
        await db_session.execute(
            text(
                "UPDATE prospective_members SET "
                "created_at = created_at - INTERVAL 80 DAY, "
                "updated_at = updated_at - INTERVAL 80 DAY WHERE id = :id"
            ),
            {"id": prospect.id},
        )
        await db_session.commit()
        # The raw UPDATE bypasses the session, which still holds the row as
        # created; reload it so the sweep reads the aged dates.
        await db_session.refresh(prospect)
        return org, svc, prospect

    async def _sweep(self, svc, org):
        from types import SimpleNamespace

        coordinator = SimpleNamespace(
            id="coord-1",
            email="coordinator@example.test",
            first_name="Casey",
            preferred_name=None,
            notification_preferences=None,
        )
        send = AsyncMock(return_value=(1, 0))
        with (
            patch.object(EmailService, "send_email", send),
            patch.object(
                MembershipPipelineService,
                "_withdrawal_notice_recipients",
                AsyncMock(return_value=[coordinator]),
            ),
            # The bell copy is covered in test_officer_alert_copies; this
            # stand-in is not a row a notification could point at.
            patch("app.services.officer_alert_copies.add_in_app_copies", AsyncMock()),
        ):
            result = await svc.process_inactivity_warnings(str(org.id))
        return result, send

    async def test_by_default_only_the_coordinators_are_emailed(self, db_session):
        org, svc, _prospect = await self._stale(
            db_session, {"timeout_preset": "3_months"}
        )

        result, send = await self._sweep(svc, org)

        assert result["warnings_sent"] == 1
        assert [c.kwargs["to_emails"] for c in send.await_args_list] == [
            ["coordinator@example.test"]
        ]
        message = send.await_args.kwargs
        assert message["template_type"] == "inactivity_warning"
        assert message["subject"].startswith("Inactivity Alert: Pat Quiet")
        assert "Hello Casey" in message["html_body"]
        assert "Interview" in message["html_body"]

    async def test_the_applicant_box_emails_the_applicant(self, db_session):
        org, svc, prospect = await self._stale(
            db_session,
            {
                "timeout_preset": "3_months",
                "notify_coordinator": False,
                "notify_applicant": True,
            },
        )

        _result, send = await self._sweep(svc, org)

        assert [c.kwargs["to_emails"] for c in send.await_args_list] == [
            [prospect.email]
        ]
        message = send.await_args.kwargs
        assert message["template_type"] == "application_going_inactive"
        assert "Hi Pat," in message["text_body"]
        assert "has not moved in 80 days" in " ".join(message["text_body"].split())
        assert "marked inactive" in message["text_body"]

    async def test_switched_off_templates_send_nothing(self, db_session):
        org, svc, _prospect = await self._stale(
            db_session,
            {
                "timeout_preset": "3_months",
                "notify_coordinator": True,
                "notify_applicant": True,
            },
        )
        for template_type in (
            EmailTemplateType.INACTIVITY_WARNING,
            EmailTemplateType.APPLICATION_GOING_INACTIVE,
        ):
            await _template(db_session, str(org.id), template_type, is_active=False)

        result, send = await self._sweep(svc, org)

        # The activity entry is still the record; only the emails stop.
        assert result["warnings_sent"] == 1
        send.assert_not_awaited()

    async def test_a_second_run_within_the_week_sends_nothing_again(self, db_session):
        org, svc, _prospect = await self._stale(
            db_session, {"timeout_preset": "3_months"}
        )

        await self._sweep(svc, org)
        result, send = await self._sweep(svc, org)

        assert result["warnings_sent"] == 0
        send.assert_not_awaited()
