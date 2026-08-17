"""
Pipeline Stage Auto-Advance Tests

The stage builder offers an "auto-advance" box on several stage types, but the
backend only ever honoured it where a completion event happened to be wired up.
A medical screening stage and a meeting stage both advertised the box and both
ignored it: coordinators ticked it, applicants cleared their physical or signed
in at the meeting, and every one of them still had to be moved by hand.

Covered here:
- A cleared screening advances a prospect parked on a medical screening stage
- A partially cleared requirement defers rather than advances
- A non-cleared status is not treated as evidence
- The box is an opt-in: without it, nothing moves
- Attendance at the linked meeting advances a meeting stage
- Attendance at an unrelated event does not
- Which event a meeting stage is waiting on (including recurring stages, whose
  pinned event id goes stale the moment that occurrence passes)
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import CheckInWindowType, Event, EventType
from app.models.medical_screening import (
    ScreeningRecord,
    ScreeningStatus,
    ScreeningType,
)
from app.services.guest_check_in_service import GuestCheckInService
from app.services.medical_screening_service import MedicalScreeningService
from app.services.membership_pipeline_service import MembershipPipelineService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def org(db_session: AsyncSession):
    org_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "name": "Auto Advance Dept", "slug": f"aa-{org_id[:8]}"},
    )
    await db_session.flush()
    return org_id


async def _pipeline_parked_on(
    db_session: AsyncSession,
    org_id: str,
    *,
    step_type: str,
    config: dict,
):
    """Build a two-stage pipeline and park a prospect on the first stage.

    The second stage exists only so there is somewhere to advance *to* — a
    prospect on the final stage takes the transfer path instead.
    """
    svc = MembershipPipelineService(db_session)
    pipeline = await svc.create_pipeline(organization_id=org_id, name="Recruit")
    target = await svc.add_step(
        pipeline.id,
        org_id,
        {
            "name": "Gate",
            "step_type": step_type,
            "sort_order": 0,
            "config": config,
        },
    )
    await svc.add_step(
        pipeline.id,
        org_id,
        {"name": "After", "step_type": "checkbox", "sort_order": 1},
    )
    prospect = await svc.create_prospect(
        organization_id=org_id,
        data={
            "first_name": "Dana",
            "last_name": "Reed",
            "email": f"dana-{_uid()[:8]}@example.com",
            "pipeline_id": pipeline.id,
        },
    )
    assert str(prospect.current_step_id) == str(target.id)
    return svc, prospect, target


async def _current_step_id(svc, prospect_id, org_id) -> str:
    prospect = await svc.get_prospect(prospect_id, org_id)
    return str(prospect.current_step_id)


# =========================================================================
# Medical screening stage
# =========================================================================


class TestMedicalScreeningAutoAdvance:

    async def _record(
        self,
        db_session: AsyncSession,
        org_id: str,
        prospect_id: str,
        *,
        screening_type: ScreeningType,
        status: ScreeningStatus,
    ) -> ScreeningRecord:
        record = ScreeningRecord(
            id=_uid(),
            organization_id=org_id,
            prospect_id=prospect_id,
            screening_type=screening_type,
            status=status,
        )
        db_session.add(record)
        await db_session.flush()
        return record

    async def test_cleared_screening_advances_the_prospect(
        self, db_session: AsyncSession, org
    ):
        svc, prospect, gate = await _pipeline_parked_on(
            db_session,
            org,
            step_type="medical_screening",
            config={
                "required_screenings": ["physical_exam"],
                "require_all_passed": True,
                "auto_advance": True,
            },
        )
        record = await self._record(
            db_session,
            org,
            prospect.id,
            screening_type=ScreeningType.PHYSICAL_EXAM,
            status=ScreeningStatus.PASSED,
        )

        advanced = await MedicalScreeningService(db_session).try_advance_pipeline_stage(
            record, org, None
        )

        assert advanced is True
        assert await _current_step_id(svc, prospect.id, org) != str(gate.id)

    async def test_without_the_opt_in_nothing_moves(
        self, db_session: AsyncSession, org
    ):
        """The box is an opt-in; a cleared screening alone must not advance."""
        svc, prospect, gate = await _pipeline_parked_on(
            db_session,
            org,
            step_type="medical_screening",
            config={
                "required_screenings": ["physical_exam"],
                "require_all_passed": True,
            },
        )
        record = await self._record(
            db_session,
            org,
            prospect.id,
            screening_type=ScreeningType.PHYSICAL_EXAM,
            status=ScreeningStatus.PASSED,
        )

        advanced = await MedicalScreeningService(db_session).try_advance_pipeline_stage(
            record, org, None
        )

        assert advanced is False
        assert await _current_step_id(svc, prospect.id, org) == str(gate.id)

    async def test_partial_clearance_defers_then_completion_advances(
        self, db_session: AsyncSession, org
    ):
        """Clearing one of two required screenings must not open the gate."""
        svc, prospect, gate = await _pipeline_parked_on(
            db_session,
            org,
            step_type="medical_screening",
            config={
                "required_screenings": ["physical_exam", "drug_screening"],
                "require_all_passed": True,
                "auto_advance": True,
            },
        )
        med = MedicalScreeningService(db_session)

        first = await self._record(
            db_session,
            org,
            prospect.id,
            screening_type=ScreeningType.PHYSICAL_EXAM,
            status=ScreeningStatus.PASSED,
        )
        assert await med.try_advance_pipeline_stage(first, org, None) is False
        assert await _current_step_id(svc, prospect.id, org) == str(gate.id)

        second = await self._record(
            db_session,
            org,
            prospect.id,
            screening_type=ScreeningType.DRUG_SCREENING,
            status=ScreeningStatus.PASSED,
        )
        assert await med.try_advance_pipeline_stage(second, org, None) is True
        assert await _current_step_id(svc, prospect.id, org) != str(gate.id)

    @pytest.mark.parametrize(
        "status",
        [ScreeningStatus.SCHEDULED, ScreeningStatus.FAILED, ScreeningStatus.WAIVED],
    )
    async def test_uncleared_result_is_not_evidence(
        self, db_session: AsyncSession, org, status
    ):
        svc, prospect, gate = await _pipeline_parked_on(
            db_session,
            org,
            step_type="medical_screening",
            config={
                "required_screenings": ["physical_exam"],
                "require_all_passed": True,
                "auto_advance": True,
            },
        )
        record = await self._record(
            db_session,
            org,
            prospect.id,
            screening_type=ScreeningType.PHYSICAL_EXAM,
            status=status,
        )

        advanced = await MedicalScreeningService(db_session).try_advance_pipeline_stage(
            record, org, None
        )

        assert advanced is False
        assert await _current_step_id(svc, prospect.id, org) == str(gate.id)

    async def test_screening_for_a_member_never_touches_a_pipeline(
        self, db_session: AsyncSession, org
    ):
        """A record with no prospect_id belongs to an active member."""
        record = ScreeningRecord(
            id=_uid(),
            organization_id=org,
            prospect_id=None,
            screening_type=ScreeningType.PHYSICAL_EXAM,
            status=ScreeningStatus.PASSED,
        )
        db_session.add(record)
        await db_session.flush()

        advanced = await MedicalScreeningService(db_session).try_advance_pipeline_stage(
            record, org, None
        )

        assert advanced is False

    async def test_a_different_stage_type_is_left_alone(
        self, db_session: AsyncSession, org
    ):
        """A cleared screening must not complete whatever stage happens to be
        current — only a medical screening stage waits on this evidence."""
        svc, prospect, gate = await _pipeline_parked_on(
            db_session,
            org,
            step_type="checkbox",
            config={"auto_advance": True},
        )
        record = await self._record(
            db_session,
            org,
            prospect.id,
            screening_type=ScreeningType.PHYSICAL_EXAM,
            status=ScreeningStatus.PASSED,
        )

        advanced = await MedicalScreeningService(db_session).try_advance_pipeline_stage(
            record, org, None
        )

        assert advanced is False
        assert await _current_step_id(svc, prospect.id, org) == str(gate.id)


# =========================================================================
# Meeting stage
# =========================================================================


def _make_event(org_id: str, **overrides) -> Event:
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


class TestMeetingStageMatching:
    """The pure question of which event a meeting stage is waiting on."""

    def test_stage_naming_no_event_takes_any_attendance(self):
        event = _make_event(_uid())
        assert GuestCheckInService._meeting_config_matches_event({}, event) is True

    def test_event_type_must_match(self):
        event = _make_event(_uid(), event_type=EventType.TRAINING)
        config = {"linked_event_type": "business_meeting"}
        assert GuestCheckInService._meeting_config_matches_event(config, event) is False

    def test_category_narrows_within_a_type(self):
        event = _make_event(_uid(), custom_category="Recruit Night")
        config = {
            "linked_event_type": "business_meeting",
            "linked_event_category": "Officer Session",
        }
        assert GuestCheckInService._meeting_config_matches_event(config, event) is False

        config["linked_event_category"] = "Recruit Night"
        assert GuestCheckInService._meeting_config_matches_event(config, event) is True

    def test_recurring_stage_matches_a_later_occurrence(self):
        """The builder pins linked_event_id to the next occurrence at config
        time. Grading that id first would strand the stage forever once that
        occurrence passed, so the chosen type is what decides."""
        march = _make_event(_uid())
        config = {
            "linked_event_type": "business_meeting",
            "linked_event_id": _uid(),  # January's meeting, long finished
        }
        assert GuestCheckInService._meeting_config_matches_event(config, march) is True

    def test_pinned_id_decides_when_no_type_was_chosen(self):
        event = _make_event(_uid())
        assert (
            GuestCheckInService._meeting_config_matches_event(
                {"linked_event_id": event.id}, event
            )
            is True
        )
        assert (
            GuestCheckInService._meeting_config_matches_event(
                {"linked_event_id": _uid()}, event
            )
            is False
        )


class TestMeetingAutoAdvanceOnCheckIn:

    async def _check_in(self, db_session, event, org_id, email):
        return await GuestCheckInService(db_session).check_in_guest(
            event=event,
            organization_id=org_id,
            first_name="Dana",
            last_name="Reed",
            email=email,
        )

    async def test_attendance_advances_the_meeting_stage(
        self, db_session: AsyncSession, org
    ):
        svc, prospect, gate = await _pipeline_parked_on(
            db_session,
            org,
            step_type="meeting",
            config={
                "meeting_type": "business_meeting",
                "linked_event_type": "business_meeting",
                "auto_advance": True,
            },
        )
        event = _make_event(org)
        db_session.add(event)
        await db_session.flush()

        attendee, error, _ = await self._check_in(
            db_session, event, org, prospect.email
        )

        assert error is None
        assert attendee is not None
        assert await _current_step_id(svc, prospect.id, org) != str(gate.id)

    async def test_attendance_at_an_unrelated_event_does_not_advance(
        self, db_session: AsyncSession, org
    ):
        svc, prospect, gate = await _pipeline_parked_on(
            db_session,
            org,
            step_type="meeting",
            config={
                "meeting_type": "business_meeting",
                "linked_event_type": "business_meeting",
                "auto_advance": True,
            },
        )
        training = _make_event(org, event_type=EventType.TRAINING, title="Ladders")
        db_session.add(training)
        await db_session.flush()

        _, error, _ = await self._check_in(db_session, training, org, prospect.email)

        assert error is None
        assert await _current_step_id(svc, prospect.id, org) == str(gate.id)

    async def test_without_the_opt_in_attendance_only_records_attendance(
        self, db_session: AsyncSession, org
    ):
        svc, prospect, gate = await _pipeline_parked_on(
            db_session,
            org,
            step_type="meeting",
            config={
                "meeting_type": "business_meeting",
                "linked_event_type": "business_meeting",
            },
        )
        event = _make_event(org)
        db_session.add(event)
        await db_session.flush()

        attendee, error, _ = await self._check_in(
            db_session, event, org, prospect.email
        )

        assert error is None
        assert attendee is not None
        assert attendee.checked_in is True
        assert await _current_step_id(svc, prospect.id, org) == str(gate.id)
