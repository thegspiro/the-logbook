"""Finalizing a Training event's attendance credits members' training records.

Against real rows, read back with raw SQL so an ORM identity map cannot report
a write that never landed.

The first case is the report that prompted this: an officer made a Training
event from Events → Create Event (no training session), added a member only
by setting their times with Edit Times — four hours — and finalized. The
override was stored and nothing reached the member's training history: no
record was ever created for a session-less event, and the one path that did
write hours skipped any attendee with an override.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.event import EventCreate, EventUpdate, RSVPOverride
from app.schemas.training_session import TrainingSessionAttach
from app.services.event_service import EventService
from app.services.training_session_service import TrainingSessionService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


async def _insert_org(db: AsyncSession) -> str:
    org_id = _uid()
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Test Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"org-{org_id[:8]}"},
    )
    return org_id


async def _insert_user(db: AsyncSession, org_id: str, first: str) -> str:
    user_id = _uid()
    await db.execute(
        text(
            "INSERT INTO users "
            "(id, organization_id, username, first_name, last_name, "
            "email, password_hash, status) "
            "VALUES (:id, :org, :un, :fn, 'Tester', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"{first.lower()}-{user_id[:8]}",
            "fn": first,
            "em": f"{first.lower()}-{user_id[:8]}@test.com",
        },
    )
    return user_id


async def _insert_category(db: AsyncSession, org_id: str) -> str:
    category_id = _uid()
    await db.execute(
        text(
            "INSERT INTO training_categories (id, organization_id, name) "
            "VALUES (:id, :org, 'Engine Ops')"
        ),
        {"id": category_id, "org": org_id},
    )
    return category_id


async def _records(db: AsyncSession, user_id: str) -> list:
    result = await db.execute(
        text(
            "SELECT status, hours_completed, course_name, category_id, "
            "source_event_id, training_type, completion_date, notes "
            "FROM training_records WHERE user_id = :u"
        ),
        {"u": user_id},
    )
    return [dict(row._mapping) for row in result]


@pytest.fixture
async def dept(db_session: AsyncSession):
    org = await _insert_org(db_session)
    officer = await _insert_user(db_session, org, "Officer")
    member = await _insert_user(db_session, org, "Pat")
    await db_session.flush()
    return org, officer, member


def _past_window(hours: int = 4):
    start = (datetime.now(timezone.utc) - timedelta(hours=hours + 2)).replace(
        second=0, microsecond=0
    )
    return start, start + timedelta(hours=hours)


async def _training_event(db, org, officer, title="Hose Ops", **extra):
    start, end = _past_window()
    event = await EventService(db).create_event(
        EventCreate(
            title=title,
            event_type="training",
            start_datetime=start,
            end_datetime=end,
            requires_rsvp=False,
            **extra,
        ),
        organization_id=org,
        created_by=officer,
    )
    # A plain id: tests below expire the session to re-read rows, and an
    # expired ORM attribute cannot be loaded outside the async context.
    return str(event.id), start, end


async def _add_with_edit_times(db, event_id, org, officer, member, start, end):
    """Exactly what the Edit Times dialog does for someone never checked in."""
    service = EventService(db)
    rsvp, error = await service.manager_add_attendee(
        event_id, member, org, officer, checked_in=False
    )
    assert error is None
    rsvp, error = await service.override_rsvp_attendance(
        event_id,
        member,
        org,
        officer,
        RSVPOverride(override_check_in_at=start, override_check_out_at=end),
    )
    assert error is None
    assert rsvp.override_duration_minutes == 240


class TestTheReportedScenario:
    async def test_edit_times_then_finalize_credits_four_completed_hours(
        self, db_session, dept
    ):
        org, officer, member = dept
        event_id, start, end = await _training_event(db_session, org, officer)
        await _add_with_edit_times(
            db_session, event_id, org, officer, member, start, end
        )

        outcome = await EventService(db_session).finalize_event_attendance_detailed(
            event_id, org, finalized_by=officer
        )

        assert outcome.error is None
        assert outcome.training_credit is True
        assert outcome.training_records_completed == 1
        records = await _records(db_session, member)
        assert len(records) == 1
        record = records[0]
        assert record["status"] == "completed"
        assert record["hours_completed"] == 4.0
        assert record["course_name"] == "Hose Ops"
        assert record["training_type"] == "continuing_education"
        assert record["source_event_id"] == str(event_id)
        assert record["completion_date"] == start.date()

    async def test_reopen_rename_and_finalize_again_keeps_one_row(
        self, db_session, dept
    ):
        org, officer, member = dept
        event_id, start, end = await _training_event(db_session, org, officer)
        await _add_with_edit_times(
            db_session, event_id, org, officer, member, start, end
        )
        service = EventService(db_session)
        await service.finalize_event_attendance_detailed(event_id, org, officer)

        _, error = await service.reopen_event_attendance(event_id, org)
        assert error is None
        await service.update_event(
            event_id, org, EventUpdate(title="Hose Ops (Engine 2)"), officer
        )
        outcome = await service.finalize_event_attendance_detailed(
            event_id, org, officer
        )

        assert outcome.error is None
        records = await _records(db_session, member)
        assert len(records) == 1
        assert records[0]["course_name"] == "Hose Ops (Engine 2)"
        assert records[0]["hours_completed"] == 4.0

    async def test_details_attached_after_a_reopen_refile_the_same_row(
        self, db_session, dept
    ):
        """How the reported event gets fixed: a leader reopens it, the officer
        gives it a category, and it is finalized again."""
        org, officer, member = dept
        category = await _insert_category(db_session, org)
        event_id, start, end = await _training_event(db_session, org, officer)
        await _add_with_edit_times(
            db_session, event_id, org, officer, member, start, end
        )
        service = EventService(db_session)
        await service.finalize_event_attendance_detailed(event_id, org, officer)

        _, error = await service.reopen_event_attendance(event_id, org)
        assert error is None
        session, error = await TrainingSessionService(
            db_session
        ).attach_session_to_event(
            event_id,
            TrainingSessionAttach(
                category_id=category, training_type="skills_practice"
            ),
            org,
            officer,
        )
        assert error is None
        outcome = await service.finalize_event_attendance_detailed(
            event_id, org, officer
        )

        assert outcome.error is None
        assert outcome.training_records_completed == 1
        records = await _records(db_session, member)
        assert len(records) == 1
        assert records[0]["category_id"] == category
        assert records[0]["training_type"] == "skills_practice"
        assert records[0]["hours_completed"] == 4.0
        finalized = await db_session.execute(
            text("SELECT is_finalized FROM training_sessions WHERE id = :id"),
            {"id": session.id},
        )
        assert bool(finalized.scalar_one()) is True


class TestWhoIsCredited:
    async def test_derived_time_for_an_officer_check_in_with_no_override(
        self, db_session, dept
    ):
        org, officer, member = dept
        event_id, start, _end = await _training_event(db_session, org, officer)
        service = EventService(db_session)
        await service.manager_add_attendee(
            event_id, member, org, officer, checked_in=True
        )
        await db_session.execute(
            text(
                "UPDATE event_rsvps SET checked_in_at = :at "
                "WHERE event_id = :e AND user_id = :u"
            ),
            {"at": start + timedelta(minutes=30), "e": event_id, "u": member},
        )
        db_session.expire_all()

        outcome = await service.finalize_event_attendance_detailed(
            event_id, org, officer
        )

        assert outcome.training_records_completed == 1
        (record,) = await _records(db_session, member)
        assert record["hours_completed"] == 3.5

    async def test_no_creditable_time_means_no_record_and_a_name(
        self, db_session, dept
    ):
        org, officer, member = dept
        event_id, _start, end = await _training_event(db_session, org, officer)
        service = EventService(db_session)
        await service.manager_add_attendee(
            event_id, member, org, officer, checked_in=True
        )
        # Added after the event had ended: the check-in is past the end.
        await db_session.execute(
            text(
                "UPDATE event_rsvps SET checked_in_at = :at "
                "WHERE event_id = :e AND user_id = :u"
            ),
            {"at": end + timedelta(hours=1), "e": event_id, "u": member},
        )
        db_session.expire_all()

        outcome = await service.finalize_event_attendance_detailed(
            event_id, org, officer
        )

        assert outcome.training_records_completed == 0
        assert outcome.training_uncredited_names == ["Pat Tester"]
        assert await _records(db_session, member) == []

    async def test_a_training_event_cannot_be_finalized_before_it_ends(
        self, db_session, dept
    ):
        org, officer, _member = dept
        start = datetime.now(timezone.utc) + timedelta(hours=1)
        created = await EventService(db_session).create_event(
            EventCreate(
                title="Tonight's drill",
                event_type="training",
                start_datetime=start,
                end_datetime=start + timedelta(hours=2),
                requires_rsvp=False,
            ),
            organization_id=org,
            created_by=officer,
        )

        outcome = await EventService(db_session).finalize_event_attendance_detailed(
            created.id, org, officer
        )

        assert outcome.error is not None
        assert "once the event has ended" in outcome.error


class TestTrainingDetailsOnCreate:
    async def test_create_with_details_attaches_a_session(self, db_session, dept):
        org, officer, member = dept
        category = await _insert_category(db_session, org)
        event_id, start, end = await _training_event(
            db_session,
            org,
            officer,
            training_details=TrainingSessionAttach(category_id=category),
        )
        await _add_with_edit_times(
            db_session, event_id, org, officer, member, start, end
        )

        outcome = await EventService(db_session).finalize_event_attendance_detailed(
            event_id, org, officer
        )

        assert outcome.training_records_completed == 1
        (record,) = await _records(db_session, member)
        assert record["category_id"] == category
        assert record["status"] == "completed"

    async def test_details_on_a_non_training_event_are_refused(self, db_session, dept):
        org, officer, _member = dept
        start, end = _past_window()
        with pytest.raises(ValueError, match="only be added to a Training event"):
            await EventService(db_session).create_event(
                EventCreate(
                    title="Business meeting",
                    event_type="business_meeting",
                    start_datetime=start,
                    end_datetime=end,
                    requires_rsvp=False,
                    training_details=TrainingSessionAttach(training_type="refresher"),
                ),
                organization_id=org,
                created_by=officer,
            )

    async def test_a_foreign_category_is_refused(self, db_session, dept):
        org, officer, _member = dept
        other_org = await _insert_org(db_session)
        foreign = await _insert_category(db_session, other_org)
        start, end = _past_window()
        with pytest.raises(ValueError, match="Invalid training category"):
            await EventService(db_session).create_event(
                EventCreate(
                    title="Drill",
                    event_type="training",
                    start_datetime=start,
                    end_datetime=end,
                    requires_rsvp=False,
                    training_details=TrainingSessionAttach(category_id=foreign),
                ),
                organization_id=org,
                created_by=officer,
            )


class TestConfirmationRequired:
    async def test_pending_until_an_officer_approves(self, db_session, dept):
        org, officer, member = dept
        event_id, start, end = await _training_event(db_session, org, officer)
        session, _ = await TrainingSessionService(db_session).attach_session_to_event(
            event_id, TrainingSessionAttach(), org, officer
        )
        await db_session.execute(
            text(
                "UPDATE training_sessions SET require_completion_confirmation = 1 "
                "WHERE id = :id"
            ),
            {"id": session.id},
        )
        db_session.expire_all()
        await _add_with_edit_times(
            db_session, event_id, org, officer, member, start, end
        )

        outcome = await EventService(db_session).finalize_event_attendance_detailed(
            event_id, org, officer
        )

        assert outcome.training_approval_pending is True
        assert outcome.training_attendees_pending == 1
        (held,) = await _records(db_session, member)
        assert held["status"] == "in_progress"
        assert held["hours_completed"] == 0.0

        token = (
            await db_session.execute(
                text(
                    "SELECT approval_token FROM training_approvals "
                    "WHERE training_session_id = :s AND status = 'pending'"
                ),
                {"s": session.id},
            )
        ).scalar_one()
        approval, error = await TrainingSessionService(
            db_session
        ).get_training_approval_by_token(token, org)
        assert error is None
        from app.schemas.training_session import AttendeeApprovalData

        attendees = [AttendeeApprovalData(**a) for a in approval["attendees"]]
        ok, error = await TrainingSessionService(db_session).submit_training_approval(
            token=token,
            attendees=attendees,
            approval_notes=None,
            approved_by=officer,
            organization_id=org,
        )

        assert (ok, error) == (True, None)
        (record,) = await _records(db_session, member)
        assert record["status"] == "completed"
        assert record["hours_completed"] == 4.0
        # The stored roster round-trips as JSON (it used to fail at flush).
        stored = await db_session.execute(
            text(
                "SELECT attendee_data FROM training_approvals "
                "WHERE approval_token = :t"
            ),
            {"t": token},
        )
        assert stored.scalar_one() is not None


class TestTheUniqueKey:
    async def test_a_second_record_for_one_event_and_member_is_refused(
        self, db_session, dept
    ):
        from sqlalchemy.exc import IntegrityError

        org, officer, member = dept
        event_id, start, end = await _training_event(db_session, org, officer)
        await _add_with_edit_times(
            db_session, event_id, org, officer, member, start, end
        )
        await EventService(db_session).finalize_event_attendance_detailed(
            event_id, org, officer
        )

        async def insert_a_duplicate():
            async with db_session.begin_nested():
                await db_session.execute(
                    text(
                        "INSERT INTO training_records (id, organization_id, "
                        "user_id, course_name, training_type, hours_completed, "
                        "source_event_id) VALUES (:id, :org, :u, 'dup', "
                        "'continuing_education', 1.0, :e)"
                    ),
                    {"id": _uid(), "org": org, "u": member, "e": event_id},
                )

        with pytest.raises(IntegrityError):
            await insert_a_duplicate()
