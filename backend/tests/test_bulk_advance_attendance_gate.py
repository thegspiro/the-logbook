"""A meeting stage that names its event is an attendance requirement.

The gate began by reading the *caller*: it ran only when ``complete_step`` was
told the completion had no per-applicant judgement behind it, on the reasoning
that a coordinator who watched somebody walk in is better evidence than any
record. A bulk advance was then exempt too, which made it the easiest way past
an unattended meeting and gave the coordinator no sign it had happened.

Narrowing that to the bulk path alone left the gate arguing with itself: the
same coordinator, applicant and stage were refused in one click and allowed one
card at a time, on a stage whose own text said "attend a business meeting"
either way. What is graded is now decided by the stage. A stage that names its
event is enforced on every path, a hand advance included; one that names none
can never be graded and still takes the coordinator's word.

Every other gate already refused per item on the bulk path and reported it in
the response, and that per-item contract is unchanged here.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import CheckInWindowType, Event, EventType
from app.services.guest_check_in_service import GuestCheckInService
from app.services.membership_pipeline_service import MembershipPipelineService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def org(db_session: AsyncSession):
    org_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone)"
            " VALUES (:id, 'Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"bg-{org_id[:8]}"},
    )
    await db_session.flush()
    return org_id


@pytest.fixture
async def admin(db_session: AsyncSession, org):
    user_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) VALUES "
            "(:id, :org, :un, 'Avery', 'Dean', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org,
            "un": f"admin-{user_id[:8]}",
            "em": f"admin-{user_id[:8]}@test.example",
        },
    )
    await db_session.flush()
    return user_id


def _meeting_event(org_id: str, **overrides) -> Event:
    now = datetime.now(timezone.utc)
    defaults = dict(
        id=_uid(),
        organization_id=org_id,
        title="Monthly Business Meeting",
        event_type=EventType.BUSINESS_MEETING,
        start_datetime=now - timedelta(minutes=10),
        end_datetime=now + timedelta(hours=2),
        check_in_window_type=CheckInWindowType.FLEXIBLE,
        allow_guest_check_in=True,
        guest_check_in_creates_prospect=True,
        is_cancelled=False,
    )
    defaults.update(overrides)
    return Event(**defaults)


async def _pipeline_on_a_meeting_stage(svc, org_id: str):
    pipeline = await svc.create_pipeline(organization_id=org_id, name="Recruit")
    gate = await svc.add_step(
        pipeline.id,
        org_id,
        {
            "name": "Chief Interview",
            "step_type": "meeting",
            "sort_order": 0,
            "config": {"linked_event_type": "business_meeting"},
        },
    )
    await svc.add_step(
        pipeline.id,
        org_id,
        {"name": "After", "step_type": "checkbox", "sort_order": 1},
    )
    return pipeline, gate


async def _prospect(svc, org_id: str, pipeline_id: str, last_name: str):
    return await svc.create_prospect(
        organization_id=org_id,
        data={
            "first_name": "Dana",
            "last_name": last_name,
            "email": f"d-{_uid()[:8]}@example.com",
            "pipeline_id": pipeline_id,
        },
    )


async def _current_step_id(svc, prospect_id: str, org_id: str) -> str:
    return str((await svc.get_prospect(prospect_id, org_id)).current_step_id)


class TestBulkAdvanceIsHeldToTheGate:
    async def test_no_attendance_refuses_and_says_so(
        self, db_session: AsyncSession, org, admin
    ):
        svc = MembershipPipelineService(db_session)
        pipeline, gate = await _pipeline_on_a_meeting_stage(svc, org)
        prospect = await _prospect(svc, org, pipeline.id, "Reed")

        results = await svc.bulk_advance_prospects([str(prospect.id)], org, admin)

        assert len(results) == 1
        assert results[0]["succeeded"] is False
        # The coordinator is told which stage refused and why, rather than the
        # applicant moving silently.
        assert "Chief Interview" in results[0]["error"]
        assert await _current_step_id(svc, prospect.id, org) == str(gate.id)

    async def test_recorded_attendance_lets_the_bulk_advance_through(
        self, db_session: AsyncSession, org, admin
    ):
        """The gate is evidence-based, not a blanket refusal of bulk."""
        svc = MembershipPipelineService(db_session)
        pipeline, gate = await _pipeline_on_a_meeting_stage(svc, org)
        prospect = await _prospect(svc, org, pipeline.id, "Marsh")
        event = _meeting_event(org)
        db_session.add(event)
        await db_session.flush()
        await GuestCheckInService(db_session).check_in_guest(
            event=event,
            organization_id=org,
            first_name="Dana",
            last_name="Marsh",
            email=prospect.email,
        )
        # Put them back on the meeting stage: the check-in hook does not
        # advance a stage without auto_advance, but the attendance is real.
        await db_session.execute(
            text("UPDATE prospective_members SET current_step_id = :s WHERE id = :p"),
            {"s": gate.id, "p": prospect.id},
        )
        await db_session.commit()

        results = await svc.bulk_advance_prospects([str(prospect.id)], org, admin)

        assert results[0]["succeeded"] is True, results[0].get("error")
        assert await _current_step_id(svc, prospect.id, org) != str(gate.id)

    async def test_one_refusal_does_not_stop_the_others(
        self, db_session: AsyncSession, org, admin
    ):
        """The per-item contract still holds: the applicant with attendance
        moves, the one without is reported, neither blocks the other."""
        svc = MembershipPipelineService(db_session)
        pipeline, gate = await _pipeline_on_a_meeting_stage(svc, org)
        attended = await _prospect(svc, org, pipeline.id, "Marsh")
        absent = await _prospect(svc, org, pipeline.id, "Reed")
        event = _meeting_event(org)
        db_session.add(event)
        await db_session.flush()
        await GuestCheckInService(db_session).check_in_guest(
            event=event,
            organization_id=org,
            first_name="Dana",
            last_name="Marsh",
            email=attended.email,
        )
        await db_session.execute(
            text("UPDATE prospective_members SET current_step_id = :s WHERE id = :p"),
            {"s": gate.id, "p": attended.id},
        )
        await db_session.commit()

        results = await svc.bulk_advance_prospects(
            [str(attended.id), str(absent.id)], org, admin
        )

        by_id = {r["prospect_id"]: r for r in results}
        assert by_id[str(attended.id)]["succeeded"] is True
        assert by_id[str(absent.id)]["succeeded"] is False
        assert await _current_step_id(svc, attended.id, org) != str(gate.id)
        assert await _current_step_id(svc, absent.id, org) == str(gate.id)


class TestASingleAdvanceIsHeldToItToo:
    """What the caller is stopped mattering; what the stage names decides.

    Holding bulk and not the single advance left the gate arguing with itself:
    the same coordinator, the same applicant and the same stage were refused in
    one click and allowed in another, so the way past an unattended meeting was
    simply to advance the cards one at a time.
    """

    async def test_a_stage_that_names_its_event_refuses_a_hand_advance(
        self, db_session: AsyncSession, org, admin
    ):
        svc = MembershipPipelineService(db_session)
        pipeline, gate = await _pipeline_on_a_meeting_stage(svc, org)
        prospect = await _prospect(svc, org, pipeline.id, "Reed")

        with pytest.raises(ValueError, match="No attendance has been recorded"):
            await svc.advance_prospect(prospect.id, org, admin)

        assert await _current_step_id(svc, prospect.id, org) == str(gate.id)

    async def test_a_stage_that_names_no_event_still_advances_by_hand(
        self, db_session: AsyncSession, org, admin
    ):
        """ "Meet with the Chief" is an arrangement, not a record. Nothing can
        ever grade it, so the coordinator's word remains the evidence."""
        svc = MembershipPipelineService(db_session)
        pipeline = await svc.create_pipeline(organization_id=org, name="Recruit")
        gate = await svc.add_step(
            pipeline.id,
            org,
            {
                "name": "Chief Meeting",
                "step_type": "meeting",
                "sort_order": 0,
                # The stage builder's own default: a meeting type and nothing
                # that names an event.
                "config": {"meeting_type": "chief_meeting"},
            },
        )
        await svc.add_step(
            pipeline.id,
            org,
            {"name": "After", "step_type": "checkbox", "sort_order": 1},
        )
        prospect = await _prospect(svc, org, pipeline.id, "Reed")

        await svc.advance_prospect(prospect.id, org, admin)

        assert await _current_step_id(svc, prospect.id, org) != str(gate.id)

    async def test_other_stage_gates_are_unchanged_by_the_flag(
        self, db_session: AsyncSession, org, admin
    ):
        """Only the meeting gate reads `automated`, so a bulk advance off a
        checklist stage refuses exactly as it did before."""
        svc = MembershipPipelineService(db_session)
        pipeline = await svc.create_pipeline(organization_id=org, name="Recruit")
        gate = await svc.add_step(
            pipeline.id,
            org,
            {
                "name": "Orientation",
                "step_type": "checklist",
                "sort_order": 0,
                "config": {
                    "items": ["Gear issued", "Station tour"],
                    "require_all": True,
                },
            },
        )
        await svc.add_step(
            pipeline.id,
            org,
            {"name": "After", "step_type": "checkbox", "sort_order": 1},
        )
        prospect = await _prospect(svc, org, pipeline.id, "Reed")

        results = await svc.bulk_advance_prospects([str(prospect.id)], org, admin)

        assert results[0]["succeeded"] is False
        assert "checklist items" in results[0]["error"]
        assert await _current_step_id(svc, prospect.id, org) == str(gate.id)
