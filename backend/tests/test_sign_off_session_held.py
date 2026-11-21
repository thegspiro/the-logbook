"""A sign-off session is not held until its approval decides it.

Finalizing a session that requires completion confirmation sets
``is_finalized`` but writes only IN_PROGRESS records, held until a training
officer approves. The attendance grader counted the session as held from
finalize, and counts a member as attended only on a COMPLETED record, so
every attendee was charged with the session and not credited for it — for as
long as the approval stayed pending, which nothing ends on its own.

``load_held_sessions`` now leaves a session out while its newest approval is
pending. Every grader and the waiver checks read that one function (pitfall
#29), so they all follow.
"""

import secrets
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

from app.models.event import Event, EventType
from app.models.training import (
    ApprovalStatus,
    RequirementFrequency,
    RequirementSource,
    RequirementType,
    TrainingApproval,
    TrainingRecord,
    TrainingRequirement,
    TrainingSession,
    TrainingSessionRequirement,
    TrainingStatus,
    TrainingType,
)
from app.models.user import Organization, User
from app.services.training_compliance import (
    NOT_YET_HELD_STATUS,
    HeldSession,
    evaluate_member_requirement_detail,
    load_graded_records,
    load_held_sessions,
)

pytestmark = [pytest.mark.integration]

DRILL_START = datetime(2026, 3, 4, 23, tzinfo=timezone.utc)
AS_OF = date(2026, 11, 4)


async def _dept(db):
    org = Organization(
        id=str(uuid.uuid4()),
        name="Sign-off Test Department",
        slug=f"signoff-{uuid.uuid4().hex[:8]}",
        timezone="UTC",
    )
    db.add(org)
    await db.flush()
    handle = uuid.uuid4().hex[:8]
    member = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"member-{handle}",
        email=f"{handle}@signoff.test",
        first_name="Test",
        last_name="Member",
        password_hash="x",
    )
    requirement = TrainingRequirement(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name=f"Drills {handle}",
        requirement_type=RequirementType.SESSION_ATTENDANCE,
        source=RequirementSource.DEPARTMENT,
        frequency=RequirementFrequency.ANNUAL,
        required_attendance_pct=100,
    )
    db.add_all([member, requirement])
    await db.flush()
    return org, member, requirement


async def _finalized_sign_off_drill(db, org, member, requirement):
    """The state finalize leaves a sign-off session in: finalized, a pending
    approval naming the attendee, and an IN_PROGRESS record for them."""
    event = Event(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        title="Company Drill",
        event_type=EventType.TRAINING,
        start_datetime=DRILL_START,
        end_datetime=DRILL_START + timedelta(hours=2),
    )
    db.add(event)
    await db.flush()
    session = TrainingSession(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        event_id=event.id,
        course_name="Company Drill",
        training_type=TrainingType.CONTINUING_EDUCATION,
        credit_hours=2,
        require_completion_confirmation=True,
        is_finalized=True,
    )
    db.add(session)
    await db.flush()
    db.add(
        TrainingSessionRequirement(
            organization_id=org.id,
            session_id=session.id,
            requirement_id=requirement.id,
        )
    )
    record = TrainingRecord(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        user_id=member.id,
        source_event_id=event.id,
        course_name="Company Drill",
        training_type=TrainingType.CONTINUING_EDUCATION,
        completion_date=DRILL_START.date(),
        hours_completed=2,
        status=TrainingStatus.IN_PROGRESS,
    )
    db.add(record)
    await db.flush()
    return session, record


def _approval(org, session, status, created_at):
    return TrainingApproval(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        training_session_id=session.id,
        event_id=session.event_id,
        approval_token=secrets.token_urlsafe(32),
        token_expires_at=created_at + timedelta(days=30),
        status=status,
        approval_deadline=created_at + timedelta(days=7),
        attendee_data=[{"user_id": "someone"}],
        created_at=created_at,
    )


async def _grade(db, org, member, requirement):
    records = await load_graded_records(
        db, org.id, [member.id], [requirement], AS_OF, True
    )
    held = await load_held_sessions(db, org.id, [requirement])
    return evaluate_member_requirement_detail(
        requirement, records, AS_OF, held_sessions=held
    )


class TestSignOffSessionHeld:
    async def test_a_pending_sign_off_does_not_charge_its_attendees(self, db_session):
        org, member, requirement = await _dept(db_session)
        session, _ = await _finalized_sign_off_drill(
            db_session, org, member, requirement
        )
        db_session.add(
            _approval(
                org, session, ApprovalStatus.PENDING, DRILL_START + timedelta(hours=3)
            )
        )
        await db_session.flush()

        assert await load_held_sessions(db_session, org.id, [requirement]) == {
            requirement.id: []
        }
        evaluation = await _grade(db_session, org, member, requirement)
        # Nothing held yet charges nobody (the requirement's own rule).
        assert evaluation.status == NOT_YET_HELD_STATUS
        assert (evaluation.progress_current, evaluation.progress_required) == (0, 0)

    async def test_once_approved_it_is_held_and_attended(self, db_session):
        org, member, requirement = await _dept(db_session)
        session, record = await _finalized_sign_off_drill(
            db_session, org, member, requirement
        )
        db_session.add(
            _approval(
                org, session, ApprovalStatus.APPROVED, DRILL_START + timedelta(hours=3)
            )
        )
        record.status = TrainingStatus.COMPLETED
        await db_session.flush()

        evaluation = await _grade(db_session, org, member, requirement)

        assert (evaluation.progress_current, evaluation.progress_required) == (1, 1)

    async def test_a_superseded_pending_approval_does_not_hide_a_decided_one(
        self, db_session
    ):
        """A re-finalize leaves the earlier approval PENDING with its link
        killed; only the newest approval says where the session stands."""
        org, member, requirement = await _dept(db_session)
        session, _ = await _finalized_sign_off_drill(
            db_session, org, member, requirement
        )
        db_session.add_all(
            [
                _approval(
                    org,
                    session,
                    ApprovalStatus.PENDING,
                    DRILL_START + timedelta(hours=3),
                ),
                _approval(
                    org,
                    session,
                    ApprovalStatus.REJECTED,
                    DRILL_START + timedelta(days=1),
                ),
            ]
        )
        await db_session.flush()

        held = await load_held_sessions(db_session, org.id, [requirement])

        assert held == {
            requirement.id: [HeldSession(session.event_id, DRILL_START.date())]
        }
