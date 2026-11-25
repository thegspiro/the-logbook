"""Telling the officer handling an outreach request that its requester answered.

These pin who is told (coordinator, then the default coordinator, then the
department's event managers), that a low rating is flagged, that the bell
lands with the response and the email never fails the requester's submit,
and that one response sends one notice — against real rows.
"""

import copy
import json
import uuid
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select, text

from app.models.email_template import EmailTemplate, EmailTemplateType
from app.models.event_request import (
    EventRequest,
    EventRequestFeedback,
    EventRequestStatus,
    generate_status_token,
)
from app.models.notification import NotificationLog
from app.models.user import Organization, Position, User, UserStatus, user_roles
from app.services.email_service import EmailService
from app.services.outreach_feedback_notice_service import (
    LOW_RATING_PREFIX,
    NOTIFICATION_CATEGORY,
    is_low_rating,
    rating_text,
)
from app.services.outreach_feedback_service import (
    FeedbackAlreadySent,
    OutreachFeedbackService,
)

pytestmark = pytest.mark.integration

TZ = "America/New_York"
OFF = {"email_kinds": {"event_duties": False}}


async def _org(db_session, label="Notice"):
    org = Organization(
        name=f"{label} FD", slug=f"{label.lower()}-{uuid.uuid4().hex[:10]}", timezone=TZ
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _member(db_session, org, *permissions, preferences=None, status="active"):
    position = Position(
        organization_id=org.id,
        name=f"Holder {uuid.uuid4().hex[:6]}",
        slug=f"holder-{uuid.uuid4().hex[:8]}",
        permissions=list(permissions),
    )
    db_session.add(position)
    await db_session.flush()
    user_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status, notification_preferences) "
            "VALUES (:id, :org, :un, 'Pat', 'Member', :em, 'hashed', :status, "
            ":prefs)"
        ),
        {
            "id": user_id,
            "org": str(org.id),
            "un": f"m-{user_id[:8]}",
            "em": f"m-{user_id[:8]}@example.org",
            "status": status,
            "prefs": json.dumps(preferences) if preferences else None,
        },
    )
    await db_session.execute(
        user_roles.insert().values(user_id=user_id, position_id=position.id)
    )
    await db_session.flush()
    return user_id


@pytest.fixture
async def org(db_session):
    return await _org(db_session)


@pytest.fixture
async def form(db_session, org):
    """The starter form, made the department's feedback form."""
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
    return await OutreachFeedbackService(db_session).create_starter_form(
        org, str(author.id)
    )


@pytest.fixture
def send_email():
    mock = AsyncMock(return_value=(1, 0))
    # One patch, entered once, outside any concurrent section (pitfall #22).
    with patch.object(EmailService, "send_email", mock):
        yield mock


def _rating_id(form):
    return str(next(f.id for f in form.fields if f.label == "How did the visit go?"))


async def _request(db_session, org, coordinator=None):
    token = generate_status_token()
    req = EventRequest(
        organization_id=org.id,
        contact_name="Priya Natarajan",
        contact_email="priya@example.test",
        organization_name="Willow Creek Preschool",
        description="A station tour for the preschool",
        status=EventRequestStatus.COMPLETED,
        status_token=token,
        assigned_to=coordinator,
    )
    db_session.add(req)
    await db_session.flush()
    return req, token


async def _set_default_coordinator(db_session, org, user_id):
    settings = copy.deepcopy(org.settings or {})
    settings.setdefault("events", {}).setdefault("request_pipeline", {})[
        "default_assignee_id"
    ] = user_id
    org.settings = settings
    await db_session.flush()


async def _send(db_session, form, token, score="5"):
    return await OutreachFeedbackService(db_session).submit(
        token, {_rating_id(form): score}
    )


async def _bells(db_session, req):
    rows = (
        (
            await db_session.execute(
                select(NotificationLog).where(
                    NotificationLog.category == NOTIFICATION_CATEGORY,
                    NotificationLog.action_url == f"/events/admin/requests/{req.id}",
                )
            )
        )
        .scalars()
        .all()
    )
    return rows


def _emailed(send_email):
    return [call.kwargs["to_emails"][0] for call in send_email.await_args_list]


def _email_of(user_id):
    return f"m-{user_id[:8]}@example.org"


class TestWhoIsTold:
    async def test_the_coordinator_alone_when_they_manage_events(
        self, db_session, org, form, send_email
    ):
        coordinator = await _member(db_session, org, "events.manage")
        await _member(db_session, org, "events.manage")
        req, token = await _request(db_session, org, coordinator)

        await _send(db_session, form, token)

        assert {b.recipient_id for b in await _bells(db_session, req)} == {coordinator}
        assert _emailed(send_email) == [_email_of(coordinator)]
        call = send_email.await_args.kwargs
        assert call["template_type"] == "outreach_feedback_received"
        assert call["subject"] == "Feedback from Priya Natarajan"
        assert "5 out of 5" in call["text_body"]
        assert f"/events/admin/requests/{req.id}" in call["text_body"]

    async def test_the_default_coordinator_when_the_request_has_none(
        self, db_session, org, form, send_email
    ):
        default = await _member(db_session, org, "events.manage")
        await _member(db_session, org, "events.manage")
        await _set_default_coordinator(db_session, org, default)
        req, token = await _request(db_session, org)

        await _send(db_session, form, token)

        assert {b.recipient_id for b in await _bells(db_session, req)} == {default}
        assert _emailed(send_email) == [_email_of(default)]

    async def test_a_coordinator_who_cannot_open_the_request_falls_through(
        self, db_session, org, form, send_email
    ):
        # Lost events.manage since being assigned: the link would be a 403.
        coordinator = await _member(db_session, org, "events.view")
        default = await _member(db_session, org, "events.manage")
        await _set_default_coordinator(db_session, org, default)
        req, token = await _request(db_session, org, coordinator)

        await _send(db_session, form, token)

        assert {b.recipient_id for b in await _bells(db_session, req)} == {default}

    async def test_every_current_event_manager_when_no_coordinator_qualifies(
        self, db_session, org, form, send_email
    ):
        departed = await _member(db_session, org, "events.manage", status="retired")
        await _set_default_coordinator(db_session, org, departed)
        first = await _member(db_session, org, "events.manage")
        second = await _member(db_session, org, "events.*")
        await _member(db_session, org, "events.view")
        elsewhere = await _org(db_session, "Elsewhere")
        await _member(db_session, elsewhere, "events.manage")
        req, token = await _request(db_session, org, departed)

        await _send(db_session, form, token)

        assert {b.recipient_id for b in await _bells(db_session, req)} == {
            first,
            second,
        }
        assert sorted(_emailed(send_email)) == sorted(
            [_email_of(first), _email_of(second)]
        )

    async def test_nobody_to_tell_still_stores_the_response(
        self, db_session, org, form, send_email
    ):
        req, token = await _request(db_session, org)

        assert await _send(db_session, form, token) is not None

        assert await _bells(db_session, req) == []
        send_email.assert_not_awaited()


class TestWhatTheyAreTold:
    async def test_a_low_rating_is_flagged_in_the_subject_and_the_bell(
        self, db_session, org, form, send_email
    ):
        coordinator = await _member(db_session, org, "events.manage")
        req, token = await _request(db_session, org, coordinator)

        await _send(db_session, form, token, score="3")

        assert send_email.await_args.kwargs["subject"] == (
            f"{LOW_RATING_PREFIX}Feedback from Priya Natarajan"
        )
        (bell,) = await _bells(db_session, req)
        assert bell.subject.startswith(LOW_RATING_PREFIX)
        assert bell.notification_metadata["low_rating"] is True
        assert "3 out of 5" in bell.message

    async def test_a_good_rating_is_not_flagged(
        self, db_session, org, form, send_email
    ):
        coordinator = await _member(db_session, org, "events.manage")
        req, token = await _request(db_session, org, coordinator)

        await _send(db_session, form, token, score="4")

        (bell,) = await _bells(db_session, req)
        assert not bell.subject.startswith(LOW_RATING_PREFIX)
        assert bell.notification_metadata["low_rating"] is False

    @pytest.mark.parametrize(
        ("rating", "scale", "low"),
        [(3, 5, True), (4, 5, False), (1, 5, True), (6, 10, True), (7, 10, False)],
    )
    def test_low_means_the_bottom_three_fifths_of_the_scale(self, rating, scale, low):
        assert is_low_rating(rating, scale) is low

    def test_without_a_rating_or_a_scale_nothing_is_low(self):
        assert is_low_rating(None, 5) is False
        assert is_low_rating(2, None) is False
        assert rating_text(None, 5) == "No rating given"
        assert rating_text(4, None) == "4"


class TestDelivery:
    async def test_the_officer_who_turned_off_event_duty_email_gets_the_bell_only(
        self, db_session, org, form, send_email
    ):
        coordinator = await _member(db_session, org, "events.manage", preferences=OFF)
        req, token = await _request(db_session, org, coordinator)

        await _send(db_session, form, token)

        send_email.assert_not_awaited()
        assert {b.recipient_id for b in await _bells(db_session, req)} == {coordinator}

    async def test_a_department_that_switched_the_template_off_sends_no_email(
        self, db_session, org, form, send_email
    ):
        coordinator = await _member(db_session, org, "events.manage")
        db_session.add(
            EmailTemplate(
                organization_id=org.id,
                template_type=EmailTemplateType.OUTREACH_FEEDBACK_RECEIVED,
                name="Requester Feedback Received",
                subject="x",
                html_body="x",
                is_active=False,
            )
        )
        req, token = await _request(db_session, org, coordinator)

        await _send(db_session, form, token)

        send_email.assert_not_awaited()
        assert {b.recipient_id for b in await _bells(db_session, req)} == {coordinator}

    async def test_a_failed_email_does_not_fail_the_requesters_submit(
        self, db_session, org, form
    ):
        coordinator = await _member(db_session, org, "events.manage")
        req, token = await _request(db_session, org, coordinator)

        with patch.object(
            EmailService, "send_email", AsyncMock(side_effect=RuntimeError("smtp down"))
        ):
            assert await _send(db_session, form, token) is not None

        stored = await db_session.scalar(
            select(EventRequestFeedback).where(
                EventRequestFeedback.request_id == req.id
            )
        )
        assert stored is not None
        assert {b.recipient_id for b in await _bells(db_session, req)} == {coordinator}

    async def test_a_second_send_sends_no_second_notice(
        self, db_session, org, form, send_email
    ):
        coordinator = await _member(db_session, org, "events.manage")
        req, token = await _request(db_session, org, coordinator)
        await _send(db_session, form, token)

        with pytest.raises(FeedbackAlreadySent):
            await _send(db_session, form, token, score="1")

        assert len(await _bells(db_session, req)) == 1
        assert send_email.await_count == 1
