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
- Required document uploads advance only after every configured type is attached
  to the current stage
"""

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.events import check_in_external_attendee
from app.models.event import (
    CheckInWindowType,
    Event,
    EventExternalAttendee,
    EventType,
)
from app.models.medical_screening import (
    ScreeningRecord,
    ScreeningStatus,
    ScreeningType,
)
from app.models.membership_pipeline import PipelineStepType
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


@pytest.fixture
async def interviewer(db_session: AsyncSession, org):
    user_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO users "
            "(id, organization_id, username, first_name, last_name, email, "
            "password_hash, status) VALUES "
            "(:id, :org, :username, 'Ira', 'Viewer', :email, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org,
            "username": f"interviewer-{user_id[:8]}",
            "email": f"interviewer-{user_id[:8]}@example.com",
        },
    )
    await db_session.flush()
    return user_id


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


async def _upload_document(
    svc: MembershipPipelineService,
    prospect,
    org_id: str,
    document_type: str,
    step_id: str | None,
):
    token = _uid()[:8]
    return await svc.add_prospect_document(
        prospect_id=prospect.id,
        organization_id=org_id,
        document_type=document_type,
        file_name=f"{token}.pdf",
        file_path=f"/app/uploads/{token}.pdf",
        step_id=step_id,
    )


# =========================================================================
# Document upload stage
# =========================================================================


class TestDocumentUploadAutoAdvance:
    async def test_partial_upload_defers_then_final_required_type_advances(
        self, db_session: AsyncSession, org
    ):
        svc, prospect, gate = await _pipeline_parked_on(
            db_session,
            org,
            step_type="document_upload",
            config={
                "required_document_types": ["Background Check", "Photo ID"],
                "auto_advance": True,
            },
        )

        await _upload_document(svc, prospect, org, " background check ", gate.id)
        assert await _current_step_id(svc, prospect.id, org) == str(gate.id)

        # Matching is deliberately case-insensitive for these free-text labels.
        await _upload_document(svc, prospect, org, "PHOTO ID", gate.id)
        assert await _current_step_id(svc, prospect.id, org) != str(gate.id)

    async def test_unrelated_type_does_not_satisfy_a_required_type(
        self, db_session: AsyncSession, org
    ):
        svc, prospect, gate = await _pipeline_parked_on(
            db_session,
            org,
            step_type="document_upload",
            config={
                "required_document_types": ["Photo ID"],
                "auto_advance": True,
            },
        )

        await _upload_document(svc, prospect, org, "Resume", gate.id)

        assert await _current_step_id(svc, prospect.id, org) == str(gate.id)

    async def test_documents_on_another_stage_or_without_a_stage_do_not_count(
        self, db_session: AsyncSession, org
    ):
        svc, prospect, gate = await _pipeline_parked_on(
            db_session,
            org,
            step_type="document_upload",
            config={
                "required_document_types": ["Photo ID"],
                "auto_advance": True,
            },
        )
        pipeline = await svc.get_pipeline(prospect.pipeline_id, org)
        other_step = next(
            step for step in pipeline.steps if str(step.id) != str(gate.id)
        )

        await _upload_document(svc, prospect, org, "Photo ID", other_step.id)
        await _upload_document(svc, prospect, org, "Photo ID", None)

        assert await _current_step_id(svc, prospect.id, org) == str(gate.id)

        await _upload_document(svc, prospect, org, "Photo ID", gate.id)
        assert await _current_step_id(svc, prospect.id, org) != str(gate.id)

    async def test_auto_advance_disabled_records_upload_without_moving(
        self, db_session: AsyncSession, org
    ):
        svc, prospect, gate = await _pipeline_parked_on(
            db_session,
            org,
            step_type="document_upload",
            config={"required_document_types": ["Photo ID"], "auto_advance": False},
        )

        document = await _upload_document(svc, prospect, org, "Photo ID", gate.id)

        assert document is not None
        assert await _current_step_id(svc, prospect.id, org) == str(gate.id)


# =========================================================================
# Interview stage updates
# =========================================================================


class TestInterviewUpdateAutoAdvance:
    async def _interview(
        self,
        db_session: AsyncSession,
        org_id: str,
        interviewer_id: str,
        *,
        auto_advance: bool = True,
        step_id: str | None = None,
    ):
        config = {
            "required_count": 1,
            "required_recommendation": "recommend",
        }
        if auto_advance:
            config["auto_advance"] = True
        svc, prospect, gate = await _pipeline_parked_on(
            db_session,
            org_id,
            step_type="interview_requirement",
            config=config,
        )
        interview = await svc.create_interview(
            prospect_id=prospect.id,
            organization_id=org_id,
            interviewer_id=interviewer_id,
            recommendation="undecided",
            step_id=step_id or str(gate.id),
        )
        return svc, prospect, gate, interview

    async def test_required_recommendation_update_advances(
        self, db_session: AsyncSession, org, interviewer
    ):
        svc, prospect, gate, interview = await self._interview(
            db_session, org, interviewer
        )

        await svc.update_interview(
            interview.id, org, interviewer, recommendation="recommend"
        )

        updated = await svc.get_prospect(prospect.id, org)
        assert str(updated.current_step_id) != str(gate.id)
        progress = next(
            p for p in updated.step_progress if str(p.step_id) == str(gate.id)
        )
        assert progress.action_result["interview_id"] == interview.id
        assert progress.completed_by == interviewer

    async def test_update_that_still_does_not_qualify_stays_put(
        self, db_session: AsyncSession, org, interviewer
    ):
        svc, prospect, gate, interview = await self._interview(
            db_session, org, interviewer
        )

        await svc.update_interview(
            interview.id, org, interviewer, recommendation="do_not_recommend"
        )

        assert await _current_step_id(svc, prospect.id, org) == str(gate.id)

    async def test_interview_for_non_current_stage_does_not_advance(
        self, db_session: AsyncSession, org, interviewer
    ):
        svc, prospect, gate = await _pipeline_parked_on(
            db_session,
            org,
            step_type="checkbox",
            config={},
        )
        pipeline = await svc.get_pipeline(prospect.pipeline_id, org)
        later = next(step for step in pipeline.steps if str(step.id) != str(gate.id))
        later.step_type = PipelineStepType.INTERVIEW_REQUIREMENT
        later.config = {
            "required_count": 1,
            "required_recommendation": "recommend",
            "auto_advance": True,
        }
        await db_session.commit()
        interview = await svc.create_interview(
            prospect.id,
            org,
            interviewer,
            recommendation="undecided",
            step_id=str(later.id),
        )

        await svc.update_interview(
            interview.id, org, interviewer, recommendation="recommend"
        )

        assert await _current_step_id(svc, prospect.id, org) == str(gate.id)

    async def test_stage_without_auto_advance_stays_put(
        self, db_session: AsyncSession, org, interviewer
    ):
        svc, prospect, gate, interview = await self._interview(
            db_session, org, interviewer, auto_advance=False
        )

        await svc.update_interview(
            interview.id, org, interviewer, recommendation="recommend"
        )

        assert await _current_step_id(svc, prospect.id, org) == str(gate.id)


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


class TestMeetingAutoAdvanceOnStaffCheckIn:
    """Staff-entered external attendance uses the same pipeline hook."""

    async def _staff_check_in(
        self,
        db_session: AsyncSession,
        org_id: str,
        event: Event,
        prospect_id: str | None,
    ) -> EventExternalAttendee:
        attendee = EventExternalAttendee(
            id=_uid(),
            organization_id=org_id,
            event_id=str(event.id),
            name="Dana Reed",
            email=f"staff-{_uid()[:8]}@example.com",
            prospect_id=prospect_id,
        )
        db_session.add_all([event, attendee])
        await db_session.commit()

        await check_in_external_attendee(
            event_id=uuid.UUID(str(event.id)),
            attendee_id=uuid.UUID(str(attendee.id)),
            db=db_session,
            current_user=SimpleNamespace(organization_id=org_id),
        )
        await db_session.refresh(attendee)
        return attendee

    async def test_linked_prospect_advances(self, db_session: AsyncSession, org):
        svc, prospect, gate = await _pipeline_parked_on(
            db_session,
            org,
            step_type="meeting",
            config={
                "linked_event_type": "business_meeting",
                "auto_advance": True,
            },
        )

        attendee = await self._staff_check_in(
            db_session, org, _make_event(org), prospect.id
        )

        assert attendee.checked_in is True
        assert await _current_step_id(svc, prospect.id, org) != str(gate.id)

    async def test_unrelated_event_only_records_attendance(
        self, db_session: AsyncSession, org
    ):
        svc, prospect, gate = await _pipeline_parked_on(
            db_session,
            org,
            step_type="meeting",
            config={
                "linked_event_type": "business_meeting",
                "auto_advance": True,
            },
        )
        event = _make_event(org, event_type=EventType.TRAINING)

        attendee = await self._staff_check_in(db_session, org, event, prospect.id)

        assert attendee.checked_in is True
        assert await _current_step_id(svc, prospect.id, org) == str(gate.id)

    async def test_attendee_without_prospect_link_only_records_attendance(
        self, db_session: AsyncSession, org
    ):
        attendee = await self._staff_check_in(db_session, org, _make_event(org), None)

        assert attendee.checked_in is True
        assert attendee.prospect_id is None

    async def test_auto_advance_disabled_only_records_attendance(
        self, db_session: AsyncSession, org
    ):
        svc, prospect, gate = await _pipeline_parked_on(
            db_session,
            org,
            step_type="meeting",
            config={"linked_event_type": "business_meeting", "auto_advance": False},
        )

        attendee = await self._staff_check_in(
            db_session, org, _make_event(org), prospect.id
        )

        assert attendee.checked_in is True
        assert await _current_step_id(svc, prospect.id, org) == str(gate.id)
