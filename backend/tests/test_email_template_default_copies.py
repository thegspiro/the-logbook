"""A template's default CC and BCC reach every email sent with it (defect D1).

The Email Templates editor says its CC addresses "will be CC'd on every email
sent with this template". Until 2026-11 only the scheduled-email task read
them; every immediate send dropped them, so a department that put its
Secretary on a notice never copied them on one.

They now reach every send that names its template type, except the
credential-carrying templates: a CC'd password reset, temporary password,
ballot link or applicant link hands the credential to someone else.
"""

import uuid
from datetime import datetime, timezone
from typing import List
from unittest.mock import patch

import pytest

from app.models.email_template import EmailTemplate, EmailTemplateType
from app.models.user import Organization, Position, User, UserStatus
from app.services.email_service import EmailService
from app.services.email_template_service import (
    ALWAYS_SENT_TYPES,
    NO_TEMPLATE_COPY_TYPES,
    template_copies_apply,
)

_SMTP = {
    "enabled": True,
    "platform": "selfhosted",
    "smtp_host": "mail.dept.example",
    "from_email": "noreply@dept.example",
    "smtp_user": "noreply@dept.example",
    "smtp_password": "secret",
}


async def _org(db_session) -> Organization:
    org = Organization(
        name="Copies FD",
        slug=f"copies-{uuid.uuid4().hex[:10]}",
        timezone="America/New_York",
        settings={"email_service": _SMTP},
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _template(db_session, org, template_type, **fields) -> EmailTemplate:
    template = EmailTemplate(
        organization_id=str(org.id),
        template_type=template_type,
        name="Stored",
        subject="Stored subject",
        html_body="<p>Stored</p>",
        text_body="Stored",
        is_active=True,
        **fields,
    )
    db_session.add(template)
    await db_session.flush()
    return template


class _Transport:
    """Captures each message's envelope recipients and headers."""

    def __init__(self) -> None:
        self.sent: List[List[str]] = []
        self.mime: List[str] = []

    def __call__(self, recipients, message) -> None:
        self.sent.append(list(recipients))
        self.mime.append(message)


async def _cancel(svc: EmailService, db_session, org) -> None:
    await svc.send_event_cancellation_email(
        to_email="member@dept.example",
        recipient_name="Alex Member",
        event_title="Pump drill",
        event_start=datetime(2026, 11, 20, 19, 0, tzinfo=timezone.utc),
        reason="Weather",
        db=db_session,
        organization_id=str(org.id),
    )


@pytest.mark.integration
class TestImmediateSendsCarryTheTemplatesCopies:
    async def test_default_cc_and_bcc_reach_an_immediate_send(self, db_session):
        org = await _org(db_session)
        await _template(
            db_session,
            org,
            EmailTemplateType.EVENT_CANCELLATION,
            default_cc=["secretary@dept.example"],
            default_bcc=["records@dept.example"],
        )
        transport = _Transport()
        with patch.object(EmailService, "_smtp_send", transport):
            await _cancel(EmailService(org), db_session, org)

        assert transport.sent == [
            [
                "member@dept.example",
                "secretary@dept.example",
                "records@dept.example",
            ]
        ]
        assert "Cc: secretary@dept.example" in transport.mime[0]
        # BCC is an envelope recipient only, never a header.
        assert "records@dept.example" not in transport.mime[0]

    async def test_position_holders_are_copied(self, db_session):
        org = await _org(db_session)
        secretary = Position(
            organization_id=str(org.id), name="Secretary", slug="secretary"
        )
        db_session.add(secretary)
        holder = User(
            organization_id=str(org.id),
            username=f"sec-{uuid.uuid4().hex[:8]}",
            email="pat.secretary@dept.example",
            first_name="Pat",
            last_name="Secretary",
            status=UserStatus.ACTIVE,
        )
        holder.positions = [secretary]
        db_session.add(holder)
        await db_session.flush()
        await _template(
            db_session,
            org,
            EmailTemplateType.EVENT_CANCELLATION,
            default_cc_position_ids=[str(secretary.id)],
        )
        transport = _Transport()
        with patch.object(EmailService, "_smtp_send", transport):
            await _cancel(EmailService(org), db_session, org)

        assert transport.sent == [["member@dept.example", "pat.secretary@dept.example"]]

    async def test_a_recipient_is_not_copied_on_their_own_email(self, db_session):
        org = await _org(db_session)
        await _template(
            db_session,
            org,
            EmailTemplateType.EVENT_CANCELLATION,
            default_cc=["MEMBER@dept.example", "secretary@dept.example"],
        )
        transport = _Transport()
        with patch.object(EmailService, "_smtp_send", transport):
            await _cancel(EmailService(org), db_session, org)

        assert transport.sent == [["member@dept.example", "secretary@dept.example"]]

    async def test_another_departments_template_is_not_read(self, db_session):
        org = await _org(db_session)
        other = await _org(db_session)
        await _template(
            db_session,
            other,
            EmailTemplateType.EVENT_CANCELLATION,
            default_cc=["elsewhere@other.example"],
        )
        transport = _Transport()
        with patch.object(EmailService, "_smtp_send", transport):
            await _cancel(EmailService(org), db_session, org)

        assert transport.sent == [["member@dept.example"]]

    async def test_a_caller_can_opt_out(self, db_session):
        """Test sends go to the admin who asked for one, and nobody else."""
        org = await _org(db_session)
        await _template(
            db_session,
            org,
            EmailTemplateType.EVENT_CANCELLATION,
            default_cc=["secretary@dept.example"],
        )
        transport = _Transport()
        with patch.object(EmailService, "_smtp_send", transport):
            await EmailService(org).send_email(
                to_emails=["admin@dept.example"],
                subject="[TEST] x",
                html_body="<p>x</p>",
                db=db_session,
                template_type=EmailTemplateType.EVENT_CANCELLATION.value,
                apply_template_copies=False,
            )

        assert transport.sent == [["admin@dept.example"]]


@pytest.mark.integration
class TestCredentialTemplatesAreNeverCopied:
    async def test_a_password_reset_is_not_copied(self, db_session):
        org = await _org(db_session)
        await _template(
            db_session,
            org,
            EmailTemplateType.PASSWORD_RESET,
            default_cc=["secretary@dept.example"],
            default_bcc=["records@dept.example"],
        )
        transport = _Transport()
        with patch.object(EmailService, "_smtp_send", transport):
            await EmailService(org).send_password_reset_email(
                to_email="member@dept.example",
                first_name="Alex",
                reset_url="https://logbook.dept.example/reset?t=secret-token",
                organization_name="Copies FD",
                db=db_session,
                organization_id=str(org.id),
            )

        assert transport.sent == [["member@dept.example"]]

    @pytest.mark.parametrize("template_type", sorted(NO_TEMPLATE_COPY_TYPES))
    async def test_no_excluded_type_is_copied_at_the_send_layer(
        self, db_session, template_type
    ):
        org = await _org(db_session)
        await _template(
            db_session, org, template_type, default_cc=["secretary@dept.example"]
        )
        transport = _Transport()
        with patch.object(EmailService, "_smtp_send", transport):
            await EmailService(org).send_email(
                to_emails=["member@dept.example"],
                subject="x",
                html_body="<p>x</p>",
                db=db_session,
                template_type=template_type.value,
            )

        assert transport.sent == [["member@dept.example"]]


@pytest.mark.unit
class TestWhichTemplatesAreExcluded:
    def test_every_credential_template_is_excluded(self):
        assert ALWAYS_SENT_TYPES <= NO_TEMPLATE_COPY_TYPES

    @pytest.mark.parametrize(
        "template_type",
        [
            EmailTemplateType.PASSWORD_RESET,
            EmailTemplateType.IT_PASSWORD_NOTIFICATION,
            EmailTemplateType.WELCOME,
            EmailTemplateType.BALLOT_NOTIFICATION,
            "password_reset",
        ],
    )
    def test_sign_in_and_password_templates_take_no_copies(self, template_type):
        assert not template_copies_apply(template_type)

    @pytest.mark.parametrize(
        "template_type",
        [EmailTemplateType.EVENT_CANCELLATION, "event_reminder", "shift_reminder"],
    )
    def test_an_ordinary_notice_takes_copies(self, template_type):
        assert template_copies_apply(template_type)

    @pytest.mark.parametrize(
        "template_type", [None, "", "custom", "department_message", "security"]
    )
    def test_a_type_with_no_single_template_takes_none(self, template_type):
        assert not template_copies_apply(template_type)
