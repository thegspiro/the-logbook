"""A template switched Off in Communications → Email Templates is not sent.

Until 2026-10 the switch only made a sender fall back to the built-in default,
so "Off" still mailed every recipient — the list even labelled it as a notice
"nobody sends". Five types carry something their recipient cannot get any
other way and cannot be switched off.
"""

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.models.email_template import (
    EmailTemplate,
    EmailTemplateType,
    ScheduledEmail,
    ScheduledEmailStatus,
)
from app.models.user import Organization
from app.services import scheduled_tasks
from app.services import storefront_notification_service as notify_module
from app.services.email_service import EmailService
from app.services.email_template_service import (
    ALWAYS_SENT_TYPES,
    EmailTemplateService,
)
from app.services.storefront_notification_service import (
    StorefrontNotificationService,
)


async def _org(db_session):
    org = Organization(
        name="Switch FD",
        slug=f"switch-{uuid.uuid4().hex[:10]}",
        timezone="America/New_York",
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _template(db_session, org_id, template_type, is_active):
    template = EmailTemplate(
        organization_id=org_id,
        template_type=template_type,
        name="Stored",
        subject="Stored subject",
        html_body="<p>Stored</p>",
        text_body="Stored",
        is_active=is_active,
    )
    db_session.add(template)
    await db_session.flush()
    return template


@pytest.mark.integration
class TestIsSwitchedOff:
    async def test_no_stored_row_is_not_off(self, db_session):
        org = await _org(db_session)

        assert not await EmailTemplateService(db_session).is_switched_off(
            str(org.id), EmailTemplateType.EVENT_REMINDER
        )

    async def test_an_inactive_row_is_off_and_an_active_one_is_not(self, db_session):
        org = await _org(db_session)
        await _template(
            db_session, str(org.id), EmailTemplateType.EVENT_REMINDER, False
        )
        await _template(db_session, str(org.id), EmailTemplateType.SHIFT_REMINDER, True)
        svc = EmailTemplateService(db_session)

        assert await svc.is_switched_off(str(org.id), EmailTemplateType.EVENT_REMINDER)
        assert not await svc.is_switched_off(
            str(org.id), EmailTemplateType.SHIFT_REMINDER
        )

    async def test_another_departments_switch_does_not_apply(self, db_session):
        org = await _org(db_session)
        other = await _org(db_session)
        await _template(
            db_session, str(other.id), EmailTemplateType.EVENT_REMINDER, False
        )

        assert not await EmailTemplateService(db_session).is_switched_off(
            str(org.id), EmailTemplateType.EVENT_REMINDER
        )

    @pytest.mark.parametrize("template_type", sorted(ALWAYS_SENT_TYPES))
    async def test_an_always_sent_type_is_never_off(self, db_session, template_type):
        org = await _org(db_session)
        await _template(db_session, str(org.id), template_type, False)

        assert not await EmailTemplateService(db_session).is_switched_off(
            str(org.id), template_type
        )

    async def test_custom_templates_are_not_switched_by_type(self, db_session):
        org = await _org(db_session)
        await _template(db_session, str(org.id), EmailTemplateType.CUSTOM, False)

        assert not await EmailTemplateService(db_session).is_switched_off(
            str(org.id), EmailTemplateType.CUSTOM
        )


@pytest.mark.integration
class TestTheSwitchCannotTurnOffAnEssentialEmail:
    @pytest.mark.parametrize("template_type", sorted(ALWAYS_SENT_TYPES))
    async def test_switching_an_essential_email_off_is_refused(
        self, db_session, template_type
    ):
        org = await _org(db_session)
        template = await _template(db_session, str(org.id), template_type, True)

        with pytest.raises(ValueError, match="cannot be switched off"):
            await EmailTemplateService(db_session).update_template(
                str(template.id), str(org.id), is_active=False
            )

    async def test_any_other_email_can_be_switched_off(self, db_session):
        org = await _org(db_session)
        template = await _template(
            db_session, str(org.id), EmailTemplateType.EVENT_REMINDER, True
        )

        updated = await EmailTemplateService(db_session).update_template(
            str(template.id), str(org.id), is_active=False
        )

        assert updated is not None
        assert updated.is_active is False


@pytest.mark.integration
class TestEmailServiceSenders:
    async def _withdrawn(self, db_session, org):
        send = AsyncMock(return_value=(1, 0))
        with patch.object(EmailService, "send_email", send):
            sent = await EmailService(org).send_application_withdrawn_email(
                to_email="pat@example.test",
                applicant_name="Pat Doe",
                organization_name=org.name,
                withdrawal_date="October 27, 2026",
                db=db_session,
                organization_id=str(org.id),
            )
        return sent, send

    async def test_a_switched_off_template_sends_nothing(self, db_session):
        org = await _org(db_session)
        await _template(
            db_session, str(org.id), EmailTemplateType.APPLICATION_WITHDRAWN, False
        )

        sent, send = await self._withdrawn(db_session, org)

        assert sent is False
        send.assert_not_awaited()

    async def test_a_department_that_never_opened_the_screen_still_sends(
        self, db_session
    ):
        org = await _org(db_session)

        sent, send = await self._withdrawn(db_session, org)

        assert sent is True
        send.assert_awaited_once()

    async def test_a_count_returning_sender_reports_every_recipient_unsent(
        self, db_session
    ):
        org = await _org(db_session)
        await _template(
            db_session, str(org.id), EmailTemplateType.ELECTION_REPORT, False
        )
        send = AsyncMock(return_value=(2, 0))

        with patch.object(EmailService, "send_email", send):
            result = await EmailService(org).send_election_report(
                to_emails=["a@example.test", "b@example.test"],
                recipient_name="Officers",
                election_title="Chief 2027",
                election_type="general",
                start_date="October 1, 2026",
                end_date="October 2, 2026",
                total_eligible_voters=10,
                total_votes_cast=8,
                voter_turnout_percentage=80.0,
                quorum_status="Met",
                quorum_detail="",
                results_html="",
                results_text="",
                ballot_recipients_html="",
                ballot_recipients_text="",
                skipped_voters_html="",
                skipped_voters_text="",
                db=db_session,
                organization_id=str(org.id),
            )

        assert result == (0, 2)
        send.assert_not_awaited()


@pytest.mark.integration
class TestScheduledEmails:
    async def _due(self, db_session, org, template_type, template_id=None):
        item = ScheduledEmail(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            template_type=template_type,
            template_id=template_id,
            to_emails=["pat@example.test"],
            context={},
            scheduled_at=datetime.now(timezone.utc) - timedelta(minutes=5),
            status=ScheduledEmailStatus.PENDING,
        )
        db_session.add(item)
        await db_session.flush()
        return item

    async def test_a_switched_off_type_is_cancelled_not_failed(self, db_session):
        org = await _org(db_session)
        await _template(
            db_session, str(org.id), EmailTemplateType.EVENT_REMINDER, False
        )
        item = await self._due(db_session, org, EmailTemplateType.EVENT_REMINDER)
        await db_session.commit()

        send = AsyncMock(return_value=(1, 0))
        with patch.object(EmailService, "send_email", send):
            await scheduled_tasks._run_scheduled_emails_inner(db_session)

        await db_session.refresh(item)
        assert item.status == ScheduledEmailStatus.CANCELLED
        assert item.error_message == "Not sent: the template is switched off"
        send.assert_not_awaited()

    async def test_a_switched_off_template_named_by_id_is_cancelled(self, db_session):
        org = await _org(db_session)
        template = await _template(
            db_session, str(org.id), EmailTemplateType.CUSTOM, False
        )
        item = await self._due(
            db_session, org, EmailTemplateType.CUSTOM, str(template.id)
        )
        await db_session.commit()

        send = AsyncMock(return_value=(1, 0))
        with patch.object(EmailService, "send_email", send):
            await scheduled_tasks._run_scheduled_emails_inner(db_session)

        await db_session.refresh(item)
        assert item.status == ScheduledEmailStatus.CANCELLED
        send.assert_not_awaited()


@pytest.mark.integration
class TestStorefrontNotices:
    async def test_a_switched_off_notice_is_not_sent(self, db_session, monkeypatch):
        org = await _org(db_session)
        await _template(
            db_session,
            str(org.id),
            EmailTemplateType.STOREFRONT_ORDER_CONFIRMATION,
            False,
        )
        sends = []

        class Recorder:
            def __init__(self, *_args, **_kwargs):
                pass

            async def send_email(self, **kwargs):
                sends.append(kwargs)
                return 1, 0

        monkeypatch.setattr(notify_module, "EmailService", Recorder)

        count = await StorefrontNotificationService(db_session)._send(
            org,
            ["buyer@example.test"],
            "Order confirmed",
            "Order confirmed",
            "<p>Thanks</p>",
            "Thanks",
            EmailTemplateType.STOREFRONT_ORDER_CONFIRMATION.value,
        )

        assert count == 0
        assert sends == []


@pytest.mark.unit
class TestTheAlwaysSentSet:
    def test_it_names_the_emails_a_recipient_cannot_get_otherwise(self):
        assert ALWAYS_SENT_TYPES == {
            EmailTemplateType.PASSWORD_RESET,
            EmailTemplateType.IT_PASSWORD_NOTIFICATION,
            EmailTemplateType.WELCOME,
            EmailTemplateType.BALLOT_NOTIFICATION,
            EmailTemplateType.APPLICATION_STATUS_LINK,
        }

    async def test_an_always_sent_type_answers_without_reading_the_database(self):
        # A session with no execute() at all: reaching the query would raise.
        svc = EmailTemplateService(SimpleNamespace())

        assert not await svc.is_switched_off("org", EmailTemplateType.PASSWORD_RESET)


@pytest.mark.integration
class TestSchedulingNotices:
    @pytest.mark.parametrize("switched_off", [False, True])
    async def test_a_switched_off_shift_notice_keeps_only_the_in_app_entry(
        self, db_session, switched_off
    ):
        from sqlalchemy import select, text

        from app.models.notification import NotificationLog
        from app.services.email_policy import EmailKind
        from app.services.scheduling_service import SchedulingService

        org = await _org(db_session)
        user_id = str(uuid.uuid4())
        await db_session.execute(
            text(
                "INSERT INTO users (id, organization_id, username, first_name, "
                "last_name, email, password_hash, status) VALUES "
                "(:id, :org, :un, 'Pat', 'Doe', :em, 'pw', 'active')"
            ),
            {
                "id": user_id,
                "org": str(org.id),
                "un": f"u-{user_id[:8]}",
                "em": f"u-{user_id[:8]}@example.test",
            },
        )
        if switched_off:
            await _template(
                db_session, str(org.id), EmailTemplateType.SHIFT_ASSIGNMENT, False
            )

        send = AsyncMock(return_value=(1, 0))
        with patch.object(EmailService, "send_email", send):
            await SchedulingService(db_session)._send_notification(
                recipient_ids={user_id},
                subject="Assigned",
                message="You were assigned",
                category="shift_assignment",
                organization_id=str(org.id),
                send_email=True,
                email_template=EmailTemplateType.SHIFT_ASSIGNMENT,
                email_context={"recipient_name": "Pat"},
                email_defaults=("Subject", "<p>Body</p>", "Body"),
                org=org,
                email_kind=EmailKind.SHIFT_NOTICES,
            )

        assert send.await_count == (0 if switched_off else 1)
        logged = (
            (
                await db_session.execute(
                    select(NotificationLog).where(
                        NotificationLog.organization_id == str(org.id)
                    )
                )
            )
            .scalars()
            .all()
        )
        assert [n.recipient_id for n in logged] == [user_id]
