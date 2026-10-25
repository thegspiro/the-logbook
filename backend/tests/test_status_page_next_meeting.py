"""The next meeting on an applicant's public status page, and the missed-meeting roll-forward.

A meeting stage links its applicant to one event when they reach it. The page
used to say nothing about that meeting, and an applicant who missed it stayed
linked to a past event with nothing on their record and nothing pointing them
at the next one. These run against MySQL; only email is out of the path.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import Event, EventExternalAttendee, EventType
from app.models.location import Location
from app.models.membership_pipeline import (
    MembershipPipeline,
    MembershipPipelineStep,
    ProspectActivityLog,
    ProspectEventLink,
)
from app.models.user import Organization
from app.services.membership_pipeline_service import MembershipPipelineService
from app.services.scheduled_tasks import run_prospect_attendance_advance

pytestmark = pytest.mark.integration


def _uid() -> str:
    return uuid.uuid4().hex


async def _pipeline(svc, db_session, org_id, stages, *, show_future=True):
    """A pipeline with its status page on, built from ``(step_type, config)``."""
    pipeline = await svc.create_pipeline(
        organization_id=org_id, name=f"Meeting-{_uid()[:8]}"
    )
    steps = []
    for i, (step_type, config, public_visible) in enumerate(stages):
        data = {
            "name": f"Stage {i + 1}",
            "step_type": step_type,
            "sort_order": i,
            "required": True,
            "public_visible": public_visible,
        }
        if config is not None:
            data["config"] = config
        steps.append(await svc.add_step(pipeline.id, org_id, data))
    row = (
        await db_session.execute(
            select(MembershipPipeline).where(MembershipPipeline.id == pipeline.id)
        )
    ).scalar_one()
    row.public_status_enabled = True
    row.public_show_future_stages = show_future
    await db_session.commit()
    return pipeline, steps


MEETING = ("meeting", {"linked_event_type": "recruitment"}, True)
APPROVAL = ("manual_approval", None, True)


async def _prospect(svc, org_id, admin_id, pipeline):
    return await svc.create_prospect(
        organization_id=org_id,
        data={
            "first_name": "Next",
            "last_name": "Meeting",
            "email": f"meeting-{_uid()[:10]}@example.com",
            "pipeline_id": pipeline.id,
        },
        created_by=admin_id,
    )


async def _event(
    db_session,
    org_id,
    title,
    *,
    hours_from_now,
    event_type=EventType.RECRUITMENT,
    location_id=None,
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
    )
    db_session.add(event)
    await db_session.commit()
    return str(event.id)


async def _link(db_session, prospect_id, event_id):
    db_session.add(
        ProspectEventLink(id=_uid(), prospect_id=prospect_id, event_id=event_id)
    )
    await db_session.commit()


async def _links(db_session, prospect_id):
    return set(
        (
            await db_session.execute(
                select(ProspectEventLink.event_id).where(
                    ProspectEventLink.prospect_id == prospect_id
                )
            )
        ).scalars()
    )


async def _missed(db_session, prospect_id):
    return list(
        (
            await db_session.execute(
                select(ProspectActivityLog).where(
                    ProspectActivityLog.prospect_id == prospect_id,
                    ProspectActivityLog.action == "meeting_missed",
                )
            )
        ).scalars()
    )


class TestStatusPageMeetingCard:
    async def test_the_card_shows_from_the_day_they_apply(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _ = await _pipeline(svc, db_session, org_id, [APPROVAL, MEETING])
        location = Location(
            id=_uid(),
            organization_id=org_id,
            name="Station 6",
            address="1 Main St",
            city="Falls Church",
            state="VA",
            zip="22046",
        )
        db_session.add(location)
        await db_session.commit()
        await _event(db_session, org_id, "October Interest", hours_from_now=-24 * 10)
        await _event(
            db_session,
            org_id,
            "Business Meeting",
            hours_from_now=24,
            event_type=EventType.BUSINESS_MEETING,
        )
        await _event(
            db_session,
            org_id,
            "November Interest",
            hours_from_now=24 * 15,
            location_id=location.id,
        )
        prospect = await _prospect(svc, org_id, admin_id, pipeline)

        page = await svc.get_prospect_by_token(prospect.status_token)

        meeting = page["next_meeting"]
        assert meeting["title"] == "November Interest"
        assert meeting["stage_name"] == "Stage 2"
        assert meeting["location_name"] == "Station 6"
        assert meeting["location_address"] == "1 Main St, Falls Church, VA 22046"
        assert meeting["timezone"] == "UTC"
        assert meeting["start_datetime"].endswith("+00:00")

    async def test_a_linked_open_event_wins_over_a_sooner_one(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _ = await _pipeline(svc, db_session, org_id, [APPROVAL, MEETING])
        await _event(db_session, org_id, "Sooner Open House", hours_from_now=24)
        linked = await _event(db_session, org_id, "Chosen Meeting", hours_from_now=72)
        prospect = await _prospect(svc, org_id, admin_id, pipeline)
        await _link(db_session, prospect.id, linked)

        page = await svc.get_prospect_by_token(prospect.status_token)

        assert page["next_meeting"]["title"] == "Chosen Meeting"

    async def test_a_missed_meeting_is_replaced_the_moment_it_ends(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _ = await _pipeline(svc, db_session, org_id, [MEETING])
        missed = await _event(db_session, org_id, "Missed Meeting", hours_from_now=-3)
        await _event(db_session, org_id, "Next Meeting", hours_from_now=24 * 7)
        prospect = await _prospect(svc, org_id, admin_id, pipeline)
        await _link(db_session, prospect.id, missed)

        page = await svc.get_prospect_by_token(prospect.status_token)

        assert page["next_meeting"]["title"] == "Next Meeting"

    async def test_a_meeting_stage_hidden_from_applicants_shows_no_card(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)
        hidden = ("meeting", {"linked_event_type": "recruitment"}, False)
        pipeline, _ = await _pipeline(svc, db_session, org_id, [APPROVAL, hidden])
        await _event(db_session, org_id, "Interest Meeting", hours_from_now=24)
        prospect = await _prospect(svc, org_id, admin_id, pipeline)

        page = await svc.get_prospect_by_token(prospect.status_token)

        assert page["next_meeting"] is None

    async def test_hidden_future_stages_wait_until_the_meeting_stage(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, steps = await _pipeline(
            svc, db_session, org_id, [APPROVAL, MEETING], show_future=False
        )
        await _event(db_session, org_id, "Interest Meeting", hours_from_now=24)
        prospect = await _prospect(svc, org_id, admin_id, pipeline)

        before = await svc.get_prospect_by_token(prospect.status_token)
        await svc.complete_step(
            prospect_id=prospect.id,
            organization_id=org_id,
            step_id=steps[0].id,
            completed_by=admin_id,
        )
        after = await svc.get_prospect_by_token(prospect.status_token)

        assert before["next_meeting"] is None
        assert after["next_meeting"]["title"] == "Interest Meeting"

    async def test_no_card_once_the_meeting_stage_is_behind_them(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, steps = await _pipeline(svc, db_session, org_id, [MEETING, APPROVAL])
        await _event(db_session, org_id, "Interest Meeting", hours_from_now=24)
        prospect = await _prospect(svc, org_id, admin_id, pipeline)
        # Attendance is the only way past a required meeting stage, so the
        # department un-ticks Required and skips it, as a coordinator would.
        await db_session.execute(
            update(MembershipPipelineStep)
            .where(MembershipPipelineStep.id == steps[0].id)
            .values(required=False)
        )
        await db_session.commit()

        await svc.skip_current_step(prospect.id, org_id, admin_id)
        page = await svc.get_prospect_by_token(prospect.status_token)

        assert page["current_stage_name"] == "Stage 2"
        assert page["next_meeting"] is None

    async def test_another_departments_events_are_never_named(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _ = await _pipeline(svc, db_session, org_id, [MEETING])
        other_org = Organization(name="Other VFD", slug=f"other-{_uid()[:10]}")
        db_session.add(other_org)
        await db_session.commit()
        await _event(db_session, str(other_org.id), "Their Meeting", hours_from_now=24)
        prospect = await _prospect(svc, org_id, admin_id, pipeline)

        page = await svc.get_prospect_by_token(prospect.status_token)

        assert page["next_meeting"] is None


class TestNextMeetingCalendarFile:
    async def test_the_file_names_the_meeting_the_page_shows(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _ = await _pipeline(svc, db_session, org_id, [MEETING])
        await _event(db_session, org_id, "Interest Meeting", hours_from_now=24)
        prospect = await _prospect(svc, org_id, admin_id, pipeline)

        filename, body = await svc.get_next_meeting_ics(prospect.status_token)

        assert filename == "next-meeting.ics"
        assert body.startswith("BEGIN:VCALENDAR")
        assert "SUMMARY:Interest Meeting" in body
        assert "DTSTART:" in body

    async def test_no_file_without_a_meeting_or_a_working_link(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _ = await _pipeline(svc, db_session, org_id, [MEETING])
        prospect = await _prospect(svc, org_id, admin_id, pipeline)

        assert await svc.get_next_meeting_ics(prospect.status_token) is None
        assert await svc.get_next_meeting_ics("not-a-real-token-123") is None


class TestRollForwardMissedMeeting:
    async def _parked(self, db_session, setup_org_and_admin, *, ended_hours_ago):
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _ = await _pipeline(svc, db_session, org_id, [MEETING, APPROVAL])
        prospect = await _prospect(svc, org_id, admin_id, pipeline)
        missed = await _event(
            db_session,
            org_id,
            "Missed Meeting",
            hours_from_now=-(ended_hours_ago + 1),
        )
        upcoming = await _event(
            db_session, org_id, "Next Meeting", hours_from_now=24 * 7
        )
        # Arrival linked whatever was next; this applicant was linked to the
        # meeting that has since passed.
        for event_id in await _links(db_session, prospect.id):
            await db_session.execute(
                ProspectEventLink.__table__.delete().where(
                    ProspectEventLink.prospect_id == prospect.id,
                    ProspectEventLink.event_id == event_id,
                )
            )
        await _link(db_session, prospect.id, missed)
        return svc, org_id, str(prospect.id), missed, upcoming

    async def test_a_settled_miss_is_recorded_and_the_next_meeting_linked(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        svc, org_id, prospect_id, missed, upcoming = await self._parked(
            db_session, setup_org_and_admin, ended_hours_ago=24 * 10
        )

        assert await svc.roll_forward_missed_meeting(prospect_id, org_id) is True
        await db_session.commit()

        logs = await _missed(db_session, prospect_id)
        assert len(logs) == 1
        assert logs[0].details["event_id"] == missed
        assert logs[0].details["notes"].startswith("Not checked in at Missed Meeting")
        assert await _links(db_session, prospect_id) == {missed, upcoming}

    async def test_running_twice_records_the_miss_once(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        svc, org_id, prospect_id, _, _ = await self._parked(
            db_session, setup_org_and_admin, ended_hours_ago=24 * 10
        )

        await svc.roll_forward_missed_meeting(prospect_id, org_id)
        await db_session.commit()
        second = await svc.roll_forward_missed_meeting(prospect_id, org_id)
        await db_session.commit()

        assert second is False
        assert len(await _missed(db_session, prospect_id)) == 1
        count = (
            await db_session.execute(
                select(func.count())
                .select_from(ProspectEventLink)
                .where(ProspectEventLink.prospect_id == prospect_id)
            )
        ).scalar_one()
        assert count == 2

    async def test_nothing_is_recorded_before_attendance_settles(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        svc, org_id, prospect_id, missed, _ = await self._parked(
            db_session, setup_org_and_admin, ended_hours_ago=1
        )

        assert await svc.roll_forward_missed_meeting(prospect_id, org_id) is False
        assert await _missed(db_session, prospect_id) == []
        assert await _links(db_session, prospect_id) == {missed}

    async def test_an_applicant_who_checked_in_is_not_marked_missed(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        svc, org_id, prospect_id, missed, _ = await self._parked(
            db_session, setup_org_and_admin, ended_hours_ago=24 * 10
        )
        db_session.add(
            EventExternalAttendee(
                id=_uid(),
                organization_id=org_id,
                event_id=missed,
                name="Next Meeting",
                email=f"attendee-{_uid()[:8]}@example.com",
                prospect_id=prospect_id,
                checked_in=True,
            )
        )
        await db_session.commit()

        assert await svc.roll_forward_missed_meeting(prospect_id, org_id) is False
        assert await _missed(db_session, prospect_id) == []

    async def test_the_nightly_pass_rolls_a_missed_applicant_forward(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        _, _, prospect_id, missed, upcoming = await self._parked(
            db_session, setup_org_and_admin, ended_hours_ago=24 * 10
        )

        result = await run_prospect_attendance_advance(db_session)

        assert result["rolled_forward"] >= 1
        assert len(await _missed(db_session, prospect_id)) == 1
        assert await _links(db_session, prospect_id) == {missed, upcoming}
