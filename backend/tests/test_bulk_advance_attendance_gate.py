"""A bulk advance is held to the meeting-attendance gate; a single one is not.

``_assert_meeting_attended`` runs only when ``complete_step`` is told the
completion has no per-applicant judgement behind it. That exemption is written
for one applicant at a time — "a coordinator who watched somebody walk in is
better evidence of attendance than any record" — and the bulk path inherited it
wholesale. The board lets cards be ticked across every column, so a bulk
selection routinely spans stages and nobody formed a view about any single one
of them.

Every other gate already refused per item on this path and reported it in the
response. The meeting gate was the only one a bulk advance walked straight
through, which made bulk the easiest way to move an applicant past an interview
they had not attended — and the way that gave the coordinator no sign it had
happened.
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


class TestASingleAdvanceKeepsItsExemption:
    async def test_a_coordinator_still_advances_one_by_hand(
        self, db_session: AsyncSession, org, admin
    ):
        """The exemption exists for the coordinator who watched them arrive
        and found no record of it. Narrowing bulk must not take that away."""
        svc = MembershipPipelineService(db_session)
        pipeline, gate = await _pipeline_on_a_meeting_stage(svc, org)
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
