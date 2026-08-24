"""
Integration cover for the urgency fields the /events list projects.

`test_event_list_urgency_fields.py` covers the pure resolution rules with
mocks. This exercises the parts only a real database can prove: the correlated
`user_attended` subquery (a CASE over two columns, one of which is NULL for a
member who never RSVP'd) and the `mandatory_only` filter the band's
missed-event fetch depends on.

The distinction the subquery has to get right is not "checked in or not" but
three-way: no RSVP row at all, an RSVP with `checked_in`, and an RSVP an
officer back-filled with `override_check_in_at` and never marked checked_in.
The last one is the reason this is a CASE and not a column read, and it is
also the one that decides whether a member who was present gets told they
missed a mandatory drill.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.event_service import EventService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def org_and_user(db_session: AsyncSession):
    org_id, user_id = _uid(), _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "name": "Test Dept", "slug": f"test-{org_id[:8]}"},
    )
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, 'Jo', 'Smith', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"u{user_id[:8]}",
            "em": f"{user_id[:8]}@test.com",
        },
    )
    await db_session.flush()
    return org_id, user_id


async def _insert_event(
    db_session: AsyncSession,
    org_id: str,
    *,
    title: str,
    is_mandatory: bool = False,
    hours_ago: int = 48,
) -> str:
    event_id = _uid()
    end = datetime.now(timezone.utc) - timedelta(hours=hours_ago)
    await db_session.execute(
        text(
            # reminder_schedule is NOT NULL with only a Python-side default,
            # so a raw INSERT has to supply it.
            "INSERT INTO events (id, organization_id, title, event_type, "
            "start_datetime, end_datetime, requires_rsvp, is_mandatory, "
            "is_cancelled, is_draft, reminder_schedule) "
            "VALUES (:id, :org, :title, 'training', :start, :end, 1, :mand, "
            "0, 0, '[24]')"
        ),
        {
            "id": event_id,
            "org": org_id,
            "title": title,
            "start": end - timedelta(hours=2),
            "end": end,
            "mand": 1 if is_mandatory else 0,
        },
    )
    await db_session.flush()
    return event_id


async def _insert_rsvp(
    db_session: AsyncSession,
    org_id: str,
    event_id: str,
    user_id: str,
    *,
    checked_in: bool = False,
    override_check_in: bool = False,
) -> None:
    await db_session.execute(
        text(
            "INSERT INTO event_rsvps (id, organization_id, event_id, user_id, "
            "status, guest_count, checked_in, override_check_in_at) "
            "VALUES (:id, :org, :ev, :usr, 'going', 0, :ci, :oci)"
        ),
        {
            "id": _uid(),
            "org": org_id,
            "ev": event_id,
            "usr": user_id,
            "ci": 1 if checked_in else 0,
            "oci": datetime.now(timezone.utc) if override_check_in else None,
        },
    )
    await db_session.flush()


async def _list_one(service: EventService, org_id: str, user_id: str, event_id: str):
    rows = await service.list_events(
        organization_id=uuid.UUID(org_id), user_id=uuid.UUID(user_id)
    )
    return next(r for r in rows if r["event"].id == event_id)


class TestUserAttendedProjection:
    async def test_no_rsvp_row_reads_as_not_attended(self, db_session, org_and_user):
        # The correlated subquery matches nothing and yields NULL; it must
        # surface as False, not None — a member who never responded and never
        # showed up did not attend.
        org_id, user_id = org_and_user
        event_id = await _insert_event(db_session, org_id, title="Unanswered Drill")

        row = await _list_one(EventService(db_session), org_id, user_id, event_id)

        assert row["user_attended"] is False

    async def test_checked_in_rsvp_reads_as_attended(self, db_session, org_and_user):
        org_id, user_id = org_and_user
        event_id = await _insert_event(db_session, org_id, title="Scanned Drill")
        await _insert_rsvp(db_session, org_id, event_id, user_id, checked_in=True)

        row = await _list_one(EventService(db_session), org_id, user_id, event_id)

        assert row["user_attended"] is True

    async def test_rsvp_without_check_in_reads_as_not_attended(
        self, db_session, org_and_user
    ):
        org_id, user_id = org_and_user
        event_id = await _insert_event(db_session, org_id, title="Said Going, No Show")
        await _insert_rsvp(db_session, org_id, event_id, user_id, checked_in=False)

        row = await _list_one(EventService(db_session), org_id, user_id, event_id)

        assert row["user_attended"] is False

    async def test_officer_back_filled_attendance_reads_as_attended(
        self, db_session, org_and_user
    ):
        # An officer recording attendance after the fact writes
        # override_check_in_at and never touches `checked_in`. Reading only
        # `checked_in` would tell a member who was demonstrably present that
        # they missed a mandatory drill.
        org_id, user_id = org_and_user
        event_id = await _insert_event(db_session, org_id, title="Back-filled Drill")
        await _insert_rsvp(
            db_session,
            org_id,
            event_id,
            user_id,
            checked_in=False,
            override_check_in=True,
        )

        row = await _list_one(EventService(db_session), org_id, user_id, event_id)

        assert row["user_attended"] is True

    async def test_another_members_check_in_does_not_count_as_mine(
        self, db_session, org_and_user
    ):
        org_id, user_id = org_and_user
        other_id = _uid()
        await db_session.execute(
            text(
                "INSERT INTO users (id, organization_id, username, first_name, "
                "last_name, email, password_hash, status) "
                "VALUES (:id, :org, :un, 'Other', 'Member', :em, 'hashed', 'active')"
            ),
            {
                "id": other_id,
                "org": org_id,
                "un": f"u{other_id[:8]}",
                "em": f"{other_id[:8]}@test.com",
            },
        )
        event_id = await _insert_event(db_session, org_id, title="Someone Else's Drill")
        await _insert_rsvp(db_session, org_id, event_id, other_id, checked_in=True)

        row = await _list_one(EventService(db_session), org_id, user_id, event_id)

        assert row["user_attended"] is False


class TestMandatoryOnlyFilter:
    async def test_returns_only_mandatory_events(self, db_session, org_and_user):
        org_id, user_id = org_and_user
        mandatory_id = await _insert_event(
            db_session, org_id, title="Mandatory Drill", is_mandatory=True
        )
        optional_id = await _insert_event(
            db_session, org_id, title="Optional Social", is_mandatory=False
        )

        rows = await EventService(db_session).list_events(
            organization_id=uuid.UUID(org_id),
            user_id=uuid.UUID(user_id),
            mandatory_only=True,
        )
        returned = {r["event"].id for r in rows}

        assert mandatory_id in returned
        assert optional_id not in returned

    async def test_off_by_default(self, db_session, org_and_user):
        org_id, user_id = org_and_user
        optional_id = await _insert_event(
            db_session, org_id, title="Optional Social", is_mandatory=False
        )

        rows = await EventService(db_session).list_events(
            organization_id=uuid.UUID(org_id), user_id=uuid.UUID(user_id)
        )

        assert optional_id in {r["event"].id for r in rows}


class TestDerivedFieldsReachTheList:
    async def test_check_in_window_is_attached_to_every_row(
        self, db_session, org_and_user
    ):
        org_id, user_id = org_and_user
        event_id = await _insert_event(db_session, org_id, title="Windowed Drill")

        row = await _list_one(EventService(db_session), org_id, user_id, event_id)

        assert row["check_in_opens_at"] is not None
        assert row["check_in_closes_at"] is not None
        assert row["check_in_opens_at"] < row["check_in_closes_at"]

    async def test_credited_hours_is_none_without_a_mapping(
        self, db_session, org_and_user
    ):
        # A fresh org has no event-hour mappings, so the card must show no
        # hours rather than claiming a credit nothing will award.
        org_id, user_id = org_and_user
        event_id = await _insert_event(db_session, org_id, title="Unmapped Drill")

        row = await _list_one(EventService(db_session), org_id, user_id, event_id)

        assert row["credited_hours"] is None
        assert row["hour_category_label"] is None


class TestMissedMandatoryExclusions:
    """A `missed` row the member cannot clear is an accusation, not a reminder.

    The band is headed "clears itself as you respond". Three kinds of event
    satisfy "mandatory, over, no check-in" while being nobody's fault, and each
    is excluded server-side so a client cannot forget to.
    """

    async def _hire(self, db_session: AsyncSession, user_id: str, hire_date):
        await db_session.execute(
            text("UPDATE users SET hire_date = :hd WHERE id = :id"),
            {"hd": hire_date, "id": user_id},
        )
        await db_session.flush()

    async def test_includes_a_genuine_miss(self, db_session, org_and_user):
        org_id, user_id = org_and_user
        event_id = await _insert_event(
            db_session, org_id, title="Standpipe Drill", is_mandatory=True
        )

        rows = await EventService(db_session).list_missed_mandatory_events(
            organization_id=uuid.UUID(org_id),
            user_id=uuid.UUID(user_id),
            since=datetime.now(timezone.utc) - timedelta(days=30),
        )

        assert event_id in {r["event"].id for r in rows}

    async def test_excludes_an_event_the_member_attended(
        self, db_session, org_and_user
    ):
        org_id, user_id = org_and_user
        event_id = await _insert_event(
            db_session, org_id, title="Attended Drill", is_mandatory=True
        )
        await _insert_rsvp(db_session, org_id, event_id, user_id, checked_in=True)

        rows = await EventService(db_session).list_missed_mandatory_events(
            organization_id=uuid.UUID(org_id),
            user_id=uuid.UUID(user_id),
            since=datetime.now(timezone.utc) - timedelta(days=30),
        )

        assert event_id not in {r["event"].id for r in rows}

    async def test_excludes_an_event_held_before_the_member_was_hired(
        self, db_session, org_and_user
    ):
        # Joining last week is not a reason to be told you skipped a drill held
        # the week before that.
        org_id, user_id = org_and_user
        event_id = await _insert_event(
            db_session, org_id, title="Pre-hire Drill", is_mandatory=True, hours_ago=240
        )
        await self._hire(
            db_session, user_id, (datetime.now(timezone.utc) - timedelta(days=2)).date()
        )

        rows = await EventService(db_session).list_missed_mandatory_events(
            organization_id=uuid.UUID(org_id),
            user_id=uuid.UUID(user_id),
            since=datetime.now(timezone.utc) - timedelta(days=30),
        )

        assert event_id not in {r["event"].id for r in rows}

    async def test_includes_an_event_held_after_the_member_was_hired(
        self, db_session, org_and_user
    ):
        org_id, user_id = org_and_user
        event_id = await _insert_event(
            db_session, org_id, title="Post-hire Drill", is_mandatory=True, hours_ago=48
        )
        await self._hire(
            db_session,
            user_id,
            (datetime.now(timezone.utc) - timedelta(days=30)).date(),
        )

        rows = await EventService(db_session).list_missed_mandatory_events(
            organization_id=uuid.UUID(org_id),
            user_id=uuid.UUID(user_id),
            since=datetime.now(timezone.utc) - timedelta(days=30),
        )

        assert event_id in {r["event"].id for r in rows}

    async def test_excludes_an_event_during_an_approved_leave(
        self, db_session, org_and_user
    ):
        org_id, user_id = org_and_user
        event_id = await _insert_event(
            db_session, org_id, title="Leave Drill", is_mandatory=True, hours_ago=48
        )
        await db_session.execute(
            text(
                "INSERT INTO member_leaves_of_absence (id, organization_id, user_id, "
                "leave_type, start_date, end_date, active) "
                "VALUES (:id, :org, :usr, 'medical', :start, :end, 1)"
            ),
            {
                "id": _uid(),
                "org": org_id,
                "usr": user_id,
                "start": (datetime.now(timezone.utc) - timedelta(days=10)).date(),
                "end": (datetime.now(timezone.utc) + timedelta(days=10)).date(),
            },
        )
        await db_session.flush()

        rows = await EventService(db_session).list_missed_mandatory_events(
            organization_id=uuid.UUID(org_id),
            user_id=uuid.UUID(user_id),
            since=datetime.now(timezone.utc) - timedelta(days=30),
        )

        assert event_id not in {r["event"].id for r in rows}

    async def test_excludes_an_event_during_an_open_ended_leave(
        self, db_session, org_and_user
    ):
        # A NULL end_date is a permanent leave, not a leave that ended.
        org_id, user_id = org_and_user
        event_id = await _insert_event(
            db_session, org_id, title="Indefinite Leave", is_mandatory=True
        )
        await db_session.execute(
            text(
                "INSERT INTO member_leaves_of_absence (id, organization_id, user_id, "
                "leave_type, start_date, end_date, active) "
                "VALUES (:id, :org, :usr, 'military', :start, NULL, 1)"
            ),
            {
                "id": _uid(),
                "org": org_id,
                "usr": user_id,
                "start": (datetime.now(timezone.utc) - timedelta(days=20)).date(),
            },
        )
        await db_session.flush()

        rows = await EventService(db_session).list_missed_mandatory_events(
            organization_id=uuid.UUID(org_id),
            user_id=uuid.UUID(user_id),
            since=datetime.now(timezone.utc) - timedelta(days=30),
        )

        assert event_id not in {r["event"].id for r in rows}

    async def test_an_inactive_leave_does_not_excuse_anything(
        self, db_session, org_and_user
    ):
        org_id, user_id = org_and_user
        event_id = await _insert_event(
            db_session, org_id, title="Revoked Leave Drill", is_mandatory=True
        )
        await db_session.execute(
            text(
                "INSERT INTO member_leaves_of_absence (id, organization_id, user_id, "
                "leave_type, start_date, end_date, active) "
                "VALUES (:id, :org, :usr, 'personal', :start, :end, 0)"
            ),
            {
                "id": _uid(),
                "org": org_id,
                "usr": user_id,
                "start": (datetime.now(timezone.utc) - timedelta(days=10)).date(),
                "end": (datetime.now(timezone.utc) + timedelta(days=10)).date(),
            },
        )
        await db_session.flush()

        rows = await EventService(db_session).list_missed_mandatory_events(
            organization_id=uuid.UUID(org_id),
            user_id=uuid.UUID(user_id),
            since=datetime.now(timezone.utc) - timedelta(days=30),
        )

        assert event_id in {r["event"].id for r in rows}

    async def test_excludes_an_event_mandatory_for_another_membership_type(
        self, db_session, org_and_user
    ):
        # "Mandatory for probationary members" is not mandatory for anyone else.
        org_id, user_id = org_and_user
        event_id = await _insert_event(
            db_session, org_id, title="Probie Drill", is_mandatory=True
        )
        await db_session.execute(
            text("UPDATE events SET mandatory_membership_types = :t WHERE id = :id"),
            {"t": '["probationary"]', "id": event_id},
        )
        await db_session.execute(
            text("UPDATE users SET membership_type = 'active' WHERE id = :id"),
            {"id": user_id},
        )
        await db_session.flush()

        rows = await EventService(db_session).list_missed_mandatory_events(
            organization_id=uuid.UUID(org_id),
            user_id=uuid.UUID(user_id),
            since=datetime.now(timezone.utc) - timedelta(days=30),
        )

        assert event_id not in {r["event"].id for r in rows}

    async def test_includes_an_event_mandatory_for_the_members_own_type(
        self, db_session, org_and_user
    ):
        org_id, user_id = org_and_user
        event_id = await _insert_event(
            db_session, org_id, title="Active Drill", is_mandatory=True
        )
        await db_session.execute(
            text("UPDATE events SET mandatory_membership_types = :t WHERE id = :id"),
            {"t": '["active", "probationary"]', "id": event_id},
        )
        await db_session.execute(
            text("UPDATE users SET membership_type = 'active' WHERE id = :id"),
            {"id": user_id},
        )
        await db_session.flush()

        rows = await EventService(db_session).list_missed_mandatory_events(
            organization_id=uuid.UUID(org_id),
            user_id=uuid.UUID(user_id),
            since=datetime.now(timezone.utc) - timedelta(days=30),
        )

        assert event_id in {r["event"].id for r in rows}

    async def test_an_empty_membership_type_list_means_everyone(
        self, db_session, org_and_user
    ):
        org_id, user_id = org_and_user
        event_id = await _insert_event(
            db_session, org_id, title="All-hands Drill", is_mandatory=True
        )
        await db_session.execute(
            text("UPDATE events SET mandatory_membership_types = :t WHERE id = :id"),
            {"t": "[]", "id": event_id},
        )
        await db_session.flush()

        rows = await EventService(db_session).list_missed_mandatory_events(
            organization_id=uuid.UUID(org_id),
            user_id=uuid.UUID(user_id),
            since=datetime.now(timezone.utc) - timedelta(days=30),
        )

        assert event_id in {r["event"].id for r in rows}

    async def test_excludes_a_non_mandatory_event(self, db_session, org_and_user):
        org_id, user_id = org_and_user
        event_id = await _insert_event(
            db_session, org_id, title="Optional Social", is_mandatory=False
        )

        rows = await EventService(db_session).list_missed_mandatory_events(
            organization_id=uuid.UUID(org_id),
            user_id=uuid.UUID(user_id),
            since=datetime.now(timezone.utc) - timedelta(days=30),
        )

        assert event_id not in {r["event"].id for r in rows}
