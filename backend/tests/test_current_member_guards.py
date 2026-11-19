"""Paths that name a member to do something refuse a former member.

The roster import brings former members in as archived, retired or dropped
accounts. The member pickers hide them, and these guards refuse one named
anyway (a stale client, a direct API call). A record already naming someone
who has since left still saves when the edit leaves that person alone.

Against real rows: the guard is a SQL filter on ``User.is_active``, whose
expression form a mocked session would never evaluate.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.models.user import Organization, User, UserStatus
from app.schemas.event import EventSettingsUpdate, RequestPipelineUpdate
from app.schemas.training_session import TrainingSessionCreate
from app.services.course_cohort_service import CourseCohortService
from app.services.grant_service import GrantService
from app.services.shift_completion_service import ShiftCompletionService
from app.services.training_enhancement_service import (
    InstructorQualificationService,
)
from app.utils.org_scoping import assert_current_members

pytestmark = [pytest.mark.integration]

FORMER = [
    UserStatus.INACTIVE,
    UserStatus.SUSPENDED,
    UserStatus.LEAVE,
    UserStatus.RETIRED,
    UserStatus.DROPPED_VOLUNTARY,
    UserStatus.DROPPED_INVOLUNTARY,
    UserStatus.ARCHIVED,
]


async def _org(db) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name="Guards",
        slug=f"guards-{uuid.uuid4().hex[:8]}",
    )
    db.add(org)
    await db.flush()
    return org


async def _member(
    db, org: Organization, status: UserStatus = UserStatus.ACTIVE, deleted=False
) -> User:
    suffix = uuid.uuid4().hex[:8]
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"member-{suffix}",
        email=f"member-{suffix}@example.org",
        first_name="Member",
        last_name=suffix,
        status=status,
        deleted_at=datetime.now(timezone.utc) if deleted else None,
    )
    db.add(user)
    await db.flush()
    return user


class TestTheHelper:
    @pytest.mark.parametrize(
        "status", [UserStatus.ACTIVE, UserStatus.PROBATIONARY], ids=lambda s: s.value
    )
    async def test_a_current_member_passes(self, db_session, status):
        org = await _org(db_session)
        member = await _member(db_session, org, status)

        await assert_current_members(db_session, [member.id], org.id)

    @pytest.mark.parametrize("status", FORMER, ids=lambda s: s.value)
    async def test_a_former_member_is_refused(self, db_session, status):
        org = await _org(db_session)
        member = await _member(db_session, org, status)

        with pytest.raises(ValueError, match="Only current members"):
            await assert_current_members(db_session, [member.id], org.id)

    async def test_a_deleted_or_foreign_member_is_refused(self, db_session):
        org = await _org(db_session)
        other = await _org(db_session)
        deleted = await _member(db_session, org, deleted=True)
        foreign = await _member(db_session, other)

        for member in (deleted, foreign):
            with pytest.raises(ValueError, match="Only current members"):
                await assert_current_members(db_session, [member.id], org.id)

    async def test_a_kept_former_member_passes(self, db_session):
        org = await _org(db_session)
        former = await _member(db_session, org, UserStatus.RETIRED)

        await assert_current_members(db_session, [former.id], org.id, keep=[former.id])

    async def test_nothing_named_passes(self, db_session):
        org = await _org(db_session)

        await assert_current_members(db_session, [None, ""], org.id)
        await assert_current_members(db_session, None, org.id)


class TestTheEventsDefaultCoordinator:
    async def _save(self, db, manager: User, assignee_id):
        from app.api.v1.endpoints.events import update_event_settings

        return await update_event_settings(
            EventSettingsUpdate(
                request_pipeline=RequestPipelineUpdate(default_assignee_id=assignee_id)
            ),
            db=db,
            current_user=manager,
        )

    async def test_a_former_member_is_refused(self, db_session):
        org = await _org(db_session)
        manager = await _member(db_session, org)
        former = await _member(db_session, org, UserStatus.ARCHIVED)

        with pytest.raises(HTTPException) as refused:
            await self._save(db_session, manager, former.id)
        assert refused.value.status_code == 400

    async def test_a_saved_coordinator_who_has_left_can_be_saved_again(
        self, db_session
    ):
        org = await _org(db_session)
        manager = await _member(db_session, org)
        coordinator = await _member(db_session, org)
        await self._save(db_session, manager, coordinator.id)
        coordinator.status = UserStatus.RETIRED
        await db_session.flush()

        merged = await self._save(db_session, manager, coordinator.id)

        assert merged["request_pipeline"]["default_assignee_id"] == coordinator.id


class TestTheGrantAssignee:
    async def test_a_new_application_refuses_a_former_member(self, db_session):
        org = await _org(db_session)
        actor = await _member(db_session, org)
        former = await _member(db_session, org, UserStatus.DROPPED_VOLUNTARY)

        with pytest.raises(ValueError, match="Only current members"):
            await GrantService(db_session).create_application(
                org.id,
                {"grant_program_name": "AFG", "assigned_to": former.id},
                actor.id,
            )

    async def test_an_edit_keeps_an_assignee_who_has_since_left(self, db_session):
        org = await _org(db_session)
        actor = await _member(db_session, org)
        assignee = await _member(db_session, org)
        service = GrantService(db_session)
        application = await service.create_application(
            org.id,
            {"grant_program_name": "AFG", "assigned_to": assignee.id},
            actor.id,
        )
        assignee.status = UserStatus.RETIRED
        await db_session.flush()

        updated = await service.update_application(
            application.id,
            org.id,
            {"assigned_to": assignee.id, "notes": "Still theirs"},
            actor.id,
        )

        assert updated.assigned_to == assignee.id

    async def test_an_edit_refuses_choosing_a_former_member(self, db_session):
        org = await _org(db_session)
        actor = await _member(db_session, org)
        service = GrantService(db_session)
        application = await service.create_application(
            org.id, {"grant_program_name": "AFG"}, actor.id
        )
        former = await _member(db_session, org, UserStatus.ARCHIVED)

        with pytest.raises(ValueError, match="Only current members"):
            await service.update_application(
                application.id, org.id, {"assigned_to": former.id}, actor.id
            )


class TestTheInstructorQualification:
    async def test_a_former_member_is_refused(self, db_session):
        org = await _org(db_session)
        actor = await _member(db_session, org)
        former = await _member(db_session, org, UserStatus.RETIRED)

        with pytest.raises(ValueError, match="Only current members"):
            await InstructorQualificationService(db_session).create_qualification(
                org.id,
                {"user_id": former.id, "qualification_type": "instructor"},
                actor.id,
            )

    async def test_a_current_member_is_accepted(self, db_session):
        org = await _org(db_session)
        actor = await _member(db_session, org)
        member = await _member(db_session, org, UserStatus.PROBATIONARY)

        qual = await InstructorQualificationService(db_session).create_qualification(
            org.id,
            {"user_id": member.id, "qualification_type": "instructor"},
            actor.id,
        )

        assert qual.user_id == member.id


class TestTheManualShiftReportCrew:
    async def test_a_manual_batch_refuses_a_former_member(self, db_session):
        org = await _org(db_session)
        officer = await _member(db_session, org)
        current = await _member(db_session, org)
        former = await _member(db_session, org, UserStatus.ARCHIVED)

        with pytest.raises(ValueError, match="Only current members"):
            await ShiftCompletionService(db_session).batch_create_reports(
                organization_id=org.id,
                officer_id=officer.id,
                shift_id=None,
                shift_date=date.today() - timedelta(days=1),
                hours_on_shift=12,
                calls_responded=2,
                call_types=None,
                officer_narrative=None,
                crew_member_ids=[current.id, former.id],
                trainee_evaluations=None,
            )


class TestTheCohortRoster:
    async def test_a_former_member_is_skipped_with_a_warning(self, db_session):
        org = await _org(db_session)
        actor = await _member(db_session, org)
        former = await _member(db_session, org, UserStatus.RETIRED)
        cohort = SimpleNamespace(id=str(uuid.uuid4()), program_id=None)

        warnings = await CourseCohortService(db_session)._add_members(
            cohort=cohort,
            user_ids=[former.id],
            organization_id=org.id,
            actor_id=actor.id,
            enroll_in_program=False,
            invite_to_events=False,
            future_only=True,
        )

        assert warnings == ["A selected member is no longer a current member."]


class TestTheTrainingSessionEndpoint:
    async def test_a_former_lead_instructor_is_refused(self, db_session):
        from app.api.v1.endpoints.training_sessions import create_training_session

        org = await _org(db_session)
        manager = await _member(db_session, org)
        former = await _member(db_session, org, UserStatus.ARCHIVED)
        start = datetime.now(timezone.utc) + timedelta(days=7)

        with pytest.raises(HTTPException) as refused:
            await create_training_session(
                session_data=TrainingSessionCreate(
                    title="Pump ops",
                    start_datetime=start,
                    end_datetime=start + timedelta(hours=2),
                    instructor_id=former.id,
                ),
                db=db_session,
                current_user=manager,
            )
        assert refused.value.status_code == 400
        assert "Only current members" in refused.value.detail
