"""
Integration cover for the waitlist aggregate the /events list projects.

The number on the card and the number on the detail page are read by the same
member, seconds apart, and they have to agree. `waitlist_count` on the list is
a correlated subquery; on the detail response it is computed in Python from the
eager-loaded RSVPs. Both must apply the eligibility rule
`promote_from_waitlist` applies — a party needing more seats than the whole
event holds is passed over there — or the card reads "5 waiting" and the detail
page the member opens next reads "#1 of 4".

Only a real database proves the subquery half: the predicate correlates
`event_rsvps.guest_count` against `events.max_attendees` across the join, and
has to treat an absent cap as no cap rather than excluding every row.
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
    max_attendees: int | None,
) -> str:
    event_id = _uid()
    start = datetime.now(timezone.utc) + timedelta(days=3)
    await db_session.execute(
        text(
            # reminder_schedule is NOT NULL with only a Python-side default,
            # so a raw INSERT has to supply it.
            "INSERT INTO events (id, organization_id, title, event_type, "
            "start_datetime, end_datetime, requires_rsvp, is_mandatory, "
            "is_cancelled, is_draft, max_attendees, reminder_schedule) "
            "VALUES (:id, :org, :title, 'training', :start, :end, 1, 0, "
            "0, 0, :cap, '[24]')"
        ),
        {
            "id": event_id,
            "org": org_id,
            "title": title,
            "start": start,
            "end": start + timedelta(hours=2),
            "cap": max_attendees,
        },
    )
    await db_session.flush()
    return event_id


async def _insert_waitlisted(
    db_session: AsyncSession,
    org_id: str,
    event_id: str,
    *,
    guest_count: int,
) -> None:
    """A waitlisted RSVP from a member created for this row alone.

    Each queued party is a distinct member because the RSVP table is unique per
    (event, user); the test only cares about how many rows the aggregate counts.
    """
    member_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, 'Queued', 'Member', :em, 'hashed', 'active')"
        ),
        {
            "id": member_id,
            "org": org_id,
            "un": f"u{member_id[:8]}",
            "em": f"{member_id[:8]}@test.com",
        },
    )
    await db_session.execute(
        text(
            "INSERT INTO event_rsvps (id, organization_id, event_id, user_id, "
            "status, guest_count, responded_at) "
            "VALUES (:id, :org, :ev, :usr, 'waitlisted', :gc, :at)"
        ),
        {
            "id": _uid(),
            "org": org_id,
            "ev": event_id,
            "usr": member_id,
            "gc": guest_count,
            "at": datetime.now(timezone.utc),
        },
    )
    await db_session.flush()


async def _waitlist_count(
    service: EventService, org_id: str, user_id: str, event_id: str
) -> int:
    rows = await service.list_events(
        organization_id=uuid.UUID(org_id), user_id=uuid.UUID(user_id)
    )
    row = next(r for r in rows if r["event"].id == event_id)
    return row["waitlist_count"]


class TestWaitlistCountProjection:
    async def test_counts_parties_that_can_still_fit(self, db_session, org_and_user):
        org_id, user_id = org_and_user
        event_id = await _insert_event(
            db_session, org_id, title="Capped Drill", max_attendees=4
        )
        await _insert_waitlisted(db_session, org_id, event_id, guest_count=0)
        await _insert_waitlisted(db_session, org_id, event_id, guest_count=2)

        count = await _waitlist_count(
            EventService(db_session), org_id, user_id, event_id
        )

        assert count == 2

    async def test_excludes_a_party_larger_than_the_event(
        self, db_session, org_and_user
    ):
        # An organizer lowering max_attendees under a party that had already
        # queued is the only way this row comes about; promotion passes over
        # it, so the card must not advertise it as somebody who is waiting to
        # be moved up.
        org_id, user_id = org_and_user
        event_id = await _insert_event(
            db_session, org_id, title="Shrunk Drill", max_attendees=2
        )
        await _insert_waitlisted(db_session, org_id, event_id, guest_count=0)
        await _insert_waitlisted(db_session, org_id, event_id, guest_count=5)

        count = await _waitlist_count(
            EventService(db_session), org_id, user_id, event_id
        )

        assert count == 1

    async def test_party_exactly_filling_the_event_still_counts(
        self, db_session, org_and_user
    ):
        # The boundary the predicate is written on: a party of three is
        # promotable into a three-seat event, so `<=` and not `<`.
        org_id, user_id = org_and_user
        event_id = await _insert_event(
            db_session, org_id, title="Exact Fit Drill", max_attendees=3
        )
        await _insert_waitlisted(db_session, org_id, event_id, guest_count=2)

        count = await _waitlist_count(
            EventService(db_session), org_id, user_id, event_id
        )

        assert count == 1

    async def test_uncapped_event_counts_every_waitlisted_row(
        self, db_session, org_and_user
    ):
        # A NULL cap means unlimited. Comparing against it in SQL yields NULL,
        # which would silently drop every row — the aggregate has to treat an
        # absent cap as no filter, the way `if event.max_attendees:` does on
        # the detail path.
        org_id, user_id = org_and_user
        event_id = await _insert_event(
            db_session, org_id, title="Uncapped Drill", max_attendees=None
        )
        await _insert_waitlisted(db_session, org_id, event_id, guest_count=0)
        await _insert_waitlisted(db_session, org_id, event_id, guest_count=9)

        count = await _waitlist_count(
            EventService(db_session), org_id, user_id, event_id
        )

        assert count == 2
