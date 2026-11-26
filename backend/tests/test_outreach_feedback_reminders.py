"""The one reminder to an outreach requester who has not sent feedback.

These pin which requests are reminded (completed between three and fourteen
days ago, no feedback yet, a form set, an address to send to), that each is
reminded once, and what a department's switch and a failed send do — against
real rows. Times are taken relative to the clock as each test runs, never at
import (pitfall #40).
"""

import copy
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select

from app.models.email_template import EmailTemplate, EmailTemplateType
from app.models.event_request import (
    EventRequest,
    EventRequestActivity,
    EventRequestFeedback,
    EventRequestStatus,
    generate_status_token,
)
from app.models.user import Organization, User, UserStatus
from app.services.email_service import EmailService
from app.services.outreach_feedback_reminder_service import (
    LOOKBACK_DAYS,
    REMINDER_DAYS,
    OutreachFeedbackReminderService,
)
from app.services.outreach_feedback_service import OutreachFeedbackService

pytestmark = pytest.mark.integration

TZ = "America/New_York"


async def _org(db_session, label="Remind", with_form=True):
    org = Organization(
        name=f"{label} FD", slug=f"{label.lower()}-{uuid.uuid4().hex[:10]}", timezone=TZ
    )
    db_session.add(org)
    await db_session.flush()
    if with_form:
        author = User(
            organization_id=org.id,
            username=f"author-{org.id[:8]}",
            email=f"author-{org.id[:8]}@example.test",
            first_name="Ada",
            last_name="Author",
            status=UserStatus.ACTIVE,
        )
        db_session.add(author)
        await db_session.flush()
        await OutreachFeedbackService(db_session).create_starter_form(
            org, str(author.id)
        )
    return org


@pytest.fixture
async def org(db_session):
    return await _org(db_session)


@pytest.fixture
def send_email():
    mock = AsyncMock(return_value=(1, 0))
    # One patch, entered once, outside any concurrent section (pitfall #22).
    with patch.object(EmailService, "send_email", mock):
        yield mock


async def _request(
    db_session, org, *, completed_days_ago=REMINDER_DAYS + 1, email="priya@x.test"
):
    req = EventRequest(
        organization_id=org.id,
        contact_name="Priya Natarajan",
        contact_email=email,
        organization_name="Willow Creek Preschool",
        outreach_type="station_tour",
        description="A station tour for the preschool",
        status=EventRequestStatus.COMPLETED,
        status_token=generate_status_token(),
        event_date=datetime.now(timezone.utc) - timedelta(days=completed_days_ago),
    )
    db_session.add(req)
    await db_session.flush()
    db_session.add(
        EventRequestActivity(
            request_id=req.id,
            action="status_change",
            old_status=EventRequestStatus.SCHEDULED.value,
            new_status=EventRequestStatus.COMPLETED.value,
            created_at=datetime.now(timezone.utc).replace(microsecond=0)
            - timedelta(days=completed_days_ago),
        )
    )
    await db_session.flush()
    return req


async def _run(db_session, org):
    return await OutreachFeedbackReminderService(db_session).send_reminders(org)


def _emailed(send_email):
    return [call.kwargs["to_emails"][0] for call in send_email.await_args_list]


class TestWhoIsReminded:
    async def test_a_requester_three_days_after_completion(
        self, db_session, org, send_email
    ):
        req = await _request(db_session, org)

        assert await _run(db_session, org) == 1

        call = send_email.await_args.kwargs
        assert call["to_emails"] == ["priya@x.test"]
        assert call["template_type"] == "outreach_feedback_reminder"
        assert call["subject"] == "How did the Station Tour go?"
        assert f"/event-request/status/{req.status_token}" in call["text_body"]
        assert "Willow Creek Preschool" in call["text_body"]
        await db_session.refresh(req)
        assert req.feedback_reminder_sent_at is not None

    async def test_not_before_three_days(self, db_session, org, send_email):
        await _request(db_session, org, completed_days_ago=REMINDER_DAYS - 1)

        assert await _run(db_session, org) == 0
        send_email.assert_not_awaited()

    async def test_not_once_the_lookback_has_passed(self, db_session, org, send_email):
        await _request(db_session, org, completed_days_ago=LOOKBACK_DAYS + 1)

        assert await _run(db_session, org) == 0
        send_email.assert_not_awaited()

    async def test_not_once_feedback_has_arrived(self, db_session, org, send_email):
        req = await _request(db_session, org)
        db_session.add(
            EventRequestFeedback(
                organization_id=org.id,
                request_id=req.id,
                rating=5,
                submitted_at=datetime.now(timezone.utc).replace(microsecond=0),
            )
        )
        await db_session.flush()

        assert await _run(db_session, org) == 0
        send_email.assert_not_awaited()

    async def test_not_without_a_feedback_form(self, db_session, send_email):
        bare = await _org(db_session, "Bare", with_form=False)
        await _request(db_session, bare)

        assert await _run(db_session, bare) == 0
        send_email.assert_not_awaited()

    async def test_not_once_the_form_is_unset(self, db_session, org, send_email):
        await _request(db_session, org)
        settings = copy.deepcopy(org.settings)
        settings["events"]["request_pipeline"]["feedback_form_id"] = None
        org.settings = settings
        await db_session.flush()

        assert await _run(db_session, org) == 0
        send_email.assert_not_awaited()

    async def test_not_without_an_address(self, db_session, org, send_email):
        await _request(db_session, org, email=None)

        assert await _run(db_session, org) == 0
        send_email.assert_not_awaited()

    async def test_only_the_departments_own_requests(self, db_session, org, send_email):
        other = await _org(db_session, "Other")
        await _request(db_session, other, email="elsewhere@x.test")
        await _request(db_session, org)

        await _run(db_session, org)

        assert _emailed(send_email) == ["priya@x.test"]


class TestOnce:
    async def test_a_second_run_sends_nothing(self, db_session, org, send_email):
        await _request(db_session, org)
        await _run(db_session, org)

        assert await _run(db_session, org) == 0
        assert send_email.await_count == 1

    async def test_a_switched_off_template_sends_and_stamps_nothing(
        self, db_session, org, send_email
    ):
        req = await _request(db_session, org)
        db_session.add(
            EmailTemplate(
                organization_id=org.id,
                template_type=EmailTemplateType.OUTREACH_FEEDBACK_REMINDER,
                name="Requester Feedback Reminder",
                subject="x",
                html_body="x",
                is_active=False,
            )
        )
        await db_session.flush()

        assert await _run(db_session, org) == 0

        send_email.assert_not_awaited()
        await db_session.refresh(req)
        assert req.feedback_reminder_sent_at is None

    async def test_a_failed_send_is_not_stamped_and_does_not_stop_the_next(
        self, db_session, org
    ):
        first = await _request(db_session, org, email="first@x.test")
        second = await _request(db_session, org, email="second@x.test")
        failing_address = min([first, second], key=lambda r: r.id).contact_email

        async def send(*, to_emails, **_kwargs):
            if to_emails == [failing_address]:
                raise RuntimeError("smtp down")
            return (1, 0)

        with patch.object(EmailService, "send_email", AsyncMock(side_effect=send)):
            assert await _run(db_session, org) == 1

        stamped = {
            r.contact_email: r.feedback_reminder_sent_at
            for r in (
                await db_session.execute(
                    select(EventRequest).where(
                        EventRequest.id.in_([first.id, second.id])
                    )
                )
            )
            .scalars()
            .all()
        }
        assert stamped[failing_address] is None
        assert sum(v is not None for v in stamped.values()) == 1
