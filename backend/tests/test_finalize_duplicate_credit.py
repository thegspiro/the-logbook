"""Finalize flags possible double credit; it never merges or adopts.

Owner decision 2026-11-23 ("Double credit: flag, never merge"). A member who
already holds an approved self-report or a hand-entered completed record for
the event's day, with the same course or a close name (an equal match key),
is flagged for an officer. Two different classes on the same day are not, and
a re-finalize records nothing new (pitfall #36).

Against real rows; records are read back with raw SQL so the identity map
cannot report a write that never landed.
"""

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.training import (
    SubmissionStatus,
    TrainingRecord,
    TrainingStatus,
    TrainingSubmission,
    TrainingType,
)
from app.schemas.event import EventCreate, RSVPOverride
from app.schemas.training_session import AttendeeApprovalData, TrainingSessionAttach
from app.services.admin_hub_service import MODULE_REGISTRY, MetricContext
from app.services.event_service import EventService
from app.services.training_credit_duplicates import (
    count_open_flags,
    keep_both,
    list_open_flags,
)
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


async def _training_event(db, org, officer, member, title="Hose Ops"):
    """A held Training event with ``member`` credited four hours."""
    start, end = _past_window()
    event = await EventService(db).create_event(
        EventCreate(
            title=title,
            event_type="training",
            start_datetime=start,
            end_datetime=end,
            requires_rsvp=False,
        ),
        organization_id=org,
        created_by=officer,
    )
    event_id = str(event.id)
    service = EventService(db)
    _, error = await service.manager_add_attendee(
        event_id, member, org, officer, checked_in=False
    )
    assert error is None
    _, error = await service.override_rsvp_attendance(
        event_id,
        member,
        org,
        officer,
        RSVPOverride(override_check_in_at=start, override_check_out_at=end),
    )
    assert error is None
    return event_id, start.date()


async def _with_session(db, event_id, org, officer, *, confirm=False):
    session, error = await TrainingSessionService(db).attach_session_to_event(
        event_id, TrainingSessionAttach(), org, officer
    )
    assert error is None
    session_id = str(session.id)
    if confirm:
        await db.execute(
            text(
                "UPDATE training_sessions SET require_completion_confirmation = 1 "
                "WHERE id = :id"
            ),
            {"id": session_id},
        )
        db.expire_all()
    return session_id


async def _hand_entered(db, org, officer, member, name, day, hours=2.0) -> str:
    record = TrainingRecord(
        organization_id=org,
        user_id=member,
        course_name=name,
        training_type=TrainingType.CONTINUING_EDUCATION,
        completion_date=day,
        hours_completed=hours,
        status=TrainingStatus.COMPLETED,
        created_by=officer,
    )
    db.add(record)
    await db.flush()
    return str(record.id)


async def _self_reported(db, org, officer, member, name, day, hours=3.0) -> str:
    record_id = await _hand_entered(db, org, member, member, name, day, hours)
    db.add(
        TrainingSubmission(
            organization_id=org,
            submitted_by=member,
            course_name=name,
            training_type=TrainingType.CONTINUING_EDUCATION,
            completion_date=day,
            hours_completed=hours,
            status=SubmissionStatus.APPROVED,
            reviewed_by=officer,
            training_record_id=record_id,
        )
    )
    await db.flush()
    return record_id


async def _records(db, member) -> dict:
    rows = await db.execute(
        text(
            "SELECT id, status, hours_completed, course_name, source_event_id "
            "FROM training_records WHERE user_id = :u"
        ),
        {"u": member},
    )
    return {row.id: dict(row._mapping) for row in rows}


async def _flags(db, org) -> list:
    rows = await db.execute(
        text(
            "SELECT event_record_id, other_record_id, match_reason, resolution "
            "FROM training_credit_duplicate_flags WHERE organization_id = :o"
        ),
        {"o": org},
    )
    return [dict(row._mapping) for row in rows]


async def _finalize(db, event_id, org, officer):
    outcome = await EventService(db).finalize_event_attendance_detailed(
        event_id, org, officer
    )
    assert outcome.error is None
    return outcome


async def _refinalize(db, event_id, org, officer):
    _, error = await EventService(db).reopen_event_attendance(event_id, org)
    assert error is None
    return await _finalize(db, event_id, org, officer)


class TestTheDuplicateIsFlagged:
    async def test_hand_entered_record_with_a_close_name(self, db_session, dept):
        org, officer, member = dept
        event_id, day = await _training_event(db_session, org, officer, member)
        await _with_session(db_session, event_id, org, officer)
        hand = await _hand_entered(db_session, org, officer, member, "HOSE-ops.", day)

        await _finalize(db_session, event_id, org, officer)

        records = await _records(db_session, member)
        assert len(records) == 2
        # The member's own record is neither adopted nor changed.
        assert records[hand]["source_event_id"] is None
        assert records[hand]["hours_completed"] == 2.0
        assert records[hand]["status"] == "completed"
        (event_record,) = [r for r in records.values() if r["source_event_id"]]
        assert event_record["hours_completed"] == 4.0
        assert await _flags(db_session, org) == [
            {
                "event_record_id": event_record["id"],
                "other_record_id": hand,
                "match_reason": "same_name",
                "resolution": None,
            }
        ]

    async def test_self_report_with_the_exact_name_is_not_adopted(
        self, db_session, dept
    ):
        # Before the decision, finalize took the self-report's record over:
        # stamped it as the event's, overwrote its hours, and a later void of
        # the event's credit voided the member's own claim with it.
        org, officer, member = dept
        event_id, day = await _training_event(db_session, org, officer, member)
        await _with_session(db_session, event_id, org, officer)
        claim = await _self_reported(db_session, org, officer, member, "Hose Ops", day)

        await _finalize(db_session, event_id, org, officer)

        records = await _records(db_session, member)
        assert len(records) == 2
        assert records[claim]["source_event_id"] is None
        assert records[claim]["hours_completed"] == 3.0
        flags = await _flags(db_session, org)
        assert [f["other_record_id"] for f in flags] == [claim]
        (pair,) = await list_open_flags(db_session, org)
        assert pair.other_from_self_report is True
        assert pair.member_name

    async def test_event_with_no_session_is_checked_too(self, db_session, dept):
        org, officer, member = dept
        event_id, day = await _training_event(db_session, org, officer, member)
        hand = await _hand_entered(db_session, org, officer, member, "hose ops", day)

        await _finalize(db_session, event_id, org, officer)

        flags = await _flags(db_session, org)
        assert [f["other_record_id"] for f in flags] == [hand]

    async def test_sign_off_session_flags_when_the_officer_approves(
        self, db_session, dept
    ):
        org, officer, member = dept
        event_id, day = await _training_event(db_session, org, officer, member)
        session_id = await _with_session(
            db_session, event_id, org, officer, confirm=True
        )
        hand = await _hand_entered(db_session, org, officer, member, "Hose Ops", day)

        await _finalize(db_session, event_id, org, officer)
        # Nothing is credited while approval waits, so nothing doubles yet.
        assert await _flags(db_session, org) == []

        token = (
            await db_session.execute(
                text(
                    "SELECT approval_token FROM training_approvals "
                    "WHERE training_session_id = :s AND status = 'pending'"
                ),
                {"s": session_id},
            )
        ).scalar_one()
        service = TrainingSessionService(db_session)
        approval, error = await service.get_training_approval_by_token(token, org)
        assert error is None
        ok, error = await service.submit_training_approval(
            token=token,
            attendees=[AttendeeApprovalData(**a) for a in approval["attendees"]],
            approval_notes=None,
            approved_by=officer,
            organization_id=org,
        )
        assert (ok, error) == (True, None)

        flags = await _flags(db_session, org)
        assert [f["other_record_id"] for f in flags] == [hand]
        records = await _records(db_session, member)
        assert records[hand]["source_event_id"] is None


class TestDifferentClassesAreLeftAlone:
    async def test_a_different_class_on_the_same_day(self, db_session, dept):
        org, officer, member = dept
        event_id, day = await _training_event(db_session, org, officer, member)
        await _with_session(db_session, event_id, org, officer)
        # Shares a word, and a prefix: still a different class.
        other = await _hand_entered(
            db_session, org, officer, member, "Hose Ops Refresher", day
        )

        await _finalize(db_session, event_id, org, officer)

        assert await _flags(db_session, org) == []
        records = await _records(db_session, member)
        assert len(records) == 2
        assert records[other]["source_event_id"] is None
        assert records[other]["hours_completed"] == 2.0

    async def test_the_same_class_on_another_day(self, db_session, dept):
        org, officer, member = dept
        event_id, day = await _training_event(db_session, org, officer, member)
        await _with_session(db_session, event_id, org, officer)
        await _hand_entered(
            db_session, org, officer, member, "Hose Ops", day - timedelta(days=2)
        )

        await _finalize(db_session, event_id, org, officer)

        assert await _flags(db_session, org) == []


class TestRefinalizeIsANoOp:
    async def test_a_second_finalize_does_not_flag_again(self, db_session, dept):
        org, officer, member = dept
        event_id, day = await _training_event(db_session, org, officer, member)
        await _with_session(db_session, event_id, org, officer)
        await _hand_entered(db_session, org, officer, member, "Hose Ops", day)

        await _finalize(db_session, event_id, org, officer)
        await _refinalize(db_session, event_id, org, officer)

        assert len(await _flags(db_session, org)) == 1
        assert len(await _records(db_session, member)) == 2

    async def test_keep_both_survives_a_re_finalize(self, db_session, dept):
        org, officer, member = dept
        event_id, day = await _training_event(db_session, org, officer, member)
        await _with_session(db_session, event_id, org, officer)
        await _hand_entered(db_session, org, officer, member, "Hose Ops", day)
        await _finalize(db_session, event_id, org, officer)
        (pair,) = await list_open_flags(db_session, org)

        kept = await keep_both(db_session, org, pair.flag.id, officer)
        assert kept is not None
        assert kept.resolution == "kept_both"
        await _refinalize(db_session, event_id, org, officer)

        assert await count_open_flags(db_session, org) == (0, None)
        flags = await _flags(db_session, org)
        assert [f["resolution"] for f in flags] == ["kept_both"]


class TestResolving:
    async def test_voiding_either_record_closes_the_pair(self, db_session, dept):
        org, officer, member = dept
        event_id, day = await _training_event(db_session, org, officer, member)
        await _with_session(db_session, event_id, org, officer)
        hand = await _hand_entered(db_session, org, officer, member, "Hose Ops", day)
        await _finalize(db_session, event_id, org, officer)
        count, oldest = await count_open_flags(db_session, org)
        assert count == 1
        assert oldest is not None

        await db_session.execute(
            text("UPDATE training_records SET status = 'cancelled' WHERE id = :id"),
            {"id": hand},
        )
        db_session.expire_all()

        assert await count_open_flags(db_session, org) == (0, None)
        assert await list_open_flags(db_session, org) == []

    async def test_keep_both_is_scoped_to_the_organization(self, db_session, dept):
        org, officer, member = dept
        event_id, day = await _training_event(db_session, org, officer, member)
        await _with_session(db_session, event_id, org, officer)
        await _hand_entered(db_session, org, officer, member, "Hose Ops", day)
        await _finalize(db_session, event_id, org, officer)
        (pair,) = await list_open_flags(db_session, org)
        other_org = await _insert_org(db_session)

        assert await keep_both(db_session, other_org, pair.flag.id, officer) is None
        assert (await count_open_flags(db_session, org))[0] == 1

    async def test_the_training_hub_lists_open_pairs(self, db_session, dept):
        org, officer, member = dept
        event_id, day = await _training_event(db_session, org, officer, member)
        await _with_session(db_session, event_id, org, officer)
        await _hand_entered(db_session, org, officer, member, "Hose Ops", day)
        await _finalize(db_session, event_id, org, officer)

        ctx = MetricContext(
            db=db_session,
            organization_id=org,
            user=None,
            today=date.today(),
            timezone_name="UTC",
            local_midnight=datetime.now(timezone.utc).replace(
                hour=0, minute=0, second=0, microsecond=0
            ),
            enabled_modules={"training"},
        )
        items = {i.key: i for i in await MODULE_REGISTRY["training"].attention(ctx)}

        item = items["possible_double_credit"]
        assert item.count == 1
        assert item.href == "/training/admin?page=records&tab=double-credit"


class TestLegacyRecordsAreStillAdopted:
    async def test_a_record_an_earlier_finalize_wrote_before_the_source_link(
        self, db_session, dept
    ):
        # Records completed by a finalize from before source_event_id existed
        # carry no source. The name-and-day lookup exists to adopt exactly
        # these, and an earlier approved finalize of the session vouches that
        # the record is the event's own, not somebody's hand entry.
        org, officer, member = dept
        event_id, _ = await _training_event(db_session, org, officer, member)
        await _with_session(db_session, event_id, org, officer)
        await _finalize(db_session, event_id, org, officer)
        await db_session.execute(
            text(
                "UPDATE training_records SET source_event_id = NULL "
                "WHERE user_id = :u"
            ),
            {"u": member},
        )
        db_session.expire_all()

        await _refinalize(db_session, event_id, org, officer)

        records = await _records(db_session, member)
        assert len(records) == 1
        (record,) = records.values()
        assert record["source_event_id"] == event_id
        assert await _flags(db_session, org) == []
