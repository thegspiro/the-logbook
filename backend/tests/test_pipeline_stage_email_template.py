"""An automated-email stage's linked email template.

A stage could store ``email_template_id`` and nothing read it: the email was
always built from the stage's own sections. A linked custom template is now
the email, with the stage's enabled sections following its body, and a link
that can no longer be honoured falls back to the sections alone.
"""

import uuid
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select

from app.models.email_template import EmailTemplate, EmailTemplateType
from app.models.membership_pipeline import (
    MembershipPipelineStep,
    ProspectActivityLog,
    ProspectiveMember,
    ProspectStatus,
)
from app.models.user import Organization
from app.services.email_service import EmailService
from app.services.email_template_service import (
    _APPENDIX_HTML_VAR,
    _CARD_TAIL,
    _FOOTER_HTML_TOKEN,
    _insert_appendix_token,
)
from app.services.membership_pipeline_service import MembershipPipelineService

SECTIONS_CONFIG = {
    "email_subject": "Stage subject",
    "include_welcome": True,
    "welcome_message": "Welcome from the stage",
    "custom_sections": [
        {
            "id": "c1",
            "enabled": True,
            "title": "Bring",
            "content": "Boots and {{first_name}}",
        }
    ],
}


async def _org(db_session):
    org = Organization(
        name="Template VFD",
        slug=f"stage-template-{uuid.uuid4().hex[:10]}",
        timezone="America/New_York",
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _template(db_session, org_id, **overrides):
    values = {
        "organization_id": org_id,
        "template_type": EmailTemplateType.CUSTOM,
        "name": "Applicant welcome",
        "subject": "Welcome, {{first_name}}",
        "html_body": "<p>Dear {{prospect_name}}, you reached {{stage_name}}.</p>",
        "text_body": "Dear {{prospect_name}}, you reached {{stage_name}}.",
        "is_active": True,
    }
    values.update(overrides)
    template = EmailTemplate(**values)
    db_session.add(template)
    await db_session.flush()
    return template


async def _stage(db_session, org_id, email_template_id=None):
    svc = MembershipPipelineService(db_session)
    pipeline = await svc.create_pipeline(organization_id=org_id, name="Recruiting")
    data = {
        "name": "Welcome Email",
        "step_type": "automated_email",
        "required": False,
        "config": SECTIONS_CONFIG,
    }
    if email_template_id is not None:
        data["email_template_id"] = email_template_id
    step = await svc.add_step(str(pipeline.id), org_id, data)
    return svc, pipeline, step


async def _send(db_session, svc, pipeline, step, org_id):
    """Run the stage email for a fresh applicant; return (kwargs, prospect id)."""
    prospect = ProspectiveMember(
        organization_id=org_id,
        pipeline_id=str(pipeline.id),
        current_step_id=str(step.id),
        first_name="Pat",
        last_name="O'Brien",
        email=f"{uuid.uuid4().hex[:10]}@example.com",
        status=ProspectStatus.ACTIVE,
    )
    db_session.add(prospect)
    await db_session.flush()
    step = (
        await db_session.execute(
            select(MembershipPipelineStep).where(
                MembershipPipelineStep.id == str(step.id)
            )
        )
    ).scalar_one()

    send = AsyncMock(return_value=(1, 0))
    with patch.object(EmailService, "send_email", send):
        sent = await svc._send_stage_email(prospect, step)
    assert sent is True
    return send.await_args.kwargs, str(prospect.id)


async def _activity(db_session, prospect_id, action):
    return (
        (
            await db_session.execute(
                select(ProspectActivityLog).where(
                    ProspectActivityLog.prospect_id == prospect_id,
                    ProspectActivityLog.action == action,
                )
            )
        )
        .scalars()
        .all()
    )


@pytest.mark.integration
class TestLinkedTemplateIsTheEmail:
    async def test_template_body_comes_first_and_sections_follow(self, db_session):
        org = await _org(db_session)
        org_id = str(org.id)
        template = await _template(db_session, org_id)
        svc, pipeline, step = await _stage(db_session, org_id, str(template.id))

        sent, _ = await _send(db_session, svc, pipeline, step, org_id)

        assert sent["subject"] == "Welcome, Pat"
        html = sent["html_body"]
        assert "Dear Pat O&#x27;Brien, you reached Welcome Email." in html
        assert "Welcome from the stage" in html
        assert html.index("you reached Welcome Email") < html.index(
            "Welcome from the stage"
        )
        # The stage's own greeting and subject belong to the section-built
        # email only.
        assert "Hi Pat," not in html
        assert "Stage subject" not in html

        text = sent["text_body"]
        assert text.startswith("Dear Pat O'Brien, you reached Welcome Email.")
        assert "Welcome from the stage" in text
        assert "Bring\nBoots and" in text

    async def test_section_text_is_not_expanded_as_template_variables(self, db_session):
        org = await _org(db_session)
        org_id = str(org.id)
        template = await _template(db_session, org_id)
        svc, pipeline, step = await _stage(db_session, org_id, str(template.id))

        sent, _ = await _send(db_session, svc, pipeline, step, org_id)

        assert "Boots and {{first_name}}" in sent["html_body"]
        assert "Boots and {{first_name}}" in sent["text_body"]

    async def test_sections_sit_ahead_of_the_footer(self, db_session):
        org = await _org(db_session)
        org_id = str(org.id)
        template = await _template(
            db_session,
            org_id,
            html_body="<p>Body</p>\n{{footer_html}}<p>After footer</p>",
        )
        svc, pipeline, step = await _stage(db_session, org_id, str(template.id))

        sent, _ = await _send(db_session, svc, pipeline, step, org_id)

        html = sent["html_body"]
        assert (
            html.index("<p>Body</p>")
            < html.index("Welcome from the stage")
            < html.index("After footer")
        )

    async def test_template_without_text_body_is_sent_html_only(self, db_session):
        org = await _org(db_session)
        org_id = str(org.id)
        template = await _template(db_session, org_id, text_body=None)
        svc, pipeline, step = await _stage(db_session, org_id, str(template.id))

        sent, _ = await _send(db_session, svc, pipeline, step, org_id)

        assert sent["text_body"] is None
        assert "Welcome from the stage" in sent["html_body"]


@pytest.mark.integration
class TestUnusableLinkFallsBackToSections:
    async def test_switched_off_template_sends_the_sections(self, db_session):
        org = await _org(db_session)
        org_id = str(org.id)
        template = await _template(db_session, org_id, is_active=False)
        svc, pipeline, step = await _stage(db_session, org_id, str(template.id))

        sent, prospect_id = await _send(db_session, svc, pipeline, step, org_id)

        assert sent["subject"] == "Stage subject"
        assert "Hi Pat," in sent["html_body"]
        assert "you reached" not in sent["html_body"]
        logged = await _activity(
            db_session, prospect_id, "stage_email_template_unavailable"
        )
        assert [entry.details["reason"] for entry in logged] == ["inactive"]

    async def test_a_system_template_written_before_the_check_is_not_sent(
        self, db_session
    ):
        org = await _org(db_session)
        org_id = str(org.id)
        system = await _template(
            db_session, org_id, template_type=EmailTemplateType.PASSWORD_RESET
        )
        svc, pipeline, step = await _stage(db_session, org_id)
        # The write path refuses this link now; a row stored before it did
        # must still not mail a password-reset body to an applicant.
        stored = await db_session.get(MembershipPipelineStep, str(step.id))
        stored.email_template_id = str(system.id)
        await db_session.flush()

        sent, prospect_id = await _send(db_session, svc, pipeline, step, org_id)

        assert sent["subject"] == "Stage subject"
        logged = await _activity(
            db_session, prospect_id, "stage_email_template_unavailable"
        )
        assert [entry.details["reason"] for entry in logged] == ["not_custom"]

    async def test_no_link_records_nothing(self, db_session):
        org = await _org(db_session)
        org_id = str(org.id)
        svc, pipeline, step = await _stage(db_session, org_id)

        sent, prospect_id = await _send(db_session, svc, pipeline, step, org_id)

        assert sent["subject"] == "Stage subject"
        assert (
            await _activity(db_session, prospect_id, "stage_email_template_unavailable")
            == []
        )


@pytest.mark.integration
class TestOnlyCustomTemplatesCanBeLinked:
    async def test_add_step_refuses_a_system_template(self, db_session):
        org = await _org(db_session)
        org_id = str(org.id)
        system = await _template(
            db_session, org_id, template_type=EmailTemplateType.WELCOME
        )
        with pytest.raises(ValueError, match="custom email template"):
            await _stage(db_session, org_id, str(system.id))

    async def test_update_step_accepts_a_custom_template_and_can_clear_it(
        self, db_session
    ):
        org = await _org(db_session)
        org_id = str(org.id)
        template = await _template(db_session, org_id)
        svc, pipeline, step = await _stage(db_session, org_id)

        # The endpoint hands the service a UUID, as Pydantic parsed it.
        updated = await svc.update_step(
            str(step.id),
            str(pipeline.id),
            org_id,
            {"email_template_id": uuid.UUID(str(template.id))},
        )
        assert str(updated.email_template_id) == str(template.id)

        cleared = await svc.update_step(
            str(step.id), str(pipeline.id), org_id, {"email_template_id": None}
        )
        assert cleared.email_template_id is None


@pytest.mark.unit
class TestAppendixPlacement:
    def test_before_the_footer_token(self):
        body = "<p>Body</p>{{ footer_html }}<p>Tail</p>"
        placed = _insert_appendix_token(
            body, _APPENDIX_HTML_VAR, _FOOTER_HTML_TOKEN, _CARD_TAIL
        )
        assert placed == (
            "<p>Body</p>{{" + _APPENDIX_HTML_VAR + "}}\n{{ footer_html }}<p>Tail</p>"
        )

    def test_inside_the_card_when_there_is_no_footer_token(self):
        body = '<div class="card"><p>Body</p>\n</div>'
        placed = _insert_appendix_token(
            body, _APPENDIX_HTML_VAR, _FOOTER_HTML_TOKEN, _CARD_TAIL
        )
        assert placed.endswith("{{" + _APPENDIX_HTML_VAR + "}}\n</div>")

    def test_at_the_end_otherwise(self):
        placed = _insert_appendix_token(
            "Plain text  ", _APPENDIX_HTML_VAR, _FOOTER_HTML_TOKEN, None
        )
        assert placed == "Plain text\n{{" + _APPENDIX_HTML_VAR + "}}"
