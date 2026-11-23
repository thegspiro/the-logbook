"""A coordinator enters an outreach request that arrived by phone, email or in person.

Owner decision, 2026-11-20. ``POST /event-requests`` (``events.manage``) files a
request for somebody who did not use the public form. Pinned here:

* a caller who gave only a phone number is a request, and no email is ever
  attempted to an address they did not give;
* none of the public gates apply — it works with public requests switched off,
  and a date inside the minimum lead time is flagged, not refused;
* the dates are plain calendar dates anchored to the department's midnight, so
  the 15th is stored as the 15th and not the evening of the 14th;
* a chosen coordinator is in the organization and a current member, and
  without one the department default applies, as for a public request;
* the requester's acknowledgement can be declined, and the coordinator's copy
  still goes;
* how the request arrived is stored and reported, and an existing request
  reads as ``web``.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from zoneinfo import ZoneInfo

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select

from app.api.v1.endpoints.event_requests import (
    create_staff_event_request,
    list_event_requests,
    send_template_email,
)
from app.models.event_request import (
    EventRequest,
    EventRequestActivity,
    EventRequestEmailTemplate,
    EventRequestSource,
)
from app.models.user import Organization, User, UserStatus
from app.schemas.event_request import EventRequestStaffCreate, SendTemplateEmail
from app.services.event_request_service import send_request_notification

NOTIFY = "app.api.v1.endpoints.event_requests._send_request_notification"


def _payload(**overrides):
    data = {
        "source": "phone",
        "contact_name": "Pat Rivera",
        "contact_phone": "703-555-0142",
        "outreach_type": "station_tour",
        "description": "Called about a tour for her Cub Scout den.",
    }
    data.update(overrides)
    return EventRequestStaffCreate(**data)


# ---------------------------------------------------------------------------
# The schema
# ---------------------------------------------------------------------------


@pytest.mark.unit
class TestTheSchema:
    def test_a_phone_number_alone_is_enough(self):
        assert _payload().contact_email is None

    def test_an_email_alone_is_enough(self):
        data = _payload(contact_phone=None, contact_email="pat@example.org")
        assert data.contact_email == "pat@example.org"

    @pytest.mark.parametrize("phone", [None, "", "   "])
    def test_no_way_to_reach_the_requester_is_refused(self, phone):
        with pytest.raises(ValidationError, match="email address or a phone"):
            _payload(contact_phone=phone)

    def test_a_coordinator_cannot_claim_the_requester_used_the_web_form(self):
        with pytest.raises(ValidationError, match="source must be one of"):
            _payload(source=EventRequestSource.WEB.value)

    def test_an_unknown_channel_is_refused(self):
        with pytest.raises(ValidationError, match="source must be one of"):
            _payload(source="fax")

    def test_a_reversed_date_window_is_refused(self):
        with pytest.raises(ValidationError, match="must not be before"):
            _payload(
                date_flexibility="specific_dates",
                preferred_date_start=date(2027, 1, 20),
                preferred_date_end=date(2027, 1, 10),
            )

    def test_a_short_note_is_accepted(self):
        """The public form wants ten characters from a stranger; a coordinator's
        note of a call can be shorter."""
        assert _payload(description="Tour").description == "Tour"


@pytest.mark.unit
def test_the_model_allows_no_email_and_defaults_the_source_to_web():
    table = EventRequest.__table__
    assert table.c.contact_email.nullable is True
    assert table.c.source.nullable is False
    assert table.c.source.server_default.arg == "web"


# ---------------------------------------------------------------------------
# The email guard, at the one function every requester email goes through
# ---------------------------------------------------------------------------


def _notifying_org():
    return SimpleNamespace(
        id="org-1",
        name="Oakville FD",
        timezone="America/New_York",
        settings={
            "events": {
                "request_pipeline": {
                    "email_triggers": {
                        "on_submitted": {
                            "enabled": True,
                            "notify_requester": True,
                            "notify_assignee": False,
                        }
                    }
                }
            }
        },
    )


async def _notify(contact_email, **kwargs):
    email_service = MagicMock()
    email_service._render_unless_switched_off = AsyncMock(
        return_value=("Subject", "<p>Body</p>", "Body")
    )
    email_service.send_email = AsyncMock(return_value=(1, 0))
    request = SimpleNamespace(
        contact_name="Pat Rivera",
        contact_email=contact_email,
        status=SimpleNamespace(value="submitted"),
        event_date=None,
        decline_reason=None,
        assigned_to=None,
    )
    with (
        patch("app.services.email_service.EmailService", return_value=email_service),
        patch("app.services.notifications_service.NotificationsService"),
    ):
        sent = await send_request_notification(
            AsyncMock(), request, "on_submitted", _notifying_org(), **kwargs
        )
    return sent, email_service.send_email


@pytest.mark.unit
class TestTheRequesterEmailGuard:
    async def test_a_requester_with_an_email_is_sent_the_acknowledgement(self):
        sent, send = await _notify("pat@example.org")
        assert sent is True
        send.assert_awaited_once()
        assert send.await_args.kwargs["to_emails"] == ["pat@example.org"]

    @pytest.mark.parametrize("missing", [None, ""])
    async def test_no_email_is_attempted_to_an_address_never_given(self, missing):
        sent, send = await _notify(missing)
        assert sent is True
        send.assert_not_awaited()

    async def test_a_declined_acknowledgement_is_not_sent(self):
        sent, send = await _notify("pat@example.org", skip_requester=True)
        assert sent is True
        send.assert_not_awaited()


# ---------------------------------------------------------------------------
# The endpoint, against the database
# ---------------------------------------------------------------------------


async def _dept(db_session, pipeline=None):
    org = Organization(
        name="Staff Entry FD",
        slug=f"staff-entry-{uuid.uuid4().hex[:10]}",
        timezone="America/Chicago",
        settings={"events": {"request_pipeline": pipeline or {}}},
    )
    db_session.add(org)
    await db_session.flush()
    people = {}
    for key, status in (
        ("coordinator", UserStatus.ACTIVE),
        ("other", UserStatus.ACTIVE),
        ("former", UserStatus.INACTIVE),
    ):
        user = User(
            organization_id=org.id,
            username=f"{key}-{org.id[:8]}",
            email=f"{key}-{org.id[:8]}@example.test",
            first_name=key.title(),
            last_name="Member",
            status=status,
        )
        db_session.add(user)
        people[key] = user
    await db_session.flush()
    return org, people


async def _create(db_session, user, data=None):
    with patch(NOTIFY, AsyncMock(return_value=True)) as notify:
        response = await create_staff_event_request(
            data=data or _payload(), db=db_session, current_user=user
        )
    return response, notify


async def _stored(db_session, request_id):
    return await db_session.scalar(
        select(EventRequest).where(EventRequest.id == request_id)
    )


async def _activity(db_session, request_id):
    rows = await db_session.execute(
        select(EventRequestActivity)
        .where(EventRequestActivity.request_id == request_id)
        .order_by(EventRequestActivity.created_at)
    )
    return {row.action: row for row in rows.scalars()}


@pytest.mark.integration
class TestEnteringARequest:
    async def test_a_phone_only_request_is_filed_and_says_who_entered_it(
        self, db_session
    ):
        org, people = await _dept(db_session)
        response, _notify_mock = await _create(db_session, people["coordinator"])

        assert response.status == "submitted"
        assert response.source == "phone"
        assert response.contact_email is None
        assert response.contact_phone == "703-555-0142"

        stored = await _stored(db_session, response.id)
        assert stored.organization_id == org.id
        assert stored.contact_email is None
        assert stored.source == "phone"
        assert stored.ip_address is None

        submitted = (await _activity(db_session, response.id))["submitted"]
        assert submitted.notes == "Entered by Coordinator Member from a phone call"
        assert submitted.performed_by == people["coordinator"].id
        assert submitted.details == {"source": "phone"}

    async def test_it_works_while_public_requests_are_switched_off(self, db_session):
        _org, people = await _dept(db_session, {"accept_public_requests": False})
        response, _ = await _create(db_session, people["coordinator"])
        assert response.status == "submitted"

    async def test_dates_are_stored_as_the_days_the_caller_named(self, db_session):
        _org, people = await _dept(db_session)
        response, _ = await _create(
            db_session,
            people["coordinator"],
            _payload(
                date_flexibility="specific_dates",
                preferred_date_start=date(2027, 1, 15),
                preferred_date_end=date(2027, 1, 29),
            ),
        )
        stored = await _stored(db_session, response.id)
        assert stored.preferred_date_start == date(2027, 1, 15)
        assert stored.preferred_date_end == date(2027, 1, 29)
        assert response.preferred_date_start == date(2027, 1, 15)

    async def test_a_date_inside_the_lead_time_is_flagged_not_refused(self, db_session):
        _org, people = await _dept(db_session, {"min_lead_time_days": 21})
        soon = datetime.now(ZoneInfo("America/Chicago")).date() + timedelta(days=3)
        response, _ = await _create(
            db_session,
            people["coordinator"],
            _payload(date_flexibility="specific_dates", preferred_date_start=soon),
        )

        stored = await _stored(db_session, response.id)
        assert stored.reviewer_notes.startswith("Short notice: ")
        warning = (await _activity(db_session, response.id))["lead_time_warning"]
        assert warning.details == {"min_lead_time_days": 21}

    async def test_the_request_is_listed_with_its_source(self, db_session):
        org, people = await _dept(db_session)
        web = EventRequest(
            organization_id=org.id,
            contact_name="Web Requester",
            contact_email="web@example.test",
            description="Arrived on the public form",
        )
        db_session.add(web)
        await db_session.flush()
        response, _ = await _create(
            db_session, people["coordinator"], _payload(source="in_person")
        )

        items = await list_event_requests(
            status_filter=None,
            outreach_type=None,
            db=db_session,
            current_user=people["coordinator"],
        )
        by_id = {item.id: item for item in items}
        assert by_id[response.id].source == "in_person"
        assert by_id[response.id].contact_email is None
        assert by_id[web.id].source == "web"


@pytest.mark.integration
class TestTheCoordinator:
    async def test_a_chosen_coordinator_is_assigned_and_logged(self, db_session):
        _org, people = await _dept(db_session)
        response, _ = await _create(
            db_session,
            people["coordinator"],
            _payload(assigned_to=people["other"].id),
        )

        assert response.assigned_to == people["other"].id
        assigned = (await _activity(db_session, response.id))["assigned"]
        assert assigned.details["assigned_to"] == people["other"].id
        assert assigned.performed_by == people["coordinator"].id

    async def test_without_a_choice_the_department_default_applies(self, db_session):
        _org, people = await _dept(db_session)
        org = await db_session.get(Organization, people["coordinator"].organization_id)
        org.settings = {
            "events": {"request_pipeline": {"default_assignee_id": people["other"].id}}
        }
        await db_session.flush()

        response, _ = await _create(db_session, people["coordinator"])

        assert response.assigned_to == people["other"].id
        assert "auto_assigned" in await _activity(db_session, response.id)

    @pytest.mark.parametrize("deleted", [False, True], ids=["former", "deleted"])
    async def test_a_default_coordinator_who_has_left_leaves_it_unassigned(
        self, db_session, deleted
    ):
        """An unassigned request shows in the queue; one handed to a member who
        has left (or been deleted) waits on somebody who will never pick it up."""
        _org, people = await _dept(db_session)
        gone = people["other"] if deleted else people["former"]
        if deleted:
            gone.deleted_at = datetime.now(timezone.utc)
        org = await db_session.get(Organization, people["coordinator"].organization_id)
        org.settings = {
            "events": {"request_pipeline": {"default_assignee_id": gone.id}}
        }
        await db_session.flush()

        response, _ = await _create(db_session, people["coordinator"])

        assert response.assigned_to is None
        assert "auto_assigned" not in await _activity(db_session, response.id)

    async def test_a_coordinator_from_another_department_is_refused(self, db_session):
        _org, people = await _dept(db_session)
        _other_org, outsiders = await _dept(db_session)
        with pytest.raises(HTTPException) as exc:
            await _create(
                db_session,
                people["coordinator"],
                _payload(assigned_to=outsiders["coordinator"].id),
            )
        assert exc.value.status_code == 404

    async def test_a_former_member_cannot_be_made_coordinator(self, db_session):
        _org, people = await _dept(db_session)
        with pytest.raises(HTTPException) as exc:
            await _create(
                db_session,
                people["coordinator"],
                _payload(assigned_to=people["former"].id),
            )
        assert exc.value.status_code == 400


@pytest.mark.integration
class TestTheAcknowledgement:
    async def test_it_is_sent_unless_the_coordinator_declines_it(self, db_session):
        _org, people = await _dept(db_session)

        _response, notify = await _create(db_session, people["coordinator"])
        assert notify.await_args.args[2] == "on_submitted"
        assert notify.await_args.kwargs == {"skip_requester": False}

        _response, notify = await _create(
            db_session, people["coordinator"], _payload(notify_requester=False)
        )
        # Still called: the coordinator's copy of the submission goes out.
        assert notify.await_args.args[2] == "on_submitted"
        assert notify.await_args.kwargs == {"skip_requester": True}

    async def test_a_template_email_to_a_requester_with_no_address_is_refused(
        self, db_session
    ):
        org, people = await _dept(db_session)
        response, _ = await _create(db_session, people["coordinator"])
        template = EventRequestEmailTemplate(
            organization_id=org.id,
            name="Directions",
            subject="Directions",
            body_html="<p>Use the side door.</p>",
            created_by=people["coordinator"].id,
        )
        db_session.add(template)
        await db_session.flush()

        with patch("app.services.email_service.EmailService") as email_service:
            with pytest.raises(HTTPException) as exc:
                await send_template_email(
                    request_id=response.id,
                    data=SendTemplateEmail(template_id=template.id),
                    db=db_session,
                    current_user=people["coordinator"],
                )
        assert exc.value.status_code == 400
        email_service.assert_not_called()


@pytest.mark.integration
class TestTheCoordinatorsNotice:
    """Through the real notification path, with only email delivery stubbed.

    The coordinator's notice was logged with keys ``NotificationLog`` does not
    have (``trigger``, ``body``). ``log_notification`` swallowed the TypeError
    and rolled the session back, so no request — public or entered by staff —
    ever recorded the notice, and the rollback expired every object the
    caller still held, which turned the staff endpoint's reply into a 500.
    """

    async def test_entering_an_assigned_request_records_the_notice_and_answers(
        self, db_session
    ):
        from app.models.notification import NotificationLog

        _org, people = await _dept(
            db_session,
            {
                "email_triggers": {
                    "on_submitted": {
                        "enabled": True,
                        "notify_requester": True,
                        "notify_assignee": True,
                    }
                }
            },
        )
        email_service = MagicMock()
        email_service.send_email = AsyncMock(return_value=(1, 0))
        email_service._render_unless_switched_off = AsyncMock(return_value=None)
        with patch(
            "app.services.email_service.EmailService", return_value=email_service
        ):
            response = await create_staff_event_request(
                data=_payload(assigned_to=people["other"].id),
                db=db_session,
                current_user=people["coordinator"],
            )

        assert response.assigned_to == people["other"].id
        logged = (
            await db_session.execute(
                select(NotificationLog).where(
                    NotificationLog.recipient_id == people["other"].id
                )
            )
        ).scalar_one()
        assert logged.subject.startswith("New Event Request Assigned")
        assert logged.message == "New event request from Pat Rivera"
