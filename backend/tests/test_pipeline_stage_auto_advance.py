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
- A meeting stage that names its event is an attendance requirement on every
  path, the hand advance included; one that names none still takes the
  coordinator's word
- Attendance predating the application is not evidence, while the sign-in that
  opened the record still is
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

    def test_stage_naming_no_event_matches_nothing(self):
        """Reversed on 2026-09-13. This asserted the opposite — a stage naming
        no event took *any* recorded attendance — on the reasoning that a
        stage which cannot discriminate should accept whatever arrives. That
        assumes the only attendance a prospect accrues is at the meeting the
        stage is about, and guest check-in is org-wide: departments enable it
        on open houses, fundraisers and public education, which is exactly
        where a prospective member turns up casually. So a stage reading
        "Meeting with the Fire Chief" advanced on a pancake breakfast.
        """
        event = _make_event(_uid())
        assert GuestCheckInService._meeting_config_matches_event({}, event) is False

    def test_a_meeting_type_label_is_not_an_event_type(self):
        """``meeting_type`` is the stage builder's default and names the
        stage's purpose; nothing in the matcher reads it. It must not be
        mistaken for the linked event type (CLAUDE.md Pitfall #19)."""
        event = _make_event(_uid())
        config = {"meeting_type": "chief_meeting", "meeting_description": ""}
        assert GuestCheckInService._meeting_config_matches_event(config, event) is False

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


class TestMeetingStageWithNoLinkedEvent:
    """A meeting stage that names no event advances on nothing.

    This is the stage builder's *default* shape, not an exotic one:
    ``DEFAULT_STAGE_CONFIGS.meeting`` sets only ``meeting_type`` and
    ``meeting_description``, "Auto-Link Event Type" starts at None, and
    nothing validated it. Every other test in this file sets
    ``linked_event_type``, so the shape a coordinator actually produces was
    never exercised — and it matched every event in the organisation.

    Guest check-in is org-wide and departments enable it on their public
    events, so the attendance a prospect is most likely to accrue is at an
    open house or a fundraiser, not at the chief's interview.
    """

    async def _check_in(self, db_session, event, org_id, email):
        return await GuestCheckInService(db_session).check_in_guest(
            event=event,
            organization_id=org_id,
            first_name="Dana",
            last_name="Reed",
            email=email,
        )

    async def _parked(self, db_session, org):
        return await _pipeline_parked_on(
            db_session,
            org,
            step_type="meeting",
            # Verbatim the frontend default, plus the auto-advance tick.
            config={
                "meeting_type": "chief_meeting",
                "meeting_description": "",
                "auto_advance": True,
            },
        )

    async def test_an_unrelated_event_does_not_advance_it(
        self, db_session: AsyncSession, org
    ):
        """The pancake breakfast: a chief-interview stage advancing on a
        public-education event nobody thought was part of the pipeline."""
        svc, prospect, gate = await self._parked(db_session, org)
        fundraiser = _make_event(
            org,
            event_type=EventType.PUBLIC_EDUCATION,
            title="Pancake Breakfast Fundraiser",
        )
        db_session.add(fundraiser)
        await db_session.flush()

        attendee, error, _ = await self._check_in(
            db_session, fundraiser, org, prospect.email
        )

        assert error is None
        assert attendee is not None
        assert attendee.checked_in is True
        assert await _current_step_id(svc, prospect.id, org) == str(gate.id)

    async def test_even_a_plausible_looking_event_does_not_advance_it(
        self, db_session: AsyncSession, org
    ):
        """Not "the wrong event type" — the stage names no type at all, so
        there is nothing for a business meeting to match either."""
        svc, prospect, gate = await self._parked(db_session, org)
        meeting = _make_event(org)
        db_session.add(meeting)
        await db_session.flush()

        _, error, _ = await self._check_in(db_session, meeting, org, prospect.email)

        assert error is None
        assert await _current_step_id(svc, prospect.id, org) == str(gate.id)

    async def test_the_gate_names_the_stage_config_as_the_reason(
        self, db_session: AsyncSession, org
    ):
        """A missing link and a missing attendance record have different
        remedies, so the refusal must not ask for attendance it would
        ignore."""
        svc, prospect, gate = await self._parked(db_session, org)
        full = await svc.get_prospect(prospect.id, org)
        step = next(s for s in full.pipeline.steps if str(s.id) == str(gate.id))

        with pytest.raises(ValueError, match="no linked event") as excinfo:
            await svc._validate_step_completion(full, step, None, automated=True)

        # And it names the remedy, which is a change to the stage rather than
        # to the applicant's attendance record.
        assert "Auto-Link Event Type" in str(excinfo.value)

    async def test_a_coordinator_can_still_advance_by_hand(
        self, db_session: AsyncSession, org
    ):
        """Withholding the automated advance must not strand the applicant —
        the manual path stays ungated, as it is for unrecorded attendance."""
        svc, prospect, gate = await self._parked(db_session, org)

        await svc.advance_prospect(prospect.id, org, advanced_by=None)

        assert await _current_step_id(svc, prospect.id, org) != str(gate.id)

    async def test_setting_an_event_type_restores_the_advance(
        self, db_session: AsyncSession, org
    ):
        """The remedy the refusal names actually works."""
        svc, prospect, gate = await _pipeline_parked_on(
            db_session,
            org,
            step_type="meeting",
            config={
                "meeting_type": "chief_meeting",
                "linked_event_type": "business_meeting",
                "auto_advance": True,
            },
        )
        meeting = _make_event(org)
        db_session.add(meeting)
        await db_session.flush()

        _, error, _ = await self._check_in(db_session, meeting, org, prospect.email)

        assert error is None
        assert await _current_step_id(svc, prospect.id, org) != str(gate.id)


class TestMeetingStageNeedsRealAttendance:
    """The reported bug, from four directions.

    A meeting stage marked Required, ticked "auto-advance when attendance is
    recorded" and auto-linked to a meeting six days away advanced an applicant
    who had not been anywhere near it. A meeting stage was the one stage type
    with no completion gate: the validator had no case for it, so anything that
    reached complete_step completed it, and the auto-advance helper never asked
    what *kind* of stage it was advancing.
    """

    @staticmethod
    async def _meeting_stage(db_session: AsyncSession, org: str):
        return await _pipeline_parked_on(
            db_session,
            org,
            step_type="meeting",
            config={
                "meeting_type": "business_meeting",
                "linked_event_type": "business_meeting",
                "auto_advance": True,
            },
        )

    async def test_a_document_upload_is_not_attendance(
        self, db_session: AsyncSession, org
    ):
        """The frontend sends whatever stage the applicant is parked on as the
        upload's step_id, so before the type check any upload completed the
        meeting stage the applicant happened to be sitting on."""
        svc, prospect, gate = await self._meeting_stage(db_session, org)

        await _upload_document(svc, prospect, org, "Background Check", gate.id)

        assert await _current_step_id(svc, prospect.id, org) == str(gate.id)

    async def test_a_recorded_interview_is_not_attendance(
        self, db_session: AsyncSession, org
    ):
        """An interview submitted without a stage defaults to the current one,
        which was the second way into the same hole."""
        svc, prospect, gate = await self._meeting_stage(db_session, org)

        await svc.create_interview(
            prospect_id=prospect.id,
            organization_id=org,
            interviewer_id=None,
            notes="Chatted at the open house",
        )

        assert await _current_step_id(svc, prospect.id, org) == str(gate.id)

    async def test_a_check_in_to_a_meeting_that_has_not_started_does_not_advance(
        self, db_session: AsyncSession, org
    ):
        """Staff may record attendance whenever they need to, including ahead
        of the event. What must not follow is a pipeline advance: the meeting
        has not happened, so nobody has attended it."""
        svc, prospect, gate = await self._meeting_stage(db_session, org)
        now = datetime.now(timezone.utc)
        future = _make_event(
            org,
            title="Monthly Prospective Member Interest Meeting",
            start_datetime=now + timedelta(days=6),
            end_datetime=now + timedelta(days=6, hours=2),
        )
        attendee = EventExternalAttendee(
            id=_uid(),
            organization_id=org,
            event_id=str(future.id),
            name="Dana Reed",
            email=f"staff-{_uid()[:8]}@example.com",
            prospect_id=prospect.id,
            checked_in=True,
            checked_in_at=now,
        )
        db_session.add_all([future, attendee])
        await db_session.commit()

        advanced = await GuestCheckInService(
            db_session
        ).try_advance_attendance_pipeline(str(prospect.id), future)

        assert advanced is False
        assert await _current_step_id(svc, prospect.id, org) == str(gate.id)

    async def test_the_auto_linked_event_is_not_itself_evidence(
        self, db_session: AsyncSession, org
    ):
        """Entering a meeting stage auto-links the next *future* matching
        event. Treating that link as attendance would put the bug straight
        back, so the gate reads check-in records and never the link."""
        svc, prospect, gate = await self._meeting_stage(db_session, org)
        now = datetime.now(timezone.utc)
        upcoming = _make_event(
            org,
            start_datetime=now + timedelta(days=6),
            end_datetime=now + timedelta(days=6, hours=2),
        )
        db_session.add(upcoming)
        await db_session.commit()
        await svc.link_event(
            prospect_id=str(prospect.id),
            organization_id=org,
            event_id=str(upcoming.id),
            linked_by=None,
        )

        advanced = await svc._try_auto_advance_step(
            prospect_id=str(prospect.id),
            organization_id=org,
            step_id=str(gate.id),
            completed_by=None,
            trigger="event check-in",
            for_step_types={PipelineStepType.MEETING},
        )

        assert advanced is False
        assert await _current_step_id(svc, prospect.id, org) == str(gate.id)

    async def test_a_hand_advance_is_refused_when_the_stage_names_its_event(
        self, db_session: AsyncSession, org
    ):
        """This stage names the event, so it is an attendance requirement and
        the hand advance is held to it too.

        The gate used to read the caller rather than the stage, which made a
        bulk advance refuse what the same coordinator could do one card at a
        time — on a stage whose text said "attend a business meeting" either
        way. The remedy is to record the attendance, not to route around it,
        so the refusal names it.
        """
        svc, prospect, gate = await self._meeting_stage(db_session, org)

        with pytest.raises(
            ValueError, match="No attendance has been recorded"
        ) as refusal:
            await svc.advance_prospect(
                prospect_id=str(prospect.id),
                organization_id=org,
                advanced_by=None,
                notes="Attended; sign-in sheet was not entered",
            )

        assert "check them in" in str(refusal.value)
        assert await _current_step_id(svc, prospect.id, org) == str(gate.id)

    async def test_an_early_arrival_inside_the_check_in_window_advances(
        self, db_session: AsyncSession, org
    ):
        """Check-in windows open 15–60 minutes early, so an applicant who
        turns up on time and signs in before the hour is genuinely present.
        Grading on start_datetime refused exactly them — and since nobody
        checks in twice, no later event retried the gate, leaving a stage
        stuck on attendance that had actually been recorded."""
        svc, prospect, gate = await self._meeting_stage(db_session, org)
        now = datetime.now(timezone.utc)
        # FLEXIBLE with no explicit lead time opens check-in an hour early.
        starting_soon = _make_event(
            org,
            start_datetime=now + timedelta(minutes=20),
            end_datetime=now + timedelta(hours=2),
        )
        db_session.add(starting_soon)
        await db_session.flush()

        attendee, error, _ = await GuestCheckInService(db_session).check_in_guest(
            event=starting_soon,
            organization_id=org,
            first_name="Dana",
            last_name="Reed",
            email=prospect.email,
        )

        assert error is None
        assert attendee.checked_in is True
        assert await _current_step_id(svc, prospect.id, org) != str(gate.id)

    async def test_a_check_in_before_the_window_opens_does_not_advance(
        self, db_session: AsyncSession, org
    ):
        """The window, not the start time, is what separates presence from
        paperwork: a staff check-in is written by hand at any time, so an
        entry made for next week's meeting must still advance nobody."""
        svc, prospect, gate = await self._meeting_stage(db_session, org)
        now = datetime.now(timezone.utc)
        next_week = _make_event(
            org,
            start_datetime=now + timedelta(days=7),
            end_datetime=now + timedelta(days=7, hours=2),
        )
        attendee = EventExternalAttendee(
            id=_uid(),
            organization_id=org,
            event_id=str(next_week.id),
            name="Dana Reed",
            email=f"staff-{_uid()[:8]}@example.com",
            prospect_id=prospect.id,
            checked_in=True,
            checked_in_at=now,
        )
        db_session.add_all([next_week, attendee])
        await db_session.commit()

        advanced = await GuestCheckInService(
            db_session
        ).try_advance_attendance_pipeline(str(prospect.id), next_week)

        assert advanced is False
        assert await _current_step_id(svc, prospect.id, org) == str(gate.id)


class TestAttendanceMustPostdateTheApplication:
    """A prospect's attendance history is unbounded in time; the stage is not.

    The gate asked only "is there a matching check-in for this applicant",
    never "since when", so every check-in the person had ever made graded the
    same. That is worst in the flow the module is built around: the kiosk opens
    a prospect record from a guest sign-in at a business meeting, so an
    applicant recruited that way carries a matching business-meeting attendance
    from the moment they exist — and a later "attend a business meeting" stage
    was satisfied by the sign-in that created them, without their ever
    attending a second one.

    Measured against the event's check-in window closing rather than the
    check-in instant: the kiosk writes the prospect and the attendance within
    milliseconds, in an order nothing should depend on.
    """

    @staticmethod
    async def _meeting_stage(db_session: AsyncSession, org: str):
        return await _pipeline_parked_on(
            db_session,
            org,
            step_type="meeting",
            config={
                "meeting_type": "business_meeting",
                "linked_event_type": "business_meeting",
            },
        )

    @staticmethod
    def _attended(org: str, event: Event, prospect) -> EventExternalAttendee:
        return EventExternalAttendee(
            id=_uid(),
            organization_id=org,
            event_id=str(event.id),
            name="Dana Reed",
            email=prospect.email,
            prospect_id=prospect.id,
            checked_in=True,
            checked_in_at=event.start_datetime,
        )

    async def test_a_check_in_from_before_the_application_is_not_evidence(
        self, db_session: AsyncSession, org
    ):
        svc, prospect, gate = await self._meeting_stage(db_session, org)
        now = datetime.now(timezone.utc)
        last_year = _make_event(
            org,
            start_datetime=now - timedelta(days=400),
            end_datetime=now - timedelta(days=400) + timedelta(hours=2),
        )
        db_session.add_all([last_year, self._attended(org, last_year, prospect)])
        await db_session.commit()

        with pytest.raises(
            ValueError, match="since this application was opened"
        ) as refusal:
            await svc.advance_prospect(
                prospect_id=str(prospect.id),
                organization_id=org,
                advanced_by=None,
            )

        assert "since this application was opened" in str(refusal.value)
        assert await _current_step_id(svc, prospect.id, org) == str(gate.id)

    async def test_the_meeting_that_opened_the_record_still_counts(
        self, db_session: AsyncSession, org
    ):
        """The one piece of history a department does mean to count. Its
        check-in window is still open when the record is written, so measuring
        against the window's close keeps it in while the stale one stays out.
        """
        svc, prospect, gate = await self._meeting_stage(db_session, org)
        in_progress = _make_event(org)
        db_session.add_all([in_progress, self._attended(org, in_progress, prospect)])
        await db_session.commit()

        await svc.advance_prospect(
            prospect_id=str(prospect.id),
            organization_id=org,
            advanced_by=None,
        )

        assert await _current_step_id(svc, prospect.id, org) != str(gate.id)

    async def test_a_bulk_advance_is_held_to_the_same_cut_off(
        self, db_session: AsyncSession, org
    ):
        """The two paths must not disagree about what counts as attendance."""
        svc, prospect, gate = await self._meeting_stage(db_session, org)
        now = datetime.now(timezone.utc)
        last_year = _make_event(
            org,
            start_datetime=now - timedelta(days=400),
            end_datetime=now - timedelta(days=400) + timedelta(hours=2),
        )
        db_session.add_all([last_year, self._attended(org, last_year, prospect)])
        await db_session.commit()

        results = await svc.bulk_advance_prospects([str(prospect.id)], org, None)

        assert results[0]["succeeded"] is False
        assert await _current_step_id(svc, prospect.id, org) == str(gate.id)


class TestNamingAnEventMakesAttendanceRequired:
    """Which stages the gate applies to is decided by the stage, not the caller.

    A meeting stage covers two unlike things. "Meet with the Chief" is an
    arrangement between two people that nothing will ever record, so the
    coordinator's word is the only evidence there can be. "Attend a business
    meeting" names an event the department runs and check-in produces a record
    of who was there. Reading the caller instead meant the same coordinator,
    applicant and stage were refused in a bulk advance and allowed one card at
    a time.
    """

    async def test_a_stage_naming_no_event_is_not_an_attendance_requirement(
        self, db_session: AsyncSession, org
    ):
        svc, prospect, gate = await _pipeline_parked_on(
            db_session,
            org,
            step_type="meeting",
            # The stage builder's default shape.
            config={"meeting_type": "chief_meeting", "meeting_description": ""},
        )

        await svc.advance_prospect(
            prospect_id=str(prospect.id),
            organization_id=org,
            advanced_by=None,
        )

        assert await _current_step_id(svc, prospect.id, org) != str(gate.id)

    async def test_a_pinned_event_id_alone_is_enough_to_require_attendance(
        self, db_session: AsyncSession, org
    ):
        """A stage built before Auto-Link Event Type existed names its event
        through the pinned id, and is as much a requirement as a typed one."""
        now = datetime.now(timezone.utc)
        pinned = _make_event(org)
        db_session.add(pinned)
        await db_session.flush()
        svc, prospect, gate = await _pipeline_parked_on(
            db_session,
            org,
            step_type="meeting",
            config={"meeting_type": "business_meeting", "linked_event_id": pinned.id},
        )

        with pytest.raises(ValueError, match="No attendance has been recorded"):
            await svc.advance_prospect(
                prospect_id=str(prospect.id),
                organization_id=org,
                advanced_by=None,
            )

        db_session.add(
            EventExternalAttendee(
                id=_uid(),
                organization_id=org,
                event_id=str(pinned.id),
                name="Dana Reed",
                email=prospect.email,
                prospect_id=prospect.id,
                checked_in=True,
                checked_in_at=now,
            )
        )
        await db_session.commit()

        await svc.advance_prospect(
            prospect_id=str(prospect.id),
            organization_id=org,
            advanced_by=None,
        )

        assert await _current_step_id(svc, prospect.id, org) != str(gate.id)

    async def test_the_refusal_names_recording_the_attendance_first(
        self, db_session: AsyncSession, org
    ):
        """Gating the hand advance closes the coordinator's escape hatch, so
        the refusal has to hand back the remedies that replace it."""
        svc, prospect, _gate = await _pipeline_parked_on(
            db_session,
            org,
            step_type="meeting",
            config={"linked_event_type": "business_meeting"},
        )

        with pytest.raises(
            ValueError, match="No attendance has been recorded"
        ) as refusal:
            await svc.advance_prospect(
                prospect_id=str(prospect.id),
                organization_id=org,
                advanced_by=None,
            )

        message = str(refusal.value)
        assert "check them in" in message
        assert "un-tick Required" in message
        assert "Auto-Link Event Type" in message


class TestLegacyActionStagesKeepTheirBehaviour:
    """Before typed stages existed, a document, meeting or email stage was
    ``step_type='action'`` with the kind in ``action_type``. Those rows are
    still live: the editor renders them as their modern equivalent and only
    rewrites ``step_type`` when somebody saves the stage.

    Dispatching on ``step_type`` alone treats them as untyped, which cuts both
    ways — a legacy document stage stops advancing on upload, and a legacy
    meeting stage skips the attendance gate that is the point of the change.
    """

    async def test_a_legacy_document_stage_still_advances_on_upload(
        self, db_session: AsyncSession, org
    ):
        svc, prospect, gate = await _pipeline_parked_on(
            db_session,
            org,
            step_type="action",
            config={
                "required_document_types": ["Photo ID"],
                "auto_advance": True,
            },
        )
        gate.action_type = "collect_document"
        await db_session.commit()

        await _upload_document(svc, prospect, org, "Photo ID", gate.id)

        assert await _current_step_id(svc, prospect.id, org) != str(gate.id)

    async def test_a_legacy_meeting_stage_is_gated_on_attendance_too(
        self, db_session: AsyncSession, org
    ):
        """The regression this whole change exists to prevent, on the shape
        that dispatching by step_type alone would have left wide open."""
        svc, prospect, gate = await _pipeline_parked_on(
            db_session,
            org,
            step_type="action",
            config={
                "linked_event_type": "business_meeting",
                "auto_advance": True,
            },
        )
        gate.action_type = "schedule_meeting"
        await db_session.commit()
        now = datetime.now(timezone.utc)
        next_week = _make_event(
            org,
            start_datetime=now + timedelta(days=7),
            end_datetime=now + timedelta(days=7, hours=2),
        )
        attendee = EventExternalAttendee(
            id=_uid(),
            organization_id=org,
            event_id=str(next_week.id),
            name="Dana Reed",
            email=f"staff-{_uid()[:8]}@example.com",
            prospect_id=prospect.id,
            checked_in=True,
            checked_in_at=now,
        )
        db_session.add_all([next_week, attendee])
        await db_session.commit()

        advanced = await GuestCheckInService(
            db_session
        ).try_advance_attendance_pipeline(str(prospect.id), next_week)

        assert advanced is False
        assert await _current_step_id(svc, prospect.id, org) == str(gate.id)

    async def test_a_legacy_meeting_stage_advances_on_real_attendance(
        self, db_session: AsyncSession, org
    ):
        svc, prospect, gate = await _pipeline_parked_on(
            db_session,
            org,
            step_type="action",
            config={
                "linked_event_type": "business_meeting",
                "auto_advance": True,
            },
        )
        gate.action_type = "schedule_meeting"
        await db_session.commit()
        event = _make_event(org)
        db_session.add(event)
        await db_session.flush()

        _, error, _ = await GuestCheckInService(db_session).check_in_guest(
            event=event,
            organization_id=org,
            first_name="Dana",
            last_name="Reed",
            email=prospect.email,
        )

        assert error is None
        assert await _current_step_id(svc, prospect.id, org) != str(gate.id)
