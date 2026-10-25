"""The "Next Meeting" section of an automated-email pipeline stage.

The stage editor saves the event that was next when the stage was configured
(``next_meeting_event_id``) beside the event type it was picked from. The send
path used to look up only that saved event and only while it was upcoming, so
once that one meeting had passed every later applicant got an email with the
section silently missing — while the editor's preview, computed live, showed
the next meeting as if it would be used.
"""

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select

from app.models.event import Event, EventType
from app.models.location import Location
from app.models.membership_pipeline import (
    MembershipPipelineStep,
    ProspectActivityLog,
    ProspectiveMember,
    ProspectStatus,
)
from app.models.user import Organization
from app.services.email_service import EmailService
from app.services.membership_pipeline_service import MembershipPipelineService

pytestmark = pytest.mark.integration


async def _org(db_session, name="Recruiting VFD"):
    org = Organization(
        name=name,
        slug=f"next-meeting-{uuid.uuid4().hex[:10]}",
        timezone="America/New_York",
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _event(
    db_session,
    org_id,
    title,
    *,
    hours_from_now,
    event_type=EventType.RECRUITMENT,
    location_id=None,
    location=None,
    is_cancelled=False,
    is_draft=False,
):
    start = datetime.now(timezone.utc) + timedelta(hours=hours_from_now)
    event = Event(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        title=title,
        event_type=event_type,
        start_datetime=start,
        end_datetime=start + timedelta(hours=1),
        location_id=location_id,
        location=location,
        is_cancelled=is_cancelled,
        is_draft=is_draft,
    )
    db_session.add(event)
    await db_session.flush()
    return str(event.id)


async def _send(db_session, org_id, config):
    """Run the stage email for a fresh applicant; return (sent, html, text, pid)."""
    svc = MembershipPipelineService(db_session)
    pipeline = await svc.create_pipeline(organization_id=org_id, name="Recruiting")
    step = await svc.add_step(
        str(pipeline.id),
        org_id,
        {
            "name": "Send Welcome Email",
            "step_type": "automated_email",
            "required": False,
            "config": {
                "email_subject": "Welcome",
                "include_next_meeting": True,
                **config,
            },
        },
    )
    prospect = ProspectiveMember(
        organization_id=org_id,
        pipeline_id=str(pipeline.id),
        current_step_id=str(step.id),
        first_name="Pat",
        last_name="Applicant",
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
    kwargs = send.await_args.kwargs
    return sent, kwargs["html_body"], kwargs["text_body"], str(prospect.id)


class TestSavedEventFallsBack:
    async def test_a_passed_saved_event_falls_back_to_the_next_of_its_type(
        self, db_session
    ):
        org = await _org(db_session)
        org_id = str(org.id)
        passed = await _event(
            db_session, org_id, "October Interest Meeting", hours_from_now=-24 * 13
        )
        await _event(
            db_session, org_id, "November Interest Meeting", hours_from_now=24 * 16
        )

        sent, html, text, _ = await _send(
            db_session,
            org_id,
            {"next_meeting_event_type": "recruitment", "next_meeting_event_id": passed},
        )

        assert sent is True
        assert "November Interest Meeting" in html
        assert "October Interest Meeting" not in html
        assert "Next Meeting:\nNovember Interest Meeting" in text

    async def test_an_upcoming_saved_event_is_used_over_a_sooner_one(self, db_session):
        # The coordinator's saved event wins while it is upcoming, even when a
        # sooner event of the same type has been added since.
        org = await _org(db_session)
        org_id = str(org.id)
        saved = await _event(
            db_session, org_id, "Saved Interest Meeting", hours_from_now=24 * 16
        )
        await _event(db_session, org_id, "Sooner Open House", hours_from_now=24 * 2)

        _, html, text, _ = await _send(
            db_session,
            org_id,
            {"next_meeting_event_type": "recruitment", "next_meeting_event_id": saved},
        )

        assert "Saved Interest Meeting" in html
        assert "Sooner Open House" not in html
        assert "Saved Interest Meeting" in text

    async def test_cancelled_and_draft_events_are_skipped(self, db_session):
        org = await _org(db_session)
        org_id = str(org.id)
        cancelled = await _event(
            db_session,
            org_id,
            "Cancelled Meeting",
            hours_from_now=24,
            is_cancelled=True,
        )
        await _event(
            db_session, org_id, "Draft Meeting", hours_from_now=48, is_draft=True
        )
        await _event(db_session, org_id, "Real Meeting", hours_from_now=72)

        _, html, _, _ = await _send(
            db_session,
            org_id,
            {
                "next_meeting_event_type": "recruitment",
                "next_meeting_event_id": cancelled,
            },
        )

        assert "Real Meeting" in html
        assert "Cancelled Meeting" not in html
        assert "Draft Meeting" not in html

    async def test_another_type_is_never_the_fallback(self, db_session):
        org = await _org(db_session)
        org_id = str(org.id)
        await _event(
            db_session,
            org_id,
            "Business Meeting",
            hours_from_now=24,
            event_type=EventType.BUSINESS_MEETING,
        )
        await _event(db_session, org_id, "Interest Meeting", hours_from_now=48)

        _, html, _, _ = await _send(
            db_session, org_id, {"next_meeting_event_type": "recruitment"}
        )

        assert "Interest Meeting" in html
        assert "Business Meeting" not in html


class TestMeetingLocation:
    async def test_a_named_location_shows_its_name_and_address(self, db_session):
        org = await _org(db_session)
        org_id = str(org.id)
        location = Location(
            id=str(uuid.uuid4()),
            organization_id=org_id,
            name="Station 6",
            address="1 Main St",
            city="Falls Church",
            state="VA",
            zip="22046",
        )
        db_session.add(location)
        await db_session.flush()
        await _event(
            db_session,
            org_id,
            "Interest Meeting",
            hours_from_now=24,
            location_id=str(location.id),
        )

        _, html, text, _ = await _send(
            db_session, org_id, {"next_meeting_event_type": "recruitment"}
        )

        expected = "Station 6 — 1 Main St, Falls Church, VA 22046"
        assert expected in html
        assert expected in text

    async def test_free_text_location_is_used_without_a_named_one(self, db_session):
        org = await _org(db_session)
        org_id = str(org.id)
        await _event(
            db_session,
            org_id,
            "Interest Meeting",
            hours_from_now=24,
            location="Back parking lot",
        )

        _, html, _, _ = await _send(
            db_session, org_id, {"next_meeting_event_type": "recruitment"}
        )

        assert "Back parking lot" in html

    async def test_another_organizations_location_is_never_printed(self, db_session):
        org = await _org(db_session)
        other = await _org(db_session, name="Other VFD")
        foreign = Location(
            id=str(uuid.uuid4()),
            organization_id=str(other.id),
            name="Other Department HQ",
        )
        db_session.add(foreign)
        await db_session.flush()
        await _event(
            db_session,
            str(org.id),
            "Interest Meeting",
            hours_from_now=24,
            location_id=str(foreign.id),
        )

        _, html, _, _ = await _send(
            db_session, str(org.id), {"next_meeting_event_type": "recruitment"}
        )

        assert "Interest Meeting" in html
        assert "Other Department HQ" not in html


class TestNoUpcomingEvent:
    async def test_only_the_additional_details_are_sent_and_it_is_recorded(
        self, db_session
    ):
        org = await _org(db_session)
        org_id = str(org.id)
        passed = await _event(
            db_session, org_id, "Old Meeting", hours_from_now=-24 * 13
        )

        sent, html, text, prospect_id = await _send(
            db_session,
            org_id,
            {
                "next_meeting_event_type": "recruitment",
                "next_meeting_event_id": passed,
                "next_meeting_details": "Watch your inbox for the next date.",
            },
        )

        assert sent is True
        assert "Old Meeting" not in html
        assert "Watch your inbox for the next date." in html
        assert "Next Meeting:\nWatch your inbox for the next date." in text
        logged = (
            (
                await db_session.execute(
                    select(ProspectActivityLog).where(
                        ProspectActivityLog.prospect_id == prospect_id,
                        ProspectActivityLog.action == "stage_email_meeting_missing",
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(logged) == 1
        assert logged[0].details["event_type"] == "recruitment"

    async def test_the_section_is_left_out_without_details(self, db_session):
        org = await _org(db_session)

        _, html, text, _ = await _send(
            db_session, str(org.id), {"next_meeting_event_type": "recruitment"}
        )

        assert "<strong>Next Meeting</strong>" not in html
        assert "Next Meeting:" not in text
