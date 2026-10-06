"""W27-3: a member who joins a running cohort, and the classes they missed.

A late joiner is RSVP'd only to classes still to come, so each class held
before they joined needs an officer's decision: credit them for it, or schedule
a make-up session for them alone. Against the real database, because the
missed set is decided by joins across classes, RSVPs and decisions.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import Event, EventRSVP
from app.models.training import (
    CohortClassStatus,
    CohortMemberStatus,
    CohortStatus,
    CourseCohort,
    CourseCohortClass,
    CourseCohortMember,
    TrainingCourse,
    TrainingRecord,
    TrainingStatus,
    TrainingType,
)
from app.schemas.course_cohort import CohortMakeupCreate
from app.services.course_cohort_service import CourseCohortService

pytestmark = [pytest.mark.integration]

NOW = datetime.now(timezone.utc).replace(microsecond=0)


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def cohort_setup(db_session: AsyncSession):
    org_id, officer_id, early_id, late_id = _uid(), _uid(), _uid(), _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Test Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"test-{org_id[:8]}"},
    )
    for uid, name in ((officer_id, "officer"), (early_id, "early"), (late_id, "late")):
        await db_session.execute(
            text(
                "INSERT INTO users (id, organization_id, username, first_name, "
                "last_name, email, password_hash, status) "
                "VALUES (:id, :org, :un, :un, 'Member', :em, 'x', 'active')"
            ),
            {"id": uid, "org": org_id, "un": f"{name}{uid[:6]}", "em": f"{uid}@t.io"},
        )
    course = TrainingCourse(
        organization_id=org_id,
        name="Firefighter I",
        training_type=TrainingType.CERTIFICATION,
        credit_hours=3.0,
    )
    db_session.add(course)
    await db_session.flush()
    cohort = CourseCohort(
        organization_id=org_id,
        course_id=course.id,
        name="Fall Recruit School",
        start_date=(NOW - timedelta(days=14)).date(),
        status=CohortStatus.IN_PROGRESS,
        date_roll_policy="none",
    )
    db_session.add(cohort)
    await db_session.flush()

    def _class(seq, days, **kw):
        start = NOW + timedelta(days=days)
        row = CourseCohortClass(
            organization_id=org_id,
            cohort_id=cohort.id,
            sequence=seq,
            title=f"Class {seq}",
            scheduled_start=start,
            scheduled_end=start + timedelta(hours=3),
            status=kw.pop("status", CohortClassStatus.SCHEDULED),
            class_course_id=course.id,
            credit_hours=kw.pop("credit_hours", 3.0),
            **kw,
        )
        db_session.add(row)
        return row

    classes = [
        _class(1, -10),
        _class(2, -7),
        _class(3, -5, status=CohortClassStatus.CANCELLED),
        _class(4, 7),
    ]
    await db_session.flush()
    early = CourseCohortMember(
        organization_id=org_id,
        cohort_id=cohort.id,
        user_id=early_id,
        status=CohortMemberStatus.ACTIVE,
        added_at=NOW - timedelta(days=20),
    )
    late = CourseCohortMember(
        organization_id=org_id,
        cohort_id=cohort.id,
        user_id=late_id,
        status=CohortMemberStatus.ACTIVE,
        added_at=NOW - timedelta(days=1),
    )
    db_session.add_all([early, late])
    await db_session.flush()
    return {
        "org": uuid.UUID(org_id),
        "officer": uuid.UUID(officer_id),
        "early": uuid.UUID(early_id),
        "late": uuid.UUID(late_id),
        "cohort": cohort,
        "course": course,
        "classes": classes,
    }


async def _missed(svc, s, who="late"):
    return await svc.list_missed_classes(s["cohort"].id, s[who], s["org"])


class TestWhichClassesWereMissed:
    async def test_past_classes_before_joining_need_a_decision(
        self, db_session, cohort_setup
    ):
        s = cohort_setup
        entries = await _missed(CourseCohortService(db_session), s)

        # Not the cancelled class, not the one still to come.
        assert [e["cohort_class"].sequence for e in entries] == [1, 2]
        assert all(e["pending"] for e in entries)

    async def test_a_member_on_the_roster_from_the_start_missed_nothing(
        self, db_session, cohort_setup
    ):
        s = cohort_setup
        assert await _missed(CourseCohortService(db_session), s, "early") == []

    async def test_a_member_already_invited_to_a_past_class_did_not_miss_it(
        self, db_session, cohort_setup
    ):
        # Generation RSVPs the whole roster to every class of a back-dated
        # cohort; those members were placed on the class, not late for it.
        s = cohort_setup
        first = s["classes"][0]
        event = Event(
            organization_id=str(s["org"]),
            title="Class 1",
            event_type="training",
            start_datetime=first.scheduled_start,
            end_datetime=first.scheduled_end,
        )
        db_session.add(event)
        await db_session.flush()
        event_id = event.id
        first.event_id = event_id
        db_session.add(
            EventRSVP(
                organization_id=str(s["org"]),
                event_id=event_id,
                user_id=str(s["late"]),
                status="going",
                guest_count=0,
            )
        )
        await db_session.flush()

        entries = await _missed(CourseCohortService(db_session), s)
        assert [e["cohort_class"].sequence for e in entries] == [2]


class TestCreditingAMissedClass:
    async def test_writes_a_completed_record_for_the_class(
        self, db_session, cohort_setup
    ):
        s = cohort_setup
        svc = CourseCohortService(db_session)
        first = s["classes"][0]

        decision, record, warnings = await svc.credit_missed_class(
            s["cohort"].id, s["late"], first.id, s["org"], s["officer"]
        )

        assert warnings == []
        assert decision.resolution.value == "credited"
        stored = (
            await db_session.execute(
                select(TrainingRecord).where(TrainingRecord.id == record.id)
            )
        ).scalar_one()
        assert stored.user_id == str(s["late"])
        assert stored.course_id == s["course"].id
        assert stored.status == TrainingStatus.COMPLETED
        assert stored.hours_completed == 3.0
        assert stored.completion_date == first.scheduled_start.date()

        entries = await _missed(svc, s)
        assert [e["pending"] for e in entries] == [False, True]

    async def test_a_class_cannot_be_credited_twice(self, db_session, cohort_setup):
        s = cohort_setup
        svc = CourseCohortService(db_session)
        first = s["classes"][0]
        await svc.credit_missed_class(
            s["cohort"].id, s["late"], first.id, s["org"], s["officer"]
        )

        with pytest.raises(ValueError, match="already been credited"):
            await svc.credit_missed_class(
                s["cohort"].id, s["late"], first.id, s["org"], s["officer"]
            )

    async def test_only_a_class_the_member_missed_can_be_credited(
        self, db_session, cohort_setup
    ):
        s = cohort_setup
        upcoming = s["classes"][3]
        with pytest.raises(ValueError, match="joined too late for"):
            await CourseCohortService(db_session).credit_missed_class(
                s["cohort"].id, s["late"], upcoming.id, s["org"], s["officer"]
            )


class TestSchedulingAMakeup:
    async def test_copies_the_class_for_that_member_alone(
        self, db_session, cohort_setup
    ):
        s = cohort_setup
        svc = CourseCohortService(db_session)
        second = s["classes"][1]
        start = NOW + timedelta(days=3)

        decision, makeup = await svc.schedule_makeup_class(
            s["cohort"].id,
            s["late"],
            second.id,
            CohortMakeupCreate(
                scheduled_start=start, scheduled_end=start + timedelta(hours=3)
            ),
            s["org"],
            s["officer"],
        )

        assert decision.resolution.value == "makeup_scheduled"
        assert makeup.makeup_for_class_id == second.id
        assert makeup.title == "Make-up: Class 2"
        assert makeup.class_course_id == second.class_course_id
        assert makeup.event_id is not None
        rsvps = (
            (
                await db_session.execute(
                    select(EventRSVP.user_id).where(
                        EventRSVP.event_id == makeup.event_id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert rsvps == [str(s["late"])]

        entries = {e["cohort_class"].sequence: e for e in await _missed(svc, s)}
        assert entries[2]["pending"] is False
        # The make-up is somebody's catch-up, not a class anyone missed.
        assert set(entries) == {1, 2}

    async def test_credit_is_refused_while_a_makeup_stands_and_allowed_after(
        self, db_session, cohort_setup
    ):
        s = cohort_setup
        svc = CourseCohortService(db_session)
        second = s["classes"][1]
        start = NOW + timedelta(days=3)
        _, makeup = await svc.schedule_makeup_class(
            s["cohort"].id,
            s["late"],
            second.id,
            CohortMakeupCreate(
                scheduled_start=start, scheduled_end=start + timedelta(hours=3)
            ),
            s["org"],
            s["officer"],
        )

        with pytest.raises(ValueError, match="make-up session is already scheduled"):
            await svc.credit_missed_class(
                s["cohort"].id, s["late"], second.id, s["org"], s["officer"]
            )

        makeup.status = CohortClassStatus.CANCELLED
        await db_session.flush()
        decision, _, _ = await svc.credit_missed_class(
            s["cohort"].id, s["late"], second.id, s["org"], s["officer"]
        )
        assert decision.resolution.value == "credited"


class TestRosterReportsWhatIsPending:
    async def test_the_detail_counts_undecided_classes_per_member(
        self, db_session, cohort_setup
    ):
        s = cohort_setup
        svc = CourseCohortService(db_session)
        await svc.credit_missed_class(
            s["cohort"].id, s["late"], s["classes"][0].id, s["org"], s["officer"]
        )

        detail = await svc.get_cohort_detail(
            s["cohort"].id, s["org"], include_member_data=True
        )
        pending = {
            m["row"].user_id: m["missed_classes_pending"] for m in detail["members"]
        }
        assert pending == {str(s["early"]): 0, str(s["late"]): 1}
