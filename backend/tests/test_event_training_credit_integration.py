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


class TestTheApprovalFollowsTheEvent:
    async def _pending(self, db, dept):
        org, officer, member = dept
        event_id, start, end = await _training_event(db, org, officer)
        session, _ = await TrainingSessionService(db).attach_session_to_event(
            event_id, TrainingSessionAttach(), org, officer
        )
        await db.execute(
            text(
                "UPDATE training_sessions SET require_completion_confirmation = 1 "
                "WHERE id = :id"
            ),
            {"id": session.id},
        )
        db.expire_all()
        await _add_with_edit_times(db, event_id, org, officer, member, start, end)
        await EventService(db).finalize_event_attendance_detailed(
            event_id, org, officer
        )
        token = (
            await db.execute(
                text(
                    "SELECT approval_token FROM training_approvals "
                    "WHERE training_session_id = :s AND status = 'pending'"
                ),
                {"s": session.id},
            )
        ).scalar_one()
        return event_id, str(session.id), token

    async def test_a_reopen_kills_the_emailed_link(self, db_session, dept):
        from app.schemas.training_session import AttendeeApprovalData

        org, officer, member = dept
        event_id, _session_id, token = await self._pending(db_session, dept)
        training = TrainingSessionService(db_session)
        approval, _ = await training.get_training_approval_by_token(token, org)
        attendees = [AttendeeApprovalData(**a) for a in approval["attendees"]]

        _, error = await EventService(db_session).reopen_event_attendance(event_id, org)
        assert error is None
        ok, error = await training.submit_training_approval(
            token=token,
            attendees=attendees,
            approval_notes=None,
            approved_by=officer,
            organization_id=org,
        )

        assert (ok, error) == (False, "This approval link has expired")
        (held,) = await _records(db_session, member)
        assert held["status"] == "in_progress"

    async def test_the_old_session_route_finalizes_the_event(self, db_session, dept):
        org, officer, member = dept
        event_id, start, end = await _training_event(db_session, org, officer)
        session, _ = await TrainingSessionService(db_session).attach_session_to_event(
            event_id, TrainingSessionAttach(), org, officer
        )
        session_id = str(session.id)
        await _add_with_edit_times(
            db_session, event_id, org, officer, member, start, end
        )

        approval, error = await TrainingSessionService(
            db_session
        ).finalize_training_session(session_id, org, officer)

        assert error is None
        assert approval is not None
        finalized = await db_session.execute(
            text("SELECT attendance_finalized_at FROM events WHERE id = :id"),
            {"id": event_id},
        )
        assert finalized.scalar_one() is not None
        (record,) = await _records(db_session, member)
        assert (record["status"], record["hours_completed"]) == ("completed", 4.0)

        # A second finalize through either door is refused by the event lock.
        _, again = await TrainingSessionService(db_session).finalize_training_session(
            session_id, org, officer
        )
        assert again is not None

    async def test_a_re_finalize_that_credits_nobody_reports_no_approval(
        self, db_session, dept
    ):
        org, officer, member = dept
        event_id, start, end = await _training_event(db_session, org, officer)
        await TrainingSessionService(db_session).attach_session_to_event(
            event_id, TrainingSessionAttach(), org, officer
        )
        await _add_with_edit_times(
            db_session, event_id, org, officer, member, start, end
        )
        service = EventService(db_session)
        await service.finalize_event_attendance_detailed(event_id, org, officer)
        training = TrainingSessionService(db_session)
        first = await training.get_approval_summary_for_event(
            event_id, org, include_token=False
        )
        assert first["status"] == "approved"
        # created_at has one-second precision and the summary reads the
        # newest; a reopen and a re-finalize are never inside the second the
        # first finalize took, except in a test.
        await db_session.execute(
            text(
                "UPDATE training_approvals "
                "SET created_at = created_at - INTERVAL 1 HOUR WHERE event_id = :e"
            ),
            {"e": event_id},
        )

        await service.reopen_event_attendance(event_id, org)
        await service.remove_attendee(event_id, member, org)
        await service.finalize_event_attendance_detailed(event_id, org, officer)

        assert (
            await training.get_approval_summary_for_event(
                event_id, org, include_token=False
            )
            is None
        )


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


class TestTakingCreditBack:
    """Credit a reopened event gave comes back off when its basis goes."""

    async def _credited_and_reopened(self, db, dept):
        org, officer, member = dept
        event_id, start, end = await _training_event(db, org, officer)
        await _add_with_edit_times(db, event_id, org, officer, member, start, end)
        service = EventService(db)
        await service.finalize_event_attendance_detailed(event_id, org, officer)
        _, error = await service.reopen_event_attendance(event_id, org)
        assert error is None
        return event_id, service

    async def test_removing_the_attendee_cancels_their_record(self, db_session, dept):
        org, _officer, member = dept
        event_id, service = await self._credited_and_reopened(db_session, dept)

        error = await service.remove_attendee(event_id, member, org)

        assert error is None
        (record,) = await _records(db_session, member)
        assert record["status"] == "cancelled"
        assert record["hours_completed"] == 0.0
        assert "was 4.00 h" in record["notes"]

    async def test_deleting_the_event_voids_the_record(self, db_session, dept):
        org, _officer, member = dept
        event_id, service = await self._credited_and_reopened(db_session, dept)

        assert await service.delete_event(event_id, org) is True

        (record,) = await _records(db_session, member)
        assert record["status"] == "cancelled"
        assert record["source_event_id"] is None  # ON DELETE SET NULL

    async def test_cancelling_the_event_voids_the_record(self, db_session, dept):
        org, _officer, member = dept
        event_id, service = await self._credited_and_reopened(db_session, dept)

        await service.cancel_event(event_id, org, reason="Rained out")

        (record,) = await _records(db_session, member)
        assert record["status"] == "cancelled"

    async def test_retyping_away_from_training_voids_the_record(self, db_session, dept):
        org, officer, member = dept
        event_id, service = await self._credited_and_reopened(db_session, dept)

        await service.update_event(
            event_id, org, EventUpdate(event_type="business_meeting"), officer
        )

        (record,) = await _records(db_session, member)
        assert record["status"] == "cancelled"

    async def test_a_cancelled_event_cannot_be_finalized_back(self, db_session, dept):
        """Cancelling voided the credit. Finalize — directly or through Record
        Times — would write it back for an event that did not happen."""
        org, officer, member = dept
        event_id, service = await self._credited_and_reopened(db_session, dept)
        await service.cancel_event(event_id, org, reason="Rained out")

        outcome = await service.finalize_event_attendance_detailed(
            event_id, org, officer
        )
        _, times_error = await service.record_actual_times(
            event_id, org, None, datetime.now(timezone.utc), finalized_by=officer
        )

        assert outcome.error == "Cannot finalize attendance for a cancelled event"
        assert times_error == "Cannot record actual times for a cancelled event"
        (record,) = await _records(db_session, member)
        assert (record["status"], record["hours_completed"]) == ("cancelled", 0.0)
        finalized = await db_session.execute(
            text("SELECT attendance_finalized_at FROM events WHERE id = :id"),
            {"id": event_id},
        )
        assert finalized.scalar_one() is None

    async def test_finalizing_again_restores_a_voided_credit(self, db_session, dept):
        """Removed by mistake, added back, finalized: the same row, live again."""
        org, officer, member = dept
        event_id, service = await self._credited_and_reopened(db_session, dept)
        await service.remove_attendee(event_id, member, org)
        start_row = await db_session.execute(
            text("SELECT start_datetime, end_datetime FROM events WHERE id = :id"),
            {"id": event_id},
        )
        start, end = start_row.one()
        await _add_with_edit_times(
            db_session,
            event_id,
            org,
            officer,
            member,
            start.replace(tzinfo=timezone.utc),
            end.replace(tzinfo=timezone.utc),
        )

        await service.finalize_event_attendance_detailed(event_id, org, officer)

        (record,) = await _records(db_session, member)
        assert record["status"] == "completed"
        assert record["hours_completed"] == 4.0


class TestEndEvent:
    async def _checked_in_at_start(self, db, dept):
        org, officer, member = dept
        event_id, start, end = await _training_event(db, org, officer)
        _, error = await EventService(db).manager_add_attendee(
            event_id, member, org, officer, checked_in=True
        )
        assert error is None
        await db.execute(
            text(
                "UPDATE event_rsvps SET checked_in_at = :t "
                "WHERE event_id = :e AND user_id = :u"
            ),
            {"t": start.replace(tzinfo=None), "e": event_id, "u": member},
        )
        db.expire_all()
        return event_id, start, end

    async def test_end_event_credits_a_training_event(self, db_session, dept):
        """End Event's trailing finalize must not see its own end as the
        future — it did on MySQL, which rounds a stored fraction up."""
        org, officer, member = dept
        event_id, start, _end = await self._checked_in_at_start(db_session, dept)
        service = EventService(db_session)

        event, count, error = await service.end_event(event_id, org, officer)

        assert (error, count) == (None, 1)
        assert event.actual_end_time.microsecond == 0
        outcome = service.last_finalize_outcome
        assert outcome.error is None
        assert outcome.training_credit is True
        (record,) = await _records(db_session, member)
        assert record["status"] == "completed"

    async def test_a_corrected_end_after_end_event_changes_the_credit(
        self, db_session, dept
    ):
        """Pressed two hours late: the bulk check-out measured six hours. A
        reopen and the real end time must bring it back to four."""
        org, officer, member = dept
        event_id, start, end = await self._checked_in_at_start(db_session, dept)
        service = EventService(db_session)
        await service.end_event(event_id, org, officer)
        (late,) = await _records(db_session, member)
        assert late["hours_completed"] >= 5.9

        _, error = await service.reopen_event_attendance(event_id, org)
        assert error is None
        _, error = await service.record_actual_times(
            event_id, org, None, end, finalized_by=officer
        )

        assert error is None
        (record,) = await _records(db_session, member)
        assert (record["status"], record["hours_completed"]) == ("completed", 4.0)


class TestProgramCredit:
    """Credit a program-linked session gave comes back off when its basis goes,
    even after the session's program link was cleared during a reopen — the
    credit is found by the session as its source, not through the link."""

    async def _credited(self, db, dept):
        from app.schemas.training_session import TrainingSessionLinkageUpdate

        org, officer, member = dept
        program_id, requirement_id = _uid(), _uid()
        enrollment_id, progress_id = _uid(), _uid()
        await db.execute(
            text(
                "INSERT INTO training_programs (id, organization_id, name) "
                "VALUES (:id, :org, 'Recruit School')"
            ),
            {"id": program_id, "org": org},
        )
        await db.execute(
            text(
                "INSERT INTO training_requirements (id, organization_id, name, "
                "requirement_type, frequency, required_hours) "
                "VALUES (:id, :org, 'Hose Ops Hours', 'hours', 'one_time', 20)"
            ),
            {"id": requirement_id, "org": org},
        )
        await db.execute(
            text(
                "INSERT INTO program_requirements (id, program_id, requirement_id) "
                "VALUES (:id, :p, :r)"
            ),
            {"id": _uid(), "p": program_id, "r": requirement_id},
        )
        await db.execute(
            text(
                "INSERT INTO program_enrollments (id, organization_id, user_id, "
                "program_id, enrolled_at, status) "
                "VALUES (:id, :org, :u, :p, NOW(), 'active')"
            ),
            {"id": enrollment_id, "org": org, "u": member, "p": program_id},
        )
        await db.execute(
            text(
                "INSERT INTO requirement_progress "
                "(id, enrollment_id, requirement_id, status, progress_value) "
                "VALUES (:id, :e, :r, 'not_started', 0)"
            ),
            {"id": progress_id, "e": enrollment_id, "r": requirement_id},
        )
        event_id, start, end = await _training_event(db, org, officer)
        session, error = await TrainingSessionService(db).attach_session_to_event(
            event_id,
            TrainingSessionAttach(program_id=program_id, requirement_id=requirement_id),
            org,
            officer,
        )
        assert error is None
        session_id = str(session.id)
        await _add_with_edit_times(db, event_id, org, officer, member, start, end)
        service = EventService(db)
        await service.finalize_event_attendance_detailed(
            event_id, org, officer, can_manage_training=True
        )
        assert await self._credits(db, session_id) == 1
        assert await self._progress(db, progress_id) == 4.0

        _, error = await service.reopen_event_attendance(event_id, org)
        assert error is None
        # The link is cleared before the credit is taken back.
        _, error = await TrainingSessionService(db).update_session_linkage(
            session_id,
            TrainingSessionLinkageUpdate(program_id=None, requirement_id=None),
            org,
        )
        assert error is None
        return event_id, session_id, progress_id, service

    async def _credits(self, db, session_id):
        result = await db.execute(
            text(
                "SELECT COUNT(*) FROM requirement_progress_credits "
                "WHERE source_id = :s"
            ),
            {"s": session_id},
        )
        return result.scalar_one()

    async def _progress(self, db, progress_id):
        result = await db.execute(
            text("SELECT progress_value FROM requirement_progress WHERE id = :id"),
            {"id": progress_id},
        )
        return float(result.scalar_one() or 0)

    async def test_deleting_the_event_reverses_it(self, db_session, dept):
        org, _officer, _member = dept
        event_id, session_id, progress_id, service = await self._credited(
            db_session, dept
        )

        assert await service.delete_event(event_id, org) is True

        assert await self._credits(db_session, session_id) == 0
        assert await self._progress(db_session, progress_id) == 0.0

    async def test_removing_the_attendee_reverses_theirs(self, db_session, dept):
        org, _officer, member = dept
        event_id, session_id, progress_id, service = await self._credited(
            db_session, dept
        )

        assert await service.remove_attendee(event_id, member, org) is None

        assert await self._credits(db_session, session_id) == 0
        assert await self._progress(db_session, progress_id) == 0.0


class TestSeries:
    async def _series(self, db, org, officer, **extra):
        first = (datetime.now(timezone.utc) - timedelta(days=15)).replace(
            hour=13, minute=0, second=0, microsecond=0
        )
        events, error = await EventService(db).create_recurring_event(
            {
                "title": "Weekly Hose Ops",
                "event_type": "training",
                "start_datetime": first,
                "end_datetime": first + timedelta(hours=4),
                "requires_rsvp": False,
                "recurrence_pattern": "weekly",
                "recurrence_end_date": first + timedelta(days=14),
                **extra,
            },
            org,
            officer,
        )
        assert error is None
        # Plain ids: the session is expired below to read rows back.
        return [(str(e.id), e.start_datetime, e.end_datetime) for e in events]

    async def test_details_give_every_occurrence_its_own_session(
        self, db_session, dept
    ):
        org, officer, _member = dept
        category_id = await _insert_category(db_session, org)
        events = await self._series(
            db_session, org, officer, training_details={"category_id": category_id}
        )

        result = await db_session.execute(
            text(
                "SELECT event_id, category_id FROM training_sessions "
                "WHERE organization_id = :org"
            ),
            {"org": org},
        )
        sessions = {row[0]: row[1] for row in result}
        assert len(events) >= 2
        assert set(sessions) == {event_id for event_id, _, _ in events}
        assert set(sessions.values()) == {category_id}

    @pytest.mark.parametrize("remove", ["cancel", "delete"])
    async def test_ending_the_series_voids_a_reopened_occurrence(
        self, db_session, dept, remove
    ):
        org, officer, member = dept
        events = await self._series(db_session, org, officer)
        event_id, start, end = events[0]
        start = start.replace(tzinfo=timezone.utc) if start.tzinfo is None else start
        end = end.replace(tzinfo=timezone.utc) if end.tzinfo is None else end
        await _add_with_edit_times(
            db_session, event_id, org, officer, member, start, end
        )
        service = EventService(db_session)
        await service.finalize_event_attendance_detailed(event_id, org, officer)
        await service.reopen_event_attendance(event_id, org)
        parent = await db_session.execute(
            text(
                "SELECT COALESCE(recurrence_parent_id, id) FROM events WHERE id = :id"
            ),
            {"id": event_id},
        )
        parent_id = parent.scalar_one()

        if remove == "cancel":
            await service.cancel_series(parent_id, org, reason="Season over")
        else:
            await service.delete_event_series(parent_id, org)

        (record,) = await _records(db_session, member)
        assert (record["status"], record["hours_completed"]) == ("cancelled", 0.0)


class TestQualificationFollowsTheCourse:
    async def test_switching_the_course_takes_the_old_grant_back(
        self, db_session, dept
    ):
        """Filed under course A (which grants EMT), then re-filed under B:
        the member must not stay EMT-cleared on a record that no longer
        names A. Only clearing the course recomputed it before."""
        from app.models.training import TrainingCourse, TrainingType
        from app.schemas.training_session import TrainingSessionLinkageUpdate
        from app.services.qualification_service import QualificationService

        org, officer, member = dept
        course_a = TrainingCourse(
            id=_uid(),
            organization_id=org,
            name="EMT Basic",
            training_type=TrainingType.CERTIFICATION,
            grants_qualification="emt",
        )
        course_b = TrainingCourse(
            id=_uid(),
            organization_id=org,
            name="Hose Ops",
            training_type=TrainingType.SKILLS_PRACTICE,
        )
        db_session.add_all([course_a, course_b])
        await db_session.flush()
        course_a_id, course_b_id = str(course_a.id), str(course_b.id)
        event_id, start, end = await _training_event(db_session, org, officer)
        session, _ = await TrainingSessionService(db_session).attach_session_to_event(
            event_id, TrainingSessionAttach(course_id=course_a_id), org, officer
        )
        session_id = str(session.id)
        await _add_with_edit_times(
            db_session, event_id, org, officer, member, start, end
        )
        service = EventService(db_session)
        await service.finalize_event_attendance_detailed(event_id, org, officer)
        held = await QualificationService(db_session).get_current_by_member(org)
        assert [q["code"] for q in held.get(member, [])] == ["emt"]

        await service.reopen_event_attendance(event_id, org)
        _, error = await TrainingSessionService(db_session).update_session_linkage(
            session_id, TrainingSessionLinkageUpdate(course_id=course_b_id), org
        )
        assert error is None
        await service.finalize_event_attendance_detailed(event_id, org, officer)

        held = await QualificationService(db_session).get_current_by_member(org)
        assert held.get(member, []) == []
        stored = await db_session.execute(
            text("SELECT course_id FROM training_records WHERE user_id = :u"),
            {"u": member},
        )
        assert stored.scalar_one() == course_b_id


class TestATitleFixReachesTheRecords:
    async def test_renaming_a_finalized_event_renames_its_records(
        self, db_session, dept
    ):
        """Title fixes are allowed on a finalized event, and no re-finalize
        will come along to carry the new title across."""
        org, officer, member = dept
        event_id, start, end = await _training_event(
            db_session, org, officer, title="Hose Opps"
        )
        await _add_with_edit_times(
            db_session, event_id, org, officer, member, start, end
        )
        service = EventService(db_session)
        await service.finalize_event_attendance_detailed(event_id, org, officer)

        await service.update_event(
            event_id, org, EventUpdate(title="Hose Ops"), officer
        )

        (record,) = await _records(db_session, member)
        assert (record["course_name"], record["status"]) == ("Hose Ops", "completed")


async def _admin_mapping(db, org_id: str, event_type: str) -> str:
    category_id = _uid()
    await db.execute(
        text(
            "INSERT INTO admin_hours_categories "
            "(id, organization_id, name, require_approval, is_active, sort_order) "
            "VALUES (:id, :org, 'Meetings', 0, 1, 0)"
        ),
        {"id": category_id, "org": org_id},
    )
    await db.execute(
        text(
            "INSERT INTO event_hour_mappings "
            "(id, organization_id, event_type, admin_hours_category_id, "
            "percentage, is_active) VALUES (:id, :org, :type, :cat, 100, 1)"
        ),
        {"id": _uid(), "org": org_id, "type": event_type, "cat": category_id},
    )
    return category_id


async def _admin_entries(db, user_id: str) -> list:
    result = await db.execute(
        text(
            "SELECT duration_minutes, clock_in_at, clock_out_at "
            "FROM admin_hours_entries WHERE user_id = :u"
        ),
        {"u": user_id},
    )
    return [dict(row._mapping) for row in result]


class TestAdminHours:
    async def test_a_meeting_retyped_to_training_drops_its_admin_entry(
        self, db_session, dept
    ):
        """A business meeting finalized into admin hours, reopened, re-typed
        as training and finalized again: the hours are now training credit,
        and the admin-hours entry that held them is removed."""
        org, officer, member = dept
        await _admin_mapping(db_session, org, "business_meeting")
        start, end = _past_window()
        created = await EventService(db_session).create_event(
            EventCreate(
                title="Officers' meeting",
                event_type="business_meeting",
                start_datetime=start,
                end_datetime=end,
                requires_rsvp=False,
            ),
            organization_id=org,
            created_by=officer,
        )
        event_id = str(created.id)
        await _add_with_edit_times(
            db_session, event_id, org, officer, member, start, end
        )
        service = EventService(db_session)
        await service.finalize_event_attendance_detailed(event_id, org, officer)
        assert len(await _admin_entries(db_session, member)) == 1

        await service.reopen_event_attendance(event_id, org)
        await service.update_event(
            event_id, org, EventUpdate(event_type="training"), officer
        )
        outcome = await service.finalize_event_attendance_detailed(
            event_id, org, officer
        )

        assert outcome.admin_hours_entries_removed == 1
        assert await _admin_entries(db_session, member) == []
        (record,) = await _records(db_session, member)
        assert record["hours_completed"] == 4.0

    async def test_a_training_mapping_credits_no_admin_hours(self, db_session, dept):
        org, officer, member = dept
        await _admin_mapping(db_session, org, "training")
        event_id, start, end = await _training_event(db_session, org, officer)
        await _add_with_edit_times(
            db_session, event_id, org, officer, member, start, end
        )

        await EventService(db_session).finalize_event_attendance_detailed(
            event_id, org, officer
        )

        assert await _admin_entries(db_session, member) == []

    async def test_the_admin_entry_window_ends_at_the_override_check_out(
        self, db_session, dept
    ):
        org, officer, member = dept
        await _admin_mapping(db_session, org, "business_meeting")
        start, end = _past_window()
        created = await EventService(db_session).create_event(
            EventCreate(
                title="Officers' meeting",
                event_type="business_meeting",
                start_datetime=start,
                end_datetime=end,
                requires_rsvp=False,
            ),
            organization_id=org,
            created_by=officer,
        )
        event_id = str(created.id)
        service = EventService(db_session)
        await service.manager_add_attendee(
            event_id, member, org, officer, checked_in=False
        )
        override_out = start + timedelta(hours=3)
        await service.override_rsvp_attendance(
            event_id,
            member,
            org,
            officer,
            RSVPOverride(
                override_check_in_at=start, override_check_out_at=override_out
            ),
        )

        await service.finalize_event_attendance_detailed(event_id, org, officer)

        (entry,) = await _admin_entries(db_session, member)
        assert entry["duration_minutes"] == 180
        assert entry["clock_out_at"].replace(tzinfo=timezone.utc) == override_out
