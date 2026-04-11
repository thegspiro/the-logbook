"""
Integration tests for the event lifecycle.

Covers:
  - Event CRUD (create, read, update, list, delete, duplicate, publish)
  - RSVP lifecycle (create, update, list, waitlisting)
  - Attendance tracking (check-in, manager add, finalize)
  - Full end-to-end lifecycle (draft -> publish -> RSVP -> check-in -> finalize)
"""

import pytest
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.event_service import EventService
from app.schemas.event import EventCreate, EventUpdate, RSVPCreate

pytestmark = [pytest.mark.integration]


# ── Helpers ──────────────────────────────────────────────────────────


def _uid() -> str:
    return str(uuid.uuid4())


def _future_start() -> datetime:
    """Return a start datetime 24 hours from now (UTC)."""
    return datetime.now(timezone.utc) + timedelta(hours=24)


def _future_end() -> datetime:
    """Return an end datetime 26 hours from now (UTC)."""
    return datetime.now(timezone.utc) + timedelta(hours=26)


def _make_event_create(
    title: str = "Test Event",
    event_type: str = "business_meeting",
    is_draft: bool = False,
    requires_rsvp: bool = False,
    max_attendees: int | None = None,
    **overrides,
) -> EventCreate:
    """Build an EventCreate schema with sensible defaults."""
    start = overrides.pop("start_datetime", _future_start())
    end = overrides.pop("end_datetime", _future_end())

    rsvp_deadline = None
    if requires_rsvp:
        rsvp_deadline = overrides.pop(
            "rsvp_deadline", start - timedelta(hours=1)
        )

    return EventCreate(
        title=title,
        event_type=event_type,
        start_datetime=start,
        end_datetime=end,
        is_draft=is_draft,
        requires_rsvp=requires_rsvp,
        rsvp_deadline=rsvp_deadline,
        max_attendees=max_attendees,
        **overrides,
    )


@pytest.fixture
async def setup_org_and_users(db_session: AsyncSession):
    """Create a minimal organization and two users for event tests."""
    org_id = _uid()
    user_id = _uid()
    user2_id = _uid()

    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, :otype, :slug, :tz)"
        ),
        {
            "id": org_id,
            "name": "Test Dept",
            "otype": "fire_department",
            "slug": f"test-{org_id[:8]}",
            "tz": "UTC",
        },
    )
    for uid, uname, fn, ln in [
        (user_id, "jsmith", "John", "Smith"),
        (user2_id, "jdoe", "Jane", "Doe"),
    ]:
        await db_session.execute(
            text(
                "INSERT INTO users (id, organization_id, username, first_name, "
                "last_name, email, password_hash, status) "
                "VALUES (:id, :org, :un, :fn, :ln, :em, :pw, 'active')"
            ),
            {
                "id": uid,
                "org": org_id,
                "un": uname,
                "fn": fn,
                "ln": ln,
                "em": f"{uname}@test.com",
                "pw": "hashed",
            },
        )
    await db_session.flush()
    return org_id, user_id, user2_id


# ── Event CRUD Tests ────────────────────────────────────────────────


class TestEventCRUD:

    async def test_create_event(self, db_session, setup_org_and_users):
        org_id, user_id, _ = await setup_org_and_users
        svc = EventService(db_session)

        event_data = _make_event_create(
            title="Monthly Meeting",
            event_type="business_meeting",
            description="All-hands meeting",
            location="Station 1",
        )

        event = await svc.create_event(
            event_data=event_data,
            organization_id=uuid.UUID(org_id),
            created_by=uuid.UUID(user_id),
        )

        assert event is not None
        assert event.title == "Monthly Meeting"
        assert event.event_type.value == "business_meeting"
        assert event.description == "All-hands meeting"
        assert event.location == "Station 1"
        assert event.organization_id == org_id
        assert event.created_by == user_id
        assert event.is_cancelled is False

    async def test_list_events_by_type(self, db_session, setup_org_and_users):
        org_id, user_id, _ = await setup_org_and_users
        svc = EventService(db_session)

        await svc.create_event(
            event_data=_make_event_create(title="Meeting", event_type="business_meeting"),
            organization_id=uuid.UUID(org_id),
            created_by=uuid.UUID(user_id),
        )
        await svc.create_event(
            event_data=_make_event_create(title="Drill", event_type="training"),
            organization_id=uuid.UUID(org_id),
            created_by=uuid.UUID(user_id),
        )

        meetings = await svc.list_events(
            organization_id=uuid.UUID(org_id),
            event_type="business_meeting",
        )
        assert len(meetings) == 1
        assert meetings[0].title == "Meeting"

        trainings = await svc.list_events(
            organization_id=uuid.UUID(org_id),
            event_type="training",
        )
        assert len(trainings) == 1
        assert trainings[0].title == "Drill"

    async def test_update_event(self, db_session, setup_org_and_users):
        org_id, user_id, _ = await setup_org_and_users
        svc = EventService(db_session)

        event = await svc.create_event(
            event_data=_make_event_create(title="Original Title"),
            organization_id=uuid.UUID(org_id),
            created_by=uuid.UUID(user_id),
        )

        updated = await svc.update_event(
            event_id=uuid.UUID(event.id),
            organization_id=uuid.UUID(org_id),
            event_data=EventUpdate(
                title="Updated Title",
                description="New description",
                location="Conference Room B",
            ),
            updated_by=uuid.UUID(user_id),
        )

        assert updated is not None
        assert updated.title == "Updated Title"
        assert updated.description == "New description"
        assert updated.location == "Conference Room B"

    async def test_publish_draft_event(self, db_session, setup_org_and_users):
        org_id, user_id, _ = await setup_org_and_users
        svc = EventService(db_session)

        event = await svc.create_event(
            event_data=_make_event_create(title="Draft Event", is_draft=True),
            organization_id=uuid.UUID(org_id),
            created_by=uuid.UUID(user_id),
        )
        assert event.is_draft is True

        published = await svc.publish_event(
            event_id=uuid.UUID(event.id),
            organization_id=uuid.UUID(org_id),
        )
        assert published is not None
        assert published.is_draft is False

    async def test_delete_event(self, db_session, setup_org_and_users):
        org_id, user_id, _ = await setup_org_and_users
        svc = EventService(db_session)

        event = await svc.create_event(
            event_data=_make_event_create(title="To Delete"),
            organization_id=uuid.UUID(org_id),
            created_by=uuid.UUID(user_id),
        )

        deleted = await svc.delete_event(
            event_id=uuid.UUID(event.id),
            organization_id=uuid.UUID(org_id),
        )
        assert deleted is True

        events = await svc.list_events(organization_id=uuid.UUID(org_id))
        assert all(e.id != event.id for e in events)

    async def test_duplicate_event(self, db_session, setup_org_and_users):
        org_id, user_id, _ = await setup_org_and_users
        svc = EventService(db_session)

        original = await svc.create_event(
            event_data=_make_event_create(
                title="Original Event",
                event_type="social",
                description="Party",
                location="Firehouse",
            ),
            organization_id=uuid.UUID(org_id),
            created_by=uuid.UUID(user_id),
        )

        duplicate = await svc.duplicate_event(
            event_id=uuid.UUID(original.id),
            organization_id=uuid.UUID(org_id),
            created_by=uuid.UUID(user_id),
        )

        assert duplicate is not None
        assert duplicate.id != original.id
        assert duplicate.title == original.title
        assert duplicate.event_type == original.event_type
        assert duplicate.description == original.description
        assert duplicate.location == original.location
        assert duplicate.is_cancelled is False


# ── RSVP Tests ──────────────────────────────────────────────────────


class TestEventRSVP:

    async def test_create_rsvp_going(self, db_session, setup_org_and_users):
        org_id, user_id, _ = await setup_org_and_users
        svc = EventService(db_session)

        event = await svc.create_event(
            event_data=_make_event_create(
                title="RSVP Event",
                requires_rsvp=True,
            ),
            organization_id=uuid.UUID(org_id),
            created_by=uuid.UUID(user_id),
        )

        rsvp, err = await svc.create_or_update_rsvp(
            event_id=uuid.UUID(event.id),
            user_id=uuid.UUID(user_id),
            rsvp_data=RSVPCreate(status="going"),
            organization_id=uuid.UUID(org_id),
        )

        assert err is None
        assert rsvp is not None
        assert rsvp.status.value == "going"
        assert rsvp.event_id == event.id
        assert rsvp.user_id == user_id

    async def test_update_rsvp_status(self, db_session, setup_org_and_users):
        org_id, user_id, _ = await setup_org_and_users
        svc = EventService(db_session)

        event = await svc.create_event(
            event_data=_make_event_create(
                title="RSVP Update Event",
                requires_rsvp=True,
            ),
            organization_id=uuid.UUID(org_id),
            created_by=uuid.UUID(user_id),
        )

        rsvp, err = await svc.create_or_update_rsvp(
            event_id=uuid.UUID(event.id),
            user_id=uuid.UUID(user_id),
            rsvp_data=RSVPCreate(status="going"),
            organization_id=uuid.UUID(org_id),
        )
        assert err is None
        assert rsvp.status.value == "going"

        updated_rsvp, err = await svc.create_or_update_rsvp(
            event_id=uuid.UUID(event.id),
            user_id=uuid.UUID(user_id),
            rsvp_data=RSVPCreate(status="not_going"),
            organization_id=uuid.UUID(org_id),
        )
        assert err is None
        assert updated_rsvp is not None
        assert updated_rsvp.status.value == "not_going"

    async def test_multiple_rsvps(self, db_session, setup_org_and_users):
        org_id, user_id, user2_id = await setup_org_and_users
        svc = EventService(db_session)

        event = await svc.create_event(
            event_data=_make_event_create(
                title="Multi-RSVP Event",
                requires_rsvp=True,
            ),
            organization_id=uuid.UUID(org_id),
            created_by=uuid.UUID(user_id),
        )

        rsvp1, err1 = await svc.create_or_update_rsvp(
            event_id=uuid.UUID(event.id),
            user_id=uuid.UUID(user_id),
            rsvp_data=RSVPCreate(status="going"),
            organization_id=uuid.UUID(org_id),
        )
        assert err1 is None

        rsvp2, err2 = await svc.create_or_update_rsvp(
            event_id=uuid.UUID(event.id),
            user_id=uuid.UUID(user2_id),
            rsvp_data=RSVPCreate(status="going"),
            organization_id=uuid.UUID(org_id),
        )
        assert err2 is None

        rsvps = await svc.list_event_rsvps(
            event_id=uuid.UUID(event.id),
            organization_id=uuid.UUID(org_id),
        )
        assert len(rsvps) == 2

    async def test_rsvp_waitlist_when_full(self, db_session, setup_org_and_users):
        org_id, user_id, user2_id = await setup_org_and_users
        svc = EventService(db_session)

        event = await svc.create_event(
            event_data=_make_event_create(
                title="Limited Event",
                requires_rsvp=True,
                max_attendees=1,
            ),
            organization_id=uuid.UUID(org_id),
            created_by=uuid.UUID(user_id),
        )

        rsvp1, err1 = await svc.create_or_update_rsvp(
            event_id=uuid.UUID(event.id),
            user_id=uuid.UUID(user_id),
            rsvp_data=RSVPCreate(status="going"),
            organization_id=uuid.UUID(org_id),
        )
        assert err1 is None
        assert rsvp1.status.value == "going"

        rsvp2, err2 = await svc.create_or_update_rsvp(
            event_id=uuid.UUID(event.id),
            user_id=uuid.UUID(user2_id),
            rsvp_data=RSVPCreate(status="going"),
            organization_id=uuid.UUID(org_id),
        )
        assert err2 is None
        assert rsvp2.status.value == "waitlisted"


# ── Attendance Tests ────────────────────────────────────────────────


class TestEventAttendance:

    async def test_check_in_attendee(self, db_session, setup_org_and_users):
        """RSVP then check in within the check-in window."""
        org_id, user_id, _ = await setup_org_and_users
        svc = EventService(db_session)

        # Create event that starts NOW so the check-in window is open
        now = datetime.now(timezone.utc)
        event = await svc.create_event(
            event_data=_make_event_create(
                title="Check-In Event",
                requires_rsvp=True,
                start_datetime=now - timedelta(minutes=5),
                end_datetime=now + timedelta(hours=2),
                rsvp_deadline=now - timedelta(minutes=10),
                check_in_window_type="flexible",
            ),
            organization_id=uuid.UUID(org_id),
            created_by=uuid.UUID(user_id),
        )

        # RSVP first -- deadline already passed, so insert directly via SQL
        await db_session.execute(
            text(
                "INSERT INTO event_rsvps "
                "(id, organization_id, event_id, user_id, status, guest_count, checked_in) "
                "VALUES (:id, :org, :eid, :uid, 'going', 0, 0)"
            ),
            {
                "id": _uid(),
                "org": org_id,
                "eid": event.id,
                "uid": user_id,
            },
        )
        await db_session.flush()

        checked_in, err = await svc.check_in_attendee(
            event_id=uuid.UUID(event.id),
            user_id=uuid.UUID(user_id),
            organization_id=uuid.UUID(org_id),
        )

        assert err is None
        assert checked_in is not None
        assert checked_in.checked_in is True
        assert checked_in.checked_in_at is not None

    async def test_manager_add_attendee(self, db_session, setup_org_and_users):
        org_id, user_id, user2_id = await setup_org_and_users
        svc = EventService(db_session)

        event = await svc.create_event(
            event_data=_make_event_create(title="Manager Add Event"),
            organization_id=uuid.UUID(org_id),
            created_by=uuid.UUID(user_id),
        )

        rsvp, err = await svc.manager_add_attendee(
            event_id=uuid.UUID(event.id),
            user_id=uuid.UUID(user2_id),
            organization_id=uuid.UUID(org_id),
            manager_id=uuid.UUID(user_id),
            status="going",
            checked_in=True,
        )

        assert err is None
        assert rsvp is not None
        assert rsvp.user_id == user2_id
        assert rsvp.status.value == "going"
        assert rsvp.checked_in is True

    async def test_finalize_event_attendance(self, db_session, setup_org_and_users):
        org_id, user_id, user2_id = await setup_org_and_users
        svc = EventService(db_session)

        now = datetime.now(timezone.utc)
        event = await svc.create_event(
            event_data=_make_event_create(
                title="Finalize Event",
                start_datetime=now - timedelta(hours=3),
                end_datetime=now - timedelta(hours=1),
            ),
            organization_id=uuid.UUID(org_id),
            created_by=uuid.UUID(user_id),
        )

        # Manager adds two attendees as checked in
        await svc.manager_add_attendee(
            event_id=uuid.UUID(event.id),
            user_id=uuid.UUID(user_id),
            organization_id=uuid.UUID(org_id),
            manager_id=uuid.UUID(user_id),
            status="going",
            checked_in=True,
        )
        await svc.manager_add_attendee(
            event_id=uuid.UUID(event.id),
            user_id=uuid.UUID(user2_id),
            organization_id=uuid.UUID(org_id),
            manager_id=uuid.UUID(user_id),
            status="going",
            checked_in=True,
        )

        updated_count, err = await svc.finalize_event_attendance(
            event_id=uuid.UUID(event.id),
            organization_id=uuid.UUID(org_id),
        )

        assert err is None
        assert updated_count == 2

    async def test_cannot_check_in_cancelled_event(self, db_session, setup_org_and_users):
        org_id, user_id, _ = await setup_org_and_users
        svc = EventService(db_session)

        event = await svc.create_event(
            event_data=_make_event_create(title="Cancel Me"),
            organization_id=uuid.UUID(org_id),
            created_by=uuid.UUID(user_id),
        )

        await svc.cancel_event(
            event_id=uuid.UUID(event.id),
            organization_id=uuid.UUID(org_id),
            reason="Test cancellation reason for this event",
        )

        rsvp, err = await svc.check_in_attendee(
            event_id=uuid.UUID(event.id),
            user_id=uuid.UUID(user_id),
            organization_id=uuid.UUID(org_id),
        )

        assert rsvp is None
        assert err is not None
        assert "cancelled" in err.lower()


# ── Full Lifecycle Test ─────────────────────────────────────────────


class TestEventLifecycleFlow:

    async def test_full_event_lifecycle(self, db_session, setup_org_and_users):
        """
        End-to-end: draft -> publish -> RSVP -> check-in -> finalize.
        """
        org_id, user_id, user2_id = await setup_org_and_users
        svc = EventService(db_session)

        # 1. Create as draft
        now = datetime.now(timezone.utc)
        event = await svc.create_event(
            event_data=_make_event_create(
                title="Lifecycle Event",
                event_type="business_meeting",
                is_draft=True,
                requires_rsvp=True,
                start_datetime=now - timedelta(minutes=5),
                end_datetime=now + timedelta(hours=2),
                rsvp_deadline=now + timedelta(hours=1),
                check_in_window_type="flexible",
            ),
            organization_id=uuid.UUID(org_id),
            created_by=uuid.UUID(user_id),
        )
        assert event.is_draft is True

        # Draft should not appear in default listing
        default_list = await svc.list_events(organization_id=uuid.UUID(org_id))
        assert all(e.id != event.id for e in default_list)

        # 2. Publish
        published = await svc.publish_event(
            event_id=uuid.UUID(event.id),
            organization_id=uuid.UUID(org_id),
        )
        assert published.is_draft is False

        # Published event should appear in default listing
        published_list = await svc.list_events(organization_id=uuid.UUID(org_id))
        assert any(e.id == event.id for e in published_list)

        # 3. RSVP
        rsvp1, err = await svc.create_or_update_rsvp(
            event_id=uuid.UUID(event.id),
            user_id=uuid.UUID(user_id),
            rsvp_data=RSVPCreate(status="going"),
            organization_id=uuid.UUID(org_id),
        )
        assert err is None
        assert rsvp1.status.value == "going"

        rsvp2, err = await svc.create_or_update_rsvp(
            event_id=uuid.UUID(event.id),
            user_id=uuid.UUID(user2_id),
            rsvp_data=RSVPCreate(status="going"),
            organization_id=uuid.UUID(org_id),
        )
        assert err is None

        # 4. Check-in (event window is open because start is in the past)
        checked_in, err = await svc.check_in_attendee(
            event_id=uuid.UUID(event.id),
            user_id=uuid.UUID(user_id),
            organization_id=uuid.UUID(org_id),
        )
        assert err is None
        assert checked_in.checked_in is True

        checked_in2, err = await svc.check_in_attendee(
            event_id=uuid.UUID(event.id),
            user_id=uuid.UUID(user2_id),
            organization_id=uuid.UUID(org_id),
        )
        assert err is None
        assert checked_in2.checked_in is True

        # 5. Verify stats
        stats = await svc.get_event_stats(
            event_id=uuid.UUID(event.id),
            organization_id=uuid.UUID(org_id),
        )
        assert stats is not None
        assert stats.going_count == 2
        assert stats.checked_in_count == 2

        # 6. Record actual end time (triggers finalize)
        event_after, err = await svc.record_actual_times(
            event_id=uuid.UUID(event.id),
            organization_id=uuid.UUID(org_id),
            actual_start_time=now - timedelta(minutes=5),
            actual_end_time=now + timedelta(hours=1),
        )
        assert err is None
        assert event_after.actual_end_time is not None
