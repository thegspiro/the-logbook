"""An erased instructor reads "Former member" (owner decision 2026-11-23).

On anonymisation and permanent delete, the member's name is replaced where
it is stored as an instructor: an event template's lead instructor (its id
cleared), a training session's instructor name, and the copy of that name on
the session's attendees' training records. "Former member", not a blank, so
the records stay off the NFPA missing-instructor report.
"""

import copy
import uuid
from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID

import pytest
from sqlalchemy import select

from app.api.v1.endpoints import users as users_endpoint
from app.models.event import Event, EventTemplate, EventType
from app.models.training import (
    TrainingRecord,
    TrainingSession,
    TrainingStatus,
    TrainingType,
)
from app.models.user import Organization, User, UserStatus
from app.services.instructor_erasure import FORMER_MEMBER
from app.services.member_anonymization_service import MemberAnonymizationService
from tests.fake_request import fake_request

pytestmark = pytest.mark.integration

_DETAILS = {
    "course_mode": "none",
    "course_id": None,
    "course_name": "Ladders",
    "course_code": None,
    "training_type": "continuing_education",
    "credit_hours": 2.0,
    "credit_hours_source": "duration",
    "instructor_id": None,
    "instructor": None,
    "issues_certification": False,
    "certification_number_prefix": None,
    "issuing_agency": None,
    "expiration_months": None,
}


async def _world(db):
    org = Organization(name="Instr FD", slug=f"instr-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()

    def member(first, last, **overrides):
        suffix = uuid.uuid4().hex[:8]
        fields = dict(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            username=f"m-{suffix}",
            email=f"m-{suffix}@example.org",
            first_name=first,
            last_name=last,
            status=UserStatus.ARCHIVED,
            deleted_at=datetime.now(UTC),
        )
        fields.update(overrides)
        return User(**fields)

    pat = member("Pat", "Firefighter")
    sam = member("Sam", "Captain", status=UserStatus.ACTIVE, deleted_at=None)
    attendee = member("Ann", "Attendee", status=UserStatus.ACTIVE, deleted_at=None)
    db.add_all([pat, sam, attendee])
    await db.flush()

    def details(instructor):
        value = copy.deepcopy(_DETAILS)
        value["instructor_id"] = str(instructor.id)
        value["instructor"] = instructor.full_name
        return value

    pats_template = EventTemplate(
        organization_id=org.id,
        name="Ladder night",
        event_type=EventType.TRAINING,
        training_details=details(pat),
    )
    sams_template = EventTemplate(
        organization_id=org.id,
        name="Hose night",
        event_type=EventType.TRAINING,
        training_details=details(sam),
    )
    start = datetime(2026, 3, 1, 19, tzinfo=UTC)
    taught, other = (
        Event(
            organization_id=org.id,
            title=title,
            event_type=EventType.TRAINING,
            start_datetime=start,
            end_datetime=start + timedelta(hours=2),
        )
        for title in ("Ladders", "Pumps")
    )
    db.add_all([pats_template, sams_template, taught, other])
    await db.flush()
    session = TrainingSession(
        organization_id=org.id,
        event_id=taught.id,
        course_name="Ladders",
        training_type=TrainingType.CONTINUING_EDUCATION,
        credit_hours=2.0,
        instructor="Pat Firefighter",
        instructor_id=pat.id,
    )
    db.add(session)

    def record(event, name, user=attendee):
        return TrainingRecord(
            organization_id=org.id,
            user_id=user.id,
            course_name="Ladders",
            training_type=TrainingType.CONTINUING_EDUCATION,
            completion_date=date(2026, 3, 1),
            hours_completed=2.0,
            status=TrainingStatus.COMPLETED,
            source_event_id=event.id,
            instructor=name,
        )

    copied = record(taught, "Pat Firefighter")
    # An officer corrected this one's instructor after the copy: not Pat's.
    corrected = record(taught, "Sam Captain", user=sam)
    # Same name, another event Pat did not teach: not the copy.
    elsewhere = record(other, "Pat Firefighter")
    db.add_all([copied, corrected, elsewhere])
    await db.flush()
    return SimpleNamespace(
        org=org,
        pat=pat,
        sam=sam,
        pats_template=pats_template,
        sams_template=sams_template,
        session=session,
        copied=copied,
        corrected=corrected,
        elsewhere=elsewhere,
    )


async def _fresh(db, model, row_id):
    return (
        await db.execute(
            select(model)
            .where(model.id == row_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()


async def _assert_former_member(db, w):
    template = await _fresh(db, EventTemplate, w.pats_template.id)
    assert template.training_details == {
        **_DETAILS,
        "instructor_id": None,
        "instructor": FORMER_MEMBER,
    }
    other = await _fresh(db, EventTemplate, w.sams_template.id)
    assert other.training_details["instructor"] == "Sam Captain"
    assert other.training_details["instructor_id"] == str(w.sam.id)
    assert (await _fresh(db, TrainingSession, w.session.id)).instructor == (
        FORMER_MEMBER
    )
    assert (await _fresh(db, TrainingRecord, w.copied.id)).instructor == (FORMER_MEMBER)
    assert (await _fresh(db, TrainingRecord, w.corrected.id)).instructor == (
        "Sam Captain"
    )
    assert (await _fresh(db, TrainingRecord, w.elsewhere.id)).instructor == (
        "Pat Firefighter"
    )


class TestAnonymisation:
    async def test_the_name_reads_former_member_in_all_three_places(self, db_session):
        w = await _world(db_session)

        summary = await MemberAnonymizationService(db_session).anonymize_member(w.pat)
        await db_session.flush()

        await _assert_former_member(db_session, w)
        assert (
            summary["instructor_templates_scrubbed"],
            summary["instructor_sessions_scrubbed"],
            summary["instructor_records_scrubbed"],
        ) == (1, 1, 1)


class TestPermanentDelete:
    async def test_the_name_reads_former_member_in_all_three_places(
        self, db_session, monkeypatch
    ):
        w = await _world(db_session)
        audit = AsyncMock()
        monkeypatch.setattr(users_endpoint, "log_audit_event", audit)
        monkeypatch.setattr(
            users_endpoint, "_enforce_account_reset_ceiling", AsyncMock()
        )
        monkeypatch.setattr(
            users_endpoint, "assert_not_last_administrator", AsyncMock()
        )

        await users_endpoint.delete_user(
            user_id=UUID(w.pat.id),
            hard=True,
            db=db_session,
            current_user=SimpleNamespace(
                id=w.sam.id, organization_id=w.org.id, username="sam"
            ),
            request=fake_request(),
        )

        assert await _fresh(db_session, User, w.pat.id) is None
        await _assert_former_member(db_session, w)
        assert (
            await _fresh(db_session, TrainingSession, w.session.id)
        ).instructor_id is None
        deleted = next(
            call.kwargs["event_data"]
            for call in audit.await_args_list
            if call.kwargs["event_type"] == "user_hard_deleted"
        )
        assert (
            deleted["instructor_templates_scrubbed"],
            deleted["instructor_sessions_scrubbed"],
            deleted["instructor_records_scrubbed"],
        ) == (1, 1, 1)
